import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 5 parity check: the Markers Overview is a React surface reached
// through the REAL seam every legacy caller uses — the bare `overviewMarkers()`
// global (tools.js menu button, hotkeys.js Shift+K), which now lazy-loads the
// typed controller seam. The legacy `#markersOverview` jQuery-UI dialog and its
// static index.html markup are gone.
test.describe("Markers Overview parity (React surface)", () => {
  test("opens via the overviewMarkers() global, filters, and toggles a pin", async ({context, page}) => {
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
      dialog: document.getElementById("markersOverview") !== null,
      body: document.getElementById("markersBody") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.body).toBe(false);

    // Trigger the surface exactly as the tools menu button / Shift+K hotkey do.
    await page.evaluate(() => (window as any).overviewMarkers());

    // The React Panel opened with one row per marker.
    const dialog = page.getByRole("dialog", {name: "Markers Overview"});
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".table > .states");
    const packMarkerCount = await page.evaluate(() => (window as any).pack.markers.length);
    expect(packMarkerCount).toBeGreaterThan(0);
    await expect(rows).toHaveCount(packMarkerCount);
    const initialRowCount = packMarkerCount;

    // The type search filters the table: the first row's own type matches at
    // least that row, and a nonsense term matches nothing.
    const firstType = await rows.first().getAttribute("data-type");
    expect(firstType).toBeTruthy();
    const searchInput = dialog.getByRole("searchbox");
    await searchInput.fill(String(firstType));
    const filteredRowCount = await rows.count();
    expect(filteredRowCount).toBeGreaterThan(0);
    expect(filteredRowCount).toBeLessThanOrEqual(initialRowCount);
    await searchInput.fill("zzzz-no-such-marker");
    await expect(rows).toHaveCount(0);
    await searchInput.fill("");
    await expect(rows).toHaveCount(initialRowCount);

    // A row action: pinning the first row's marker sets the flag in the pack
    // and marks the #markers group as pinned; unpinning clears both.
    const firstRow = rows.first();
    const firstMarkerId = Number(await firstRow.getAttribute("data-i"));
    await firstRow.locator('[aria-label="Pin marker"]').click();
    const pinnedState = await page.evaluate(
      id => ({
        flag: (window as any).pack.markers.find((marker: any) => marker.i === id)?.pinned,
        group: document.getElementById("markers")?.getAttribute("pinned")
      }),
      firstMarkerId
    );
    expect(pinnedState.flag).toBe(true);
    expect(pinnedState.group).toBe("1");
    // Unpin again so the surface leaves the world as it found it.
    await rows.first().locator('[aria-label="Unpin marker"]').click();
    const unpinnedState = await page.evaluate(
      id => ({
        flag: (window as any).pack.markers.find((marker: any) => marker.i === id)?.pinned,
        group: document.getElementById("markers")?.hasAttribute("pinned")
      }),
      firstMarkerId
    );
    expect(unpinnedState.flag).toBeUndefined();
    expect(unpinnedState.group).toBe(false);

    // The add-marker type selector is populated from the domain config.
    await dialog.getByRole("button", {name: "Select marker type for newly added markers"}).click();
    const typeMenu = page.locator("#markerTypeSelectMenu");
    await expect(typeMenu).toHaveClass(/visible/);
    const optionCount = await typeMenu.locator("button").count();
    expect(optionCount).toBeGreaterThan(1); // the ❓ empty option plus the config types

    // No legacy rendering was created by opening.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("markersOverview") !== null,
      body: document.getElementById("markersBody") !== null
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
