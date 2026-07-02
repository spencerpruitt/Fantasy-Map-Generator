import { describe, expect, it } from "vitest";
import {
  type ChartDatum,
  type ChartOptions,
  type ChartsSnapshot,
  calculateLegendRows,
  computeChartData,
  computeChartGeometry,
  entitiesMap,
  getTextMinWidth,
  plotTypeMap,
  quantizationMap,
  sortData,
  validateChartRequest
} from "./charts-overview";

/**
 * A tiny deterministic world: 4 land cells + 1 water cell across two real
 * states, a neutral zero-population area, two markets (one without a center
 * burg), a burg with production, and a marine biome — the edge cases the
 * legacy aggregations handled (zero-population states, neutral/unclaimed
 * cells, water biomes).
 *
 * cell: 0(land,st1,coastal) 1(land,st1,burg,river) 2(land,st2) 3(land,neutral,pop 0) 4(water)
 */
function makeSnapshot(): ChartsSnapshot {
  const goodsById: Record<number, { name: string; value: number }> = {
    7: { name: "Grain", value: 2 },
    9: { name: "Ore", value: 5 }
  };
  return {
    cells: {
      i: [0, 1, 2, 3, 4],
      h: [50, 30, 25, 40, 10],
      t: [1, 0, 1, 0, -1],
      r: [0, 5, 0, 0, 0],
      g: [0, 1, 2, 3, 4],
      pop: [10, 20, 30, 0, 0],
      area: [100, 120, 90, 80, 60],
      biome: [1, 2, 2, 1, 0],
      culture: [1, 2, 2, 0, 0],
      religion: [1, 1, 2, 0, 0],
      state: [1, 1, 2, 0, 0],
      province: [1, 1, 0, 0, 0],
      market: [1, 1, 2, 0, 2],
      burg: [0, 1, 0, 0, 0]
    },
    climate: { temp: [10, 20, 30, 0, -5], prec: [5, 15, 25, 35, 45] },
    collections: {
      states: [{ name: "Neutrals" }, { name: "Aland", color: "#a00" }, { name: "Bland", color: "#0a0" }],
      cultures: [{ name: "Wildlands" }, { name: "Alpha", color: "#111" }, { name: "Beta", color: "#222" }],
      religions: [{ name: "No religion" }, { name: "Faith", color: "#333" }, { name: "Creed", color: "#444" }],
      provinces: [{}, { name: "Coastal", color: "#555" }]
    },
    biomes: { i: [0, 1, 2], name: ["Marine", "Forest", "Desert"], color: ["#00f", "#0f0", "#ff0"] },
    markets: [
      { i: 1, centerBurgId: 1, color: "#f0f" },
      { i: 2, centerBurgId: 9, color: "#0ff" }
    ],
    goods: [
      { i: 7, name: "Grain", color: "#dd0" },
      { i: 9, name: "Ore", color: "#999" }
    ],
    burgs: [undefined, { name: "Burgton", population: 5, product: 12 }],
    populationRate: 10,
    urbanization: 2,
    getBiomesProduction: () => ({ 1: [{ goodId: 7, production: 0.5 }] }),
    getCellGoodsProduction: (cellId): Record<number, number> => {
      if (cellId === 0) return { 7: 2 };
      if (cellId === 1) return { 7: 4, 9: 1 };
      return {};
    },
    getGoodById: id => goodsById[id],
    units: {
      getArea: rawArea => rawArea * 2,
      getAreaUnit: () => "mi²",
      getHeight: height => `${height}m`,
      getPrecipitation: prec => `${prec}mm`
    }
  };
}

function makeOptions(overrides: Partial<ChartOptions>): ChartOptions {
  return {
    id: 1,
    entity: "states",
    plotBy: "total_population",
    groupBy: "states",
    sorting: "natural",
    type: "stackedBar",
    excludeNeutral: false,
    ...overrides
  };
}

function datumValue(data: ChartDatum[], name: string, group?: string): number | undefined {
  return data.find(d => d.name === name && (group === undefined || d.group === group))?.value;
}

describe("computeChartData — metric aggregations (states dimension)", () => {
  const ctx = makeSnapshot();
  const compute = (plotBy: string, overrides: Partial<ChartOptions> = {}) =>
    computeChartData(makeOptions({ plotBy, ...overrides }), ctx);

  it("total_population sums urban (burg × rates) and rural (pop × rate) per cell", () => {
    const { data } = compute("total_population");
    // Aland: cell0 rural 100 + cell1 (urban 5×10×2 + rural 200) = 400.
    expect(datumValue(data, "Aland")).toBe(400);
    expect(datumValue(data, "Bland")).toBe(300);
    // A zero-population area still appears, with value 0 (legacy behavior).
    expect(datumValue(data, "Neutrals")).toBe(0);
  });

  it("urban_population reads only burg cells", () => {
    const { data } = compute("urban_population");
    expect(datumValue(data, "Aland")).toBe(100);
    expect(datumValue(data, "Bland")).toBe(0);
  });

  it("rural_population scales cell pop by the population rate", () => {
    const { data } = compute("rural_population");
    expect(datumValue(data, "Aland")).toBe(300);
    expect(datumValue(data, "Bland")).toBe(300);
  });

  it("area converts each cell through the host getArea", () => {
    const { data } = compute("area");
    expect(datumValue(data, "Aland")).toBe(440); // (100+120)×2
    expect(datumValue(data, "Bland")).toBe(180);
  });

  it("cells counts land cells", () => {
    const { data } = compute("cells");
    expect(datumValue(data, "Aland")).toBe(2);
    expect(datumValue(data, "Neutrals")).toBe(1);
  });

  it("burgs_number counts burg cells", () => {
    const { data } = compute("burgs_number");
    expect(datumValue(data, "Aland")).toBe(1);
    expect(datumValue(data, "Bland")).toBe(0);
  });

  it("average/max/min elevation aggregate with mean/max/min", () => {
    expect(datumValue(compute("average_elevation").data, "Aland")).toBe(40); // mean(50, 30)
    expect(datumValue(compute("max_elevation").data, "Aland")).toBe(50);
    expect(datumValue(compute("min_elevation").data, "Aland")).toBe(30);
  });

  it("temperature metrics read the grid through the cell's grid index", () => {
    expect(datumValue(compute("average_temperature").data, "Aland")).toBe(15); // mean(temp[0]=10, temp[1]=20)
    expect(datumValue(compute("max_temperature").data, "Aland")).toBe(20);
    expect(datumValue(compute("min_temperature").data, "Aland")).toBe(10);
  });

  it("precipitation metrics read the grid and round", () => {
    expect(datumValue(compute("average_precipitation").data, "Aland")).toBe(10); // rn(mean(5, 15))
    expect(datumValue(compute("max_precipitation").data, "Aland")).toBe(15);
    expect(datumValue(compute("min_precipitation").data, "Aland")).toBe(5);
  });

  it("coastal_cells and river_cells count flag cells", () => {
    const coastal = compute("coastal_cells").data;
    expect(datumValue(coastal, "Aland")).toBe(1);
    expect(datumValue(coastal, "Bland")).toBe(1);
    const river = compute("river_cells").data;
    expect(datumValue(river, "Aland")).toBe(1);
    expect(datumValue(river, "Bland")).toBe(0);
  });

  it("production_value multiplies produced units by the good's value", () => {
    // Aland: cell0 Grain 2×2 + cell1 (Grain 4×2 + Ore 1×5) = 4 + 8 + 5 = 17.
    const { data } = compute("production_value");
    expect(datumValue(data, "Aland")).toBe(17);
  });

  it("production_units sums produced units", () => {
    const { data } = compute("production_units");
    expect(datumValue(data, "Aland")).toBe(7); // Grain 6 + Ore 1
  });

  it("burgs_profit sums each burg cell's product", () => {
    const { data } = compute("burgs_profit");
    expect(datumValue(data, "Aland")).toBe(12);
    expect(datumValue(data, "Bland")).toBe(0);
  });
});

describe("computeChartData — dimensions, grouping, water and neutral handling", () => {
  const ctx = makeSnapshot();

  it("groups by a second dimension and reports labels + colors", () => {
    const computed = computeChartData(makeOptions({ groupBy: "cultures" }), ctx);
    expect(computed.title).toBe("States by Total population grouped by Culture");
    expect(computed.noGrouping).toBe(false);
    expect(computed.entityLabel).toBe("State");
    expect(computed.groupLabel).toBe("Culture");
    // Colors come from the GROUPING dimension, neutral color for uncolored entries.
    expect(computed.colors).toEqual({ Wildlands: "#ccc", Alpha: "#111", Beta: "#222" });
    // Aland splits between Alpha (cell0: 100) and Beta (cell1: 300).
    expect(datumValue(computed.data, "Aland", "Alpha")).toBe(100);
    expect(datumValue(computed.data, "Aland", "Beta")).toBe(300);
  });

  it("excludeNeutral drops the id-0 bucket on either axis", () => {
    const computed = computeChartData(makeOptions({ groupBy: "cultures", excludeNeutral: true }), ctx);
    expect(computed.data.some(d => d.name === "Neutrals")).toBe(false);
    expect(computed.data.some(d => d.group === "Wildlands")).toBe(false);
    expect(datumValue(computed.data, "Aland", "Alpha")).toBe(100);
  });

  it("skips water cells when the dimension or the metric is land-only", () => {
    // states (land-only dimension) × average_elevation (water-allowed metric):
    // the water cell (h=10) must not drag Neutrals' mean down.
    const { data } = computeChartData(makeOptions({ plotBy: "average_elevation" }), ctx);
    expect(datumValue(data, "Neutrals")).toBe(40);
  });

  it("includes water cells for a water-allowed dimension × metric (marine biome)", () => {
    const { data } = computeChartData(
      makeOptions({ entity: "biomes", groupBy: "biomes", plotBy: "average_elevation" }),
      ctx
    );
    expect(datumValue(data, "Marine")).toBe(10); // the water cell
    expect(datumValue(data, "Forest")).toBe(45); // mean(50, 40)
    expect(datumValue(data, "Desert")).toBe(27.5); // mean(30, 25)
  });

  it("names markets from the center burg and falls back to Market {i}; id 0 is 'no'", () => {
    const computed = computeChartData(makeOptions({ entity: "markets", groupBy: "markets" }), ctx);
    expect(datumValue(computed.data, "Burgton")).toBe(400); // market 1, named by its center burg
    expect(datumValue(computed.data, "Market 2")).toBe(300); // no center burg resolves
    expect(datumValue(computed.data, "no")).toBe(0); // unclaimed cells (market id 0)
    expect(computed.colors).toEqual({ Burgton: "#f0f", "Market 2": "#0ff" });
  });

  it("buckets tagged contributions by good for the goods dimension", () => {
    const computed = computeChartData(
      makeOptions({ entity: "goods", groupBy: "goods", plotBy: "production_value" }),
      ctx
    );
    expect(computed.title).toBe("Goods by Production value");
    expect(datumValue(computed.data, "Grain")).toBe(12); // 2×2 + 4×2
    expect(datumValue(computed.data, "Ore")).toBe(5); // 1×5
    expect(computed.colors).toEqual({ Grain: "#dd0", Ore: "#999" });
  });

  it("resolves provinces, religions and biomes through their collections ('no' for id 0)", () => {
    const provinces = computeChartData(
      makeOptions({ entity: "provinces", groupBy: "provinces", plotBy: "cells" }),
      ctx
    );
    expect(datumValue(provinces.data, "Coastal")).toBe(2);
    expect(datumValue(provinces.data, "no")).toBe(2);

    const religions = computeChartData(
      makeOptions({ entity: "religions", groupBy: "religions", plotBy: "cells" }),
      ctx
    );
    expect(datumValue(religions.data, "Faith")).toBe(2);
    expect(datumValue(religions.data, "Creed")).toBe(1);
  });

  it("computes every supported dimension×metric combination without NaN (smoke matrix)", () => {
    for (const entity of Object.keys(entitiesMap)) {
      for (const plotBy of Object.keys(quantizationMap)) {
        const validation = validateChartRequest(entity, plotBy, entity);
        if (!validation.ok) continue;
        const computed = computeChartData(makeOptions({ entity, groupBy: validation.groupBy, plotBy }), ctx);
        expect(Array.isArray(computed.data)).toBe(true);
        expect(computed.data.length).toBeGreaterThan(0);
        for (const row of computed.data) {
          expect(typeof row.name).toBe("string");
          expect(typeof row.group).toBe("string");
          expect(Number.isFinite(row.value), `${entity} × ${plotBy} → ${row.name}`).toBe(true);
        }
      }
    }
  });
});

describe("validateChartRequest", () => {
  it("rejects a dimension that requires a tag the metric does not provide", () => {
    expect(validateChartRequest("goods", "total_population", "goods")).toEqual({
      ok: false,
      error: "Total population cannot be broken down by good"
    });
    // ... on the grouping axis too.
    expect(validateChartRequest("states", "total_population", "goods")).toEqual({
      ok: false,
      error: "Total population cannot be broken down by good"
    });
  });

  it("drops grouping for a non-stackable metric with a warning", () => {
    expect(validateChartRequest("states", "average_elevation", "cultures")).toEqual({
      ok: true,
      groupBy: "states",
      warning: "Grouping is not supported for average_elevation"
    });
  });

  it("passes a valid request through unchanged", () => {
    expect(validateChartRequest("states", "total_population", "cultures")).toEqual({ ok: true, groupBy: "cultures" });
    expect(validateChartRequest("goods", "production_units", "goods")).toEqual({ ok: true, groupBy: "goods" });
  });
});

describe("sortData", () => {
  const data = (): ChartDatum[] => [
    { name: "B", group: "y", value: 5 },
    { name: "A", group: "x", value: 9 },
    { name: "B", group: "x", value: 1 }
  ];

  it("natural keeps the input order", () => {
    expect(sortData(data(), "natural").map(d => `${d.name}${d.group}`)).toEqual(["By", "Ax", "Bx"]);
  });

  it("name sorts entities Z→A (first element renders at the bottom), groups A→Z", () => {
    expect(sortData(data(), "name").map(d => `${d.name}${d.group}`)).toEqual(["Bx", "By", "Ax"]);
  });

  it("value sorts entities by ascending total, groups by descending total", () => {
    // Totals: B=6, A=9; group totals: y=5, x=10 → B first (smaller), x before y.
    expect(sortData(data(), "value").map(d => `${d.name}${d.group}`)).toEqual(["Bx", "By", "Ax"]);
  });
});

describe("chart geometry", () => {
  it("reserves y-scale width from the longest entity name", () => {
    expect(getTextMinWidth(["Aland", "Bo"])).toBe(35); // 5 chars × 7px
    expect(getTextMinWidth([])).toBe(0);
  });

  it("wraps the legend into rows when groups exceed the available width", () => {
    expect(calculateLegendRows([], 800)).toBe(0);
    expect(calculateLegendRows(["Alpha", "Beta"], 800)).toBe(1);
    // Each label needs 10 + 5×7 = 45px; at 50px only one fits per row.
    expect(calculateLegendRows(["Alpha", "Betaa", "Gamma"], 50)).toBe(3);
  });

  it("derives margins and height from the data", () => {
    const geometry = computeChartGeometry([
      { name: "Aland", group: "Alpha", value: 1 },
      { name: "Bland", group: "Alpha", value: 2 }
    ]);
    expect(geometry.entities).toEqual(["Aland", "Bland"]);
    expect(geometry.groups).toEqual(["Alpha"]);
    expect(geometry.legendRows).toBe(1);
    expect(geometry.margin).toEqual({ top: 30, right: 15, bottom: 30, left: 35 });
    expect(geometry.height).toBe(110); // 2×25 + 30 + 30
  });
});

describe("plot types", () => {
  it("formats normalized-bar ticks as percentages", () => {
    expect(plotTypeMap.normalizedStackedBar.formatX!(0.256)).toBe("26%");
    expect(plotTypeMap.stackedBar.formatX).toBeUndefined();
  });
});
