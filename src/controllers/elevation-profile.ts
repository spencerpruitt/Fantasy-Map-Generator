import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Elevation Profile surface.
 *
 * The signature is unchanged from the legacy jQuery-UI version so its callers —
 * the route editor's and river editor's elevation-profile buttons (and their
 * live-refresh while control points move) — keep calling
 * `open(cells, routeLen, isRiver)` untouched. The body keeps the legacy open
 * side-effects (close other legacy dialogs, reject an empty path with the same
 * tip) and dispatches into the App shell, which mounts the React
 * <ElevationProfile> surface; the legacy chart building and `.dialog()` call are
 * gone. All world reads happen inside the surface through the World-State
 * accessor. Re-opening while already open replaces the surface's props (the
 * registry remounts it), which is how the editors' live-refresh redraws the chart.
 */
export function open(cells: number[], routeLen: number, isRiver: boolean): void {
  closeDialogs(".stable");

  if (cells[0] === undefined || cells.at(-1) === undefined) {
    tip("Elevation profile: no data", true, "error");
    return;
  }

  openSurface("elevation-profile", { cells, routeLen, isRiver, anchor: "svg" });
}
