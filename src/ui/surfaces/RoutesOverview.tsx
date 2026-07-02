import { useMemo, useReducer, useState } from "react";
import { bulkDeleteConfirm } from "@/controllers/bulk-action/bulk-delete-confirm";
import type { CascadeSummary } from "@/controllers/bulk-action/bulk-entity-adapter";
import type { Route } from "@/generators/routes-generator";
import { rn } from "@/utils/numberUtils";
import { plural } from "@/utils/stringUtils";
import { csvField } from "../csv";
import { Panel } from "../Panel";
import { type SortDirection, SortHeader, sortableHeaderClass } from "../SortHeader";
import { useWorldVersion } from "../use-world-version";
import {
  getRouteLength,
  getRouteName,
  getRoutes,
  notifyWorldChanged,
  rebuildRouteLinks,
  removeRoute,
  setRouteLock
} from "../world-state";

interface RoutesOverviewProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// Sort columns match the legacy header `data-sortby` values. name/group sort
// alphabetically; length sorts numerically. The legacy header shipped with
// `icon-sort-number-down` on Length, so the table starts sorted by length
// descending.
type SortKey = "name" | "group" | "length";

// One route line: the id, display name/group, the raw (unscaled) length the
// legacy `data-length` sorted on, its scaled display label, and the lock flag.
interface RouteRow {
  id: number;
  name: string;
  group: string;
  rawLength: number;
  lengthLabel: string;
  locked: boolean;
}

// The tips `showElementLockTip` showed on hover, reproduced as static data-tip
// strings (the global tooltip handler reads data-tip on mousemove).
const LOCKED_TIP = "Locked. Click to unlock the element and allow it to be changed by regeneration tools";
const UNLOCKED_TIP = "Unlocked. Click to lock the element and prevent changes to it by regeneration tools";

/** True while a customization/manual-assignment mode is active (guarded read of the legacy global). */
function customizationActive(): boolean {
  return typeof customization !== "undefined" && Boolean(customization);
}

/**
 * A legacy-look icon action rendered inside a `.states` row. Stays a `<span>`
 * (not a `<button>`) so the `.states > [class^="icon-"]` row CSS applies
 * unchanged; the role/tabIndex/keydown give it button semantics.
 */
function RowIcon(props: { className: string; tip: string; label: string; onClick: () => void }) {
  const { className, tip, label, onClick } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: must stay a <span> so the legacy `.states` row CSS lays it out; the keyboard handler gives it button semantics.
    <span
      role="button"
      tabIndex={0}
      className={className}
      data-tip={tip}
      aria-label={label}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
    />
  );
}

/**
 * RoutesOverview — the Routes Overview surface, at parity with the legacy
 * `public/modules/ui/routes-overview.js` jQuery-UI dialog (the first legacy-JS
 * overview converted per the frozen recipe).
 *
 * Reads routes through the World-State accessor (never raw `window.pack`) and
 * re-reads on any world change via `useWorldVersion`. Row mutations (lock,
 * remove) and the bulk actions go through the accessor's domain-core wrappers
 * and signal `notifyWorldChanged()` here, at the call site. Map side-effects
 * (route highlight, zoom-to-route, the route editor and creator) call the
 * existing globals, guarded for absence. The legacy `window.bulkBars` DOM-glue
 * bar is replaced by the in-surface bulk mode below (same controls, React
 * state instead of DOM mutation) — the shared React bulk bar remains Phase 4.
 */
export function RoutesOverview({ anchor, onClose }: RoutesOverviewProps) {
  const [refreshCount, refresh] = useReducer(count => count + 1, 0);
  const worldVersion = useWorldVersion();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("length");
  const [sortDirection, setSortDirection] = useState<SortDirection>("down");
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const scale = typeof distanceScale === "number" ? distanceScale : 1;
  const unit = typeof distanceUnitInput !== "undefined" && distanceUnitInput ? distanceUnitInput.value : "";

  // Build one row per displayable route (>= 2 points, legacy parity) from the
  // search-filtered list. Reading a row materializes (and persists) a missing
  // name/length exactly as the legacy overview did. The footer counts every
  // search-filtered route, including point-less ones that render no row; the
  // average skips routes without a measured length (legacy d3.mean semantics).
  // refreshCount and worldVersion are deliberate cache-busters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount and worldVersion intentionally re-read the accessor.
  const view = useMemo(() => {
    const allRoutes = getRoutes();
    const searchText = search.toLowerCase().trim();
    const filtered = searchText
      ? allRoutes.filter(route => {
          const name = (route.name || "").toLowerCase();
          const group = (route.group || "").toLowerCase();
          return name.includes(searchText) || group.includes(searchText);
        })
      : allRoutes;

    const rows = filtered
      .filter(route => route.points && route.points.length >= 2)
      .map(route => {
        const rawLength = getRouteLength(route);
        return {
          id: route.i,
          name: getRouteName(route),
          group: route.group,
          rawLength,
          lengthLabel: `${rn(rawLength * scale)} ${unit}`,
          locked: Boolean(route.lock)
        } satisfies RouteRow;
      });

    const measuredLengths = filtered
      .map(route => route.length)
      .filter((length): length is number => typeof length === "number" && !Number.isNaN(length));
    const meanLength = measuredLengths.length
      ? measuredLengths.reduce((sum, length) => sum + length, 0) / measuredLengths.length
      : 0;
    const averageLength = rn(meanLength) || 0;

    return {
      rows,
      filteredCount: filtered.length,
      totalCount: allRoutes.length,
      averageLabel: `${averageLength * scale} ${unit}`,
      allLocked: allRoutes.length > 0 && allRoutes.every(route => route.lock)
    };
  }, [search, scale, unit, refreshCount, worldVersion]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "down" ? -1 : 1;
    return [...view.rows].sort((first, second) => {
      if (sortKey === "length") return (first.rawLength - second.rawLength) * direction;
      const firstKey = sortKey === "name" ? first.name : first.group;
      const secondKey = sortKey === "name" ? second.name : second.group;
      return firstKey.localeCompare(secondKey) * direction;
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
    setSortDirection(key === "length" ? "down" : "up");
  }

  function headerClassName(key: SortKey): string {
    return sortableHeaderClass(key === sortKey, key !== "length", sortDirection);
  }

  function findRoute(id: number): Route | undefined {
    return getRoutes().find(route => route.i === id);
  }

  // --- map side-effects (existing globals, guarded for absence) ---

  function ensureRoutesLayerOn(): void {
    if (typeof layerIsOn !== "function" || typeof toggleRoutes !== "function") return;
    if (!layerIsOn("toggleRoutes")) toggleRoutes();
  }

  function handleHighlightOn(id: number): void {
    if (typeof routes === "undefined" || !routes) return;
    ensureRoutesLayerOn();
    routes.select(`#route${id}`).attr("stroke", "red").attr("stroke-width", 2).attr("stroke-dasharray", "none");
  }

  function handleHighlightOff(id: number): void {
    if (typeof routes === "undefined" || !routes) return;
    routes.select(`#route${id}`).attr("stroke", null).attr("stroke-width", null).attr("stroke-dasharray", null);
  }

  function handleZoom(id: number): void {
    if (typeof routes === "undefined" || !routes || typeof highlightElement !== "function") return;
    const routeNode = routes.select(`#route${id}`).node() as Element | null;
    if (routeNode) highlightElement(routeNode, 3);
  }

  function handleEdit(id: number): void {
    if (typeof editRoute === "function") editRoute(`route${id}`);
  }

  function handleCreateNew(): void {
    if (typeof createRoute === "function") createRoute();
  }

  // --- row and footer mutations (accessor + notifyWorldChanged at this call site) ---

  function handleLockToggle(id: number): void {
    const route = findRoute(id);
    if (!route) return;
    setRouteLock(route, !route.lock);
    notifyWorldChanged();
  }

  function handleLockAll(): void {
    const allRoutes = getRoutes();
    const allLocked = allRoutes.every(route => route.lock);
    for (const route of allRoutes) setRouteLock(route, !allLocked);
    notifyWorldChanged();
  }

  function handleRemove(id: number): void {
    confirmationDialog({
      title: "Remove route",
      message: "Are you sure you want to remove the route? <br>This action cannot be reverted",
      confirm: "Remove",
      onConfirm: () => {
        const route = findRoute(id);
        if (!route) return;
        removeRoute(route);
        notifyWorldChanged();
      }
    });
  }

  function handleRemoveAll(): void {
    const allRoutes = getRoutes();
    const toRemove = allRoutes.filter(route => !route.lock);
    if (!toRemove.length) {
      if (!allRoutes.length) {
        tip("There are no routes to remove", false, "error");
      } else {
        tip("All routes are locked. Unlock routes to remove them, or use Lock all to unlock first.", false, "error");
      }
      return;
    }

    const lockedCount = allRoutes.length - toRemove.length;
    confirmationDialog({
      title: lockedCount > 0 ? "Remove unlocked routes" : "Remove all routes",
      message:
        lockedCount > 0
          ? `Remove all <b>unlocked</b> routes (${toRemove.length})? <b>${lockedCount}</b> locked route(s) will be kept. This cannot be undone.`
          : "Are you sure you want to remove all routes? This action can't be undone",
      confirm: "Remove",
      onConfirm: () => {
        // Re-check at confirm time — the world may have changed while the
        // dialog was open (legacy parity).
        const currentRoutes = getRoutes();
        const routesToRemove = currentRoutes.filter(route => !route.lock);
        if (!routesToRemove.length) {
          if (!currentRoutes.length) {
            tip("There are no routes to remove", false, "error");
          } else {
            tip("All routes are now locked; nothing was removed.", false, "error");
          }
          return;
        }
        for (const route of routesToRemove) removeRoute(route);
        rebuildRouteLinks();
        notifyWorldChanged();
      }
    });
  }

  // --- bulk mode (replaces the legacy window.bulkBars DOM-glue for this surface) ---

  function toggleBulkMode(): void {
    setBulkMode(current => {
      if (current) setSelected(new Set());
      return !current;
    });
  }

  function toggleSelected(id: number): void {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = sortedRows.map(row => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  function handleSelectAll(): void {
    setSelected(current => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function describeCascade(ids: number[]): CascadeSummary {
    const routeById = new Map(getRoutes().map(route => [route.i, route]));
    const selectedRoutes = ids.map(id => routeById.get(id)).filter((route): route is Route => Boolean(route));
    const deletable = selectedRoutes.filter(route => !route.lock).length;
    const skippedLocked = selectedRoutes.length - deletable;
    return { lines: [`${plural(deletable, "route")} will be removed`], deletable, skippedLocked };
  }

  function handleBulkDelete(): void {
    // Never mutate the pack while a manual-assignment/regeneration mode is
    // active (same guard the legacy bulk bar had).
    if (customizationActive()) return;
    const ids = [...selected];
    bulkDeleteConfirm({
      typeLabel: "routes",
      describe: () => describeCascade(ids),
      onConfirm: () => {
        const routeById = new Map(getRoutes().map(route => [route.i, route]));
        const deletedIds: number[] = [];
        for (const id of ids) {
          const route = routeById.get(id);
          if (!route || route.lock) continue; // skipped (locked) rows stay selected
          removeRoute(route);
          deletedIds.push(id);
        }
        setSelected(current => new Set([...current].filter(id => !deletedIds.includes(id))));
        notifyWorldChanged();
      }
    });
  }

  function handleBulkLock(locked: boolean): void {
    if (customizationActive()) return;
    const routeById = new Map(getRoutes().map(route => [route.i, route]));
    for (const id of selected) {
      const route = routeById.get(id);
      if (route) setRouteLock(route, locked);
    }
    notifyWorldChanged();
  }

  // The rendered rows drive the CSV so it matches the visible (filtered +
  // sorted) table, exactly like the legacy export that read the row DOM.
  function handleExport(): void {
    const header = "Id,Route,Group,Length";
    const lines = sortedRows.map(row =>
      [String(row.id), csvField(row.name), csvField(row.group), row.lengthLabel].join(",")
    );
    const csv = `${[header, ...lines].join("\n")}\n`;
    downloadFile(csv, `${getFileName("Routes")}.csv`);
  }

  return (
    <Panel title="Routes Overview" anchor={anchor} onClose={onClose}>
      <div className="header" style={{ gridTemplateColumns: "17em 8em 8em" }}>
        <SortHeader
          label="Route"
          sortKey="name"
          className={headerClassName("name")}
          dataTip="Click to sort by route name"
          onSort={handleSort}
        />
        <SortHeader
          label="Group"
          sortKey="group"
          className={headerClassName("group")}
          dataTip="Click to sort by route group"
          onSort={handleSort}
        />
        <SortHeader
          label="Length"
          sortKey="length"
          className={headerClassName("length")}
          dataTip="Click to sort by route length"
          onSort={handleSort}
        />
      </div>
      <div className="table">
        {sortedRows.map(row => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only map highlight (legacy row mouseenter/mouseleave); keyboard users reach the same route via the row's Locate button.
          <div
            key={row.id}
            className="states"
            data-id={row.id}
            data-name={row.name}
            data-group={row.group}
            data-length={row.rawLength}
            onMouseEnter={() => handleHighlightOn(row.id)}
            onMouseLeave={() => handleHighlightOff(row.id)}
          >
            {bulkMode && (
              <input
                type="checkbox"
                className="bulkRowCheckbox native"
                aria-label={`Select ${row.name}`}
                checked={selected.has(row.id)}
                onChange={() => toggleSelected(row.id)}
              />
            )}
            <RowIcon
              className="icon-target"
              tip="Locate the route"
              label="Locate the route"
              onClick={() => handleZoom(row.id)}
            />
            <div data-tip="Route name" style={{ width: "15em", marginLeft: "0.4em" }}>
              {row.name}
            </div>
            <div data-tip="Route group" style={{ width: "8em" }}>
              {row.group}
            </div>
            <div data-tip="Route length" style={{ width: "6em" }}>
              {row.lengthLabel}
            </div>
            <RowIcon className="icon-pencil" tip="Edit route" label="Edit route" onClick={() => handleEdit(row.id)} />
            <RowIcon
              className={`locks pointer ${row.locked ? "icon-lock" : "icon-lock-open inactive"}`}
              tip={row.locked ? LOCKED_TIP : UNLOCKED_TIP}
              label={row.locked ? "Unlock route" : "Lock route"}
              onClick={() => handleLockToggle(row.id)}
            />
            <RowIcon
              className="icon-trash-empty"
              tip="Remove route"
              label="Remove route"
              onClick={() => handleRemove(row.id)}
            />
          </div>
        ))}
      </div>
      <div className="totalLine">
        <div data-tip="Routes number" style={{ marginLeft: "4px" }}>
          Routes:&nbsp;
          <span>
            {view.filteredCount} of {view.totalCount}
          </span>
        </div>
        <div data-tip="Average length" style={{ marginLeft: "12px" }}>
          Average length:&nbsp;<span>{view.averageLabel}</span>
        </div>
      </div>
      <div>
        <button
          type="button"
          data-tip="Refresh the Editor"
          className="icon-cw"
          aria-label="Refresh"
          onClick={refresh}
        />
        <button
          type="button"
          data-tip="Create a new route selecting route cells"
          className="icon-map-pin"
          aria-label="Create a new route"
          onClick={handleCreateNew}
        />
        <button
          type="button"
          data-tip="Save routes-related data as a text file (.csv)"
          className="icon-download"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
        <button
          type="button"
          data-tip="Lock or unlock all routes"
          className={view.allLocked ? "icon-lock-open" : "icon-lock"}
          aria-label="Lock or unlock all routes"
          onClick={handleLockAll}
        />
        <button
          type="button"
          data-tip="Remove all unlocked routes (locked routes are kept)"
          className="icon-trash"
          aria-label="Remove all unlocked routes"
          onClick={handleRemoveAll}
        />
        <button
          type="button"
          data-tip="Bulk select: pick multiple rows, then delete/lock/recolor at once"
          className={`bulkToggle ${bulkMode ? "icon-ok-squared active" : "icon-check-empty"}`}
          aria-pressed={bulkMode}
          aria-label="Bulk select"
          onClick={toggleBulkMode}
        />
        {bulkMode && (
          <span className="bulkInline">
            <label className="bulkSelectAll" data-tip="Select or deselect all visible rows">
              <input
                type="checkbox"
                className="bulkSelectAllCheckbox native"
                checked={allVisibleSelected}
                ref={element => {
                  if (element) element.indeterminate = selected.size > 0 && !allVisibleSelected;
                }}
                onChange={handleSelectAll}
              />{" "}
              All
            </label>
            <span className="bulkCount">{selected.size} selected</span>
            <button
              type="button"
              className="bulkDelete icon-trash"
              data-tip="Delete selected rows"
              aria-label="Delete selected rows"
              onClick={handleBulkDelete}
            />
            <button
              type="button"
              className="bulkLock icon-lock"
              data-tip="Lock selected rows (protects from regeneration and bulk delete)"
              aria-label="Lock selected rows"
              onClick={() => handleBulkLock(true)}
            />
            <button
              type="button"
              className="bulkUnlock icon-lock-open"
              data-tip="Unlock selected rows"
              aria-label="Unlock selected rows"
              onClick={() => handleBulkLock(false)}
            />
          </span>
        )}
        <label data-tip="Filter by name or group" style={{ marginLeft: "0.2em" }}>
          Search: <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
    </Panel>
  );
}
