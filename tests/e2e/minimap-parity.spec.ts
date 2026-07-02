import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Phase 3 Slice 2 parity check: the Minimap is a React surface reached through the
// real trigger seam the tools menu uses (`lazy.minimap().then(m => m.openMinimapDialog())`).
// The legacy jQuery-UI dialog (`#minimap` / `#minimapContent`) and its injected
// `#minimapStyles` stylesheet are gone; the `window.updateMinimap` hook the zoom
// handler calls now belongs to the mounted surface.
test.describe("Minimap parity (React surface)", () => {
  test("opens via the real seam, mirrors the map, tracks zoom, and pans on click", async ({context, page}) => {
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
      dialog: document.getElementById("minimap") !== null,
      content: document.getElementById("minimapContent") !== null,
      hook: typeof (window as any).updateMinimap
    }));
    expect(legacyBeforeOpen.dialog).toBe(false);
    expect(legacyBeforeOpen.content).toBe(false);
    expect(legacyBeforeOpen.hook).toBe("undefined");

    // Trigger the surface exactly as the tools menu's Minimap button does.
    await page.evaluate(() => (window as any).lazy.minimap().then((m: any) => m.openMinimapDialog()));

    // The React Panel opened with the map mirror and the viewport rect.
    const dialog = page.getByRole("dialog", {name: "Minimap"});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#minimapMapUse[href="#viewbox"]')).toBeAttached();
    const viewport = dialog.locator("#minimapViewport");
    await expect(viewport).toBeAttached();

    // At full zoom-out the viewport rect covers the whole world.
    const initialRect = await viewport.evaluate(rect => ({
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height"))
    }));
    expect(initialRect.width).toBeGreaterThan(0);
    expect(initialRect.height).toBeGreaterThan(0);

    // No legacy rendering was created by opening: no #minimap dialog element, no
    // injected #minimapStyles stylesheet; the hook is now the surface's.
    const legacyAfterOpen = await page.evaluate(() => ({
      dialog: document.getElementById("minimap") !== null,
      styles: document.getElementById("minimapStyles") !== null,
      hook: typeof (window as any).updateMinimap
    }));
    expect(legacyAfterOpen.dialog).toBe(false);
    expect(legacyAfterOpen.styles).toBe(false);
    expect(legacyAfterOpen.hook).toBe("function");

    // Zooming the main map drives the hook: the viewport rect shrinks. Poll rather
    // than sleep — under full-suite load the zoom handler can land late.
    await page.evaluate(() => (window as any).zoomTo(graphWidth / 2, graphHeight / 2, 4, 0));
    await expect
      .poll(async () => {
        const rect = await viewport.evaluate(el => ({
          width: Number(el.getAttribute("width")),
          height: Number(el.getAttribute("height"))
        }));
        return rect.width < initialRect.width && rect.height < initialRect.height;
      })
      .toBe(true);

    // Clicking the minimap pans the main view to the clicked point (scale kept).
    // viewX/viewY/scale are top-level `let` bindings in main.js (not window
    // properties), so they are read as bare identifiers.
    const viewBefore = await page.evaluate(() => ({x: viewX, y: viewY}));
    const surfaceBox = await dialog.locator("#minimapSurface").boundingBox();
    expect(surfaceBox).toBeTruthy();
    if (surfaceBox) {
      await page.mouse.click(surfaceBox.x + surfaceBox.width * 0.25, surfaceBox.y + surfaceBox.height * 0.25);
    }
    // The pan is a 450ms zoomTo animation and d3's zoom interpolator may dip the
    // scale mid-flight; poll until the view has moved AND the scale has settled
    // back, instead of sleeping a fixed interval.
    await expect
      .poll(async () => {
        const view = await page.evaluate(() => ({x: viewX, y: viewY, scale}));
        const moved = view.x !== viewBefore.x || view.y !== viewBefore.y;
        return moved && Math.abs(view.scale - 4) < 0.05;
      })
      .toBe(true);

    // Closing the panel releases the hook (main.js guards for its absence).
    await dialog.getByRole("button", {name: "Close"}).click();
    await expect(dialog).not.toBeVisible();
    const hookAfterClose = await page.evaluate(() => typeof (window as any).updateMinimap);
    expect(hookAfterClose).toBe("undefined");

    // No critical console/page errors during the whole flow.
    expect(errors.critical()).toEqual([]);
  });
});
