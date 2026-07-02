import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAllSurfaces, getOpenSurfaces } from "@/ui/app-shell/registry";
import type { Good } from "../generators/goods-generator";
import {
  buildLayout,
  CARD_WIDTH,
  getDirectedChainIds,
  getDisplayEdges,
  getEdgeGeometry,
  getFlowDurationSeconds,
  getFlowOpacity,
  getLayoutBounds,
  ProductionChains,
  truncateGoodName
} from "./production-chains";

const globalScope = globalThis as Record<string, unknown>;

function makeGood(overrides: Partial<Good> & { i: number; name: string }): Good {
  return { value: 1, tags: [], color: "#808080", icon: "good", ...overrides } as Good;
}

// A single chain component — Wood → Plank → Tools (with Iron Ore also feeding
// Tools) — plus an unchained good (Fish) that must be excluded.
function makeGoods(): Good[] {
  return [
    makeGood({ i: 1, name: "Wood" }),
    makeGood({ i: 2, name: "Iron Ore" }),
    makeGood({ i: 3, name: "Plank", recipes: [{ 1: 2 }] }),
    makeGood({ i: 4, name: "Tools", recipes: [{ 3: 1, 2: 2 }] }),
    makeGood({ i: 5, name: "Fish" })
  ];
}

describe("buildLayout", () => {
  it("returns an empty layout when no good has a recipe", () => {
    const layout = buildLayout([makeGood({ i: 1, name: "Wood" }), makeGood({ i: 5, name: "Fish" })]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.stages.size).toBe(0);
    expect(layout.componentBands).toEqual([]);
  });

  it("lays out only chain goods, staged by recipe depth", () => {
    const layout = buildLayout(makeGoods());

    // Fish (5) is not part of any chain and gets no card.
    expect(layout.nodes.map(node => node.id).sort()).toEqual([1, 2, 3, 4]);
    expect([...layout.stages].sort()).toEqual([0, 1, 2]);

    const stageOf = new Map(layout.nodes.map(node => [node.id, node.stage]));
    expect(stageOf.get(1)).toBe(0); // raw ingredient
    expect(stageOf.get(2)).toBe(0); // raw ingredient
    expect(stageOf.get(3)).toBe(1); // made from Wood
    expect(stageOf.get(4)).toBe(2); // made from Plank (deepest ingredient wins)

    // Cards sit in their stage column (COLUMN_STEP = CARD_WIDTH + COLUMN_GAP).
    const columnStep = CARD_WIDTH + 148;
    for (const node of layout.nodes) expect(node.x).toBe(node.stage * columnStep);
  });

  it("routes one edge per recipe ingredient with the recipe's amount", () => {
    const layout = buildLayout(makeGoods());

    const edgeSummary = layout.edges
      .map(edge => ({ from: edge.from.id, to: edge.to.id, amount: edge.amount, recipeIndex: edge.recipeIndex }))
      .sort((a, b) => a.from - b.from || a.to - b.to);
    expect(edgeSummary).toEqual([
      { from: 1, to: 3, amount: 2, recipeIndex: 0 },
      { from: 2, to: 4, amount: 2, recipeIndex: 0 },
      { from: 3, to: 4, amount: 1, recipeIndex: 0 }
    ]);
  });

  it("separates disconnected chains into stacked component bands", () => {
    const goods = [
      ...makeGoods(),
      makeGood({ i: 6, name: "Wool" }),
      makeGood({ i: 7, name: "Cloth", recipes: [{ 6: 3 }] })
    ];
    const layout = buildLayout(goods);

    expect(layout.componentBands.length).toBe(2);
    // The larger component (4 goods) comes first at y offset 0.
    expect(layout.componentBands[0].y).toBe(0);
    expect(layout.componentBands[1].y).toBeGreaterThan(0);

    const nodeOf = (id: number) => layout.nodes.find(node => node.id === id)!;
    expect(nodeOf(6).y).toBeGreaterThanOrEqual(layout.componentBands[1].y);
    expect(nodeOf(7).y).toBeGreaterThanOrEqual(layout.componentBands[1].y);
  });
});

describe("getDisplayEdges", () => {
  it("groups parallel recipe edges between the same goods into one display edge with sorted labels", () => {
    const goods = [makeGood({ i: 1, name: "Wood" }), makeGood({ i: 2, name: "Charm", recipes: [{ 1: 3 }, { 1: 1 }] })];
    const layout = buildLayout(goods);
    expect(layout.edges.length).toBe(2);

    const displayEdges = getDisplayEdges(layout.edges);
    expect(displayEdges.length).toBe(1);
    expect(displayEdges[0].fromId).toBe(1);
    expect(displayEdges[0].toId).toBe(2);
    expect(displayEdges[0].representative.recipeIndex).toBe(0);
    expect(displayEdges[0].labels).toEqual([
      { amount: 3, recipeIndex: 0 },
      { amount: 1, recipeIndex: 1 }
    ]);
  });
});

describe("getDirectedChainIds", () => {
  it("collects the good plus its transitive ingredients and products, not siblings", () => {
    const layout = buildLayout(makeGoods());

    // Plank's chain: Wood upstream, Tools downstream — Iron Ore (a co-ingredient
    // of Tools) is NOT on Plank's chain.
    expect([...getDirectedChainIds(3, layout.edges)].sort()).toEqual([1, 3, 4]);
    // Wood's chain runs all the way downstream.
    expect([...getDirectedChainIds(1, layout.edges)].sort()).toEqual([1, 3, 4]);
    // Tools' chain covers everything upstream.
    expect([...getDirectedChainIds(4, layout.edges)].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("edge geometry and bounds", () => {
  it("draws an edge from the source card's right edge to the target card's left edge", () => {
    const layout = buildLayout(makeGoods());
    const positions = new Map(layout.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
    const edge = layout.edges.find(e => e.from.id === 1 && e.to.id === 3)!;

    const geometry = getEdgeGeometry(edge, positions);
    expect(geometry.d.startsWith(`M${edge.from.x + CARD_WIDTH},`)).toBe(true);
    expect(geometry.labelX).toBe(edge.to.x - 10);
  });

  it("computes the svg size and offsets from the node bounding box", () => {
    const layout = buildLayout(makeGoods());
    const bounds = getLayoutBounds(layout);

    expect(bounds.svgWidth).toBe(bounds.maxX - bounds.minX + 36);
    expect(bounds.svgHeight).toBe(bounds.maxY - bounds.minY + 36 + 20);
    expect(bounds.offsetX).toBe(-bounds.minX + 18);
    expect(bounds.offsetY).toBe(-bounds.minY + 18 + 20);
  });
});

describe("flow and label helpers", () => {
  it("scales flow opacity with amount, capped at the max", () => {
    expect(getFlowOpacity(1)).toBeCloseTo(0.73);
    expect(getFlowOpacity(2)).toBeCloseTo(0.81);
    expect(getFlowOpacity(10)).toBeCloseTo(0.92);
  });

  it("shortens flow duration for heavier amounts, with a floor", () => {
    expect(getFlowDurationSeconds(1)).toBeCloseTo(22 / 40);
    expect(getFlowDurationSeconds(2)).toBeCloseTo(22 / 80);
    expect(getFlowDurationSeconds(100)).toBeCloseTo(0.12);
  });

  it("truncates long good names with an ellipsis", () => {
    expect(truncateGoodName("Wood")).toBe("Wood");
    expect(truncateGoodName("Extravagant Jewellery")).toBe("Extravagant…");
  });
});

describe("ProductionChains.open (trigger seam)", () => {
  beforeEach(() => {
    globalScope.tip = vi.fn();
  });

  afterEach(() => {
    closeAllSurfaces();
    globalScope.tip = undefined;
    globalScope.pack = undefined;
  });

  it("tips a warning when there are no goods", () => {
    globalScope.pack = { goods: [] };
    ProductionChains.open();
    expect(globalScope.tip).toHaveBeenCalledWith("No goods data available.", true, "warn");
    expect(getOpenSurfaces()).toEqual([]);
  });

  it("tips a warning when no good has a recipe chain", () => {
    globalScope.pack = { goods: [makeGood({ i: 1, name: "Wood" })] };
    ProductionChains.open();
    expect(globalScope.tip).toHaveBeenCalledWith(
      "No production chains found: add manufactured goods with recipes first.",
      true,
      "warn"
    );
    expect(getOpenSurfaces()).toEqual([]);
  });

  it("opens the production-chains surface when a chain exists", () => {
    globalScope.pack = { goods: makeGoods() };
    ProductionChains.open();
    expect(globalScope.tip).not.toHaveBeenCalled();
    expect(getOpenSurfaces().map(surface => surface.id)).toEqual(["production-chains"]);
  });
});
