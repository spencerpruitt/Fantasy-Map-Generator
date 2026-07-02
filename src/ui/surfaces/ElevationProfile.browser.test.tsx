import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWorldChanged } from "../world-state";
import { ElevationProfile } from "./ElevationProfile";

const globalScope = globalThis as Record<string, unknown>;

// A 5-cell land route with two burgs (cells 1 and 3) — pinning the chart
// structure, the burg annotations, the biome band, the stats math, the curve
// re-render, the exports, and the hover tooltip.
const ROUTE_CELLS = [0, 1, 2, 3, 4];
const ROUTE_LEN = 100;

beforeEach(() => {
  const burgs: unknown[] = [];
  burgs[1] = { i: 1, name: "Alpha", x: 10, y: 20, population: 4 };
  burgs[2] = { i: 2, name: "Beta", x: 30, y: 40, population: 2 };
  globalScope.pack = {
    cells: {
      p: [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0]
      ],
      h: [30, 40, 35, 50, 45],
      f: [1, 1, 1, 1, 1],
      biome: [3, 3, 4, 4, 4],
      burg: [0, 1, 0, 2, 0],
      pop: [1, 2, 3, 4, 5],
      culture: [1, 1, 1, 1, 1],
      religion: [1, 1, 1, 1, 1],
      province: [0, 0, 1, 1, 1],
      state: [1, 1, 1, 1, 1]
    },
    features: [0, { i: 1, type: "island", height: 0 }],
    burgs,
    cultures: [
      { name: "Wildlands", color: "#110" },
      { name: "Cultura", color: "#220" }
    ],
    religions: [
      { name: "No religion", color: "#330" },
      { name: "Faith", color: "#440" }
    ],
    provinces: [0, { i: 1, name: "Provincia", color: "#550" }],
    states: [
      { i: 0, name: "Neutrals", color: "#660" },
      { i: 1, name: "Statia", color: "#770" }
    ]
  };
  globalScope.biomesData = {
    name: ["Marine", "", "", "Grassland", "Forest"],
    color: ["#001", "", "", "#003", "#004"]
  };
  // Display height = generator height × 10 (so mins/maxes and stats are easy math).
  globalScope.getHeight = (h: number) => `${h * 10}ft`;
  globalScope.getColorScheme = () => () => "rgb(10,20,30)";
  globalScope.getColor = () => "#123456";
  globalScope.heightUnit = { value: "ft" };
  globalScope.distanceUnitInput = { value: "mi" };
  globalScope.populationRate = 2;
  globalScope.urbanization = 1;
  globalScope.getLatitude = (y: number) => y + 0.5;
  globalScope.getLongitude = (x: number) => x + 0.25;
  globalScope.zoomTo = vi.fn();
  globalScope.tip = vi.fn();
  globalScope.downloadFile = vi.fn();
  globalScope.getFileName = (name?: string) => name ?? "";
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.biomesData = undefined;
  globalScope.getHeight = undefined;
  globalScope.getColorScheme = undefined;
  globalScope.getColor = undefined;
  globalScope.heightUnit = undefined;
  globalScope.distanceUnitInput = undefined;
  globalScope.populationRate = undefined;
  globalScope.urbanization = undefined;
  globalScope.getLatitude = undefined;
  globalScope.getLongitude = undefined;
  globalScope.zoomTo = undefined;
  globalScope.tip = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
});

function renderProfile(overrides: Partial<{ cells: number[]; routeLen: number; isRiver: boolean }> = {}) {
  return render(
    <ElevationProfile
      cells={overrides.cells ?? ROUTE_CELLS}
      routeLen={overrides.routeLen ?? ROUTE_LEN}
      isRiver={overrides.isRiver ?? false}
      onClose={() => {}}
    />
  );
}

describe("<ElevationProfile>", () => {
  it("renders the d3 chart structure: land fill, profile line, axes, biome band, burg annotations", () => {
    const { container } = renderProfile();

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Elevation profile");
    const svg = container.querySelector("#elevationSVG");
    expect(svg).toBeTruthy();

    // Land fill + profile line, both with real path data.
    expect(container.querySelector("#epland path")?.getAttribute("d")).toBeTruthy();
    expect(container.querySelector("#epline path")?.getAttribute("d")).toBeTruthy();

    // Axes with unit-labelled ticks.
    expect(container.querySelector("#epxaxis")?.textContent).toContain("mi");
    expect(container.querySelector("#epyaxis")?.textContent).toContain("ft");

    // One biome tile per cell, coloured by the cell's biome.
    const biomeTiles = container.querySelectorAll("#epbiomes rect");
    expect(biomeTiles.length).toBe(ROUTE_CELLS.length);
    expect(biomeTiles[0].getAttribute("fill")).toBe("#003");
    expect(biomeTiles[4].getAttribute("fill")).toBe("#004");
    // The tile tooltip carries the region names, height, and population.
    expect(biomeTiles[2].getAttribute("data-tip")).toBe(
      "Forest, Provincia, Statia, Faith, Cultura, height: 350 ft, population 6"
    );

    // The two burgs annotate the curve: labels and dots.
    const labels = Array.from(container.querySelectorAll(".epburglabel")).map(label => label.textContent);
    expect(labels).toEqual(["Alpha", "Beta"]);
    expect(container.querySelectorAll("#epburgdots circle").length).toBe(2);
  });

  it("renders the legacy stats line (min–max, ascent, descent)", () => {
    // Display heights are [300, 400, 350, 500, 450]: min 300, max 500,
    // ascent 100+150, descent 50+50.
    renderProfile();
    const stats = document.getElementById("epstats");
    expect(stats?.textContent).toBe("Elev: 300\u2013500 ft\u2002\u2191\u202f250\u2002\u2193\u202f100 ft");
  });

  it("smooths a river profile so it never flows uphill", () => {
    // Raw heights [50, 40, 45, 30, 20] slope downhill overall; the uphill bump at
    // index 2 is clamped to the previous height, so ascent is 0.
    (globalScope.pack as { cells: { h: number[] } }).cells.h = [50, 40, 45, 30, 20];
    renderProfile({ isRiver: true });
    const stats = document.getElementById("epstats");
    expect(stats?.textContent).toBe("Elev: 200\u2013500 ft\u2002\u2191\u202f0\u2002\u2193\u202f300 ft");
  });

  it("re-renders the profile path when the curve type changes, and persists the choice", () => {
    const { container, unmount } = renderProfile();
    const select = screen.getByLabelText("Set curve profile") as HTMLSelectElement;
    expect(select.value).toBe("3"); // Monotone X, the legacy default

    const monotonePath = container.querySelector("#epline path")?.getAttribute("d");
    fireEvent.change(select, { target: { value: "0" } }); // Linear
    const linearPath = container.querySelector("#epline path")?.getAttribute("d");
    expect(linearPath).toBeTruthy();
    expect(linearPath).not.toBe(monotonePath);

    // The choice persists across a close/re-open, like the legacy static select.
    unmount();
    renderProfile();
    expect((screen.getByLabelText("Set curve profile") as HTMLSelectElement).value).toBe("0");
    fireEvent.change(screen.getByLabelText("Set curve profile"), { target: { value: "3" } });
  });

  it("exports the CSV byte-identically to the legacy format", () => {
    renderProfile();
    fireEvent.click(screen.getByLabelText("Download the chart data as a CSV file"));

    const download = globalScope.downloadFile as ReturnType<typeof vi.fn>;
    const expected =
      "Id,x,y,lat,lon,Cell,Height,Height value,Population,Burg,Burg population,Biome,Biome color,Culture,Culture color,Religion,Religion color,Province,Province color,State,State color\n" +
      "1,0,0,0.5,0.25,0,300ft,30,2,,0,Grassland,#003,Cultura,#220,Faith,#440,,,Statia,#770\n" +
      "2,1,0,0.5,1.25,1,400ft,40,4,Alpha,8,Grassland,#003,Cultura,#220,Faith,#440,,,Statia,#770\n" +
      "3,2,0,0.5,2.25,2,350ft,35,6,,0,Forest,#004,Cultura,#220,Faith,#440,Provincia,#550,Statia,#770\n" +
      "4,3,0,0.5,3.25,3,500ft,50,8,Beta,4,Forest,#004,Cultura,#220,Faith,#440,Provincia,#550,Statia,#770\n" +
      "5,4,0,0.5,4.25,4,450ft,45,10,,0,Forest,#004,Cultura,#220,Faith,#440,Provincia,#550,Statia,#770";
    expect(download).toHaveBeenCalledWith(expected, "elevation profile.csv");
  });

  it("exports the chart as a structurally-complete SVG document", () => {
    renderProfile();
    fireEvent.click(screen.getByText("SVG"));

    const download = globalScope.downloadFile as ReturnType<typeof vi.fn>;
    expect(download).toHaveBeenCalledTimes(1);
    const [svgString, fileName] = download.mock.calls[0];
    expect(fileName).toBe("elevation profile.svg");
    expect(svgString.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<svg')).toBe(true);
    expect(svgString).toContain('id="elevationSVG"');
    expect(svgString).toContain('id="epline"');
    expect(svgString).toContain('id="epbiomes"');
  });

  it("zooms to a burg when its label is clicked", () => {
    const { container } = renderProfile();
    fireEvent.click(container.querySelector("#ep1") as SVGTextElement);
    expect(globalScope.zoomTo).toHaveBeenCalledWith(10, 20, 8, 2000);
  });

  it("re-reads the world and redraws when the world changes", () => {
    renderProfile();
    expect(document.getElementById("epstats")?.textContent).toBe(
      "Elev: 300\u2013500 ft\u2002\u2191\u202f250\u2002\u2193\u202f100 ft"
    );

    (globalScope.pack as { cells: { h: number[] } }).cells.h[0] = 60;
    act(() => notifyWorldChanged());

    // Display heights become [600, 400, 350, 500, 450]: min 350, max 600.
    expect(document.getElementById("epstats")?.textContent).toBe(
      "Elev: 350\u2013600 ft\u2002\u2191\u202f150\u2002\u2193\u202f300 ft"
    );
  });

  it("shows the crosshair tooltip on hover and clears it on unmount", () => {
    const { container, unmount } = renderProfile();
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;

    fireEvent.mouseMove(container.querySelector("#epoverlay") as SVGRectElement, { clientX: 0, clientY: 0 });
    const hoverTip = tipMock.mock.calls.at(-1)?.[0] as string;
    expect(hoverTip).toContain("mi from start");
    expect(hoverTip).toContain("Elevation:");

    unmount();
    expect(tipMock.mock.calls.at(-1)).toEqual([""]);
  });

  it("renders a fallback when the world cannot resolve the cells", () => {
    globalScope.pack = undefined;
    renderProfile();
    expect(screen.getByText("No elevation data available.")).toBeTruthy();
    expect(document.getElementById("elevationSVG")).toBeNull();
  });
});
