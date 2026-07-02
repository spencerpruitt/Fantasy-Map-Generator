import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Good } from "@/generators/goods-generator";
import type { Deal, Market } from "@/generators/markets-generator";
import type { ProductionRecord } from "@/generators/production-generator";
import { notifyWorldChanged } from "../world-state";
import { ProductionOverview } from "./ProductionOverview";

const iron: Good = { i: 0, name: "Iron", tags: [], value: 5, unit: "unit", icon: "goodIron", color: "#aaa" };
const grain: Good = { i: 1, name: "Grain", tags: [], value: 2, unit: "unit", icon: "goodGrain", color: "#bbb" };
const tools: Good = {
  i: 2,
  name: "Tools",
  tags: [],
  value: 8,
  unit: "unit",
  icon: "goodTools",
  color: "#ccc",
  demandCoverage: { utilities: 1 }
};
const allGoods = [iron, grain, tools];

const market: Market = { i: 0, centerBurgId: 5, color: "#f00", goods: {} };

// The target burg buys iron from the market (deal 1) and sells tools to it (deal 2).
const deals: Deal[] = [
  { i: 1, seller: 0, sellerType: "market", buyer: 5, buyerType: "burg", good: 0, units: 4, price: 2, tax: 0 },
  { i: 2, seller: 5, sellerType: "burg", buyer: 0, buyerType: "market", good: 2, units: 3, price: 5, tax: 1 }
];

// Chronological production history: a local bonus, a manufacturing step with a
// recorded decision, a market purchase, and a local sale.
const production: ProductionRecord[] = [
  { goodId: 1, units: 2 },
  {
    goodId: 2,
    units: 3,
    recipe: [{ goodId: 0, units: 1 }],
    cultureModifier: 1.5,
    candidates: [
      {
        goodId: 2,
        units: 3,
        sellPrice: 5,
        ingredientCost: 2,
        cultureModifier: 1.5,
        demandCategory: null,
        demandMultiplier: 1,
        score: 13,
        ingredients: [{ goodId: 0, amount: 0.33 }]
      }
    ]
  },
  { dealId: 1 },
  { dealId: 2 }
];

const globalScope = globalThis as Record<string, unknown>;

beforeEach(() => {
  // pack.burgs is indexed by burg id; burg 6 is smaller so the target burg 5 is
  // processed second (Order: 2 of 2).
  const burgs: unknown[] = [];
  burgs[5] = { i: 5, name: "Alpha", population: 10, market: 0, product: 20, treasury: 7, production };
  burgs[6] = { i: 6, name: "Beta", population: 5, market: 0 };
  burgs[7] = { i: 7, name: "Gone", population: 3, market: 0, removed: true };
  globalScope.pack = { goods: allGoods, burgs, markets: [market], deals };
  globalScope.Goods = {
    get: (id: number) => allGoods.find(good => good.i === id),
    getStroke: (color: string) => `stroke-of-${color}`
  };
  globalScope.Markets = {
    get: (id: number) => [market].find(entry => entry.i === id),
    getName: () => "Portmarket"
  };
  globalScope.States = { getSalesTax: () => 0.1 };
});

afterEach(() => {
  globalScope.pack = undefined;
  globalScope.Goods = undefined;
  globalScope.Markets = undefined;
  globalScope.States = undefined;
});

describe("<ProductionOverview>", () => {
  it("renders the stats bar, manufactured goods, and history rows", () => {
    const { container } = render(<ProductionOverview burgId={5} onClose={() => {}} />);

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Production Overview: Alpha");

    // Stats top bar: population, process order, market.
    expect(screen.getByText("Population:")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByText(/Portmarket \(0\)/)).toBeTruthy();

    // Manufactured goods: tools (3 from MFG) and grain (2 from LOCAL).
    expect(screen.getByText("Manufactured Goods")).toBeTruthy();

    // History: one row per production record, in chronological order. Badges are
    // identified by their tooltip (wrapper spans share the badge text).
    expect(container.querySelectorAll('tbody [data-tip="Local production"]').length).toBe(1);
    expect(container.querySelectorAll('tbody [data-tip="Local market purchase"]').length).toBe(1);
    expect(container.querySelectorAll('tbody [data-tip="Sale to local market"]').length).toBe(1);
    expect(container.querySelectorAll('tbody [data-tip="Manufacturing step"]').length).toBe(1);
    expect(screen.getByText("Local bonus resource")).toBeTruthy();
    expect(screen.getByText(/Manufacturing from/)).toBeTruthy();
    expect(screen.getByText("Market purchase")).toBeTruthy();
    expect(screen.getByText("Sale to local market")).toBeTruthy();
  });

  it("toggles deal-calculation details when a deal row is clicked", () => {
    render(<ProductionOverview burgId={5} onClose={() => {}} />);

    expect(screen.queryByText("Deal calculation:")).toBeNull();

    const sellRow = screen.getByText("Sale to local market").closest("tr") as HTMLTableRowElement;
    fireEvent.click(sellRow);
    // Sale details: units 3 × price 5 - tax 1 = 14 income.
    expect(screen.getByText("Deal calculation:")).toBeTruthy();
    expect(screen.getByText(/unit 3 × sell price 5 - sales tax 1/)).toBeTruthy();

    fireEvent.click(sellRow);
    expect(screen.queryByText("Deal calculation:")).toBeNull();
  });

  it("toggles decision details when a manufacturing row with candidates is clicked", () => {
    render(<ProductionOverview burgId={5} onClose={() => {}} />);

    expect(screen.queryByText("Decision basis:")).toBeNull();

    const mfgRow = screen.getByText(/Manufacturing from/).closest("tr") as HTMLTableRowElement;
    fireEvent.click(mfgRow);
    expect(screen.getByText("Decision basis:")).toBeTruthy();
    expect(screen.getByText(/highest score among 1 feasible options/)).toBeTruthy();

    fireEvent.click(mfgRow);
    expect(screen.queryByText("Decision basis:")).toBeNull();
  });

  it("re-reads the world when notifyWorldChanged fires", () => {
    render(<ProductionOverview burgId={5} onClose={() => {}} />);
    expect(screen.getByText("10")).toBeTruthy();

    const burgs = (globalScope.pack as { burgs: Array<{ population?: number }> }).burgs;
    burgs[5].population = 30;
    act(() => notifyWorldChanged());

    expect(screen.getByText("30")).toBeTruthy();
  });

  it("shows a fallback when the burg does not exist or was removed", () => {
    const view = render(<ProductionOverview burgId={99} onClose={() => {}} />);
    expect(screen.getByText("This burg is no longer available.")).toBeTruthy();
    view.unmount();

    render(<ProductionOverview burgId={7} onClose={() => {}} />);
    expect(screen.getByText("This burg is no longer available.")).toBeTruthy();
  });

  it("shows a fallback when the burg has no production data", () => {
    render(<ProductionOverview burgId={6} onClose={() => {}} />);
    expect(screen.getByText("No production data for this burg.")).toBeTruthy();
  });
});
