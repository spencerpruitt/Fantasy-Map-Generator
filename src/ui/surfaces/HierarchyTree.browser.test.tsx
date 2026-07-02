import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HierarchyElement } from "@/controllers/hierarchy-tree";
import { open } from "@/controllers/hierarchy-tree";
import { closeAllSurfaces, getOpenSurfaces } from "../app-shell/registry";
import { notifyWorldChanged } from "../world-state";
import { HierarchyTree } from "./HierarchyTree";

const globalScope = globalThis as Record<string, unknown>;

// A 4-element hierarchy (plus one removed element that must be filtered out):
// root 0 with children 1 and 2, and 3 under 1 with a secondary origin from 2 —
// pinning the stratify layout, both link kinds, hover/click/drag semantics,
// the origins editing, and the update transition.
function makeData(): HierarchyElement[] {
  return [
    { i: 0, name: "Root", code: "R", color: "#cccccc", cells: 10, origins: [], kind: "root" },
    { i: 1, name: "Alpha", code: "Al", color: "#ff0000", cells: 5, origins: [0], kind: "circle" },
    { i: 2, name: "Beta", code: "Be", color: "#00ff00", cells: 4, origins: [0], kind: "square" },
    { i: 3, name: "Gamma", code: "Ga", color: "#0000ff", cells: 3, origins: [1, 2], kind: "diamond" },
    { i: 4, name: "Gone", code: "Go", origins: [0], removed: true, kind: "circle" }
  ];
}

const getShape = (element: HierarchyElement) => (element.kind === "root" ? undefined : (element.kind as string));
const getDescription = (element: HierarchyElement) => `${element.name} described`;

// The circle glyph from the surface's shape map — the parity check that
// getShape() drives the node path.
const CIRCLE_PATH = "M11.3,0A11.3,11.3,0,1,1,-11.3,0A11.3,11.3,0,1,1,11.3,0";

beforeEach(() => {
  globalScope.tip = vi.fn();
  globalScope.closeDialogs = vi.fn();
});

afterEach(() => {
  closeAllSurfaces();
  globalScope.tip = undefined;
  globalScope.closeDialogs = undefined;
});

function renderTree(data: HierarchyElement[], overrides: Partial<Record<string, unknown>> = {}) {
  const onNodeEnter = vi.fn();
  const onNodeLeave = vi.fn();
  const view = render(
    <HierarchyTree
      type="cultures"
      data={data}
      onNodeEnter={onNodeEnter}
      onNodeLeave={onNodeLeave}
      getDescription={getDescription}
      getShape={getShape}
      onClose={() => {}}
      {...overrides}
    />
  );
  return { ...view, onNodeEnter, onNodeLeave };
}

function nodeGroup(container: HTMLElement, id: number): SVGGElement {
  const node = container.querySelector<SVGGElement>(`#hierarchyTree_nodes > g[data-id="${id}"]`);
  if (!node) throw new Error(`node ${id} not rendered`);
  return node;
}

// Native mouse dispatch with a window view — d3-drag listens on
// `event.view`, so React Testing Library's default synthetic init is not enough.
function dispatchMouse(target: Element | Window, type: string, x = 0, y = 0): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 })
  );
}

describe("<HierarchyTree>", () => {
  it("renders the stratified tree: nodes with glyphs and codes, primary and secondary links", () => {
    const { container } = renderTree(makeData());

    expect(screen.getByRole("dialog", { name: "Cultures tree" })).toBeTruthy();

    // Four valid elements (the removed one is filtered out), each a node group.
    const nodes = container.querySelectorAll("#hierarchyTree_nodes > g");
    expect(nodes.length).toBe(4);

    // Primary links: one per non-root node. Secondary: Gamma's second origin.
    expect(container.querySelectorAll("#hierarchyTree_linksPrimary > path").length).toBe(3);
    const secondary = container.querySelectorAll("#hierarchyTree_linksSecondary > path");
    expect(secondary.length).toBe(1);
    expect(secondary[0].getAttribute("data-key")).toBe("2-3");

    // The glyph comes from getShape(), the fill from the element color, the
    // label from the code.
    const alpha = nodeGroup(container, 1);
    expect(alpha.querySelector("path")?.getAttribute("d")).toBe(CIRCLE_PATH);
    expect(alpha.querySelector("path")?.getAttribute("fill")).toBe("#ff0000");
    expect(alpha.querySelector("text")?.textContent).toBe("Al");

    // The drag line scaffold exists (empty until a drag).
    expect(container.querySelector("#hierarchyTree_dragLine")).toBeTruthy();
  });

  it("fires the editor callbacks, the tip, and the info line on node hover", () => {
    const { container, onNodeEnter, onNodeLeave } = renderTree(makeData());
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;

    const alpha = nodeGroup(container, 1);
    fireEvent.mouseEnter(alpha);

    expect(onNodeEnter).toHaveBeenCalledTimes(1);
    const hoveredNode = onNodeEnter.mock.calls[0][0] as { id: string; data: HierarchyElement };
    expect(hoveredNode.id).toBe("1");
    expect(hoveredNode.data.i).toBe(1);
    expect(alpha.classList.contains("selected")).toBe(true);
    expect(document.getElementById("hierarchyTree_infoLine")?.textContent).toBe("Alpha described");
    expect(tipMock).toHaveBeenCalledWith(
      "Drag to other node to add parent, click to edit",
      undefined,
      undefined,
      undefined
    );

    fireEvent.mouseLeave(alpha);
    expect(onNodeLeave).toHaveBeenCalledTimes(1);
    expect(alpha.classList.contains("selected")).toBe(false);
    expect(tipMock.mock.calls.at(-1)).toEqual(["", undefined, undefined, undefined]);

    // The root node is inert to hover (legacy depth-0 guard).
    fireEvent.mouseEnter(nodeGroup(container, 0));
    expect(onNodeEnter).toHaveBeenCalledTimes(1);
  });

  it("selects a node on click, shows its details, and unselects", () => {
    const { container } = renderTree(makeData());

    fireEvent.click(nodeGroup(container, 3));

    expect(document.getElementById("hierarchyTree_selectedName")?.textContent).toBe("Gamma");
    expect((document.getElementById("hierarchyTree_selectedCode") as HTMLInputElement).value).toBe("Ga");
    expect(nodeGroup(container, 3).style.outline).toContain("solid");

    // Its two origins render as removable buttons: primary Alpha, secondary Beta.
    const originButtons = container.querySelectorAll("#hierarchyTree_selectedOrigins > button");
    expect(Array.from(originButtons).map(button => button.textContent)).toEqual(["Al", "Be"]);
    expect(originButtons[0].getAttribute("data-tip")).toContain("Primary origin: Alpha");
    expect(originButtons[1].getAttribute("data-tip")).toContain("Secondary origin: Beta");

    fireEvent.click(screen.getByRole("button", { name: "Unselect" }));
    expect(document.getElementById("hierarchyTree_selected")).toBeNull();
    expect(document.getElementById("hierarchyTree_infoLine")).toBeTruthy();
    expect(nodeGroup(container, 3).style.outline).not.toContain("solid");
  });

  it("commits an abbreviation edit to the element and the node label, and rejects an empty one", () => {
    const data = makeData();
    const { container } = renderTree(data);
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;

    fireEvent.click(nodeGroup(container, 1));
    const input = document.getElementById("hierarchyTree_selectedCode") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "XY" } });
    fireEvent.blur(input);
    expect(data[1].code).toBe("XY");
    expect(nodeGroup(container, 1).querySelector("text")?.textContent).toBe("XY");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(tipMock.mock.calls.at(-1)?.[0]).toBe("Abbreviation cannot be empty");
    expect(data[1].code).toBe("XY");
  });

  it("removes an origin via its button and drops the secondary link", async () => {
    const data = makeData();
    const { container } = renderTree(data);

    fireEvent.click(nodeGroup(container, 3));
    const betaButton = Array.from(container.querySelectorAll("#hierarchyTree_selectedOrigins > button")).find(
      button => button.textContent === "Be"
    ) as HTMLElement;
    fireEvent.click(betaButton);

    expect(data[3].origins).toEqual([1]);
    // One origin button remains, and the dashed link fades out and is removed.
    expect(container.querySelectorAll("#hierarchyTree_selectedOrigins > button").length).toBe(1);
    await waitFor(() => expect(container.querySelectorAll("#hierarchyTree_linksSecondary > path").length).toBe(0), {
      timeout: 2000
    });
  });

  it("edits origins through the Select origins dialog", () => {
    const data = makeData();
    const { container } = renderTree(data);

    fireEvent.click(nodeGroup(container, 3));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const selectorDialog = screen.getByRole("dialog", { name: "Select origins" });
    expect(selectorDialog).toBeTruthy();

    // Gamma's descendants (itself) are excluded; Top level, Alpha, and Beta remain.
    const rows = selectorDialog.querySelectorAll("form > div");
    expect(rows.length).toBe(3);

    // Current origins pre-check the form: Alpha is primary, both are checked,
    // and their rows carry the origin highlight.
    expect((screen.getByLabelText("Set Alpha as primary origin") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("selectElementOrigin1") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("selectElementOrigin2") as HTMLInputElement).checked).toBe(true);
    expect(rows[1].hasAttribute("data-checked")).toBe(true);

    // Make Beta the primary origin and drop Alpha entirely.
    fireEvent.click(screen.getByLabelText("Set Beta as primary origin"));
    fireEvent.click(document.getElementById("selectElementOrigin1") as HTMLInputElement);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(data[3].origins).toEqual([2]);
    expect(screen.queryByRole("dialog", { name: "Select origins" })).toBeNull();
    // The details bar re-reads the mutated element: one origin button, Beta.
    const originButtons = container.querySelectorAll("#hierarchyTree_selectedOrigins > button");
    expect(Array.from(originButtons).map(button => button.textContent)).toEqual(["Be"]);
  });

  it("adds an origin by dragging a node onto another node", () => {
    const data = makeData();
    const { container } = renderTree(data);

    const alpha = nodeGroup(container, 1);
    const beta = nodeGroup(container, 2);
    const dragLine = container.querySelector("#hierarchyTree_dragLine") as SVGPathElement;

    dispatchMouse(alpha, "mousedown", 10, 10);
    dispatchMouse(window, "mousemove", 40, 40);
    expect(dragLine.getAttribute("d")).toMatch(/^M.+L/);

    // Hovering the target mid-drag marks it `.selected` — the drop target.
    fireEvent.mouseEnter(beta);
    // The drop mutates + selects through React state: flush it via act.
    act(() => dispatchMouse(window, "mouseup", 40, 40));

    // Alpha was top-level (origins [0]), so the drop target becomes its new
    // primary origin; the drag line clears and the dragged node gets selected.
    expect(data[1].origins).toEqual([2]);
    expect(dragLine.getAttribute("d")).toBe("");
    expect(document.getElementById("hierarchyTree_selectedName")?.textContent).toBe("Alpha");
  });

  it("refuses a drag onto the node's own descendant and onto nothing", () => {
    const data = makeData();
    const { container } = renderTree(data);

    // Gamma descends from Alpha — dropping Alpha on Gamma must no-op.
    dispatchMouse(nodeGroup(container, 1), "mousedown", 10, 10);
    dispatchMouse(window, "mousemove", 40, 40);
    fireEvent.mouseEnter(nodeGroup(container, 3));
    dispatchMouse(window, "mouseup", 40, 40);
    expect(data[1].origins).toEqual([0]);

    // Dropping over nothing (no hovered node) must no-op too.
    dispatchMouse(nodeGroup(container, 1), "mousedown", 10, 10);
    dispatchMouse(window, "mousemove", 60, 60);
    dispatchMouse(window, "mouseup", 60, 60);
    expect(data[1].origins).toEqual([0]);
  });

  it("pans/zooms the viewbox through the d3 zoom behavior", () => {
    const { container } = renderTree(makeData());
    const svg = container.querySelector("svg") as SVGSVGElement;
    const viewbox = container.querySelector("#hierarchyTree_viewbox") as SVGGElement;

    expect(viewbox.getAttribute("transform")).toBeNull();
    svg.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true, view: window, clientX: 5, clientY: 5 })
    );
    expect(viewbox.getAttribute("transform")).toContain("scale(");
  });

  it("re-renders as an animated update when the world changes, starting from the previous geometry", async () => {
    const data = makeData();
    const { container } = renderTree(data);
    const before = nodeGroup(container, 3).getAttribute("transform");

    // Reparent Gamma under Beta (an external mutation, e.g. another editor).
    data[3].origins = [2];
    act(() => notifyWorldChanged());

    // The rebuilt node starts at its previous position...
    expect(nodeGroup(container, 3).getAttribute("transform")).toBe(before);
    // ...then transitions to the new layout position.
    await waitFor(() => expect(nodeGroup(container, 3).getAttribute("transform")).not.toBe(before), {
      timeout: 3000
    });
  });

  it("re-reads the data on world change (a new element appears)", () => {
    const data = makeData();
    const { container } = renderTree(data);

    data.push({ i: 5, name: "Epsilon", code: "Ep", color: "#123456", cells: 1, origins: [2], kind: "circle" });
    act(() => notifyWorldChanged());

    expect(container.querySelectorAll("#hierarchyTree_nodes > g").length).toBe(5);
    expect(nodeGroup(container, 5).querySelector("text")?.textContent).toBe("Ep");
  });

  it("cleans up on unmount: interrupts the transition, empties the svg, resets the tip", () => {
    const data = makeData();
    const { unmount } = renderTree(data);
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;

    // Kick off a layout transition, then unmount mid-flight.
    data[3].origins = [2];
    act(() => notifyWorldChanged());
    unmount();

    expect(document.querySelector("#hierarchyTree_viewbox")).toBeNull();
    expect(document.querySelector("#hierarchyTree_nodes")).toBeNull();
    expect(tipMock.mock.calls.at(-1)).toEqual(["", undefined, undefined, undefined]);
  });

  it("open() seam: rejects fewer than three valid elements with the legacy tip, opens otherwise", () => {
    const tipMock = globalScope.tip as ReturnType<typeof vi.fn>;
    const noop = () => {};
    const baseProps = {
      type: "cultures",
      onNodeEnter: noop,
      onNodeLeave: noop,
      getDescription,
      getShape
    };

    open({
      ...baseProps,
      data: [makeData()[0], makeData()[1], { ...makeData()[2], removed: true }]
    });
    expect(tipMock).toHaveBeenCalledWith("Not enough cultures to show hierarchy", false, "error");
    expect(getOpenSurfaces()).toEqual([]);

    open({ ...baseProps, data: makeData() });
    expect(globalScope.closeDialogs).toHaveBeenCalledWith(".stable");
    expect(getOpenSurfaces().map(surface => surface.id)).toEqual(["hierarchy-tree"]);
  });
});
