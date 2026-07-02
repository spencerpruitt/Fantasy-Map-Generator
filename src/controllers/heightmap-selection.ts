import { openSurface } from "@/ui/app-shell/registry";
import { ensureEl } from "../utils";

/**
 * open — the preserved trigger seam for the Heightmap Selection surface.
 *
 * The signature is unchanged from the legacy jQuery-UI version so its caller
 * (the options pane's heightmap row, `openTemplateSelectionDialog` in
 * options.js) keeps working untouched. The body keeps the legacy open
 * side-effects — close other legacy dialogs — then dispatches into the App
 * shell, which mounts the React <HeightmapSelection> surface pre-selected on
 * the currently applied template (the legacy `setSelected(templateInput.value)`).
 * All preview painting and the Select / New Map regeneration callbacks live in
 * the surface.
 */
export function open(): void {
  closeDialogs(".stable");
  const $templateInput = ensureEl<HTMLInputElement>("templateInput");
  openSurface("heightmap-selection", { anchor: "svg", initialSelection: $templateInput.value });
}
