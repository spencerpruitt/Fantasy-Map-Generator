import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { State } from "@/generators/states-generator";
import { notifyWorldChanged } from "../world-state";
import { MilitaryOverview } from "./MilitaryOverview";

// The regiments-list actions and the options cog dynamically import their
// controllers via the lazy seam; mock it so the component test does not pull in
// the real controllers (which touch legacy dialogs).
const openRegiments = vi.fn();
const openOptions = vi.fn();
vi.mock("@/lazy-loaders", () => ({
  lazy: {
    regimentsOverview: () => Promise.resolve({ RegimentsOverview: { open: openRegiments } }),
    militaryOverview: () => Promise.resolve({ MilitaryOverview: { openOptions } })
  }
}));

const globalScope = globalThis as Record<string, unknown>;

// Three states — two with regiments, one without — pinning the per-unit force
// sums, the crew-weighted totals, the population/rate math, the percentage
// toggle, sorting, the CSV bytes, and the editable war alert.
let redState: State;
let blueState: State;

function makeStates(): { red: State; blue: State; quiet: State } {
  const red = {
    i: 1,
    name: "Redland",
    fullName: "Kingdom of Redland",
    color: "#dd0000",
    rural: 1000,
    urban: 200,
    alert: 1,
    military: [
      { i: 0, a: 100, name: "Alpha", u: { infantry: 80, cavalry: 20 }, n: 0, icon: "🛡️" },
      { i: 1, a: 50, name: "Bravo", u: { infantry: 50 }, n: 0, icon: "🛡️" }
    ]
  } as unknown as State;
  const blue = {
    i: 2,
    name: "Bluemark",
    fullName: "Duchy of Bluemark",
    color: "#0000dd",
    rural: 500,
    urban: 0,
    alert: 2,
    military: [{ i: 0, a: 300, name: "Charlie", u: { infantry: 300 }, n: 0, icon: "🛡️" }]
  } as unknown as State;
  const quiet = {
    i: 3,
    name: "Quietia",
    fullName: "Barony of Quietia",
    color: "#00dd00",
    rural: 100,
    urban: 0,
    alert: 0.5,
    military: []
  } as unknown as State;
  return { red, blue, quiet };
}

// The #armies / #regions / #debug SVG structure the hover highlight and the
// war-alert icon-text side-effects touch.
let svgRoot: SVGSVGElement;
let debugGroup: SVGGElement;

function addArmyGroup(stateId: number, regimentId: number, total: number): void {
  const armies = svgRoot.querySelector<SVGGElement>("#armies")!;
  let army = armies.querySelector<SVGGElement>(`#army${stateId}`);
  if (!army) {
    army = document.createElementNS("http://www.w3.org/2000/svg", "g");
    army.id = `army${stateId}`;
    armies.appendChild(army);
  }
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.id = `regiment${stateId}-${regimentId}`;
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.textContent = String(total);
  group.appendChild(text);
  army.appendChild(group);
}

beforeEach(() => {
  const { red, blue, quiet } = makeStates();
  redState = red;
  blueState = blue;
  globalScope.pack = { states: [{ i: 0, name: "Neutrals" }, red, blue, quiet] };
  globalScope.options = {
    military: [
      { name: "infantry", crew: 1 },
      { name: "cavalry", crew: 2 }
    ]
  };
  globalScope.populationRate = 2;
  globalScope.urbanization = 0.5;
  globalScope.customization = 0;
  globalScope.tip = vi.fn();
  globalScope.layerIsOn = vi.fn(() => true);
  globalScope.Military = { getTotal: (regiment: { a: number }) => regiment.a };

  svgRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const id of ["armies", "regions", "debug"]) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.id = id;
    svgRoot.appendChild(group);
  }
  debugGroup = svgRoot.querySelector<SVGGElement>("#debug")!;
  const statePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  statePath.id = "state2";
  statePath.setAttribute("d", "M0,0L10,0L10,10Z");
  svgRoot.querySelector("#regions")!.appendChild(statePath);
  document.body.appendChild(svgRoot);
  addArmyGroup(1, 0, 100);
  addArmyGroup(1, 1, 50);
  addArmyGroup(2, 0, 300);

  openRegiments.mockClear();
  openOptions.mockClear();
});

afterEach(() => {
  svgRoot.remove();
  globalScope.pack = undefined;
  globalScope.options = undefined;
  globalScope.populationRate = undefined;
  globalScope.urbanization = undefined;
  globalScope.customization = undefined;
  globalScope.tip = undefined;
  globalScope.layerIsOn = undefined;
  globalScope.Military = undefined;
  globalScope.confirmationDialog = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
});

function rowStates(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".states")).map(row => row.getAttribute("data-state"));
}

function rowByState(container: HTMLElement, name: string): HTMLElement {
  return container.querySelector(`[data-state="${name}"]`) as HTMLElement;
}

function cellText(row: HTMLElement, type: string): string | undefined {
  return row.querySelector(`[data-type="${type}"]`)?.textContent ?? undefined;
}

describe("<MilitaryOverview>", () => {
  it("renders one row per valid state sorted by total descending (legacy default), with dynamic unit columns", () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);

    // Totals are crew-weighted: Redland 130*1 + 20*2 = 170; Bluemark 300; Quietia 0.
    expect(rowStates(container)).toEqual(["Bluemark", "Redland", "Quietia"]);

    const redRow = rowByState(container, "Redland");
    expect(cellText(redRow, "infantry")).toBe("130");
    expect(cellText(redRow, "cavalry")).toBe("20");
    expect(cellText(redRow, "total")).toBe("170");
    expect(cellText(redRow, "population")).toBe("2.2K");
    expect(cellText(redRow, "rate")).toBe("7.73%");
    expect((redRow.querySelector('input[type="number"]') as HTMLInputElement).value).toBe("1");

    // The header grows one sortable column per configured unit.
    expect(container.querySelector('[data-sortby="infantry"]')?.textContent).toContain("Infantry");
    expect(container.querySelector('[data-sortby="cavalry"]')?.textContent).toContain("Cavalry");
  });

  it("shows the footer summary line (states, totals, averages)", () => {
    render(<MilitaryOverview onClose={() => {}} />);
    const footer = document.querySelector(".totalLine") as HTMLElement;
    expect(footer.textContent).toContain("States: 3");
    expect(footer.textContent).toContain("Total forces: 470");
    expect(footer.textContent).toContain("Average forces: 157");
    // rn((7.7273 + 30 + 0) / 3, 2) = 12.58; rn((1 + 2 + 0.5) / 3, 2) = 1.17.
    expect(footer.textContent).toContain("Average rate: 12.58%");
    expect(footer.textContent).toContain("Average alert: 1.17");
  });

  it("sorts alphabetically by state and numerically by unit/rate/alert columns", () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);

    // A fresh alphabetical column starts ascending, then toggles.
    fireEvent.click(container.querySelector('[data-sortby="state"]') as HTMLElement);
    expect(rowStates(container)).toEqual(["Bluemark", "Quietia", "Redland"]);
    fireEvent.click(container.querySelector('[data-sortby="state"]') as HTMLElement);
    expect(rowStates(container)).toEqual(["Redland", "Quietia", "Bluemark"]);

    // A fresh numeric column starts descending; ties keep pack order (the sort
    // derives from the accessor rows each time, like the other overviews).
    fireEvent.click(container.querySelector('[data-sortby="cavalry"]') as HTMLElement);
    expect(rowStates(container)).toEqual(["Redland", "Bluemark", "Quietia"]);
    fireEvent.click(container.querySelector('[data-sortby="alert"]') as HTMLElement);
    expect(rowStates(container)).toEqual(["Bluemark", "Redland", "Quietia"]);
    fireEvent.click(container.querySelector('[data-sortby="rate"]') as HTMLElement);
    expect(rowStates(container)).toEqual(["Bluemark", "Redland", "Quietia"]);
  });

  it("toggles percentage mode: units, total, and population become column shares; rate stays", () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);
    const toggle = screen.getByLabelText("Toggle percentage / absolute values views");

    fireEvent.click(toggle);
    const blueRow = rowByState(container, "Bluemark");
    // infantry 300 of 430 → 70%; cavalry 0 of 20 → 0%; total 300 of 470 → 64%;
    // population 1000 of 3400 → 29%; rate is untouched (legacy skipped it).
    expect(cellText(blueRow, "infantry")).toBe("70%");
    expect(cellText(blueRow, "cavalry")).toBe("0%");
    expect(cellText(blueRow, "total")).toBe("64%");
    expect(cellText(blueRow, "population")).toBe("29%");
    expect(cellText(blueRow, "rate")).toBe("30%");
    expect((container.querySelector(".table") as HTMLElement).dataset.type).toBe("percentage");
    // The footer keeps its absolute sums.
    expect((document.querySelector(".totalLine") as HTMLElement).textContent).toContain("Total forces: 470");

    fireEvent.click(toggle);
    expect(cellText(blueRow, "infantry")).toBe("300");
    expect((container.querySelector(".table") as HTMLElement).dataset.type).toBe("absolute");
  });

  it("commits a war-alert change: scales the state's forces, updates army icon texts, and re-reads", () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);
    const redRow = rowByState(container, "Redland");
    const alertInput = redRow.querySelector('input[type="number"]') as HTMLInputElement;

    act(() => {
      fireEvent.change(alertInput, { target: { value: "2" } });
    });

    // Data: every Redland regiment scaled by 2/1 and totals recomputed.
    expect(redState.military?.[0].u).toEqual({ infantry: 160, cavalry: 40 });
    expect(redState.military?.[0].a).toBe(200);
    expect(redState.military?.[1].a).toBe(100);
    // Renderer side-effect: the #armies regiment texts show the new totals.
    expect(document.querySelector("#regiment1-0 > text")?.textContent).toBe("200");
    expect(document.querySelector("#regiment1-1 > text")?.textContent).toBe("100");
    // The surface re-read: forces, total, and rate update in the row.
    const updatedRow = rowByState(container, "Redland");
    expect(cellText(updatedRow, "infantry")).toBe("260");
    expect(cellText(updatedRow, "total")).toBe("340");
    expect(cellText(updatedRow, "rate")).toBe("15.45%");
  });

  it("hover highlights a state's armies and region outline, and clears on leave", async () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);
    const blueRow = rowByState(container, "Bluemark");

    fireEvent.mouseEnter(blueRow);
    const highlight = debugGroup.querySelector("path.highlight");
    expect(highlight).not.toBeNull();
    expect(highlight?.getAttribute("d")).toBe("M0,0L10,0L10,10Z");
    expect(highlight?.getAttribute("stroke")).toBe("red");

    fireEvent.mouseLeave(blueRow);
    // The off-transition fades and removes the outline (1s legacy duration).
    await waitFor(() => expect(debugGroup.querySelector("path.highlight")).toBeNull(), { timeout: 4000 });
  });

  it("does not highlight while customization is active, and skips the outline when the states layer is off", () => {
    globalScope.customization = 1;
    const { container, unmount } = render(<MilitaryOverview onClose={() => {}} />);
    fireEvent.mouseEnter(rowByState(container, "Bluemark"));
    expect(debugGroup.querySelector("path.highlight")).toBeNull();
    unmount();

    globalScope.customization = 0;
    globalScope.layerIsOn = vi.fn(() => false);
    const second = render(<MilitaryOverview onClose={() => {}} />);
    fireEvent.mouseEnter(rowByState(second.container, "Bluemark"));
    expect(debugGroup.querySelector("path.highlight")).toBeNull();
  });

  it("cleans up an in-flight hover highlight on unmount", () => {
    const { container, unmount } = render(<MilitaryOverview onClose={() => {}} />);
    fireEvent.mouseEnter(rowByState(container, "Bluemark"));
    expect(debugGroup.querySelector("path.highlight")).not.toBeNull();

    unmount();
    expect(debugGroup.querySelector("path.highlight")).toBeNull();
    const army = document.querySelector<SVGGElement>("#army2");
    expect(army?.style.fill).toBe("");
  });

  it("opens the regiments overview for a row's state and for all states from the footer button", async () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);

    fireEvent.click(
      rowByState(container, "Redland").querySelector('[aria-label="Show regiments list"]') as HTMLElement
    );
    await waitFor(() => expect(openRegiments).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByLabelText("Open regiments overview"));
    await waitFor(() => expect(openRegiments).toHaveBeenCalledWith(-1));
  });

  it("opens the military options editor from the cog", async () => {
    render(<MilitaryOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Edit military units"));
    await waitFor(() => expect(openOptions).toHaveBeenCalled());
  });

  it("recalculates forces through the domain core after confirmation and re-reads", () => {
    globalScope.confirmationDialog = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    const generate = vi.fn(() => {
      blueState.military = [];
      blueState.alert = 5;
    });
    (globalScope.Military as Record<string, unknown>).generate = generate;
    const { container } = render(<MilitaryOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Recalculate military forces"));

    expect(generate).toHaveBeenCalledTimes(1);
    // The surface re-read the regenerated world.
    const blueRow = rowByState(container, "Bluemark");
    expect(cellText(blueRow, "infantry")).toBe("0");
    expect((blueRow.querySelector('input[type="number"]') as HTMLInputElement).value).toBe("5");
  });

  it("exports the table as CSV in the exact legacy format, in the current sort order", () => {
    const download = vi.fn();
    globalScope.downloadFile = download;
    globalScope.getFileName = (name?: string) => name ?? "";
    render(<MilitaryOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Export as CSV"));

    const expectedCsv =
      "Id,State,Infantry,Cavalry,Total,Population,Rate,War Alert\n" +
      "2,Bluemark,300,0,300,1000,30%,2\n" +
      "1,Redland,130,20,170,2200,7.73%,1\n" +
      "3,Quietia,0,0,0,200,0%,0.5\n";
    expect(download).toHaveBeenCalledWith(expectedCsv, "Military.csv");
  });

  it("re-reads when the world changes underneath it (reactivity)", () => {
    const { container } = render(<MilitaryOverview onClose={() => {}} />);
    expect(cellText(rowByState(container, "Quietia"), "infantry")).toBe("0");

    act(() => {
      redState.military?.push({ i: 2, a: 10, name: "Delta", u: { cavalry: 10 }, n: 0, icon: "🛡️" } as never);
      notifyWorldChanged();
    });

    expect(cellText(rowByState(container, "Redland"), "cavalry")).toBe("30");
  });

  it("renders an empty table when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    globalScope.options = undefined;
    const { container } = render(<MilitaryOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(0);
    const footer = document.querySelector(".totalLine") as HTMLElement;
    expect(footer.textContent).toContain("States: 0");
    expect(footer.textContent).toContain("Average rate: 0%");
  });
});
