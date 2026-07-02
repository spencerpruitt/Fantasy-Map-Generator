import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 9 parity check: the Elevation Profile is a React surface (the
// first d3-chart-in-dialog conversion) reached through the REAL seam its callers
// use — `open(cells, routeLen, isRiver)` on the lazily-loaded controller, with
// the exact arguments the route and river editors compute from pack data. The
// legacy `#elevationProfile` jQuery-UI dialog and its static index.html markup
// are gone. demo.map ships with routes and rivers, so the d3 chart (land curve,
// axes, biome band), the curve-type selector, and both caller paths are
// exercised against real data.
test.describe("Elevation Profile parity (React surface)", () => {
  test("opens via the open(cells, routeLen, isRiver) seam for a route and a river, switches curves", async ({
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

    // Arm a deterministic load signal BEFORE picking the file (see
    // regiments-overview-parity.spec.ts for why this cannot race the initial
    // random generation).
    const demoMapSeed = "135111970";
    await page.evaluate(seedToAwait => {
      (window as any).__demoMapLoaded = false;
      window.addEventListener("map:generated", event => {
        if (String((event as CustomEvent).detail?.seed) === seedToAwait) (window as any).__demoMapLoaded = true;
      });
    }, demoMapSeed);

    const fileInput = page.locator("#mapToLoad");
    const mapFilePath = path.join(__dirname, "../fixtures/demo.map");
    await fileInput.setInputFiles(mapFilePath);

    await page.waitForFunction(() => (window as any).__demoMapLoaded === true, {timeout: 120000});

    // The legacy static markup is gone before the surface ever opens.
    const legacyBeforeOpen = await page.evaluate(() => ({
      dialog: document.getElementById("elevationProfile") !== null,
      graph: document.getElementById("elevationGraph") !== null,
      curve: document.getElementById("epCurve") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.graph).toBe(false);
    expect(legacyBeforeOpen.curve).toBe(false);

    // Trigger the surface exactly as the route editor's elevation-profile button
    // does: the route's point cells and its scaled length through the lazy seam.
    const routeCellCount = await page.evaluate(() => {
      const route = (window as any).pack.routes.find((r: any) => r?.points?.length > 5);
      const cells = route.points.map((p: any) => p[2]);
      const length = Math.round((route.length ?? 100) * (window as any).distanceScale);
      return (window as any).lazy
        .elevationProfile()
        .then((m: any) => m.open(cells, length, false))
        .then(() => cells.length);
    });
    expect(routeCellCount).toBeGreaterThan(5);

    // The React Panel opened with a rendered d3 profile: land fill, outline
    // path, axes, and one biome tile per cell.
    const dialog = page.getByRole("dialog", {name: "Elevation profile"});
    await expect(dialog).toBeVisible();
    const profilePath = dialog.locator("#epline path");
    await expect(profilePath).toHaveAttribute("d", /.+/);
    await expect(dialog.locator("#epland path")).toHaveAttribute("d", /.+/);
    await expect(dialog.locator("#epxaxis")).toBeAttached();
    await expect(dialog.locator("#epyaxis")).toBeAttached();
    await expect(dialog.locator("#epbiomes rect")).toHaveCount(routeCellCount);
    await expect(dialog.locator("#epstats")).toContainText("Elev:");

    // Switching the curve type re-renders the profile path.
    const monotonePathData = await profilePath.getAttribute("d");
    await dialog.locator("#epCurve").selectOption({label: "Linear"});
    await expect(profilePath).not.toHaveAttribute("d", monotonePathData as string);
    await dialog.locator("#epCurve").selectOption({label: "Monotone X"});

    // The river editor's caller path: re-open the surface with a river's cells
    // and isRiver=true (the registry replaces the open surface's props).
    const riverCellCount = await page.evaluate(() => {
      const river = (window as any).pack.rivers.find((r: any) => r?.cells?.length > 5);
      const length = Math.round(river.length * (window as any).distanceScale);
      return (window as any).lazy
        .elevationProfile()
        .then((m: any) => m.open(river.cells, length, true))
        .then(() => river.cells.length);
    });
    expect(riverCellCount).toBeGreaterThan(5);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#epline path")).toHaveAttribute("d", /.+/);
    await expect(dialog.locator("#epbiomes rect")).toHaveCount(riverCellCount);

    // No legacy rendering was created by opening.
    expect(await page.evaluate(() => document.getElementById("elevationProfile") !== null)).toBe(false);

    // The panel closes cleanly (and the live-refresh probe target goes with it).
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.getElementById("elevationGraph") !== null)).toBe(false);

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
