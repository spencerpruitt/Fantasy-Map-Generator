import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 4 parity check: the Rivers Overview is a React surface reached
// through the REAL seam every legacy caller uses — the bare `overviewRivers()`
// global (tools.js menu button, hotkeys.js Shift+V), which now lazy-loads the
// typed controller seam. The legacy `#riversOverview` jQuery-UI dialog and its
// static index.html markup are gone.
test.describe("Rivers Overview parity (React surface)", () => {
  test("opens via the overviewRivers() global, filters, and toggles basin highlight", async ({context, page}) => {
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

    // The legacy static markup is gone before the surface ever opens.
    const legacyBeforeOpen = await page.evaluate(() => ({
      dialog: document.getElementById("riversOverview") !== null,
      body: document.getElementById("riversBody") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.body).toBe(false);

    // Trigger the surface exactly as the tools menu button / Shift+V hotkey do.
    await page.evaluate(() => (window as any).overviewRivers());

    // The React Panel opened with one row per river, each with a resolved
    // basin (main stem) name.
    const dialog = page.getByRole("dialog", {name: "Rivers Overview"});
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".table > .states");
    const initialRowCount = await rows.count();
    expect(initialRowCount).toBeGreaterThan(0);
    const firstBasin = await rows.first().getAttribute("data-basin");
    expect(firstBasin).toBeTruthy();

    // The multi-field search filters the table: the first row's basin name
    // matches at least that row, and a nonsense term matches nothing.
    const searchInput = dialog.getByRole("searchbox");
    await searchInput.fill(String(firstBasin));
    const basinFilteredCount = await rows.count();
    expect(basinFilteredCount).toBeGreaterThan(0);
    expect(basinFilteredCount).toBeLessThanOrEqual(initialRowCount);
    await searchInput.fill("zzzz-no-such-river");
    await expect(rows).toHaveCount(0);
    await searchInput.fill("");
    await expect(rows).toHaveCount(initialRowCount);

    // A footer action: toggling basin highlight tints the rivers layer and
    // marks it with the legacy data attribute (kept with the legacy spelling);
    // toggling again clears it.
    const basinButton = dialog.getByRole("button", {name: "Toggle basin highlight"});
    await basinButton.click();
    const highlighted = await page.evaluate(() => document.getElementById("rivers")?.getAttribute("data-basin"));
    expect(highlighted).toBe("hightlighted");
    await basinButton.click();
    const cleared = await page.evaluate(() => document.getElementById("rivers")?.getAttribute("data-basin"));
    expect(cleared).toBe(null);

    // No legacy rendering was created by opening.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("riversOverview") !== null,
      body: document.getElementById("riversBody") !== null
    }));
    expect(legacyAfterOpen.dialog).toBe(false);
    expect(legacyAfterOpen.body).toBe(false);

    // The panel closes cleanly.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
