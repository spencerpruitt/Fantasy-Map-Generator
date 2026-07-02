import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Markers Overview surface.
 *
 * The legacy callers (tools.js menu button, hotkeys.js Shift+K) keep calling
 * the global `overviewMarkers()`, which controllers/index.ts points at this
 * lazy `open()`. The body keeps the legacy open side-effects — no-op during
 * customization, close other legacy dialogs (the old `#markersOverview`
 * self-exception is moot now that the overview is not a jQuery dialog), and
 * force the markers layer on so marker elements exist for locating and pin
 * redraws — then dispatches into the App shell, which mounts the React
 * <MarkersOverview> surface. All world reads and marker mutations live inside
 * the surface, behind the World-State accessor.
 */
export function open(): void {
  if (customization) return;
  closeDialogs(".stable");
  if (!layerIsOn("toggleMarkers")) toggleMarkers();
  openSurface("markers-overview", { anchor: "svg" });
}
