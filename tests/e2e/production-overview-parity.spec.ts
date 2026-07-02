import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 1 parity check: Production Overview is a React surface reached
// through the real trigger seam both legacy callers use
// (`lazy.productionOverview().then(m => m.open(burgId))`). The legacy version had
// no dialog of its own — it rendered `#productionOverviewContent` into the shared
// `#alert` box — so the "legacy markup is gone" check asserts that content node is
// never created (the `#alert` box itself stays; other legacy surfaces still use it).
test.describe("Production Overview parity (React surface)", () => {
  test("opens the React surface via the real trigger seam; legacy rendering is gone", async ({context, page}) => {
    await context.clearCookies();

    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.waitForSelector("#mapToLoad", {state: "attached"});

    // Load the demo map exactly as load-map.spec does.
    const fileInput = page.locator("#mapToLoad");
    const mapFilePath = path.join(__dirname, "../fixtures/demo.map");
    await fileInput.setInputFiles(mapFilePath);

    await page.waitForFunction(() => (window as any).mapId !== undefined, {timeout: 120000});
    await page.waitForTimeout(500);

    // Pick a real burg with production history — preferring one whose history
    // includes a deal, so the expandable-row behavior below is exercised.
    const burgId = await page.evaluate(() => {
      const burgs = (window as any).pack.burgs as any[];
      const withProduction = burgs.filter(
        burg => burg && burg.i && !burg.removed && Array.isArray(burg.production) && burg.production.length > 0
      );
      const withDeal = withProduction.find(burg => burg.production.some((record: any) => "dealId" in record));
      return (withDeal ?? withProduction[0])?.i;
    });
    expect(burgId).toBeTruthy();

    // Trigger the surface exactly as the burg editor / goods-burgs click does.
    await page.evaluate(id => (window as any).lazy.productionOverview().then((m: any) => m.open(id)), burgId);

    // The React Panel opened: a dialog titled "Production Overview: …" is visible.
    const dialog = page.getByRole("dialog", {name: /^Production Overview: /});
    await expect(dialog).toBeVisible();

    // The legacy rendering path is gone: no #productionOverviewContent was created
    // (the shared #alert box remains for the surfaces that still use it).
    const legacyContentExists = await page.evaluate(() => document.getElementById("productionOverviewContent") !== null);
    expect(legacyContentExists).toBe(false);

    // Stats bar + both sections render with real data.
    await expect(dialog.getByText("Population:")).toBeVisible();
    await expect(dialog.getByText("Initial Demand:")).toBeVisible();
    await expect(dialog.getByText("Manufactured Goods")).toBeVisible();
    await expect(dialog.getByText("Production and Trade history")).toBeVisible();
    const historyRowCount = await dialog.locator("tbody tr").count();
    expect(historyRowCount).toBeGreaterThan(0);

    // An expandable deal row toggles its details open.
    const expandableRow = dialog.locator('tr[data-tip^="Click to expand"]').first();
    await expect(expandableRow).toBeVisible();
    await expandableRow.click();
    await expect(dialog.getByText(/Deal calculation:|Decision basis:/).first()).toBeVisible();

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
