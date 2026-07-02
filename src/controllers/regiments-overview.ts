import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Regiments Overview surface.
 *
 * The signature is unchanged from the legacy version so the callers (the
 * military overview's per-state list icons and its "regiments list" button)
 * keep calling `RegimentsOverview.open(state)` untouched. The body keeps the
 * legacy open side-effects — no-op during customization, close other legacy
 * dialogs, and force the military layer on so the army elements exist for
 * row-hover highlights and add/delete redraws — then dispatches into the App
 * shell, which mounts the React <RegimentsOverview> surface. All world reads
 * and regiment mutations live inside the surface, behind the World-State
 * accessor; the legacy `refresh` entry point is gone — editors signal
 * `notifyWorldChanged()` instead and the surface re-reads.
 */
function open(state = -1): void {
  if (customization) return;
  closeDialogs(".stable");
  if (!layerIsOn("toggleMilitary")) toggleMilitary();
  openSurface("regiments-overview", { stateId: state, anchor: "svg" });
}

export const RegimentsOverview = { open };
