import type { D3DragEvent, D3ZoomEvent, HierarchyPointNode } from "d3";
import { drag, mean, select, stratify, tree, zoom, zoomTransform } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HierarchyElement } from "@/controllers/hierarchy-tree";
import { minmax } from "@/utils/numberUtils";
import { showTip } from "../host";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";
import { notifyWorldChanged } from "../world-state";

interface HierarchyTreeProps {
  /** Plural entity name from the `open()` seam ("cultures" / "religions") — titles and tips. */
  type: string;
  /**
   * The caller's element array (e.g. `pack.cultures`), passed opaquely through
   * the seam. The tree reads AND mutates these very objects (origins/code
   * edits), exactly as the legacy module did — the data never moves into the
   * World-State accessor because it is the surface's prop, not a world read.
   */
  data: HierarchyElement[];
  /** Editor callbacks fired with the hovered d3 hierarchy node (they read `node.id`). */
  onNodeEnter: (node: unknown) => void;
  onNodeLeave: (node: unknown) => void;
  /** Info-line text for a hovered element. */
  getDescription: (element: HierarchyElement) => string;
  /** Node glyph name for an element (see SHAPE_PATHS); undefined → small circle. */
  getShape: (element: HierarchyElement) => string | undefined;
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

type TreeNode = HierarchyPointNode<HierarchyElement>;
type TreeLink = { source: TreeNode; target: TreeNode };

const MARGINS = { top: 10, right: 10, bottom: -5, left: 10 };
// Legacy updateTree timings: links fade in/out over 50ms, then everything
// glides to the new layout over 1s.
const LINK_FADE_MS = 50;
const MOVE_MS = 1000;

// The node glyph per getShape() value (legacy shapesMap).
const SHAPE_PATHS: Record<string, string> = {
  undefined: "M5,0A5,5,0,1,1,-5,0A5,5,0,1,1,5,0", // small circle
  circle: "M11.3,0A11.3,11.3,0,1,1,-11.3,0A11.3,11.3,0,1,1,11.3,0",
  square: "M-11,-11h22v22h-22Z",
  hexagon: "M-6.5,-11.26l13,0l6.5,11.26l-6.5,11.26l-13,0l-6.5,-11.26Z",
  diamond: "M0,-14L14,0L0,14L-14,0Z",
  concave: "M-11,-11l11,2l11,-2l-2,11l2,11l-11,-2l-11,2l2,-11Z",
  octagon: "M-4.97,-12.01 l9.95,0 l7.04,7.04 l0,9.95 l-7.04,7.04 l-9.95,0 l-7.04,-7.04 l0,-9.95Z",
  pentagon: "M0,-14l14,11l-6,14h-16l-6,-14Z"
};

// The legacy dynamically-injected stylesheet, now scoped to the surface's
// lifetime (mounted/unmounted with the component). Selectors are unchanged —
// they key on the same `hierarchyTree_*` ids/classes — except the legacy
// `div[checked]` hack, which becomes the valid `div[data-checked]`. The
// `#end-arrow` marker and the `dash` keyframes it references are global
// (index.html defs / index.css).
const SCOPED_CSS = /* css */ `
  #hierarchyTree_selectedOrigins > button {
    margin: 0 2px;
  }

  .hierarchyTree_selectedOrigin {
    border: 1px solid #aaa;
    background: none;
    padding: 1px 4px;
  }

  .hierarchyTree_selectedOrigin:hover {
    border: 1px solid #333;
  }

  .hierarchyTree_selectedOrigin::after {
    content: "✕";
    margin-left: 8px;
    color: #999;
  }

  .hierarchyTree_selectedOrigin:hover:after {
    color: #333;
  }

  #hierarchyTree_originSelector > form > div {
    padding: 0.3em;
    margin: 1px 0;
    border-radius: 1em;
  }

  #hierarchyTree_originSelector > form > div:hover {
    background-color: #ddd;
  }

  #hierarchyTree_originSelector > form > div[data-checked] {
    background-color: #c6d6d6;
  }

  #hierarchyTree_nodes > g > text {
    pointer-events: none;
    stroke: none;
    font-size: 11px;
  }

  #hierarchyTree_nodes > g.selected {
    stroke: #c13119;
    stroke-width: 1;
    cursor: move;
  }

  #hierarchyTree_dragLine {
    marker-end: url(#end-arrow);
    stroke: #333333;
    stroke-dasharray: 5;
    stroke-dashoffset: 1000;
    animation: dash 80s linear backwards;
  }
`;

/**
 * Normalize origins in place, exactly as legacy: the root gets `[null]`, an
 * element with no origins (or a dangling primary origin) gets `[0]`. Mutates
 * the caller's element objects deliberately — this is how the legacy module
 * healed pack data — and returns the not-removed elements as a NEW array (the
 * memo identity that re-triggers the d3 effect).
 */
export function cleanupOrigins(elements: HierarchyElement[]): HierarchyElement[] {
  const existingElements = elements.filter(d => !d.removed);

  return existingElements.map(d => {
    if (d.i === 0) d.origins = [null];
    else if (!d.origins.length) d.origins = [0];
    else if (!existingElements.find(el => d.origins[0] === el.i)) d.origins = [0];
    return d;
  });
}

/**
 * The ids of `elementId` and all its primary-origin descendants — the elements
 * that cannot be offered as origins (a node cannot descend from its own
 * child). Mirrors what the legacy code got from `d.descendants()` on the
 * stratified tree, computed purely from the element array.
 */
export function getDescendantIds(elementId: number, elements: HierarchyElement[]): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const element of elements) {
    const parent = element.origins[0];
    if (parent == null) continue;
    const children = childrenByParent.get(parent) ?? [];
    children.push(element.i);
    childrenByParent.set(parent, children);
  }

  const descendants = new Set<number>([elementId]);
  const queue = [elementId];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const child of childrenByParent.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      queue.push(child);
    }
  }
  return descendants;
}

function linkPathBetween(sx: number, sy: number, tx: number, ty: number): string {
  return `M${sx},${sy} C${sx},${(sy * 3 + ty) / 4} ${tx},${(sy * 2 + ty) / 3} ${tx},${ty}`;
}

function getLinkKey(link: TreeLink): string {
  return `${link.source.id}-${link.target.id}`;
}

function getSecondaryLinks(root: TreeNode): TreeLink[] {
  const nodes = root.descendants();
  const links: TreeLink[] = [];

  for (const node of nodes) {
    const origins = node.data.origins;
    for (let i = 1; i < origins.length; i++) {
      const source = nodes.find(n => n.data.i === origins[i]);
      if (source) links.push({ source, target: node });
    }
  }

  return links;
}

// Sibling sort: nodes with secondary origins sort by the mean of those origin
// ids so dashed cross-links stay short (legacy getSortIndex).
function getSortIndex(node: TreeNode): number {
  const descendants = node.descendants();
  const secondaryOrigins = descendants.flatMap(({ data }) => data.origins.slice(1));

  if (secondaryOrigins.length === 0) return node.data.i;
  return mean(secondaryOrigins as number[]) ?? 0;
}

// The geometry captured when a render is torn down, so the NEXT render (after
// an origins/code mutation or any world change) can start every node and link
// at its current on-screen position and transition to the new layout — the
// legacy updateTree() animation, re-expressed as effect-to-effect state.
interface PreviousRender {
  nodeCoords: Map<number, { x: number; y: number }>;
  primaryLinkPaths: Map<string, string>;
  secondaryLinkPaths: Map<string, string>;
}

// The React state of the "Select origins" dialog. The selectable list and the
// row-highlight snapshot are frozen at open, matching the legacy form (built
// once from innerHTML); only the radio/checkbox state is live.
interface OriginSelectorState {
  elementId: number;
  selectableIds: number[];
  initialOrigins: number[];
  primary: number;
  checked: number[];
}

/**
 * HierarchyTree — the cultures/religions hierarchy chart, at parity with the
 * legacy `src/controllers/hierarchy-tree.ts` jQuery-UI dialog (Phase 3 Slice
 * 10), following the Slice 9 d3-in-React pattern.
 *
 * React owns the panel frame, the info line / selected-element bar, and the
 * "Select origins" sub-dialog; d3 owns everything inside the ref'd svg —
 * stratify + tree layout, primary/secondary links, node glyphs, pan/zoom on
 * the svg, hover (editor callbacks + tip + info line), and drag-to-reorigin
 * with its dashed drag line. All of it is drawn by ONE effect keyed on the
 * memoized valid-element list (itself keyed on `useWorldVersion`): mutations
 * (drag adds an origin, the origin buttons/selector edit them, the
 * abbreviation input renames) mutate the caller's element objects in place —
 * as legacy did — and signal `notifyWorldChanged()`, which re-runs the effect.
 * The cleanup interrupts in-flight transitions, captures the current geometry
 * (so the next render animates from it — the legacy updateTree transition),
 * detaches the zoom/drag behaviors, empties the svg, and resets the tip.
 */
export function HierarchyTree({
  type,
  data,
  onNodeEnter,
  onNodeLeave,
  getDescription,
  getShape,
  anchor,
  onClose
}: HierarchyTreeProps) {
  const worldVersion = useWorldVersion();
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<TreeNode | null>(null);
  const prevRenderRef = useRef<PreviousRender | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverText, setHoverText] = useState<string | null>(null);
  const [selector, setSelector] = useState<OriginSelectorState | null>(null);

  // The d3 effect re-applies the selection outline after a rebuild without
  // depending on the selection (selecting must not re-layout the tree).
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the (in-place mutated) data.
  const validElements = useMemo(() => cleanupOrigins(data), [data, worldVersion]);

  // The one d3 draw. First run renders statically (legacy renderTree on open);
  // every re-run — a mutation from this surface or any external world change —
  // starts from the captured previous geometry and transitions to the new
  // layout (legacy updateTree). Controls never call a draw imperatively; they
  // mutate + notifyWorldChanged, and the changed memo identity re-runs this.
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    // getRoot: stratify by primary origin; on bad data, tip and keep showing
    // the last good tree (legacy oldRoot fallback).
    let root: TreeNode | null = null;
    try {
      root = stratify<HierarchyElement>()
        .id(d => String(d.i))
        .parentId(d => (d.origins[0] == null ? null : String(d.origins[0])))(validElements) as unknown as TreeNode;
    } catch (error) {
      showTip(`Hierarchy data issue. ${error}`, false, "error", 6000);
      root = rootRef.current;
    }
    if (!root) return;
    rootRef.current = root;

    const treeWidth = root.leaves().length * 50;
    const treeHeight = root.height * 50;
    const layoutWidth = treeWidth - MARGINS.left - MARGINS.right;
    const layoutHeight = treeHeight + 30 - MARGINS.top - MARGINS.bottom;
    const treeLayout = tree<HierarchyElement>().size([layoutWidth, layoutHeight]);
    treeLayout(root.sort((a, b) => getSortIndex(a as TreeNode) - getSortIndex(b as TreeNode)));

    const svg = select(svgElement);
    const previous = prevRenderRef.current;

    // Legacy open() sized the svg and dialog once; a mutation update re-laid
    // out the tree but never resized. Size only on the first render.
    if (previous === null) {
      const width = minmax(treeWidth, 300, window.innerWidth * 0.75);
      const height = minmax(treeHeight, 200, window.innerHeight * 0.75);
      svg.attr("width", width).attr("height", height).attr("viewBox", `0, 0, ${width}, ${height}`);
    }
    const svgWidth = Number(svg.attr("width"));
    const svgHeight = Number(svg.attr("height"));

    // --- the legacy insertHtml() svg scaffolding ---
    const viewbox = svg
      .append("g")
      .attr("id", "hierarchyTree_viewbox")
      .style("text-anchor", "middle")
      .style("dominant-baseline", "central");
    const treeGroup = viewbox.append("g").attr("transform", "translate(10, -45)");
    const linksGroup = treeGroup
      .append("g")
      .attr("id", "hierarchyTree_links")
      .attr("fill", "none")
      .attr("stroke", "#aaa");
    const primaryLinks = linksGroup.append("g").attr("id", "hierarchyTree_linksPrimary");
    const secondaryLinks = linksGroup
      .append("g")
      .attr("id", "hierarchyTree_linksSecondary")
      .attr("stroke-dasharray", "1");
    const nodesGroup = treeGroup.append("g").attr("id", "hierarchyTree_nodes");
    const dragLine = treeGroup.append("path").attr("id", "hierarchyTree_dragLine");

    // Pan/zoom. d3 keeps the gesture state on the svg element itself (__zoom),
    // which React preserves across re-renders — restore it so a mutation
    // re-render does not snap the view back to identity.
    const handleZoom = (event: D3ZoomEvent<SVGSVGElement, unknown>) =>
      viewbox.attr("transform", event.transform.toString());
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 1.5])
      .extent([
        [0, 0],
        [svgWidth, svgHeight]
      ])
      .on("zoom", handleZoom);
    svg.call(zoomBehavior);
    const persistedTransform = zoomTransform(svgElement);
    if (persistedTransform.k !== 1 || persistedTransform.x !== 0 || persistedTransform.y !== 0) {
      viewbox.attr("transform", persistedTransform.toString());
    }

    const prevCoordOf = (elementId: number) => previous?.nodeCoords.get(elementId);

    // Links: on an update, existing links start at their previous geometry and
    // glide to the new one; brand-new links fade in first; vanished links are
    // re-drawn at their old path and fade out (legacy linkEnter/Update/Exit).
    function renderLinkGroup(
      group: typeof primaryLinks,
      links: TreeLink[],
      prevPaths: Map<string, string> | undefined
    ): void {
      const currentKeys = new Set<string>();

      for (const link of links) {
        const key = getLinkKey(link);
        currentKeys.add(key);
        const finalPath = linkPathBetween(link.source.x, link.source.y, link.target.x, link.target.y);
        const path = group.append("path").attr("data-key", key);

        if (!previous) {
          path.attr("d", finalPath);
          continue;
        }

        const from = prevCoordOf(link.source.data.i) ?? link.source;
        const to = prevCoordOf(link.target.data.i) ?? link.target;
        path.attr("d", linkPathBetween(from.x, from.y, to.x, to.y));
        if (!prevPaths?.has(key)) {
          path.attr("opacity", 0);
          path.transition().duration(LINK_FADE_MS).attr("opacity", 1);
        }
        path.transition().delay(LINK_FADE_MS).duration(MOVE_MS).attr("d", finalPath);
      }

      if (previous && prevPaths) {
        for (const [key, pathData] of prevPaths) {
          if (currentKeys.has(key)) continue;
          group
            .append("path")
            .attr("data-key", key)
            .attr("d", pathData)
            .transition()
            .duration(LINK_FADE_MS)
            .attr("opacity", 0)
            .remove();
        }
      }
    }

    renderLinkGroup(primaryLinks, root.links() as TreeLink[], previous?.primaryLinkPaths);
    renderLinkGroup(secondaryLinks, getSecondaryLinks(root), previous?.secondaryLinkPaths);

    // --- nodes (legacy renderTree) ---
    const node = nodesGroup
      .selectAll<SVGGElement, TreeNode>("g")
      .data(root.descendants() as TreeNode[], d => String(d.id))
      .join("g")
      .attr("data-id", d => d.data.i)
      .attr("stroke", "#333")
      .attr("transform", d => {
        const from = prevCoordOf(d.data.i);
        return from ? `translate(${from.x}, ${from.y})` : `translate(${d.x}, ${d.y})`;
      })
      .on("mouseenter", handleNodeEnter)
      .on("mouseleave", handleNodeLeave)
      .on("click", (_event, d) => selectNode(d))
      .call(drag<SVGGElement, TreeNode>().on("start", dragToReorigin));

    if (previous) {
      node
        .transition()
        .delay(LINK_FADE_MS)
        .duration(MOVE_MS)
        .attr("transform", d => `translate(${d.x}, ${d.y})`);
    }

    node
      .selectAll("path")
      .data(d => [d])
      .join("path")
      .attr("d", d => SHAPE_PATHS[getShape(d.data) ?? "undefined"])
      .attr("fill", d => d.data.color || "#ffffff")
      .attr("stroke-dasharray", d => (d.data.cells ? "none" : "1"));

    node
      .selectAll("text")
      .data(d => [d])
      .join("text")
      .text(d => d.data.code || "");

    // Re-apply the selection outline after a rebuild (legacy kept the node's
    // inline outline because it never rebuilt the nodes).
    if (selectedIdRef.current != null) {
      nodesGroup.select(`g[data-id="${selectedIdRef.current}"]`).style("outline", "1px solid #c13119");
    }

    function selectNode(d: TreeNode): void {
      // Legacy allowed selecting any node, including the root (its `d.id === 0`
      // guard compared the string id to a number, so it never fired).
      nodesGroup.selectAll("g").style("outline", "none");
      nodesGroup.select(`g[data-id="${d.data.i}"]`).style("outline", "1px solid #c13119");
      setSelectedId(d.data.i);
    }

    function handleNodeEnter(this: SVGGElement, _event: MouseEvent, d: TreeNode): void {
      if (d.depth === 0) return;

      this.classList.add("selected");
      onNodeEnter(d);

      setHoverText(getDescription(d.data));
      showTip("Drag to other node to add parent, click to edit");
    }

    function handleNodeLeave(this: SVGGElement, _event: MouseEvent, d: TreeNode): void {
      this.classList.remove("selected");
      onNodeLeave(d);

      setHoverText(null);
      showTip("");
    }

    // Drag-to-reorigin: drag a node onto another node (the hovered one carries
    // the `.selected` class) to ADD that node as an origin — the new PRIMARY
    // origin if the dragged element was top-level (`origins === [0]`),
    // otherwise a new secondary origin. The mutation writes the caller's
    // element object in place (exactly the legacy behavior) and signals
    // notifyWorldChanged(), which re-runs this effect as the animated update.
    function dragToReorigin(event: D3DragEvent<SVGGElement, TreeNode, unknown>, from: TreeNode): void {
      dragLine.attr("d", `M${from.x},${from.y}L${from.x},${from.y}`);

      event.on("drag", dragEvent => {
        dragLine.attr("d", `M${from.x},${from.y}L${dragEvent.x},${dragEvent.y}`);
      });

      event.on("end", () => {
        dragLine.attr("d", "");
        const selected = nodesGroup.select<SVGGElement>("g.selected");
        if (!selected.size()) return;

        const elementId = from.data.i;
        const newOrigin = (selected.datum() as TreeNode).data.i;
        if (elementId === newOrigin) return; // dragged to itself
        if (from.data.origins.includes(newOrigin)) return; // already a child of the selected node
        if (from.descendants().some(descendant => descendant.data.i === newOrigin)) return; // cannot be a child of its own child

        const element = data.find(({ i }) => i === elementId);
        if (!element) return;

        if (element.origins[0] === 0) element.origins = [];
        element.origins.push(newOrigin);

        selectNode(from);
        notifyWorldChanged();
      });
    }

    return () => {
      // Interrupt in-flight transitions, then capture the current (possibly
      // mid-flight) geometry so the next render animates from it.
      svg.selectAll("*").interrupt();

      const nodeCoords = new Map<number, { x: number; y: number }>();
      nodesGroup.selectAll<SVGGElement, unknown>("g").each(function () {
        const id = Number(this.getAttribute("data-id"));
        const match = /translate\((-?[\d.eE+]+)[, ]+(-?[\d.eE+]+)\)/.exec(this.getAttribute("transform") ?? "");
        if (match) nodeCoords.set(id, { x: Number(match[1]), y: Number(match[2]) });
      });
      const captureLinkPaths = (group: typeof primaryLinks) => {
        const paths = new Map<string, string>();
        group.selectAll<SVGPathElement, unknown>("path").each(function () {
          const key = this.getAttribute("data-key");
          const pathData = this.getAttribute("d");
          if (key && pathData) paths.set(key, pathData);
        });
        return paths;
      };
      prevRenderRef.current = {
        nodeCoords,
        primaryLinkPaths: captureLinkPaths(primaryLinks),
        secondaryLinkPaths: captureLinkPaths(secondaryLinks)
      };

      // Detach the behaviors, empty the svg (dropping every d3-attached
      // listener with it), and reset the shared tooltip.
      nodesGroup.selectAll<SVGGElement, unknown>("g").on(".drag", null);
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
      showTip("");
    };
  }, [validElements, data, onNodeEnter, onNodeLeave, getDescription, getShape]);

  const selectedElement = selectedId == null ? null : (validElements.find(el => el.i === selectedId) ?? null);

  /** Commit the abbreviation input (legacy `onchange`: on blur/Enter, only when changed). */
  function commitCode(input: HTMLInputElement): void {
    if (!selectedElement || input.value === (selectedElement.code || "")) return;
    if (input.value.length > 3) {
      showTip("Abbreviation must be 3 characters or less", false, "error", 3000);
      return;
    }
    if (!input.value.length) {
      showTip("Abbreviation cannot be empty", false, "error", 3000);
      return;
    }

    selectedElement.code = input.value;
    notifyWorldChanged();
  }

  /** Remove one origin link from the selected element (its button's ✕ click). */
  function removeOrigin(origin: number): void {
    if (!selectedElement) return;
    const filtered = selectedElement.origins.filter(elementOrigin => elementOrigin !== origin);
    selectedElement.origins = filtered.length ? filtered : [0];
    notifyWorldChanged();
  }

  function unselect(): void {
    const svgElement = svgRef.current;
    if (svgElement) select(svgElement).selectAll("#hierarchyTree_nodes > g").style("outline", "none");
    setSelectedId(null);
  }

  function openOriginSelector(): void {
    if (!selectedElement) return;
    const descendants = getDescendantIds(selectedElement.i, validElements);
    const selectableIds = validElements.filter(el => !descendants.has(el.i)).map(el => el.i);
    const origins = selectedElement.origins.filter((origin): origin is number => origin != null);
    setSelector({
      elementId: selectedElement.i,
      selectableIds,
      initialOrigins: origins,
      primary: selectedElement.origins[0] ?? 0,
      checked: origins
    });
  }

  function applyOriginSelector(): void {
    if (!selector) return;
    setSelector(null);

    // The selector stays bound to the element it was opened for, even if the
    // selection changed meanwhile (legacy closed over its dataElement).
    const element = data.find(el => el.i === selector.elementId);
    if (!element) return;

    const primary = selector.primary;
    // Checked boxes in form (= validElements) order, minus the primary.
    const secondary = selector.selectableIds.filter(id => id !== 0 && id !== primary && selector.checked.includes(id));
    element.origins = [primary, ...secondary];
    notifyWorldChanged();
  }

  function cancelOriginSelector(): void {
    setSelector(null);
  }

  const title = `${type.charAt(0).toUpperCase()}${type.slice(1)} tree`;

  const selectorElements = selector ? validElements.filter(el => selector.selectableIds.includes(el.i)) : [];

  return (
    <>
      <Panel title={title} anchor={anchor} onClose={onClose}>
        <style>{SCOPED_CSS}</style>
        <div
          style={{
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between"
          }}
        >
          <svg ref={svgRef} role="img" aria-label={title} />

          <div id="hierarchyTree_details" className="chartInfo">
            {selectedElement === null ? (
              <div id="hierarchyTree_infoLine">{hoverText ?? "‍"}</div>
            ) : (
              <div id="hierarchyTree_selected">
                <span>
                  <span id="hierarchyTree_selectedName">{selectedElement.name}</span>.{" "}
                </span>
                <span data-name="Type short name (abbreviation)">
                  Abbreviation:{" "}
                  <input
                    id="hierarchyTree_selectedCode"
                    aria-label="Abbreviation"
                    type="text"
                    maxLength={3}
                    size={3}
                    key={selectedElement.i}
                    defaultValue={selectedElement.code || ""}
                    onBlur={event => commitCode(event.currentTarget)}
                    onKeyDown={event => {
                      if (event.key === "Enter") commitCode(event.currentTarget);
                    }}
                  />
                </span>
                <span>
                  Origins:{" "}
                  <span id="hierarchyTree_selectedOrigins">
                    {selectedElement.origins
                      .filter((origin): origin is number => Boolean(origin))
                      .map((origin, index) => {
                        const originElement = validElements.find(el => el.i === origin);
                        const originType = index ? "Secondary" : "Primary";
                        const tipText = `${originType} origin: ${originElement?.name}. Click to remove link to that origin`;
                        return (
                          <button
                            key={origin}
                            type="button"
                            data-id={origin}
                            className="hierarchyTree_selectedButton hierarchyTree_selectedOrigin"
                            data-tip={tipText}
                            onClick={() => removeOrigin(origin)}
                          >
                            {originElement?.code}
                          </button>
                        );
                      })}
                  </span>
                </span>
                <button
                  type="button"
                  data-tip="Edit this node's origins"
                  className="hierarchyTree_selectedButton"
                  id="hierarchyTree_selectedSelectButton"
                  onClick={openOriginSelector}
                >
                  Edit
                </button>
                <button
                  type="button"
                  data-tip="Unselect this node"
                  className="hierarchyTree_selectedButton"
                  id="hierarchyTree_selectedCloseButton"
                  onClick={unselect}
                >
                  Unselect
                </button>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {selector && (
        <Panel title="Select origins" onClose={cancelOriginSelector}>
          <div id="hierarchyTree_originSelector">
            <form style={{ maxHeight: "35vh" }} onSubmit={event => event.preventDefault()}>
              {selectorElements.map(el => (
                <div key={el.i} data-checked={selector.initialOrigins.includes(el.i) ? "" : undefined}>
                  <input
                    data-tip="Set as primary origin"
                    type="radio"
                    name="primary"
                    aria-label={`Set ${el.i === 0 ? "top level" : el.name} as primary origin`}
                    value={el.i}
                    checked={selector.primary === el.i}
                    onChange={() => setSelector({ ...selector, primary: el.i })}
                  />
                  {el.i === 0 ? (
                    " Top level"
                  ) : (
                    <>
                      <input
                        data-id={el.i}
                        id={`selectElementOrigin${el.i}`}
                        className="checkbox"
                        type="checkbox"
                        checked={selector.checked.includes(el.i)}
                        onChange={event =>
                          setSelector({
                            ...selector,
                            checked: event.currentTarget.checked
                              ? [...selector.checked, el.i]
                              : selector.checked.filter(id => id !== el.i)
                          })
                        }
                      />
                      <label
                        data-tip="Check to set as a secondary origin"
                        htmlFor={`selectElementOrigin${el.i}`}
                        className="checkbox-label"
                      >
                        <fill-box fill={el.color} size=".8em" disabled /> {el.code}: {el.name}
                      </label>
                    </>
                  )}
                </div>
              ))}
            </form>
            <div style={{ textAlign: "right", marginTop: "0.5em" }}>
              <button type="button" onClick={applyOriginSelector}>
                Select
              </button>{" "}
              <button type="button" onClick={cancelOriginSelector}>
                Cancel
              </button>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
