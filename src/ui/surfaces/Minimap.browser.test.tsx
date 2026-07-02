import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWorldChanged } from "../world-state";
import { Minimap } from "./Minimap";

const globalScope = globalThis as Record<string, unknown>;

// A 100x50 world viewed through a 200x100 screen at scale 2, panned to (-20,-10):
// inverseScale = 0.5, so the mirror is translate(10 5) scale(0.5) and the
// viewport rect covers x=10 y=5 w=90 h=45 (clamped to the world bounds).
beforeEach(() => {
  globalScope.graphWidth = 100;
  globalScope.graphHeight = 50;
  globalScope.viewX = -20;
  globalScope.viewY = -10;
  globalScope.scale = 2;
  globalScope.svgWidth = 200;
  globalScope.svgHeight = 100;
  globalScope.zoomTo = vi.fn();
  globalScope.updateMinimap = undefined;
});

afterEach(() => {
  globalScope.graphWidth = undefined;
  globalScope.graphHeight = undefined;
  globalScope.viewX = undefined;
  globalScope.viewY = undefined;
  globalScope.scale = undefined;
  globalScope.svgWidth = undefined;
  globalScope.svgHeight = undefined;
  globalScope.zoomTo = undefined;
  globalScope.updateMinimap = undefined;
});

function getSurface(container: HTMLElement): SVGSVGElement {
  return container.querySelector("#minimapSurface") as SVGSVGElement;
}

function getViewport(container: HTMLElement): SVGRectElement {
  return container.querySelector("#minimapViewport") as SVGRectElement;
}

function viewportAttrs(viewport: SVGRectElement): Record<string, string | null> {
  return {
    x: viewport.getAttribute("x"),
    y: viewport.getAttribute("y"),
    width: viewport.getAttribute("width"),
    height: viewport.getAttribute("height")
  };
}

describe("<Minimap>", () => {
  it("renders the map mirror and the viewport rect from the current view state", () => {
    const { container } = render(<Minimap onClose={() => {}} />);

    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Minimap");

    const surface = getSurface(container);
    expect(surface).toBeTruthy();
    expect(surface.getAttribute("viewBox")).toBe("0 0 100 50");

    const mapUse = container.querySelector("#minimapMapUse") as SVGUseElement;
    expect(mapUse.getAttribute("href")).toBe("#viewbox");
    expect(mapUse.getAttribute("transform")).toBe("translate(10 5) scale(0.5)");

    expect(viewportAttrs(getViewport(container))).toEqual({ x: "10", y: "5", width: "90", height: "45" });
  });

  it("pans the main map (zoomTo at the current scale) when the minimap is clicked", () => {
    const zoom = globalScope.zoomTo as ReturnType<typeof vi.fn>;
    const { container } = render(<Minimap onClose={() => {}} />);

    const surface = getSurface(container);
    const rect = surface.getBoundingClientRect();
    // Click at 25% across, 50% down: maps to (25, 25) in the 100x50 world.
    fireEvent.click(surface, {
      clientX: rect.left + rect.width * 0.25,
      clientY: rect.top + rect.height * 0.5
    });

    expect(zoom).toHaveBeenCalledTimes(1);
    const [x, y, zoomScale, duration] = zoom.mock.calls[0];
    expect(x).toBeCloseTo(25, 1);
    expect(y).toBeCloseTo(25, 1);
    expect(zoomScale).toBe(2);
    expect(duration).toBe(450);
  });

  it("does not throw when zoomTo is absent", () => {
    globalScope.zoomTo = undefined;
    const { container } = render(<Minimap onClose={() => {}} />);

    expect(() => fireEvent.click(getSurface(container))).not.toThrow();
  });

  it("registers window.updateMinimap on mount and it refreshes the viewport rect", () => {
    const { container } = render(<Minimap onClose={() => {}} />);
    expect(typeof globalScope.updateMinimap).toBe("function");

    globalScope.viewX = 0;
    globalScope.viewY = 0;
    globalScope.scale = 1;
    globalScope.svgWidth = 100;
    globalScope.svgHeight = 50;
    act(() => (globalScope.updateMinimap as () => void)());

    const mapUse = container.querySelector("#minimapMapUse") as SVGUseElement;
    expect(mapUse.getAttribute("transform")).toBe("translate(0 0) scale(1)");
    expect(viewportAttrs(getViewport(container))).toEqual({ x: "0", y: "0", width: "100", height: "50" });
  });

  it("removes the window.updateMinimap hook on unmount, restoring any previous value", () => {
    const previousHook = vi.fn();
    globalScope.updateMinimap = previousHook;

    const view = render(<Minimap onClose={() => {}} />);
    expect(globalScope.updateMinimap).not.toBe(previousHook);

    view.unmount();
    expect(globalScope.updateMinimap).toBe(previousHook);
  });

  it("leaves window.updateMinimap unset after unmount when no previous hook existed", () => {
    const view = render(<Minimap onClose={() => {}} />);
    expect(typeof globalScope.updateMinimap).toBe("function");

    view.unmount();
    expect(globalScope.updateMinimap).toBeUndefined();
  });

  it("re-reads the view state when the world changes", () => {
    const { container } = render(<Minimap onClose={() => {}} />);

    globalScope.graphWidth = 200;
    globalScope.graphHeight = 100;
    globalScope.viewX = 0;
    globalScope.viewY = 0;
    globalScope.scale = 1;
    globalScope.svgWidth = 200;
    globalScope.svgHeight = 100;
    act(() => notifyWorldChanged());

    expect(getSurface(container).getAttribute("viewBox")).toBe("0 0 200 100");
    expect(viewportAttrs(getViewport(container))).toEqual({ x: "0", y: "0", width: "200", height: "100" });
  });
});
