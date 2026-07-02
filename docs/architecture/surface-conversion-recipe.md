# Recipe — convert a legacy surface to a React surface

The repeatable procedure for re-platforming one [Surface][kt] (a dialog/overview/editor) from the
legacy jQuery-UI chrome onto React, established by the foundation PRD (Phases 0–2) and frozen here.
A fresh agent can pick any unblocked surface and follow these steps end to end.

**Direction:** [ADR-0002](../adr/adr-0002-ui-replatform-react-webgl.md) (React owns UI chrome only;
never the map cells) · [ADR-0003](../adr/adr-0003-react-build-tooling.md) (tooling) ·
[ADR-0004](../adr/adr-0004-world-state-reactivity.md) (reactivity behind the accessor).

**Worked examples, simplest → richest:** `src/ui/surfaces/ComparePrices.tsx` (read-only table),
`MarketOverview.tsx` (adds a mutation + a renderer side-effect + opens another surface),
`MarketDeals.tsx` (filter + row-action), `TradeDetails.tsx` (object prop + lifecycle side-effect).

Everything lives under `src/ui/`. The rule that keeps the migration honest: **each conversion deletes
its legacy counterpart in the same slice**, so the `window.X` bridge shrinks monotonically and the two
UIs never drift.

## The steps

### 1. Register the surface (mount seam)
- Add the surface's id to the `SurfaceId` union in `src/ui/app-shell/registry.ts`. This is what makes
  a typo'd id a **compile** error at every `openSurface`/`registerSurface` call.
- Add one line to `src/ui/surfaces/index.ts`: `registerSurface("<id>", <Component> as SurfaceComponent)`
  (widen with `as unknown as SurfaceComponent` when the component has required props). That is the
  whole mount wiring — `<App>` looks the component up by id and renders the open ones; there is no
  per-surface `createRoot`.
- **Known limitation:** only the id is compile-checked, not the props — `openSurface(id, props)` takes
  `Record<string, unknown>` and registration widens the component, so a prop-name mismatch between a
  seam and its surface fails at runtime, not compile time. The surface's browser tests and the fact
  that each seam is the surface's single caller cover this today; a fully-typed `SurfacePropsMap` is a
  possible later enhancement (it would couple the registry to each surface's prop types).

### 2. Preserve the trigger seam (`open`)
- Keep the legacy controller's exported `open(...)` **signature** so its callers don't change. Replace
  the body with validation (tip on invalid input, exactly as the legacy did) + `openSurface("<id>",
  { ...props, anchor })`. Example: `src/controllers/market-overview.ts`.
- Props are carried opaquely through the registry, so pass whatever the surface needs (an id, or a
  whole object like `TradeDetails`'s `batch`).

### 3. Read world data ONLY through the accessor
- Never touch raw `window.pack` / `Goods` / `Markets` in a surface. Read through `src/ui/world-state.ts`;
  add thin getters there as needed (they guard for an absent world, returning `[]`/`undefined`).
- **Reactivity:** call `useWorldVersion()` once in the component and use it (with a local Refresh
  reducer, if the surface has a Refresh button) as a `useMemo`/effect dependency so the surface
  re-reads on any world change. The read getters themselves are unchanged — this is the only line a
  surface adds to become reactive. See ADR-0004.
- **Mutations** go through the accessor too (e.g. `renameMarket`), and the mutating **call site**
  signals via `notifyWorldChanged()` — at the controller layer, never inside the domain core. Note the
  ADR-0004 exception: a per-keystroke input must not signal on every character.

### 4. Frame with `<Panel>`
- Wrap the surface's body in `<Panel title={...} anchor={...} onClose={onClose}>`. Panel owns the
  draggable, viewport-clamped window frame; its interface is stable so its internals can be swapped
  later. Reuse the global CSS classes (`.header`, `.table`, `.states`, `.totalLine`, `icon-*`,
  `sortable`) so the surface renders identically to the legacy dialog.
- Reuse the shared primitives instead of re-implementing them: `SortHeader` + `sortableHeaderClass`
  (`src/ui/SortHeader.tsx`) for click-sortable columns, and `csvField` (`src/ui/csv.ts`) for CSV export.

### 5. Side-effects call the existing globals, not the accessor
- CSV download (`downloadFile`/`getFileName`), zoom (`zoomTo`), coat-of-arms (`COArenderer.trigger`),
  route highlight (`highlight`/`clearHighlight`) are renderer/host side-effects: call them directly
  (guarded for absence). Lifecycle side-effects (highlight on open, clear on unmount) go in a
  `useEffect` with a cleanup — the build-on-open / destroy-on-close shape (see `TradeDetails`).

### 6. Delete the legacy rendering in the same slice
- Remove the legacy `.dialog()` call, the template-string builders, and the surface's static markup in
  `src/index.html`. Grep for the removed element ids to confirm no dead references remain (a
  still-legacy sibling may reference the removed dialog for positioning — note it and let it heal when
  that sibling converts).

### 7. Tests
- **Accessor** (node, `world-state.test.ts`): any new getters' read shape; a mutation's mutate/signal
  behavior.
- **Surface** (React Testing Library, `*.browser.test.tsx`): stub the world via the `window.X` bridge
  (see any existing surface test); assert rows render, controls behave (sort/filter/toggle), CSV
  matches, reactivity (`act(() => notifyWorldChanged())` re-reads), and invalid-input guards.
- **Parity e2e** (`tests/e2e/*-parity.spec.ts`): load `tests/fixtures/demo.map`, trigger via the REAL
  seam (`window.lazy.<controller>().then(m => m.open(...))`), assert the React panel + actions, assert
  the legacy element is gone, and assert `collectConsoleErrors(page).critical()` is empty.
- The `.map` round-trip tests must stay byte-identical — a read-only surface never perturbs them.

### 8. Definition of done
`tsc` + `biome` clean; all node + browser tests pass; parity e2e green; legacy markup deleted; the
surface reads only through the accessor. Then run `/code-review` on the diff and fix confident,
localized findings with a regression test before Review.

## Deferred decisions (with trigger conditions)

- **`<Panel>` — keep the hand-rolled frame, do not adopt a library yet.** The four converted surfaces
  need only drag + viewport-clamp + close, which `Panel` provides behind a stable interface
  (`{title, anchor?, onClose, children}`). **Adopt a drag/resize library (or a real window manager)
  when** the first surface needs resize, snapping, min/max, or z-order management — swap Panel's
  internals without touching any surface. Resize was intentionally out of scope (these overviews were
  non-resizable in the legacy UI).
- **Styling — keep reusing the global CSS classes, defer a styling *system*.** Surfaces render
  identically to the legacy dialogs by reusing the existing global classes (ADR-0003). **Introduce a
  scoped styling system (CSS Modules / a CSS-in-JS lib, via an ADR) when** a surface needs styles the
  global sheet doesn't provide, or when the global sheet starts to be a source of collisions as more
  chrome moves to React. Until then, inline `style` for one-off layout and global classes for the rest.

[kt]: ../../KEYTERMS.md

## Patterns settled by Phase 3 (read-only overviews)

Twelve more conversions (see `docs/prds/*/replatform-phase3-readonly-overviews.md`) settled these
recurring shapes — reuse them instead of re-deriving:

- **Legacy `public/modules/ui/*.js` overviews** get a thin typed seam in `src/controllers/` plus a
  one-line `window.<globalName>` shim registered in `src/controllers/index.ts` (the eager boot
  entry), so bare-global callers in tools.js/hotkeys.js keep working. The legacy JS file, its
  script tag, and its static markup die in the same slice.
- **d3-in-React (charts/trees/graphs):** React owns the `<Panel>`, all controls as JSX state, and
  the `<svg ref>` element; data prep is a `useMemo` over accessor getters with `useWorldVersion()`
  in the deps (that is the whole reactivity story); d3 owns everything inside the svg in ONE
  `useEffect` keyed on [model + control state]. Cleanup contract: `.interrupt()` transitions, stop
  animation timers, detach zoom/drag behaviors (`svg.on(".zoom", null)`), empty the svg
  (`selectAll("*").remove()` drops listeners), reset host side channels (`tip("")`). Zoom
  transforms survive re-renders via the svg's `__zoom`. Worked examples: `ElevationProfile`,
  `HierarchyTree`, `ProductionChains`, `ChartsOverview`.
- **Shared primitives:** `useSortState` (`src/ui/SortHeader.tsx`) for column sorting;
  `useBulkSelection`/`BulkControls`/`lockableBulkActions` (`src/ui/bulk-selection.tsx`) for
  in-surface bulk modes (replacing legacy `window.bulkBars` per surface); `RowIcon`
  (`src/ui/RowIcon.tsx`); `showTip` (`src/ui/host.ts`) for guarded host tips.
- **Module-level persistence** stands in for legacy static-DOM state that survived dialog close
  (selected curve, chart form, marker add-type, thumbnail caches). Persist at module scope,
  expose a `reset...()` hook for test isolation, and reset on `mapId` change where legacy did.
- **Legacy ids as seams:** when still-legacy code (tools.js, general.js hover-highlight) reaches
  into a converted surface by element id, keep that id on the React-rendered element and make the
  legacy read null-safe (`document.getElementById(...)?...` / `findEl(...)?.`) — never a bare
  implicit global, which throws when the element is gone.
- **Lifecycle sweeps:** any path that discards the world must close React surfaces —
  `.map` load (`src/io/load.ts`) and map regeneration (`public/main.js`) both call
  `closeAllSurfaces()` through the lazy app-shell bridge. A new world-discarding path must do the
  same.
- **Parity e2e waits:** load fixtures with the `map:generated`-event wait (see
  `tests/e2e/regiments-overview-parity.spec.ts`), never `waitForTimeout` sleeps — the naive
  `mapId` poll races the initial random generation, whose `closeAllSurfaces()` closes a
  just-opened panel. Poll (`expect.poll`) for animated/async state.
