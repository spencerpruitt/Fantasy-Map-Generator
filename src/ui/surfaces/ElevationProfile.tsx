import {
  axisBottom,
  axisLeft,
  type CurveFactory,
  type CurveFactoryLineOnly,
  curveBundle,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveNatural,
  line,
  pointer,
  type Selection,
  scaleLinear,
  select
} from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { rn } from "@/utils/numberUtils";
import { csvField } from "../csv";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";
import { getBurg, getProfileCellRecord, type ProfileCellRecord } from "../world-state";

interface ElevationProfileProps {
  /** The cell ids along the route/river path (from the `open()` seam). */
  cells: number[];
  /** The path's length in display units — the x-axis scale. */
  routeLen: number;
  /** River profiles are slope-smoothed so the flow never renders uphill. */
  isRiver: boolean;
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// The curve interpolations of the legacy `#epCurve` select, in its option order.
const CURVE_OPTIONS: { label: string; curve: CurveFactory | CurveFactoryLineOnly }[] = [
  { label: "Linear", curve: curveLinear },
  { label: "Bundle", curve: curveBundle.beta(1) },
  { label: "Cubic Catmull-Rom", curve: curveCatmullRom.alpha(0.5) },
  { label: "Monotone X", curve: curveMonotoneX },
  { label: "Natural", curve: curveNatural }
];
const DEFAULT_CURVE_INDEX = 3; // Monotone X — the legacy select's `selected` option

// The legacy select was static markup, so a chosen curve survived close/re-open;
// persist it at module level the same way (HeightmapSelection's options do this too).
let persistedCurveIndex = DEFAULT_CURVE_INDEX;

// Chart geometry (legacy constants). Width is viewport-derived at render time.
const CHART_HEIGHT = 300;
const X_OFFSET = 80;
const Y_OFFSET = 2;
const BIOMES_HEIGHT = 10;

// --- guarded reads of the existing host globals (recipe step 5) ---

/** The display height unit (`#heightUnit`), "" when the options pane is absent. */
function heightUnitLabel(): string {
  return typeof heightUnit === "undefined" || !heightUnit ? "" : heightUnit.value;
}

/** The display distance unit (`#distanceUnitInput`), "" when absent. */
function distanceUnitLabel(): string {
  return typeof distanceUnitInput === "undefined" || !distanceUnitInput ? "" : distanceUnitInput.value;
}

/** Generator height → display-unit string via the global `getHeight`, exactly as legacy. */
function displayHeight(height: number): string {
  return typeof getHeight === "function" ? getHeight(height) : String(height);
}

function populationRateValue(): number {
  return typeof populationRate === "undefined" || populationRate === undefined ? 0 : populationRate;
}

function urbanizationValue(): number {
  return typeof urbanization === "undefined" || urbanization === undefined ? 0 : urbanization;
}

function showTip(text: string): void {
  if (typeof tip === "function") tip(text);
}

// The per-path chart model derived from the world: the accessor records plus the
// legacy pre-processing (water clamp is in the record; river slope smoothing,
// burg de-duplication, display-height conversion, and the elevation stats here).
interface ChartModel {
  records: ProfileCellRecord[];
  /** Slope-smoothed surface heights (generator scale) the gradient spans. */
  surfaceHeights: number[];
  /** Display-unit heights the curve and the y-axis render. */
  displayHeights: number[];
  /** Burg ids de-duplicated along the path (a burg labels only its first cell). */
  burgIds: number[];
  minDisplay: number;
  maxDisplay: number;
  minSurface: number;
  maxSurface: number;
  totalAscent: number;
  totalDescent: number;
}

/**
 * Build the chart model for a cell path — the legacy `open()` pre-processing
 * loop verbatim, reading each cell through the accessor. Returns null when any
 * cell does not resolve (no world loaded, or a stale cell id).
 */
function buildChartModel(cells: number[], isRiver: boolean): ChartModel | null {
  if (cells.length === 0) return null;
  const records: ProfileCellRecord[] = [];
  for (const cellId of cells) {
    const record = getProfileCellRecord(cellId);
    if (!record) return null;
    records.push(record);
  }

  // For rivers, remember the general slope direction to prevent rendering uphill flow
  let slope = 0;
  if (isRiver) {
    const firstHeight = records[0].height;
    const lastHeight = records[records.length - 1].height;
    if (firstHeight < lastHeight) slope = 1;
    else if (firstHeight > lastHeight) slope = -1;
  }

  const surfaceHeights: number[] = [];
  const displayHeights: number[] = [];
  const burgIds: number[] = [];
  let minDisplay = 1e6;
  let maxDisplay = 0;
  let minSurface = 100;
  let maxSurface = 0;
  let lastBurgIndex = 0;
  let lastBurgCell = 0;

  for (let i = 0, prevBurg = 0, prevHeight = -1; i < records.length; i++) {
    let height = records[i].surfaceHeight;

    if (prevHeight !== -1 && isRiver) {
      if (slope === 1 && height < prevHeight) height = prevHeight;
      else if (slope === 0 && height !== prevHeight) height = prevHeight;
      else if (slope === -1 && height > prevHeight) height = prevHeight;
    }
    prevHeight = height;

    let burgId = records[i].burgId;
    if (burgId === prevBurg) burgId = 0;
    else prevBurg = burgId;
    if (burgId) {
      lastBurgIndex = i;
      lastBurgCell = cells[i];
    }

    surfaceHeights[i] = height;
    displayHeights[i] = parseInt(displayHeight(height), 10);
    burgIds[i] = burgId;
    minSurface = Math.min(minSurface, height);
    maxSurface = Math.max(maxSurface, height);
    minDisplay = Math.min(minDisplay, displayHeights[i]);
    maxDisplay = Math.max(maxDisplay, displayHeights[i]);
  }

  let totalAscent = 0;
  let totalDescent = 0;
  for (let i = 1; i < records.length; i++) {
    const diff = displayHeights[i] - displayHeights[i - 1];
    if (diff > 0) totalAscent += diff;
    else totalDescent -= diff;
  }

  // Move last burg label to the final point if it falls right at the end
  const lastIndex = cells.length - 1;
  if (lastBurgIndex !== 0 && lastBurgCell === cells[lastIndex] && lastBurgIndex < lastIndex) {
    burgIds[lastIndex] = burgIds[lastBurgIndex];
    burgIds[lastBurgIndex] = 0;
  }

  return {
    records,
    surfaceHeights,
    displayHeights,
    burgIds,
    minDisplay,
    maxDisplay,
    minSurface,
    maxSurface,
    totalAscent,
    totalDescent
  };
}

/**
 * ElevationProfile — the elevation-profile surface, at parity with the legacy
 * `src/controllers/elevation-profile.ts` jQuery-UI dialog (Phase 3 Slice 9), and
 * the pattern-setter for d3-chart-in-dialog conversions.
 *
 * The d3/React seam: React owns the panel frame, the controls (curve select,
 * CSV/SVG/PNG exports, the stats line), and the lifecycle; d3 owns everything
 * INSIDE the ref'd `<svg>` — scales, axes, the gradient-filled land curve, the
 * biome band, burg labels/markers, and the crosshair hover. The chart is drawn by
 * one `useEffect` whose dependencies are the memoized chart model (which is keyed
 * on the opened-with props and `useWorldVersion`, so any world change re-derives
 * it) plus the curve selection; its cleanup empties the svg (dropping every
 * d3-attached listener with it) and clears a hover tooltip left showing. Controls
 * re-trigger a draw purely by changing state/props that the model or the effect
 * depend on — nothing calls a draw function imperatively.
 */
export function ElevationProfile({ cells, routeLen, isRiver, anchor, onClose }: ElevationProfileProps) {
  const worldVersion = useWorldVersion();
  const [curveIndex, setCurveIndex] = useState(persistedCurveIndex);
  const svgRef = useRef<SVGSVGElement>(null);

  // Legacy sizing: the chart spans the viewport minus the editor gutters,
  // fixed at open (a remount re-derives it).
  const chartWidth = window.innerWidth - 400;

  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the accessor.
  const model = useMemo(() => buildChartModel(cells, isRiver), [cells, isRiver, worldVersion]);

  // The d3 draw. Everything the chart renders derives from the deps; the cleanup
  // contract is "leave the svg empty": removing the nodes drops their listeners
  // (mousemove/mouseleave/click), and the shared FMG tooltip is reset in case the
  // pointer was over the chart when it re-drew or unmounted.
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !model) return;

    const { records, displayHeights, burgIds } = model;
    const pointCount = records.length;
    const heightUnitValue = heightUnitLabel();

    const chart = select(svgElement);

    const xscale = scaleLinear()
      .domain([0, pointCount - 1])
      .range([0, chartWidth]);
    const yscale = scaleLinear()
      .domain([0, model.maxDisplay * 1.1])
      .range([CHART_HEIGHT, 0]);

    const points: [number, number][] = displayHeights.map((height, i) => [
      xscale(i) + X_OFFSET,
      yscale(height) + Y_OFFSET
    ]);

    const defs = chart.append("defs");

    // Arrowhead marker for burg label lines
    defs
      .append("marker")
      .attr("id", "arrowhead")
      .attr("orient", "auto")
      .attr("markerWidth", "2")
      .attr("markerHeight", "4")
      .attr("refX", "0.1")
      .attr("refY", "2")
      .append("path")
      .attr("d", "M0,0 V4 L2,2 Z")
      .attr("fill", "darkgray");

    // Terrain elevation gradient (top = peak colour, bottom = valley colour)
    const colors = typeof getColorScheme === "function" ? getColorScheme("natural") : () => "#cccccc";
    const heightColor = (height: number): string =>
      typeof getColor === "function" ? getColor(height, colors) : "#cccccc";
    const landGradient = defs
      .append("linearGradient")
      .attr("id", "landdef")
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "0%")
      .attr("y2", "100%");

    if (model.maxSurface === model.minSurface) {
      const color = heightColor(model.minSurface);
      landGradient.append("stop").attr("offset", "0%").attr("style", `stop-color:${color};stop-opacity:1`);
      landGradient.append("stop").attr("offset", "100%").attr("style", `stop-color:${color};stop-opacity:1`);
    } else {
      const steps = Math.min(20, model.maxSurface - model.minSurface);
      for (let s = 0; s <= steps; s++) {
        const height = Math.round(model.maxSurface - (s / steps) * (model.maxSurface - model.minSurface));
        landGradient
          .append("stop")
          .attr("offset", `${(s / steps) * 100}%`)
          .attr("style", `stop-color:${heightColor(height)};stop-opacity:1`);
      }
    }

    // Clip biome bar to chart bounds
    defs
      .append("clipPath")
      .attr("id", "epBiomesClip")
      .append("rect")
      .attr("x", X_OFFSET)
      .attr("y", Y_OFFSET + CHART_HEIGHT)
      .attr("width", chartWidth)
      .attr("height", BIOMES_HEIGHT);

    // Build the elevation curve using the selected interpolation
    const lineFn = line<[number, number]>().curve(CURVE_OPTIONS[curveIndex].curve as CurveFactory);

    // Land fill: curve + straight close along the bottom edge
    const lastX = points[points.length - 1][0];
    const baseY = yscale(0) + Y_OFFSET;
    const landPath =
      (lineFn(points) ?? "") +
      ` L${lastX},${points[points.length - 1][1]}` +
      ` L${lastX},${baseY}` +
      ` L${xscale(0) + X_OFFSET},${baseY}Z`;

    chart
      .append("g")
      .attr("id", "epland")
      .append("path")
      .attr("d", landPath)
      .attr("stroke", "none")
      .attr("fill", "url(#landdef)");

    // Profile outline stroke
    chart
      .append("g")
      .attr("id", "epline")
      .append("path")
      .attr("d", lineFn(points.slice()) ?? "")
      .attr("stroke", "#5a3e28")
      .attr("stroke-width", 1.5)
      .attr("fill", "none");

    // Biome colour bar
    const biomesGroup = chart.append("g").attr("id", "epbiomes").attr("clip-path", "url(#epBiomesClip)");
    const tileWidth = xscale(1);

    for (let k = 0; k < pointCount; k++) {
      const record = records[k];
      const labelBurgId = burgIds[k];
      const burgPopulation = labelBurgId ? (getBurg(labelBurgId)?.population ?? 0) * urbanizationValue() : 0;
      const population = record.population + burgPopulation;
      const dataTip = [
        record.biomeName,
        record.provinceName || null,
        record.stateName,
        record.religionName,
        record.cultureName,
        `height: ${displayHeights[k]} ${heightUnitValue}`,
        `population ${rn(population * populationRateValue())}`
      ]
        .filter(Boolean)
        .join(", ");

      biomesGroup
        .append("rect")
        .attr("x", points[k][0])
        .attr("y", Y_OFFSET + CHART_HEIGHT)
        .attr("width", tileWidth)
        .attr("height", BIOMES_HEIGHT)
        .attr("fill", record.biomeColor)
        .attr("stroke", record.biomeColor)
        .attr("data-tip", dataTip);
    }

    // Axes
    const xAxis = axisBottom(xscale)
      .ticks(10)
      .tickFormat(d => `${rn((Number(d) / (pointCount - 1)) * routeLen)} ${distanceUnitLabel()}`);
    const yAxis = axisLeft(yscale)
      .ticks(5)
      .tickFormat(d => `${d} ${heightUnitValue}`);

    chart
      .append("g")
      .attr("id", "epxaxis")
      .attr("transform", `translate(${X_OFFSET},${CHART_HEIGHT + Y_OFFSET + 20})`)
      .call(xAxis as any)
      .selectAll("text")
      .style("text-anchor", "center");

    chart
      .append("g")
      .attr("id", "epyaxis")
      .attr("transform", `translate(${X_OFFSET - 10},${Y_OFFSET})`)
      .call(yAxis as any);

    // Grid lines
    const gridStyle = (g: Selection<SVGGElement, unknown, null, undefined>): void => {
      g.attr("stroke", "lightgrey").attr("stroke-opacity", "0.2").attr("stroke-width", "0.5");
      g.selectAll("path").attr("stroke-width", "0");
    };

    chart
      .append("g")
      .attr("id", "epxgrid")
      .attr("class", "epgrid")
      .attr("stroke-dasharray", "4 1")
      .attr("transform", `translate(${X_OFFSET},${CHART_HEIGHT + Y_OFFSET})`)
      .call(gridStyle as any);

    chart
      .append("g")
      .attr("id", "epygrid")
      .attr("class", "epgrid")
      .attr("stroke-dasharray", "4 1")
      .attr("transform", `translate(${X_OFFSET},${Y_OFFSET})`)
      .call(gridStyle as any);

    // Burg labels anchored above their curve point with all-pairs overlap avoidance
    const labelsGroup = chart.append("g").attr("id", "epburglabels");
    const LABEL_GAP = 18; // px above the dot for the label baseline
    const MIN_LABEL_Y = 12; // topmost allowed y
    const LINE_HEIGHT = 14; // stacking increment
    const X_PROXIMITY = 70; // horizontal proximity threshold for stacking
    const placed: { lx: number; ly: number }[] = [];

    for (let k = 0; k < pointCount; k++) {
      if (!burgIds[k]) continue;
      const burg = getBurg(burgIds[k]);
      if (!burg) continue;
      const lx = points[k][0];
      const pointY = points[k][1];
      let ly = pointY - LABEL_GAP;

      // Push up until no vertical overlap with any nearby placed label
      let changed = true;
      while (changed) {
        changed = false;
        for (const p of placed) {
          if (Math.abs(lx - p.lx) < X_PROXIMITY && Math.abs(ly - p.ly) < LINE_HEIGHT) {
            const candidate = p.ly - LINE_HEIGHT;
            if (candidate < MIN_LABEL_Y) break;
            ly = candidate;
            changed = true;
            break;
          }
        }
      }
      ly = Math.max(MIN_LABEL_Y, ly);
      placed.push({ lx, ly });

      labelsGroup
        .append("text")
        .attr("id", `ep${burgIds[k]}`)
        .attr("class", "epburglabel")
        .attr("x", lx)
        .attr("y", ly)
        .attr("text-anchor", "middle")
        .attr("data-tip", `Focus on ${burg.name}`)
        .style("cursor", "pointer")
        .on("click", () => {
          if (typeof zoomTo === "function") zoomTo(burg.x, burg.y, 8, 2000);
        })
        .text(burg.name ?? "");

      if (ly + 4 < pointY - 4) {
        labelsGroup
          .append("path")
          .attr("d", `M${lx},${ly + 3}L${lx},${pointY - 3}`)
          .attr("stroke", "darkgray")
          .attr("stroke-width", "1")
          .attr("fill", "none")
          .attr("marker-end", "url(#arrowhead)");
      }
    }

    // Burg dots on the curve
    const dotsGroup = chart.append("g").attr("id", "epburgdots");
    for (let k = 0; k < pointCount; k++) {
      if (!burgIds[k]) continue;
      dotsGroup
        .append("circle")
        .attr("cx", points[k][0])
        .attr("cy", points[k][1])
        .attr("r", 4)
        .attr("fill", "white")
        .attr("stroke", "#333")
        .attr("stroke-width", 1.5);
    }

    // Crosshair + FMG tooltip on hover
    const crosshairGroup = chart.append("g").attr("id", "epcrosshair").style("pointer-events", "none");
    const verticalLine = crosshairGroup
      .append("line")
      .attr("x1", -200)
      .attr("x2", -200)
      .attr("y1", Y_OFFSET)
      .attr("y2", Y_OFFSET + CHART_HEIGHT)
      .attr("stroke", "rgba(60,60,60,0.6)")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 2");
    const hoverDot = crosshairGroup
      .append("circle")
      .attr("r", 4)
      .attr("cx", -200)
      .attr("cy", -200)
      .attr("fill", "white")
      .attr("stroke", "#333")
      .attr("stroke-width", 1.5);

    chart
      .append("rect")
      .attr("id", "epoverlay")
      .attr("x", X_OFFSET)
      .attr("y", Y_OFFSET)
      .attr("width", chartWidth)
      .attr("height", CHART_HEIGHT)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", (event: MouseEvent) => {
        const [mx] = pointer(event);
        const idx = Math.max(
          0,
          Math.min(pointCount - 1, Math.round(((mx - X_OFFSET) / chartWidth) * (pointCount - 1)))
        );
        const point = points[idx];
        if (!point) return;
        verticalLine.attr("x1", point[0]).attr("x2", point[0]);
        hoverDot.attr("cx", point[0]).attr("cy", point[1]);
        const dist = rn((idx / Math.max(1, pointCount - 1)) * routeLen);
        const hoverBurgId = burgIds[idx];
        showTip(
          [
            `${dist} ${distanceUnitLabel()} from start`,
            `Elevation: ${displayHeights[idx]} ${heightUnitValue}`,
            records[idx].biomeName,
            hoverBurgId ? (getBurg(hoverBurgId)?.name ?? null) : null
          ]
            .filter(Boolean)
            .join(". ")
        );
      })
      .on("mouseleave", () => {
        verticalLine.attr("x1", -200).attr("x2", -200);
        hoverDot.attr("cx", -200).attr("cy", -200);
        showTip("");
      });

    return () => {
      // Emptying the svg drops the chart and every d3-attached listener with it;
      // reset the shared tooltip in case the pointer was over the chart.
      chart.selectAll("*").remove();
      showTip("");
    };
  }, [model, curveIndex, routeLen, chartWidth]);

  function handleCurveChange(value: string): void {
    const index = Math.min(Number(value), CURVE_OPTIONS.length - 1);
    persistedCurveIndex = index;
    setCurveIndex(index);
  }

  // --- exports (existing global download helpers, guarded for absence) ---

  function handleDownloadCSV(): void {
    if (!model || typeof downloadFile !== "function" || typeof getFileName !== "function") return;
    const headers =
      "Id,x,y,lat,lon,Cell,Height,Height value,Population,Burg,Burg population,Biome,Biome color,Culture,Culture color,Religion,Religion color,Province,Province color,State,State color\n";
    const rows = cells.map((cellId, k) => {
      const record = model.records[k];
      const [x, y] = record.point;
      // The CSV reads the RAW cell values (undeduped burg, unclamped height), as legacy did.
      const burg = record.burgId ? getBurg(record.burgId) : undefined;
      const burgPopulation = burg ? (burg.population ?? 0) * populationRateValue() * urbanizationValue() : 0;
      const latitude = typeof getLatitude === "function" ? getLatitude(y, 2) : "";
      const longitude = typeof getLongitude === "function" ? getLongitude(x, 2) : "";
      return [
        k + 1,
        x,
        y,
        latitude,
        longitude,
        cellId,
        displayHeight(record.height),
        record.height,
        rn(record.population * populationRateValue()),
        csvField(burg?.name ?? ""),
        burgPopulation,
        csvField(record.biomeName),
        record.biomeColor,
        csvField(record.cultureName),
        record.cultureColor,
        csvField(record.religionName),
        record.religionColor,
        csvField(record.provinceName),
        record.provinceColor,
        csvField(record.stateName),
        record.stateColor
      ].join(",");
    });
    downloadFile(`${headers}${rows.join("\n")}`, `${getFileName("elevation profile")}.csv`);
  }

  function handleDownloadSVG(): void {
    const svgElement = svgRef.current;
    if (!svgElement || typeof downloadFile !== "function" || typeof getFileName !== "function") return;
    const svgString = `<?xml version="1.0" encoding="utf-8"?>\n${new XMLSerializer().serializeToString(svgElement)}`;
    downloadFile(svgString, `${getFileName("elevation profile")}.svg`);
  }

  function handleDownloadPNG(): void {
    const svgElement = svgRef.current;
    if (!svgElement || typeof getFileName !== "function") return;
    const width = Number(svgElement.getAttribute("width"));
    const height = Number(svgElement.getAttribute("height"));
    const svgUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svgElement)], {
        type: "image/svg+xml;charset=utf-8"
      })
    );
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob(pngBlob => {
        if (!pngBlob) return;
        const link = Object.assign(document.createElement("a"), {
          href: URL.createObjectURL(pngBlob),
          download: `${getFileName("elevation profile")}.png`
        });
        link.click();
        URL.revokeObjectURL(link.href);
      });
    };
    image.src = svgUrl;
  }

  const heightUnitValue = heightUnitLabel();
  const stats = model
    ? `Elev: ${model.minDisplay}–${model.maxDisplay} ${heightUnitValue} ↑ ${model.totalAscent} ↓ ${model.totalDescent} ${heightUnitValue}`
    : "";

  return (
    <Panel title="Elevation profile" anchor={anchor} onClose={onClose}>
      {/* #elevationGraph keeps its legacy id: the still-legacy route/river editors
          probe it to live-refresh an open profile while control points move. */}
      <div id="elevationGraph" data-tip="Elevation profile">
        {model ? (
          <svg
            ref={svgRef}
            id="elevationSVG"
            className="epbackground"
            width={chartWidth + 120}
            height={CHART_HEIGHT + Y_OFFSET + BIOMES_HEIGHT}
          />
        ) : (
          <div>No elevation data available.</div>
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div id="epControls">
          <span data-tip="Set curve profile">
            Curve:{" "}
            <select
              id="epCurve"
              aria-label="Set curve profile"
              value={curveIndex}
              onChange={event => handleCurveChange(event.target.value)}
            >
              {CURVE_OPTIONS.map((option, index) => (
                <option key={option.label} value={index}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
          <span>
            <button
              type="button"
              id="epSave"
              data-tip="Download the chart data as a CSV file"
              aria-label="Download the chart data as a CSV file"
              className="icon-download"
              onClick={handleDownloadCSV}
            />
          </span>
          <span>
            <button
              type="button"
              id="epSaveSVG"
              data-tip="Download the chart as an SVG image"
              onClick={handleDownloadSVG}
            >
              SVG
            </button>
          </span>
          <span>
            <button
              type="button"
              id="epSavePNG"
              data-tip="Download the chart as a PNG image"
              onClick={handleDownloadPNG}
            >
              PNG
            </button>
          </span>
          <span id="epstats" style={{ marginLeft: "1em", color: "#555", fontSize: "0.85em" }}>
            {stats}
          </span>
        </div>
      </div>
    </Panel>
  );
}
