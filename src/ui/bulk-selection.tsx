import { useState } from "react";
import { bulkDeleteConfirm } from "@/controllers/bulk-action/bulk-delete-confirm";
import type { CascadeSummary } from "@/controllers/bulk-action/bulk-entity-adapter";
import { plural } from "@/utils/stringUtils";
import { notifyWorldChanged } from "./world-state";

/**
 * bulk-selection — the in-surface bulk mode shared by the converted overview
 * surfaces (routes, rivers, markers). It replaces the legacy `window.bulkBars`
 * DOM-glue bar per surface with React state, keeping the established semantics:
 * a toggle button, per-row checkboxes, select-all over the VISIBLE (filtered +
 * sorted) rows, an "N selected" count, and the selection cleared on exit.
 *
 * The action handlers over lockable entities (delete skipping locked rows,
 * lock/unlock) are shared too — see lockableBulkActions — parameterized on the
 * surface's entity-specific domain calls. The shared React bulk bar with
 * cross-surface mutation plumbing remains Phase 4.
 */

// The legacy BulkActionBar's toggle tooltip, kept as the default wording.
const DEFAULT_TOGGLE_TIP = "Bulk select: pick multiple rows, then delete/lock/recolor at once";

/** True while a customization/manual-assignment mode is active (guarded read of the legacy global). */
export function customizationActive(): boolean {
  return typeof customization !== "undefined" && Boolean(customization);
}

export interface BulkSelection {
  /** Whether bulk mode is on (row checkboxes visible). */
  bulkMode: boolean;
  /** The selected row ids. */
  selected: ReadonlySet<number>;
  /** Toggle bulk mode; leaving it clears the selection. */
  toggleBulkMode: () => void;
  /** Toggle one row in or out of the selection. */
  toggleSelected: (id: number) => void;
  /** Select every visible row, or deselect them all if all are already selected. */
  toggleAllVisible: (visibleIds: number[]) => void;
  /** Drop selected ids that no longer satisfy `keep` (e.g. after a delete). */
  pruneSelected: (keep: (id: number) => boolean) => void;
}

/** The bulk-selection state machine, one instance per overview surface. */
export function useBulkSelection(): BulkSelection {
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

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

  function toggleAllVisible(visibleIds: number[]): void {
    setSelected(current => {
      const next = new Set(current);
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => next.has(id));
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function pruneSelected(keep: (id: number) => boolean): void {
    setSelected(current => new Set([...current].filter(keep)));
  }

  return { bulkMode, selected, toggleBulkMode, toggleSelected, toggleAllVisible, pruneSelected };
}

interface LockableBulkParams<Entity> {
  selection: BulkSelection;
  /** Plural label for the confirm dialog ("routes", "markers"). */
  typeLabel: string;
  /** Singular noun for the cascade-summary count line ("route", "marker"). */
  noun: string;
  getAll: () => Entity[];
  getId: (entity: Entity) => number;
  isLocked: (entity: Entity) => boolean;
  /** Remove one (unlocked) entity, including any renderer side-effect. */
  remove: (entity: Entity) => void;
  setLock: (entity: Entity, locked: boolean) => void;
}

interface LockableBulkActions {
  handleBulkDelete: () => void;
  handleBulkLock: (locked: boolean) => void;
}

/**
 * The bulk-action pair shared by overviews of lockable entities (routes,
 * markers): confirm-then-delete the selected rows — locked rows are skipped
 * and stay selected — and lock/unlock the selected rows. Both never mutate the
 * pack while a manual-assignment/regeneration mode is active (the same guard
 * the legacy bulk bar had) and signal notifyWorldChanged after mutating.
 * Rivers keep their own delete handler: their cascade (basin/tributary)
 * arithmetic doesn't fit the lockable shape.
 */
export function lockableBulkActions<Entity>(params: LockableBulkParams<Entity>): LockableBulkActions {
  const { selection, typeLabel, noun, getAll, getId, isLocked, remove, setLock } = params;

  function entitiesById(): Map<number, Entity> {
    return new Map(getAll().map(entity => [getId(entity), entity]));
  }

  function describeCascade(ids: number[]): CascadeSummary {
    const byId = entitiesById();
    const selectedEntities = ids.map(id => byId.get(id)).filter((entity): entity is Entity => entity !== undefined);
    const deletable = selectedEntities.filter(entity => !isLocked(entity)).length;
    const skippedLocked = selectedEntities.length - deletable;
    return { lines: [`${plural(deletable, noun)} will be removed`], deletable, skippedLocked };
  }

  function handleBulkDelete(): void {
    if (customizationActive()) return;
    const ids = [...selection.selected];
    bulkDeleteConfirm({
      typeLabel,
      describe: () => describeCascade(ids),
      onConfirm: () => {
        const byId = entitiesById();
        const deletedIds = new Set<number>();
        for (const id of ids) {
          const entity = byId.get(id);
          if (!entity || isLocked(entity)) continue; // skipped (locked) rows stay selected
          remove(entity);
          deletedIds.add(id);
        }
        selection.pruneSelected(id => !deletedIds.has(id));
        notifyWorldChanged();
      }
    });
  }

  function handleBulkLock(locked: boolean): void {
    if (customizationActive()) return;
    const byId = entitiesById();
    for (const id of selection.selected) {
      const entity = byId.get(id);
      if (entity) setLock(entity, locked);
    }
    notifyWorldChanged();
  }

  return { handleBulkDelete, handleBulkLock };
}

/**
 * One row's bulk checkbox. Renders nothing while bulk mode is off, so surfaces
 * drop it unconditionally at the start of each `.states` row.
 */
export function BulkRowCheckbox(props: { selection: BulkSelection; id: number; label: string }) {
  const { selection, id, label } = props;
  if (!selection.bulkMode) return null;
  return (
    <input
      type="checkbox"
      className="bulkRowCheckbox native"
      aria-label={label}
      checked={selection.selected.has(id)}
      onChange={() => selection.toggleSelected(id)}
    />
  );
}

interface BulkControlsProps {
  selection: BulkSelection;
  /** The ids of the currently visible (filtered + sorted) rows, in table order. */
  visibleIds: number[];
  /** Tooltip for the toggle button; defaults to the legacy bulk-bar wording. */
  toggleTip?: string;
  onDelete: () => void;
  /** Lock/unlock the selected rows; omitted for entities without a lock (rivers). */
  onLock?: () => void;
  onUnlock?: () => void;
}

/**
 * The footer bulk controls: the mode toggle button and, while bulk mode is on,
 * the select-all checkbox (indeterminate on a partial selection), the "N
 * selected" count, and the delete / optional lock / optional unlock actions.
 */
export function BulkControls(props: BulkControlsProps) {
  const { selection, visibleIds, toggleTip = DEFAULT_TOGGLE_TIP, onDelete, onLock, onUnlock } = props;
  const { bulkMode, selected, toggleBulkMode, toggleAllVisible } = selection;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  return (
    <>
      <button
        type="button"
        data-tip={toggleTip}
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
              onChange={() => toggleAllVisible(visibleIds)}
            />{" "}
            All
          </label>
          <span className="bulkCount">{selected.size} selected</span>
          <button
            type="button"
            className="bulkDelete icon-trash"
            data-tip="Delete selected rows"
            aria-label="Delete selected rows"
            onClick={onDelete}
          />
          {onLock && (
            <button
              type="button"
              className="bulkLock icon-lock"
              data-tip="Lock selected rows (protects from regeneration and bulk delete)"
              aria-label="Lock selected rows"
              onClick={onLock}
            />
          )}
          {onUnlock && (
            <button
              type="button"
              className="bulkUnlock icon-lock-open"
              data-tip="Unlock selected rows"
              aria-label="Unlock selected rows"
              onClick={onUnlock}
            />
          )}
        </span>
      )}
    </>
  );
}
