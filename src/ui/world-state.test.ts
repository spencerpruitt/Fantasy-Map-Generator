import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Good } from "@/generators/goods-generator";
import type { Market } from "@/generators/markets-generator";
import * as worldState from "./world-state";

// Minimal stubs of the world data the accessor reads off the window.X bridge.
// The accessor is the ONE place allowed to touch these globals; these tests
// pin the read shape it exposes to components.
const iron: Good = { i: 0, name: "Iron", tags: [], value: 5, unit: "unit", icon: "", color: "#aaa" };
const grain: Good = { i: 1, name: "Grain", tags: [], value: 2, unit: "unit", icon: "", color: "#bbb" };

const harbor: Market = {
  i: 0,
  centerBurgId: 10,
  color: "#ff0000",
  goods: { 0: { stock: 12, price: 4 }, 1: { stock: 3, price: 1 } }
};

const globalScope = globalThis as Record<string, unknown>;

beforeEach(() => {
  // pack.burgs is indexed by burg id, so the center burg (id 10) sits at index 10.
  const burgs: unknown[] = [];
  burgs[10] = { i: 10, name: "Portford", state: 1, market: 0 };
  burgs[11] = { i: 11, name: "Elsewhere", state: 1, market: 0 };
  burgs[12] = { i: 12, name: "Gone", state: 1, market: 0, removed: true };
  globalScope.pack = {
    goods: [iron, grain],
    markets: [harbor],
    // A small burg/state/cell context so the market-overview reads (owner, cell
    // count, burg count, default name) have something to resolve against.
    burgs,
    states: [
      { i: 0, name: "Neutrals" },
      { i: 1, name: "Ironland", fullName: "Kingdom of Ironland", coa: { shield: "heater" } }
    ],
    cells: { market: [0, 0, 0, 1] },
    deals: [
      { i: 1, seller: 10, sellerType: "burg", buyer: 0, buyerType: "market", good: 0, units: 3, price: 2, tax: 0.5 }
    ]
  };
  globalScope.Goods = {
    get: (id: number) => [iron, grain].find(good => good.i === id),
    getStroke: (color: string) => `stroke-of-${color}`
  };
  globalScope.Markets = {
    getName: (market: Market) => market.name || `Market ${market.i}`,
    customerBuyPrice: (price: number) => price * 1.1,
    customerSellPrice: (price: number) => price * 0.9,
    get: (id: number) => [harbor].find(market => market.i === id)
  };
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.Goods = undefined;
  globalScope.Markets = undefined;
  globalScope.States = undefined;
  // Renaming tests mutate the shared harbor stub; reset it between tests.
  harbor.name = undefined;
});

describe("world-state accessor", () => {
  it("reads the goods list", () => {
    expect(worldState.getGoods()).toEqual([iron, grain]);
  });

  it("reads the markets list", () => {
    expect(worldState.getMarkets()).toEqual([harbor]);
  });

  it("looks a good up by id", () => {
    expect(worldState.getGood(1)).toEqual(grain);
    expect(worldState.getGood(99)).toBeUndefined();
  });

  it("reads a market's display name", () => {
    expect(worldState.getMarketName(harbor)).toBe("Market 0");
  });

  it("reads a market's stock/price for a good", () => {
    expect(worldState.getMarketGood(harbor, iron)).toEqual({ stock: 12, price: 4 });
  });

  it("returns undefined market data for a good the market does not stock", () => {
    const missing: Good = { i: 42, name: "Silk", tags: [], value: 9, unit: "unit", icon: "", color: "#ccc" };
    expect(worldState.getMarketGood(harbor, missing)).toBeUndefined();
  });

  it("reads a market's color", () => {
    expect(worldState.getMarketColor(harbor)).toBe("#ff0000");
  });

  it("sorts goods alphabetically by name", () => {
    // Stubbed order is [iron, grain]; sorted by name is [Grain, Iron].
    expect(worldState.getGoodsSortedByName().map(good => good.name)).toEqual(["Grain", "Iron"]);
  });

  it("returns empty lists when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    expect(worldState.getGoods()).toEqual([]);
    expect(worldState.getMarkets()).toEqual([]);
    expect(worldState.getGoodsSortedByName()).toEqual([]);
  });
});

describe("world-state market-overview reads", () => {
  it("looks a market up by id", () => {
    expect(worldState.getMarket(0)).toEqual(harbor);
    expect(worldState.getMarket(99)).toBeUndefined();
  });

  it("reads a good's swatch stroke", () => {
    expect(worldState.getGoodStroke("#aaa")).toBe("stroke-of-#aaa");
  });

  it("derives a market's default name from its center burg", () => {
    expect(worldState.getMarketDefaultName(harbor)).toBe("Portford");
  });

  it("counts the cells and (non-removed) burgs belonging to a market", () => {
    // cells.market has three 0s; burgs 10 and 11 belong to market 0 (12 is removed).
    expect(worldState.getMarketCellCount(harbor)).toBe(3);
    expect(worldState.getMarketBurgCount(harbor)).toBe(2);
  });

  it("resolves a market's owning state via its center burg", () => {
    expect(worldState.getMarketOwnerState(harbor)?.fullName).toBe("Kingdom of Ironland");
  });

  it("exposes customer buy/sell prices for CSV export", () => {
    expect(worldState.getCustomerBuyPrice(10)).toBeCloseTo(11);
    expect(worldState.getCustomerSellPrice(10)).toBeCloseTo(9);
  });

  it("renames a market (trimmed) without broadcasting a world change", () => {
    // Rename is per-keystroke metadata; it must NOT bump the global version (that
    // would re-scan/re-render every open surface on each character — see ADR-0004).
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });

    worldState.renameMarket(harbor, "  Trade Harbor  ");
    expect(harbor.name).toBe("Trade Harbor");

    // Clearing the name resets it to undefined (falls back to the default).
    worldState.renameMarket(harbor, "   ");
    expect(harbor.name).toBeUndefined();

    expect(notified).toBe(0);
    unsubscribe();
  });
});

describe("world-state production-overview reads", () => {
  it("reads the burgs list", () => {
    const burgs = worldState.getBurgs();
    expect(burgs[10]).toMatchObject({ i: 10, name: "Portford" });
    expect(burgs[12]).toMatchObject({ i: 12, removed: true });
  });

  it("reads the deals list", () => {
    expect(worldState.getDeals()).toEqual([
      { i: 1, seller: 10, sellerType: "burg", buyer: 0, buyerType: "market", good: 0, units: 3, price: 2, tax: 0.5 }
    ]);
  });

  it("returns empty burg/deal lists when no world is loaded instead of throwing", () => {
    globalScope.pack = undefined;
    expect(worldState.getBurgs()).toEqual([]);
    expect(worldState.getDeals()).toEqual([]);
  });

  it("reads a burg's sales-tax rate through the States module", () => {
    globalScope.States = { getSalesTax: (burg: { state?: number }) => (burg.state === 1 ? 0.1 : 0) };
    expect(worldState.getSalesTax(worldState.getBurg(10))).toBe(0.1);
    globalScope.States = undefined;
  });

  it("returns a zero sales-tax rate when the burg or States module is absent", () => {
    expect(worldState.getSalesTax(undefined)).toBe(0);
    // States is unset (no world modules loaded): rate defaults to 0.
    expect(worldState.getSalesTax(worldState.getBurg(10))).toBe(0);
  });
});

describe("world-state routes-overview reads", () => {
  interface StubRoute {
    i: number;
    group: string;
    feature: number;
    points: number[][];
    name?: string;
    length?: number;
    lock?: boolean;
  }

  let road: StubRoute;
  let trail: StubRoute;

  beforeEach(() => {
    road = {
      i: 1,
      group: "roads",
      feature: 1,
      points: [
        [0, 0, 1],
        [10, 0, 2]
      ],
      name: "North Road",
      length: 100
    };
    trail = {
      i: 2,
      group: "trails",
      feature: 1,
      points: [
        [0, 5, 3],
        [8, 5, 4]
      ],
      lock: true
    };
    (globalScope.pack as { routes?: unknown; cells?: unknown }).routes = [road, trail];
  });

  afterEach(() => {
    globalScope.Routes = undefined;
  });

  it("reads the routes list, or an empty list when no world is loaded", () => {
    expect(worldState.getRoutes()).toEqual([road, trail]);
    globalScope.pack = undefined;
    expect(worldState.getRoutes()).toEqual([]);
  });

  it("returns an existing route name without regenerating it", () => {
    globalScope.Routes = { generateName: () => "Generated Way" };
    expect(worldState.getRouteName(road as never)).toBe("North Road");
    expect(road.name).toBe("North Road");
  });

  it("generates and persists a missing route name (legacy parity)", () => {
    globalScope.Routes = { generateName: () => "Goat Trail" };
    expect(worldState.getRouteName(trail as never)).toBe("Goat Trail");
    // Persisted onto the route so the generated name is stable and saved.
    expect(trail.name).toBe("Goat Trail");
  });

  it("returns an empty name when the route has none and Routes is absent", () => {
    expect(worldState.getRouteName(trail as never)).toBe("");
    expect(trail.name).toBeUndefined();
  });

  it("returns an existing route length without remeasuring it", () => {
    globalScope.Routes = { getLength: () => 999 };
    expect(worldState.getRouteLength(road as never)).toBe(100);
  });

  it("measures and persists a missing route length (legacy parity)", () => {
    globalScope.Routes = { getLength: (id: number) => (id === 2 ? 42 : 0) };
    expect(worldState.getRouteLength(trail as never)).toBe(42);
    expect(trail.length).toBe(42);
  });

  it("returns zero length when Routes is absent or measuring throws", () => {
    expect(worldState.getRouteLength(trail as never)).toBe(0);
    // getLength reads the route's SVG path; when it is missing the getter must
    // not throw during render.
    globalScope.Routes = {
      getLength: () => {
        throw new Error("no path");
      }
    };
    expect(worldState.getRouteLength(trail as never)).toBe(0);
  });

  it("locks and unlocks a route without broadcasting (call site signals)", () => {
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });
    worldState.setRouteLock(road as never, true);
    expect(road.lock).toBe(true);
    worldState.setRouteLock(road as never, false);
    expect(road.lock).toBe(false);
    expect(notified).toBe(0);
    unsubscribe();
  });

  it("removes a route through the domain core (Routes.remove)", () => {
    const removed: unknown[] = [];
    globalScope.Routes = { remove: (route: unknown) => removed.push(route) };
    worldState.removeRoute(road as never);
    expect(removed).toEqual([road]);
    // Guarded: absent Routes module is a no-op, not a throw.
    globalScope.Routes = undefined;
    expect(() => worldState.removeRoute(road as never)).not.toThrow();
  });

  it("rebuilds the cell-route links from the remaining routes", () => {
    const links = { 1: { 2: 1 } };
    globalScope.Routes = { buildLinks: (routes: unknown[]) => (routes.length === 2 ? links : {}) };
    worldState.rebuildRouteLinks();
    expect((globalScope.pack as { cells: { routes?: unknown } }).cells.routes).toBe(links);
    // Guarded: absent Routes module or world is a no-op.
    globalScope.Routes = undefined;
    expect(() => worldState.rebuildRouteLinks()).not.toThrow();
  });
});

describe("world-state rivers-overview reads and mutations", () => {
  // Minimal river stubs: a main stem (its own basin), its tributary, and an
  // independent stem — enough to pin basin lookup and cascade removal.
  interface StubRiver {
    i: number;
    name: string;
    type: string;
    discharge: number;
    length: number;
    width: number;
    parent: number;
    basin: number;
  }

  let mainStem: StubRiver;
  let tributary: StubRiver;
  let lone: StubRiver;

  beforeEach(() => {
    mainStem = { i: 1, name: "Ohio", type: "River", discharge: 500, length: 100, width: 2, parent: 1, basin: 1 };
    tributary = { i: 2, name: "Wolf Creek", type: "Creek", discharge: 20, length: 40, width: 0.5, parent: 1, basin: 1 };
    lone = { i: 3, name: "Silver Fork", type: "Fork", discharge: 60, length: 60, width: 1.25, parent: 3, basin: 3 };
    const packStub = globalScope.pack as { rivers?: unknown; cells?: unknown };
    packStub.rivers = [mainStem, tributary, lone];
    packStub.cells = { i: [0, 1, 2, 3], r: new Uint16Array([0, 1, 2, 0]) };
  });

  afterEach(() => {
    globalScope.Rivers = undefined;
  });

  it("reads the rivers list, or an empty list when no world is loaded", () => {
    expect(worldState.getRivers()).toEqual([mainStem, tributary, lone]);
    globalScope.pack = undefined;
    expect(worldState.getRivers()).toEqual([]);
  });

  it("indexes the rivers by id for basin (main stem) lookup", () => {
    const riversById = worldState.getRiversById();
    expect(riversById.get(tributary.basin)?.name).toBe("Ohio");
    expect(riversById.get(lone.basin)?.name).toBe("Silver Fork");
    globalScope.pack = undefined;
    expect(worldState.getRiversById().size).toBe(0);
  });

  it("removes a river through the domain core (Rivers.remove) without broadcasting", () => {
    const removed: number[] = [];
    globalScope.Rivers = { remove: (id: number) => removed.push(id) };
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });

    worldState.removeRiver(2);
    expect(removed).toEqual([2]);
    expect(notified).toBe(0);
    unsubscribe();

    // Guarded: absent Rivers module is a no-op, not a throw.
    globalScope.Rivers = undefined;
    expect(() => worldState.removeRiver(2)).not.toThrow();
  });

  it("removes all rivers at once, zeroing the per-cell river index", () => {
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });

    worldState.removeAllRivers();

    const packStub = globalScope.pack as { rivers: unknown[]; cells: { i: number[]; r: Uint16Array } };
    expect(packStub.rivers).toEqual([]);
    expect(packStub.cells.r).toEqual(new Uint16Array(4));
    // The call site signals; the accessor itself must not.
    expect(notified).toBe(0);
    unsubscribe();

    // Guarded: absent world is a no-op, not a throw.
    globalScope.pack = undefined;
    expect(() => worldState.removeAllRivers()).not.toThrow();
  });
});

describe("world-state reactivity (subscribe/version)", () => {
  it("bumps the world version on notifyWorldChanged", () => {
    const before = worldState.getWorldVersion();
    worldState.notifyWorldChanged();
    expect(worldState.getWorldVersion()).toBe(before + 1);
  });

  it("returns a stable version between changes (snapshot stability for useSyncExternalStore)", () => {
    const first = worldState.getWorldVersion();
    const second = worldState.getWorldVersion();
    expect(second).toBe(first);
  });

  it("notifies subscribers when the world changes", () => {
    let calls = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      calls += 1;
    });
    worldState.notifyWorldChanged();
    worldState.notifyWorldChanged();
    expect(calls).toBe(2);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      calls += 1;
    });
    worldState.notifyWorldChanged();
    unsubscribe();
    worldState.notifyWorldChanged();
    expect(calls).toBe(1);
  });
});
