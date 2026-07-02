import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "@/generators/markers-generator";
import { notifyWorldChanged } from "../world-state";
import { MarkersOverview, resetMarkersOverviewPersistence } from "./MarkersOverview";

const globalScope = globalThis as Record<string, unknown>;

// A plain marker, a pinned one, and a locked one with an image icon — enough
// to pin the icon rendering split, the pin/lock toggles and inversions, the
// locked-row survival on remove-all/bulk-delete, and the CSV note lookup.
let markersData: Marker[];
let notesData: { id: string; name: string; legend: string }[];

function makeMarkers(): Marker[] {
  return [
    { i: 0, type: "volcanoes", icon: "🌋", x: 10, y: 20, cell: 1 },
    { i: 1, type: "battlefields", icon: "⚔️", x: 30, y: 40, cell: 2, pinned: true },
    { i: 2, type: "lighthouses", icon: "http://example.com/icon.png", x: 50, y: 60, cell: 3, lock: true }
  ] as Marker[];
}

// The #markers SVG group and the tools-menu #addMarker button the surface's
// side-effects reach by id.
let markerGroup: HTMLElement;
let addMarkerButton: HTMLButtonElement;
let addMarkerClicks: number;

beforeEach(() => {
  resetMarkersOverviewPersistence();
  markersData = makeMarkers();
  notesData = [{ id: "marker0", name: "Mount Doom", legend: 'An "angry" volcano' }];
  globalScope.pack = { markers: markersData };
  globalScope.notes = notesData;
  globalScope.customization = 0;
  globalScope.tip = vi.fn();
  globalScope.drawMarkers = vi.fn();
  globalScope.Markers = {
    getConfig: () => [
      { type: "volcanoes", icon: "🌋" },
      { type: "battlefields", icon: "⚔️" }
    ],
    // The domain removal: drop the marker and its note (markers-generator.ts).
    deleteMarker: vi.fn((id: number) => {
      notesData = notesData.filter(note => note.id !== `marker${id}`);
      globalScope.notes = notesData;
      const index = markersData.findIndex(marker => marker.i === id);
      if (index >= 0) markersData.splice(index, 1);
    })
  };

  markerGroup = document.createElement("g");
  markerGroup.id = "markers";
  document.body.appendChild(markerGroup);

  addMarkerClicks = 0;
  addMarkerButton = document.createElement("button");
  addMarkerButton.id = "addMarker";
  addMarkerButton.addEventListener("click", () => {
    addMarkerClicks += 1;
  });
  document.body.appendChild(addMarkerButton);
});

afterEach(() => {
  markerGroup.remove();
  addMarkerButton.remove();
  globalScope.pack = undefined;
  globalScope.notes = undefined;
  globalScope.customization = undefined;
  globalScope.tip = undefined;
  globalScope.drawMarkers = undefined;
  globalScope.Markers = undefined;
  globalScope.confirmationDialog = undefined;
  globalScope.downloadFile = undefined;
  globalScope.getFileName = undefined;
  globalScope.getLatitude = undefined;
  globalScope.getLongitude = undefined;
  globalScope.zoomTo = undefined;
  globalScope.editMarker = undefined;
  globalScope.highlightElement = undefined;
  globalScope.regenerateMarkers = undefined;
  globalScope.configMarkersGeneration = undefined;
  globalScope.restoreDefaultEvents = undefined;
  globalScope.clearMainTip = undefined;
});

function rowTypes(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".states")).map(row => row.getAttribute("data-type"));
}

function rowById(container: HTMLElement, id: number): HTMLElement {
  return container.querySelector(`[data-i="${id}"]`) as HTMLElement;
}

describe("<MarkersOverview>", () => {
  it("renders one row per marker in pack order, with emoji and image icons", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    // The legacy header had no initial sort icon, so rows keep pack order.
    expect(rowTypes(container)).toEqual(["volcanoes", "battlefields", "lighthouses"]);
    expect(screen.getByText("🌋")).toBeTruthy();
    // The URL icon renders as an <img>, not text.
    const image = rowById(container, 2).querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("http://example.com/icon.png");
  });

  it("shows the footer filtered/total counts", () => {
    render(<MarkersOverview onClose={() => {}} />);
    expect(screen.getByText("3 of 3")).toBeTruthy();
  });

  it("filters rows by marker type", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);
    const searchInput = screen.getByRole("searchbox") as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: "battle" } });
    expect(rowTypes(container)).toEqual(["battlefields"]);
    expect(screen.getByText("1 of 3")).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(rowTypes(container).length).toBe(3);
  });

  it("sorts by type when the Type header is clicked, then flips", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(container.querySelector('[data-sortby="type"]') as HTMLElement);
    expect(rowTypes(container)).toEqual(["battlefields", "lighthouses", "volcanoes"]);
    fireEvent.click(container.querySelector('[data-sortby="type"]') as HTMLElement);
    expect(rowTypes(container)).toEqual(["volcanoes", "lighthouses", "battlefields"]);
  });

  it("pins and unpins a marker, syncing the #markers group and redrawing", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    // Pin the volcano: the flag is set and the group is marked pinned.
    fireEvent.click(rowById(container, 0).querySelector('[aria-label="Pin marker"]') as HTMLElement);
    expect(markersData.find(marker => marker.i === 0)?.pinned).toBe(true);
    expect(markerGroup.getAttribute("pinned")).toBe("1");
    expect(globalScope.drawMarkers).toHaveBeenCalled();

    // Unpin the battlefield: the volcano is still pinned, so the group stays marked.
    fireEvent.click(rowById(container, 1).querySelector('[aria-label="Unpin marker"]') as HTMLElement);
    expect("pinned" in (markersData.find(marker => marker.i === 1) as object)).toBe(false);
    expect(markerGroup.getAttribute("pinned")).toBe("1");

    // Unpin the volcano too: nothing is pinned, so the attribute is removed.
    fireEvent.click(rowById(container, 0).querySelector('[aria-label="Unpin marker"]') as HTMLElement);
    expect(markerGroup.hasAttribute("pinned")).toBe(false);
  });

  it("inverts the pin state for all markers from the header", () => {
    render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Invert pin state for all markers"));

    expect(markersData.find(marker => marker.i === 0)?.pinned).toBe(true);
    expect("pinned" in (markersData.find(marker => marker.i === 1) as object)).toBe(false);
    expect(markersData.find(marker => marker.i === 2)?.pinned).toBe(true);
    expect(markerGroup.getAttribute("pinned")).toBe("1");
  });

  it("toggles a marker's lock, deleting the flag on unlock", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(rowById(container, 0).querySelector('[aria-label="Lock marker"]') as HTMLElement);
    expect(markersData.find(marker => marker.i === 0)?.lock).toBe(true);

    fireEvent.click(rowById(container, 2).querySelector('[aria-label="Unlock marker"]') as HTMLElement);
    expect("lock" in (markersData.find(marker => marker.i === 2) as object)).toBe(false);
  });

  it("inverts the lock state for all markers, writing EXPLICIT booleans (legacy parity)", () => {
    render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Invert lock state for all markers"));

    // The legacy invert-all replaced pack.markers with mapped copies, so read
    // the pack — not the stale local array reference.
    const markers = (globalScope.pack as { markers: Marker[] }).markers;
    expect(markers.find(marker => marker.i === 0)?.lock).toBe(true);
    expect(markers.find(marker => marker.i === 1)?.lock).toBe(true);
    // The previously-locked lighthouse keeps an explicit `lock: false` KEY —
    // legacy wrote a boolean on EVERY marker, so `.map` bytes stay identical.
    const lighthouse = markers.find(marker => marker.i === 2) as Marker;
    expect(lighthouse.lock).toBe(false);
    expect("lock" in lighthouse).toBe(true);
  });

  it("removes a marker (and its map element) after confirmation", () => {
    const confirmSpy = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    globalScope.confirmationDialog = confirmSpy;
    const markerElement = document.createElement("svg");
    markerElement.id = "marker0";
    document.body.appendChild(markerElement);
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(rowById(container, 0).querySelector('[aria-label="Remove marker"]') as HTMLElement);

    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Remove marker", confirm: "Remove" }));
    const markersModule = globalScope.Markers as { deleteMarker: ReturnType<typeof vi.fn> };
    expect(markersModule.deleteMarker).toHaveBeenCalledWith(0);
    expect(rowTypes(container)).toEqual(["battlefields", "lighthouses"]);
    expect(document.getElementById("marker0")).toBeNull();
  });

  it("removes all non-locked markers after confirmation, keeping locked ones", () => {
    globalScope.confirmationDialog = vi.fn((options: { title: string; onConfirm: () => void }) => {
      expect(options.title).toBe("Remove all markers");
      options.onConfirm();
    });
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Remove all unlocked markers"));

    expect(rowTypes(container)).toEqual(["lighthouses"]);
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });

  it("exports every marker as CSV in the exact legacy format", () => {
    const download = vi.fn();
    globalScope.downloadFile = download;
    globalScope.getFileName = (name?: string) => name ?? "";
    globalScope.getLatitude = (y: number) => -y;
    globalScope.getLongitude = (x: number) => x * 2;

    render(<MarkersOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Export as CSV"));

    // Note fields are ALWAYS quoted, missing notes read "Unknown", and there
    // is no trailing newline — byte-identical to the legacy exportMarkers.
    const expectedCsv =
      "Id,Type,Icon,Name,Note,X,Y,Latitude,Longitude\n" +
      '0,volcanoes,🌋,"Mount Doom","An ""angry"" volcano",10,20,-20,20\n' +
      "1,battlefields,⚔️,Unknown,,30,40,-40,60\n" +
      "2,lighthouses,http://example.com/icon.png,Unknown,,50,60,-60,100";
    expect(download).toHaveBeenCalledWith(expectedCsv, "Markers.csv");
  });

  it("zooms to the marker and opens the marker editor from the row", () => {
    const zoomSpy = vi.fn();
    const editSpy = vi.fn();
    globalScope.zoomTo = zoomSpy;
    globalScope.editMarker = editSpy;
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(rowById(container, 1).querySelector('[aria-label="Edit marker"]') as HTMLElement);

    expect(zoomSpy).toHaveBeenCalledWith(30, 40, 8, 2000);
    expect(editSpy).toHaveBeenCalledWith(1);
  });

  it("locates a marker through the highlightElement global", () => {
    const highlightSpy = vi.fn();
    globalScope.highlightElement = highlightSpy;
    const markerElement = document.createElement("svg");
    markerElement.id = "marker0";
    document.body.appendChild(markerElement);
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(rowById(container, 0).querySelector('[aria-label="Locate the marker"]') as HTMLElement);

    expect(highlightSpy).toHaveBeenCalledWith(markerElement, 2);
    markerElement.remove();
  });

  it("wires the regenerate and generation-config buttons to the legacy globals", () => {
    const regenerateSpy = vi.fn();
    const configSpy = vi.fn();
    globalScope.regenerateMarkers = regenerateSpy;
    globalScope.configMarkersGeneration = configSpy;
    render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Regenerate unlocked markers"));
    expect(regenerateSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Config markers generation options"));
    expect(configSpy).toHaveBeenCalledTimes(1);
  });

  it("toggles the add-marker mode by pressing the mirror button and clicking addMarker", () => {
    render(<MarkersOverview onClose={() => {}} />);
    const mirrorButton = screen.getByLabelText("Add a new marker");

    fireEvent.click(mirrorButton);
    expect(mirrorButton.classList.contains("pressed")).toBe(true);
    expect(addMarkerClicks).toBe(1);

    fireEvent.click(mirrorButton);
    expect(mirrorButton.classList.contains("pressed")).toBe(false);
    expect(addMarkerClicks).toBe(2);
  });

  it("selects an add-marker type from the dropdown and turns the add mode on", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);
    const menu = container.querySelector("#markerTypeSelectMenu") as HTMLElement;
    expect(menu.classList.contains("visible")).toBe(false);

    fireEvent.click(screen.getByLabelText("Select marker type for newly added markers"));
    expect(menu.classList.contains("visible")).toBe(true);
    // The empty option is prepended to the domain config's types.
    const options = Array.from(menu.querySelectorAll("button")).map(option => option.textContent);
    expect(options).toEqual(["❓ empty", "🌋 volcanoes", "⚔️ battlefields"]);

    fireEvent.click(screen.getByText("🌋 volcanoes"));

    const hiddenInput = container.querySelector("#addedMarkerType") as HTMLInputElement;
    expect(hiddenInput.value).toBe("volcanoes");
    expect((container.querySelector("#markerTypeSelector") as HTMLElement).textContent).toBe("🌋");
    expect(menu.classList.contains("visible")).toBe(false);
    // Picking a type turns the add mode on (legacy changeMarkerType).
    expect(screen.getByLabelText("Add a new marker").classList.contains("pressed")).toBe(true);
    expect(addMarkerClicks).toBe(1);
  });

  it("bulk mode: selects all visible rows and deletes the unlocked ones", () => {
    globalScope.confirmationDialog = vi.fn((options: { onConfirm: () => void }) => options.onConfirm());
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    expect(container.querySelectorAll(".bulkRowCheckbox").length).toBe(3);

    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Delete selected rows"));

    // The locked lighthouse is skipped and stays selected, like the legacy bulk bar.
    expect(rowTypes(container)).toEqual(["lighthouses"]);
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk mode: select-all only covers the visible (filtered) rows", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "volcano" } });
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);

    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("bulk mode: locks and unlocks the selected rows", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.click(rowById(container, 0).querySelector(".bulkRowCheckbox") as HTMLElement);

    fireEvent.click(screen.getByLabelText("Lock selected rows"));
    expect(markersData.find(marker => marker.i === 0)?.lock).toBe(true);
    expect(markersData.find(marker => marker.i === 1)?.lock).toBeUndefined();

    fireEvent.click(screen.getByLabelText("Unlock selected rows"));
    expect("lock" in (markersData.find(marker => marker.i === 0) as object)).toBe(false);
  });

  it("bulk mode: exiting clears the selection", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Bulk select"));
    fireEvent.click(container.querySelector(".bulkSelectAllCheckbox") as HTMLElement);
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Bulk select")); // off
    fireEvent.click(screen.getByLabelText("Bulk select")); // on again
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("re-reads when the markers change underneath it (reactivity)", () => {
    const { container } = render(<MarkersOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(3);

    act(() => {
      markersData.push({ i: 3, type: "shrines", icon: "🛐", x: 70, y: 80, cell: 4 } as Marker);
      notifyWorldChanged();
    });

    expect(container.querySelectorAll(".states").length).toBe(4);
    expect(screen.getByText("4 of 4")).toBeTruthy();
  });

  it("renders an empty table when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    const { container } = render(<MarkersOverview onClose={() => {}} />);
    expect(container.querySelectorAll(".states").length).toBe(0);
    expect(screen.getByText("0 of 0")).toBeTruthy();
  });

  it("unpresses the add buttons and restores map events on close (legacy close())", () => {
    const restoreSpy = vi.fn();
    const clearSpy = vi.fn();
    globalScope.restoreDefaultEvents = restoreSpy;
    globalScope.clearMainTip = clearSpy;
    addMarkerButton.classList.add("pressed");
    const { unmount } = render(<MarkersOverview onClose={() => {}} />);

    unmount();

    expect(addMarkerButton.classList.contains("pressed")).toBe(false);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected add-marker type across unmount/remount (legacy static input parity)", () => {
    const first = render(<MarkersOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select marker type for newly added markers"));
    fireEvent.click(screen.getByText("🌋 volcanoes"));
    expect((first.container.querySelector("#addedMarkerType") as HTMLInputElement).value).toBe("volcanoes");
    first.unmount();

    // The legacy #addedMarkerType input was static markup that outlived the
    // dialog, so tools.js' addMarkerOnClick kept reading the chosen type after
    // a close/re-open; the remounted hidden input must carry it.
    const second = render(<MarkersOverview onClose={() => {}} />);
    const hiddenInput = second.container.querySelector("#addedMarkerType") as HTMLInputElement;
    expect(hiddenInput.value).toBe("volcanoes");
    expect((second.container.querySelector("#markerTypeSelector") as HTMLElement).textContent).toBe("🌋");
  });

  // Emulates tools.js' toggleAddMarker/unpressClickToAddButton pressed-state
  // handling on the fake #addMarker button, so the add-marker mode has a real
  // on/off signal the surface's mount/unmount logic can observe.
  function emulateToolsAddMarkerToggle(): void {
    addMarkerButton.addEventListener("click", () => {
      const pressed = addMarkerButton.classList.contains("pressed");
      if (pressed) {
        addMarkerButton.classList.remove("pressed");
        document.getElementById("markersAddFromOverview")?.classList.remove("pressed");
      } else {
        addMarkerButton.classList.add("pressed");
        document.getElementById("markersAddFromOverview")?.classList.add("pressed");
      }
    });
  }

  it("re-arms the add-marker mode when the surface remounts while open (re-open is a no-op, legacy parity)", () => {
    emulateToolsAddMarkerToggle();
    const first = render(<MarkersOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Add a new marker"));
    expect(addMarkerButton.classList.contains("pressed")).toBe(true);

    // The registry remounts an open surface on re-open (new token): the old
    // instance's cleanup and the new instance's mount run in the same effects
    // flush. Unmount + immediate render reproduces that sequence.
    first.unmount();
    render(<MarkersOverview onClose={() => {}} />);

    // Legacy treated re-open as a no-op: the add mode stays armed and both
    // buttons stay pressed.
    expect(addMarkerButton.classList.contains("pressed")).toBe(true);
    expect(screen.getByLabelText("Add a new marker").classList.contains("pressed")).toBe(true);
  });

  it("exits the add-marker mode on a real close, and a later open stays off (legacy parity)", async () => {
    emulateToolsAddMarkerToggle();
    const restoreSpy = vi.fn();
    globalScope.restoreDefaultEvents = restoreSpy;
    const view = render(<MarkersOverview onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Add a new marker"));
    expect(addMarkerButton.classList.contains("pressed")).toBe(true);

    view.unmount();

    // A real close runs the legacy close() side-effects: mode off.
    expect(addMarkerButton.classList.contains("pressed")).toBe(false);
    expect(restoreSpy).toHaveBeenCalledTimes(1);

    // No mount followed in the same flush, so the re-arm record is dropped: a
    // later genuine open must NOT resurrect the add mode.
    await Promise.resolve(); // let the cleanup's microtask clear the record
    render(<MarkersOverview onClose={() => {}} />);
    expect(addMarkerButton.classList.contains("pressed")).toBe(false);
    expect(screen.getByLabelText("Add a new marker").classList.contains("pressed")).toBe(false);
  });
});
