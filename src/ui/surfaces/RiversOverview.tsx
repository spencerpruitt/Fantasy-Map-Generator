import { useMemo, useReducer, useState } from "react";
import { bulkDeleteConfirm } from "@/controllers/bulk-action/bulk-delete-confirm";
import type { CascadeSummary } from "@/controllers/bulk-action/bulk-entity-adapter";
import { rn } from "@/utils/numberUtils";
import { plural } from "@/utils/stringUtils";
import { BulkControls, BulkRowCheckbox, customizationActive, useBulkSelection } from "../bulk-selection";
import { csvField } from "../csv";
import { Panel } from "../Panel";
import { RowIcon } from "../RowIcon";
import { type SortDirection, SortHeader, sortableHeaderClass } from "../SortHeader";
import { useWorldVersion } from "../use-world-version";
import { getRivers, getRiversById, notifyWorldChanged, removeAllRivers, removeRiver } from "../world-state";

interface RiversOverviewProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// Sort columns match the legacy header `data-sortby` values. name/type/basin
// sort alphabetically; discharge/length/width numerically. The legacy header
// shipped with `icon-sort-number-down` on Discharge, so the table starts
// sorted by discharge descending.
type SortKey = "name" | "type" | "discharge" | "length" | "width" | "basin";

const ALPHABETICAL_KEYS: ReadonlySet<SortKey> = new Set(["name", "type", "basin"]);

// One river line: the id, display name/type, the raw values the legacy
// `data-*` attributes sorted on, their display labels, and the basin (main
// stem) name resolved through the riversById lookup.
interface RiverRow {
  id: number;
  name: string;
  type: string;
  discharge: number;
  dischargeLabel: string;
  rawLength: number;
  lengthLabel: string;
  rawWidth: number;
  widthLabel: string;
  basinName: string;
}

// The ten basin-highlight colors the legacy overview cycled through.
const BASIN_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf"
];

/** rn(mean(values)) || 0 — the legacy footer-average shape (0 for an empty list). */
function roundedMean(values: number[], decimals = 0): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return rn(mean, decimals) || 0;
}

/**
 * RiversOverview — the Rivers Overview surface, at parity with the legacy
 * `public/modules/ui/rivers-overview.js` jQuery-UI dialog (the second
 * legacy-JS overview converted per the frozen recipe, copying the
 * RoutesOverview pattern).
 *
 * Reads rivers through the World-State accessor (never raw `window.pack`) and
 * re-reads on any world change via `useWorldVersion`. Removals (row, bulk,
 * remove-all) go through the accessor's domain-core wrappers and signal
 * `notifyWorldChanged()` here, at the call site; rivers have no lock, so —
 * like the legacy dialog and its bulk adapter — no lock actions exist. Map
 * side-effects (river highlight, zoom-to-river, basin highlight, the river
 * editor/creator, add-on-click) call the existing globals, guarded for
 * absence. The legacy `window.bulkBars` DOM-glue bar is replaced by the shared
 * in-surface bulk mode (`../bulk-selection`, select + delete only here) — the
 * cross-surface mutate/redraw bulk machinery remains Phase 4.
 *
 * The Refresh and add-on-click buttons keep their legacy ids
 * (`riversOverviewRefresh`, `addNewRiver`) because tools.js' add-river flow
 * still reaches them by id: it toggles the button's pressed class and clicks
 * Refresh after placing a river on the map.
 */
export function RiversOverview({ anchor, onClose }: RiversOverviewProps) {
  const [refreshCount, refresh] = useReducer(count => count + 1, 0);
  const worldVersion = useWorldVersion();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("discharge");
  const [sortDirection, setSortDirection] = useState<SortDirection>("down");
  const bulk = useBulkSelection();

  const scale = typeof distanceScale === "number" ? distanceScale : 1;
  const unit = typeof distanceUnitInput !== "undefined" && distanceUnitInput ? distanceUnitInput.value : "";

  // Build one row per search-filtered river. The search matches name, type, OR
  // basin (main stem) name, resolved through the precomputed riversById lookup
  // exactly as the legacy overview did. The footer averages follow the legacy
  // rounding: rn(mean) first, then scale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount and worldVersion intentionally re-read the accessor.
  const view = useMemo(() => {
    const allRivers = getRivers();
    const riversById = getRiversById();
    const searchText = search.toLowerCase().trim();
    const filtered = searchText
      ? allRivers.filter(river => {
          const name = (river.name || "").toLowerCase();
          const type = (river.type || "").toLowerCase();
          const basin = riversById.get(river.basin);
          const basinName = basin ? (basin.name || "").toLowerCase() : "";
          return name.includes(searchText) || type.includes(searchText) || basinName.includes(searchText);
        })
      : allRivers;

    const rows = filtered.map(river => {
      return {
        id: river.i,
        name: river.name,
        type: river.type,
        discharge: river.discharge,
        dischargeLabel: `${river.discharge} m³/s`,
        rawLength: river.length,
        lengthLabel: `${rn(river.length * scale)} ${unit}`,
        rawWidth: river.width,
        widthLabel: `${rn(river.width * scale, 3)} ${unit}`,
        basinName: riversById.get(river.basin)?.name ?? ""
      } satisfies RiverRow;
    });

    const averageDischarge = roundedMean(filtered.map(river => river.discharge));
    const averageLength = roundedMean(filtered.map(river => river.length));
    const averageWidth = roundedMean(
      filtered.map(river => river.width),
      3
    );

    return {
      rows,
      filteredCount: filtered.length,
      totalCount: allRivers.length,
      averageDischargeLabel: `${averageDischarge} m³/s`,
      averageLengthLabel: `${averageLength * scale} ${unit}`,
      averageWidthLabel: `${rn(averageWidth * scale, 3)} ${unit}`
    };
  }, [search, scale, unit, refreshCount, worldVersion]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "down" ? -1 : 1;

    function alphaValue(row: RiverRow): string {
      if (sortKey === "name") return row.name;
      if (sortKey === "type") return row.type;
      return row.basinName;
    }

    function numericValue(row: RiverRow): number {
      if (sortKey === "discharge") return row.discharge;
      if (sortKey === "length") return row.rawLength;
      return row.rawWidth;
    }

    return [...view.rows].sort((first, second) => {
      if (ALPHABETICAL_KEYS.has(sortKey)) return alphaValue(first).localeCompare(alphaValue(second)) * direction;
      return (numericValue(first) - numericValue(second)) * direction;
    });
  }, [view.rows, sortKey, sortDirection]);

  function handleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection(current => (current === "down" ? "up" : "down"));
      return;
    }
    setSortKey(key);
    // Legacy sortLines: a fresh alphabetical column starts ascending, a fresh
    // numeric column starts descending.
    setSortDirection(ALPHABETICAL_KEYS.has(key) ? "up" : "down");
  }

  function headerClassName(key: SortKey): string {
    return sortableHeaderClass(key === sortKey, ALPHABETICAL_KEYS.has(key), sortDirection);
  }

  // --- map side-effects (existing globals, guarded for absence) ---

  function ensureRiversLayerOn(): void {
    if (typeof layerIsOn !== "function" || typeof toggleRivers !== "function") return;
    if (!layerIsOn("toggleRivers")) toggleRivers();
  }

  function handleHighlightOn(id: number): void {
    if (typeof rivers === "undefined" || !rivers) return;
    ensureRiversLayerOn();
    rivers.select(`#river${id}`).attr("stroke", "red").attr("stroke-width", 1);
  }

  function handleHighlightOff(id: number): void {
    if (typeof rivers === "undefined" || !rivers) return;
    rivers.select(`#river${id}`).attr("stroke", null).attr("stroke-width", null);
  }

  function handleZoom(id: number): void {
    if (typeof rivers === "undefined" || !rivers || typeof highlightElement !== "function") return;
    const riverNode = rivers.select(`#river${id}`).node() as Element | null;
    if (riverNode) highlightElement(riverNode, 3);
  }

  function handleEdit(id: number): void {
    if (typeof editRiver === "function") editRiver(`river${id}`);
  }

  function handleAddOnClick(): void {
    if (typeof toggleAddRiver === "function") toggleAddRiver();
  }

  function handleCreateNew(): void {
    if (typeof createRiver === "function") createRiver();
  }

  // Toggle the legacy basin-highlight mode: tint every river path by its basin,
  // cycling ten colors (a pure renderer side-effect on the rivers layer; the
  // "hightlighted" marker attribute keeps the legacy spelling).
  function handleBasinHighlight(): void {
    if (typeof rivers === "undefined" || !rivers) return;
    if (rivers.attr("data-basin") === "hightlighted") {
      rivers.selectAll("*").attr("fill", null);
      rivers.attr("data-basin", null);
      return;
    }
    rivers.attr("data-basin", "hightlighted");
    const allRivers = getRivers();
    const basins = [...new Set(allRivers.map(river => river.basin))];
    basins.forEach((basin, index) => {
      const color = BASIN_COLORS[index % BASIN_COLORS.length];
      for (const river of allRivers) {
        if (river.basin === basin) rivers.select(`#river${river.i}`).attr("fill", color);
      }
    });
  }

  // --- row and footer mutations (accessor + notifyWorldChanged at this call site) ---

  function handleRemove(id: number): void {
    confirmationDialog({
      title: "Remove river",
      message: "Are you sure you want to remove the river? All tributaries will be auto-removed",
      confirm: "Remove",
      onConfirm: () => {
        removeRiver(id);
        notifyWorldChanged();
      }
    });
  }

  function handleRemoveAll(): void {
    confirmationDialog({
      title: "Remove all rivers",
      message: "Are you sure you want to remove all rivers?",
      confirm: "Remove",
      onConfirm: () => {
        removeAllRivers();
        // Clearing the rendered paths is the renderer side-effect the legacy
        // remove-all did alongside the pack reset.
        if (typeof rivers !== "undefined" && rivers) rivers.selectAll("*").remove();
        notifyWorldChanged();
      }
    });
  }

  // --- bulk mode (the shared in-surface bulk selection; see ../bulk-selection) ---

  const visibleIds = sortedRows.map(row => row.id);

  // Removing a river also removes every river whose parent or basin it is, so
  // the summary counts that union — not just the selected rows (the same
  // arithmetic the deleted rivers bulk adapter used).
  function describeCascade(ids: number[]): CascadeSummary {
    const allRivers = getRivers();
    const existingIds = new Set(allRivers.map(river => river.i));
    const selectedIds = new Set(ids.filter(id => existingIds.has(id)));

    const removedIds = new Set<number>();
    for (const river of allRivers) {
      if (selectedIds.has(river.i) || selectedIds.has(river.parent) || selectedIds.has(river.basin)) {
        removedIds.add(river.i);
      }
    }

    const tributaries = removedIds.size - selectedIds.size;
    const lines = [`${plural(removedIds.size, "river")} will be removed`];
    if (tributaries > 0) lines.push(`includes ${tributaries} auto-removed from the selected basins`);

    return { lines, deletable: selectedIds.size, skippedLocked: 0 };
  }

  function handleBulkDelete(): void {
    // Never mutate the pack while a manual-assignment/regeneration mode is
    // active (same guard the legacy bulk bar had).
    if (customizationActive()) return;
    const ids = [...bulk.selected];
    bulkDeleteConfirm({
      typeLabel: "rivers",
      describe: () => describeCascade(ids),
      onConfirm: () => {
        // removeRiver cascades to tributaries and no-ops on already-removed
        // ids, so deleting a selection that contains both a stem and its
        // tributary is safe.
        for (const id of ids) removeRiver(id);
        const remainingIds = new Set(getRivers().map(river => river.i));
        bulk.pruneSelected(id => remainingIds.has(id));
        notifyWorldChanged();
      }
    });
  }

  // The rendered rows drive the CSV so it matches the visible (filtered +
  // sorted) table, exactly like the legacy export that read the row DOM.
  function handleExport(): void {
    const header = "Id,River,Type,Discharge,Length,Width,Basin";
    const lines = sortedRows.map(row =>
      [
        String(row.id),
        csvField(row.name),
        csvField(row.type),
        row.dischargeLabel,
        row.lengthLabel,
        row.widthLabel,
        csvField(row.basinName)
      ].join(",")
    );
    const csv = `${[header, ...lines].join("\n")}\n`;
    downloadFile(csv, `${getFileName("Rivers")}.csv`);
  }

  return (
    <Panel title="Rivers Overview" anchor={anchor} onClose={onClose}>
      <div className="header" style={{ gridTemplateColumns: "9em 4em 7em 5em 5em 9em" }}>
        <SortHeader
          label="River"
          sortKey="name"
          className={headerClassName("name")}
          dataTip="Click to sort by river name"
          onSort={handleSort}
        />
        <SortHeader
          label="Type"
          sortKey="type"
          className={headerClassName("type")}
          dataTip="Click to sort by river type name"
          onSort={handleSort}
        />
        <SortHeader
          label="Discharge"
          sortKey="discharge"
          className={headerClassName("discharge")}
          dataTip="Click to sort by discharge (flux in m3/s)"
          onSort={handleSort}
        />
        <SortHeader
          label="Length"
          sortKey="length"
          className={headerClassName("length")}
          dataTip="Click to sort by river length"
          onSort={handleSort}
        />
        <SortHeader
          label="Width"
          sortKey="width"
          className={headerClassName("width")}
          dataTip="Click to sort by river mouth width"
          onSort={handleSort}
        />
        <SortHeader
          label="Basin"
          sortKey="basin"
          className={headerClassName("basin")}
          dataTip="Click to sort by river basin"
          onSort={handleSort}
        />
      </div>
      {/* Keeps the legacy element id so general.js's map-hover
          highlightEditorLine still finds the open overview's rows (it probes
          #riversOverview and matches div[data-id]) — same pattern as
          MilitaryOverview; heals when general.js converts. */}
      <div id="riversOverview" className="table">
        {sortedRows.map(row => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only map highlight (legacy row mouseenter/mouseleave); keyboard users reach the same river via the row's Locate button.
          <div
            key={row.id}
            className="states"
            data-id={row.id}
            data-name={row.name}
            data-type={row.type}
            data-discharge={row.discharge}
            data-length={row.rawLength}
            data-width={row.rawWidth}
            data-basin={row.basinName}
            onMouseEnter={() => handleHighlightOn(row.id)}
            onMouseLeave={() => handleHighlightOff(row.id)}
          >
            <BulkRowCheckbox selection={bulk} id={row.id} label={`Select ${row.name}`} />
            <RowIcon
              className="icon-target"
              tip="Locate the river"
              label="Locate the river"
              onClick={() => handleZoom(row.id)}
            />
            <div data-tip="River name" className="riverName" style={{ marginLeft: "0.4em" }}>
              {row.name}
            </div>
            <div data-tip="River type name" className="riverType">
              {row.type}
            </div>
            <div data-tip="River discharge (flux power)" className="biomeArea">
              {row.dischargeLabel}
            </div>
            <div data-tip="River length from source to mouth" className="biomeArea">
              {row.lengthLabel}
            </div>
            <div data-tip="River mouth width" className="biomeArea">
              {row.widthLabel}
            </div>
            <input
              data-tip="River basin (name of the main stem)"
              className="stateName"
              value={row.basinName}
              disabled
            />
            <RowIcon className="icon-pencil" tip="Edit river" label="Edit river" onClick={() => handleEdit(row.id)} />
            <RowIcon
              className="icon-trash-empty"
              tip="Remove river"
              label="Remove river"
              onClick={() => handleRemove(row.id)}
            />
          </div>
        ))}
      </div>
      <div className="totalLine">
        <div data-tip="Rivers number" style={{ marginLeft: "4px" }}>
          Rivers:&nbsp;
          <span>
            {view.filteredCount} of {view.totalCount}
          </span>
        </div>
        <div data-tip="Average discharge" style={{ marginLeft: "12px" }}>
          Average discharge:&nbsp;<span>{view.averageDischargeLabel}</span>
        </div>
        <div data-tip="Average length" style={{ marginLeft: "12px" }}>
          Length:&nbsp;<span>{view.averageLengthLabel}</span>
        </div>
        <div data-tip="Average mouth width" style={{ marginLeft: "12px" }}>
          Width:&nbsp;<span>{view.averageWidthLabel}</span>
        </div>
      </div>
      <div>
        <button
          type="button"
          id="riversOverviewRefresh"
          data-tip="Refresh the Editor"
          className="icon-cw"
          aria-label="Refresh"
          onClick={refresh}
        />
        <button
          type="button"
          id="addNewRiver"
          data-tip="Automatically add river starting from clicked cell. Hold Shift to add multiple"
          className="icon-plus"
          aria-label="Add river on click"
          onClick={handleAddOnClick}
        />
        <button
          type="button"
          data-tip="Create a new river selecting river cells"
          className="icon-map-pin"
          aria-label="Create a new river"
          onClick={handleCreateNew}
        />
        <button
          type="button"
          data-tip="Toggle basin highlight mode"
          className="icon-sitemap"
          aria-label="Toggle basin highlight"
          onClick={handleBasinHighlight}
        />
        <button
          type="button"
          data-tip="Save rivers-related data as a text file (.csv)"
          className="icon-download"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
        <button
          type="button"
          data-tip="Remove all rivers"
          className="icon-trash"
          aria-label="Remove all rivers"
          onClick={handleRemoveAll}
        />
        <BulkControls
          selection={bulk}
          visibleIds={visibleIds}
          toggleTip="Bulk select: pick multiple rows, then delete at once"
          onDelete={handleBulkDelete}
        />
        <label data-tip="Filter by name, type or basin" style={{ marginLeft: "0.2em" }}>
          Search: <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
    </Panel>
  );
}
