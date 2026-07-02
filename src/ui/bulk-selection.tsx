import { useState } from "react";

/**
 * bulk-selection — the in-surface bulk mode shared by the converted overview
 * surfaces (routes, rivers, markers). It replaces the legacy `window.bulkBars`
 * DOM-glue bar per surface with React state, keeping the established semantics:
 * a toggle button, per-row checkboxes, select-all over the VISIBLE (filtered +
 * sorted) rows, an "N selected" count, and the selection cleared on exit.
 *
 * What stays in each surface: the action handlers themselves (delete cascades,
 * locked-row skipping, lock/unlock), because those are entity-specific domain
 * calls. The shared React bulk bar with cross-surface mutation plumbing remains
 * Phase 4.
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
