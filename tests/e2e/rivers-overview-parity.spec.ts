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

    // No legacy rendering was created by opening: the #riversOverview id is
    // reused by the React table (for general.js's hover highlight, like
    // MilitaryOverview), but the legacy dialog body does not exist.
    const legacyAfterOpen = await page.evaluate(() => ({
      isReactTable: document.getElementById("riversOverview")?.classList.contains("table") ?? false,
      body: document.getElementById("riversBody") !== null
    }));
    expect(legacyAfterOpen.isReactTable).toBe(true);
    expect(legacyAfterOpen.body).toBe(false);

    // The panel closes cleanly, and the reused id unmounts with it.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();
    const idGoneAfterClose = await page.evaluate(() => document.getElementById("riversOverview") === null);
    expect(idGoneAfterClose).toBe(true);

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });

  test("map hover over a river never throws and highlights the open overview's row", async ({context, page}) => {
    await context.clearCookies();

    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.waitForSelector("#mapToLoad", {state: "attached"});

    const fileInput = page.locator("#mapToLoad");
    const mapFilePath = path.join(__dirname, "../fixtures/demo.map");
    await fileInput.setInputFiles(mapFilePath);

    await page.waitForFunction(() => (window as any).mapId !== undefined, {timeout: 120000});
    await page.waitForTimeout(500);

    // A synthetic mousemove over a river path's midpoint, bubbling to the
    // viewbox exactly like a real hover (general.js's handler is debounced
    // leading-edge with a 100ms cooldown, so callers poll until it runs).
    const hoverRiver = () =>
      page.evaluate(() => {
        const riverPath = document.querySelector("#rivers > path") as SVGGeometryElement | null;
        if (!riverPath) return null;
        const midpoint = riverPath.getPointAtLength(riverPath.getTotalLength() / 2);
        const ctm = riverPath.getScreenCTM();
        if (!ctm) return null;
        const clientX = ctm.a * midpoint.x + ctm.c * midpoint.y + ctm.e;
        const clientY = ctm.b * midpoint.x + ctm.d * midpoint.y + ctm.f;
        riverPath.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX, clientY}));
        return +riverPath.id.slice(5);
      });

    // Panel CLOSED: hovering a river must set the map tooltip without throwing
    // (the regression: general.js read the bare `riversOverview` global, which
    // is a ReferenceError on every river mousemove once the static markup is gone).
    await expect
      .poll(
        async () => {
          await hoverRiver();
          return page.evaluate(() => document.getElementById("tooltip")?.innerHTML ?? "");
        },
        {timeout: 15000}
      )
      .toContain("Click to edit");

    // Panel OPEN: the same hover highlights the corresponding overview row
    // (general.js probes #riversOverview and adds .hovered to the div[data-id]).
    await page.evaluate(() => (window as any).overviewRivers());
    const dialog = page.getByRole("dialog", {name: "Rivers Overview"});
    await expect(dialog).toBeVisible();

    const riverId = await hoverRiver();
    expect(riverId).not.toBeNull();
    const row = dialog.locator(`.table > .states[data-id="${riverId}"]`);
    await expect(row).toBeAttached();
    await expect
      .poll(
        async () => {
          await hoverRiver();
          return row.evaluate(el => el.classList.contains("hovered"));
        },
        {timeout: 15000}
      )
      .toBe(true);

    // Panel CLOSED again (the guarded read must no-op once the id unmounts):
    // clear the tooltip and prove the hover handler still completes cleanly.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();
    await page.evaluate(() => {
      const tooltip = document.getElementById("tooltip");
      if (tooltip) tooltip.innerHTML = "";
    });
    await expect
      .poll(
        async () => {
          await hoverRiver();
          return page.evaluate(() => document.getElementById("tooltip")?.innerHTML ?? "");
        },
        {timeout: 15000}
      )
      .toContain("Click to edit");

    // No critical console/page errors across every hover.
    expect(errors.critical()).toEqual([]);
  });
});
