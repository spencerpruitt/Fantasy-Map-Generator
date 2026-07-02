import { openSurface } from "@/ui/app-shell/registry";

/**
 * open — the preserved trigger seam for the Production Overview surface.
 *
 * The signature is unchanged from the legacy version so the callers (the burg
 * editor's production button and the goods-burgs map click in editors.js) keep
 * working untouched. The body now just validates the burg — with the same tips
 * the legacy `alertMessage.innerHTML` rendering showed — and dispatches into the
 * App shell, which mounts the React <ProductionOverview> surface. All world data
 * is read inside the surface through the World-State accessor.
 */
export function open(burgId: number): void {
  const burg = pack.burgs[burgId];
  if (!burg || burg.removed) {
    tip("Invalid burg. The selected burg does not exist or was removed.", true, "error", 5000);
    return;
  }

  const market = Markets.get(burg.market);
  if (!market) {
    tip("No market. This burg is not connected to any market.", true, "error", 5000);
    return;
  }

  if (!burg.production) {
    tip("No production data for this burg.", true, "error", 5000);
    return;
  }

  openSurface("production-overview", { burgId, anchor: "svg" });
}
