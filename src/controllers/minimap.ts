import { openSurface } from "@/ui/app-shell/registry";

/**
 * openMinimapDialog — the preserved trigger seam for the Minimap surface.
 *
 * The signature is unchanged from the legacy jQuery-UI version so the caller
 * (the tools menu's Minimap button) keeps working untouched. The body closes
 * other legacy dialogs exactly as the legacy open did (`.stable` dialogs stay;
 * the old `#minimap` self-exception is moot now that the minimap is not a
 * jQuery dialog) and dispatches into the App shell, which mounts the React
 * <Minimap> surface. The `window.updateMinimap` hook the zoom handler calls is
 * owned by the surface for its mounted lifetime.
 */
export function openMinimapDialog(): void {
  closeDialogs(".stable");
  openSurface("minimap", { anchor: "svg" });
}
