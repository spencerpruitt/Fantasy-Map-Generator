import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useMemo,
  useState
} from "react";
import { DEMAND_CATEGORY_ICONS, DEMAND_PRIORITY, DEMAND_TARGET_FACTORS } from "@/generators/goods-generator";
import type { Deal } from "@/generators/markets-generator";
import type { ProductionCandidate, ProductionRecipeEntry } from "@/generators/production-generator";
import { isDealRecord, isMfgRecord } from "@/generators/production-generator";
import { rn } from "@/utils/numberUtils";
import { formatPrice } from "@/utils/unitUtils";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";
import {
  getBurg,
  getBurgs,
  getDeals,
  getGood,
  getGoodStroke,
  getMarket,
  getMarketName,
  getSalesTax
} from "../world-state";

interface ProductionOverviewProps {
  /** Registry-supplied id of the burg to show (from the `open()` seam). */
  burgId: number;
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

type RowType = "MFG" | "BUY" | "SELL" | "LOCAL";

// One chronological production/trade history line, computed from the burg's
// production records. Deal rows carry what their expandable calculation needs;
// MFG rows carry the recorded decision candidates (present only in debug runs).
type HistoryRow =
  | {
      kind: "mfg";
      goodId: number;
      units: number;
      recipe: ProductionRecipeEntry[];
      cultureModifier: number;
      candidates?: readonly ProductionCandidate[];
    }
  | { kind: "buy"; goodId: number; units: number; price: number; spent: number }
  | { kind: "sell"; goodId: number; units: number; price: number; tax: number; netRevenue: number }
  | { kind: "local"; goodId: number; units: number };

// The legacy inline styles, verbatim, so the surface renders identically to the
// old `#alert` markup (this dialog never used the global table classes).
const styles = {
  muted: { color: "#777" },
  subtle: { color: "#999" },
  divider: { color: "#bbb" },
  positive: { color: "#2a6" },
  negative: { color: "#c44" },
  warning: { color: "#c84" },
  sectionTitle: { fontWeight: "bold", borderBottom: "1px solid #ccc", paddingBottom: ".3em", marginBottom: ".45em" },
  topBar: { marginBottom: ".85em", display: "flex", flexWrap: "wrap", columnGap: ".85em", alignItems: "center" },
  table: { width: "100%", tableLayout: "fixed", borderCollapse: "collapse", lineHeight: 1 },
  headRow: { background: "#eee" },
  bodyRow: { borderBottom: "1px solid #f0f0f0" },
  cell: { padding: ".4em .5em", verticalAlign: "top" },
  cellRight: { padding: ".4em .5em", verticalAlign: "top", textAlign: "right" },
  detailsCell: { padding: "0.5em 0.5em 1em" },
  empty: { color: "#888", fontStyle: "italic" }
} satisfies Record<string, CSSProperties>;

const badgeBase: CSSProperties = {
  display: "inline-block",
  borderRadius: "3px",
  padding: "0 .4em",
  fontSize: "0.8em",
  fontWeight: "bold",
  lineHeight: 1.35
};

const badgeVariants: Record<RowType, { style: CSSProperties; tip: string }> = {
  BUY: { style: { background: "#f5d9d6", color: "#a33" }, tip: "Local market purchase" },
  SELL: { style: { background: "#dff0e2", color: "#2f8a46" }, tip: "Sale to local market" },
  LOCAL: { style: { background: "#d9e7f5", color: "#346" }, tip: "Local production" },
  MFG: { style: { background: "#f8e7bf", color: "#b67a00" }, tip: "Manufacturing step" }
};

function goodName(id: number): string {
  return getGood(id)?.name ?? `#${id}`;
}

function TypeBadge({ type }: { type: RowType }) {
  const variant = badgeVariants[type];
  return (
    <span style={{ ...badgeBase, ...variant.style }} data-tip={variant.tip}>
      {type}
    </span>
  );
}

function ModifierBadge({ modifier }: { modifier: number }) {
  return (
    <span
      style={{ ...badgeBase, marginLeft: "4px", background: "#edf1f4", color: "#5f6f7a" }}
      data-tip="Culture type production modifier. Produced units are multiplied by this value."
    >
      x{rn(modifier, 2)}
    </span>
  );
}

function GoodDot({ goodId }: { goodId: number }) {
  const good = getGood(goodId);
  if (!good) return null;
  return (
    <svg width="14" height="14" style={{ margin: "-6px 2px -4px 0" }} role="img" aria-label={good.name}>
      <title>{good.name}</title>
      <circle cx="50%" cy="50%" r="42%" fill={good.color} stroke={getGoodStroke(good.color)} />
      <use href={`#${good.icon}`} x="10%" y="10%" width="80%" height="80%" />
    </svg>
  );
}

function GoodLabel({ goodId, suffix }: { goodId: number; suffix?: ReactNode }) {
  return (
    <>
      <GoodDot goodId={goodId} />
      {goodName(goodId)}
      {suffix}
    </>
  );
}

function TaggedGood({ goodId, type, suffix }: { goodId: number; type: RowType; suffix?: ReactNode }) {
  return (
    <>
      <GoodLabel goodId={goodId} suffix={suffix} />{" "}
      <span style={{ marginLeft: "4px" }}>
        <TypeBadge type={type} />
      </span>
    </>
  );
}

/** Demand values per category, dot-separated; positive-only entries when asked. */
function DemandList({ values, onlyPositive = false }: { values: number[]; onlyPositive?: boolean }) {
  const entries = DEMAND_PRIORITY.flatMap((category, index) => {
    const value = values[index] || 0;
    if (onlyPositive && value <= 0.001) return [];
    return [{ category, value }];
  });

  return (
    <>
      {entries.map((entry, index) => (
        <Fragment key={entry.category}>
          {index > 0 && (
            <>
              {" "}
              <span style={styles.divider}>•</span>{" "}
            </>
          )}
          <span data-tip={entry.category}>
            {DEMAND_CATEGORY_ICONS[entry.category]} {rn(entry.value, 2)}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function CandidateScore({ score }: { score: number }) {
  return <b style={styles.positive}>score {rn(score, 2)}</b>;
}

/** One decision candidate: its score formula and the ingredients it would use. */
function DecisionCandidate({ candidate }: { candidate: ProductionCandidate }) {
  const ingredients = candidate.ingredients.map((ingredient, index) => (
    <Fragment key={ingredient.goodId}>
      {index > 0 && ", "}
      {rn(ingredient.amount * candidate.units, 2)} <GoodDot goodId={ingredient.goodId} />
    </Fragment>
  ));

  const prep = candidate.isPreparation ? (
    <>
      {" "}
      (prep for <GoodDot goodId={candidate.goalGoodId ?? -1} />)
    </>
  ) : null;
  const demand =
    candidate.demandCategory && candidate.demandMultiplier !== 1
      ? `x demand ${DEMAND_CATEGORY_ICONS[candidate.demandCategory]} ${rn(candidate.demandMultiplier, 2)}`
      : "";
  const culture = candidate.cultureModifier !== 1 ? <ModifierBadge modifier={candidate.cultureModifier} /> : null;

  let formula: ReactNode;
  if (candidate.isPreparation) {
    const workers = rn(candidate.workersNeeded || 1, 2);
    const gain = ((candidate.gainPerWorker || 0) / candidate.demandMultiplier) * workers;
    formula = (
      <>
        goal sell {formatPrice(gain)}
        {culture} ÷ {workers} workers {demand} × units {rn(candidate.units, 2)} ={" "}
        <CandidateScore score={candidate.score} />
      </>
    );
  } else {
    formula = (
      <>
        sell {formatPrice(candidate.sellPrice)}
        {culture} - cost {formatPrice(candidate.ingredientCost)} = <CandidateScore score={candidate.score} />
      </>
    );
  }

  return (
    <div>
      <TypeBadge type="MFG" /> <b>{goodName(candidate.goodId)}</b>
      {prep}: {formula}. <span style={styles.muted}>Ingredients: {ingredients}</span>
    </div>
  );
}

function DecisionDetails({ candidates }: { candidates: readonly ProductionCandidate[] }) {
  const sorted = [...candidates].sort((first, second) => second.score - first.score);
  return (
    <>
      <div>
        <b>Decision basis:</b> highest score among {candidates.length} feasible options:
      </div>
      <ul style={{ margin: ".2em 0 0 1.1em", padding: 0 }}>
        {sorted.map((candidate, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: candidates have no id; the list is static per expansion.
          <li key={index} style={{ marginTop: ".25em" }}>
            <DecisionCandidate candidate={candidate} />
          </li>
        ))}
      </ul>
    </>
  );
}

function CalculationDetails({ expression, value, label }: { expression: string; value: number; label: string }) {
  return (
    <div>
      <b>Deal calculation:</b> {expression} = <b>{formatPrice(value)}</b> {label}
    </div>
  );
}

interface TableHeader {
  label: string;
  align?: "left" | "right";
  title?: string;
}

/** The legacy styled table shell: colgroup widths, grey head row, or the empty note. */
function StyledTable({
  colWidths,
  headers,
  isEmpty,
  empty,
  children
}: {
  colWidths: string[];
  headers: TableHeader[];
  isEmpty: boolean;
  empty: string;
  children: ReactNode;
}) {
  if (isEmpty) return <i style={styles.empty}>{empty}</i>;

  return (
    <table style={styles.table}>
      <colgroup>
        {colWidths.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: column order is fixed.
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <thead>
        <tr style={styles.headRow}>
          {headers.map(header => (
            <th
              key={header.label}
              style={header.align === "right" ? styles.cellRight : styles.cell}
              data-tip={header.title || undefined}
            >
              {header.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Section({ title, tooltip, children }: { title: string; tooltip: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: ".9em" }}>
      <div style={styles.sectionTitle} data-tip={tooltip}>
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * ProductionOverview — a burg's production/trade history surface, at parity with
 * the legacy rendering into the shared `#alert` dialog.
 *
 * Presentational, reading all world data through the World-State accessor (never
 * raw `window.pack`) and re-reading whenever the world changes (`useWorldVersion`).
 * It shows the stats top bar (population, process order, market, demand, product/
 * tax/treasury), the manufactured-goods table, and the chronological production
 * and trade history whose MFG/deal rows expand to decision or deal-calculation
 * details on click. Remounted per open (App keys it by the registry token), so
 * expansion state resets each open the way the legacy `innerHTML` rebuild did.
 */
export function ProductionOverview({ burgId, anchor, onClose }: ProductionOverviewProps) {
  const worldVersion = useWorldVersion();
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(new Set());

  const burg = getBurg(burgId);
  const production = burg && !burg.removed ? burg.production : undefined;

  // The full chronological walk over the burg's production records, exactly as
  // the legacy controller did it: aggregate produced goods and net inventory,
  // accumulate sales tax, and derive the demand-coverage totals at the end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the accessor.
  const model = useMemo(() => {
    if (!burg || !production) return undefined;

    const population = burg.population || 0;

    // Process rank comes from the same population-ascending order the production
    // run processes burgs in.
    const sortedBurgIds = getBurgs()
      .filter(entry => entry.i && !entry.removed)
      .sort((first, second) => (first.population || 0) - (second.population || 0))
      .map(entry => entry.i as number);

    const isBurgSeller = (deal: Deal) => deal.sellerType === "burg" && deal.seller === burgId;
    const isBurgBuyer = (deal: Deal) => deal.buyerType === "burg" && deal.buyer === burgId;
    const getDealTax = (deal: Deal) => {
      if (!isBurgSeller(deal)) return 0;
      if (deal.tax !== undefined) return deal.tax;
      return deal.units * deal.price * getSalesTax(getBurg(deal.seller));
    };

    const dealById = new Map(getDeals().map(deal => [deal.i, deal]));
    const producedByGood: Record<number, number> = {};
    const netInventory: Record<number, number> = {};
    let totalTax = 0;

    const historyRows: HistoryRow[] = production.flatMap((entry): HistoryRow[] => {
      if (isMfgRecord(entry)) {
        producedByGood[entry.goodId] = (producedByGood[entry.goodId] || 0) + entry.units;
        netInventory[entry.goodId] = (netInventory[entry.goodId] || 0) + entry.units;
        for (const item of entry.recipe) netInventory[item.goodId] = (netInventory[item.goodId] || 0) - item.units;
        return [
          {
            kind: "mfg" as const,
            goodId: entry.goodId,
            units: entry.units,
            recipe: entry.recipe,
            cultureModifier: entry.cultureModifier ?? 1,
            candidates: entry.candidates
          }
        ];
      }
      if (isDealRecord(entry)) {
        const deal = dealById.get(entry.dealId);
        if (!deal) return [];
        if (isBurgBuyer(deal)) {
          netInventory[deal.good] = (netInventory[deal.good] || 0) + deal.units;
          return [
            {
              kind: "buy" as const,
              goodId: deal.good,
              units: deal.units,
              price: deal.price,
              spent: deal.units * deal.price
            }
          ];
        }
        if (isBurgSeller(deal)) {
          netInventory[deal.good] = (netInventory[deal.good] || 0) - deal.units;
          const tax = getDealTax(deal);
          totalTax += tax;
          return [
            {
              kind: "sell" as const,
              goodId: deal.good,
              units: deal.units,
              price: deal.price,
              tax,
              netRevenue: deal.units * deal.price - tax
            }
          ];
        }
        return [];
      }
      producedByGood[entry.goodId] = (producedByGood[entry.goodId] || 0) + entry.units;
      netInventory[entry.goodId] = (netInventory[entry.goodId] || 0) + entry.units;
      return [{ kind: "local" as const, goodId: entry.goodId, units: entry.units }];
    });

    const producedRows = Object.entries(producedByGood)
      .filter(([, units]) => units > 0)
      .sort(([, first], [, second]) => second - first)
      .map(([goodIdText, units]) => ({ goodId: Number(goodIdText), units }));

    const initialDemand = DEMAND_PRIORITY.map(category => population * DEMAND_TARGET_FACTORS[category]);

    // How much of each demand category the burg's final net inventory covers.
    const finalDemandCoverage: number[] = Array(DEMAND_PRIORITY.length).fill(0);
    for (const goodIdText in netInventory) {
      const amount = netInventory[Number(goodIdText)] || 0;
      if (amount <= 0) continue;
      const good = getGood(Number(goodIdText));
      if (!good) continue;
      DEMAND_PRIORITY.forEach((category, categoryIndex) => {
        const coveredAmount = good.demandCoverage?.[category] || 0;
        if (coveredAmount) finalDemandCoverage[categoryIndex] += amount * coveredAmount;
      });
    }
    const uncoveredDemand = initialDemand.map((target, index) => Math.max(0, target - finalDemandCoverage[index]));

    const grossProduct = Math.max(0, burg.product || 0);

    return {
      population,
      totalBurgs: sortedBurgIds.length,
      processRank: sortedBurgIds.indexOf(burgId) + 1,
      market: burg.market !== undefined ? getMarket(burg.market) : undefined,
      historyRows,
      producedRows,
      initialDemand,
      uncoveredDemand,
      totalTax,
      grossProduct,
      productPerCapita: population > 0 ? grossProduct / population : 0,
      treasuryAfter: burg.treasury || 0
    };
  }, [burgId, worldVersion, burg, production]);

  if (!burg || burg.removed) {
    return (
      <Panel title="Production Overview" anchor={anchor} onClose={onClose}>
        <div>This burg is no longer available.</div>
      </Panel>
    );
  }

  if (!production || !model) {
    return (
      <Panel title={`Production Overview: ${burg.name}`} anchor={anchor} onClose={onClose}>
        <div>No production data for this burg.</div>
      </Panel>
    );
  }

  const hasUncoveredDemand = model.uncoveredDemand.some(value => value > 0.001);

  function toggleRow(index: number): void {
    setExpandedRows(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // The expandable details for a history row: decision candidates for MFG rows
  // (when recorded), the deal calculation for BUY/SELL rows, nothing for LOCAL.
  function rowDetails(row: HistoryRow): ReactNode {
    if (row.kind === "mfg") {
      if (!row.candidates || row.candidates.length === 0) return null;
      return <DecisionDetails candidates={row.candidates} />;
    }
    if (row.kind === "buy") {
      return (
        <CalculationDetails
          expression={`unit ${rn(row.units, 2)} × buy price ${rn(row.price, 2)}`}
          value={-row.spent}
          label="spent"
        />
      );
    }
    if (row.kind === "sell") {
      return (
        <CalculationDetails
          expression={`unit ${rn(row.units, 2)} × sell price ${rn(row.price, 2)} - sales tax ${rn(row.tax, 2)}`}
          value={row.netRevenue}
          label="income"
        />
      );
    }
    return null;
  }

  function renderHistoryRow(row: HistoryRow, index: number): ReactNode {
    const details = rowDetails(row);
    const expandTip = row.kind === "mfg" ? "Click to expand decision details" : "Click to expand deal details";
    const rowStyle: CSSProperties = details ? { ...styles.bodyRow, cursor: "pointer" } : styles.bodyRow;
    const interactiveProps = details
      ? {
          onClick: () => toggleRow(index),
          onKeyDown: (event: ReactKeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") toggleRow(index);
          },
          "data-tip": expandTip
        }
      : {};

    let goodCell: ReactNode;
    let unitsCell: ReactNode;
    let detailsCell: ReactNode;
    let incomeCell: ReactNode;

    if (row.kind === "mfg") {
      const cultureSuffix = row.cultureModifier !== 1 ? <ModifierBadge modifier={row.cultureModifier} /> : undefined;
      goodCell = <TaggedGood goodId={row.goodId} type="MFG" suffix={cultureSuffix} />;
      unitsCell = rn(row.units, 2);
      detailsCell = (
        <>
          Manufacturing from{" "}
          {row.recipe.map((item, itemIndex) => (
            <Fragment key={item.goodId}>
              {itemIndex > 0 && " and "}
              {rn(item.units, 2)} <GoodDot goodId={item.goodId} />
            </Fragment>
          ))}
        </>
      );
      incomeCell = <td style={{ ...styles.cellRight, ...styles.subtle }} />;
    } else if (row.kind === "buy") {
      goodCell = <TaggedGood goodId={row.goodId} type="BUY" />;
      unitsCell = rn(row.units, 2);
      detailsCell = "Market purchase";
      incomeCell = (
        <td style={{ ...styles.cellRight, ...(-row.spent >= 0 ? styles.positive : styles.warning) }}>
          {formatPrice(-row.spent)}
        </td>
      );
    } else if (row.kind === "sell") {
      goodCell = <TaggedGood goodId={row.goodId} type="SELL" />;
      unitsCell = rn(row.units, 2);
      detailsCell = "Sale to local market";
      incomeCell = (
        <td style={{ ...styles.cellRight, ...(row.netRevenue >= 0 ? styles.positive : styles.warning) }}>
          {formatPrice(row.netRevenue)}
        </td>
      );
    } else {
      goodCell = <TaggedGood goodId={row.goodId} type="LOCAL" />;
      // The legacy row rendered local units unrounded; preserved as-is.
      unitsCell = row.units;
      detailsCell = "Local bonus resource";
      incomeCell = <td style={{ ...styles.cellRight, ...styles.subtle }} />;
    }

    return (
      // Keyed by index: rows are a fixed chronological log with no ids.
      <Fragment key={index}>
        <tr style={rowStyle} {...interactiveProps}>
          <td style={styles.cell}>{goodCell}</td>
          <td style={styles.cellRight}>{unitsCell}</td>
          <td style={styles.cell}>{detailsCell}</td>
          {incomeCell}
        </tr>
        {details && expandedRows.has(index) && (
          <tr>
            <td colSpan={4} style={styles.detailsCell}>
              {details}
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <Panel title={`Production Overview: ${burg.name}`} anchor={anchor} onClose={onClose}>
      <div style={{ width: "48em" }}>
        <div style={styles.topBar}>
          <div>
            <span>
              <b>Population:</b> {model.population}
            </span>{" "}
            <span>
              <b>Order:</b> {model.processRank} of {model.totalBurgs}
            </span>{" "}
            <span>
              <b>Market:</b> {model.market ? getMarketName(model.market) : "unknown"} ({model.market?.i})
            </span>
          </div>
          <div>
            <b>Initial Demand:</b> <DemandList values={model.initialDemand} />
          </div>
          <div>
            <b>Uncovered Demand:</b>{" "}
            {hasUncoveredDemand ? <DemandList values={model.uncoveredDemand} onlyPositive /> : "none"}
          </div>
          <div>
            <span data-tip="Gross Product is local sale revenue minus purchased ingredient costs during the production.">
              <b>Product:</b> <span style={styles.positive}>{formatPrice(model.grossProduct)}</span>
            </span>{" "}
            <span data-tip="Product per capita: gross product divided by population.">
              <b>Wealth:</b>{" "}
              <span style={model.productPerCapita >= 0 ? styles.positive : styles.negative}>
                {formatPrice(model.productPerCapita)}
              </span>
            </span>{" "}
            <span data-tip="Sales Tax is paid by the seller on local sale deals. It is deducted from gross sale value and transferred to the state treasury.">
              <b>Total Tax:</b>{" "}
              <span style={model.totalTax >= 0 ? styles.warning : styles.subtle}>{formatPrice(model.totalTax)}</span>
            </span>{" "}
            <span data-tip="Net burg treasury after local buying, local sales, and final local demand fill.">
              <b>Treasury:</b>{" "}
              <span style={model.treasuryAfter >= 0 ? styles.positive : styles.negative}>
                {formatPrice(model.treasuryAfter)}
              </span>
            </span>
          </div>
        </div>
        <Section title="Manufactured Goods" tooltip="Goods manufactured by this burg in this production cycle.">
          <StyledTable
            colWidths={["80%", "20%"]}
            headers={[{ label: "Good" }, { label: "Units", align: "right" }]}
            isEmpty={model.producedRows.length === 0}
            empty="No goods manufactured"
          >
            {model.producedRows.map(row => (
              <tr key={row.goodId} style={styles.bodyRow}>
                <td style={styles.cell}>
                  <GoodLabel goodId={row.goodId} />
                </td>
                <td style={styles.cellRight}>{rn(row.units, 2)}</td>
              </tr>
            ))}
          </StyledTable>
        </Section>
        <Section
          title="Production and Trade history"
          tooltip="Chronological local production, market purchases, sales, and demand-fill operations for this burg."
        >
          <StyledTable
            colWidths={["30%", "10%", "45%", "15%"]}
            headers={[
              { label: "Good" },
              { label: "Units", align: "right" },
              { label: "Details" },
              {
                label: "Income",
                align: "right",
                title: "Money flow for deal rows: negative for BUY, positive for SELL. Pure production rows are blank."
              }
            ]}
            isEmpty={model.historyRows.length === 0}
            empty="No production actions recorded"
          >
            {model.historyRows.map(renderHistoryRow)}
          </StyledTable>
        </Section>
      </div>
    </Panel>
  );
}
