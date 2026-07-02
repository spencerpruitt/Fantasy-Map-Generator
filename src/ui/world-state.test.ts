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
  globalScope.seed = undefined;
  globalScope.grid = undefined;
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

describe("world-state markers-overview reads and mutations", () => {
  // Minimal marker stubs: a plain marker, a pinned one, and a locked one —
  // enough to pin the read shape and the delete-the-property flag semantics.
  interface StubMarker {
    i: number;
    type: string;
    icon: string;
    x: number;
    y: number;
    cell: number;
    pinned?: boolean;
    lock?: boolean;
  }

  let volcano: StubMarker;
  let battlefield: StubMarker;
  let shrine: StubMarker;

  beforeEach(() => {
    volcano = { i: 0, type: "volcanoes", icon: "🌋", x: 10, y: 20, cell: 1 };
    battlefield = { i: 1, type: "battlefields", icon: "⚔️", x: 30, y: 40, cell: 2, pinned: true };
    shrine = { i: 2, type: "shrines", icon: "🛐", x: 50, y: 60, cell: 3, lock: true };
    (globalScope.pack as { markers?: unknown }).markers = [volcano, battlefield, shrine];
    globalScope.notes = [{ id: "marker0", name: "Mount Doom", legend: "An angry volcano" }];
  });

  afterEach(() => {
    globalScope.notes = undefined;
    globalScope.Markers = undefined;
  });

  it("reads the markers list, or an empty list when no world is loaded", () => {
    expect(worldState.getMarkers()).toEqual([volcano, battlefield, shrine]);
    globalScope.pack = undefined;
    expect(worldState.getMarkers()).toEqual([]);
  });

  it("projects the marker-type options from the domain config", () => {
    globalScope.Markers = {
      getConfig: () => [
        { type: "volcanoes", icon: "🌋", min: 10, each: 500 },
        { type: "battlefields", icon: "⚔️", min: 50, each: 700 }
      ]
    };
    expect(worldState.getMarkerTypes()).toEqual([
      { type: "volcanoes", icon: "🌋" },
      { type: "battlefields", icon: "⚔️" }
    ]);
    globalScope.Markers = undefined;
    expect(worldState.getMarkerTypes()).toEqual([]);
  });

  it("pins a marker and DELETES the flag on unpin, without broadcasting", () => {
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });

    worldState.setMarkerPinned(volcano as never, true);
    expect(volcano.pinned).toBe(true);
    worldState.setMarkerPinned(volcano as never, false);
    // The property is deleted, not set to false, so `.map` saves are unchanged.
    expect("pinned" in volcano).toBe(false);
    expect(notified).toBe(0);
    unsubscribe();
  });

  it("locks a marker and DELETES the flag on unlock, without broadcasting", () => {
    let notified = 0;
    const unsubscribe = worldState.subscribeWorld(() => {
      notified += 1;
    });

    worldState.setMarkerLock(volcano as never, true);
    expect(volcano.lock).toBe(true);
    worldState.setMarkerLock(volcano as never, false);
    expect("lock" in volcano).toBe(false);
    expect(notified).toBe(0);
    unsubscribe();
  });

  it("finds a marker's note by its element id, or undefined without one", () => {
    expect(worldState.getMarkerNote(0)).toEqual({ id: "marker0", name: "Mount Doom", legend: "An angry volcano" });
    expect(worldState.getMarkerNote(1)).toBeUndefined();
    globalScope.notes = undefined;
    expect(worldState.getMarkerNote(0)).toBeUndefined();
  });

  it("removes a marker through the domain core (Markers.deleteMarker)", () => {
    const removed: number[] = [];
    globalScope.Markers = { deleteMarker: (id: number) => removed.push(id) };
    worldState.removeMarker(1);
    expect(removed).toEqual([1]);
    // Guarded: absent Markers module is a no-op, not a throw.
    globalScope.Markers = undefined;
    expect(() => worldState.removeMarker(1)).not.toThrow();
  });
});

describe("world-state regiments-overview reads and mutations", () => {
  // Two states with regiments, one without, plus the neutral pseudo-state and a
  // removed state — enough to pin the filter/skip semantics and the add mutation.
  interface StubRegiment {
    i: number;
    name: string;
    a: number;
    u: Record<string, number>;
    n: number;
  }
  interface StubState {
    i: number;
    name: string;
    removed?: boolean;
    military?: StubRegiment[];
  }

  let redState: StubState;
  let blueState: StubState;
  let emptyState: StubState;
  let goneState: StubState;

  beforeEach(() => {
    redState = {
      i: 1,
      name: "Redland",
      military: [
        { i: 0, name: "1st Red", a: 100, u: { infantry: 100 }, n: 0 },
        { i: 1, name: "2nd Red", a: 40, u: { archers: 40 }, n: 0 }
      ]
    };
    blueState = { i: 2, name: "Bluemark", military: [{ i: 0, name: "1st Blue", a: 7, u: { infantry: 7 }, n: 0 }] };
    emptyState = { i: 3, name: "Quietia", military: [] };
    goneState = { i: 4, name: "Gonia", removed: true, military: [{ i: 0, name: "Ghosts", a: 5, u: {}, n: 0 }] };
    globalScope.pack = {
      states: [{ i: 0, name: "Neutrals" }, redState, blueState, emptyState, goneState],
      // Cell 0 is land (height 50), cell 1 is water (height 10).
      cells: {
        p: [
          [10, 20],
          [30, 40]
        ],
        h: [50, 10]
      }
    };
    globalScope.options = { military: [{ name: "infantry" }, { name: "archers" }] };
  });

  afterEach(() => {
    globalScope.options = undefined;
    globalScope.Military = undefined;
    globalScope.notes = undefined;
  });

  it("lists the valid states (skipping neutrals and removed), or [] with no world", () => {
    expect(worldState.getStates().map(state => state.name)).toEqual(["Redland", "Bluemark", "Quietia"]);
    globalScope.pack = undefined;
    expect(worldState.getStates()).toEqual([]);
  });

  it("flattens (state, regiment) pairs in pack order, skipping regiment-less states", () => {
    const rows = worldState.getRegiments();
    expect(rows.map(row => `${row.state.name}/${row.regiment.name}`)).toEqual([
      "Redland/1st Red",
      "Redland/2nd Red",
      "Bluemark/1st Blue"
    ]);
    globalScope.pack = undefined;
    expect(worldState.getRegiments()).toEqual([]);
  });

  it("narrows the pairs to one state by id (-1 means all)", () => {
    expect(worldState.getRegiments(2).map(row => row.regiment.name)).toEqual(["1st Blue"]);
    expect(worldState.getRegiments(3)).toEqual([]);
    expect(worldState.getRegiments(-1).length).toBe(3);
  });

  it("reads the military unit options, or [] when no options are loaded", () => {
    expect(worldState.getMilitaryUnits().map(unit => unit.name)).toEqual(["infantry", "archers"]);
    globalScope.options = undefined;
    expect(worldState.getMilitaryUnits()).toEqual([]);
  });

  it("adds a regiment: next per-state id, naval flag from cell height, domain name + note", () => {
    const noted: string[] = [];
    globalScope.Military = {
      getName: (regiment: { i: number }) => `Named ${regiment.i}`,
      generateNote: (regiment: { name: string }, state: { name: string }) =>
        noted.push(`${state.name}:${regiment.name}`)
    };

    const landRegiment = worldState.addRegiment(1, 0);
    expect(landRegiment).toMatchObject({ i: 2, n: 0, x: 10, y: 20, bx: 10, by: 20, state: 1, name: "Named 2" });
    expect(redState.military?.length).toBe(3);
    expect(noted).toEqual(["Redland:Named 2"]);

    const navalRegiment = worldState.addRegiment(2, 1);
    expect(navalRegiment).toMatchObject({ i: 1, n: 1, x: 30, y: 40 });
  });

  it("initializes a missing military list instead of throwing", () => {
    const bareState: StubState = { i: 5, name: "Bareland" };
    (globalScope.pack as { states: unknown[] }).states.push(bareState);
    const regiment = worldState.addRegiment(5, 0);
    expect(regiment?.i).toBe(0);
    expect(bareState.military?.length).toBe(1);
  });

  it("returns undefined (and mutates nothing) for a missing state or cell", () => {
    expect(worldState.addRegiment(99, 0)).toBeUndefined();
    expect(worldState.addRegiment(4, 0)).toBeUndefined(); // removed state
    expect(worldState.addRegiment(1, 99)).toBeUndefined(); // no such cell
    expect(redState.military?.length).toBe(2);
  });
});

describe("world-state military-overview reads and mutations", () => {
  interface StubRegiment {
    i: number;
    name: string;
    a: number;
    u: Record<string, number>;
    n: number;
  }
  interface StubState {
    i: number;
    name: string;
    rural?: number;
    urban?: number;
    alert?: number;
    military?: StubRegiment[];
  }

  let redState: StubState;

  beforeEach(() => {
    redState = {
      i: 1,
      name: "Redland",
      rural: 1000,
      urban: 200,
      alert: 1,
      military: [
        { i: 0, name: "1st Red", a: 100, u: { infantry: 80, archers: 20 }, n: 0 },
        { i: 1, name: "2nd Red", a: 41, u: { infantry: 41 }, n: 0 }
      ]
    };
    globalScope.pack = { states: [{ i: 0, name: "Neutrals" }, redState] };
    globalScope.populationRate = 2;
    globalScope.urbanization = 0.5;
  });

  afterEach(() => {
    globalScope.populationRate = undefined;
    globalScope.urbanization = undefined;
  });

  it("computes a state's population from rural + urbanized urban, rounded (legacy formula)", () => {
    // (1000 + 200 * 0.5) * 2 = 2200
    expect(worldState.getStatePopulation(redState as never)).toBe(2200);
    // Missing counts read as 0.
    expect(worldState.getStatePopulation({ i: 2, name: "Bare" } as never)).toBe(0);
  });

  it("returns 0 population when the rate globals are absent (no world loaded)", () => {
    globalScope.populationRate = undefined;
    expect(worldState.getStatePopulation(redState as never)).toBe(0);
  });

  it("setStateWarAlert scales every regiment's unit counts by the alert ratio and recomputes totals", () => {
    const regiments = worldState.setStateWarAlert(1, 2);

    expect(redState.alert).toBe(2);
    expect(redState.military?.[0].u).toEqual({ infantry: 160, archers: 40 });
    expect(redState.military?.[0].a).toBe(200);
    expect(redState.military?.[1].u).toEqual({ infantry: 82 });
    expect(redState.military?.[1].a).toBe(82);
    // The affected regiments come back so the call site can redraw their icons.
    expect(regiments).toBe(redState.military);
  });

  it("setStateWarAlert rounds scaled counts (legacy rn) and treats a missing previous alert as 1", () => {
    redState.alert = undefined;
    worldState.setStateWarAlert(1, 0.5);
    expect(redState.military?.[0].u).toEqual({ infantry: 40, archers: 10 });
    expect(redState.military?.[1].u).toEqual({ infantry: 21 }); // rn(20.5) rounds half up
    expect(redState.military?.[1].a).toBe(21);
  });

  it("setStateWarAlert zeroes forces when the previous alert was 0 (legacy dif = 0)", () => {
    redState.alert = 0;
    worldState.setStateWarAlert(1, 3);
    expect(redState.military?.[0].u).toEqual({ infantry: 0, archers: 0 });
    expect(redState.military?.[0].a).toBe(0);
  });

  it("setStateWarAlert returns [] and mutates nothing for a missing state or absent world", () => {
    expect(worldState.setStateWarAlert(99, 2)).toEqual([]);
    globalScope.pack = undefined;
    expect(worldState.setStateWarAlert(1, 2)).toEqual([]);
    expect(redState.military?.[0].u).toEqual({ infantry: 80, archers: 20 });
  });
});

describe("world-state heightmap-selection reads", () => {
  it("returns the current generation seed, or an empty string when none is set", () => {
    globalScope.seed = "135111970";
    expect(worldState.getWorldSeed()).toBe("135111970");

    globalScope.seed = undefined;
    expect(worldState.getWorldSeed()).toBe("");
  });

  it("returns the grid graph, or undefined when no world is loaded", () => {
    const gridStub = { seed: "135111970", cellsX: 10, cellsY: 10, cells: {} };
    globalScope.grid = gridStub;
    expect(worldState.getGridGraph()).toBe(gridStub);

    globalScope.grid = undefined;
    expect(worldState.getGridGraph()).toBeUndefined();
  });
});

describe("world-state elevation-profile reads", () => {
  beforeEach(() => {
    // A 4-cell world: land (with a burg), deep ocean, lake water, and land in a
    // province — covering the surface-height clamp and every name/color lookup.
    const burgs: unknown[] = [];
    burgs[7] = { i: 7, name: "Ridgetown", x: 3, y: 4, population: 12 };
    globalScope.pack = {
      cells: {
        p: [
          [0, 0],
          [10, 0],
          [20, 0],
          [30, 0]
        ],
        h: [45, 5, 12, 60],
        f: [1, 2, 3, 1],
        biome: [6, 0, 0, 8],
        burg: [7, 0, 0, 0],
        pop: [3.5, 0, 0, 8],
        culture: [1, 0, 0, 1],
        religion: [1, 0, 0, 1],
        province: [0, 0, 0, 2],
        state: [1, 0, 0, 1]
      },
      features: [
        0,
        { i: 1, type: "island", height: 0 },
        { i: 2, type: "ocean", height: 0 },
        { i: 3, type: "lake", height: 17 }
      ],
      burgs,
      cultures: [
        { name: "Wildlands", color: "#100" },
        { name: "Astoria", color: "#200" }
      ],
      religions: [
        { name: "No religion", color: "#300" },
        { name: "Solar Cult", color: "#400" }
      ],
      provinces: [0, 0, { i: 2, name: "Eastmark", color: "#500" }],
      states: [
        { i: 0, name: "Neutrals", color: "#600" },
        { i: 1, name: "Astor Empire", color: "#700" }
      ]
    };
    globalScope.biomesData = {
      name: ["Marine", "", "", "", "", "", "Temperate forest", "", "Taiga"],
      color: ["#010", "", "", "", "", "", "#020", "", "#030"]
    };
  });

  afterEach(() => {
    globalScope.biomesData = undefined;
  });

  it("reads a land cell's full profile record", () => {
    expect(worldState.getProfileCellRecord(0)).toEqual({
      point: [0, 0],
      height: 45,
      surfaceHeight: 45,
      biomeId: 6,
      biomeName: "Temperate forest",
      biomeColor: "#020",
      burgId: 7,
      population: 3.5,
      cultureName: "Astoria",
      cultureColor: "#200",
      religionName: "Solar Cult",
      religionColor: "#400",
      provinceName: "",
      provinceColor: "",
      stateName: "Astor Empire",
      stateColor: "#700"
    });
  });

  it("clamps ocean water to sea level (surface height 20)", () => {
    const record = worldState.getProfileCellRecord(1);
    expect(record?.height).toBe(5);
    expect(record?.surfaceHeight).toBe(20);
  });

  it("clamps lake water to the lake's surface height", () => {
    const record = worldState.getProfileCellRecord(2);
    expect(record?.height).toBe(12);
    expect(record?.surfaceHeight).toBe(17);
  });

  it("resolves a cell's province name and color when it has one", () => {
    const record = worldState.getProfileCellRecord(3);
    expect(record?.provinceName).toBe("Eastmark");
    expect(record?.provinceColor).toBe("#500");
  });

  it("returns undefined for an unknown cell or when no world is loaded", () => {
    expect(worldState.getProfileCellRecord(99)).toBeUndefined();
    globalScope.pack = undefined;
    expect(worldState.getProfileCellRecord(0)).toBeUndefined();
  });

  it("falls back to empty names/colors when biomesData is absent", () => {
    globalScope.biomesData = undefined;
    const record = worldState.getProfileCellRecord(0);
    expect(record?.biomeName).toBe("");
    expect(record?.biomeColor).toBe("");
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

describe("world-state charts-overview reads", () => {
  beforeEach(() => {
    const burgs: unknown[] = [0];
    burgs[1] = { i: 1, name: "Burgton", population: 5, product: 12, production: [] };
    globalScope.pack = {
      cells: {
        i: [0, 1, 2],
        h: [50, 30, 10],
        t: [1, 0, -1],
        r: [0, 5, 0],
        g: [0, 1, 2],
        pop: [10, 20, 0],
        area: [100, 120, 90],
        biome: [1, 2, 0],
        culture: [1, 2, 0],
        religion: [1, 1, 0],
        state: [1, 2, 0],
        province: [1, 0, 0],
        market: [1, 1, 0],
        burg: [0, 1, 0]
      },
      burgs,
      states: [
        { i: 0, name: "Neutrals" },
        { i: 1, name: "Aland", color: "#a00" }
      ],
      cultures: [{ name: "Wildlands" }, { name: "Alpha", color: "#111" }],
      religions: [{ name: "No religion" }, { name: "Faith", color: "#222" }],
      provinces: [0, { name: "Coastal", color: "#333" }]
    };
    globalScope.grid = { cells: { temp: [5, 10, 15], prec: [50, 60, 70] } };
    globalScope.biomesData = { i: [0, 1, 2], name: ["Marine", "Forest", "Desert"], color: ["#00f", "#0f0", "#ff0"] };
    globalScope.populationRate = 10;
    globalScope.urbanization = 2;
    globalScope.mapId = 42;
    globalScope.Goods = { getBiomesProduction: () => ({ 1: [{ goodId: 7, production: 0.5 }] }) };
    globalScope.Production = {
      getCellProduction: (cellId: number) => (cellId === 1 ? { 7: 4 } : {}),
      getBurgProduction: () => ({ 7: 3, 9: 1 })
    };
  });

  afterEach(() => {
    globalScope.pack = undefined;
    globalScope.grid = undefined;
    globalScope.biomesData = undefined;
    globalScope.populationRate = undefined;
    globalScope.urbanization = undefined;
    globalScope.mapId = undefined;
    globalScope.Goods = undefined;
    globalScope.Production = undefined;
  });

  it("reads the chart cell arrays by reference", () => {
    const cells = worldState.getChartCells();
    expect(cells).toBeDefined();
    expect(cells!.i).toEqual([0, 1, 2]);
    expect(cells!.state[1]).toBe(2);
    // Reference, not a copy — a large world must not be duplicated per chart.
    expect(cells!.h).toBe((globalScope.pack as { cells: { h: number[] } }).cells.h);
  });

  it("returns undefined chart cells when no world is loaded", () => {
    globalScope.pack = undefined;
    expect(worldState.getChartCells()).toBeUndefined();
  });

  it("reads the grid climate arrays, undefined without a grid", () => {
    expect(worldState.getGridClimate()).toEqual({ temp: [5, 10, 15], prec: [50, 60, 70] });
    globalScope.grid = undefined;
    expect(worldState.getGridClimate()).toBeUndefined();
  });

  it("reads the biome catalog, empty without biomesData", () => {
    expect(worldState.getBiomesMeta().name).toEqual(["Marine", "Forest", "Desert"]);
    globalScope.biomesData = undefined;
    expect(worldState.getBiomesMeta()).toEqual({ i: [], name: [], color: [] });
  });

  it("reads the raw named collections including the id-0 placeholder", () => {
    expect(worldState.getNamedEntities("states")[0]).toEqual({ i: 0, name: "Neutrals" });
    expect(worldState.getNamedEntities("cultures")[1]).toEqual({ name: "Alpha", color: "#111" });
    expect(worldState.getNamedEntities("provinces")[0]).toBe(0);
    globalScope.pack = undefined;
    expect(worldState.getNamedEntities("religions")).toEqual([]);
  });

  it("reads the population scales, zeros when absent", () => {
    expect(worldState.getPopulationScales()).toEqual({ populationRate: 10, urbanization: 2 });
    globalScope.populationRate = undefined;
    globalScope.urbanization = undefined;
    expect(worldState.getPopulationScales()).toEqual({ populationRate: 0, urbanization: 0 });
  });

  it("reads the map id, undefined when absent", () => {
    expect(worldState.getMapId()).toBe(42);
    globalScope.mapId = undefined;
    expect(worldState.getMapId()).toBeUndefined();
  });

  it("reads the per-biome production table, {} without the Goods module", () => {
    expect(worldState.getBiomesProduction()).toEqual({ 1: [{ goodId: 7, production: 0.5 }] });
    globalScope.Goods = undefined;
    expect(worldState.getBiomesProduction()).toEqual({});
  });

  it("merges a cell's rural and its burg's urban production by good id", () => {
    // Cell 1 carries burg 1: rural {7: 4} + urban {7: 3, 9: 1}.
    expect(worldState.getCellGoodsProduction(1, {})).toEqual({ 7: 7, 9: 1 });
    // Cell 0 has no burg: rural only.
    expect(worldState.getCellGoodsProduction(0, {})).toEqual({});
    globalScope.Production = undefined;
    expect(worldState.getCellGoodsProduction(1, {})).toEqual({});
  });
});
