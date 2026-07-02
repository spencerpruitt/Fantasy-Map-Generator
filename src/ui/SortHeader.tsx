/**
 * SortHeader — a clickable, keyboard-operable column header shared by every
 * table surface (Compare Prices, Market Overview, Market Deals, Trade Details).
 *
 * It is rendered as a `<div>` (not a `<button>`) so it keeps the legacy grid-cell
 * look that the `.header` CSS grid lays out, while carrying the legacy
 * `data-sortby` marker, `data-tip` tooltip, and `sortable`/`icon-sort-*` classes.
 * Generic over the surface's own sort-key union so each surface stays type-safe.
 */

import { useState } from "react";

/** Sort direction shared by the table surfaces. */
export type SortDirection = "up" | "down";

/**
 * Build the header's class string the way the legacy `applySorting` did: the base
 * `sortable` class (plus `alphabetically` for name columns), and — only on the
 * active column — the `icon-sort-{name|number}-{direction}` indicator.
 */
export function sortableHeaderClass(isActive: boolean, isAlphabetical: boolean, direction: SortDirection): string {
  const base = isAlphabetical ? "sortable alphabetically" : "sortable";
  if (!isActive) return base;
  const type = isAlphabetical ? "name" : "number";
  return `${base} icon-sort-${type}-${direction}`;
}

interface SortStateBase<Key extends string> {
  sortDirection: SortDirection;
  /** Header click handler: flip direction on the active column, activate a fresh one. */
  handleSort: (key: Key) => void;
  /** The header class for one column (see sortableHeaderClass). */
  headerClassName: (key: Key) => string;
}

/** Sort state for tables that always have an active column. */
export interface SortState<Key extends string> extends SortStateBase<Key> {
  sortKey: Key;
}

/** Sort state for tables that start unsorted (no active column until a click). */
export interface NullableSortState<Key extends string> extends SortStateBase<Key> {
  sortKey: Key | null;
}

/**
 * useSortState — the sort state shared by every sortable table surface: the
 * active column + direction pair, the legacy `sortLines` click rule
 * (re-clicking the active column flips direction; a fresh alphabetical column
 * starts ascending, a fresh numeric column descending), and the header-class
 * helper. Pass `null` as the initial key for tables that start unsorted
 * (legacy headers that shipped without an `icon-sort` indicator).
 */
export function useSortState<Key extends string>(
  initialKey: Key,
  initialDirection: SortDirection,
  isAlphabetical: (key: Key) => boolean
): SortState<Key>;
export function useSortState<Key extends string>(
  initialKey: Key | null,
  initialDirection: SortDirection,
  isAlphabetical: (key: Key) => boolean
): NullableSortState<Key>;
export function useSortState<Key extends string>(
  initialKey: Key | null,
  initialDirection: SortDirection,
  isAlphabetical: (key: Key) => boolean
): NullableSortState<Key> {
  const [sortKey, setSortKey] = useState<Key | null>(initialKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialDirection);

  function handleSort(key: Key): void {
    if (key === sortKey) {
      setSortDirection(current => (current === "down" ? "up" : "down"));
      return;
    }
    setSortKey(key);
    setSortDirection(isAlphabetical(key) ? "up" : "down");
  }

  function headerClassName(key: Key): string {
    return sortableHeaderClass(key === sortKey, isAlphabetical(key), sortDirection);
  }

  return { sortKey, sortDirection, handleSort, headerClassName };
}

interface SortHeaderProps<Key extends string> {
  label: string;
  sortKey: Key;
  className: string;
  dataTip: string;
  onSort: (key: Key) => void;
  style?: React.CSSProperties;
}

export function SortHeader<Key extends string>({
  label,
  sortKey,
  className,
  dataTip,
  onSort,
  style
}: SortHeaderProps<Key>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: must stay a grid-cell <div> so the legacy `.header` CSS grid lays it out; the keyboard handler below gives it button semantics.
    <div
      role="button"
      tabIndex={0}
      className={className}
      data-sortby={sortKey}
      data-tip={dataTip}
      style={style}
      onClick={() => onSort(sortKey)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onSort(sortKey);
      }}
    >
      {label}&nbsp;
    </div>
  );
}
