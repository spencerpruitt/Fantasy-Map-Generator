import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 8 parity check: the Heightmap Selection is a React surface
// reached through the REAL seam its caller uses — `open()` on the lazily-loaded
// controller (the options pane's heightmap row calls exactly this). The legacy
// `#heightmapSelection` jQuery-UI dialog (which injected its own markup and
// stylesheet at import time) is gone. The template thumbnails render through the
// real HeightmapGenerator + drawHeights pipeline on the loaded demo.map's grid,
// so painted `data:` images prove the whole preview path. Select is exercised
// for real (it only applies `#templateInput` + locks the option — it does not
// regenerate the world); New Map is asserted present but NOT clicked, because
// `regeneratePrompt` regenerates immediately when the map is under a minute old.
test.describe("Heightmap Selection parity (React surface)", () => {
  // Painting a preview runs the full heightmap pipeline on the demo map's grid,
  // and the precreated set (23 heightmaps) paints serially — give the whole
  // flow room beyond the 30s default.
  test.setTimeout(180000);

  test("opens via the open() seam, paints thumbnails, selects, cancels, and applies", async ({context, page}) => {
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

    // The legacy dialog markup does not exist before the surface ever opens
    // (the legacy module injected it at import time).
    expect(await page.evaluate(() => document.getElementById("heightmapSelection") !== null)).toBe(false);

    const appliedTemplateBefore = await page.evaluate(
      () => (document.getElementById("templateInput") as HTMLSelectElement).value
    );

    // Trigger the surface exactly as the options pane's heightmap row does.
    await page.evaluate(() => (window as any).lazy.heightmapSelection().then((m: any) => m.open()));

    const dialog = page.getByRole("dialog", {name: "Select Heightmap"});
    await expect(dialog).toBeVisible();

    // One thumbnail per configured template and per precreated heightmap. The
    // config objects are top-level `const`s of classic scripts — global lexical
    // bindings, not window properties — so they are reached via indirect eval.
    const configCounts = await page.evaluate(() => ({
      templates: Object.keys((0, eval)("heightmapTemplates")).length,
      precreated: Object.keys((0, eval)("precreatedHeightmaps")).length
    }));
    expect(configCounts.templates).toBeGreaterThan(0);
    expect(configCounts.precreated).toBeGreaterThan(0);
    const articles = dialog.locator("article");
    await expect(articles).toHaveCount(configCounts.templates + configCounts.precreated);

    // Thumbnails end up painted with real data URLs: every template renders
    // synchronously through the heightmap pipeline; the precreated ones load
    // their PNGs and paint serially, so assert the pipeline is populating them
    // (several painted) rather than waiting out all 23.
    const templateSection = dialog.locator("section").first();
    const precreatedSection = dialog.locator("section").nth(1);
    await expect
      .poll(() => templateSection.locator('article > img[src^="data:image"]').count(), {timeout: 60000})
      .toBe(configCounts.templates);
    await expect
      .poll(() => precreatedSection.locator('article > img[src^="data:image"]').count(), {timeout: 60000})
      .toBeGreaterThanOrEqual(Math.min(3, configCounts.precreated));

    // The applied template comes pre-selected; clicking another moves the highlight.
    await expect(dialog.locator(`article[data-id="${appliedTemplateBefore}"]`)).toHaveClass(/selected/);
    const otherTemplateId = await page.evaluate(
      applied => Object.keys((0, eval)("heightmapTemplates")).find((id: string) => id !== applied),
      appliedTemplateBefore
    );
    await dialog.locator(`article[data-id="${otherTemplateId}"]`).click();
    await expect(dialog.locator(`article[data-id="${otherTemplateId}"]`)).toHaveClass(/selected/);
    await expect(dialog.locator("article.selected")).toHaveCount(1);

    // The render-ocean option repaints the thumbnails (the first template's
    // image changes once ocean heights are drawn; templates repaint synchronously).
    const firstTemplateImage = templateSection.locator("article > img").first();
    const imageBeforeOceanToggle = await firstTemplateImage.getAttribute("src");
    // The raw checkbox input is CSS-hidden (the global .checkbox pattern styles
    // the label), so toggle through its label like a user does.
    await dialog.locator('label[for="heightmapSelectionRenderOcean"]').click();
    await expect(dialog.locator("#heightmapSelectionRenderOcean")).toBeChecked();
    await expect.poll(() => firstTemplateImage.getAttribute("src"), {timeout: 60000}).not.toBe(imageBeforeOceanToggle);

    // Cancel closes without applying: the options pane keeps its template.
    await dialog.getByRole("button", {name: "Cancel"}).click();
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => (document.getElementById("templateInput") as HTMLSelectElement).value)).toBe(
      appliedTemplateBefore
    );

    // Reopen through the same seam: the panel comes back (previews cached).
    await page.evaluate(() => (window as any).lazy.heightmapSelection().then((m: any) => m.open()));
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(`article[data-id="${appliedTemplateBefore}"]`)).toHaveClass(/selected/);

    // New Map exists and is enabled (wired to the regeneration flow), but is NOT
    // clicked — with a freshly loaded map, regeneratePrompt regenerates the
    // world immediately, with no cancellable confirmation.
    await expect(dialog.getByRole("button", {name: "New Map"})).toBeEnabled();

    // Select applies the chosen heightmap for future generation and locks the
    // option — the unchanged legacy callbacks — then closes. This never
    // regenerates the world.
    await dialog.locator(`article[data-id="${otherTemplateId}"]`).click();
    await dialog.getByRole("button", {name: "Select"}).click();
    await expect(dialog).not.toBeVisible();
    const appliedAfterSelect = await page.evaluate(() => ({
      template: (document.getElementById("templateInput") as HTMLSelectElement).value,
      locked: document.getElementById("lock_template")?.getAttribute("data-locked")
    }));
    expect(appliedAfterSelect.template).toBe(otherTemplateId);
    expect(appliedAfterSelect.locked).toBe("1");

    // No legacy rendering was created by opening.
    expect(await page.evaluate(() => document.getElementById("heightmapSelection") !== null)).toBe(false);

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
