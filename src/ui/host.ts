/**
 * host — guarded wrappers over legacy window globals the React surfaces call
 * for host-page side-effects. Each wrapper no-ops when the global is absent
 * (tests, or a page without the legacy scripts), so surfaces can call them
 * unconditionally instead of re-declaring the `typeof` guard.
 */

/** The shared FMG tooltip (`tip` global), guarded for absence. */
export function showTip(
  message: string,
  autoHide?: boolean,
  type?: "info" | "warn" | "error" | "success",
  timeout?: number
): void {
  if (typeof tip === "function") tip(message, autoHide, type, timeout);
}
