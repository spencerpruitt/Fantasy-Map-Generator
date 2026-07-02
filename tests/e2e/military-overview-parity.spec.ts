import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 7 parity check: the Military Overview is a React surface reached
// through the REAL seam its callers use — `MilitaryOverview.open()` on the
// lazily-loaded controller (the menu's overviewMilitary() and the Shift+M hotkey
// call exactly this). The legacy `#militaryOverview` jQuery-UI dialog and its
// static index.html markup are gone (`#militaryOptions`, the still-legacy unit
// editor dialog, remains). demo.map ships with military generated, so the
// per-state table, percentage toggle, row-hover map highlight, and the
// open-regiments-overview action are exercised against real data.
test.describe("Military Overview parity (React surface)", () => {
  test("opens via the open() seam, toggles percentage, hover-highlights, and opens regiments", async ({
    context,
    page
  }) => {
    await context.clearCookies();

    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.waitForSelector("#mapToLoad", {state: "attached"});

    // Arm a deterministic load signal BEFORE picking the file: the load path
    // dispatches `map:generated` with the demo seed at the very END of loading
    // (strictly after its closeAllSurfaces), so waiting on it cannot race the
    // page's initial random generation the way `mapId !== undefined` does —
    // opening a surface mid-load would get closed by the load itself.
    const demoMapSeed = "135111970";
    await page.evaluate(seedToAwait => {
      (window as any).__demoMapLoaded = false;
      window.addEventListener("map:generated", event => {
        if (String((event as CustomEvent).detail?.seed) === seedToAwait) (window as any).__demoMapLoaded = true;
      });
    }, demoMapSeed);

    // Load the demo map exactly as load-map.spec does.
    const fileInput = page.locator("#mapToLoad");
    const mapFilePath = path.join(__dirname, "../fixtures/demo.map");
    await fileInput.setInputFiles(mapFilePath);

    await page.waitForFunction(() => (window as any).__demoMapLoaded === true, {timeout: 120000});

    // The legacy static markup is gone before the surface ever opens. (The
    // #militaryOverview id is reused by the React table while the panel is open,
    // so it must not exist yet; the other legacy ids must never exist.)
    const legacyBeforeOpen = await page.evaluate(() => ({
      dialog: document.getElementById("militaryOverview") !== null,
      body: document.getElementById("militaryBody") !== null,
      header: document.getElementById("militaryHeader") !== null,
      footer: document.getElementById("militaryFooter") !== null,
      bottom: document.getElementById("militaryBottom") !== null
    }));
    expect(legacyBeforeOpen).toEqual({dialog: false, body: false, header: false, footer: false, bottom: false});

    // Trigger the surface exactly as the menu / hotkey do.
    await page.evaluate(() => (window as any).lazy.militaryOverview().then((m: any) => m.MilitaryOverview.open()));

    // The React Panel opened with one row per valid state, and the open seam
    // forced the states/borders/military layers on.
    const dialog = page.getByRole("dialog", {name: "Military Overview"});
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".table > .states");
    const packStateCount = await page.evaluate(
      () => (window as any).pack.states.filter((s: any) => s.i && !s.removed).length
    );
    expect(packStateCount).toBeGreaterThan(0);
    await expect(rows).toHaveCount(packStateCount);
    const layersOn = await page.evaluate(() => ({
      states: (window as any).layerIsOn("toggleStates"),
      borders: (window as any).layerIsOn("toggleBorders"),
      military: (window as any).layerIsOn("toggleMilitary")
    }));
    expect(layersOn).toEqual({states: true, borders: true, military: true});

    // The header grew one sortable column per configured military unit.
    // (`options` is a script-scope global — `window.options` is shadowed by the
    // #options element, so evaluate a bare-identifier expression instead.)
    const unitNames: string[] = await page.evaluate("options.military.map(u => u.name)");
    for (const unitName of unitNames) {
      await expect(dialog.locator(`.header [data-sortby="${unitName}"]`)).toBeVisible();
    }

    // The percentage toggle switches the unit/total cells to column shares.
    const percentageToggle = dialog.getByRole("button", {name: "Toggle percentage / absolute values views"});
    await percentageToggle.click();
    await expect(rows.first().locator('[data-type="total"]')).toHaveText(/%$/);
    await percentageToggle.click();
    await expect(rows.first().locator('[data-type="total"]')).not.toHaveText(/%$/);

    // Hovering a state row highlights its region outline on the map (#debug
    // gets the transient .highlight path); leaving clears it.
    await rows.first().hover();
    await expect(page.locator("#debug path.highlight")).toHaveCount(1);
    await dialog.locator(".totalLine").hover(); // leave the row
    await expect
      .poll(() => page.locator("#debug path.highlight").count(), {timeout: 15000})
      .toBe(0);

    // A row's regiments action mounts the React Regiments Overview surface for
    // that state (the Slice 6 surface, through its real seam).
    const firstRowStateId = Number(await rows.first().getAttribute("data-id"));
    await rows.first().locator('[aria-label="Show regiments list"]').click();
    const regimentsDialog = page.getByRole("dialog", {name: "Regiments Overview"});
    await expect(regimentsDialog).toBeVisible();
    const regimentsFilterValue = await regimentsDialog.getByLabel("Select state").inputValue();
    expect(Number(regimentsFilterValue)).toBe(firstRowStateId);
    await regimentsDialog.getByRole("button", {name: "Close"}).click();
    await expect(regimentsDialog).not.toBeVisible();

    // No legacy rendering was created by opening (the React table reuses the
    // #militaryOverview id for general.js's hover highlight, but the legacy
    // dialog chrome and body/footer ids stay gone).
    const legacyAfterOpen = await page.evaluate(() => ({
      body: document.getElementById("militaryBody") !== null,
      header: document.getElementById("militaryHeader") !== null,
      footer: document.getElementById("militaryFooter") !== null,
      bottom: document.getElementById("militaryBottom") !== null,
      overviewIsLegacyDialog: document.getElementById("militaryOverview")?.classList.contains("stable") ?? false
    }));
    expect(legacyAfterOpen).toEqual({
      body: false,
      header: false,
      footer: false,
      bottom: false,
      overviewIsLegacyDialog: false
    });

    // The panel closes cleanly (and takes the reused id with it).
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();
    const idGoneAfterClose = await page.evaluate(() => document.getElementById("militaryOverview") === null);
    expect(idGoneAfterClose).toBe(true);

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
