import "./bulk-action/legacy-bridge"; // sets window.bulkBars for legacy-JS menus
import "./view-3d";
import { lazy } from "@/lazy-loaders";

// Global trigger seams for converted overviews whose legacy callers (tools.js
// menus, hotkeys.js) invoke bare `window.X()` functions that used to be defined
// by the deleted `public/modules/ui/*.js` files. Each shim lazy-loads the typed
// controller and calls its preserved `open()`, so no legacy caller changes.
window.overviewRoutes = () => {
  lazy.routesOverview().then(module => module.open());
};
window.overviewRivers = () => {
  lazy.riversOverview().then(module => module.open());
};
window.overviewMarkers = () => {
  lazy.markersOverview().then(module => module.open());
};
