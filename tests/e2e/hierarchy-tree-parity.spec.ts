import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 10 parity check: the Hierarchy Tree is a React surface (the
// second d3-chart-in-dialog conversion) reached through a REAL caller path —
// the cultures editor's hierarchy button, which lazy-loads the controller and
// calls `open(props)` with pack.cultures and its highlight callbacks. The
// legacy `#hierarchyTree` jQuery-UI dialog (dynamically injected into #dialogs
// at module import) and its injected stylesheet are gone. demo.map ships with
// a full culture set, so the stratified tree, hover (tip + info line), node
// selection, and the origin-selector dialog are exercised against real data.
test.describe("Hierarchy Tree parity (React surface)", () => {
  test("opens via the cultures editor's hierarchy button, hovers, selects, and edits origins", async ({
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

    // The legacy dialog markup (injected at controller import time) is gone.
    const legacyBeforeOpen = await page.evaluate(() =>
      (window as any).lazy.hierarchyTree().then(() => ({
        dialog: document.getElementById("hierarchyTree") !== null,
        viewbox: document.getElementById("hierarchyTree_viewbox") !== null,
        selector: document.getElementById("hierarchyTree_originSelector") !== null
      }))
    );
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.viewbox).toBe(false);
    expect(legacyBeforeOpen.selector).toBe(false);

    // Open the cultures editor (a real, still-legacy caller) and click its
    // hierarchy button — the exact seam the editors use.
    await page.evaluate(() => (window as any).lazy.culturesEditor().then((m: any) => m.open()));
    await expect(page.locator("#culturesEditor")).toBeVisible();
    await page.locator("#culturesHeirarchy").click();

    // The React Panel opened with one node per non-removed culture and the
    // primary link structure of the stratified tree.
    const dialog = page.getByRole("dialog", {name: "Cultures tree"});
    await expect(dialog).toBeVisible();
    const cultureCount = await page.evaluate(
      () => (window as any).pack.cultures.filter((c: any) => !c.removed).length
    );
    expect(cultureCount).toBeGreaterThanOrEqual(3);
    await expect(dialog.locator("#hierarchyTree_nodes > g")).toHaveCount(cultureCount);
    await expect(dialog.locator("#hierarchyTree_linksPrimary > path")).toHaveCount(cultureCount - 1);

    // Hover a leaf node (the bottom-most one, safely inside the viewBox): the
    // shared tip and the info line (the editor's getDescription) both react.
    const hovered = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll("#hierarchyTree_nodes > g"));
      let best: {id: string; y: number} | null = null;
      for (const group of groups) {
        const match = /translate\((-?[\d.]+)[, ]+(-?[\d.]+)\)/.exec(group.getAttribute("transform") ?? "");
        if (!match) continue;
        const y = Number(match[2]);
        if (!best || y > best.y) best = {id: (group as HTMLElement).dataset.id as string, y};
      }
      const culture = (window as any).pack.cultures[Number(best?.id)];
      return {id: best?.id, name: culture.name as string};
    });
    const hoverNode = dialog.locator(`#hierarchyTree_nodes > g[data-id="${hovered.id}"] path`);
    await hoverNode.hover();
    await expect(page.locator("#tooltip")).toContainText("Drag to other node to add parent, click to edit");
    await expect(dialog.locator("#hierarchyTree_infoLine")).toContainText(hovered.name);

    // Click the node: the details bar shows the culture with its abbreviation
    // input and origin buttons.
    await hoverNode.click();
    await expect(dialog.locator("#hierarchyTree_selectedName")).toHaveText(hovered.name);
    await expect(dialog.locator("#hierarchyTree_selectedCode")).toBeVisible();

    // The origin-selector sub-dialog opens as a React panel and cancels cleanly.
    await dialog.getByRole("button", {name: "Edit"}).click();
    const selectorDialog = page.getByRole("dialog", {name: "Select origins"});
    await expect(selectorDialog).toBeVisible();
    await expect(selectorDialog.locator("form > div").first()).toBeVisible();
    await selectorDialog.getByRole("button", {name: "Cancel"}).click();
    await expect(selectorDialog).not.toBeVisible();

    // Pan/zoom is live: a wheel over the chart transforms the viewbox.
    await dialog.locator("svg").first().hover();
    await page.mouse.wheel(0, -100);
    await expect(dialog.locator("#hierarchyTree_viewbox")).toHaveAttribute("transform", /scale\(/);

    // No legacy rendering was created by opening.
    expect(await page.evaluate(() => document.getElementById("hierarchyTree") !== null)).toBe(false);

    // The (still-legacy) calling editor survived the whole flow. Close it first —
    // legacy jQuery dialogs stack above React panels (Panel defers z-order
    // management), so it would otherwise intercept the panel's Close button.
    await expect(page.locator("#culturesEditor")).toBeVisible();
    await page.evaluate(() => (window as any).$("#culturesEditor").dialog("close"));

    // The panel closes cleanly.
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();

    // The seam still rejects a too-small hierarchy with the legacy tip.
    await page.evaluate(() =>
      (window as any).lazy.hierarchyTree().then((m: any) =>
        m.open({
          type: "cultures",
          data: [
            {i: 0, name: "Root", origins: []},
            {i: 1, name: "Only", origins: [0]}
          ],
          onNodeEnter: () => {},
          onNodeLeave: () => {},
          getDescription: () => "",
          getShape: () => undefined
        })
      )
    );
    await expect(page.locator("#tooltip")).toContainText("Not enough cultures to show hierarchy");
    await expect(dialog).not.toBeVisible();

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
