import { useEffect, useMemo, useReducer, useState } from "react";
import { bulkDeleteConfirm } from "@/controllers/bulk-action/bulk-delete-confirm";
import type { CascadeSummary } from "@/controllers/bulk-action/bulk-entity-adapter";
import type { Marker } from "@/generators/markers-generator";
import { findEl } from "@/utils/nodeUtils";
import { plural } from "@/utils/stringUtils";
import { BulkControls, BulkRowCheckbox, customizationActive, useBulkSelection } from "../bulk-selection";
import { Panel } from "../Panel";
import { LOCKED_TIP, RowIcon, UNLOCKED_TIP } from "../RowIcon";
import { type SortDirection, SortHeader, sortableHeaderClass } from "../SortHeader";
import { useWorldVersion } from "../use-world-version";
import {
  getMarkerNote,
  getMarkers,
  getMarkerTypes,
  invertAllMarkerLocks,
  notifyWorldChanged,
  removeMarker,
  setMarkerLock,
  setMarkerPinned
} from "../world-state";

interface MarkersOverviewProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// The single sortable column, matching the legacy header's `data-sortby`.
// The legacy header shipped with NO active sort icon, so the table starts in
// pack order; `null` models that unsorted state.
type SortKey = "type";

// One marker line: the id, type, icon (unicode char or image URL), and the
// pin/lock flags the row toggles render from.
interface MarkerRow {
  id: number;
  type: string;
  icon: string;
  pinned: boolean;
  locked: boolean;
}

/** True for image icons (URL or data URI) the legacy row rendered as an <img>. */
function isExternalIcon(icon: string): boolean {
  return icon.startsWith("http") || icon.startsWith("data:image");
}

// The legacy `#addedMarkerType` hidden input was static index.html markup, so
// the selected add-type outlived the dialog; persist it at module level the
// same way (ElevationProfile's curve and HeightmapSelection's options do this
// too) — tools.js' addMarkerOnClick reads the hidden input by id.
const DEFAULT_ADD_TYPE = { type: "", icon: "❓" };
let persistedAddType: { type: string; icon: string } = DEFAULT_ADD_TYPE;

// Whether the click-to-add-marker mode was armed when the surface last
// unmounted. The registry remounts an open surface on re-open (new token), so
// the unmount cleanup below runs the legacy close side-effects on what legacy
// treated as a no-op re-open — this record lets the next mount IN THE SAME
// effects flush re-arm the mode. A real close schedules a microtask that drops
// the record before any later genuine open can see it (mount effects of a
// remount run in the same synchronous flush as the unmount cleanup, so they
// win the race by construction).
let reArmAddMarkerMode = false;

/** Reset all module-level persisted state. Test isolation hook — nothing in the app calls it. */
export function resetMarkersOverviewPersistence(): void {
  persistedAddType = DEFAULT_ADD_TYPE;
  reArmAddMarkerMode = false;
}

/**
 * Legacy quoting for the markers CSV: name/legend fields are ALWAYS quoted
 * (unlike the shared RFC-4180 `csvField`, which quotes only when needed), so
 * the export stays byte-identical to the legacy file.
 */
function legacyQuote(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * MarkersOverview — the Markers Overview surface, at parity with the legacy
 * `public/modules/ui/markers-overview.js` jQuery-UI dialog (the third and last
 * legacy-JS overview converted per the frozen recipe, copying the
 * RoutesOverview pattern).
 *
 * Reads markers through the World-State accessor (never raw `window.pack`) and
 * re-reads on any world change via `useWorldVersion`. Mutations (pin/lock
 * toggles and inversions, row/bulk/remove-all deletion via the domain core's
 * `Markers.deleteMarker`) go through the accessor and signal
 * `notifyWorldChanged()` here, at the call site. Map side-effects (the
 * `#markers` group's `pinned` attribute, `drawMarkers`, marker highlight,
 * zoom + marker editor, regenerate, generation config, the add-marker mode)
 * call the existing globals, guarded for absence. The legacy `window.bulkBars`
 * DOM-glue bar is replaced by the shared in-surface bulk mode
 * (`../bulk-selection`).
 *
 * Several legacy element ids are kept because legacy scripts still reach them
 * by id: `markersOverviewRefresh` (tools.js regenerate + markers-editor.js
 * delete click it to refresh), `markersAddFromOverview` and `addedMarkerType`
 * (tools.js' add-marker flow toggles the pressed class and reads the selected
 * type), and `markerTypeSelector`/`markerTypeSelectMenu`/
 * `markerTypeSelectorWrapper` (the dropdown's CSS targets those ids).
 */
export function MarkersOverview({ anchor, onClose }: MarkersOverviewProps) {
  const [refreshCount, refresh] = useReducer(count => count + 1, 0);
  const worldVersion = useWorldVersion();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("up");
  const [addType, setAddType] = useState(persistedAddType);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const bulk = useBulkSelection();

  // The legacy dialog's close() side-effects: unpress the add-marker buttons
  // and restore default map events, so closing the overview always leaves the
  // add-marker mode off. On a registry remount (re-open while open) the
  // cleanup just ran on what legacy treated as a no-op re-open, so the mount
  // re-arms the add-marker mode through the exact toggle path the button uses.
  useEffect(() => {
    if (reArmAddMarkerMode) {
      reArmAddMarkerMode = false;
      findEl("markersAddFromOverview")?.classList.toggle("pressed");
      findEl("addMarker")?.click();
    }
    return () => {
      reArmAddMarkerMode = findEl("addMarker")?.classList.contains("pressed") ?? false;
      findEl("addMarker")?.classList.remove("pressed");
      findEl("markerAdd")?.classList.remove("pressed");
      if (typeof restoreDefaultEvents === "function") restoreDefaultEvents();
      if (typeof clearMainTip === "function") clearMainTip();
      // A real close mounts nothing afterwards; drop the record once this
      // commit's effects have flushed so a LATER genuine open starts with the
      // add mode off (legacy parity).
      queueMicrotask(() => {
        reArmAddMarkerMode = false;
      });
    };
  }, []);

  // Build one row per search-filtered marker. The legacy search matched the
  // marker TYPE only. refreshCount and worldVersion are deliberate cache-busters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount and worldVersion intentionally re-read the accessor.
  const view = useMemo(() => {
    const allMarkers = getMarkers();
    const searchText = search.toLowerCase().trim();
    const filtered = searchText
      ? allMarkers.filter(marker => (marker.type || "").toLowerCase().includes(searchText))
      : allMarkers;

    const rows = filtered.map(marker => {
      return {
        id: marker.i,
        type: marker.type,
        icon: marker.icon,
        pinned: Boolean(marker.pinned),
        locked: Boolean(marker.lock)
      } satisfies MarkerRow;
    });

    return { rows, filteredCount: filtered.length, totalCount: allMarkers.length };
  }, [search, refreshCount, worldVersion]);

  // Pack order until the Type header is first clicked (legacy: the header had
  // no initial icon-sort class, so applySorting left the lines untouched).
  const sortedRows = useMemo(() => {
    if (!sortKey) return view.rows;
    const direction = sortDirection === "down" ? -1 : 1;
    return [...view.rows].sort((first, second) => first.type.localeCompare(second.type) * direction);
  }, [view.rows, sortKey, sortDirection]);

  function handleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection(current => (current === "down" ? "up" : "down"));
      return;
    }
    setSortKey(key);
    // Legacy sortLines: a fresh alphabetical column starts ascending.
    setSortDirection("up");
  }

  const typeHeaderClassName =
    sortKey === "type" ? sortableHeaderClass(true, true, sortDirection) : "sortable alphabetically";

  function findMarker(id: number): Marker | undefined {
    return getMarkers().find(marker => marker.i === id);
  }

  // --- map side-effects (existing globals, guarded for absence) ---

  // Keep the `#markers` group's `pinned` attribute in sync with the pack and
  // redraw: when any marker is pinned the renderer shows only pinned markers.
  function syncPinnedMarkers(): void {
    const markerGroup = findEl("markers");
    if (markerGroup) {
      const anyPinned = getMarkers().some(marker => marker.pinned);
      if (anyPinned) markerGroup.setAttribute("pinned", "1");
      else markerGroup.removeAttribute("pinned");
    }
    if (typeof drawMarkers === "function") drawMarkers();
  }

  function handleLocate(id: number): void {
    const markerElement = findEl(`marker${id}`);
    if (markerElement && typeof highlightElement === "function") highlightElement(markerElement, 2);
  }

  function handleEdit(id: number): void {
    const marker = findMarker(id);
    if (!marker) return;
    if (typeof zoomTo === "function") zoomTo(marker.x, marker.y, 8, 2000);
    if (typeof editMarker === "function") editMarker(id);
  }

  function handleRegenerate(): void {
    if (typeof regenerateMarkers === "function") regenerateMarkers();
  }

  function handleGenerationConfig(): void {
    if (typeof configMarkersGeneration === "function") configMarkersGeneration();
  }

  // Toggle the click-to-add-marker mode, exactly as the legacy overview did:
  // flip this panel's mirror button and click the tools-menu `addMarker`
  // button, whose tools.js handler owns the actual mode switch.
  function handleToggleAddMarker(): void {
    findEl("markersAddFromOverview")?.classList.toggle("pressed");
    findEl("addMarker")?.click();
  }

  function handleSelectType(option: { type: string; icon: string }): void {
    persistedAddType = option;
    setAddType(option);
    // Legacy changeMarkerType: picking a type turns the add mode on if it
    // isn't already.
    if (!findEl("markersAddFromOverview")?.classList.contains("pressed")) handleToggleAddMarker();
    setTypeMenuOpen(false);
  }

  // --- row and footer mutations (accessor + notifyWorldChanged at this call site) ---

  function handlePinToggle(id: number): void {
    const marker = findMarker(id);
    if (!marker) return;
    setMarkerPinned(marker, !marker.pinned);
    syncPinnedMarkers();
    notifyWorldChanged();
  }

  function handleInvertPin(): void {
    for (const marker of getMarkers()) setMarkerPinned(marker, !marker.pinned);
    syncPinnedMarkers();
    notifyWorldChanged();
  }

  function handleLockToggle(id: number): void {
    const marker = findMarker(id);
    if (!marker) return;
    setMarkerLock(marker, !marker.lock);
    notifyWorldChanged();
  }

  // Invert-all writes an EXPLICIT lock boolean on every marker (legacy parity:
  // unlike the per-row toggle, which deletes the key) — see invertAllMarkerLocks.
  function handleInvertLock(): void {
    invertAllMarkerLocks();
    notifyWorldChanged();
  }

  // Removing a marker: the accessor drops it (and its note) through the domain
  // core; removing its SVG element is this surface's renderer side-effect.
  function deleteMarkerAndElement(id: number): void {
    removeMarker(id);
    findEl(`marker${id}`)?.remove();
  }

  function handleRemove(id: number): void {
    confirmationDialog({
      title: "Remove marker",
      message: "Are you sure you want to remove this marker? The action cannot be reverted",
      confirm: "Remove",
      onConfirm: () => {
        deleteMarkerAndElement(id);
        notifyWorldChanged();
      }
    });
  }

  function handleRemoveAll(): void {
    confirmationDialog({
      title: "Remove all markers",
      message: "Are you sure you want to remove all non-locked markers? The action cannot be reverted",
      confirm: "Remove all",
      onConfirm: () => {
        const unlocked = getMarkers().filter(marker => !marker.lock);
        for (const marker of unlocked) deleteMarkerAndElement(marker.i);
        notifyWorldChanged();
      }
    });
  }

  // --- bulk mode (the shared in-surface bulk selection; see ../bulk-selection) ---

  const visibleIds = sortedRows.map(row => row.id);

  function describeCascade(ids: number[]): CascadeSummary {
    const markerById = new Map(getMarkers().map(marker => [marker.i, marker]));
    const selectedMarkers = ids.map(id => markerById.get(id)).filter((marker): marker is Marker => Boolean(marker));
    const deletable = selectedMarkers.filter(marker => !marker.lock).length;
    const skippedLocked = selectedMarkers.length - deletable;
    return { lines: [`${plural(deletable, "marker")} will be removed`], deletable, skippedLocked };
  }

  function handleBulkDelete(): void {
    // Never mutate the pack while a manual-assignment/regeneration mode is
    // active (same guard the legacy bulk bar had).
    if (customizationActive()) return;
    const ids = [...bulk.selected];
    bulkDeleteConfirm({
      typeLabel: "markers",
      describe: () => describeCascade(ids),
      onConfirm: () => {
        const markerById = new Map(getMarkers().map(marker => [marker.i, marker]));
        const deletedIds: number[] = [];
        for (const id of ids) {
          const marker = markerById.get(id);
          if (!marker || marker.lock) continue; // skipped (locked) rows stay selected
          deleteMarkerAndElement(id);
          deletedIds.push(id);
        }
        bulk.pruneSelected(id => !deletedIds.includes(id));
        notifyWorldChanged();
      }
    });
  }

  function handleBulkLock(locked: boolean): void {
    if (customizationActive()) return;
    const markerById = new Map(getMarkers().map(marker => [marker.i, marker]));
    for (const id of bulk.selected) {
      const marker = markerById.get(id);
      if (marker) setMarkerLock(marker, locked);
    }
    notifyWorldChanged();
  }

  // Exports EVERY marker in pack order (not the filtered rows) with
  // always-quoted note fields and no trailing newline — byte-identical to the
  // legacy exportMarkers.
  function handleExport(): void {
    const headers = "Id,Type,Icon,Name,Note,X,Y,Latitude,Longitude\n";
    const lines = getMarkers().map(marker => {
      const { i, type, icon, x, y } = marker;
      const note = getMarkerNote(i);
      const name = note ? legacyQuote(note.name) : "Unknown";
      const legend = note ? legacyQuote(note.legend) : "";
      const latitude = getLatitude(y, 2);
      const longitude = getLongitude(x, 2);
      return [i, type, icon, name, legend, x, y, latitude, longitude].join(",");
    });
    downloadFile(headers + lines.join("\n"), `${getFileName("Markers")}.csv`);
  }

  const typeOptions = [{ type: "empty", icon: "❓" }, ...getMarkerTypes()];

  return (
    <Panel title="Markers Overview" anchor={anchor} onClose={onClose}>
      <div className="header" style={{ gridTemplateColumns: "15em 1em 3em" }}>
        <SortHeader
          label="Type"
          sortKey="type"
          className={typeHeaderClassName}
          dataTip="Click to sort by marker type"
          onSort={handleSort}
        />
        <RowIcon
          className="icon-pin pointer"
          tip="Click to invert pin state for all markers"
          label="Invert pin state for all markers"
          style={{ color: "#6e5e66" }}
          onClick={handleInvertPin}
        />
        <RowIcon
          className="icon-lock pointer"
          tip="Click to invert lock state for all markers"
          label="Invert lock state for all markers"
          style={{ color: "#6e5e66" }}
          onClick={handleInvertLock}
        />
      </div>
      <div className="table">
        {sortedRows.map(row => (
          <div key={row.id} className="states" data-i={row.id} data-type={row.type}>
            <BulkRowCheckbox selection={bulk} id={row.id} label={`Select ${row.type} marker`} />
            {isExternalIcon(row.icon) ? (
              <img
                src={row.icon}
                alt=""
                data-tip="Marker icon"
                style={{ width: "1.2em", height: "1.2em", verticalAlign: "middle" }}
              />
            ) : (
              <span data-tip="Marker icon" style={{ width: "1.2em" }}>
                {row.icon}
              </span>
            )}
            <div data-tip="Marker type" style={{ width: "10em" }}>
              {row.type}
            </div>
            <RowIcon
              className="icon-pencil"
              tip="Edit marker"
              label="Edit marker"
              style={{ paddingRight: ".1em" }}
              onClick={() => handleEdit(row.id)}
            />
            <RowIcon
              className="icon-target"
              tip="Locate the marker"
              label="Locate the marker"
              style={{ paddingRight: ".1em" }}
              onClick={() => handleLocate(row.id)}
            />
            <RowIcon
              className={row.pinned ? "icon-pin pointer" : "icon-pin inactive pointer"}
              tip="Pin marker (display only pinned markers)"
              label={row.pinned ? "Unpin marker" : "Pin marker"}
              style={{ paddingRight: ".1em" }}
              onClick={() => handlePinToggle(row.id)}
            />
            <RowIcon
              className={`locks pointer ${row.locked ? "icon-lock" : "icon-lock-open inactive"}`}
              tip={row.locked ? LOCKED_TIP : UNLOCKED_TIP}
              label={row.locked ? "Unlock marker" : "Lock marker"}
              style={{ paddingRight: ".1em" }}
              onClick={() => handleLockToggle(row.id)}
            />
            <RowIcon
              className="icon-trash-empty"
              tip="Remove marker"
              label="Remove marker"
              onClick={() => handleRemove(row.id)}
            />
          </div>
        ))}
      </div>
      <div>
        <label data-tip="Filter by type">
          Search: <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
      <div className="totalLine">
        <div data-tip="Markers number">
          Markers:&nbsp;
          <span>
            {view.filteredCount} of {view.totalCount}
          </span>
        </div>
      </div>
      <div>
        <button
          type="button"
          id="markersOverviewRefresh"
          data-tip="Refresh the Overview screen"
          className="icon-cw"
          aria-label="Refresh"
          onClick={refresh}
        />
        <button
          type="button"
          data-tip="Regenerate unlocked markers"
          className="icon-shuffle"
          aria-label="Regenerate unlocked markers"
          onClick={handleRegenerate}
        />
        <input type="hidden" id="addedMarkerType" name="addedMarkerType" value={addType.type} readOnly />
        <span id="markerTypeSelectorWrapper">
          <button
            type="button"
            id="markerTypeSelector"
            data-tip="Select marker type for newly added markers."
            aria-label="Select marker type for newly added markers"
            onClick={() => setTypeMenuOpen(current => !current)}
          >
            {addType.icon}
          </button>
          <div id="markerTypeSelectMenu" className={typeMenuOpen ? "visible" : ""}>
            {typeOptions.map(option => (
              <button key={option.type} type="button" onClick={() => handleSelectType(option)}>
                {`${option.icon} ${option.type}`}
              </button>
            ))}
          </div>
        </span>
        <button
          type="button"
          id="markersAddFromOverview"
          data-tip="Add a new marker. Hold Shift to add multiple"
          className="icon-plus"
          aria-label="Add a new marker"
          onClick={handleToggleAddMarker}
        />
        <button
          type="button"
          data-tip="Config markers generation options"
          className="icon-cog"
          aria-label="Config markers generation options"
          onClick={handleGenerationConfig}
        />
        <button
          type="button"
          data-tip="Remove all unlocked markers"
          className="icon-trash"
          aria-label="Remove all unlocked markers"
          onClick={handleRemoveAll}
        />
        <button
          type="button"
          data-tip="Save markers data as a text file (.csv)"
          className="icon-download"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
        <BulkControls
          selection={bulk}
          visibleIds={visibleIds}
          onDelete={handleBulkDelete}
          onLock={() => handleBulkLock(true)}
          onUnlock={() => handleBulkLock(false)}
        />
      </div>
    </Panel>
  );
}
