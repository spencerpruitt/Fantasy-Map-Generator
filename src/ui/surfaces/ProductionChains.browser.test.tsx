import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Good } from "@/generators/goods-generator";
import { notifyWorldChanged } from "../world-state";
import { ProductionChains } from "./ProductionChains";

const globalScope = globalThis as Record<string, unknown>;

function makeGood(overrides: Partial<Good> & { i: number; name: string }): Good {
  return { value: 1, tags: [], color: "#808080", icon: "good", ...overrides } as Good;
}

// Wood → Plank → Tools with Iron Ore also feeding Tools, plus an unchained
// Fish — pinning the card/edge structure, the flow-dot styling, the
// chain-highlight hover, zoom, reactivity, and the unmount cleanup.
function makeGoods(): Good[] {
  return [
    makeGood({ i: 1, name: "Wood", value: 2, color: "#8a5a2b", icon: "good-wood" }),
    makeGood({ i: 2, name: "Iron Ore", value: 3, color: "#7a7a7a", icon: "good-ore" }),
    makeGood({ i: 3, name: "Plank", value: 5, color: "#b08d57", icon: "good-plank", recipes: [{ 1: 2 }] }),
    makeGood({ i: 4, name: "Tools", value: 9, color: "#4a5a7a", icon: "good-tools", recipes: [{ 3: 1, 2: 2 }] }),
    makeGood({ i: 5, name: "Fish", value: 2, color: "#3a6a9a", icon: "good-fish" })
  ];
}

function stubWorld(goods: Good[]): void {
  globalScope.pack = { goods };
  globalScope.Goods = {
    get: (id: number) => goods.find(good => good.i === id),
    getStroke: (color: string) => `stroke(${color})`
  };
}

beforeEach(() => {
  stubWorld(makeGoods());
  globalScope.tip = vi.fn();
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.Goods = undefined;
  globalScope.tip = undefined;
});

function renderChains() {
  return render(<ProductionChains onClose={() => {}} />);
}

function nodeGroup(container: HTMLElement, id: number): SVGGElement {
  return container.querySelector(`[data-nid="${id}"]`) as SVGGElement;
}

function edgeGroup(container: HTMLElement, from: number, to: number): SVGGElement {
  return container.querySelector(`[data-ef="${from}"][data-et="${to}"]`) as SVGGElement;
}

describe("<ProductionChains>", () => {
  it("renders the recipe graph: one card per chain good, one edge group per link, stage headers", () => {
    const { container } = renderChains();

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Production Chains");
    const svg = container.querySelector("#chains-svg");
    expect(svg).toBeTruthy();

    // Chain goods only — Fish (no recipes, not an ingredient) gets no card.
    expect(container.querySelectorAll("[data-nid]").length).toBe(4);
    expect(nodeGroup(container, 5)).toBeNull();

    // One display-edge group per from→to pair.
    expect(container.querySelectorAll("[data-ef]").length).toBe(3);
    expect(edgeGroup(container, 1, 3)).toBeTruthy();
    expect(edgeGroup(container, 3, 4)).toBeTruthy();
    expect(edgeGroup(container, 2, 4)).toBeTruthy();

    // Stage headers for the three columns.
    expect(svg?.textContent).toContain("RAW MATERIALS");
    expect(svg?.textContent).toContain("STAGE 1");
    expect(svg?.textContent).toContain("STAGE 2");

    // The card carries the good's name, price, and recipe tooltip.
    const plank = nodeGroup(container, 3);
    expect(plank.textContent).toContain("Plank");
    expect(plank.textContent).toContain("🟡 5");
    expect(plank.querySelector("title")?.textContent).toBe("Plank — base price: 5\nRecipe 1: Wood x2");
  });

  it("styles the flow dots with the legacy constants (dash gap, width, amount-scaled duration), paused at rest", () => {
    const { container } = renderChains();

    // The keyframes live in a <style> scoped inside the svg.
    expect(container.querySelector("#chains-svg style")?.textContent).toContain("chains-edge-flow");
    expect(container.querySelector("#chains-svg style")?.textContent).toContain("stroke-dashoffset: -22");

    const flow = edgeGroup(container, 1, 3).querySelector("[data-edge-flow]") as SVGPathElement;
    expect(flow.getAttribute("stroke-dasharray")).toBe("0.01 22");
    expect(flow.getAttribute("stroke-width")).toBe("5");
    expect(flow.getAttribute("opacity")).toBe("0");
    expect(flow.style.animationPlayState).toBe("paused");
    // amount 2 → 22px gap / (40px/s × 2) = 0.275s; opacity 0.65 + 2×0.08 = 0.81.
    expect(flow.style.animationDuration).toBe("0.275s");
    expect(flow.getAttribute("data-flow-opacity")).toBe("0.81");

    // amount 1 → 0.55s.
    const slowFlow = edgeGroup(container, 3, 4).querySelector("[data-edge-flow]") as SVGPathElement;
    expect(slowFlow.style.animationDuration).toBe("0.55s");
  });

  it("highlights the hovered good's directed chain and restores the resting state on leave", () => {
    const { container } = renderChains();
    const plank = nodeGroup(container, 3);

    fireEvent.mouseEnter(plank);

    // Plank's chain: Wood upstream, Tools downstream. Iron Ore (a co-ingredient
    // of Tools) is off-chain and fades out.
    expect(nodeGroup(container, 1).style.opacity).toBe("1");
    expect(nodeGroup(container, 3).style.opacity).toBe("1");
    expect(nodeGroup(container, 4).style.opacity).toBe("1");
    expect(nodeGroup(container, 2).style.opacity).toBe("0");

    const onChainEdge = edgeGroup(container, 1, 3);
    expect(onChainEdge.style.opacity).toBe("1");
    const runningFlow = onChainEdge.querySelector("[data-edge-flow]") as SVGPathElement;
    expect(runningFlow.style.animationPlayState).toBe("running");
    expect(runningFlow.style.opacity).toBe("0.81");
    // The amount label becomes visible on the highlighted chain.
    expect((onChainEdge.querySelector("text") as SVGTextElement).style.opacity).toBe("1");

    const offChainEdge = edgeGroup(container, 2, 4);
    expect(offChainEdge.style.opacity).toBe("0");
    expect((offChainEdge.querySelector("[data-edge-flow]") as SVGPathElement).style.animationPlayState).toBe("paused");

    fireEvent.mouseLeave(plank);

    expect(nodeGroup(container, 2).style.opacity).toBe("1");
    expect(onChainEdge.style.opacity).toBe("0.3");
    expect(runningFlow.style.animationPlayState).toBe("paused");
    expect(runningFlow.style.opacity).toBe("0");
  });

  it("applies the legacy initial zoom transform and zooms through the d3 behavior", () => {
    const { container } = renderChains();
    const svg = container.querySelector("#chains-svg") as SVGSVGElement;
    const viewport = container.querySelector("#viewport") as SVGGElement;

    // The legacy open() reset: zoomIdentity.translate(16, 0).scale(1).
    expect(viewport.getAttribute("transform")).toBe("translate(16,0) scale(1)");

    svg.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true, view: window, clientX: 5, clientY: 5 })
    );
    expect(viewport.getAttribute("transform")).not.toBe("translate(16,0) scale(1)");
    expect(viewport.getAttribute("transform")).toContain("scale(");
  });

  it("keeps the zoom transform across a world-change re-render", () => {
    const { container } = renderChains();
    const svg = container.querySelector("#chains-svg") as SVGSVGElement;

    svg.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true, view: window, clientX: 5, clientY: 5 })
    );
    const zoomed = (container.querySelector("#viewport") as SVGGElement).getAttribute("transform");
    expect(zoomed).not.toBe("translate(16,0) scale(1)");

    act(() => notifyWorldChanged());

    expect((container.querySelector("#viewport") as SVGGElement).getAttribute("transform")).toBe(zoomed);
  });

  it("re-reads the goods on world change (a new chain good appears)", () => {
    const goods = makeGoods();
    stubWorld(goods);
    const { container } = renderChains();
    expect(container.querySelectorAll("[data-nid]").length).toBe(4);

    // Fish becomes an ingredient of a new manufactured good.
    goods.push(makeGood({ i: 6, name: "Lutefisk", value: 7, recipes: [{ 5: 4 }] }));
    act(() => notifyWorldChanged());

    expect(container.querySelectorAll("[data-nid]").length).toBe(6);
    expect(nodeGroup(container, 5)).toBeTruthy();
    expect(nodeGroup(container, 6)).toBeTruthy();
  });

  it("cleans up on unmount: the svg is emptied, so the flow animation stops with no leak", () => {
    const { container, unmount } = renderChains();
    const svg = container.querySelector("#chains-svg") as SVGSVGElement;

    // Start a flow animation running via hover, so the cleanup provably stops it.
    fireEvent.mouseEnter(nodeGroup(container, 3));
    const runningAnimations = document
      .getAnimations()
      .filter(animation => (animation as CSSAnimation).animationName === "chains-edge-flow");
    expect(runningAnimations.length).toBeGreaterThan(0);

    unmount();

    // The svg (and its keyframes <style> + flow paths) is gone from the DOM and
    // was emptied by the effect cleanup — no animation object survives.
    expect(document.querySelector("#chains-svg")).toBeNull();
    expect(svg.childNodes.length).toBe(0);
    const leakedAnimations = document
      .getAnimations()
      .filter(animation => (animation as CSSAnimation).animationName === "chains-edge-flow");
    expect(leakedAnimations).toEqual([]);
    // The shared tip was reset.
    expect((globalScope.tip as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe("");
  });

  it("renders a fallback when the world has no production chains", () => {
    globalScope.pack = { goods: [] };
    renderChains();
    expect(screen.getByText("No production chains found: add manufactured goods with recipes first.")).toBeTruthy();
    expect(document.querySelector("#chains-svg")).toBeNull();
  });
});
