import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Rivers Overview surface.
 *
 * The legacy callers (tools.js menu button, hotkeys.js Shift+V) keep calling
 * the global `overviewRivers()`, which controllers/index.ts points at this
 * lazy `open()`. The body keeps the legacy open side-effects — no-op during
 * customization, close other legacy dialogs (the old `#riversOverview`
 * self-exception is moot now that the overview is not a jQuery dialog), and
 * force the rivers layer on so river paths exist for highlighting and basin
 * tinting — then dispatches into the App shell, which mounts the React
 * <RiversOverview> surface. All world reads and river mutations live inside
 * the surface, behind the World-State accessor.
 */
export function open(): void {
  if (customization) return;
  closeDialogs(".stable");
  if (!layerIsOn("toggleRivers")) toggleRivers();
  openSurface("rivers-overview", { anchor: "svg" });
}
