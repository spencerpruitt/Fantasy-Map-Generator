import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { River } from "@/generators/river-generator";
import { notifyWorldChanged } from "../world-state";
import { RiversOverview } from "./RiversOverview";

const globalScope = globalThis as Record<string, unknown>;

// A main stem (its own basin), its tributary (basin resolves to the stem's
// name), and an independent stem — enough to pin the basin lookup, the
// multi-field search, and the tributary cascade on removal.
let riversData: River[];

function makeRivers(): River[] {
  return [
    { i: 1, name: "Ohio", type: "River", discharge: 500, length: 100, width: 2, parent: 1, basin: 1 },
    { i: 2, name: "Wolf Creek", type: "Creek", discharge: 20, length: 40, width: 0.5, parent: 1, basin: 1 },
    { i: 3, name: "Silver Fork", type: "Fork", discharge: 60, length: 60, width: 1.5, parent: 3, basin: 3 }
  ] as River[];
}

beforeEach(() => {
  riversData = makeRivers();
  globalScope.pack = { rivers: riversData, cells: { i: [0, 1, 2, 3], r: new Uint16Array([0, 1, 2, 0]) } };
  globalScope.distanceScale = 1;
  globalScope.distanceUnitInput = { value: "km" };
  globalScope.customization = 0;
  globalScope.tip = vi.fn();
  globalScope.Rivers = {
    // The domain cascade: removing a river also removes every river whose
    // parent or basin it is (tributaries), mutating pack.rivers in place.
    remove: vi.fn((id: number) => {
      const removedIds = new Set(
        riversData.filter(river => river.i === id || river.parent === id || river.basin === id).map(river => river.i)
      );
      for (let index = riversData.length - 1; index >= 0; index -= 1) {
        if (removedIds.has(riversData[index].i)) riversData.splice(index, 1);
      }
    })
  };
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.distanceScale = undefined;
  globalScope.distanceUnitInput = undefined;
  globalScope.customization = undefined;
  globalScope.tip = undefined;
  globalScope.Rivers = undefined;
  globalScope.confirmationDialog = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
  globalScope.editRiver = undefined;
  globalScope.toggleAddRiver = undefined;
  globalScope.createRiver = undefined;
});

function rowNames(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".states")).map(row => row.getAttribute("data-name"));
}

describe("<RiversOverview>", () => {
  it("renders one row per river, sorted by discharge descending by default", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    // The legacy header shipped with icon-sort-number-down on Discharge.
    expect(rowNames(container)).toEqual(["Ohio", "Silver Fork", "Wolf Creek"]);
    // Row labels: discharge in m³/s, scaled length/width in the distance unit.
    expect(screen.getByText("500 m³/s")).toBeTruthy();
    expect(screen.getByText("100 km")).toBeTruthy();
    expect(screen.getByText("1.5 km")).toBeTruthy();
  });

  it("resolves each river's basin name through the riversById lookup", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    const tributaryRow = container.querySelector('[data-id="2"]') as HTMLElement;
    const basinInput = tributaryRow.querySelector("input.stateName") as HTMLInputElement;
    expect(basinInput.value).toBe("Ohio");
    expect(basinInput.disabled).toBe(true);
    expect(tributaryRow.getAttribute("data-basin")).toBe("Ohio");
  });

  it("shows the footer counts and averages", () => {
    render(<RiversOverview onClose={() => {}} />);

    expect(screen.getByText("3 of 3")).toBeTruthy();
    // rn(mean(500, 20, 60)) = 193.
    expect(screen.getByText("193 m³/s")).toBeTruthy();
    // rn(mean(100, 40, 60)) = 67, scaled by distanceScale 1.
    expect(screen.getByText("67 km")).toBeTruthy();
    // rn(rn(mean(2, 0.5, 1.5), 3) * 1, 3) = 1.333 — the Width total.
    expect(screen.getByText("1.333 km")).toBeTruthy();
  });

  it("filters rows by name, type, or basin name", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);
    const searchInput = screen.getByRole("searchbox") as HTMLInputElement;

    // "creek" matches Wolf Creek by name and by its Creek type.
    fireEvent.change(searchInput, { target: { value: "creek" } });
    expect(rowNames(container)).toEqual(["Wolf Creek"]);
    expect(screen.getByText("1 of 3")).toBeTruthy();

    // "ohio" matches Ohio by name AND Wolf Creek through its basin's name.
    fireEvent.change(searchInput, { target: { value: "ohio" } });
    expect(rowNames(container)).toEqual(["Ohio", "Wolf Creek"]);
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(rowNames(container).length).toBe(3);
  });

  it("sorts alphabetically when the River header is clicked, then flips", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(container.querySelector('[data-sortby="name"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Ohio", "Silver Fork", "Wolf Creek"]);
    fireEvent.click(container.querySelector('[data-sortby="name"]') as HTMLElement);
    expect(rowNames(container)).toEqual(["Wolf Creek", "Silver Fork", "Ohio"]);
  });

  it("sorts by basin name when the Basin header is clicked", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(container.querySelector('[data-sortby="basin"]') as HTMLElement);
    // Ohio-basin rows (pack order) before the Silver Fork basin.
    expect(rowNames(container)).toEqual(["Ohio", "Wolf Creek", "Silver Fork"]);
  });

  it("removes a river and its tributaries after confirmation", () => {
    const confirmSpy = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    globalScope.confirmationDialog = confirmSpy;
    const { container } = render(<RiversOverview onClose={() => {}} />);

    const ohioRow = container.querySelector('[data-id="1"]') as HTMLElement;
    fireEvent.click(ohioRow.querySelector('[aria-label="Remove river"]') as HTMLElement);

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove river", confirm: "Remove" }));
    expect((globalScope.Rivers as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalledWith(1);
    // Wolf Creek (Ohio's tributary) cascades away with it.
    expect(rowNames(container)).toEqual(["Silver Fork"]);
  });

  it("removes all rivers after confirmation", () => {
    globalScope.confirmationDialog = vi.fn((options: { title: string; onConfirm: () => void }) => {
      expect(options.title).toBe("Remove all rivers");
      options.onConfirm();
    });
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Remove all rivers"));

    expect(rowNames(container)).toEqual([]);
    expect(screen.getByText("0 of 0")).toBeTruthy();
    expect((globalScope.pack as { rivers: River[] }).rivers).toEqual([]);
  });

  it("exports the visible rows as CSV in the current sort order", () => {
    const download = vi.fn();
    globalScope.downloadFile = download;
    globalScope.getFileName = (name?: string) => name ?? "";

    render(<RiversOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Export as CSV"));

    const expectedCsv =
      "Id,River,Type,Discharge,Length,Width,Basin\n" +
      "1,Ohio,River,500 m³/s,100 km,2 km,Ohio\n" +
      "3,Silver Fork,Fork,60 m³/s,60 km,1.5 km,Silver Fork\n" +
      "2,Wolf Creek,Creek,20 m³/s,40 km,0.5 km,Ohio\n";
    expect(download).toHaveBeenCalledWith(expectedCsv, "Rivers.csv");
  });

  it("opens the river editor for a row through the editRiver global", () => {
    const editSpy = vi.fn();
    globalScope.editRiver = editSpy;
    const { container } = render(<RiversOverview onClose={() => {}} />);

    const ohioRow = container.querySelector('[data-id="1"]') as HTMLElement;
    fireEvent.click(ohioRow.querySelector('[aria-label="Edit river"]') as HTMLElement);
    expect(editSpy).toHaveBeenCalledWith("river1");
  });

  it("wires the add-on-click and create-new buttons to the legacy globals", () => {
    const toggleAddSpy = vi.fn();
    const createSpy = vi.fn();
    globalScope.toggleAddRiver = toggleAddSpy;
    globalScope.createRiver = createSpy;
    render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Add river on click"));
    expect(toggleAddSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Create a new river"));
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when basin highlight is clicked without a rivers layer", () => {
    render(<RiversOverview onClose={() => {}} />);
    expect(() => fireEvent.click(screen.getByLabelText("Toggle basin highlight"))).not.toThrow();
  });

  it("bulk mode: deleting a selected stem cascades and prunes the selection", () => {
    globalScope.confirmationDialog = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    expect(container.querySelectorAll(".bulkRowCheckbox").length).toBe(3);

    // Select only Ohio; deleting it also removes its tributary Wolf Creek.
    const ohioCheckbox = (container.querySelector('[data-id="1"]') as HTMLElement).querySelector(
      ".bulkRowCheckbox"
    ) as HTMLElement;
    fireEvent.click(ohioCheckbox);
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Delete selected rows"));

    expect(rowNames(container)).toEqual(["Silver Fork"]);
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("bulk mode: select-all only covers the visible (filtered) rows", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "creek" } });
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);

    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk mode: exiting clears the selection", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Bulk select")); // off
    fireEvent.click(screen.getByLabelText("Bulk select")); // on again
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("re-reads when the rivers change underneath it (reactivity)", () => {
    const { container } = render(<RiversOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(3);

    act(() => {
      riversData.push({
        i: 4,
        name: "New Brook",
        type: "Brook",
        discharge: 5,
        length: 10,
        width: 0.1,
        parent: 4,
        basin: 4
      } as River);
      notifyWorldChanged();
    });

    expect(container.querySelectorAll(".states").length).toBe(4);
    expect(screen.getByText("4 of 4")).toBeTruthy();
  });

  it("renders an empty table when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    const { container } = render(<RiversOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(0);
    expect(screen.getByText("0 of 0")).toBeTruthy();
  });
});
