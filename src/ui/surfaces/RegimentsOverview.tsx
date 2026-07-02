import { pointer, select } from "d3";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { bulkDeleteConfirm } from "@/controllers/bulk-action/bulk-delete-confirm";
import {
  decodeId,
  describeRegimentsCascade,
  encodeId,
  isRegimentDeletable,
  removeRegimentData
} from "@/controllers/regiments-cascade";
import { lazy } from "@/lazy-loaders";
import { findEl } from "@/utils/nodeUtils";
import { capitalize } from "@/utils/stringUtils";
import { si } from "@/utils/unitUtils";
import { BulkControls, BulkRowCheckbox, customizationActive, useBulkSelection } from "../bulk-selection";
import { Panel } from "../Panel";
import { RowIcon } from "../RowIcon";
import { SortHeader, useSortState } from "../SortHeader";
import { useWorldVersion } from "../use-world-version";
import { addRegiment, getMilitaryUnits, getRegiments, getStates, notifyWorldChanged } from "../world-state";

interface RegimentsOverviewProps {
  /** State id the filter starts on (-1 for all) — the `open(state)` seam's argument. */
  stateId?: number;
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// Sort columns match the legacy header `data-sortby` values: state/name sort
// alphabetically, each configured unit and the total numerically. Unit columns
// are dynamic (options.military), so the key is a string, not a closed union.
// The legacy header shipped with `icon-sort-number-down` on Total, so the table
// starts sorted by total descending.
const ALPHABETICAL_KEYS: ReadonlySet<string> = new Set(["state", "name"]);

// One regiment line: the composite row id (stateId + regimentId — a regiment's
// `i` is only unique within its state), the owning state's display fields, and
// the per-unit counts the dynamic columns render from.
interface RegimentRow {
  id: number;
  stateId: number;
  regimentId: number;
  stateName: string;
  stateFullName: string;
  stateColor: string;
  name: string;
  icon: string;
  unitCounts: Record<string, number>;
  total: number;
}

/** True for image icons (URL or data URI) the legacy row rendered as an <img>. */
function isExternalIcon(icon: string): boolean {
  return icon.startsWith("http") || icon.startsWith("data:image");
}

/**
 * RegimentsOverview — the Regiments Overview surface, at parity with the legacy
 * `src/controllers/regiments-overview.ts` jQuery-UI dialog (Phase 3 Slice 6, the
 * first medium-tier conversion: a table with map side-effects).
 *
 * Reads states/regiments/unit-options through the World-State accessor (never
 * raw `window.pack`/`options`) and re-reads on any world change via
 * `useWorldVersion` — which is also how the regiment editor's edits reach it
 * (its call sites signal `notifyWorldChanged` instead of the old find-and-
 * refresh). Deletion goes through the shared `regiments-cascade` domain logic
 * (the same cascade single-delete uses, keyed by composite ids) and signals
 * here, at the call site; removing the dead `#armies` regiment groups is this
 * surface's renderer side-effect. Map side-effects (row-hover army highlight,
 * the click-to-add-regiment mode, `drawRegiment`) call the existing globals,
 * guarded for absence. The legacy `BulkActionBar` is replaced by the shared
 * in-surface bulk mode (`../bulk-selection`, select + delete only — regiments
 * have no lock or color).
 */
export function RegimentsOverview({ stateId = -1, anchor, onClose }: RegimentsOverviewProps) {
  const [refreshCount, refresh] = useReducer(count => count + 1, 0);
  const worldVersion = useWorldVersion();

  // The filter defaults to the seam's state when it is a valid state, else "all"
  // (the legacy select fell back to its first option for an unknown id).
  const [stateFilter, setStateFilter] = useState(() => (getStates().some(state => state.i === stateId) ? stateId : -1));
  const { sortKey, sortDirection, handleSort, headerClassName } = useSortState<string>("total", "down", key =>
    ALPHABETICAL_KEYS.has(key)
  );
  const [percentage, setPercentage] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const bulk = useBulkSelection();

  // The add-on-click handler reads the CURRENT filter (the legacy handler read
  // the live select), but it is bound to the map once, when the mode turns on —
  // so it reads through refs, not the closure.
  const stateFilterRef = useRef(stateFilter);
  stateFilterRef.current = stateFilter;
  const addModeRef = useRef(false);

  // Build one row per (state, regiment) pair for the current filter, plus the
  // per-column totals the percentage mode and the footer render from.
  // refreshCount and worldVersion are deliberate cache-busters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount and worldVersion intentionally re-read the accessor.
  const view = useMemo(() => {
    const units = getMilitaryUnits();
    const rows = getRegiments(stateFilter).map(({ state, regiment }) => {
      const unitCounts: Record<string, number> = {};
      for (const unit of units) unitCounts[unit.name] = regiment.u[unit.name] || 0;
      return {
        id: encodeId(state.i, regiment.i),
        stateId: state.i,
        regimentId: regiment.i,
        stateName: state.name,
        stateFullName: state.fullName ?? state.name,
        stateColor: state.color ?? "#999999",
        name: regiment.name,
        icon: regiment.icon ?? "",
        unitCounts,
        total: regiment.a
      } satisfies RegimentRow;
    });

    // Column totals over the DISPLAYED rows — both the percentage denominators
    // and the footer sums (the legacy overview computed them the same way).
    const unitTotals: Record<string, number> = {};
    for (const unit of units) {
      unitTotals[unit.name] = rows.reduce((sum, row) => sum + row.unitCounts[unit.name], 0);
    }
    const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

    return { units, rows, unitTotals, grandTotal };
  }, [stateFilter, refreshCount, worldVersion]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "down" ? -1 : 1;

    function alphaValue(row: RegimentRow): string {
      return sortKey === "state" ? row.stateName : row.name;
    }

    function numericValue(row: RegimentRow): number {
      return sortKey === "total" ? row.total : row.unitCounts[sortKey] || 0;
    }

    return [...view.rows].sort((first, second) => {
      if (ALPHABETICAL_KEYS.has(sortKey)) {
        const firstValue = alphaValue(first);
        const secondValue = alphaValue(second);
        // Plain string comparison, exactly like the legacy applySorting.
        const order = firstValue > secondValue ? 1 : firstValue < secondValue ? -1 : 0;
        return order * direction;
      }
      return (numericValue(first) - numericValue(second)) * direction;
    });
  }, [view.rows, sortKey, sortDirection]);

  /** A unit/total cell's text: the absolute count, or its share of the column total. */
  function cellText(value: number, columnTotal: number): string {
    if (!percentage) return String(value);
    return columnTotal ? `${Math.round((value / columnTotal) * 100)}%` : "0%";
  }

  // --- map side-effects (existing globals, guarded for absence) ---

  function armyGroupSelector(row: Pick<RegimentRow, "stateId" | "regimentId">): string {
    return `#armies > g > g#regiment${row.stateId}-${row.regimentId}`;
  }

  function handleHighlightOn(row: RegimentRow): void {
    if (customizationActive() || !row.stateId) return;
    select(armyGroupSelector(row)).transition().duration(2000).style("fill", "#ff0000");
  }

  function handleHighlightOff(row: RegimentRow): void {
    select(armyGroupSelector(row)).transition().duration(1000).style("fill", null);
  }

  async function handleEdit(row: RegimentRow): Promise<void> {
    const { RegimentEditor } = await lazy.regimentEditor();
    RegimentEditor.open(`#regiment${row.stateId}-${row.regimentId}`);
  }

  // Remove the SVG army group of every regiment that no longer exists in the
  // data — the renderer side-effect of a (bulk) delete, kept exactly as the
  // legacy redraw did it. `isRegimentDeletable` is the same "still exists in a
  // live state" predicate the legacy check inlined.
  function removeDeletedArmyGroups(): void {
    const armyGroups = document.querySelectorAll<SVGGElement>("#armies > g > g[id^='regiment']");
    armyGroups.forEach(group => {
      const groupStateId = Number(group.dataset.state);
      const groupRegimentId = Number(group.dataset.id);
      const stillExists = isRegimentDeletable(encodeId(groupStateId, groupRegimentId));
      if (!stillExists) group.remove();
    });
  }

  // --- the click-to-add-regiment mode ---

  // The map-side half of the add mode: crosshair cursor + a click handler while
  // on; default cursor + the classic map click handler while off. The legacy
  // overview also mirrored the regiment editor's Add button's pressed state.
  function applyAddModeSideEffects(on: boolean): void {
    const regimentAddButton = findEl("regimentAdd");
    if (on) {
      select<SVGGElement, unknown>("#viewbox").style("cursor", "crosshair").on("click", handleAddRegimentClick);
      if (typeof tip === "function") tip("Click on map to create new regiment or fleet", true);
      if (regimentAddButton?.offsetParent) regimentAddButton.classList.add("pressed");
    } else {
      if (typeof clearMainTip === "function") clearMainTip();
      // `clicked` is unported classic code that reads the legacy `d3.event` global, so this one
      // rebind must go through the classic v5 `viewbox` selection, not a fresh v7 one
      if (typeof viewbox !== "undefined" && typeof clicked === "function") {
        viewbox.on("click", clicked).style("cursor", "default");
      }
      if (regimentAddButton?.offsetParent) regimentAddButton.classList.remove("pressed");
    }
  }

  function setAddModeAndSideEffects(on: boolean): void {
    if (addModeRef.current === on) return;
    addModeRef.current = on;
    applyAddModeSideEffects(on);
    setAddMode(on);
  }

  function handleAddRegimentClick(this: SVGGElement, event: MouseEvent): void {
    const filterStateId = stateFilterRef.current;
    if (filterStateId === -1) {
      if (typeof tip === "function") tip("Please select state from the list", false, "error");
      return;
    }

    if (typeof findCell !== "function") return;
    const point = pointer(event, this);
    const cell = findCell(point[0], point[1]);
    if (cell === undefined) return;

    const regiment = addRegiment(filterStateId, cell);
    if (!regiment) return;
    if (typeof drawRegiment === "function") drawRegiment(regiment, filterStateId);
    setAddModeAndSideEffects(false);
    notifyWorldChanged();
  }

  // Always leave the add mode off when the surface unmounts. (The legacy dialog
  // leaked the crosshair mode on close; here the handler's inputs unmount with
  // the panel, so cleanup is required, not optional.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup; the side-effect helper is stable in what it touches (globals + a ref).
  useEffect(() => {
    return () => {
      if (addModeRef.current) applyAddModeSideEffects(false);
    };
  }, []);

  // --- bulk mode (the shared in-surface bulk selection; see ../bulk-selection) ---

  const visibleIds = sortedRows.map(row => row.id);

  function handleBulkDelete(): void {
    // Never mutate the pack while a manual-assignment/regeneration mode is
    // active (same guard the legacy bulk bar had).
    if (customizationActive()) return;
    const ids = [...bulk.selected];
    bulkDeleteConfirm({
      typeLabel: "regiments",
      describe: () => describeRegimentsCascade(ids),
      onConfirm: () => {
        for (const id of ids) {
          if (!isRegimentDeletable(id)) continue;
          const { stateId: targetStateId, regimentId } = decodeId(id);
          removeRegimentData(targetStateId, regimentId);
        }
        removeDeletedArmyGroups();
        const remainingIds = new Set(getRegiments(-1).map(row => encodeId(row.state.i, row.regiment.i)));
        bulk.pruneSelected(id => remainingIds.has(id));
        notifyWorldChanged();
      }
    });
  }

  // Exports EVERY regiment (all states, ignoring the filter), byte-identical to
  // the legacy downloadRegimentsData — including units a regiment lacks joining
  // as empty fields and the trailing newline.
  function handleExport(): void {
    const unitNames = getMilitaryUnits().map(unit => unit.name);
    let data = `State,Id,Icon,Name,${unitNames.map(unit => capitalize(unit)).join(",")},X,Y,Latitude,Longitude,Base X,Base Y,Base Latitude,Base Longitude\n`; // headers

    for (const { state, regiment } of getRegiments(-1)) {
      data += `${state.name},`;
      data += `${regiment.i},`;
      data += `${regiment.icon},`;
      data += `${regiment.name},`;
      data += `${unitNames.map(unit => regiment.u[unit]).join(",")},`;

      data += `${regiment.x},`;
      data += `${regiment.y},`;
      data += `${getLatitude(regiment.y, 2)},`;
      data += `${getLongitude(regiment.x, 2)},`;

      data += `${regiment.bx},`;
      data += `${regiment.by},`;
      data += `${getLatitude(regiment.by, 2)},`;
      data += `${getLongitude(regiment.bx, 2)}\n`;
    }

    downloadFile(data, `${getFileName("Regiments")}.csv`);
  }

  const filterStates = [...getStates()].sort((first, second) => (first.name > second.name ? 1 : -1));

  return (
    <Panel title="Regiments Overview" anchor={anchor} onClose={onClose}>
      <div className="header" style={{ gridTemplateColumns: `9em 13em repeat(${view.units.length}, 5.2em) 7em` }}>
        <SortHeader
          label="State"
          sortKey="state"
          className={headerClassName("state")}
          dataTip="State name. Click to sort"
          onSort={handleSort}
        />
        <SortHeader
          label="Name"
          sortKey="name"
          className={headerClassName("name")}
          dataTip="Regiment emblem and name. Click to sort by name"
          onSort={handleSort}
        />
        {view.units.map(unit => (
          <SortHeader
            key={unit.name}
            label={capitalize(unit.name.replace(/_/g, " "))}
            sortKey={unit.name}
            className={headerClassName(unit.name)}
            dataTip={`Regiment ${unit.name} units number. Click to sort`}
            onSort={handleSort}
          />
        ))}
        <SortHeader
          label="Total"
          sortKey="total"
          className={headerClassName("total")}
          dataTip="Total military personnel (not considering crew). Click to sort"
          onSort={handleSort}
        />
      </div>
      <div className="table" data-type={percentage ? "percentage" : "absolute"}>
        {sortedRows.map(row => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only map highlight (legacy row mouseenter/mouseleave); keyboard users reach the same regiment via the row's Edit button.
          <div
            key={row.id}
            className="states"
            data-id={row.regimentId}
            data-s={row.stateId}
            data-state={row.stateName}
            data-name={row.name}
            data-total={row.total}
            onMouseEnter={() => handleHighlightOn(row)}
            onMouseLeave={() => handleHighlightOff(row)}
          >
            <BulkRowCheckbox selection={bulk} id={row.id} label={`Select ${row.name}`} />
            <fill-box data-tip={row.stateFullName} fill={row.stateColor} disabled />
            <input data-tip={row.stateFullName} style={{ width: "6em" }} value={row.stateName} readOnly />
            {isExternalIcon(row.icon) ? (
              <img
                src={row.icon}
                alt=""
                data-tip="Regiment's emblem"
                style={{ width: "1.2em", height: "1.2em", verticalAlign: "middle" }}
              />
            ) : (
              <span data-tip="Regiment's emblem" style={{ width: "1em" }}>
                {row.icon}
              </span>
            )}
            <input data-tip="Regiment's name" style={{ width: "13em" }} value={row.name} readOnly />
            {view.units.map(unit => (
              <div
                key={unit.name}
                data-type={unit.name}
                data-tip={`${capitalize(unit.name)} units number`}
                style={{ width: "5em" }}
              >
                {cellText(row.unitCounts[unit.name], view.unitTotals[unit.name])}
              </div>
            ))}
            <div
              data-type="total"
              data-tip="Total military personnel (not considering crew)"
              style={{ width: "5em", fontWeight: "bold" }}
            >
              {cellText(row.total, view.grandTotal)}
            </div>
            <RowIcon
              className="icon-pencil pointer"
              tip="Edit regiment"
              label="Edit regiment"
              onClick={() => handleEdit(row)}
            />
          </div>
        ))}
        <div className="totalLine" data-tip="Total of all displayed regiments">
          <div style={{ width: "21em", marginLeft: "1em" }}>Regiments: {view.rows.length}</div>
          {view.units.map(unit => (
            <div key={unit.name} style={{ width: "5em" }}>
              {si(view.unitTotals[unit.name])}
            </div>
          ))}
          <div style={{ width: "5em" }}>{si(view.grandTotal)}</div>
        </div>
      </div>
      <div>
        <button
          type="button"
          data-tip="Refresh the overview screen"
          className="icon-cw"
          aria-label="Refresh"
          onClick={refresh}
        />
        <button
          type="button"
          data-tip="Toggle percentage / absolute values views"
          className="icon-percent"
          aria-label="Toggle percentage / absolute values views"
          onClick={() => setPercentage(current => !current)}
        />
        <button
          type="button"
          data-tip="Add new Regiment"
          className={addMode ? "icon-user-plus pressed" : "icon-user-plus"}
          aria-label="Add new Regiment"
          onClick={() => setAddModeAndSideEffects(!addModeRef.current)}
        />
        <div data-tip="Select state" style={{ display: "inline-block" }}>
          <span>State: </span>
          <select
            aria-label="Select state"
            value={stateFilter}
            onChange={event => setStateFilter(Number(event.target.value))}
          >
            <option value={-1}>all</option>
            {filterStates.map(state => (
              <option key={state.i} value={state.i}>
                {state.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          data-tip="Save military-related data as a text file (.csv)"
          className="icon-download"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
        <BulkControls
          selection={bulk}
          visibleIds={visibleIds}
          toggleTip="Bulk select: pick multiple rows, then delete at once"
          onDelete={handleBulkDelete}
        />
      </div>
    </Panel>
  );
}
