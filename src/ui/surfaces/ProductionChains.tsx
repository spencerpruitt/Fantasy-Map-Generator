import { type D3ZoomEvent, type Selection, select, zoom, zoomIdentity, zoomTransform } from "d3";
import { useEffect, useMemo, useRef } from "react";
import {
  BASE_EDGE_STROKE_WIDTH,
  buildLayout,
  CARD_HEIGHT,
  CARD_RADIUS,
  CARD_WIDTH,
  COLUMN_STEP,
  COMPONENT_GAP,
  DEFAULT_EDGE_OPACITY,
  DEFAULT_LABEL_OPACITY,
  type DisplayEdge,
  FLOW_DOT_GAP,
  FLOW_STROKE_WIDTH,
  type GraphNode,
  getBasePositions,
  getDirectedChainIds,
  getDisplayEdges,
  getEdgeColorIndex,
  getEdgeGeometry,
  getFlowDurationSeconds,
  getFlowOpacity,
  getLayoutBounds,
  HEADER_HEIGHT,
  ICON_RADIUS,
  type LayoutData,
  SVG_PADDING,
  truncateGoodName,
  ZOOM_MAX,
  ZOOM_MIN
} from "@/controllers/production-chains";
import { C_12 } from "@/utils/colorUtils";
import { showTip } from "../host";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";
import { getGood, getGoodStroke, getGoods } from "../world-state";

interface ProductionChainsProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

type GraphGroupSelection = Selection<SVGGElement, unknown, SVGSVGElement, unknown>;

/** The legacy edge stroke color for a C_12 palette slot (`Goods.getStroke`). */
function edgeStrokeColor(index: number): string {
  return getGoodStroke(C_12[index % C_12.length]);
}

/** The card's native tooltip: base price plus each recipe's ingredient list. */
function nodeTooltip(node: GraphNode): string {
  return [
    `${node.good.name} — base price: ${node.good.value}`,
    ...(node.good.recipes ?? []).map(
      (recipe, index) =>
        `Recipe ${index + 1}: ` +
        Object.entries(recipe)
          .map(([id, amount]) => `${getGood(+id)?.name ?? id} x${amount}`)
          .join(" + ")
    )
  ].join("\n");
}

/**
 * Highlight one good's production chain, or restore the resting state when
 * `chainIds` is null: on-chain edges go fully opaque with their flow dots
 * running, everything off-chain fades out — the legacy hover behavior verbatim
 * (flow dots are CSS-keyframe driven; hover toggles their play state).
 */
function applyChainVisibility(
  edgeSelection: GraphGroupSelection,
  nodeSelection: GraphGroupSelection,
  chainIds: Set<number> | null
) {
  edgeSelection.each(function () {
    const group = this as SVGGElement;
    const fromId = +(group.dataset.ef || -1);
    const toId = +(group.dataset.et || -1);
    const visible = chainIds ? chainIds.has(fromId) && chainIds.has(toId) : false;
    group.style.opacity = chainIds ? (visible ? "1" : "0") : String(DEFAULT_EDGE_OPACITY);

    group.querySelectorAll<SVGPathElement>("[data-edge-flow]").forEach(flow => {
      const flowOpacity = flow.dataset.flowOpacity || "0.85";
      flow.style.opacity = chainIds && visible ? flowOpacity : "0";
      flow.style.animationPlayState = chainIds && visible ? "running" : "paused";
    });

    group.querySelectorAll<SVGTextElement>("text").forEach(label => {
      label.style.opacity = chainIds ? (visible ? "1" : "0") : String(DEFAULT_LABEL_OPACITY);
    });
  });

  nodeSelection.each(function () {
    const group = this as SVGGElement;
    const nodeId = +(group.dataset.nid || -1);
    group.style.opacity = chainIds ? (chainIds.has(nodeId) ? "1" : "0") : "1";
  });
}

/**
 * ProductionChains — the goods recipe-graph surface, at parity with the legacy
 * `ProductionChains` jQuery-UI dialog (Phase 3 Slice 11), following the Slice
 * 9/10 d3-in-React pattern.
 *
 * React owns the panel frame and the scroll container; d3 owns everything
 * inside the ref'd svg — the arrow markers, the flow-dot keyframes, the stage
 * headers/component separators, the edge groups (base path, animated flow
 * dots, arrowed path, amount labels), the good cards, pan/zoom on the svg, and
 * the chain-highlight hover. All of it is drawn by ONE effect keyed on the
 * memoized layout (itself keyed on `useWorldVersion`, so any world change
 * re-derives the graph). The flow dots are CSS-keyframe animations scoped to a
 * `<style>` INSIDE the svg (the legacy mechanism — there is no JS timer), so
 * the cleanup stops them by emptying the svg; it also interrupts any in-flight
 * d3 work, detaches the zoom behavior, and resets the shared tip. The zoom
 * transform persists across world-change re-renders via the svg's `__zoom`
 * (like HierarchyTree); a re-open remounts fresh and resets to the legacy
 * initial transform.
 */
export function ProductionChains({ anchor, onClose }: ProductionChainsProps) {
  const worldVersion = useWorldVersion();
  const svgRef = useRef<SVGSVGElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the accessor.
  const model = useMemo(() => {
    const layout: LayoutData = buildLayout([...getGoods()]);
    return { layout, bounds: layout.nodes.length ? getLayoutBounds(layout) : null };
  }, [worldVersion]);
  const { layout, bounds } = model;

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !bounds) return;

    const svg = select(svgElement);
    const positions = getBasePositions(layout.nodes);
    const displayEdges = getDisplayEdges(layout.edges);

    // --- defs: one arrowhead marker per palette color (legacy renderMarkers) ---
    const defs = svg.append("defs");
    C_12.forEach((color, index) => {
      defs
        .append("marker")
        .attr("id", `ca${index}`)
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 7)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", color);
    });

    // The flow-dot keyframes, scoped inside the svg exactly as legacy — the
    // animation is CSS-driven, so removing the svg's children stops it.
    svg
      .append("style")
      .text(
        `@keyframes chains-edge-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -${FLOW_DOT_GAP}; } }`
      );

    const viewport = svg.append("g").attr("id", "viewport");

    // --- stage headers (legacy renderHeaders) ---
    const sortedStages = [...layout.stages].sort((a, b) => a - b);
    for (const stage of sortedStages) {
      const centerX = stage * COLUMN_STEP + CARD_WIDTH / 2 + bounds.offsetX;
      const label = stage === 0 ? "Raw Materials" : `Stage ${stage}`;
      viewport
        .append("text")
        .attr("x", centerX)
        .attr("y", HEADER_HEIGHT - 4)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("font-family", "sans-serif")
        .attr("fill", "#c0c0c0")
        .attr("font-weight", 700)
        .attr("letter-spacing", 0.7)
        .text(label.toUpperCase());
      viewport
        .append("line")
        .attr("x1", centerX - CARD_WIDTH / 2 + 4)
        .attr("y1", HEADER_HEIGHT - 1)
        .attr("x2", centerX + CARD_WIDTH / 2 - 4)
        .attr("y2", HEADER_HEIGHT - 1)
        .attr("stroke", "#e4e4e4")
        .attr("stroke-width", 1);
    }

    // --- component separators (legacy renderComponentSeparators) ---
    if (layout.componentBands.length > 1) {
      for (const band of layout.componentBands.slice(1)) {
        const y = band.y + bounds.offsetY - COMPONENT_GAP / 2;
        viewport
          .append("line")
          .attr("x1", SVG_PADDING / 2)
          .attr("y1", y)
          .attr("x2", bounds.svgWidth - SVG_PADDING / 2)
          .attr("y2", y)
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "4,4");
      }
    }

    const content = viewport.append("g").attr("transform", `translate(${bounds.offsetX},${bounds.offsetY})`);
    const edgesGroup = content.append("g").attr("id", "cedges");
    const nodesGroup = content.append("g").attr("id", "cnodes");

    // --- edges (legacy renderEdge: base path, flow dots, arrowed path, labels) ---
    function appendEdgePath(
      group: Selection<SVGGElement, unknown, null, undefined>,
      d: string,
      color: string,
      markerId?: string
    ) {
      const path = group
        .append("path")
        .attr("d", d)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", BASE_EDGE_STROKE_WIDTH);
      if (markerId) path.attr("marker-end", `url(#${markerId})`);
    }

    function appendEdge(displayEdge: DisplayEdge) {
      const geometry = getEdgeGeometry(displayEdge.representative, positions);
      const edgeColorIndex = getEdgeColorIndex(displayEdge);
      const flowColor = edgeStrokeColor(edgeColorIndex);

      const group = edgesGroup
        .append("g")
        .attr("data-ef", displayEdge.fromId)
        .attr("data-et", displayEdge.toId)
        .style("opacity", DEFAULT_EDGE_OPACITY)
        .style("transition", "opacity 0.15s");

      appendEdgePath(group, geometry.d, flowColor);

      displayEdge.labels.forEach((label, index) => {
        group
          .append("path")
          .attr("data-edge-flow", "1")
          .attr("d", geometry.d)
          .attr("fill", "none")
          .attr("stroke", flowColor)
          .attr("opacity", 0)
          .attr("stroke-width", FLOW_STROKE_WIDTH)
          .attr("stroke-dasharray", `0.01 ${FLOW_DOT_GAP}`)
          .attr("stroke-linecap", "round")
          .attr("data-flow-index", index)
          .attr("data-flow-amount", label.amount)
          .attr("data-flow-opacity", getFlowOpacity(label.amount))
          .style("transition", "opacity 0.15s")
          .style("animation", "chains-edge-flow 1s linear infinite")
          .style("animation-play-state", "paused")
          // Legacy updateFlowDurations, applied at build time instead of a DOM re-walk.
          .style("animation-duration", `${getFlowDurationSeconds(label.amount)}s`);
      });

      appendEdgePath(group, geometry.d, flowColor, `ca${edgeColorIndex}`);

      displayEdge.labels.forEach((label, index) => {
        group
          .append("text")
          .attr("x", geometry.labelX)
          .attr("y", geometry.labelY - (displayEdge.labels.length - 1 - index) * 10)
          .attr("text-anchor", "middle")
          .attr("font-size", 8)
          .attr("font-family", "sans-serif")
          .attr("fill", edgeStrokeColor(label.recipeIndex))
          .attr("paint-order", "stroke")
          .attr("stroke", "#f9f9f9")
          .attr("stroke-width", 1)
          .style("opacity", DEFAULT_LABEL_OPACITY)
          .style("transition", "opacity 0.15s")
          .text(`x${label.amount}`);
      });
    }

    for (const displayEdge of displayEdges) appendEdge(displayEdge);

    // --- nodes (legacy renderNode: frame, icon, name, price) ---
    for (const node of layout.nodes) {
      const position = positions.get(node.id) ?? { x: node.x, y: node.y };
      const stroke = getGoodStroke(node.good.color);
      const group = nodesGroup
        .append("g")
        .attr("data-nid", node.id)
        .style("transition", "opacity 0.12s")
        .attr("transform", `translate(${position.x},${position.y})`);

      group.append("title").text(nodeTooltip(node));

      group
        .append("rect")
        .attr("width", CARD_WIDTH)
        .attr("height", CARD_HEIGHT)
        .attr("rx", CARD_RADIUS)
        .attr("fill", "#fff");
      group
        .append("rect")
        .attr("width", CARD_WIDTH)
        .attr("height", CARD_HEIGHT)
        .attr("rx", CARD_RADIUS)
        .attr("fill", node.good.color)
        .attr("fill-opacity", 0.13)
        .attr("stroke", stroke)
        .attr("stroke-opacity", 0.6)
        .attr("stroke-width", 1.3);
      group
        .append("circle")
        .attr("cx", 15)
        .attr("cy", CARD_HEIGHT / 2)
        .attr("r", ICON_RADIUS + 2)
        .attr("fill", node.good.color)
        .attr("fill-opacity", 0.17);
      group
        .append("circle")
        .attr("cx", 15)
        .attr("cy", CARD_HEIGHT / 2)
        .attr("r", ICON_RADIUS)
        .attr("fill", node.good.color)
        .attr("fill-opacity", 0.68);

      const iconX = 15;
      const iconY = CARD_HEIGHT / 2;
      const textX = iconX + ICON_RADIUS + 5;
      group
        .append("use")
        .attr("href", `#${node.good.icon}`)
        .attr("x", iconX - ICON_RADIUS)
        .attr("y", iconY - ICON_RADIUS)
        .attr("width", ICON_RADIUS * 2)
        .attr("height", ICON_RADIUS * 2);
      group
        .append("text")
        .attr("x", textX)
        .attr("y", iconY - 2)
        .attr("font-size", 10)
        .attr("font-family", "sans-serif")
        .attr("fill", "#111")
        .attr("font-weight", 600)
        .text(truncateGoodName(node.good.name));
      group
        .append("text")
        .attr("x", textX)
        .attr("y", iconY + 8)
        .attr("font-size", 8.5)
        .attr("font-family", "sans-serif")
        .attr("fill", "#888")
        .text(`🟡 ${node.good.value}`);
    }

    // --- hover: highlight the hovered good's directed chain (legacy attachHoverInteractions) ---
    const nodeSelection = svg.selectAll<SVGGElement, unknown>("[data-nid]");
    const edgeSelection = svg.selectAll<SVGGElement, unknown>("[data-ef]");

    nodeSelection
      .on("mouseenter", function () {
        const nodeId = +((this as SVGGElement).dataset.nid || -1);
        applyChainVisibility(edgeSelection, nodeSelection, getDirectedChainIds(nodeId, layout.edges));
      })
      .on("mouseleave", () => {
        applyChainVisibility(edgeSelection, nodeSelection, null);
      });

    // --- pan/zoom (legacy attachGraphInteractions) ---
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) =>
        viewport.attr("transform", event.transform.toString())
      );
    svg.call(zoomBehavior);

    // First draw applies the legacy initial transform; a world-change re-render
    // keeps the gesture state d3 stores on the svg element itself (__zoom).
    const persistedTransform = zoomTransform(svgElement);
    if (persistedTransform.k !== 1 || persistedTransform.x !== 0 || persistedTransform.y !== 0) {
      viewport.attr("transform", persistedTransform.toString());
    } else {
      svg.call(zoomBehavior.transform, zoomIdentity.translate(16, 0).scale(1));
    }

    return () => {
      // Interrupt any in-flight d3 work, detach the zoom behavior, and empty
      // the svg — which removes the flow-dot paths AND the keyframes <style>,
      // stopping the CSS animation (its "timer") with no leak. Reset the tip
      // in case the pointer was over the chart.
      svg.selectAll("*").interrupt();
      svg.on(".zoom", null);
      svg.selectAll("*").remove();
      showTip("");
    };
  }, [layout, bounds]);

  return (
    <Panel title="Production Chains" anchor={anchor} onClose={onClose}>
      <div
        style={{
          overflow: "auto",
          maxHeight: window.innerHeight - 160,
          maxWidth: window.innerWidth - 72
        }}
      >
        {bounds ? (
          <svg
            ref={svgRef}
            id="chains-svg"
            role="img"
            aria-label="Production chains graph"
            width={bounds.svgWidth}
            height={bounds.svgHeight}
            style={{ display: "block", cursor: "grab" }}
          />
        ) : (
          <div style={{ padding: "1em" }}>No production chains found: add manufactured goods with recipes first.</div>
        )}
      </div>
    </Panel>
  );
}
