import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 6 parity check: the Regiments Overview is a React surface reached
// through the REAL seam its callers use — `RegimentsOverview.open(state)` on the
// lazily-loaded controller (the military overview's list buttons call exactly
// this). The legacy `#regimentsOverview` jQuery-UI dialog and its static
// index.html markup are gone. demo.map ships with military generated (20 states
// with regiments), so the table, filter, percentage toggle, row edit, and the
// bulk-delete cascade + `#armies` SVG pruning are exercised against real data.
test.describe("Regiments Overview parity (React surface)", () => {
  test("opens via the open(state) seam, filters, toggles percentage, edits, and bulk-deletes", async ({
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

    // The legacy static markup is gone before the surface ever opens.
    const legacyBeforeOpen = await page.evaluate(() => ({
      dialog: document.getElementById("regimentsOverview") !== null,
      body: document.getElementById("regimentsBody") !== null,
      filter: document.getElementById("regimentsFilter") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.body).toBe(false);
    expect(legacyBeforeOpen.filter).toBe(false);

    // Trigger the surface exactly as the military overview's buttons do.
    await page.evaluate(() => (window as any).lazy.regimentsOverview().then((m: any) => m.RegimentsOverview.open(-1)));

    // The React Panel opened with one row per regiment across all states, and
    // the open seam forced the military layer on (armies are on the map).
    const dialog = page.getByRole("dialog", {name: "Regiments Overview"});
    await expect(dialog).toBeVisible();
    const rows = dialog.locator(".table > .states");
    const packRegimentCount = await page.evaluate(() =>
      (window as any).pack.states
        .filter((s: any) => s.i && !s.removed && s.military?.length)
        .reduce((sum: number, s: any) => sum + s.military.length, 0)
    );
    expect(packRegimentCount).toBeGreaterThan(0);
    await expect(rows).toHaveCount(packRegimentCount);
    const militaryLayerOn = await page.evaluate(() => (window as any).layerIsOn("toggleMilitary"));
    expect(militaryLayerOn).toBe(true);

    // The state filter narrows the table to one state's regiments.
    const filteredState = await page.evaluate(() => {
      const state = (window as any).pack.states.find((s: any) => s.i && !s.removed && s.military?.length);
      return {id: state.i, name: state.name, count: state.military.length};
    });
    const filterSelect = dialog.getByLabel("Select state");
    await filterSelect.selectOption(String(filteredState.id));
    await expect(rows).toHaveCount(filteredState.count);
    await expect(rows.first()).toHaveAttribute("data-state", filteredState.name);

    // The percentage toggle switches the unit/total cells to column shares.
    const percentageToggle = dialog.getByRole("button", {name: "Toggle percentage / absolute values views"});
    await percentageToggle.click();
    await expect(rows.first().locator('[data-type="total"]')).toHaveText(/%$/);
    await percentageToggle.click();
    await expect(rows.first().locator('[data-type="total"]')).toHaveText(/^\d+$/);

    // The row pencil opens the (still-legacy) regiment editor for that regiment.
    await rows.first().locator('[aria-label="Edit regiment"]').click();
    await expect(page.locator("#regimentEditor")).toBeVisible();
    await page.evaluate(() => (window as any).$("#regimentEditor").dialog("close"));
    await expect(page.locator("#regimentEditor")).not.toBeVisible();

    // Bulk delete: select the first (filtered) row and delete it. The cascade
    // splices the regiment from its state and the renderer side-effect removes
    // its #armies group.
    const firstRow = rows.first();
    const target = {
      stateId: Number(await firstRow.getAttribute("data-s")),
      regimentId: Number(await firstRow.getAttribute("data-id"))
    };
    const armyGroupExists = await page.evaluate(
      ({stateId, regimentId}) => document.getElementById(`regiment${stateId}-${regimentId}`) !== null,
      target
    );
    expect(armyGroupExists).toBe(true);

    await dialog.getByRole("button", {name: "Bulk select"}).click();
    await firstRow.locator(".bulkRowCheckbox").check();
    await expect(dialog.locator(".bulkCount")).toHaveText("1 selected");
    await dialog.getByRole("button", {name: "Delete selected rows"}).click();

    // Confirm in the shared jQuery confirmation dialog.
    const confirmButton = page.getByRole("button", {name: "Delete", exact: true});
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    await expect(rows).toHaveCount(filteredState.count - 1);
    await expect
      .poll(() =>
        page.evaluate(
          ({stateId, regimentId}) => ({
            inPack: (window as any).pack.states[stateId].military.some((r: any) => r.i === regimentId),
            inSvg: document.getElementById(`regiment${stateId}-${regimentId}`) !== null
          }),
          target
        )
      )
      .toEqual({inPack: false, inSvg: false});

    // No legacy rendering was created by opening.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("regimentsOverview") !== null,
      body: document.getElementById("regimentsBody") !== null
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
