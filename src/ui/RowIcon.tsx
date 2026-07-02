import type { CSSProperties } from "react";

// The tips `showElementLockTip` showed on hover, reproduced as static data-tip
// strings (the global tooltip handler reads data-tip on mousemove). Shared by
// every overview whose rows carry a lock toggle.
export const LOCKED_TIP = "Locked. Click to unlock the element and allow it to be changed by regeneration tools";
export const UNLOCKED_TIP = "Unlocked. Click to lock the element and prevent changes to it by regeneration tools";

/**
 * A legacy-look icon action rendered inside a `.states` row. Stays a `<span>`
 * (not a `<button>`) so the `.states > [class^="icon-"]` row CSS applies
 * unchanged; the role/tabIndex/keydown give it button semantics. Shared by the
 * converted overview surfaces (routes, rivers, markers, ...).
 */
export function RowIcon(props: {
  className: string;
  tip: string;
  label: string;
  onClick: () => void;
  style?: CSSProperties;
}) {
  const { className, tip, label, onClick, style } = props;
  return (
    // biome-ignore lint/a11y/useSemanticElements: must stay a <span> so the legacy `.states` row CSS lays it out; the keyboard handler gives it button semantics.
    <span
      role="button"
      tabIndex={0}
      className={className}
      data-tip={tip}
      aria-label={label}
      style={style}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
    />
  );
}
