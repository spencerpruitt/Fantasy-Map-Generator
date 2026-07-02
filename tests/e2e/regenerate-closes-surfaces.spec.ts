import path from "path";
import {expect, test} from "@playwright/test";
import {collectConsoleErrors} from "./helpers/console-errors";

// Regression: regenerateMap (public/main.js) only called the legacy jQuery
// closeDialogs(), so an open React surface survived regeneration and its row
// actions could mutate wrong entities in the NEW world. The regenerate path
// must close React surfaces the same way the .map load path does
// (src/io/load.ts -> closeAllSurfaces).
test.describe("regenerate closes React surfaces", () => {
  test("regenerating the map closes an open React overview panel", async ({context, page}) => {
    await context.clearCookies();

    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.waitForSelector("#mapToLoad", {state: "attached"});

    // Arm a deterministic load signal BEFORE picking the file (the same
    // map:generated wait pattern as regiments-overview-parity.spec.ts): the
    // load path dispatches it with the demo seed at the very END of loading.
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

    // Open a React overview surface on the loaded world.
    await page.evaluate(() => (window as any).overviewRivers());
    const dialog = page.getByRole("dialog", {name: "Rivers Overview"});
    await expect(dialog).toBeVisible();

    // Arm a deterministic regenerate signal, then trigger the app's own
    // regenerate entry point. regeneratePrompt() regenerates immediately (no
    // confirmation dialog) while the map is under a minute old — and the demo
    // map was JUST loaded, so this is the direct New Map button path.
    await page.evaluate(() => {
      (window as any).__regenerated = false;
      window.addEventListener("map:generated", () => ((window as any).__regenerated = true), {once: true});
      (window as any).regeneratePrompt();
    });
    await page.waitForFunction(() => (window as any).__regenerated === true, {timeout: 180000});

    // The React panel from the previous world is gone.
    await expect(dialog).toHaveCount(0);

    // No critical console/page errors during load + regenerate.
    expect(errors.critical()).toEqual([]);
  });
});
