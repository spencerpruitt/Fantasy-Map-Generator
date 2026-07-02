import type { Burg } from "@/generators/burgs-generator";
import type { Good } from "@/generators/goods-generator";
import type { Marker } from "@/generators/markers-generator";
import type { Deal, Market } from "@/generators/markets-generator";
import type { Regiment } from "@/generators/military-generator";
import type { River } from "@/generators/river-generator";
import type { Route } from "@/generators/routes-generator";
import type { State } from "@/generators/states-generator";
import type { GridGraph } from "@/types/GridGraph";
import { rn } from "@/utils/numberUtils";

/**
 * World-State accessor — the single typed wrapper over the `window.X` bridge that
 * React surfaces read world data through, plus the world-change signal they react to.
 *
 * Components must never touch raw `window.pack` / `Goods` / `Markets`; they call
 * these functions instead. That keeps the bridge dependency in one place, so when
 * a real store lands only this module changes, not the surfaces.
 *
 * Reads are still plain reads off the bridge (guarded for an absent world —
 * `[]`/`undefined` — the same defensive shape the legacy overviews use, so a
 * surface opened before a world is populated renders an empty state instead of
 * throwing during render and tearing down the shell). What changed in Slice 7 is
 * reactivity: instead of read-on-open snapshots, surfaces subscribe to a single
 * global world VERSION and re-read through these same getters whenever it bumps.
 *
 * The version is a monotonic counter, not a copy of the data. `notifyWorldChanged`
 * bumps it after any economy mutation (a converted surface's own edit, or a legacy
 * editor call site retrofitted to signal); `subscribeWorld` + `getWorldVersion`
 * are shaped for React's `useSyncExternalStore` (see `use-world-version.ts`). This
 * is the seam a real per-entity store would slot behind later: only this module
 * and the mutation call sites would change, never the surfaces. See ADR-0004.
 */

let worldVersion = 0;
const worldListeners = new Set<() => void>();

/**
 * Signal that world data changed so subscribed surfaces re-read. A single global
 * counter (not per-entity) is deliberate at this scale — see ADR-0004.
 */
export function notifyWorldChanged(): void {
  worldVersion += 1;
  for (const listener of worldListeners) listener();
}

/**
 * Subscribe to world-change signals. Returns an unsubscribe function. Shaped for
 * `useSyncExternalStore`'s `subscribe` argument.
 */
export function subscribeWorld(listener: () => void): () => void {
  worldListeners.add(listener);
  return () => {
    worldListeners.delete(listener);
  };
}

/**
 * The current world version — a stable snapshot between changes, which
 * `useSyncExternalStore` relies on to avoid re-render loops. It is an opaque
 * change token: only its equality across renders is meaningful, not its value.
 */
export function getWorldVersion(): number {
  return worldVersion;
}

/** The full goods list (`pack.goods`), or an empty list if no world is loaded. */
export function getGoods(): Good[] {
  return pack?.goods ?? [];
}

/** The full goods list sorted alphabetically by name (the canonical goods order). */
export function getGoodsSortedByName(): Good[] {
  return [...getGoods()].sort((first, second) => first.name.localeCompare(second.name));
}

/** The full markets list (`pack.markets`), or an empty list if no world is loaded. */
export function getMarkets(): Market[] {
  return pack?.markets ?? [];
}

/** A good by id, or undefined if none exists (`Goods.get`). */
export function getGood(id: number): Good | undefined {
  return Goods?.get(id);
}

/** A market's display name (`Markets.getName`). */
export function getMarketName(market: Market): string {
  return Markets ? Markets.getName(market) : "";
}

/**
 * A market's stock/price entry for a good, or undefined if the market does not
 * stock it (`market.goods[good.i]`).
 */
export function getMarketGood(market: Market, good: Good): { stock: number; price: number } | undefined {
  return market.goods?.[good.i];
}

/** A market's swatch color (`market.color`). */
export function getMarketColor(market: Market): string {
  return market.color;
}

/** A market by id, or undefined if none exists (`Markets.get`). */
export function getMarket(id: number): Market | undefined {
  return Markets?.get(id);
}

/** A good swatch's stroke color for a fill color (`Goods.getStroke`). */
export function getGoodStroke(color: string): string {
  return Goods ? Goods.getStroke(color) : "";
}

/** A market's center burg (`pack.burgs[market.centerBurgId]`), or undefined. */
export function getMarketCenterBurg(market: Market): Burg | undefined {
  return pack?.burgs?.[market.centerBurgId];
}

/** A burg by id (`pack.burgs[id]`), or undefined. */
export function getBurg(id: number): Burg | undefined {
  return pack?.burgs?.[id];
}

/** The full burgs list (`pack.burgs`), or an empty list if no world is loaded. */
export function getBurgs(): Burg[] {
  return pack?.burgs ?? [];
}

/** The full deals list (`pack.deals`), or an empty list if no world is loaded. */
export function getDeals(): Deal[] {
  return pack?.deals ?? [];
}

/**
 * A burg's sales-tax rate (`States.getSalesTax`), or 0 when the burg or the
 * States module is absent.
 */
export function getSalesTax(burg: Burg | undefined): number {
  if (!burg || typeof States === "undefined" || !States) return 0;
  return States.getSalesTax(burg);
}

/** Every deal where a market is the seller or the buyer (`pack.deals`). */
export function getMarketDeals(marketId: number): Deal[] {
  const deals = pack?.deals;
  if (!deals) return [];
  return deals.filter(
    deal =>
      (deal.sellerType === "market" && deal.seller === marketId) ||
      (deal.buyerType === "market" && deal.buyer === marketId)
  );
}

/**
 * A market's default (unnamed) label — its center burg's name, or `Market {i}`
 * when the burg is missing. This is the placeholder shown when no custom name is
 * set; the effective display name is `getMarketName`.
 */
export function getMarketDefaultName(market: Market): string {
  return pack?.burgs?.[market.centerBurgId]?.name || `Market ${market.i}`;
}

/** How many cells belong to a market (`pack.cells.market`). */
export function getMarketCellCount(market: Market): number {
  const cellMarkets = pack?.cells?.market;
  if (!cellMarkets) return 0;
  let count = 0;
  for (const marketId of cellMarkets) {
    if (marketId === market.i) count += 1;
  }
  return count;
}

/** How many non-removed burgs belong to a market (`pack.burgs`). */
export function getMarketBurgCount(market: Market): number {
  const burgs = pack?.burgs;
  if (!burgs) return 0;
  // Count in place rather than filter().length so a large-world recompute
  // allocates no throwaway array (matches getMarketCellCount above).
  let count = 0;
  for (const burg of burgs) {
    if (burg && !burg.removed && burg.market === market.i) count += 1;
  }
  return count;
}

/**
 * The state that owns a market, resolved through the market's center burg
 * (`pack.states[centerBurg.state]`). Falls back to the neutral state (0), matching
 * the legacy overview.
 */
export function getMarketOwnerState(market: Market): State | undefined {
  const centerBurg = pack?.burgs?.[market.centerBurgId];
  return pack?.states?.[centerBurg?.state ?? 0];
}

/** The price a customer pays to buy from a market (`Markets.customerBuyPrice`). */
export function getCustomerBuyPrice(price: number): number {
  return Markets ? Markets.customerBuyPrice(price) : price;
}

/** The price a customer receives selling to a market (`Markets.customerSellPrice`). */
export function getCustomerSellPrice(price: number): number {
  return Markets ? Markets.customerSellPrice(price) : price;
}

/** The full routes list (`pack.routes`), or an empty list if no world is loaded. */
export function getRoutes(): Route[] {
  return pack?.routes ?? [];
}

/**
 * A route's display name, generating and PERSISTING one on first read
 * (`Routes.generateName`) — legacy parity: the overview and route editor both
 * materialize missing names so they stay stable and are saved into the `.map`.
 * Deliberately does not signal a world change (the legacy overview never redrew
 * for this either). Returns "" when no name exists and the Routes module is
 * absent (no world loaded).
 */
export function getRouteName(route: Route): string {
  if (!route.name && typeof Routes !== "undefined" && Routes) route.name = Routes.generateName(route);
  return route.name ?? "";
}

/**
 * A route's length in map units, measuring and PERSISTING it on first read
 * (`Routes.getLength`) — same legacy lazy-materialization as `getRouteName`.
 * `Routes.getLength` reads the route's rendered SVG path, so this guards both an
 * absent Routes module and a missing path (returning 0 instead of throwing
 * during render).
 */
export function getRouteLength(route: Route): number {
  if (!route.length && typeof Routes !== "undefined" && Routes) {
    try {
      route.length = Routes.getLength(route.i);
    } catch {
      return 0;
    }
  }
  return route.length ?? 0;
}

/** Lock or unlock a route. The mutating call site signals `notifyWorldChanged`. */
export function setRouteLock(route: Route, lock: boolean): void {
  route.lock = lock;
}

/**
 * Remove a route through the domain core (`Routes.remove`), which drops it from
 * `pack.routes`, unlinks its cell connections, and removes its SVG path. The
 * mutating call site signals `notifyWorldChanged`.
 */
export function removeRoute(route: Route): void {
  if (typeof Routes !== "undefined" && Routes) Routes.remove(route);
}

/**
 * Rebuild the cell-to-route link index from the remaining routes
 * (`Routes.buildLinks`). The legacy remove-all flow did this once after a mass
 * removal; the call site signals `notifyWorldChanged`.
 */
export function rebuildRouteLinks(): void {
  if (typeof Routes === "undefined" || !Routes || !pack) return;
  pack.cells.routes = Routes.buildLinks(pack.routes);
}

/** The full rivers list (`pack.rivers`), or an empty list if no world is loaded. */
export function getRivers(): River[] {
  return pack?.rivers ?? [];
}

/**
 * The rivers indexed by id — the lookup the Rivers Overview resolves each
 * river's basin (main stem) name through. Built per call; a surface reads it
 * once per render inside its view memo (legacy parity: the overview precomputed
 * this map instead of running a find() per row).
 */
export function getRiversById(): Map<number, River> {
  return new Map(getRivers().map(river => [river.i, river]));
}

/**
 * Remove a river AND all its tributaries through the domain core
 * (`Rivers.remove`), which drops them from `pack.rivers`, restores their cells'
 * flux, and removes their SVG paths. A no-op for an id already removed (e.g. as
 * another removal's tributary), so bulk deletion over an arbitrary selection is
 * safe. The mutating call site signals `notifyWorldChanged`.
 */
export function removeRiver(riverId: number): void {
  if (typeof Rivers !== "undefined" && Rivers) Rivers.remove(riverId);
}

/**
 * Remove every river at once — the legacy remove-all fast path: empty
 * `pack.rivers` and zero the per-cell river index instead of cascading river by
 * river. Clearing the rendered river paths is the caller's renderer
 * side-effect, and the call site signals `notifyWorldChanged`.
 */
export function removeAllRivers(): void {
  if (!pack) return;
  pack.rivers = [];
  pack.cells.r = new Uint16Array(pack.cells.i.length);
}

/** The full markers list (`pack.markers`), or an empty list if no world is loaded. */
export function getMarkers(): Marker[] {
  return pack?.markers ?? [];
}

/**
 * The marker-type options (type + icon) from the domain config
 * (`Markers.getConfig`), or an empty list when the module is absent. The
 * Markers Overview populates its add-marker type selector from this.
 */
export function getMarkerTypes(): { type: string; icon: string }[] {
  if (typeof Markers === "undefined" || !Markers) return [];
  return Markers.getConfig().map(({ type, icon }) => ({ type, icon }));
}

/**
 * Pin or unpin a marker. Unpinning DELETES the property instead of writing
 * `pinned: false` (legacy parity — the flag is only ever present-true, so
 * `.map` saves never gain a false flag). The mutating call site signals
 * `notifyWorldChanged` and syncs the `#markers` group's `pinned` attribute.
 */
export function setMarkerPinned(marker: Marker, pinned: boolean): void {
  if (pinned) marker.pinned = true;
  else delete marker.pinned;
}

/**
 * Lock or unlock a marker. Unlocking DELETES the property (same shape as the
 * legacy row toggle and the bulk adapter). The mutating call site signals
 * `notifyWorldChanged`.
 */
export function setMarkerLock(marker: Marker, lock: boolean): void {
  if (lock) marker.lock = true;
  else delete marker.lock;
}

/**
 * A marker's note (name + legend text) from the global notes list, or
 * undefined when it has none (or no world is loaded). Notes are keyed by the
 * `marker{i}` element id.
 */
export function getMarkerNote(markerId: number): { name: string; legend: string } | undefined {
  if (typeof notes === "undefined" || !notes) return undefined;
  return notes.find(note => note.id === `marker${markerId}`);
}

/**
 * Remove a marker through the domain core (`Markers.deleteMarker`), which drops
 * it from `pack.markers` and drops its note. Removing the marker's SVG element
 * is the caller's renderer side-effect, and the call site signals
 * `notifyWorldChanged`.
 */
export function removeMarker(markerId: number): void {
  if (typeof Markers !== "undefined" && Markers) Markers.deleteMarker(markerId);
}

/**
 * The non-removed real states (`s.i && !s.removed`) in pack order — the option
 * list the Regiments Overview's state filter renders (the legacy dropdown listed
 * every valid state, with or without regiments).
 */
export function getStates(): State[] {
  const states = pack?.states;
  if (!states) return [];
  return states.filter(state => state.i && !state.removed);
}

/** A Regiments Overview row source: the owning state and one of its regiments. */
export interface StateRegiment {
  state: State;
  regiment: Regiment;
}

/**
 * Every (state, regiment) pair in pack order, optionally narrowed to one state
 * (`stateFilter` is a state id, or -1 for all — the legacy filter's sentinel).
 * Skips the neutral pseudo-state, removed states, and states without regiments,
 * exactly like the legacy overview's render loop.
 */
export function getRegiments(stateFilter = -1): StateRegiment[] {
  const rows: StateRegiment[] = [];
  for (const state of getStates()) {
    if (!state.military?.length) continue;
    if (stateFilter !== -1 && state.i !== stateFilter) continue;
    for (const regiment of state.military) rows.push({ state, regiment });
  }
  return rows;
}

/**
 * The configured military unit types (`options.military`), or an empty list when
 * no options are loaded. Drives the Regiments Overview's per-unit columns.
 */
export function getMilitaryUnits(): MilitaryUnit[] {
  if (typeof options === "undefined" || !options?.military) return [];
  return options.military;
}

/**
 * Create a new empty regiment for a state at a map cell — the data mutation of
 * the legacy add-regiment click: an id one past the state's last regiment, naval
 * when the cell is water, named by the domain core (`Military.getName`), pushed
 * onto the state's military list with a legend note (`Military.generateNote`).
 * Returns the new regiment so the call site can draw it (`drawRegiment` is the
 * caller's renderer side-effect) and signal `notifyWorldChanged`. Returns
 * undefined (no mutation) when the state or cell does not resolve.
 */
export function addRegiment(stateId: number, cell: number): Regiment | undefined {
  const state = pack?.states?.[stateId];
  const point = pack?.cells?.p?.[cell];
  if (!state || state.removed || !point) return undefined;

  // The legacy handler assumed `state.military` existed (every generated state
  // has one); initialize it instead of throwing for a hand-made state that lacks it.
  if (!state.military) state.military = [];
  const military = state.military;

  const [x, y] = point;
  const regimentId = military.length ? military[military.length - 1].i + 1 : 0;
  const isNaval = +(Number(pack.cells.h[cell]) < 20);
  const regiment: Regiment = {
    a: 0,
    cell,
    i: regimentId,
    n: isNaval,
    u: {},
    x,
    y,
    bx: x,
    by: y,
    state: stateId,
    icon: "🛡️",
    name: "",
    t: 0,
    s: 0,
    type: ""
  };

  const militaryModule = typeof Military !== "undefined" ? Military : undefined;
  if (militaryModule) regiment.name = militaryModule.getName(regiment, military);
  military.push(regiment);
  if (militaryModule) militaryModule.generateNote(regiment, state); // add legend
  return regiment;
}

/**
 * A state's total population in people — the legacy military overview's
 * formula: `(rural + urban * urbanization) * populationRate`, rounded. Returns
 * 0 when the rate globals are absent (no world loaded).
 */
export function getStatePopulation(state: State): number {
  if (typeof populationRate === "undefined" || populationRate === undefined) return 0;
  if (typeof urbanization === "undefined" || urbanization === undefined) return 0;
  return rn(((state.rural ?? 0) + (state.urban ?? 0) * urbanization) * populationRate);
}

/**
 * Set a state's war alert, scaling every regiment's unit counts by the
 * alert ratio and recomputing each regiment's total — the data mutation of the
 * legacy military overview's editable War Alert column. A previous alert of 0
 * zeroes all forces (legacy `dif = 0`); a missing previous alert counts as 1.
 * Returns the affected regiments so the call site can redraw their map icons
 * (a renderer side-effect) and signal `notifyWorldChanged`. Returns [] (no
 * mutation) when the state does not resolve.
 */
export function setStateWarAlert(stateId: number, alert: number): Regiment[] {
  const state = pack?.states?.[stateId];
  if (!state) return [];

  const previousAlert = state.alert ?? 1;
  const ratio = previousAlert ? alert / previousAlert : 0;
  state.alert = alert;

  const regiments = state.military ?? [];
  for (const regiment of regiments) {
    for (const unitName of Object.keys(regiment.u)) {
      regiment.u[unitName] = rn(regiment.u[unitName] * ratio);
    }
    regiment.a = Object.values(regiment.u).reduce((total, count) => total + count, 0);
  }
  return regiments;
}

/**
 * The current generation seed (`window.seed`), or "" when no world is loaded.
 * The heightmap-selection surface derives its preview grid from this.
 */
export function getWorldSeed(): string {
  return typeof seed === "undefined" || seed === undefined ? "" : seed;
}

/**
 * The raw grid-level graph (`window.grid`), or undefined when no world is
 * loaded. The heightmap-selection surface clones this as the base geometry its
 * template previews render on (it never mutates the live grid).
 */
export function getGridGraph(): GridGraph | undefined {
  return typeof grid === "undefined" ? undefined : grid;
}

/**
 * Rename a market (or reset to the default when the name is blank). This is the
 * one mutation the accessor exposes so far — it lives here, with the reads, so
 * surfaces never touch `market.name` directly.
 *
 * It deliberately does NOT call `notifyWorldChanged`: renaming is metadata that
 * does not change any surface's rows/cells/burgs, and the input fires per
 * keystroke, so a global bump here would re-scan and re-render every open surface
 * on every character (a perf regression the legacy rename — which only retitled —
 * never had). The renaming surface re-renders from its own input state; other
 * surfaces pick up the new name on their next read/Refresh, matching the legacy
 * dialogs, which never cross-updated live either.
 */
export function renameMarket(market: Market, name: string): void {
  market.name = name.trim() || undefined;
}
