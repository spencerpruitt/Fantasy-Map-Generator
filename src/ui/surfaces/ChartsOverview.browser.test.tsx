import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWorldChanged } from "../world-state";
import { ChartsOverview, resetChartsOverviewPersistence } from "./ChartsOverview";

const globalScope = globalThis as Record<string, unknown>;

/**
 * The same tiny deterministic world as the controller node tests, stubbed onto
 * the window.X bridge: 4 land cells + 1 water cell, two real states, a neutral
 * zero-population area, a burg with production, two markets, a marine biome.
 *
 * Default chart (states by total_population grouped by cultures, sorted by
 * value): Aland/Alpha 100, Aland/Beta 300, Bland/Beta 300, Neutrals/Wildlands 0
 * → 3 visible bars (the zero-width Neutrals segment is dropped).
 */
function stubWorld(): void {
  const goods = [
    { i: 7, name: "Grain", value: 2, color: "#dd0" },
    { i: 9, name: "Ore", value: 5, color: "#999" }
  ];
  const burgs: unknown[] = [0];
  burgs[1] = { i: 1, name: "Burgton", population: 5, product: 12 };
  globalScope.pack = {
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
    burgs,
    states: [
      { i: 0, name: "Neutrals" },
      { i: 1, name: "Aland", color: "#a00" },
      { i: 2, name: "Bland", color: "#0a0" }
    ],
    cultures: [{ name: "Wildlands" }, { name: "Alpha", color: "#111" }, { name: "Beta", color: "#222" }],
    religions: [{ name: "No religion" }, { name: "Faith", color: "#333" }, { name: "Creed", color: "#444" }],
    provinces: [0, { name: "Coastal", color: "#555" }],
    markets: [
      { i: 1, centerBurgId: 1, color: "#f0f" },
      { i: 2, centerBurgId: 9, color: "#0ff" }
    ],
    goods
  };
  globalScope.grid = { cells: { temp: [10, 20, 30, 0, -5], prec: [5, 15, 25, 35, 45] } };
  globalScope.biomesData = { i: [0, 1, 2], name: ["Marine", "Forest", "Desert"], color: ["#00f", "#0f0", "#ff0"] };
  globalScope.populationRate = 10;
  globalScope.urbanization = 2;
  globalScope.Goods = {
    get: (id: number) => goods.find(good => good.i === id),
    getBiomesProduction: () => ({ 1: [{ goodId: 7, production: 0.5 }] })
  };
  globalScope.Production = {
    getCellProduction: (cellId: number): Record<number, number> => {
      if (cellId === 0) return { 7: 2 };
      if (cellId === 1) return { 7: 4 };
      return {};
    },
    getBurgProduction: (): Record<number, number> => ({ 9: 1 })
  };
  // Host display-unit globals (utils/index.ts attaches DOM-reading versions; the
  // options pane elements they read do not exist under the test runner).
  globalScope.getHeight = (height: number) => `${height}m`;
  globalScope.getArea = (rawArea: number) => rawArea * 2;
  globalScope.getAreaUnit = () => "mi²";
  globalScope.getPrecipitation = (prec: number) => `${prec}mm`;
}

let mapIdCounter = 100;

beforeEach(() => {
  stubWorld();
  globalScope.mapId = mapIdCounter++;
  globalScope.tip = vi.fn();
  resetChartsOverviewPersistence();
});

afterEach(() => {
  for (const key of [
    "pack",
    "grid",
    "biomesData",
    "populationRate",
    "urbanization",
    "Goods",
    "Production",
    "mapId",
    "tip",
    "downloadFile",
    "getFileName",
    "getHeight",
    "getArea",
    "getAreaUnit",
    "getPrecipitation"
  ]) {
    globalScope[key] = undefined;
  }
});

function renderCharts() {
  return render(<ChartsOverview onClose={() => {}} />);
}

function figures(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("figure")] as HTMLElement[];
}

/** The chart's bar rects (each carries a native <title> tooltip; legend swatches do not). */
function bars(figure: HTMLElement): SVGRectElement[] {
  return [...figure.querySelectorAll("rect")].filter(rect => rect.querySelector("title")) as SVGRectElement[];
}

function selectValue(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function plot(): void {
  fireEvent.click(screen.getByRole("button", { name: "Plot" }));
}

describe("<ChartsOverview>", () => {
  it("opens with a default chart: states by total population grouped by culture, bars + axes + legend", () => {
    const { container } = renderCharts();

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Data Charts");

    const [figure] = figures(container);
    expect(figure).toBeTruthy();
    expect(figure.textContent).toContain("Figure 1");
    expect(figure.textContent).toContain("States by Total population grouped by Culture");

    // 3 bars: Aland/Alpha 100, Aland/Beta 300, Bland/Beta 300 (Neutrals is a zero-width segment).
    expect(bars(figure).length).toBe(3);
    const svg = figure.querySelector("svg")!;
    // y axis names every entity, including the zero-population Neutrals.
    expect(svg.textContent).toContain("Aland");
    expect(svg.textContent).toContain("Neutrals");
    // The legend names the grouping dimension's buckets.
    expect(svg.textContent).toContain("Alpha");
    expect(svg.textContent).toContain("Beta");
    // Series are colored by the grouping dimension.
    expect(svg.querySelector('g[fill="#111"]')).toBeTruthy();
  });

  it("plots a new chart for a switched dimension", () => {
    const { container } = renderCharts();

    selectValue("Select entity (y axis)", "cultures");
    plot();

    const all = figures(container);
    expect(all.length).toBe(2);
    // groupBy is already cultures → no grouping suffix.
    expect(all[1].textContent).toContain("Figure 2");
    expect(all[1].textContent).toContain("Cultures by Total population");
    expect(all[1].querySelector("svg")!.textContent).toContain("Beta");
    expect(bars(all[1]).length).toBeGreaterThan(0);
  });

  it("plots a new chart for a switched metric and shows the metric hint icon", () => {
    const { container } = renderCharts();

    // total_population has no hint → no info icon.
    expect(container.querySelector(".icon-info-circled")).toBeNull();

    selectValue("Select metric to plot (x axis)", "burgs_number");
    expect(container.querySelector(".icon-info-circled")?.getAttribute("data-tip")).toBe("Number of burgs");

    plot();
    const all = figures(container);
    expect(all.length).toBe(2);
    expect(all[1].textContent).toContain("States by Burgs grouped by Culture");
  });

  it("renders normalized (%) x-axis ticks for the normalized bar type", () => {
    const { container } = renderCharts();

    selectValue("Select chart type", "normalizedStackedBar");
    plot();

    const all = figures(container);
    const ticks = [...all[1].querySelectorAll("g text")].map(text => text.textContent);
    expect(ticks.some(tick => tick?.includes("%"))).toBe(true);
  });

  it("shows a tooltip on bar hover (native title + shared tip)", () => {
    const { container } = renderCharts();
    const [figure] = figures(container);
    const [firstBar] = bars(figure);

    const title = firstBar.querySelector("title")!.textContent!;
    expect(title).toContain("State: ");
    expect(title).toContain("Culture: ");
    expect(title).toContain("Total population: ");
    expect(title).toMatch(/\(\d+%\)/);

    fireEvent.mouseOver(firstBar);
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;
    const lastTip = tipMock.mock.calls.at(-1)![0] as string;
    expect(lastTip).toContain("State: ");
    expect(lastTip).toContain("Total population: ");
  });

  it("rejects an impossible dimension×metric with the legacy error tip and no chart", () => {
    const { container } = renderCharts();

    selectValue("Select entity (y axis)", "goods");
    plot();

    expect(figures(container).length).toBe(1);
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;
    expect(tipMock).toHaveBeenCalledWith("Total population cannot be broken down by good", false, "error", 4000);
  });

  it("drops grouping for a non-stackable metric with the legacy warning", () => {
    const { container } = renderCharts();

    selectValue("Select metric to plot (x axis)", "average_elevation");
    plot();

    const all = figures(container);
    expect(all.length).toBe(2);
    expect(all[1].textContent).toContain("States by Average elevation");
    expect(all[1].textContent).not.toContain("grouped by");
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;
    expect(tipMock).toHaveBeenCalledWith("Grouping is not supported for average_elevation", false, "warn", 4000);
  });

  it("excludes the neutral bucket when requested", () => {
    const { container } = renderCharts();

    fireEvent.click(screen.getByLabelText("Exclude neutral"));
    plot();

    const all = figures(container);
    const svg = all[1].querySelector("svg")!;
    expect(svg.textContent).toContain("Aland");
    expect(svg.textContent).not.toContain("Neutrals");
    expect(svg.textContent).not.toContain("Wildlands");
  });

  it("removes a chart via its trash button", () => {
    const { container } = renderCharts();
    plot(); // a second chart
    expect(figures(container).length).toBe(2);

    fireEvent.click(figures(container)[0].querySelector("button.icon-trash")!);

    const remaining = figures(container);
    expect(remaining.length).toBe(1);
    // The remaining figure renumbers to Figure 1 (matching a legacy re-open).
    expect(remaining[0].textContent).toContain("Figure 1");
  });

  it("downloads the chart data as CSV in legacy row order", () => {
    const downloadFile = vi.fn();
    globalScope.downloadFile = downloadFile;
    globalScope.getFileName = (name: string) => `file ${name}`;

    const { container } = renderCharts();
    fireEvent.click(figures(container)[0].querySelector("button.icon-download")!);

    expect(downloadFile).toHaveBeenCalledWith(
      "Name,Group,Value\nNeutrals,Wildlands,0\nBland,Beta,300\nAland,Beta,300\nAland,Alpha,100",
      "file States by Total population grouped by Culture.csv"
    );
  });

  it("downloads the chart as SVG markup", () => {
    const downloadFile = vi.fn();
    globalScope.downloadFile = downloadFile;
    globalScope.getFileName = (name: string) => `file ${name}`;

    const { container } = renderCharts();
    fireEvent.click(figures(container)[0].querySelector("button.icon-chart-bar")!);

    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [svgMarkup, fileName] = downloadFile.mock.calls[0];
    expect(fileName).toBe("file States by Total population grouped by Culture.svg");
    expect(svgMarkup).toContain("<svg");
    expect(svgMarkup).toContain('viewBox="0 0 800');
    expect(svgMarkup).toContain("Aland");
  });

  it("re-aggregates every plotted chart on world change", () => {
    const { container } = renderCharts();
    const pack = globalScope.pack as { states: { name: string }[]; cells: { pop: number[] } };

    pack.states[1].name = "Renamed";
    pack.cells.pop[2] = 60; // Bland's rural population trebles
    act(() => notifyWorldChanged());

    const svg = figures(container)[0].querySelector("svg")!;
    expect(svg.textContent).toContain("Renamed");
    expect(svg.textContent).not.toContain("Aland");
    const titles = bars(figures(container)[0]).map(bar => bar.querySelector("title")!.textContent!);
    expect(titles.some(title => title.includes("Bland") && title.includes("600"))).toBe(true);
  });

  it("lays the charts out in the selected number of columns", () => {
    const { container } = renderCharts();
    const section = container.querySelector("section")!;
    expect(section.style.gridTemplateColumns).toBe("repeat(1, 1fr)");

    selectValue("Columns", "3");
    expect(section.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
  });

  it("persists plotted charts across close/re-open and resets for a new map", () => {
    const first = renderCharts();
    plot(); // 2 charts now
    expect(figures(first.container).length).toBe(2);
    first.unmount();

    // Same map: the two charts are still there, and no extra default is plotted.
    const second = renderCharts();
    expect(figures(second.container).length).toBe(2);
    second.unmount();

    // A different map resets to a single fresh default chart.
    globalScope.mapId = mapIdCounter++;
    const third = renderCharts();
    expect(figures(third.container).length).toBe(1);
  });

  it("cleans up on unmount: the svg is emptied and the shared tip is reset", () => {
    const { container, unmount } = renderCharts();
    const svg = figures(container)[0].querySelector("svg")!;
    expect(svg.childNodes.length).toBeGreaterThan(0);

    unmount();

    expect(document.querySelector("figure")).toBeNull();
    expect(svg.childNodes.length).toBe(0);
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;
    expect(tipMock.mock.calls.at(-1)).toEqual([""]);
  });

  it("renders an empty state instead of a chart when no world is loaded", () => {
    globalScope.pack = undefined;
    const { container } = renderCharts();
    const [figure] = figures(container);
    expect(figure.textContent).toContain("No data to plot.");
    expect(figure.querySelector("svg")).toBeNull();
  });
});
