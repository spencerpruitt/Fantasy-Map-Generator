import { useEffect, useReducer, useState } from "react";
import type { GridGraph } from "@/types/GridGraph";
import { drawHeights, generateGrid, generateSeed, shouldRegenerateGrid } from "@/utils";
import { Panel } from "../Panel";
import { getGridGraph, getWorldSeed } from "../world-state";

interface HeightmapSelectionProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  /** The template id currently applied in the options pane (`#templateInput`), pre-selected on open. */
  initialSelection?: string;
  onClose: () => void;
}

// A preview grid stripped of heights so each template renders onto clean
// geometry (the legacy `delete newGraph.cells.h`).
type PreviewGraph = Omit<GridGraph, "cells"> & { cells: Omit<GridGraph["cells"], "h"> & { h?: unknown } };

/**
 * Module-level preview state, persisted across open/close cycles exactly like
 * the legacy dialog's DOM did: the session's initial preview seed, each
 * template's (possibly regenerated) preview seed, the painted preview images,
 * the cloned preview graph, and the two option controls. Previews are painted
 * once per session and only repainted on the explicit legacy triggers (option
 * change, Redraw preview, the per-template regenerate icon) — reopening the
 * surface reuses the cache instead of re-running every template's heightmap
 * pipeline.
 */
const initialSeed = generateSeed();
const previewSeeds = new Map<string, string>();
const previewImages = new Map<string, string>();
let previewGraph: PreviewGraph | null = null;
const persistedOptions: { renderOcean: boolean; colorScheme: string | null } = {
  renderOcean: false,
  colorScheme: null
};

/** Reset all module-level preview state. Test isolation hook — nothing in the app calls it. */
export function resetHeightmapSelectionState(): void {
  previewSeeds.clear();
  previewImages.clear();
  previewGraph = null;
  persistedOptions.renderOcean = false;
  persistedOptions.colorScheme = null;
}

/** The heightmap template config (`window.heightmapTemplates`), guarded for absence. */
function getTemplates(): Record<string, { name: string }> {
  return typeof heightmapTemplates === "undefined" ? {} : (heightmapTemplates ?? {});
}

/** The precreated heightmap config (`window.precreatedHeightmaps`), guarded for absence. */
function getPrecreated(): Record<string, { name: string }> {
  return typeof precreatedHeightmaps === "undefined" ? {} : (precreatedHeightmaps ?? {});
}

/** A heightmap's display name — template or precreated (the legacy getName). */
function getHeightmapName(id: string): string {
  return getTemplates()[id]?.name ?? getPrecreated()[id]?.name ?? id;
}

/** The preview seed for a heightmap id: its regenerated seed, or the session's initial one. */
function previewSeedFor(id: string): string {
  return previewSeeds.get(id) ?? initialSeed;
}

/**
 * Refresh the module-level preview graph (the legacy `getGraph`): regenerate it
 * when the world's seed/size no longer matches, otherwise clone the previous
 * one; either way strip the heights so the next template paints onto clean
 * geometry. Returns null when no world is loaded yet.
 */
function refreshPreviewGraph(): PreviewGraph | null {
  const baseGraph = previewGraph ?? getGridGraph();
  if (!baseGraph) return null;
  const worldSeed = getWorldSeed();

  const newGraph = shouldRegenerateGrid(baseGraph, worldSeed as unknown as number, graphWidth, graphHeight)
    ? (generateGrid(worldSeed, graphWidth, graphHeight) as PreviewGraph)
    : (structuredClone(baseGraph) as PreviewGraph);
  delete newGraph.cells.h;

  previewGraph = newGraph;
  return newGraph;
}

/**
 * Seed the global PRNG for a preview draw. The legacy previews monkey-patch
 * `Math.random` with an alea PRNG so every template thumbnail is deterministic
 * per seed; preserved verbatim (the generator pipeline reads `Math.random`).
 */
function seedPreviewRandom(previewSeed: string): void {
  if (typeof aleaPRNG === "function") Math.random = aleaPRNG(previewSeed);
}

/** Render heights into a preview data URL via the same drawHeights the legacy used. */
function renderPreviewDataUrl(
  graph: PreviewGraph,
  heights: Uint8Array | null,
  renderOcean: boolean,
  colorScheme: string
): string {
  const scheme = typeof getColorScheme === "function" ? getColorScheme(colorScheme) : () => "#000000";
  return drawHeights({
    heights: heights as unknown as number[],
    width: graph.cellsX,
    height: graph.cellsY,
    scheme,
    renderOcean
  });
}

/** Paint one template's preview into the module cache (synchronous — the legacy drawTemplatePreview). */
function paintTemplatePreview(graph: PreviewGraph, id: string, renderOcean: boolean, colorScheme: string): void {
  if (typeof HeightmapGenerator === "undefined") return;
  seedPreviewRandom(previewSeedFor(id));
  const heights = HeightmapGenerator.fromTemplate(graph, id);
  previewImages.set(id, renderPreviewDataUrl(graph, heights, renderOcean, colorScheme));
}

/**
 * Render one precreated heightmap's preview (async — it loads the heightmap
 * image; the legacy drawPrecreatedHeightmap). Returns null when the generator
 * global is absent. The CALLER decides whether the result is still wanted
 * (unmount / a newer repaint may have superseded it) before caching it.
 */
async function paintPrecreatedPreview(
  graph: PreviewGraph,
  id: string,
  renderOcean: boolean,
  colorScheme: string
): Promise<string | null> {
  if (typeof HeightmapGenerator === "undefined") return null;
  seedPreviewRandom(previewSeedFor(id));
  const heights = await HeightmapGenerator.fromPrecreated(graph, id);
  return renderPreviewDataUrl(graph, heights, renderOcean, colorScheme);
}

/**
 * HeightmapSelection — the "Select Heightmap" surface, at parity with the
 * legacy `src/controllers/heightmap-selection.ts` jQuery-UI dialog (Phase 3
 * Slice 8).
 *
 * A thumbnail grid of heightmap templates and precreated heightmaps, painted by
 * the same modules the legacy used (`HeightmapGenerator` + `drawHeights` onto a
 * cloned, height-stripped preview grid), with the render-ocean / color-scheme
 * options and the Cancel / Select / New Map actions. Select applies the chosen
 * heightmap to the options pane's `#templateInput` and locks it; New Map
 * additionally hands the preview seed + graph to the existing `regeneratePrompt`
 * world-regeneration flow — both are the unchanged legacy callbacks.
 *
 * Deliberately NOT `useWorldVersion`-reactive: the surface renders template
 * CONFIG (not world data), and its one world read — the grid the previews
 * render on — is re-derived on every explicit paint trigger, exactly like the
 * legacy dialog, whose previews also stayed as painted until the user redrew
 * them. Auto-repainting every thumbnail on any world change would re-run the
 * whole heightmap pipeline per template for edits that cannot affect it.
 */
export function HeightmapSelection({ anchor, initialSelection, onClose }: HeightmapSelectionProps) {
  const [selected, setSelected] = useState<string | undefined>(initialSelection || undefined);
  const [renderOcean, setRenderOcean] = useState(persistedOptions.renderOcean);
  const [colorScheme, setColorScheme] = useState(() => {
    const schemes = typeof heightmapColorSchemes === "undefined" ? {} : (heightmapColorSchemes ?? {});
    return persistedOptions.colorScheme ?? Object.keys(schemes)[0] ?? "";
  });
  const [previews, setPreviews] = useState<Record<string, string>>(() => Object.fromEntries(previewImages));
  const [paintVersion, requestRepaint] = useReducer((count: number) => count + 1, 0);

  const templateIds = Object.keys(getTemplates());
  const precreatedIds = Object.keys(getPrecreated());
  const colorSchemeNames = Object.keys(
    typeof heightmapColorSchemes === "undefined" ? {} : (heightmapColorSchemes ?? {})
  );

  // Paint every preview missing from the module cache: templates synchronously,
  // precreated ones as they load. An option change / Redraw clears the cache
  // first (the legacy redrawAll), so this same effect then repaints everything.
  // Unmount (or a superseding repaint) cancels in-flight precreated paints so a
  // stale draw is never cached or set on state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: paintVersion is a deliberate repaint trigger.
  useEffect(() => {
    let cancelled = false;

    const graph = refreshPreviewGraph();
    if (!graph) return;

    for (const id of Object.keys(getTemplates())) {
      if (previewImages.has(id)) continue;
      paintTemplatePreview(graph, id, renderOcean, colorScheme);
    }
    setPreviews(Object.fromEntries(previewImages));

    (async () => {
      for (const id of Object.keys(getPrecreated())) {
        if (previewImages.has(id)) continue;
        const dataUrl = await paintPrecreatedPreview(graph, id, renderOcean, colorScheme);
        if (cancelled) return;
        if (dataUrl === null) continue;
        previewImages.set(id, dataUrl);
        setPreviews(Object.fromEntries(previewImages));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [renderOcean, colorScheme, paintVersion]);

  function handleRenderOceanChange(checked: boolean): void {
    persistedOptions.renderOcean = checked;
    previewImages.clear(); // legacy redrawAll: every preview repaints with the new option
    setRenderOcean(checked);
  }

  function handleColorSchemeChange(scheme: string): void {
    persistedOptions.colorScheme = scheme;
    previewImages.clear();
    setColorScheme(scheme);
  }

  function handleRedrawAll(): void {
    previewImages.clear();
    requestRepaint();
  }

  /** Regenerate ONE template's preview with a fresh seed (the legacy regenerate icon). */
  function handleRegeneratePreview(id: string): void {
    const graph = refreshPreviewGraph();
    if (!graph) return;
    previewSeeds.set(id, generateSeed());
    paintTemplatePreview(graph, id, renderOcean, colorScheme);
    setPreviews(Object.fromEntries(previewImages));
  }

  /**
   * Apply the selected heightmap to the options pane — set `#templateInput` and
   * lock the option (the shared first half of Select and New Map). Returns false
   * (and does nothing) when no thumbnail is selected, matching the legacy guard.
   */
  function applySelection(): boolean {
    if (!selected) return false;
    const templateInput = document.getElementById("templateInput");
    if (templateInput && typeof applyOption === "function") {
      applyOption(templateInput, selected, getHeightmapName(selected));
    }
    if (typeof lock === "function") lock("template");
    return true;
  }

  function handleSelect(): void {
    if (!applySelection()) return;
    onClose();
  }

  function handleNewMap(): void {
    if (!applySelection()) return;
    if (typeof regeneratePrompt === "function") {
      regeneratePrompt({ seed: previewSeedFor(selected as string), graph: previewGraph });
    }
    onClose();
  }

  /** Confirm erasing the map, then open the heightmap tool (the legacy confirmHeightmapEdit). */
  function confirmHeightmapEdit(tool: string, title: string): void {
    if (typeof confirmationDialog !== "function") return;
    confirmationDialog({
      title,
      message: "Opening the tool will erase the current map. Are you sure you want to proceed?",
      confirm: "Continue",
      onConfirm: () => {
        if (typeof editHeightmap === "function") editHeightmap({ mode: "erase", tool });
      }
    });
  }

  // The legacy stylesheet derived each thumbnail's aspect ratio from the map
  // dimensions at load; dynamic, so it stays inline (the static rules moved to
  // the global sheet).
  const thumbnailStyle =
    typeof graphWidth === "undefined" || typeof graphHeight === "undefined"
      ? undefined
      : { aspectRatio: `${graphWidth} / ${graphHeight}` };

  function renderArticle(id: string, isTemplate: boolean) {
    const name = getHeightmapName(id);
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: legacy parity — thumbnails select on click; keyboard users confirm via the footer buttons.
      <article
        key={id}
        data-id={id}
        data-seed={previewSeedFor(id)}
        className={selected === id ? "selected" : undefined}
        onClick={() => setSelected(id)}
      >
        <img src={previews[id]} alt={name} style={thumbnailStyle} />
        <div>
          {name}
          {isTemplate && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: legacy parity — a hover-revealed convenience icon; Redraw preview covers keyboard users.
            // biome-ignore lint/a11y/noStaticElementInteractions: same icon-span shape as the legacy dialog.
            <span
              data-tip="Regenerate preview"
              className="icon-cw regeneratePreview"
              onClick={() => handleRegeneratePreview(id)}
            />
          )}
        </div>
      </article>
    );
  }

  return (
    <Panel title="Select Heightmap" anchor={anchor} onClose={onClose}>
      <div className="heightmap-selection">
        <section data-tip="Select heightmap template – template provides unique, but similar-looking maps on generation">
          <header>
            <h1>Heightmap templates</h1>
          </header>
          <div className="heightmap-selection_container">{templateIds.map(id => renderArticle(id, true))}</div>
        </section>
        <section data-tip="Select precreated heightmap – it will be the same for each map">
          <header>
            <h1>Precreated heightmaps</h1>
          </header>
          <div className="heightmap-selection_container">{precreatedIds.map(id => renderArticle(id, false))}</div>
        </section>
        <section>
          <header>
            <h1>Options</h1>
          </header>
          <div className="heightmap-selection_options">
            <div>
              {/* The legacy redraw trigger was a click-styled label; a chrome-less
                  button keeps the identical look and adds keyboard access. */}
              <button
                type="button"
                data-tip="Rerender all preview images"
                className="checkbox-label"
                id="heightmapSelectionRedrawPreview"
                style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}
                onClick={handleRedrawAll}
              >
                <i className="icon-cw" /> Redraw preview
              </button>
              <div>
                <input
                  id="heightmapSelectionRenderOcean"
                  className="checkbox"
                  type="checkbox"
                  checked={renderOcean}
                  onChange={event => handleRenderOceanChange(event.target.checked)}
                />
                <label
                  data-tip="Draw heights of water cells"
                  htmlFor="heightmapSelectionRenderOcean"
                  className="checkbox-label"
                >
                  Render ocean heights
                </label>
              </div>
              <div data-tip="Color scheme used for heightmap preview">
                Color scheme{" "}
                <select
                  id="heightmapSelectionColorScheme"
                  aria-label="Color scheme"
                  value={colorScheme}
                  onChange={event => handleColorSchemeChange(event.target.value)}
                >
                  {colorSchemeNames.map(scheme => (
                    <option key={scheme} value={scheme}>
                      {scheme}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button
                type="button"
                data-tip="Open Template Editor"
                id="heightmapSelectionEditTemplates"
                onClick={() => confirmHeightmapEdit("templateEditor", "Open Template Editor")}
              >
                Edit Templates
              </button>
              <button
                type="button"
                data-tip="Open Image Converter"
                id="heightmapSelectionImportHeightmap"
                onClick={() => confirmHeightmapEdit("imageConverter", "Open Image Converter")}
              >
                Import Heightmap
              </button>
            </div>
          </div>
        </section>
      </div>
      {/* The legacy jQuery dialog's button pane, in its declared order. */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4em", marginTop: "0.5em" }}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={handleSelect}>
          Select
        </button>
        <button type="button" onClick={handleNewMap}>
          New Map
        </button>
      </div>
    </Panel>
  );
}
