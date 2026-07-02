import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 3 parity check: the Routes Overview is a React surface reached
// through the REAL seam every legacy caller uses — the bare `overviewRoutes()`
// global (tools.js menu button, hotkeys.js Shift+U), which now lazy-loads the
// typed controller seam. The legacy `#routesOverview` jQuery-UI dialog and its
// static index.html markup are gone.
test.describe("Routes Overview parity (React surface)", () => {
  test("opens via the overviewRoutes() global, filters, and toggles a lock", async ({context, page}) => {
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
      dialog: document.getElementById("routesOverview") !== null,
      body: document.getElementById("routesBody") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.body).toBe(false);

    // Trigger the surface exactly as the tools menu button / Shift+U hotkey do.
    await page.evaluate(() => (window as any).overviewRoutes());

    // The React Panel opened with one row per route.
    const dialog = page.getByRole("dialog", {name: "Routes Overview"});
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".table > .states");
    const initialRowCount = await rows.count();
    expect(initialRowCount).toBeGreaterThan(0);

    // The search filter narrows the table (every generated map has road and
    // sea routes, so filtering to the searoutes group drops the road rows).
    const searchInput = dialog.getByRole("searchbox");
    await searchInput.fill("searoutes");
    const filteredRowCount = await rows.count();
    expect(filteredRowCount).toBeGreaterThan(0);
    expect(filteredRowCount).toBeLessThan(initialRowCount);
    await searchInput.fill("");
    await expect(rows).toHaveCount(initialRowCount);

    // A row action: toggling the first row's lock flips the icon and the
    // route's lock flag in the pack.
    const firstRow = rows.first();
    const firstRouteId = Number(await firstRow.getAttribute("data-id"));
    const lockIcon = firstRow.locator(".locks");
    await expect(lockIcon).toHaveClass(/icon-lock-open/);
    await lockIcon.click();
    await expect(rows.first().locator(".locks")).toHaveClass(/icon-lock(?!-open)/);
    const lockedInPack = await page.evaluate(
      id => (window as any).pack.routes.find((route: any) => route.i === id)?.lock,
      firstRouteId
    );
    expect(lockedInPack).toBe(true);
    // Unlock again so the surface leaves the world as it found it.
    await rows.first().locator(".locks").click();
    await expect(rows.first().locator(".locks")).toHaveClass(/icon-lock-open/);

    // No legacy rendering was created by opening.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("routesOverview") !== null,
      body: document.getElementById("routesBody") !== null
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
