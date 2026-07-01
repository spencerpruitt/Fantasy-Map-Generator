import { useReducer, useState } from "react";
import { rn } from "@/utils/numberUtils";
import { formatPrice } from "@/utils/unitUtils";
import { Panel } from "../Panel";
import {
  getGood,
  getGoodsSortedByName,
  getMarketColor,
  getMarketGood,
  getMarketName,
  getMarkets
} from "../world-state";

// Register the `fill-box` custom element (public/components/fill-box.js) as an
// intrinsic JSX tag so the color swatch renders exactly as the legacy markup did.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "fill-box": { fill?: string };
    }
  }
}

interface ComparePricesProps {
  /** Registry-supplied id of the good to compare (from the `open()` seam). */
  goodId?: number;
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// Which column the table is sorted by, and its direction. Market sorts by name
// (alphabetically), Stock/Price sort numerically — matching the legacy header
// `data-sortby` values and the `applySorting` name/number split.
type SortKey = "market" | "stock" | "price";
type SortDirection = "up" | "down";

// One rendered market line: the swatch color, display name, and the selected
// good's rounded stock/price (rounded the same way the legacy `addLines` did).
interface MarketRow {
  id: number;
  name: string;
  color: string;
  stock: number;
  price: number;
}

/**
 * Quote a CSV field per RFC 4180: wrap in double quotes (doubling any embedded
 * quote) only when it contains a comma, quote, or newline. Fields without those
 * characters — market names, numbers, plain good names — pass through unchanged,
 * so normal exports stay byte-identical to the legacy output while a market name
 * with a comma no longer corrupts the row.
 */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  className: string;
  dataTip: string;
  onSort: (key: SortKey) => void;
  style?: React.CSSProperties;
}

/**
 * A clickable, keyboard-operable column header. Rendered as a `<div>` (not a
 * `<button>`) so it keeps the legacy grid-cell look while carrying the legacy
 * `data-sortby` marker, `data-tip` tooltip, and `sortable`/`icon-sort-*` classes.
 */
function SortHeader({ label, sortKey, className, dataTip, onSort, style }: SortHeaderProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: must stay a grid-cell <div> so the legacy `.header` CSS grid lays it out; keyboard handlers below give it button semantics.
    <div
      role="button"
      tabIndex={0}
      className={className}
      data-sortby={sortKey}
      data-tip={dataTip}
      style={style}
      onClick={() => onSort(sortKey)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onSort(sortKey);
      }}
    >
      {label}&nbsp;
    </div>
  );
}

/**
 * ComparePrices — the Compare Prices surface, at full parity with the legacy
 * jQuery-UI dialog.
 *
 * Presentational: it reads all world data through the World-State accessor
 * (never raw `window.pack`) and performs side-effects (CSV download, filename)
 * via the existing window globals, exactly as the legacy controller did. It owns
 * the table's local view state — selected good, sort column/direction, and the
 * absolute/percentage stock mode — as React state rather than DOM mutation.
 *
 * The surface is remounted on every open (App keys it by the registry token), so
 * its view state resets per open the way the legacy dialog did. The selected
 * good is reconciled against the live goods list on every render, so an invalid
 * incoming id or a good deleted between Refreshes falls back to the first good
 * instead of blanking the table.
 */
export function ComparePrices({ goodId, anchor, onClose }: ComparePricesProps) {
  // Bumping this forces a re-read of world data (Refresh button). Reads happen
  // in render, so a re-render re-snapshots the accessor.
  const [, refresh] = useReducer(count => count + 1, 0);

  const sortedGoods = getGoodsSortedByName();

  const [selectedGoodId, setSelectedGoodId] = useState(() => goodId ?? -1);
  const [sortKey, setSortKey] = useState<SortKey>("stock");
  const [sortDirection, setSortDirection] = useState<SortDirection>("down");
  const [showPercentage, setShowPercentage] = useState(false);

  // Reconcile the selection against the live goods list: if the id does not
  // resolve to a good (invalid incoming id, or the good was deleted before a
  // Refresh), fall back to the first good — the legacy `rebuildGoodSelect` guard.
  const selectedGood = getGood(selectedGoodId) ?? sortedGoods[0];

  const rows: MarketRow[] = selectedGood
    ? getMarkets().map(market => {
        const marketGood = getMarketGood(market, selectedGood);
        return {
          id: market.i,
          name: getMarketName(market),
          color: getMarketColor(market),
          stock: rn(marketGood?.stock ?? 0, 2),
          price: rn(marketGood?.price ?? 0, 2)
        };
      })
    : [];

  const totalStock = rows.reduce((sum, row) => sum + row.stock, 0);
  const priceSum = rows.reduce((sum, row) => sum + row.price, 0);
  const averagePrice = rows.length > 0 ? rn(priceSum / rows.length, 2) : 0;

  const sortDescending = sortDirection === "down" ? -1 : 1;
  const sortedRows = [...rows].sort((first, second) => {
    if (sortKey === "market") return first.name.localeCompare(second.name) * sortDescending;
    const comparison = first[sortKey] > second[sortKey] ? 1 : first[sortKey] < second[sortKey] ? -1 : 0;
    return comparison * sortDescending;
  });

  function handleGoodChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    setSelectedGoodId(Number(event.target.value));
    setShowPercentage(false);
  }

  function handleRefresh(): void {
    setShowPercentage(false);
    refresh();
  }

  // Clicking a header sorts by its column. Re-clicking the active column flips
  // direction; a fresh column starts ascending for names and descending for
  // numbers — matching the legacy `sortLines` toggle.
  function handleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection(current => (current === "down" ? "up" : "down"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "market" ? "up" : "down");
  }

  // CSV is built from world order (the `rows` array, not the sorted view), with
  // each field escaped, then handed to the window download globals — same output
  // as the legacy `downloadCsv` for names without special characters.
  function handleExport(): void {
    const goodName = selectedGood?.name ?? "Unknown";
    const header = [csvField("Market"), csvField(`Stock (${goodName})`), csvField(`Price (${goodName})`)].join(",");
    const lines = rows.map(row => [csvField(row.name), String(row.stock), String(row.price)].join(","));
    const csv = `${[header, ...lines].join("\n")}\n`;
    downloadFile(csv, `${getFileName(`Compare_Prices_${goodName}`)}.csv`);
  }

  function headerClassName(key: SortKey): string {
    const base = key === "market" ? "sortable alphabetically" : "sortable";
    if (key !== sortKey) return base;
    const type = key === "market" ? "name" : "number";
    return `${base} icon-sort-${type}-${sortDirection}`;
  }

  function stockCellText(stock: number): string {
    if (!showPercentage) return String(stock);
    return totalStock ? `${rn((stock / totalStock) * 100, 2)}%` : "0%";
  }

  return (
    <Panel title="Compare Prices" anchor={anchor} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: ".5em", padding: ".2em 0 .4em", fontSize: ".9em" }}>
        <label htmlFor="comparePricesSelect" data-tip="Select good to compare stock across markets">
          Good:
        </label>
        <select
          id="comparePricesSelect"
          style={{ flex: 1, minWidth: "8em" }}
          value={selectedGood?.i ?? ""}
          onChange={handleGoodChange}
        >
          {sortedGoods.map(good => (
            <option key={good.i} value={good.i}>
              {good.name}
            </option>
          ))}
        </select>
      </div>
      <div className="header" style={{ gridTemplateColumns: "1.6em 9em 6em 7em" }}>
        <div />
        <SortHeader
          label="Market"
          sortKey="market"
          className={headerClassName("market")}
          dataTip="Market center burg name. Click to sort"
          onSort={handleSort}
          style={{ marginLeft: 0 }}
        />
        <SortHeader
          label="Stock"
          sortKey="stock"
          className={headerClassName("stock")}
          dataTip="Good stock in this market. Click to sort"
          onSort={handleSort}
        />
        <SortHeader
          label="Price"
          sortKey="price"
          className={headerClassName("price")}
          dataTip="Price for this good. Click to sort"
          onSort={handleSort}
        />
      </div>
      <div className="table" style={{ maxHeight: "40em" }}>
        {selectedGood ? (
          sortedRows.map(row => (
            <div
              key={row.id}
              className="states"
              data-id={row.id}
              data-market={row.name}
              data-stock={row.stock}
              data-price={row.price}
            >
              <fill-box fill={row.color} />
              <div style={{ width: "9em" }}>{row.name}</div>
              <div data-type="stock" style={{ width: "5em" }}>
                {stockCellText(row.stock)}
              </div>
              <div style={{ width: "7em" }}>{formatPrice(row.price)}</div>
            </div>
          ))
        ) : (
          <div>Select a good</div>
        )}
      </div>
      <div className="totalLine">
        <div style={{ marginLeft: "5px" }} data-tip="Total stock of this good across all markets">
          Total Stock:&nbsp;{rn(totalStock, 2)}
        </div>
        <div style={{ marginLeft: "12px" }} data-tip="Average price of this good across markets">
          Avg Price:&nbsp;{formatPrice(averagePrice)}
        </div>
      </div>
      <div>
        <button type="button" className="icon-cw" data-tip="Refresh" aria-label="Refresh" onClick={handleRefresh} />
        <button
          type="button"
          className="icon-percent"
          data-tip="Toggle percentage / absolute values views"
          aria-label="Toggle percentage view"
          onClick={() => setShowPercentage(current => !current)}
        />
        <button
          type="button"
          className="icon-download"
          data-tip="Save data as a CSV file"
          aria-label="Export as CSV"
          onClick={handleExport}
        />
      </div>
    </Panel>
  );
}
