import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 12 parity check: Data Charts is a React surface (the fourth and
// last d3-chart-in-dialog conversion) reached through the REAL caller path —
// `window.lazy.chartsOverview().then(m => m.open())`, the exact seam the tools
// menu button and the Shift+A hotkey call. The legacy `#chartsOverview`
// jQuery-UI dialog (and the stylesheet/markup the legacy controller injected)
// is gone. demo.map ships with states/cultures/population data, so the default
// chart (States by Total population grouped by Culture) renders real stacked
// bars, and plotting with switched dimension/metric selectors is exercised
// against real data.
test.describe("Charts Overview parity (React surface)", () => {
  test("opens via the open() seam, renders the default chart, plots a switched dimension/metric chart", async ({
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

    // The legacy dialog markup is gone before the surface ever opens.
    expect(await page.evaluate(() => document.getElementById("chartsOverview") !== null)).toBe(false);

    // Open through the real trigger seam.
    await page.evaluate(() => (window as any).lazy.chartsOverview().then((m: any) => m.open()));

    // The React Panel opened with the default chart plotted.
    const dialog = page.getByRole("dialog", {name: "Data Charts"});
    await expect(dialog).toBeVisible();
    const firstFigure = dialog.locator("figure").first();
    await expect(firstFigure).toContainText("Figure 1");
    await expect(firstFigure).toContainText("States by Total population grouped by Culture");

    // Real stacked bars rendered (bar rects carry a native <title> tooltip;
    // legend swatches do not), and the legend/axis groups exist.
    const firstFigureBars = firstFigure.locator("svg rect > title");
    expect(await firstFigureBars.count()).toBeGreaterThan(0);
    const firstBarTooltip = await firstFigureBars.first().textContent();
    expect(firstBarTooltip).toContain("State: ");
    expect(firstBarTooltip).toContain("Total population: ");

    // Switch the dimension AND the metric, then Plot: a second figure appears
    // with the switched aggregation.
    await dialog.getByLabel("Select entity (y axis)").selectOption("cultures");
    await dialog.getByLabel("Select metric to plot (x axis)").selectOption("cells");
    await dialog.getByRole("button", {name: "Plot"}).click();

    const secondFigure = dialog.locator("figure").nth(1);
    await expect(secondFigure).toContainText("Figure 2");
    // groupBy (cultures) equals the entity → no grouping suffix.
    await expect(secondFigure).toContainText("Cultures by Cells");
    expect(await secondFigure.locator("svg rect > title").count()).toBeGreaterThan(0);
    const secondBarTooltip = await secondFigure.locator("svg rect > title").first().textContent();
    expect(secondBarTooltip).toContain("Culture: ");
    expect(secondBarTooltip).toContain("Cells: ");

    // No legacy rendering was created by opening or plotting.
    expect(await page.evaluate(() => document.getElementById("chartsOverview") !== null)).toBe(false);

    // The panel closes cleanly.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
