import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef } from "react";
import { minmax, rn } from "@/utils/numberUtils";
import { Panel } from "../Panel";
import { useWorldVersion } from "../use-world-version";

interface MinimapProps {
  /** CSS selector the panel anchors near on open. */
  anchor?: string;
  onClose: () => void;
}

// The legacy dynamically-injected #minimapStyles rules, verbatim, as inline
// styles (recipe: inline style for one-off layout; no global class covers these).
const wrapStyle = { position: "relative", width: "20em", border: 0 } as const;
const surfaceStyle = { display: "block", width: "100%", height: "auto", cursor: "crosshair" } as const;
const viewportStyle = {
  fill: "rgba(190, 255, 137, 0.1)",
  stroke: "#624954",
  strokeWidth: 1,
  strokeDasharray: 4,
  vectorEffect: "non-scaling-stroke",
  pointerEvents: "none"
} as const;

/**
 * Minimap — a small always-whole-world mirror of the map (`<use href="#viewbox">`)
 * with a rect marking the part currently visible in the main view, at parity with
 * the legacy jQuery-UI dialog.
 *
 * The mirror and viewport rect track the main view's zoom/pan imperatively: the
 * zoom handler in main.js calls `window.updateMinimap` on every position/scale
 * change (potentially per animation frame), so the update writes SVG attributes
 * through refs instead of going through React state — exactly the legacy update
 * path. The surface owns the hook for its lifetime: it registers it on mount and
 * restores whatever value existed before on unmount. Clicking the minimap pans
 * the main view to the clicked world point at the current scale (`zoomTo`).
 * View-state reads (graph size, pan, scale) are plain guarded globals — they are
 * renderer view state, not world data, so they do not go through the accessor.
 */
export function Minimap({ anchor, onClose }: MinimapProps) {
  const worldVersion = useWorldVersion();

  const surfaceRef = useRef<SVGSVGElement>(null);
  const mapUseRef = useRef<SVGUseElement>(null);
  const viewportRef = useRef<SVGRectElement>(null);

  // Sync the mirror transform and the viewport rect to the current view state.
  // Same math as the legacy updateMinimap: #viewbox already carries the main
  // view's transform, so the mirror inverts it to show the whole world, and the
  // rect covers the on-screen slice clamped to the world bounds.
  const updateViewport = useCallback(() => {
    const surface = surfaceRef.current;
    const mapUse = mapUseRef.current;
    const viewport = viewportRef.current;
    if (!surface || !mapUse || !viewport) return;
    if (typeof graphWidth === "undefined" || typeof graphHeight === "undefined") return;

    surface.setAttribute("viewBox", `0 0 ${graphWidth} ${graphHeight}`);

    const inverseScale = scale ? 1 / scale : 1;
    mapUse.setAttribute(
      "transform",
      `translate(${rn(-viewX * inverseScale, 3)} ${rn(-viewY * inverseScale, 3)}) scale(${rn(inverseScale, 6)})`
    );

    const left = Math.max(0, -viewX * inverseScale);
    const top = Math.max(0, -viewY * inverseScale);
    const right = Math.min(graphWidth, left + svgWidth * inverseScale);
    const bottom = Math.min(graphHeight, top + svgHeight * inverseScale);

    viewport.setAttribute("x", String(rn(left, 3)));
    viewport.setAttribute("y", String(rn(top, 3)));
    viewport.setAttribute("width", String(rn(Math.max(0, right - left), 3)));
    viewport.setAttribute("height", String(rn(Math.max(0, bottom - top), 3)));
  }, []);

  // Sync on mount and whenever the world changes (e.g. a regenerated map with new
  // graph dimensions while the panel stays open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: worldVersion intentionally re-reads the view state.
  useEffect(() => {
    updateViewport();
  }, [updateViewport, worldVersion]);

  // Own the `window.updateMinimap` hook (main.js calls it on every zoom/pan) for
  // this surface's lifetime; restore whatever value existed before on unmount.
  useEffect(() => {
    const previousHook = window.updateMinimap;
    window.updateMinimap = updateViewport;
    return () => {
      window.updateMinimap = previousHook;
    };
  }, [updateViewport]);

  // Pan the main view to the clicked world point, keeping the current scale —
  // the legacy click-to-pan behavior.
  function handleClick(event: ReactMouseEvent<SVGSVGElement>): void {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (typeof graphWidth === "undefined" || typeof graphHeight === "undefined") return;
    if (typeof zoomTo !== "function") return;

    const point = surface.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const ctm = surface.getScreenCTM();
    if (!ctm) return;

    const svgPoint = point.matrixTransform(ctm.inverse());
    const x = minmax(svgPoint.x, 0, graphWidth);
    const y = minmax(svgPoint.y, 0, graphHeight);
    zoomTo(x, y, scale, 450);
  }

  return (
    <Panel title="Minimap" anchor={anchor} onClose={onClose}>
      <div id="minimapViewportWrap" style={wrapStyle}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-to-pan on the whole minimap image is a pointer-only pan aid, matching the legacy dialog. */}
        <svg
          id="minimapSurface"
          ref={surfaceRef}
          preserveAspectRatio="xMidYMid meet"
          aria-label="Map minimap"
          style={surfaceStyle}
          onClick={handleClick}
        >
          <use id="minimapMapUse" ref={mapUseRef} href="#viewbox" style={{ pointerEvents: "none" }} />
          <rect id="minimapViewport" ref={viewportRef} style={viewportStyle} />
        </svg>
      </div>
    </Panel>
  );
}

declare global {
  interface Window {
    /**
     * Refresh-the-minimap hook, called by the zoom handler in main.js on every
     * position/scale change (guarded there — it is set only while the minimap
     * surface is mounted).
     */
    updateMinimap?: () => void;
  }
}
