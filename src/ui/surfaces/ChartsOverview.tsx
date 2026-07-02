import {
  axisLeft,
  axisTop,
  extent,
  range,
  rollups,
  type SeriesPoint,
  scaleBand,
  scaleLinear,
  select,
  stack,
  stackOrderNone,
  sum
} from "d3";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildChartsSnapshot,
  type ChartOptions,
  type ChartsSnapshot,
  computeChartData,
  computeChartGeometry,
  entitiesMap,
  LABEL_GAP,
  plotTypeMap,
  quantizationMap,
  validateChartRequest,
  WIDTH,
  Y_PADDING
} from "@/controllers/charts-overview";
import { rn } from "@/utils/numberUtils";
import { showTip } from "../host";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";
import { getMapId } from "../world-state";

interface ChartsOverviewProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

/** The legacy validation toasts (4-second error/warn) over the shared tooltip. */
function showToast(text: string, type: "error" | "warn"): void {
  showTip(text, false, type, 4000);
}

// The legacy dialog persisted its state across close/re-open (the form's static
// markup and the module-level charts list survived `handleClose`); keep the same
// behavior at module level. The charts reset when a different map loads.
interface ChartsFormState {
  entity: string;
  plotBy: string;
  groupBy: string;
  sorting: string;
  type: string;
  excludeNeutral: boolean;
}

const DEFAULT_FORM: ChartsFormState = {
  entity: "states",
  plotBy: "total_population",
  groupBy: "cultures",
  sorting: "value",
  type: "stackedBar",
  excludeNeutral: false
};

let persistedCharts: ChartOptions[] = [];
let persistedForm: ChartsFormState = { ...DEFAULT_FORM };
let persistedColumns = "1";
let prevMapId: number | undefined;
// Chart ids only key figures and drive removal; a counter (instead of the
// legacy Date.now()) cannot collide when two charts are plotted within one ms.
let nextChartId = 1;

/** Reset the module-level persistence to its open-first-time state (used by tests). */
export function resetChartsOverviewPersistence(): void {
  persistedCharts = [];
  persistedForm = { ...DEFAULT_FORM };
  persistedColumns = "1";
  prevMapId = undefined;
}

// The d3 stack row shapes (legacy types, unchanged).
type RolledEntry = [string, [string, number][]];
type BarPoint = SeriesPoint<RolledEntry> & { i: number };
interface StackSeries {
  key: string;
  data: BarPoint[];
}

interface ChartFigureProps {
  figureNo: number;
  options: ChartOptions;
  snapshot: ChartsSnapshot | null;
  onRemove: (id: number) => void;
}

/**
 * One plotted chart: the figure frame, caption with per-chart actions
 * (CSV/PNG/SVG export, remove), and the d3-drawn stacked-bar svg.
 *
 * React owns the figure/caption/controls and the `<svg>` element; d3 owns
 * everything inside the svg — the x axis (with its faint full-height tick
 * lines), the stacked bar rects with their native-title + shared-tip tooltips,
 * the y axis at the zero line, and the legend — drawn by ONE effect keyed on
 * the memoized chart model. A chart's options are frozen at plot time (legacy
 * behavior: the selectors only shape the NEXT chart), so the effect re-runs
 * only when the world changes under it.
 */
function ChartFigure({ figureNo, options, snapshot, onRemove }: ChartFigureProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const figureRef = useRef<HTMLElement>(null);

  const computed = useMemo(() => (snapshot ? computeChartData(options, snapshot) : null), [options, snapshot]);
  const geometry = useMemo(() => (computed?.data.length ? computeChartGeometry(computed.data) : null), [computed]);

  // The legacy insertChart scrolled the freshly added figure into view.
  useEffect(() => {
    figureRef.current?.scrollIntoView?.();
  }, []);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !computed || !geometry || !snapshot) return;

    const { data, colors, noGrouping, entityLabel, groupLabel, plotByLabel } = computed;
    const metric = quantizationMap[options.plotBy];
    const { offset, formatX } = plotTypeMap[options.type];
    const formatValue = (value: number) => (formatX ? formatX(value) : metric.formatTicks(value, snapshot));

    const tooltip = (entityName: string, group: string, value: number, percentage: number) => {
      const entityTip = `${entityLabel}: ${entityName}`;
      const groupTip = noGrouping ? "" : `${groupLabel}: ${group}`;
      let valueTip = `${plotByLabel}: ${metric.stringify(value, snapshot)}`;
      if (!noGrouping) valueTip += ` (${rn(percentage * 100)}%)`;
      return [entityTip, groupTip, valueTip].filter(Boolean);
    };

    // --- the legacy createStackedBarChart, drawing into the ref'd svg ---
    const X = data.map(d => d.value);
    const Y = data.map(d => d.name);
    const Z = data.map(d => d.group);

    const yDomain = new Set(Y);
    const zDomain = new Set(Z);
    const I = range(X.length).filter(i => yDomain.has(Y[i]) && zDomain.has(Z[i]));

    const { entities, groups, legendRows, margin, height } = geometry;
    const xRange = [margin.left, WIDTH - margin.right];
    const yRange = [height - margin.bottom, margin.top];

    const rolled = rollups(
      I,
      ([i]) => i,
      i => Y[i],
      i => Z[i]
    );

    const series: StackSeries[] = stack<RolledEntry, string>()
      .keys(groups)
      .value(([, zEntries], z) => X[new Map(zEntries).get(z)!])
      .order(stackOrderNone)
      .offset(offset)(rolled)
      .map(s => {
        const defined = s.filter(d => !Number.isNaN(d[1]));
        const seriesData: BarPoint[] = defined.map(d => Object.assign(d, { i: new Map(d.data[1]).get(s.key)! }));
        return { key: s.key, data: seriesData };
      });

    const edges = series.flatMap(s => s.data.flatMap(p => [p[0], p[1]]));
    const xDomain = extent(edges) as [number, number];

    const xScale = scaleLinear(xDomain, xRange);
    const yScale = scaleBand(entities, yRange).paddingInner(Y_PADDING);

    const xAxis = axisTop(xScale).ticks(WIDTH / 80, null);
    const yAxis = axisLeft(yScale).tickSizeOuter(0);

    const svg = select(svgElement);
    // The exact legacy inline style (kept for SVG-export parity).
    svgElement.setAttribute("style", "max-width: 100%; height: auto; height: intrinsic;");

    svg
      .append("g")
      .attr("transform", `translate(0,${margin.top})`)
      .call(xAxis)
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll<SVGTextElement, number>("text").text(d => formatValue(d)))
      .call(g =>
        g
          .selectAll(".tick line")
          .clone()
          .attr("y2", height - margin.top - margin.bottom)
          .attr("stroke-opacity", 0.1)
      );

    const bar = svg
      .append("g")
      .attr("stroke", "#666")
      .attr("stroke-width", 0.5)
      .selectAll<SVGGElement, StackSeries>("g")
      .data(series)
      .join("g")
      .attr("fill", d => colors[d.key])
      .selectAll<SVGRectElement, BarPoint>("rect")
      .data(d => d.data.filter(([x1, x2]) => x1 !== x2))
      .join("rect")
      .attr("x", ([x1, x2]) => Math.min(xScale(x1), xScale(x2)))
      .attr("y", ({ i }) => yScale(Y[i])!)
      .attr("width", ([x1, x2]) => Math.abs(xScale(x1) - xScale(x2)))
      .attr("height", yScale.bandwidth());

    const totalZ: Record<string, number> = Object.fromEntries(
      rollups(
        I,
        indices => sum(indices, i => X[i]),
        i => Y[i]
      )
    );
    const getTooltip = ({ i }: { i: number }) => tooltip(Y[i], Z[i], X[i], X[i] / totalZ[Y[i]]);

    bar.append("title").text(d => getTooltip(d).join("\r\n"));
    bar.on("mouseover", (_event, d) => showTip(getTooltip(d).join(". ")));

    svg
      .append("g")
      .attr("transform", `translate(${xScale(0)},0)`)
      .call(yAxis);

    // --- legend ---
    const rowElements = Math.ceil(groups.length / legendRows);
    const columnWidth = WIDTH / (rowElements + 0.5);

    const ROW_HEIGHT = 20;

    const getLegendX = (_d: string, i: number) => (i % rowElements) * columnWidth;
    const getLegendLabelX = (d: string, i: number) => getLegendX(d, i) + LABEL_GAP;
    const getLegendY = (_d: string, i: number) => Math.floor(i / rowElements) * ROW_HEIGHT;

    const legend = svg
      .append("g")
      .attr("stroke", "#666")
      .attr("stroke-width", 0.5)
      .attr("dominant-baseline", "central")
      .attr("transform", `translate(${margin.left},${height - margin.bottom + 15})`);

    legend
      .selectAll("rect")
      .data(groups)
      .join("rect")
      .attr("x", getLegendX)
      .attr("y", getLegendY)
      .attr("width", 10)
      .attr("height", 10)
      .attr("transform", "translate(-5, -5)")
      .attr("fill", (d: string) => colors[d]);

    legend
      .selectAll("text")
      .data(groups)
      .join("text")
      .attr("x", getLegendLabelX)
      .attr("y", getLegendY)
      .text((d: string) => d);

    return () => {
      // Emptying the svg drops the bars and every d3-attached listener with
      // them; reset the shared tooltip in case the pointer was over a bar.
      svg.selectAll("*").interrupt();
      svg.selectAll("*").remove();
      showTip("");
    };
  }, [computed, geometry, snapshot, options.plotBy, options.type]);

  // --- exports: existing global download helpers, guarded for absence ---

  function handleDownloadData(): void {
    if (!computed || typeof downloadFile !== "function" || typeof getFileName !== "function") return;
    const name = `${getFileName(computed.title)}.csv`;
    const headers = "Name,Group,Value\n";
    const values = computed.data.map(({ name, group, value }) => `${name},${group},${value}`).join("\n");
    downloadFile(headers + values, name);
  }

  function handleDownloadSvg(): void {
    const svgElement = svgRef.current;
    if (!svgElement || !computed || typeof downloadFile !== "function" || typeof getFileName !== "function") return;
    downloadFile(svgElement.outerHTML, `${getFileName(computed.title)}.svg`);
  }

  // rasterize the SVG onto a canvas for users unfamiliar with the vector format
  function handleDownloadPng(): void {
    const svgElement = svgRef.current;
    if (!svgElement || !computed || typeof downloadFile !== "function" || typeof getFileName !== "function") return;
    const title = computed.title;
    const { width, height } = svgElement.viewBox.baseVal;
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const svgString = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));

    const image = new Image();
    image.onload = () => {
      const scale = 2; // export at 2x for a crisp raster
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob && downloadFile(blob, `${getFileName(title)}.png`, "image/png"));
      }
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  const title = computed?.title ?? "";

  return (
    <figure
      ref={figureRef}
      style={{ margin: 0, padding: "0.6em 0 1em", borderTop: "1px solid rgba(128, 128, 128, 0.4)" }}
    >
      <figcaption
        style={{
          fontSize: "1.2em",
          margin: "0 1% 0.4em 4%",
          display: "grid",
          alignItems: "center",
          gridTemplateColumns: "1fr auto"
        }}
      >
        <div>
          <strong>Figure {figureNo}</strong>. {title}
        </div>
        <div>
          <button
            type="button"
            data-tip="Download chart data as a text file (.csv)"
            aria-label="Download chart data as a text file (.csv)"
            className="icon-download"
            onClick={handleDownloadData}
          />
          <button
            type="button"
            data-tip="Download the chart as a PNG image"
            aria-label="Download the chart as a PNG image"
            className="icon-export"
            onClick={handleDownloadPng}
          />
          <button
            type="button"
            data-tip="Download the chart in SVG format (vector, opens in a browser or Inkscape)"
            aria-label="Download the chart in SVG format (vector, opens in a browser or Inkscape)"
            className="icon-chart-bar"
            onClick={handleDownloadSvg}
          />
          <button
            type="button"
            data-tip="Remove the chart"
            aria-label="Remove the chart"
            className="icon-trash"
            onClick={() => onRemove(options.id)}
          />
        </div>
      </figcaption>
      {geometry ? (
        <svg
          ref={svgRef}
          role="img"
          aria-label={title}
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${WIDTH} ${geometry.height}`}
        />
      ) : (
        <div style={{ margin: "0 4%" }}>No data to plot.</div>
      )}
    </figure>
  );
}

/**
 * ChartsOverview — the Data Charts surface, at parity with the legacy
 * `src/controllers/charts-overview.ts` jQuery-UI dialog (Phase 3 Slice 12, the
 * last d3-chart conversion, following the Slice 9–11 pattern).
 *
 * React owns the panel frame and the plot form (all selectors are controlled
 * inputs whose values persist across close/re-open at module level, like the
 * legacy static markup did); each Plot freezes the current form into a
 * ChartOptions and appends a <ChartFigure>, which owns its d3 drawing. The
 * charts list also persists across close/re-open and resets when a different
 * map loads (the legacy `prevMapId !== mapId` check). World data is read once
 * per render into a snapshot keyed on `useWorldVersion`, so every plotted
 * chart re-aggregates on any world change.
 */
export function ChartsOverview({ anchor, onClose }: ChartsOverviewProps) {
  const worldVersion = useWorldVersion();

  const [charts, setCharts] = useState<ChartOptions[]>(() => {
    const currentMapId = getMapId();
    if (prevMapId !== currentMapId) {
      persistedCharts = [];
      prevMapId = currentMapId;
    }
    return persistedCharts;
  });

  const [form, setForm] = useState<ChartsFormState>(persistedForm);
  const [columns, setColumns] = useState(persistedColumns);

  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the accessor.
  const snapshot = useMemo(() => buildChartsSnapshot(), [worldVersion]);

  // The single write-back point: every form change updates the one state object
  // AND the module-level persistence (survives close/re-open, legacy parity).
  function updateForm<Key extends keyof ChartsFormState>(key: Key, value: ChartsFormState[Key]): void {
    const next = { ...form, [key]: value };
    persistedForm = next;
    setForm(next);
  }

  function plotChart(): void {
    const validation = validateChartRequest(form.entity, form.plotBy, form.groupBy);
    if (!validation.ok) {
      showToast(validation.error, "error");
      return;
    }
    if (validation.warning) showToast(validation.warning, "warn");

    const chart: ChartOptions = {
      id: nextChartId++,
      entity: form.entity,
      plotBy: form.plotBy,
      groupBy: validation.groupBy,
      sorting: form.sorting,
      type: form.type,
      excludeNeutral: form.excludeNeutral
    };
    setCharts(previous => {
      const next = [...previous, chart];
      persistedCharts = next;
      return next;
    });
  }

  // The legacy open() plotted a default chart when none were persisted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount, exactly like the legacy open().
  useEffect(() => {
    if (persistedCharts.length === 0) plotChart();
  }, []);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    plotChart();
  }

  function removeChart(id: number): void {
    setCharts(previous => {
      const next = previous.filter(chart => chart.id !== id);
      persistedCharts = next;
      return next;
    });
  }

  const metricHint = quantizationMap[form.plotBy]?.hint;

  const dimensionOptions = Object.entries(entitiesMap).map(([value, { label }]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
  const metricOptions = Object.entries(quantizationMap).map(([value, { label }]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));

  const labelStyle = { display: "inline-flex", alignItems: "center" } as const;

  return (
    <Panel title="Data Charts" anchor={anchor} onClose={onClose}>
      <div style={{ width: "60vw", maxWidth: "88vw", display: "grid", gridTemplateRows: "auto 1fr" }}>
        <form onSubmit={handleSubmit} style={{ display: "grid", fontSize: "1.1em", margin: "0.3em 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.2em" }}>
            <button data-tip="Add a chart" type="submit">
              Plot
            </button>

            <select
              data-tip="Select entity (y axis)"
              aria-label="Select entity (y axis)"
              value={form.entity}
              onChange={event => updateForm("entity", event.target.value)}
            >
              {dimensionOptions}
            </select>

            <label data-tip="Select metric to plot (x axis)" style={labelStyle}>
              <span>by</span>
              <select
                aria-label="Select metric to plot (x axis)"
                value={form.plotBy}
                onChange={event => updateForm("plotBy", event.target.value)}
              >
                {metricOptions}
              </select>
              {/* the selected metric's hint via an info icon (keeps the dropdown labels compact) */}
              {metricHint && (
                <i
                  className="icon-info-circled"
                  data-tip={metricHint}
                  style={{ marginLeft: "0.3em", cursor: "help", opacity: 0.6 }}
                />
              )}
            </label>

            <label
              data-tip="Select entity to group by. If you don't need grouping, set it the same as the entity"
              style={labelStyle}
            >
              <span>grouped by</span>
              <select
                aria-label="Select entity to group by"
                value={form.groupBy}
                onChange={event => updateForm("groupBy", event.target.value)}
              >
                {dimensionOptions}
              </select>
            </label>

            <label data-tip="Sorting type" style={labelStyle}>
              <span>sorted</span>
              <select
                aria-label="Sorting type"
                value={form.sorting}
                onChange={event => updateForm("sorting", event.target.value)}
              >
                <option value="value">by value</option>
                <option value="name">by name</option>
                <option value="natural">naturally</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1em" }}>
            <label data-tip="Select chart type" style={labelStyle}>
              <span>Type</span>
              <select
                aria-label="Select chart type"
                value={form.type}
                onChange={event => updateForm("type", event.target.value)}
              >
                <option value="stackedBar">Stacked Bar</option>
                <option value="normalizedStackedBar">Normalized Bar</option>
              </select>
            </label>

            <label data-tip="Show the charts in 1, 2, 3 or 4 columns" style={labelStyle}>
              <span>Columns</span>
              <select
                aria-label="Columns"
                value={columns}
                onChange={event => {
                  setColumns(event.target.value);
                  persistedColumns = event.target.value;
                }}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </label>

            <label data-tip="Exclude zero element from the results (id 0, e.g. the neutral state)" style={labelStyle}>
              <input
                type="checkbox"
                className="native"
                checked={form.excludeNeutral}
                onChange={event => updateForm("excludeNeutral", event.target.checked)}
              />
              <span>Exclude neutral</span>
            </label>
          </div>
        </form>

        <section
          aria-label="Plotted charts"
          style={{
            overflow: "auto",
            scrollBehavior: "smooth",
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            maxHeight: "75vh"
          }}
        >
          {charts.map((chart, index) => (
            <ChartFigure
              key={chart.id}
              figureNo={index + 1}
              options={chart}
              snapshot={snapshot}
              onRemove={removeChart}
            />
          ))}
        </section>
      </div>
    </Panel>
  );
}
