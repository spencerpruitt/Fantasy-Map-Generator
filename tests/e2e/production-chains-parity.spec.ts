import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 11 parity check: Production Chains is a React surface (the
// third d3-chart-in-dialog conversion) reached through the REAL caller path —
// the goods editor's chains button, which calls the preserved
// `ProductionChains.open()` static seam. The legacy `#productionChainsDialog`
// jQuery-UI dialog and its static index.html markup are gone. demo.map ships
// with generated goods (manufactured goods with recipes), so the recipe-graph
// cards/edges, the chain-highlight hover with its CSS-driven flow dots, and
// pan/zoom are exercised against real data.
test.describe("Production Chains parity (React surface)", () => {
  test("opens via the goods editor's chains button, renders the graph, highlights a chain on hover, zooms", async ({
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
      dialog: document.getElementById("productionChainsDialog") !== null,
      content: document.getElementById("productionChainsContent") !== null
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.content).toBe(false);

    // The expected graph shape, derived from the map's goods exactly as the
    // layout does: every good with a recipe plus every ingredient it uses is a
    // card; every distinct ingredient→product pair is one edge group.
    const expected = await page.evaluate(() => {
      const goods = (window as any).pack.goods as {i: number; recipes?: Record<number, number>[]}[];
      const chainIds = new Set<number>();
      const edgePairs = new Set<string>();
      for (const good of goods) {
        if (!good.recipes?.length) continue;
        chainIds.add(good.i);
        for (const recipe of good.recipes) {
          for (const ingredientId of Object.keys(recipe)) {
            chainIds.add(+ingredientId);
            edgePairs.add(`${ingredientId}-${good.i}`);
          }
        }
      }
      const manufactured = goods.find(good => good.recipes?.length);
      const firstIngredientId = manufactured ? +Object.keys(manufactured.recipes![0])[0] : 0;
      return {
        cardCount: chainIds.size,
        edgeCount: edgePairs.size,
        hoverGoodId: manufactured?.i ?? 0,
        hoverEdgeFrom: firstIngredientId
      };
    });
    expect(expected.cardCount).toBeGreaterThan(0);
    expect(expected.edgeCount).toBeGreaterThan(0);

    // Open the goods editor (the real, still-legacy caller) and click its
    // chains button — the exact seam that calls ProductionChains.open().
    await page.evaluate(() => (window as any).lazy.goodsEditor().then((m: any) => m.open()));
    await expect(page.locator("#goodsEditor")).toBeVisible();
    await page.locator("#goodsChains").click();

    // The React Panel opened with the d3 graph: one card per chain good, one
    // group per display edge, and the legacy initial zoom transform.
    const dialog = page.getByRole("dialog", {name: "Production Chains"});
    await expect(dialog).toBeVisible();
    const svg = dialog.locator("#chains-svg");
    await expect(svg).toBeVisible();
    await expect(dialog.locator("[data-nid]")).toHaveCount(expected.cardCount);
    await expect(dialog.locator("[data-ef]")).toHaveCount(expected.edgeCount);
    await expect(dialog.locator("#viewport")).toHaveAttribute("transform", "translate(16,0) scale(1)");

    // Hovering a manufactured good's card highlights its production chain: the
    // edge from its first ingredient goes fully opaque and its flow dots run.
    const hoverCard = dialog.locator(`[data-nid="${expected.hoverGoodId}"]`);
    const chainEdge = dialog.locator(`[data-ef="${expected.hoverEdgeFrom}"][data-et="${expected.hoverGoodId}"]`);
    await hoverCard.hover();
    await expect(chainEdge).toHaveCSS("opacity", "1");
    const flowState = await chainEdge.locator("[data-edge-flow]").first().evaluate(el => ({
      playState: (el as SVGPathElement).style.animationPlayState,
      opacity: (el as SVGPathElement).style.opacity
    }));
    expect(flowState.playState).toBe("running");
    expect(Number(flowState.opacity)).toBeGreaterThan(0);

    // Leaving the card restores the resting state (edges back to 0.3, flows paused).
    await dialog.locator(".ui-dialog-title").hover();
    await expect(chainEdge).toHaveCSS("opacity", "0.3");

    // Pan/zoom is live: a wheel over the chart changes the viewport transform.
    await svg.hover();
    await page.mouse.wheel(0, -100);
    await expect(dialog.locator("#viewport")).not.toHaveAttribute("transform", "translate(16,0) scale(1)");
    await expect(dialog.locator("#viewport")).toHaveAttribute("transform", /scale\(/);

    // No legacy rendering was created by opening.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("productionChainsDialog") !== null,
      content: document.getElementById("productionChainsContent") !== null
    }));
    expect(legacyAfterOpen.dialog).toBe(false);
    expect(legacyAfterOpen.content).toBe(false);

    // The (still-legacy) calling editor survived the whole flow. Close it first —
    // legacy jQuery dialogs stack above React panels (Panel defers z-order
    // management), so it cannot intercept the panel's Close button.
    await expect(page.locator("#goodsEditor")).toBeVisible();
    await page.evaluate(() => (window as any).$("#goodsEditor").dialog("close"));

    // The panel closes cleanly.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
