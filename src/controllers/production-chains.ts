import { openSurface } from "@/ui/app-shell/registry";
import type { Good } from "../generators/goods-generator";
import { C_12 } from "../utils/colorUtils";

/**
 * Production Chains — the goods recipe-graph layout math plus the preserved
 * `ProductionChains.open()` trigger seam (Phase 3 Slice 11).
 *
 * The layout pipeline (chain extraction → stage assignment → crossing
 * minimization → port/lane routing → edge geometry) is the legacy algorithm
 * verbatim, re-exported as plain pure functions so the React surface
 * (`src/ui/surfaces/ProductionChains.tsx`) can render it with d3. The class
 * body is reduced to the seam: validate exactly as the legacy dialog did, then
 * dispatch into the App shell.
 */

export const CARD_WIDTH = 98;
export const CARD_HEIGHT = 34;
export const CARD_RADIUS = 4;
const COLUMN_GAP = 148;
const ROW_GAP = 6;
export const COMPONENT_GAP = 32;
export const COLUMN_STEP = CARD_WIDTH + COLUMN_GAP;
export const ICON_RADIUS = 11;
const PORT_BAND = 0.55;
const LANE_SPREAD = 12;
export const HEADER_HEIGHT = 20;
export const SVG_PADDING = 18;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const DEFAULT_EDGE_OPACITY = 0.3;
export const DEFAULT_LABEL_OPACITY = 0;
const FLOW_PIXELS_PER_SECOND = 40;

export const FLOW_DOT_GAP = 22;
export const FLOW_STROKE_WIDTH = 5;
export const BASE_EDGE_STROKE_WIDTH = 1;
const MIN_FLOW_SPEED_MULTIPLIER = 0.35;
const MIN_FLOW_DURATION_SECONDS = 0.12;
const FLOW_OPACITY_BASE = 0.65;
const FLOW_OPACITY_PER_AMOUNT = 0.08;
const FLOW_OPACITY_MAX = 0.92;

export interface GraphNode {
  id: number;
  good: Good;
  stage: number;
  x: number;
  y: number;
}

interface RawGraphEdge {
  from: number;
  to: number;
  recipeIndex: number;
  amount: number;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  recipeIndex: number;
  amount: number;
}

export interface RoutedEdge extends GraphEdge {
  sourcePortIndex: number;
  sourcePortCount: number;
  targetPortIndex: number;
  targetPortCount: number;
  lane: number;
  targetBoundary: number;
}

interface ComponentBand {
  y: number;
}

export interface LayoutData {
  nodes: GraphNode[];
  edges: RoutedEdge[];
  stages: Set<number>;
  componentBands: ComponentBand[];
}

export interface Position {
  x: number;
  y: number;
}

export interface EdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
}

interface EdgeLabel {
  amount: number;
  recipeIndex: number;
}

export interface DisplayEdge {
  fromId: number;
  toId: number;
  representative: RoutedEdge;
  labels: EdgeLabel[];
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  svgWidth: number;
  svgHeight: number;
  offsetX: number;
  offsetY: number;
}

function getChainGoods(goods: Good[]): Good[] {
  const chainIds = new Set<number>();

  for (const good of goods) {
    if (!good.recipes?.length) continue;
    chainIds.add(good.i);
    for (const recipe of good.recipes) {
      for (const ingredientId of Object.keys(recipe)) chainIds.add(+ingredientId);
    }
  }

  return goods.filter(good => chainIds.has(good.i));
}

function getRawEdges(goods: Good[]): RawGraphEdge[] {
  const rawEdges: RawGraphEdge[] = [];

  for (const good of goods) {
    if (!good.recipes?.length) continue;
    for (let recipeIndex = 0; recipeIndex < good.recipes.length; recipeIndex++) {
      for (const [ingredientId, amount] of Object.entries(good.recipes[recipeIndex])) {
        rawEdges.push({
          from: +ingredientId,
          to: good.i,
          recipeIndex,
          amount
        });
      }
    }
  }

  return rawEdges;
}

function sortStageEntryIds(ids: number[], goodsById: Map<number, Good>) {
  ids.sort((left, right) => (goodsById.get(left)?.name ?? "").localeCompare(goodsById.get(right)?.name ?? ""));
}

function computeStages(goods: Good[]): Map<number, number> {
  const stageById = new Map<number, number>();

  for (const good of goods) {
    if (!good.recipes?.length) stageById.set(good.i, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const good of goods) {
      if (!good.recipes?.length) continue;

      const ingredientIds = [...new Set(good.recipes.flatMap(recipe => Object.keys(recipe).map(Number)))];
      if (!ingredientIds.length) continue;
      if (!ingredientIds.every(id => stageById.has(id))) continue;

      const nextStage = Math.max(...ingredientIds.map(id => stageById.get(id)!)) + 1;
      if (!stageById.has(good.i) || nextStage > stageById.get(good.i)!) {
        stageById.set(good.i, nextStage);
        changed = true;
      }
    }
  }

  for (const good of goods) {
    if (!stageById.has(good.i)) stageById.set(good.i, 1);
  }

  return stageById;
}

function getConnectedComponents(ids: number[], edges: RawGraphEdge[]): Set<number>[] {
  const adjacency = new Map<number, number[]>();
  for (const id of ids) adjacency.set(id, []);

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const visited = new Set<number>();
  const components: Set<number>[] = [];

  for (const id of ids) {
    if (visited.has(id)) continue;
    const component = new Set<number>();
    const stack = [id];

    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;

      visited.add(current);
      component.add(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
}

function minimizeCrossings(stageEntries: Map<number, number[]>, edges: RawGraphEdge[]) {
  const sortedStages = [...stageEntries.keys()].sort((a, b) => a - b);
  if (sortedStages.length < 2) return;

  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();

  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    incoming.get(edge.to)!.push(edge.from);
    outgoing.get(edge.from)!.push(edge.to);
  }

  const getBarycenter = (id: number, neighbors: number[], positions: Map<number, number>) => {
    const values = neighbors
      .map(neighbor => positions.get(neighbor))
      .filter((value): value is number => value !== undefined);
    if (!values.length) return positions.get(id) ?? 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  for (let pass = 0; pass < 12; pass++) {
    for (let index = 1; index < sortedStages.length; index++) {
      const prevPositions = new Map(stageEntries.get(sortedStages[index - 1])!.map((id, position) => [id, position]));
      stageEntries
        .get(sortedStages[index])!
        .sort(
          (left, right) =>
            getBarycenter(left, incoming.get(left) ?? [], prevPositions) -
            getBarycenter(right, incoming.get(right) ?? [], prevPositions)
        );
    }

    for (let index = sortedStages.length - 2; index >= 0; index--) {
      const nextPositions = new Map(stageEntries.get(sortedStages[index + 1])!.map((id, position) => [id, position]));
      stageEntries
        .get(sortedStages[index])!
        .sort(
          (left, right) =>
            getBarycenter(left, outgoing.get(left) ?? [], nextPositions) -
            getBarycenter(right, outgoing.get(right) ?? [], nextPositions)
        );
    }
  }
}

function assignPortsAndLanes(nodes: GraphNode[], edges: GraphEdge[]): RoutedEdge[] {
  const outgoingByNode = new Map<number, GraphEdge[]>();
  const incomingByNode = new Map<number, GraphEdge[]>();

  for (const node of nodes) {
    outgoingByNode.set(node.id, []);
    incomingByNode.set(node.id, []);
  }

  for (const edge of edges) {
    outgoingByNode.get(edge.from.id)!.push(edge);
    incomingByNode.get(edge.to.id)!.push(edge);
  }

  for (const edgeList of outgoingByNode.values()) edgeList.sort((a, b) => a.to.y - b.to.y || a.to.id - b.to.id);
  for (const edgeList of incomingByNode.values()) edgeList.sort((a, b) => a.from.y - b.from.y || a.from.id - b.from.id);

  const boundaryPairs = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = `${edge.to.stage - 1}-${edge.to.stage}`;
    if (!boundaryPairs.has(key)) boundaryPairs.set(key, []);
    boundaryPairs.get(key)!.push(edge);
  }

  for (const edgeList of boundaryPairs.values()) {
    edgeList.sort((a, b) => {
      return a.to.y - b.to.y || a.from.y - b.from.y || a.from.id - b.from.id || a.to.id - b.to.id;
    });
  }

  return edges.map(edge => {
    const targetBoundary = edge.to.stage - 1;
    const pair = boundaryPairs.get(`${targetBoundary}-${edge.to.stage}`) ?? [];
    const pairIndex = pair.indexOf(edge);
    return {
      ...edge,
      sourcePortIndex: outgoingByNode.get(edge.from.id)!.indexOf(edge),
      sourcePortCount: outgoingByNode.get(edge.from.id)!.length,
      targetPortIndex: incomingByNode.get(edge.to.id)!.indexOf(edge),
      targetPortCount: incomingByNode.get(edge.to.id)!.length,
      lane: pair.length > 1 ? pairIndex - (pair.length - 1) / 2 : 0,
      targetBoundary
    };
  });
}

function buildStageEntries(componentGoods: Good[], goodsById: Map<number, Good>, stageById: Map<number, number>) {
  const stageEntries = new Map<number, number[]>();

  for (const good of componentGoods) {
    const stage = stageById.get(good.i) ?? 0;
    if (!stageEntries.has(stage)) stageEntries.set(stage, []);
    stageEntries.get(stage)!.push(good.i);
  }

  for (const ids of stageEntries.values()) sortStageEntryIds(ids, goodsById);

  return stageEntries;
}

function createNodesForComponent(
  stageEntries: Map<number, number[]>,
  goodsById: Map<number, Good>,
  currentYOffset: number,
  stages: Set<number>
) {
  const rowHeight = CARD_HEIGHT + ROW_GAP;
  const maxRows = Math.max(...[...stageEntries.values()].map(ids => ids.length));
  const componentHeight = maxRows * rowHeight - ROW_GAP;
  const componentNodesById = new Map<number, GraphNode>();
  const nodes: GraphNode[] = [];

  for (const [stage, ids] of stageEntries) {
    stages.add(stage);
    const columnHeight = ids.length * rowHeight - ROW_GAP;
    const startY = (componentHeight - columnHeight) / 2 + currentYOffset;

    for (let row = 0; row < ids.length; row++) {
      const id = ids[row];
      const good = goodsById.get(id);
      if (!good) continue;

      const node: GraphNode = {
        id,
        good,
        stage,
        x: stage * COLUMN_STEP,
        y: startY + row * rowHeight
      };

      nodes.push(node);
      componentNodesById.set(id, node);
    }
  }

  return { stageEntries, nodes, componentNodesById, componentHeight };
}

function createComponentEdges(componentEdges: RawGraphEdge[], componentNodesById: Map<number, GraphNode>): GraphEdge[] {
  const graphEdges: GraphEdge[] = [];

  for (const edge of componentEdges) {
    const from = componentNodesById.get(edge.from);
    const to = componentNodesById.get(edge.to);
    if (!from || !to) continue;
    graphEdges.push({
      from,
      to,
      recipeIndex: edge.recipeIndex,
      amount: edge.amount
    });
  }

  return graphEdges;
}

/**
 * Lay out the goods recipe graph: extract the chain goods, split them into
 * connected components (largest first), assign each good a stage column,
 * minimize link crossings, position the cards, and route the edges through
 * ports and lanes. Returns an empty layout when no good has a recipe.
 */
export function buildLayout(goods: Good[]): LayoutData {
  const chainGoods = getChainGoods(goods);
  if (!chainGoods.length) return { nodes: [], edges: [], stages: new Set(), componentBands: [] };

  const goodsById = new Map(chainGoods.map(good => [good.i, good]));
  const rawEdges = getRawEdges(chainGoods);
  const components = getConnectedComponents(
    chainGoods.map(good => good.i),
    rawEdges
  ).sort((a, b) => b.size - a.size);

  const nodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const stages = new Set<number>();
  const componentBands: ComponentBand[] = [];
  let currentYOffset = 0;

  for (const component of components) {
    const componentGoods = chainGoods.filter(good => component.has(good.i));
    const componentEdges = rawEdges.filter(edge => component.has(edge.from) && component.has(edge.to));
    const stageById = computeStages(componentGoods);
    const stageEntries = buildStageEntries(componentGoods, goodsById, stageById);

    minimizeCrossings(stageEntries, componentEdges);

    const {
      nodes: componentNodes,
      componentNodesById,
      componentHeight
    } = createNodesForComponent(stageEntries, goodsById, currentYOffset, stages);

    nodes.push(...componentNodes);
    graphEdges.push(...createComponentEdges(componentEdges, componentNodesById));

    componentBands.push({ y: currentYOffset });
    currentYOffset += componentHeight + COMPONENT_GAP;
  }

  return {
    nodes,
    edges: assignPortsAndLanes(nodes, graphEdges),
    stages,
    componentBands
  };
}

/** The laid-out card position per good id (the base, un-dragged positions). */
export function getBasePositions(nodes: GraphNode[]): Map<number, Position> {
  return new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }]));
}

function buildDirectedAdjacency(edges: RoutedEdge[]) {
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();

  for (const edge of edges) {
    if (!incoming.has(edge.to.id)) incoming.set(edge.to.id, []);
    if (!outgoing.has(edge.from.id)) outgoing.set(edge.from.id, []);
    incoming.get(edge.to.id)!.push(edge.from.id);
    outgoing.get(edge.from.id)!.push(edge.to.id);
  }

  return { incoming, outgoing };
}

/**
 * The ids on a good's production chain: the good itself, everything upstream
 * (transitive ingredients), and everything downstream (transitive products) —
 * the set the hover interaction highlights.
 */
export function getDirectedChainIds(startId: number, edges: RoutedEdge[]): Set<number> {
  const { incoming, outgoing } = buildDirectedAdjacency(edges);
  const result = new Set([startId]);

  const upstream = [startId];
  while (upstream.length) {
    for (const neighbor of incoming.get(upstream.shift()!) ?? []) {
      if (result.has(neighbor)) continue;
      result.add(neighbor);
      upstream.push(neighbor);
    }
  }

  const downstream = [startId];
  while (downstream.length) {
    for (const neighbor of outgoing.get(downstream.shift()!) ?? []) {
      if (result.has(neighbor)) continue;
      result.add(neighbor);
      downstream.push(neighbor);
    }
  }

  return result;
}

function getPortY(nodeY: number, portIndex: number, portCount: number): number {
  if (portCount === 1) return nodeY + CARD_HEIGHT / 2;
  const top = nodeY + (CARD_HEIGHT * (1 - PORT_BAND)) / 2;
  return top + (portIndex / (portCount - 1)) * CARD_HEIGHT * PORT_BAND;
}

function getLaneOffset(edge: RoutedEdge): number {
  const sourceSpread = (edge.sourcePortIndex - (edge.sourcePortCount - 1) / 2) * 5;
  const targetSpread = (edge.targetPortIndex - (edge.targetPortCount - 1) / 2) * 5;
  const recipeSpread = ((edge.recipeIndex % C_12.length) - (C_12.length - 1) / 2) * 0.5;
  return edge.lane * LANE_SPREAD + sourceSpread + targetSpread + recipeSpread;
}

/** An edge's rounded-elbow svg path plus where its amount label sits. */
export function getEdgeGeometry(edge: RoutedEdge, positions: Map<number, Position>): EdgeGeometry {
  const from = positions.get(edge.from.id) ?? {
    x: edge.from.x,
    y: edge.from.y
  };
  const to = positions.get(edge.to.id) ?? { x: edge.to.x, y: edge.to.y };

  const x1 = from.x + CARD_WIDTH;
  const y1 = getPortY(from.y, edge.sourcePortIndex, edge.sourcePortCount);
  const x2 = to.x;
  const y2 = getPortY(to.y, edge.targetPortIndex, edge.targetPortCount);

  const boundaryBaseX = edge.targetBoundary * COLUMN_STEP + CARD_WIDTH + COLUMN_GAP * 0.62;
  const minElbowX = x1 + 14;
  const maxElbowX = x2 - 14;
  const rawElbowX = boundaryBaseX + getLaneOffset(edge);
  const elbowX = Math.max(minElbowX, Math.min(maxElbowX, rawElbowX));

  let d: string;
  if (Math.abs(y2 - y1) < 1) {
    d = `M${x1},${y1} H${x2}`;
  } else {
    const cornerRadius = Math.min(8, Math.abs(y2 - y1) / 2, Math.max(6, (x2 - x1) / 6));
    const dy = y2 > y1 ? 1 : -1;
    d = `M${x1},${y1} H${elbowX - cornerRadius} Q${elbowX},${y1} ${elbowX},${y1 + dy * cornerRadius} V${y2 - dy * cornerRadius} Q${elbowX},${y2} ${elbowX + cornerRadius},${y2} H${x2}`;
  }

  return { d, labelX: x2 - 10, labelY: y2 - 4 };
}

/** A good's card label, ellipsis-truncated to fit the card. */
export function truncateGoodName(name: string, maxLength = 12): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** The C_12 palette slot an edge's color derives from (stable per node pair). */
export function getEdgeColorIndex(displayEdge: DisplayEdge): number {
  return (displayEdge.fromId * 7 + displayEdge.toId * 11) % C_12.length;
}

/** The graph's bounding box, svg size, and centering offsets. */
export function getLayoutBounds(layout: LayoutData): LayoutBounds {
  const minX = Math.min(...layout.nodes.map(node => node.x));
  const maxX = Math.max(...layout.nodes.map(node => node.x)) + CARD_WIDTH;
  const minY = Math.min(...layout.nodes.map(node => node.y));
  const maxY = Math.max(...layout.nodes.map(node => node.y)) + CARD_HEIGHT;

  return {
    minX,
    maxX,
    minY,
    maxY,
    svgWidth: maxX - minX + SVG_PADDING * 2,
    svgHeight: maxY - minY + SVG_PADDING * 2 + HEADER_HEIGHT,
    offsetX: -minX + SVG_PADDING,
    offsetY: -minY + SVG_PADDING + HEADER_HEIGHT
  };
}

/** A flow dot's opacity: heavier recipe amounts render more opaque, capped. */
export function getFlowOpacity(amount: number): number {
  return Math.min(FLOW_OPACITY_BASE + amount * FLOW_OPACITY_PER_AMOUNT, FLOW_OPACITY_MAX);
}

/**
 * A flow dot's animation period in seconds: heavier amounts flow faster
 * (shorter duration), floored so a dot always visibly moves. This is the
 * legacy `updateFlowDurations` math without its DOM walk.
 */
export function getFlowDurationSeconds(amount: number): number {
  const speed = FLOW_PIXELS_PER_SECOND * Math.max(amount, MIN_FLOW_SPEED_MULTIPLIER);
  return Math.max(FLOW_DOT_GAP / speed, MIN_FLOW_DURATION_SECONDS);
}

/**
 * Collapse parallel routed edges (same from→to pair across recipes) into one
 * display edge carrying every recipe's amount label, keyed to the
 * lowest-recipe-index edge's geometry.
 */
export function getDisplayEdges(edges: RoutedEdge[]): DisplayEdge[] {
  const grouped = new Map<string, DisplayEdge>();

  for (const edge of edges) {
    const key = `${edge.from.id}-${edge.to.id}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        fromId: edge.from.id,
        toId: edge.to.id,
        representative: edge,
        labels: [{ amount: edge.amount, recipeIndex: edge.recipeIndex }]
      });
      continue;
    }

    existing.labels.push({
      amount: edge.amount,
      recipeIndex: edge.recipeIndex
    });
    if (edge.recipeIndex < existing.representative.recipeIndex) existing.representative = edge;
  }

  for (const displayEdge of grouped.values()) {
    displayEdge.labels.sort((left, right) => left.recipeIndex - right.recipeIndex || left.amount - right.amount);
  }

  return [...grouped.values()];
}

export class ProductionChains {
  private constructor() {}

  /**
   * The preserved trigger seam (goods editor's chains button). Validates
   * exactly as the legacy dialog did — tip when there are no goods or no
   * recipe chains — then mounts the React surface; the graph itself is
   * re-derived and rendered inside the surface.
   */
  static open() {
    const goods = [...(pack.goods as Good[])];
    if (!goods.length) {
      tip("No goods data available.", true, "warn");
      return;
    }

    const layout = buildLayout(goods);
    if (!layout.nodes.length) {
      tip("No production chains found: add manufactured goods with recipes first.", true, "warn");
      return;
    }

    openSurface("production-chains", { anchor: "#goodsEditor" });
  }
}
