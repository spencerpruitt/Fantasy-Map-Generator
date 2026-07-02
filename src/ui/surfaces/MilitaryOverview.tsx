import { interpolateString, select } from "d3";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { lazy } from "@/lazy-loaders";
import { wiki } from "@/utils/commonUtils";
import { rn } from "@/utils/numberUtils";
import { capitalize } from "@/utils/stringUtils";
import { si } from "@/utils/unitUtils";
import { customizationActive } from "../bulk-selection";
import { Panel } from "../Panel";
import { RowIcon } from "../RowIcon";
import { SortHeader, useSortState } from "../SortHeader";
import { useWorldVersion } from "../use-world-version";
import { getMilitaryUnits, getStatePopulation, getStates, notifyWorldChanged, setStateWarAlert } from "../world-state";

interface MilitaryOverviewProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// Sort columns match the legacy header `data-sortby` values: state sorts
// alphabetically; each configured unit, total, population, rate, and alert sort
// numerically. Unit columns are dynamic (options.military), so the key is a
// string, not a closed union. The legacy header shipped with
// `icon-sort-number-down` on Total, so the table starts sorted by total
// descending.
const ALPHABETICAL_KEYS: ReadonlySet<string> = new Set(["state"]);

// One state line: the display fields, the per-unit force sums the dynamic
// columns render from, and the derived totals the fixed columns render from.
interface StateRow {
  id: number;
  name: string;
  fullName: string;
  color: string;
  unitForces: Record<string, number>;
  total: number;
  population: number;
  rate: number;
  alert: number;
}

/**
 * A state's army group on the map. The legacy selector ("#armies > g >
 * g#army{state}") had one `> g` too many and matched nothing — armies render as
 * `#armies > g#army{state}` (see draw-military.ts) — so the legacy army-fill
 * highlight was dead code; this fixes it to actually highlight.
 */
function armySelector(stateId: number): string {
  return `#armies > g#army${stateId}`;
}

/** A cell's percentage-mode text: its share of the column total (legacy rounding). */
function shareText(value: number, columnTotal: number): string {
  return columnTotal ? `${rn((value / columnTotal) * 100)}%` : "0%";
}

/**
 * MilitaryOverview — the Military Overview surface, at parity with the legacy
 * `src/controllers/military-overview.ts` jQuery-UI dialog (Phase 3 Slice 7).
 *
 * Reads states/unit-options through the World-State accessor (never raw
 * `window.pack`/`options`) and re-reads on any world change via
 * `useWorldVersion` — which is also how the regiment editor's and the
 * regenerate tools' edits reach it. The editable War Alert column is the one
 * mutation: it goes through the accessor (`setStateWarAlert`), commits on the
 * input's native change (blur/Enter/spinner — never per keystroke, both for
 * ADR-0004 and because the legacy scaling is multiplicative and would compound
 * per character), updates the `#armies` icon texts as a renderer side-effect,
 * and signals `notifyWorldChanged` here at the call site. Row hover highlights
 * the state's armies and region outline on the map (`#armies`/`#regions`/
 * `#debug` d3 transitions) as guarded side-effects with cleanup on unmount.
 * The regiments-list actions and the options cog dispatch through the same
 * lazy controller seams the legacy dialog used.
 */
export function MilitaryOverview({ anchor, onClose }: MilitaryOverviewProps) {
  const [refreshCount, refresh] = useReducer(count => count + 1, 0);
  const worldVersion = useWorldVersion();

  const { sortKey, sortDirection, handleSort, headerClassName } = useSortState<string>("total", "down", key =>
    ALPHABETICAL_KEYS.has(key)
  );
  const [percentage, setPercentage] = useState(false);

  // The state whose armies are currently hover-highlighted, so unmount can
  // clear an in-flight highlight (the legacy dialog leaked it on close).
  const hoveredStateRef = useRef<number | null>(null);

  // Build one row per valid state, plus the per-column sums the percentage mode
  // and the footer render from. refreshCount and worldVersion are deliberate
  // cache-busters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshCount and worldVersion intentionally re-read the accessor.
  const view = useMemo(() => {
    const units = getMilitaryUnits();
    const rows = getStates().map(state => {
      const unitForces: Record<string, number> = {};
      for (const unit of units) {
        unitForces[unit.name] = (state.military ?? []).reduce(
          (forces, regiment) => forces + (regiment.u[unit.name] || 0),
          0
        );
      }
      const total = units.reduce((personnel, unit) => personnel + unitForces[unit.name] * unit.crew, 0);
      const population = getStatePopulation(state);
      const rate = population ? (total / population) * 100 : 0;
      return {
        id: state.i,
        name: state.name,
        fullName: state.fullName ?? state.name,
        color: state.color ?? "#999999",
        unitForces,
        total,
        population,
        rate,
        alert: state.alert ?? 0
      } satisfies StateRow;
    });

    // Column sums over all rows — the percentage denominators and the footer.
    const unitTotals: Record<string, number> = {};
    for (const unit of units) {
      unitTotals[unit.name] = rows.reduce((sum, row) => sum + row.unitForces[unit.name], 0);
    }
    const totalSum = rows.reduce((sum, row) => sum + row.total, 0);
    const populationSum = rows.reduce((sum, row) => sum + row.population, 0);
    const rateSum = rows.reduce((sum, row) => sum + row.rate, 0);
    const alertSum = rows.reduce((sum, row) => sum + row.alert, 0);

    return { units, rows, unitTotals, totalSum, populationSum, rateSum, alertSum };
  }, [refreshCount, worldVersion]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "down" ? -1 : 1;

    function numericValue(row: StateRow): number {
      if (sortKey === "total") return row.total;
      if (sortKey === "population") return row.population;
      if (sortKey === "rate") return row.rate;
      if (sortKey === "alert") return row.alert;
      return row.unitForces[sortKey] || 0;
    }

    return [...view.rows].sort((first, second) => {
      if (ALPHABETICAL_KEYS.has(sortKey)) {
        // Plain string comparison, exactly like the legacy applySorting.
        const order = first.name > second.name ? 1 : first.name < second.name ? -1 : 0;
        return order * direction;
      }
      return (numericValue(first) - numericValue(second)) * direction;
    });
  }, [view.rows, sortKey, sortDirection]);

  /** The footer's per-state average, 0 (not NaN) for a stateless world. */
  function average(sum: number): number {
    return view.rows.length ? sum / view.rows.length : 0;
  }

  // --- map side-effects (existing globals/selections, guarded for absence) ---

  function handleHighlightOn(stateId: number): void {
    if (customizationActive() || !stateId) return;
    hoveredStateRef.current = stateId;
    select(armySelector(stateId)).transition().duration(2000).style("fill", "#ff0000");

    if (typeof layerIsOn !== "function" || !layerIsOn("toggleStates")) return;
    const regionPath = select("#regions").select<SVGPathElement>(`#state${stateId}`);
    const outline = regionPath.empty() ? null : regionPath.attr("d");
    if (!outline) return;

    const path = select("#debug")
      .append("path")
      .attr("class", "highlight")
      .attr("d", outline)
      .attr("fill", "none")
      .attr("stroke", "red")
      .attr("stroke-width", 1)
      .attr("opacity", 1)
      .attr("filter", "url(#blur1)");

    const pathNode = path.node() as SVGPathElement | null;
    if (!pathNode) return;
    const length = pathNode.getTotalLength();
    const duration = (length + 5000) / 2;
    const dashInterpolator = interpolateString(`0,${length}`, `${length},${length}`);
    path
      .transition()
      .duration(duration)
      .attrTween("stroke-dasharray", () => t => dashInterpolator(t));
  }

  function handleHighlightOff(stateId: number): void {
    hoveredStateRef.current = null;
    select("#debug")
      .selectAll(".highlight")
      .each(function () {
        select(this).transition().duration(1000).attr("opacity", 0).remove();
      });
    select(armySelector(stateId)).transition().duration(1000).style("fill", null);
  }

  // Clear an in-flight hover highlight when the surface unmounts — the row's
  // mouseleave can never fire once the panel is gone.
  useEffect(() => {
    return () => {
      select("#debug").selectAll(".highlight").interrupt().remove();
      const hoveredState = hoveredStateRef.current;
      if (hoveredState) select(armySelector(hoveredState)).interrupt().style("fill", null);
    };
  }, []);

  /**
   * Commit an edited war alert: scale the state's forces through the accessor,
   * update the `#armies` regiment icon texts (renderer side-effect, exactly the
   * legacy changeAlert redraw), and signal the world change.
   */
  function commitWarAlert(stateId: number, rawValue: string): void {
    const alert = +rawValue;
    const regiments = setStateWarAlert(stateId, alert);
    const militaryModule = typeof Military !== "undefined" ? Military : undefined;
    for (const regiment of regiments) {
      select(`#armies > g > g#regiment${stateId}-${regiment.i} > text`).text(
        militaryModule ? militaryModule.getTotal(regiment) : regiment.a
      );
    }
    notifyWorldChanged();
  }

  // --- actions dispatching through the existing controller seams ---

  async function openRegimentsOverview(stateId: number): Promise<void> {
    const { RegimentsOverview } = await lazy.regimentsOverview();
    RegimentsOverview.open(stateId);
  }

  async function handleOpenOptions(): Promise<void> {
    const { MilitaryOverview: controller } = await lazy.militaryOverview();
    controller.openOptions();
  }

  function handleRecalculate(): void {
    if (typeof confirmationDialog !== "function") return;
    confirmationDialog({
      title: "Recalculate military",
      message:
        "Are you sure you want to recalculate military forces for all states?<br>Regiments for all states will be regenerated",
      confirm: "Recalculate",
      onConfirm: () => {
        if (typeof Military !== "undefined" && Military) Military.generate();
        notifyWorldChanged();
      }
    });
  }

  // Exports the table in the current sort order, byte-identical to the legacy
  // downloadMilitaryData (raw totals/population/alert, rate rounded to 2).
  function handleExport(): void {
    const unitNames = view.units.map(unit => unit.name);
    let data = `Id,State,${unitNames.map(name => capitalize(name)).join(",")},Total,Population,Rate,War Alert\n`; // headers

    for (const row of sortedRows) {
      data += `${row.id},`;
      data += `${row.name},`;
      data += `${unitNames.map(name => row.unitForces[name]).join(",")},`;
      data += `${row.total},`;
      data += `${row.population},`;
      data += `${rn(row.rate, 2)}%,`;
      data += `${row.alert}\n`;
    }

    downloadFile(data, `${getFileName("Military")}.csv`);
  }

  return (
    <Panel title="Military Overview" anchor={anchor} onClose={onClose}>
      <div
        className="header"
        style={{ gridTemplateColumns: `8em repeat(${view.units.length}, 5.2em) 4em 7em 5em 6em` }}
      >
        <SortHeader
          label="State"
          sortKey="state"
          className={headerClassName("state")}
          dataTip="State name. Click to sort"
          onSort={handleSort}
        />
        {view.units.map(unit => (
          <SortHeader
            key={unit.name}
            label={capitalize(unit.name.replace(/_/g, " "))}
            sortKey={unit.name}
            className={headerClassName(unit.name)}
            dataTip={`State ${unit.name} units number. Click to sort`}
            onSort={handleSort}
          />
        ))}
        <SortHeader
          label="Total"
          sortKey="total"
          className={headerClassName("total")}
          dataTip="Total military personnel (considering crew). Click to sort"
          onSort={handleSort}
        />
        <SortHeader
          label="Population"
          sortKey="population"
          className={headerClassName("population")}
          dataTip="State population. Click to sort"
          onSort={handleSort}
        />
        <SortHeader
          label="Rate"
          sortKey="rate"
          className={headerClassName("rate")}
          dataTip="Military personnel rate (% of state population). Depends on war alert. Click to sort"
          onSort={handleSort}
        />
        <SortHeader
          label="War Alert"
          sortKey="alert"
          className={headerClassName("alert")}
          dataTip="War Alert. Modifier to military forces number, depends of political situation. Click to sort"
          onSort={handleSort}
        />
      </div>
      {/* Keeps the legacy element id so general.js's map-hover
          highlightEditorLine still finds the open overview's rows (it probes
          #militaryOverview and matches div[data-id]); heals when general.js
          converts. */}
      <div id="militaryOverview" className="table" data-type={percentage ? "percentage" : "absolute"}>
        {sortedRows.map(row => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only map highlight (legacy row mouseenter/mouseleave); keyboard users reach the same state via the row's regiments button.
          <div
            key={row.id}
            className="states"
            data-id={row.id}
            data-state={row.name}
            onMouseEnter={() => handleHighlightOn(row.id)}
            onMouseLeave={() => handleHighlightOff(row.id)}
          >
            <fill-box data-tip={row.fullName} fill={row.color} disabled />
            <input data-tip={row.fullName} style={{ width: "6em" }} value={row.name} readOnly />
            {view.units.map(unit => (
              <div
                key={unit.name}
                data-type={unit.name}
                data-tip={`State ${unit.name} units number`}
                style={{ width: "5em" }}
              >
                {percentage
                  ? shareText(row.unitForces[unit.name], view.unitTotals[unit.name])
                  : String(row.unitForces[unit.name])}
              </div>
            ))}
            <div
              data-type="total"
              data-tip="Total state military personnel (considering crew)"
              style={{ width: "5em", fontWeight: "bold" }}
            >
              {percentage ? shareText(row.total, view.totalSum) : si(row.total)}
            </div>
            <div data-type="population" data-tip="State population" style={{ width: "5em" }}>
              {percentage ? shareText(row.population, view.populationSum) : si(row.population)}
            </div>
            <div
              data-type="rate"
              data-tip="Military personnel rate (% of state population). Depends on war alert"
              style={{ width: "5em" }}
            >
              {rn(row.rate, 2)}%
            </div>
            <input
              // Remount on any world change so the uncontrolled value re-reads
              // the (possibly regenerated) alert.
              key={`alert-${worldVersion}-${refreshCount}`}
              data-tip="War Alert. Editable modifier to military forces number, depends of political situation"
              style={{ width: "4.1em", MozAppearance: "textfield" }}
              type="number"
              min={0}
              step={0.01}
              defaultValue={rn(row.alert, 2)}
              // Native change (blur/Enter/spinner), NOT React's per-keystroke
              // onChange: the legacy scaling is multiplicative, so committing
              // per character would compound (and ADR-0004 forbids signalling
              // per keystroke).
              ref={element => {
                if (element) element.onchange = () => commitWarAlert(row.id, element.value);
              }}
            />
            <RowIcon
              className="icon-list-bullet pointer"
              tip="Show regiments list"
              label="Show regiments list"
              onClick={() => openRegimentsOverview(row.id)}
            />
          </div>
        ))}
      </div>
      <div className="totalLine">
        <div data-tip="States number" style={{ marginLeft: "4px" }}>
          States: {view.rows.length}
        </div>
        <div data-tip="Total military forces" style={{ marginLeft: "14px" }}>
          Total forces: {si(view.totalSum)}
        </div>
        <div data-tip="Average military forces per state" style={{ marginLeft: "14px" }}>
          Average forces: {si(average(view.totalSum))}
        </div>
        <div data-tip="Average forces rate per state" style={{ marginLeft: "14px" }}>
          Average rate: {rn(average(view.rateSum), 2)}%
        </div>
        <div data-tip="Average War Alert" style={{ marginLeft: "14px" }}>
          Average alert: {rn(average(view.alertSum), 2)}
        </div>
      </div>
      <div>
        <button
          type="button"
          id="militaryOverviewRefresh"
          data-tip="Refresh the overview screen"
          className="icon-cw"
          aria-label="Refresh"
          onClick={refresh}
        />
        <button
          type="button"
          data-tip="Edit Military units"
          className="icon-cog"
          aria-label="Edit military units"
          onClick={handleOpenOptions}
        />
        <button
          type="button"
          data-tip="Show regiments list"
          className="icon-list-bullet"
          aria-label="Open regiments overview"
          onClick={() => openRegimentsOverview(-1)}
        />
        <button
          type="button"
          data-tip="Toggle percentage / absolute values views"
          className="icon-percent"
          aria-label="Toggle percentage / absolute values views"
          onClick={() => setPercentage(current => !current)}
        />
        <button
          type="button"
          data-tip="Recalculate military forces based on current options"
          className="icon-retweet"
          aria-label="Recalculate military forces"
          onClick={handleRecalculate}
        />
        <button
          type="button"
          data-tip="Save military-related data as a text file (.csv)"
          className="icon-download"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
        <button
          type="button"
          data-tip="Open Military Forces Tutorial"
          className="icon-info"
          aria-label="Open Military Forces Tutorial"
          onClick={() => wiki("Military-Forces")}
        />
      </div>
    </Panel>
  );
}
