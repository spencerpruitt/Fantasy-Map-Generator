import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Regiment } from "@/generators/military-generator";
import type { State } from "@/generators/states-generator";
import { notifyWorldChanged } from "../world-state";
import { RegimentsOverview } from "./RegimentsOverview";

// The edit pencil dynamically imports the regiment editor via the lazy seam;
// mock it so the component test does not pull in the real (still-legacy) editor.
const editRegiment = vi.fn();
vi.mock("@/lazy-loaders", () => ({
  lazy: { regimentEditor: () => Promise.resolve({ RegimentEditor: { open: editRegiment } }) }
}));

const globalScope = globalThis as Record<string, unknown>;

// Two states with regiments (one regiment carries an image icon), one state
// without any — enough to pin the filter, the dynamic unit columns, the
// percentage math, the composite-id bulk delete, and the CSV.
let redState: State;
let blueState: State;

function makeStates(): { red: State; blue: State; quiet: State } {
  const red = {
    i: 1,
    name: "Redland",
    fullName: "Kingdom of Redland",
    color: "#dd0000",
    military: [
      { i: 0, a: 100, name: "Alpha", u: { infantry: 80, archers: 20 }, n: 0, icon: "🛡️" },
      { i: 1, a: 50, name: "Bravo", u: { infantry: 50 }, n: 0, icon: "🛡️" }
    ]
  } as unknown as State;
  const blue = {
    i: 2,
    name: "Bluemark",
    fullName: "Duchy of Bluemark",
    color: "#0000dd",
    military: [
      { i: 0, a: 200, name: "Charlie", u: { infantry: 150, archers: 50 }, n: 0, icon: "http://example.com/flag.png" }
    ]
  } as unknown as State;
  const quiet = { i: 3, name: "Quietia", military: [] } as unknown as State;
  return { red, blue, quiet };
}

// The #armies SVG structure the bulk-delete side-effect prunes and the #viewbox
// element the add mode retargets.
let armiesGroup: SVGGElement;
let viewboxElement: SVGGElement;

function addArmyGroup(stateId: number, regimentId: number): SVGGElement {
  let army = armiesGroup.querySelector<SVGGElement>(`#army${stateId}`);
  if (!army) {
    army = document.createElementNS("http://www.w3.org/2000/svg", "g");
    army.id = `army${stateId}`;
    armiesGroup.appendChild(army);
  }
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.id = `regiment${stateId}-${regimentId}`;
  group.dataset.state = String(stateId);
  group.dataset.id = String(regimentId);
  army.appendChild(group);
  return group;
}

beforeEach(() => {
  const { red, blue, quiet } = makeStates();
  redState = red;
  blueState = blue;
  globalScope.pack = {
    states: [{ i: 0, name: "Neutrals" }, red, blue, quiet],
    cells: { p: [[10, 20]], h: [50] }
  };
  globalScope.options = {
    military: [
      { name: "infantry", crew: 1 },
      { name: "archers", crew: 1 }
    ]
  };
  globalScope.notes = [{ id: "regiment1-0", name: "Alpha", legend: "The first" }];
  globalScope.customization = 0;
  globalScope.tip = vi.fn();
  globalScope.clearMainTip = vi.fn();

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  viewboxElement = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewboxElement.id = "viewbox";
  armiesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  armiesGroup.id = "armies";
  viewboxElement.appendChild(armiesGroup);
  svg.appendChild(viewboxElement);
  document.body.appendChild(svg);
  addArmyGroup(1, 0);
  addArmyGroup(1, 1);
  addArmyGroup(2, 0);

  editRegiment.mockClear();
});

afterEach(() => {
  viewboxElement.ownerSVGElement?.remove();
  globalScope.pack = undefined;
  globalScope.options = undefined;
  globalScope.notes = undefined;
  globalScope.customization = undefined;
  globalScope.tip = undefined;
  globalScope.clearMainTip = undefined;
  globalScope.confirmationDialog = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
  globalScope.getLatitude = undefined;
  globalScope.getLongitude = undefined;
  globalScope.findCell = undefined;
  globalScope.drawRegiment = undefined;
  globalScope.Military = undefined;
  globalScope.viewbox = undefined;
  globalScope.clicked = undefined;
});

function rowNames(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".states")).map(row => row.getAttribute("data-name"));
}

function rowByName(container: HTMLElement, name: string): HTMLElement {
  return container.querySelector(`[data-name="${name}"]`) as HTMLElement;
}

describe("<RegimentsOverview>", () => {
  it("renders one row per regiment across all states, sorted by total descending (legacy default)", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    expect(rowNames(container)).toEqual(["Charlie", "Alpha", "Bravo"]);
    // Dynamic unit columns from options.military, plus the bold total.
    const alphaRow = rowByName(container, "Alpha");
    expect(alphaRow.querySelector('[data-type="infantry"]')?.textContent).toBe("80");
    expect(alphaRow.querySelector('[data-type="archers"]')?.textContent).toBe("20");
    expect(alphaRow.querySelector('[data-type="total"]')?.textContent).toBe("100");
    // The image icon renders as an <img>, the emoji as a <span>.
    const charlieImage = rowByName(container, "Charlie").querySelector("img") as HTMLImageElement;
    expect(charlieImage.getAttribute("src")).toBe("http://example.com/flag.png");
    expect(alphaRow.querySelector("img")).toBeNull();
  });

  it("shows the footer count and per-column totals", () => {
    render(<RegimentsOverview onClose={() => {}} />);
    expect(screen.getByText("Regiments: 3")).toBeTruthy();
    const totalLine = document.querySelector(".totalLine") as HTMLElement;
    const cells = Array.from(totalLine.querySelectorAll("div")).map(cell => cell.textContent);
    // si() of infantry 280, archers 70, grand total 350.
    expect(cells).toEqual(["Regiments: 3", "280", "70", "350"]);
  });

  it("starts on the state passed by the open() seam and falls back to all for an unknown id", () => {
    const { container, unmount } = render(<RegimentsOverview stateId={2} onClose={() => {}} />);
    expect(rowNames(container)).toEqual(["Charlie"]);
    expect((screen.getByLabelText("Select state") as HTMLSelectElement).value).toBe("2");
    unmount();

    const second = render(<RegimentsOverview stateId={99} onClose={() => {}} />);
    expect(rowNames(second.container)).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect((screen.getByLabelText("Select state") as HTMLSelectElement).value).toBe("-1");
  });

  it("filters rows (and footer totals) when the state filter changes", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Select state"), { target: { value: "1" } });
    expect(rowNames(container)).toEqual(["Alpha", "Bravo"]);
    expect(screen.getByText("Regiments: 2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Select state"), { target: { value: "-1" } });
    expect(rowNames(container)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("offers all valid states in the filter, alphabetically", () => {
    render(<RegimentsOverview onClose={() => {}} />);
    const optionLabels = Array.from((screen.getByLabelText("Select state") as HTMLSelectElement).options).map(
      option => option.text
    );
    expect(optionLabels).toEqual(["all", "Bluemark", "Quietia", "Redland"]);
  });

  it("sorts by state/name alphabetically and by unit columns numerically", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    // A fresh alphabetical column starts ascending.
    fireEvent.click(container.querySelector('[data-sortby="state"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Charlie", "Alpha", "Bravo"]);
    fireEvent.click(container.querySelector('[data-sortby="state"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Alpha", "Bravo", "Charlie"]);

    // A fresh numeric column starts descending; regiments without the unit count as 0.
    fireEvent.click(container.querySelector('[data-sortby="archers"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Charlie", "Alpha", "Bravo"]);
    fireEvent.click(container.querySelector('[data-sortby="archers"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("toggles percentage mode: cells show their share of the column total, footer stays absolute", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);
    const toggle = screen.getByLabelText("Toggle percentage / absolute values views");

    fireEvent.click(toggle);
    const charlieRow = rowByName(container, "Charlie");
    // infantry 150 of 280 → 54%; archers 50 of 70 → 71%; total 200 of 350 → 57%.
    expect(charlieRow.querySelector('[data-type="infantry"]')?.textContent).toBe("54%");
    expect(charlieRow.querySelector('[data-type="archers"]')?.textContent).toBe("71%");
    expect(charlieRow.querySelector('[data-type="total"]')?.textContent).toBe("57%");
    expect((container.querySelector(".table") as HTMLElement).dataset.type).toBe("percentage");
    // The footer keeps the absolute sums (the legacy toggle skipped the totalLine).
    expect(screen.getByText("350")).toBeTruthy();

    fireEvent.click(toggle);
    expect(charlieRow.querySelector('[data-type="infantry"]')?.textContent).toBe("150");
    expect((container.querySelector(".table") as HTMLElement).dataset.type).toBe("absolute");
  });

  it("opens the regiment editor from the row's pencil", async () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    fireEvent.click(rowByName(container, "Charlie").querySelector('[aria-label="Edit regiment"]') as HTMLElement);

    await waitFor(() => expect(editRegiment).toHaveBeenCalledWith("#regiment2-0"));
  });

  it("bulk mode: deletes the selected regiments through the cascade and prunes their army groups", () => {
    globalScope.confirmationDialog = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    expect(container.querySelectorAll(".bulkRowCheckbox").length).toBe(3);

    // Select Alpha (state 1, regiment 0) and Charlie (state 2, regiment 0) —
    // same per-state regiment id, distinguished only by the composite encoding.
    fireEvent.click(rowByName(container, "Alpha").querySelector(".bulkRowCheckbox") as HTMLElement);
    fireEvent.click(rowByName(container, "Charlie").querySelector(".bulkRowCheckbox") as HTMLElement);
    expect(screen.getByText("2 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Delete selected rows"));

    // The cascade spliced the regiments and Alpha's note; Bravo survives.
    expect(redState.military?.map(regiment => regiment.name)).toEqual(["Bravo"]);
    expect(blueState.military).toEqual([]);
    expect((globalScope.notes as { id: string }[]).some(note => note.id === "regiment1-0")).toBe(false);
    // The renderer side-effect removed exactly the dead army groups.
    expect(document.getElementById("regiment1-0")).toBeNull();
    expect(document.getElementById("regiment2-0")).toBeNull();
    expect(document.getElementById("regiment1-1")).not.toBeNull();
    // The surface re-read (notifyWorldChanged) and the selection was pruned.
    expect(rowNames(container)).toEqual(["Bravo"]);
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("bulk mode: exiting clears the selection", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Bulk select")); // off
    fireEvent.click(screen.getByLabelText("Bulk select")); // on again
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("exports every regiment (ignoring the filter) as CSV in the exact legacy format", () => {
    const download = vi.fn();
    globalScope.downloadFile = download;
    globalScope.getFileName = (name?: string) => name ?? "";
    globalScope.getLatitude = (y: number) => -y;
    globalScope.getLongitude = (x: number) => x * 2;
    // Give the regiments coordinates the export reads.
    for (const state of [redState, blueState]) {
      for (const regiment of state.military ?? []) {
        regiment.x = 1;
        regiment.y = 2;
        regiment.bx = 3;
        regiment.by = 4;
      }
    }

    render(<RegimentsOverview stateId={2} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Export as CSV"));

    // Missing unit counts join as EMPTY fields and the file ends with a
    // newline — byte-identical to the legacy downloadRegimentsData.
    const expectedCsv =
      "State,Id,Icon,Name,Infantry,Archers,X,Y,Latitude,Longitude,Base X,Base Y,Base Latitude,Base Longitude\n" +
      "Redland,0,🛡️,Alpha,80,20,1,2,-2,2,3,4,-4,6\n" +
      "Redland,1,🛡️,Bravo,50,,1,2,-2,2,3,4,-4,6\n" +
      "Bluemark,0,http://example.com/flag.png,Charlie,150,50,1,2,-2,2,3,4,-4,6\n";
    expect(download).toHaveBeenCalledWith(expectedCsv, "Regiments.csv");
  });

  it("add mode: requires a selected state, then creates and draws a regiment on map click", () => {
    const drawSpy = vi.fn();
    globalScope.drawRegiment = drawSpy;
    globalScope.findCell = () => 0;
    globalScope.Military = {
      getName: () => "2nd Redland Regiment",
      generateNote: vi.fn()
    };
    const { container } = render(<RegimentsOverview onClose={() => {}} />);
    const addButton = screen.getByLabelText("Add new Regiment");

    fireEvent.click(addButton);
    expect(addButton.classList.contains("pressed")).toBe(true);
    expect(viewboxElement.style.cursor).toBe("crosshair");
    expect(globalScope.tip).toHaveBeenCalledWith("Click on map to create new regiment or fleet", true);

    // No state selected: the click only tips an error, nothing is created.
    fireEvent.click(viewboxElement);
    expect(globalScope.tip).toHaveBeenCalledWith("Please select state from the list", false, "error");
    expect(redState.military?.length).toBe(2);

    // With Redland selected the click adds a named regiment, draws it, and
    // turns the mode off.
    fireEvent.change(screen.getByLabelText("Select state"), { target: { value: "1" } });
    act(() => {
      fireEvent.click(viewboxElement);
    });
    expect(redState.military?.length).toBe(3);
    expect(redState.military?.[2]).toMatchObject({ i: 2, name: "2nd Redland Regiment", x: 10, y: 20 });
    expect(drawSpy).toHaveBeenCalledWith(redState.military?.[2], 1);
    expect(addButton.classList.contains("pressed")).toBe(false);
    expect(globalScope.clearMainTip).toHaveBeenCalled();
    // The surface re-read the world: the new regiment has a row.
    expect(rowNames(container)).toContain("2nd Redland Regiment");
  });

  it("add mode: unmounting while active restores the map cursor and default click", () => {
    const viewboxStub = {
      on: vi.fn(() => viewboxStub),
      style: vi.fn(() => viewboxStub)
    };
    const clickedStub = vi.fn();
    globalScope.viewbox = viewboxStub;
    globalScope.clicked = clickedStub;
    const { unmount } = render(<RegimentsOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Add new Regiment"));
    unmount();

    expect(globalScope.clearMainTip).toHaveBeenCalled();
    expect(viewboxStub.on).toHaveBeenCalledWith("click", clickedStub);
    expect(viewboxStub.style).toHaveBeenCalledWith("cursor", "default");
  });

  it("re-reads when the regiments change underneath it (reactivity)", () => {
    const { container } = render(<RegimentsOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(3);

    act(() => {
      redState.military?.push({
        i: 2,
        a: 10,
        name: "Delta",
        u: { archers: 10 },
        n: 0,
        icon: "🛡️"
      } as unknown as Regiment);
      notifyWorldChanged();
    });

    expect(container.querySelectorAll(".states").length).toBe(4);
    expect(screen.getByText("Regiments: 4")).toBeTruthy();
  });

  it("renders an empty table when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    globalScope.options = undefined;
    const { container } = render(<RegimentsOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(0);
    expect(screen.getByText("Regiments: 0")).toBeTruthy();
  });
});
