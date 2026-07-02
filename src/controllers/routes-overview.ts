import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Routes Overview surface.
 *
 * The legacy callers (tools.js menu button, hotkeys.js Shift+U) keep calling the
 * global `overviewRoutes()`, which controllers/index.ts points at this lazy
 * `open()`. The body keeps the legacy open side-effects — no-op during
 * customization, close other legacy dialogs (the old `#routesOverview`
 * self-exception is moot now that the overview is not a jQuery dialog), and
 * force the routes layer on so route paths exist for length measurement and
 * highlighting — then dispatches into the App shell, which mounts the React
 * <RoutesOverview> surface. All world reads and route mutations live inside
 * the surface, behind the World-State accessor.
 */
export function open(): void {
  if (customization) return;
  closeDialogs(".stable");
  if (!layerIsOn("toggleRoutes")) toggleRoutes();
  openSurface("routes-overview", { anchor: "svg" });
}
