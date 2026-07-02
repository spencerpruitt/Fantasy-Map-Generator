import { max, mean, min, stackOffsetDiverging, stackOffsetExpand, sum } from "d3";
import { openSurface } from "@/ui/app-shell/registry";
import {
  type BiomeGoodsProduction,
  type ChartCells,
  type ChartCollectionKey,
  getBiomesMeta,
  getBiomesProduction,
  getBurgs,
  getCellGoodsProduction,
  getChartCells,
  getGood,
  getGoods,
  getGridClimate,
  getMarkets,
  getNamedEntities,
  getPopulationScales
} from "@/ui/world-state";
import { capitalize, convertTemperature, formatPrice, rn, si } from "../utils";

/**
 * Data Charts — the preserved `open()` trigger seam plus the chart aggregation
 * math (Phase 3 Slice 12).
 *
 * The dimension/metric/aggregation model is the legacy algorithm verbatim,
 * re-exported as pure functions over a {@link ChartsSnapshot} (assembled from
 * World-State accessor getters by `buildChartsSnapshot`) so the React surface
 * (`src/ui/surfaces/ChartsOverview.tsx`) can render it with d3 and node tests
 * can pin every dimension×metric combination on a stubbed world. The legacy
 * dialog markup, its appended stylesheet, and the `.dialog()` call are gone.
 */

// ---------------------------------------------------------------------------
// The world snapshot the chart math reads (assembled from the accessor)
// ---------------------------------------------------------------------------

type NamedColored = { name?: string; color?: string };

/** Everything one chart computation reads. Pure inputs — node tests build it directly. */
export interface ChartsSnapshot {
  cells: ChartCells;
  climate: { temp: ArrayLike<number>; prec: ArrayLike<number> };
  collections: Record<ChartCollectionKey, NamedColored[]>;
  biomes: { i: number[]; name: string[]; color: string[] };
  markets: { i: number; name?: string; color?: string; centerBurgId: number }[];
  goods: { i: number; name?: string; color?: string }[];
  burgs: ({ name?: string; population?: number; product?: number } | undefined)[];
  populationRate: number;
  urbanization: number;
  getBiomesProduction: () => BiomeGoodsProduction;
  getCellGoodsProduction: (cellId: number, biomeProduction: BiomeGoodsProduction) => Record<number, number>;
  getGoodById: (id: number) => { name?: string; value: number } | undefined;
  /** Host display-unit helpers (the `getArea`/`getHeight`/... globals), guarded. */
  units: {
    getArea: (rawArea: number) => number;
    getAreaUnit: () => string;
    getHeight: (height: number) => string;
    getPrecipitation: (prec: number) => string;
  };
}

/**
 * Assemble the snapshot from the World-State accessor and the guarded host
 * unit helpers. Returns null when no world is loaded (the surface renders an
 * empty state instead of a NaN chart).
 */
export function buildChartsSnapshot(): ChartsSnapshot | null {
  const cells = getChartCells();
  const climate = getGridClimate();
  if (!cells || !climate) return null;

  const scales = getPopulationScales();
  return {
    cells,
    climate,
    collections: {
      states: getNamedEntities("states"),
      cultures: getNamedEntities("cultures"),
      religions: getNamedEntities("religions"),
      provinces: getNamedEntities("provinces")
    },
    biomes: getBiomesMeta(),
    markets: getMarkets(),
    goods: getGoods(),
    burgs: getBurgs(),
    populationRate: scales.populationRate,
    urbanization: scales.urbanization,
    getBiomesProduction,
    getCellGoodsProduction,
    getGoodById: getGood,
    units: {
      getArea: rawArea => (typeof getArea === "function" ? getArea(rawArea) : rawArea),
      getAreaUnit: () => (typeof getAreaUnit === "function" ? getAreaUnit() : ""),
      getHeight: height => (typeof getHeight === "function" ? getHeight(height) : String(height)),
      getPrecipitation: prec => (typeof getPrecipitation === "function" ? getPrecipitation(prec) : String(prec))
    }
  };
}

// ---------------------------------------------------------------------------
// Dimensions (chart entities), metrics, and plot types — the legacy model,
// parameterized over the snapshot instead of the raw globals
// ---------------------------------------------------------------------------

export interface Dimension {
  label: string;
  getId: (cellId: number, contribution: Contribution, ctx: ChartsSnapshot) => number;
  getName: (id: string | number, ctx: ChartsSnapshot) => string;
  getColors: (ctx: ChartsSnapshot) => Record<string, string>;
  landOnly: boolean;
  requires?: string;
}

export interface Metric {
  label: string;
  hint?: string;
  stringify: (value: number, ctx: ChartsSnapshot) => string;
  aggregate: (values: number[]) => number;
  formatTicks: (value: number, ctx: ChartsSnapshot) => string | number;
  stackable: boolean;
  landOnly: boolean;
  quantize?: (cellId: number, ctx: ChartsSnapshot) => number; // scalar metrics: one value per cell
  getContributions?: (cellId: number, prodCtx: ProductionContext, ctx: ChartsSnapshot) => Contribution[]; // tagged metrics: many per cell
  prepare?: (ctx: ChartsSnapshot) => ProductionContext; // computed once per render and passed to getContributions
  provides?: string[]; // contribution tags this metric supplies (matched against Dimension.requires)
}

export interface Contribution {
  value: number;
  good?: number;
}

export interface ChartOptions {
  id: number;
  entity: string;
  plotBy: string;
  groupBy: string;
  sorting: string;
  type: string;
  excludeNeutral: boolean;
}

export interface ChartDatum {
  name: string;
  group: string;
  value: number;
}

interface ProductionContext {
  biomeProduction: BiomeGoodsProduction;
}

const NEUTRAL_COLOR = "#ccc";
const EMPTY_NAME = "no";

function nameGetter(entity: ChartCollectionKey) {
  return (i: string | number, ctx: ChartsSnapshot): string => ctx.collections[entity][+i]?.name || EMPTY_NAME;
}

function colorsGetter(entity: ChartCollectionKey) {
  return (ctx: ChartsSnapshot): Record<string, string> =>
    Object.fromEntries(ctx.collections[entity].map(e => [e.name || EMPTY_NAME, e.color || NEUTRAL_COLOR]));
}

function biomeNameGetter(i: string | number, ctx: ChartsSnapshot): string {
  return ctx.biomes.name[+i] || EMPTY_NAME;
}

function biomeColorsGetter(ctx: ChartsSnapshot): Record<string, string> {
  return Object.fromEntries(ctx.biomes.i.map(i => [ctx.biomes.name[i], ctx.biomes.color[i]]));
}

// markets have no default name, so fall back to the center burg's name
function marketNameGetter(i: string | number, ctx: ChartsSnapshot): string {
  const market = ctx.markets.find(m => m.i === +i);
  if (!market) return EMPTY_NAME;
  return market.name || ctx.burgs[market.centerBurgId]?.name || `Market ${market.i}`;
}

function marketColorsGetter(ctx: ChartsSnapshot): Record<string, string> {
  return Object.fromEntries(ctx.markets.map(m => [marketNameGetter(m.i, ctx), m.color || NEUTRAL_COLOR]));
}

function goodNameGetter(i: string | number, ctx: ChartsSnapshot): string {
  return ctx.getGoodById(+i)?.name || EMPTY_NAME;
}

function goodColorsGetter(ctx: ChartsSnapshot): Record<string, string> {
  return Object.fromEntries(ctx.goods.map(g => [g.name || EMPTY_NAME, g.color || NEUTRAL_COLOR]));
}

function getUrbanPopulation(cellId: number, ctx: ChartsSnapshot): number {
  const burgId = ctx.cells.burg[cellId];
  if (!burgId) return 0;
  const populationPoints = ctx.burgs[burgId]?.population || 0;
  return populationPoints * ctx.populationRate * ctx.urbanization;
}

function getRuralPopulation(cellId: number, ctx: ChartsSnapshot): number {
  return ctx.cells.pop[cellId] * ctx.populationRate;
}

export const entitiesMap: Record<string, Dimension> = {
  states: {
    label: "State",
    getId: (cellId, _c, ctx) => ctx.cells.state[cellId],
    getName: nameGetter("states"),
    getColors: colorsGetter("states"),
    landOnly: true
  },
  cultures: {
    label: "Culture",
    getId: (cellId, _c, ctx) => ctx.cells.culture[cellId],
    getName: nameGetter("cultures"),
    getColors: colorsGetter("cultures"),
    landOnly: true
  },
  religions: {
    label: "Religion",
    getId: (cellId, _c, ctx) => ctx.cells.religion[cellId],
    getName: nameGetter("religions"),
    getColors: colorsGetter("religions"),
    landOnly: true
  },
  provinces: {
    label: "Province",
    getId: (cellId, _c, ctx) => ctx.cells.province[cellId],
    getName: nameGetter("provinces"),
    getColors: colorsGetter("provinces"),
    landOnly: true
  },
  biomes: {
    label: "Biome",
    getId: (cellId, _c, ctx) => ctx.cells.biome[cellId],
    getName: biomeNameGetter,
    getColors: biomeColorsGetter,
    landOnly: false
  },
  markets: {
    label: "Market",
    getId: (cellId, _c, ctx) => ctx.cells.market[cellId],
    getName: marketNameGetter,
    getColors: marketColorsGetter,
    landOnly: false
  },
  goods: {
    label: "Good",
    requires: "good",
    getId: (_cellId, contribution) => contribution.good!,
    getName: goodNameGetter,
    getColors: goodColorsGetter,
    landOnly: false
  }
};

export const quantizationMap: Record<string, Metric> = {
  total_population: {
    label: "Total population",
    quantize: (cellId, ctx) => getUrbanPopulation(cellId, ctx) + getRuralPopulation(cellId, ctx),
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  urban_population: {
    label: "Urban population",
    quantize: getUrbanPopulation,
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  rural_population: {
    label: "Rural population",
    quantize: getRuralPopulation,
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  area: {
    label: "Land area",
    quantize: (cellId, ctx) => ctx.units.getArea(Number(ctx.cells.area[cellId])),
    aggregate: values => rn(sum(values)),
    formatTicks: (value, ctx) => `${si(value)} ${ctx.units.getAreaUnit()}`,
    stringify: (value, ctx) => `${value.toLocaleString()} ${ctx.units.getAreaUnit()}`,
    stackable: true,
    landOnly: true
  },
  cells: {
    label: "Cells",
    hint: "Number of land cells",
    quantize: () => 1,
    aggregate: values => sum(values),
    formatTicks: value => value,
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  burgs_number: {
    label: "Burgs",
    hint: "Number of burgs",
    quantize: (cellId, ctx) => (ctx.cells.burg[cellId] ? 1 : 0),
    aggregate: values => sum(values),
    formatTicks: value => value,
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  average_elevation: {
    label: "Average elevation",
    quantize: (cellId, ctx) => Number(ctx.cells.h[cellId]),
    aggregate: values => mean(values)!,
    formatTicks: (value, ctx) => ctx.units.getHeight(value),
    stringify: (value, ctx) => ctx.units.getHeight(value),
    stackable: false,
    landOnly: false
  },
  max_elevation: {
    label: "Maximum mean elevation",
    quantize: (cellId, ctx) => Number(ctx.cells.h[cellId]),
    aggregate: values => max(values)!,
    formatTicks: (value, ctx) => ctx.units.getHeight(value),
    stringify: (value, ctx) => ctx.units.getHeight(value),
    stackable: false,
    landOnly: false
  },
  min_elevation: {
    label: "Minimum mean elevation",
    quantize: (cellId, ctx) => Number(ctx.cells.h[cellId]),
    aggregate: values => min(values)!,
    formatTicks: (value, ctx) => ctx.units.getHeight(value),
    stringify: (value, ctx) => ctx.units.getHeight(value),
    stackable: false,
    landOnly: false
  },
  average_temperature: {
    label: "Annual mean temperature",
    quantize: (cellId, ctx) => ctx.climate.temp[ctx.cells.g[cellId]],
    aggregate: values => mean(values)!,
    formatTicks: value => convertTemperature(value),
    stringify: value => convertTemperature(value),
    stackable: false,
    landOnly: false
  },
  max_temperature: {
    label: "Annual max temperature",
    hint: "Highest mean temperature of the year",
    quantize: (cellId, ctx) => ctx.climate.temp[ctx.cells.g[cellId]],
    aggregate: values => max(values)!,
    formatTicks: value => convertTemperature(value),
    stringify: value => convertTemperature(value),
    stackable: false,
    landOnly: false
  },
  min_temperature: {
    label: "Annual min temperature",
    hint: "Lowest mean temperature of the year",
    quantize: (cellId, ctx) => ctx.climate.temp[ctx.cells.g[cellId]],
    aggregate: values => min(values)!,
    formatTicks: value => convertTemperature(value),
    stringify: value => convertTemperature(value),
    stackable: false,
    landOnly: false
  },
  average_precipitation: {
    label: "Annual mean precipitation",
    quantize: (cellId, ctx) => ctx.climate.prec[ctx.cells.g[cellId]],
    aggregate: values => rn(mean(values)!),
    formatTicks: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stringify: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stackable: false,
    landOnly: true
  },
  max_precipitation: {
    label: "Annual max precipitation",
    hint: "Highest mean precipitation of the year",
    quantize: (cellId, ctx) => ctx.climate.prec[ctx.cells.g[cellId]],
    aggregate: values => rn(max(values)!),
    formatTicks: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stringify: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stackable: false,
    landOnly: true
  },
  min_precipitation: {
    label: "Annual min precipitation",
    hint: "Lowest mean precipitation of the year",
    quantize: (cellId, ctx) => ctx.climate.prec[ctx.cells.g[cellId]],
    aggregate: values => rn(min(values)!),
    formatTicks: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stringify: (value, ctx) => ctx.units.getPrecipitation(rn(value)),
    stackable: false,
    landOnly: true
  },
  coastal_cells: {
    label: "Number of coastal cells",
    quantize: (cellId, ctx) => (ctx.cells.t[cellId] === 1 ? 1 : 0),
    aggregate: values => sum(values),
    formatTicks: value => value,
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  river_cells: {
    label: "Number of river cells",
    quantize: (cellId, ctx) => (ctx.cells.r[cellId] ? 1 : 0),
    aggregate: values => sum(values),
    formatTicks: value => value,
    stringify: value => value.toLocaleString(),
    stackable: true,
    landOnly: true
  },
  production_value: {
    label: "Production value",
    hint: "Worth of produced goods",
    provides: ["good"],
    prepare: ctx => ({ biomeProduction: ctx.getBiomesProduction() }),
    getContributions: (cellId, { biomeProduction }, ctx) => {
      const produced = ctx.getCellGoodsProduction(cellId, biomeProduction);
      const contributions: Contribution[] = [];
      for (const [goodId, units] of Object.entries(produced)) {
        const good = ctx.getGoodById(+goodId);
        if (good) contributions.push({ good: +goodId, value: units * good.value });
      }
      return contributions;
    },
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => formatPrice(value),
    stackable: true,
    landOnly: true
  },
  production_units: {
    label: "Production volume",
    hint: "Units of goods produced",
    provides: ["good"],
    prepare: ctx => ({ biomeProduction: ctx.getBiomesProduction() }),
    getContributions: (cellId, { biomeProduction }, ctx) => {
      const produced = ctx.getCellGoodsProduction(cellId, biomeProduction);
      const contributions: Contribution[] = [];
      for (const [goodId, units] of Object.entries(produced)) contributions.push({ good: +goodId, value: units });
      return contributions;
    },
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => `${value.toLocaleString()} units`,
    stackable: true,
    landOnly: true
  },
  burgs_profit: {
    label: "Burgs profit",
    hint: "Burgs profit from trade and manufacturing",
    quantize: (cellId, ctx) => {
      const burgId = ctx.cells.burg[cellId];
      return burgId ? ctx.burgs[burgId]?.product || 0 : 0;
    },
    aggregate: values => rn(sum(values)),
    formatTicks: value => si(value),
    stringify: value => formatPrice(value),
    stackable: true,
    landOnly: true
  }
};

export const plotTypeMap: Record<
  string,
  { offset: typeof stackOffsetDiverging; formatX?: (value: number) => string | number }
> = {
  stackedBar: { offset: stackOffsetDiverging },
  normalizedStackedBar: { offset: stackOffsetExpand, formatX: value => `${rn(value * 100)}%` }
};

// ---------------------------------------------------------------------------
// Validation, aggregation, sorting, geometry — all pure
// ---------------------------------------------------------------------------

export type ChartRequestValidation = { ok: true; groupBy: string; warning?: string } | { ok: false; error: string };

/**
 * Validate a chart request exactly as the legacy Plot handler did: a dimension
 * that requires a contribution tag the metric does not provide is an error (no
 * chart); grouping a non-stackable metric is a warning and the grouping is
 * dropped (groupBy forced to the entity).
 */
export function validateChartRequest(entity: string, plotBy: string, groupBy: string): ChartRequestValidation {
  const { label: plotByLabel, stackable, provides = [] } = quantizationMap[plotBy];

  // some dimensions need a contribution tag the metric must provide (e.g. goods
  // need a per-good metric); reject the chart when it is not possible
  const lacksTag = (dimension: string) => {
    const required = entitiesMap[dimension].requires;
    return required ? !provides.includes(required) : false;
  };
  const incompatible = [entity, groupBy].find(lacksTag);
  if (incompatible) {
    return {
      ok: false,
      error: `${plotByLabel} cannot be broken down by ${entitiesMap[incompatible].label.toLowerCase()}`
    };
  }

  if (!stackable && groupBy !== entity) {
    return { ok: true, groupBy: entity, warning: `Grouping is not supported for ${plotBy}` };
  }

  return { ok: true, groupBy };
}

/** One computed chart: the sorted data plus everything its figure renders from. */
export interface ComputedChart {
  title: string;
  data: ChartDatum[];
  colors: Record<string, string>;
  noGrouping: boolean;
  entityLabel: string;
  groupLabel: string;
  plotByLabel: string;
}

/**
 * The legacy per-chart data pipeline: a metric turns each cell into one or more
 * {value, ...tags} contributions (scalar metrics emit a single untagged value),
 * each dimension reads its bucket id off the cell or the contribution, buckets
 * are aggregated with the metric's aggregation, and the result is sorted.
 */
export function computeChartData(options: ChartOptions, ctx: ChartsSnapshot): ComputedChart {
  const { entity, plotBy, groupBy, sorting, excludeNeutral } = options;
  const {
    label: plotByLabel,
    quantize,
    getContributions,
    prepare,
    aggregate,
    landOnly: plotByLandOnly
  } = quantizationMap[plotBy];

  const noGrouping = groupBy === entity;

  const {
    label: entityLabel,
    getName: getEntityName,
    getId: getEntityId,
    landOnly: entityLandOnly
  } = entitiesMap[entity];
  const { label: groupLabel, getName: getGroupName, getId: getGroupId, getColors } = entitiesMap[groupBy];

  const prodCtx = prepare ? prepare(ctx) : undefined;
  const contributionsOf: (cellId: number) => Contribution[] = getContributions
    ? cellId => getContributions(cellId, prodCtx!, ctx)
    : cellId => [{ value: quantize!(cellId, ctx) }];

  const title = `${capitalize(entity)} by ${plotByLabel}${noGrouping ? "" : ` grouped by ${groupLabel}`}`;

  const dataCollection: Record<number, Record<number, number[]>> = {};

  for (const cellId of ctx.cells.i) {
    // isWater: below sea level (h < 20)
    if ((entityLandOnly || plotByLandOnly) && ctx.cells.h[cellId] < 20) continue;

    for (const contribution of contributionsOf(cellId)) {
      const entityId = getEntityId(cellId, contribution, ctx);
      const groupId = getGroupId(cellId, contribution, ctx);

      // id 0 is the neutral placeholder; skip it when requested
      if (excludeNeutral && (entityId === 0 || groupId === 0)) continue;

      const { value } = contribution;

      if (!dataCollection[entityId]) dataCollection[entityId] = { [groupId]: [value] };
      else if (!dataCollection[entityId][groupId]) dataCollection[entityId][groupId] = [value];
      else dataCollection[entityId][groupId].push(value);
    }
  }

  const chartData: ChartDatum[] = Object.entries(dataCollection).flatMap(([entityId, groupData]) => {
    const name = getEntityName(entityId, ctx);
    return Object.entries(groupData).map(([groupId, values]): ChartDatum => {
      const group = getGroupName(groupId, ctx);
      const value = aggregate(values);
      return { name, group, value };
    });
  });

  const data = sortData(chartData, sorting);
  return { title, data, colors: getColors(ctx), noGrouping, entityLabel, groupLabel, plotByLabel };
}

export function sortData(data: ChartDatum[], sorting: string): ChartDatum[] {
  if (sorting === "natural") return data;

  if (sorting === "name") {
    return data.sort((a, b) => {
      if (a.name !== b.name) return b.name.localeCompare(a.name); // reversed as 1st element is the bottom
      return a.group.localeCompare(b.group);
    });
  }

  if (sorting === "value") {
    const entitySum: Record<string, number> = {};
    const groupSum: Record<string, number> = {};
    for (const { name, group, value } of data) {
      entitySum[name] = (entitySum[name] || 0) + value;
      groupSum[group] = (groupSum[group] || 0) + value;
    }

    return data.sort((a, b) => {
      if (a.name !== b.name) return entitySum[a.name] - entitySum[b.name]; // reversed as 1st element is the bottom
      return groupSum[b.group] - groupSum[a.group];
    });
  }

  return data;
}

// chart geometry config (legacy constants)
export const WIDTH = 800;
export const Y_PADDING = 0.2;
export const LABEL_GAP = 10;
const RESERVED_PX_PER_CHAR = 7;
const BAR_STEP = 25;
const LEGEND_ROW_HEIGHT = 20;

export function getTextMinWidth(entities: string[]): number {
  if (!entities.length) return 0;
  return max(entities.map(name => name.length))! * RESERVED_PX_PER_CHAR;
}

export function calculateLegendRows(groups: string[], availableWidth: number): number {
  if (!groups.length) return 0;
  const minWidth = LABEL_GAP + getTextMinWidth(groups);
  const maxInRow = Math.max(1, Math.floor(availableWidth / minWidth));
  return Math.ceil(groups.length / maxInRow);
}

/** The svg frame a chart's data implies: unique entities/groups, margins, height. */
export interface ChartGeometry {
  entities: string[];
  groups: string[];
  legendRows: number;
  margin: { top: number; right: number; bottom: number; left: number };
  height: number;
}

export function computeChartGeometry(sortedData: ChartDatum[]): ChartGeometry {
  const entities = [...new Set(sortedData.map(d => d.name))];
  const groups = [...new Set(sortedData.map(d => d.group))];

  const yScaleMinWidth = getTextMinWidth(entities);
  const legendRows = calculateLegendRows(groups, WIDTH - yScaleMinWidth - 15);

  const margin = { top: 30, right: 15, bottom: legendRows * LEGEND_ROW_HEIGHT + 10, left: yScaleMinWidth };
  const height = entities.length * BAR_STEP + margin.top + margin.bottom;

  return { entities, groups, legendRows, margin, height };
}

// ---------------------------------------------------------------------------
// The preserved trigger seam
// ---------------------------------------------------------------------------

/**
 * open — the preserved trigger seam for the Data Charts surface.
 *
 * The signature is unchanged from the legacy jQuery-UI version so its callers —
 * the tools menu's `overviewChartsButton` and the Shift+A hotkey — keep calling
 * `open()` untouched. The body keeps the legacy open side-effect (close other
 * legacy stable dialogs) and dispatches into the App shell, which mounts the
 * React <ChartsOverview> surface. All world reads happen inside the surface
 * through the World-State accessor.
 */
export function open(): void {
  closeDialogs(".stable");
  openSurface("charts-overview", { anchor: "svg" });
}
