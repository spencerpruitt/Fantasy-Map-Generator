import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeightmapSelection, resetHeightmapSelectionState } from "./HeightmapSelection";

const globalScope = globalThis as Record<string, unknown>;

// A 10x10 preview grid whose seed/size match the stubbed world, so
// shouldRegenerateGrid takes the clone path (no real Voronoi generation):
// spacing = rn(sqrt(100*100 / 100), 2) = 10, cellsX = cellsY = 10.
function makeGrid() {
  return {
    seed: "42",
    cellsDesired: 100,
    spacing: 10,
    cellsX: 10,
    cellsY: 10,
    boundary: [],
    points: [],
    cells: { i: new Uint32Array(100) },
    vertices: {}
  };
}

const fromTemplate = vi.fn((_graph: unknown, _id: string): Uint8Array => new Uint8Array(100).fill(30));
const fromPrecreated = vi.fn(async (_graph: unknown, _id: string): Promise<Uint8Array> => new Uint8Array(100).fill(60));

const originalMathRandom = Math.random;

beforeEach(() => {
  resetHeightmapSelectionState();
  fromTemplate.mockClear();
  fromPrecreated.mockClear();
  fromPrecreated.mockImplementation(async () => new Uint8Array(100).fill(60));

  globalScope.grid = makeGrid();
  globalScope.seed = "42";
  globalScope.graphWidth = 100;
  globalScope.graphHeight = 100;
  globalScope.heightmapTemplates = { volcano: { name: "Volcano" }, atoll: { name: "Atoll" } };
  // Most tests keep the async precreated set empty; the ones exercising it opt in.
  globalScope.precreatedHeightmaps = {};
  globalScope.HeightmapGenerator = { fromTemplate, fromPrecreated };
  globalScope.aleaPRNG = () => () => 0.5;
  globalScope.getColorScheme = vi.fn(() => () => "#808080");
  globalScope.heightmapColorSchemes = { bright: {}, light: {} };
  globalScope.applyOption = vi.fn();
  globalScope.lock = vi.fn();
  globalScope.regeneratePrompt = vi.fn();
  globalScope.confirmationDialog = vi.fn();
  globalScope.editHeightmap = vi.fn();

  // The elements the surface/seam touch outside the panel: the options pane's
  // template select and the points input shouldRegenerateGrid reads.
  const templateInput = document.createElement("select");
  templateInput.id = "templateInput";
  document.body.appendChild(templateInput);
  const pointsInput = document.createElement("input");
  pointsInput.id = "pointsInput";
  pointsInput.dataset.cells = "100";
  document.body.appendChild(pointsInput);
});

afterEach(() => {
  Math.random = originalMathRandom;
  document.getElementById("templateInput")?.remove();
  document.getElementById("pointsInput")?.remove();
  for (const key of [
    "grid",
    "seed",
    "graphWidth",
    "graphHeight",
    "heightmapTemplates",
    "precreatedHeightmaps",
    "HeightmapGenerator",
    "aleaPRNG",
    "getColorScheme",
    "heightmapColorSchemes",
    "applyOption",
    "lock",
    "regeneratePrompt",
    "confirmationDialog",
    "editHeightmap"
  ]) {
    globalScope[key] = undefined;
  }
});

function getArticle(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`article[data-id="${id}"]`) as HTMLElement;
}

describe("<HeightmapSelection>", () => {
  it("renders one painted thumbnail per template and per precreated heightmap", async () => {
    globalScope.precreatedHeightmaps = { africa: { name: "Africa" } };
    const { container } = render(<HeightmapSelection onClose={() => {}} />);

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Select Heightmap");
    expect(container.querySelectorAll("article")).toHaveLength(3);

    // Template thumbnails paint synchronously via the same generator + drawHeights path.
    expect(fromTemplate).toHaveBeenCalledTimes(2);
    expect((screen.getByAltText("Volcano") as HTMLImageElement).src).toMatch(/^data:image/);
    expect((screen.getByAltText("Atoll") as HTMLImageElement).src).toMatch(/^data:image/);

    // The precreated thumbnail paints asynchronously once its heights load.
    await waitFor(() => expect((screen.getByAltText("Africa") as HTMLImageElement).src).toMatch(/^data:image/));
    expect(fromPrecreated).toHaveBeenCalledTimes(1);
  });

  it("renders unpainted thumbnails (and does not throw) when no world is loaded", () => {
    globalScope.grid = undefined;
    const { container } = render(<HeightmapSelection onClose={() => {}} />);

    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(fromTemplate).not.toHaveBeenCalled();
    expect((screen.getByAltText("Volcano") as HTMLImageElement).getAttribute("src")).toBeNull();
  });

  it("pre-selects the template the options pane currently applies", () => {
    const { container } = render(<HeightmapSelection initialSelection="atoll" onClose={() => {}} />);
    expect(getArticle(container, "atoll").classList.contains("selected")).toBe(true);
    expect(getArticle(container, "volcano").classList.contains("selected")).toBe(false);
  });

  it("moves the selection highlight when a thumbnail is clicked", () => {
    const { container } = render(<HeightmapSelection initialSelection="atoll" onClose={() => {}} />);

    fireEvent.click(getArticle(container, "volcano"));

    expect(getArticle(container, "volcano").classList.contains("selected")).toBe(true);
    expect(getArticle(container, "atoll").classList.contains("selected")).toBe(false);
  });

  it("repaints every thumbnail when the render-ocean option changes", () => {
    render(<HeightmapSelection onClose={() => {}} />);
    expect(fromTemplate).toHaveBeenCalledTimes(2);
    fromTemplate.mockClear();

    fireEvent.click(screen.getByLabelText("Render ocean heights"));

    expect(fromTemplate).toHaveBeenCalledTimes(2);
  });

  it("repaints every thumbnail with the new scheme when the color scheme changes", () => {
    render(<HeightmapSelection onClose={() => {}} />);
    fromTemplate.mockClear();
    (globalScope.getColorScheme as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.change(screen.getByLabelText("Color scheme"), { target: { value: "light" } });

    expect(fromTemplate).toHaveBeenCalledTimes(2);
    expect(globalScope.getColorScheme).toHaveBeenCalledWith("light");
  });

  it("repaints every thumbnail when Redraw preview is clicked", () => {
    const { container } = render(<HeightmapSelection onClose={() => {}} />);
    fromTemplate.mockClear();

    fireEvent.click(container.querySelector("#heightmapSelectionRedrawPreview") as HTMLElement);

    expect(fromTemplate).toHaveBeenCalledTimes(2);
  });

  it("regenerates a single template's preview with a fresh seed and selects it", () => {
    const { container } = render(<HeightmapSelection initialSelection="atoll" onClose={() => {}} />);
    const seedBefore = getArticle(container, "volcano").getAttribute("data-seed");
    fromTemplate.mockClear();

    fireEvent.click(getArticle(container, "volcano").querySelector(".regeneratePreview") as HTMLElement);

    expect(fromTemplate).toHaveBeenCalledTimes(1);
    expect(fromTemplate.mock.calls[0][1]).toBe("volcano");
    const volcano = getArticle(container, "volcano");
    expect(volcano.getAttribute("data-seed")).not.toBe(seedBefore);
    expect(volcano.classList.contains("selected")).toBe(true);
    // The sibling keeps its seed and image.
    expect(getArticle(container, "atoll").getAttribute("data-seed")).toBe(seedBefore);
  });

  it("closes without applying anything on Cancel", () => {
    const onClose = vi.fn();
    render(<HeightmapSelection initialSelection="atoll" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(globalScope.applyOption).not.toHaveBeenCalled();
    expect(globalScope.lock).not.toHaveBeenCalled();
    expect(globalScope.regeneratePrompt).not.toHaveBeenCalled();
  });

  it("Select applies the chosen heightmap to #templateInput, locks the option, and closes", () => {
    const onClose = vi.fn();
    render(<HeightmapSelection initialSelection="atoll" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(globalScope.applyOption).toHaveBeenCalledWith(document.getElementById("templateInput"), "atoll", "Atoll");
    expect(globalScope.lock).toHaveBeenCalledWith("template");
    expect(globalScope.regeneratePrompt).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Select and New Map do nothing when no thumbnail is selected", () => {
    const onClose = vi.fn();
    render(<HeightmapSelection onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "New Map" }));

    expect(globalScope.applyOption).not.toHaveBeenCalled();
    expect(globalScope.regeneratePrompt).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("New Map applies the selection and hands the preview seed + graph to regeneratePrompt", () => {
    const onClose = vi.fn();
    const { container } = render(<HeightmapSelection initialSelection="volcano" onClose={onClose} />);
    const previewSeed = getArticle(container, "volcano").getAttribute("data-seed");

    fireEvent.click(screen.getByRole("button", { name: "New Map" }));

    expect(globalScope.applyOption).toHaveBeenCalledWith(
      document.getElementById("templateInput"),
      "volcano",
      "Volcano"
    );
    expect(globalScope.lock).toHaveBeenCalledWith("template");
    const prompt = globalScope.regeneratePrompt as ReturnType<typeof vi.fn>;
    expect(prompt).toHaveBeenCalledTimes(1);
    const promptArgs = prompt.mock.calls[0][0];
    expect(promptArgs.seed).toBe(previewSeed);
    expect(promptArgs.graph?.cellsX).toBe(10);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation before opening the template editor, then erases into the tool", () => {
    render(<HeightmapSelection onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Templates" }));

    const confirmation = globalScope.confirmationDialog as ReturnType<typeof vi.fn>;
    expect(confirmation).toHaveBeenCalledTimes(1);
    const confirmationOptions = confirmation.mock.calls[0][0];
    expect(confirmationOptions.title).toBe("Open Template Editor");
    expect(globalScope.editHeightmap).not.toHaveBeenCalled();

    confirmationOptions.onConfirm();
    expect(globalScope.editHeightmap).toHaveBeenCalledWith({ mode: "erase", tool: "templateEditor" });

    fireEvent.click(screen.getByRole("button", { name: "Import Heightmap" }));
    confirmation.mock.calls[1][0].onConfirm();
    expect(globalScope.editHeightmap).toHaveBeenCalledWith({ mode: "erase", tool: "imageConverter" });
  });

  it("cancels an in-flight precreated paint on unmount (no stale draw is cached)", async () => {
    globalScope.precreatedHeightmaps = { africa: { name: "Africa" } };
    let resolveHeights: (heights: Uint8Array) => void = () => {};
    fromPrecreated.mockImplementation(
      () =>
        new Promise<Uint8Array>(resolve => {
          resolveHeights = resolve;
        })
    );

    const view = render(<HeightmapSelection onClose={() => {}} />);
    expect(fromPrecreated).toHaveBeenCalledTimes(1);

    view.unmount();
    resolveHeights(new Uint8Array(100).fill(60));
    // Let the abandoned promise chain settle; the cancelled draw must not cache.
    await Promise.resolve();
    await Promise.resolve();

    // A fresh mount finds no cached preview and paints it again.
    fromPrecreated.mockImplementation(async () => new Uint8Array(100).fill(60));
    render(<HeightmapSelection onClose={() => {}} />);
    expect(fromPrecreated).toHaveBeenCalledTimes(2);
    await waitFor(() => expect((screen.getByAltText("Africa") as HTMLImageElement).src).toMatch(/^data:image/));
  });

  it("reuses the painted previews when reopened (no repaint on remount)", async () => {
    globalScope.precreatedHeightmaps = { africa: { name: "Africa" } };
    const first = render(<HeightmapSelection onClose={() => {}} />);
    await waitFor(() => expect((screen.getByAltText("Africa") as HTMLImageElement).src).toMatch(/^data:image/));
    first.unmount();

    fromTemplate.mockClear();
    fromPrecreated.mockClear();
    render(<HeightmapSelection onClose={() => {}} />);

    expect(fromTemplate).not.toHaveBeenCalled();
    expect(fromPrecreated).not.toHaveBeenCalled();
    expect((screen.getByAltText("Volcano") as HTMLImageElement).src).toMatch(/^data:image/);
    expect((screen.getByAltText("Africa") as HTMLImageElement).src).toMatch(/^data:image/);
  });
});
