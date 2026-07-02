# PRD — React Re-platform Phase 3: Read-only Overviews & Tools

> **Direction:** [ADR-0002](../../adr/adr-0002-ui-replatform-react-webgl.md) (React owns UI chrome
> only) · [ADR-0003](../../adr/adr-0003-react-build-tooling.md) (tooling) ·
> [ADR-0004](../../adr/adr-0004-world-state-reactivity.md) (reactivity behind the accessor).
> **Program context:** realizes **Phase 3** of
> [`replatform-foundation.md`](../finished/replatform-foundation.md) § Migration Waves.
> **Recipe:** every slice follows
> [`docs/architecture/surface-conversion-recipe.md`](../../architecture/surface-conversion-recipe.md)
> (frozen in foundation Slice 8) verbatim.
> **Status:** In progress — branch `feat/replatform-phase3-readonly`.

## Problem Statement

The foundation PRD converted four economy surfaces and froze the conversion recipe, but the
remaining read-only overviews and tools still run on the legacy chrome: jQuery-UI `.dialog()`
calls, template-string HTML, static markup in the `index.html` monolith, and (for three of them)
untyped `public/modules/ui/*.js` files reached through `window.X` globals. One of them
(production-overview) doesn't even have a dialog — it renders into the shared `#alert` box via
`alertMessage.innerHTML`.

Until these convert, the `window.X` bridge can't shrink past the economy corner, and the
read/subscribe path proven by ADR-0004 has only been exercised in one feature area. Phase 4
(mutating editors) is deliberately gated on Phase 3: converting the zero-mutation surfaces first
proves the accessor's read path across **every** feature area — military, terrain, map features,
political charts, economy graphs — at the lowest possible risk to `.map` integrity, before any
editor is allowed to write.

## Solution

Convert the remaining **12 read-only overview/tool surfaces** to React, one slice per surface,
strictly per the frozen recipe: register in the app-shell, preserve the `open()` trigger seam,
read only through the World-State accessor with `useWorldVersion()` reactivity, frame with
`<Panel>`, call existing globals for side-effects, and **delete the legacy rendering + static
markup in the same slice** so the bridge shrinks monotonically.

The slices are ordered **easy → hard** so recurring patterns are settled cheaply before the
expensive surfaces spend them:

- **Plain tables first** (production-overview, minimap, routes/rivers/markers overviews) — settle
  the `#alert`-to-`<Panel>` move, the SVG-minimap embed, and the thin-TS-seam + `bulkBars`
  replacement for legacy JS files.
- **Tables with map side-effects next** (regiments-overview, military-overview,
  heightmap-selection) — bulk delete through domain-core cascades, d3 hover highlighting, canvas
  thumbnails.
- **d3-in-dialog charts last** (elevation-profile, hierarchy-tree, production-chains,
  charts-overview) — establish the React-owns-frame / d3-owns-chart-internals pattern once, then
  reuse it for the three hardest surfaces.

Exit state (matching foundation § Phase 3): all read-only surfaces are React, their legacy
rendering is deleted, and the bridge shrinks by that count. One HITL verification at the end of
the feature covers all 12 surfaces (per CLAUDE.md — HITL once per feature, not per slice).

## User Stories

### Users of the app

1. As a worldbuilder, I want every converted overview to show the same data and support the same
   actions (search, sort, toggles, exports, bulk row-actions) as before, so that the rebuild is
   invisible to me.
2. As a worldbuilder, I want the chart surfaces (elevation profile, hierarchy tree, production
   chains, charts) to look and interact the same — zoom, hover, export — so that I lose no
   analysis capability.
3. As a worldbuilder, I want my `.map` files to save and load byte-identically throughout, so that
   my worlds are never at risk from a UI conversion.

### Developers / AI agents continuing the migration

4. As an agent, I want every slice to follow the frozen recipe with no per-surface improvisation,
   so that the twelve conversions stay uniform and the bridge shrinks monotonically.
5. As an agent, I want the legacy `public/modules/ui/*.js` overviews wrapped in thin typed
   controller seams, so that callers keep a lazy `open()` and the legacy JS file dies in the same
   slice.
6. As an agent, I want one established d3-in-React pattern (ref'd SVG + `useEffect` with cleanup),
   so that the four chart surfaces don't each invent their own integration.
7. As an agent, I want existing row-actions (bulk delete, lock) preserved as parity — not treated
   as "mutation" and stripped — so that Phase 3's read-only boundary means *no new mutation
   patterns*, not lost functionality.

## Implementation Decisions

### Aligned decisions (from Align & Plan)

- **The recipe is law.** Every slice follows
  [`surface-conversion-recipe.md`](../../architecture/surface-conversion-recipe.md) verbatim:
  add the id to the `SurfaceId` union (`src/ui/app-shell/registry.ts`) + one `registerSurface`
  line (`src/ui/surfaces/index.ts`); preserve the exported `open()` trigger seam so callers don't
  change; read world data **only** through the World-State accessor (`src/ui/world-state.ts`),
  adding thin guarded getters as needed; `useWorldVersion()` for reactivity; frame with `<Panel>`
  reusing the global CSS classes; reuse the shared `SortHeader` / `csvField` primitives;
  side-effects call existing globals guarded for absence; **delete the legacy rendering and its
  static `index.html` markup in the same slice**; tests per recipe step 7; `.map` round-trip stays
  byte-identical.
- **"Read-only" means no NEW mutation patterns — existing row-actions are in-scope parity.** The
  bulk-delete/lock actions in the routes, rivers, markers, and regiments overviews already exist,
  already delegate to domain-core cascade logic, and already signal via `notifyWorldChanged()`.
  They are converted as parity, not stripped. The legacy `window.bulkBars` integration is replaced
  per-surface the same way the converted MarketDeals surface did it. Establishing the *new*
  mutate → bridge-redraw machinery (shared bulk-action bar, editor mutations) remains Phase 4.
- **d3-in-dialog pattern (elevation-profile, hierarchy-tree, production-chains,
  charts-overview):** d3 renders into a ref'd `<svg>` inside a `useEffect` with cleanup — React
  owns the panel frame, controls, and lifecycle; d3 owns the chart internals (layout, zoom, drag,
  transitions, animation timers). No chart library is introduced (no-new-tooling axiom).
- **Legacy `public/modules/ui/*.js` overviews (routes, rivers, markers)** each get a thin typed
  controller seam in `src/controllers/` so callers keep a lazy `open()` exactly like the existing
  TS controllers; the legacy JS file is deleted in the same slice.
- **production-overview leaves the `#alert` box.** The legacy code renders into the shared alert
  dialog via `alertMessage.innerHTML`; the conversion gives it a real registered `<Panel>` surface
  like every other overview.

### Scope — 12 surfaces, one slice each (easy → hard)

| # | Surface | Legacy source (LOC) | Trigger seam | Difficulty |
|---|---|---|---|---|
| 1 | production-overview | `src/controllers/production-overview.ts` (~400) | `open(burgId)` ← burg-editor | easy |
| 2 | minimap | `src/controllers/minimap.ts` (~140) | `openMinimapDialog()` | easy |
| 3 | routes-overview | `public/modules/ui/routes-overview.js` (~220) | `overviewRoutes()` global | easy |
| 4 | rivers-overview | `public/modules/ui/rivers-overview.js` (~220) | `overviewRivers()` global | easy |
| 5 | markers-overview | `public/modules/ui/markers-overview.js` (~260) | `overviewMarkers()` global | easy-medium |
| 6 | regiments-overview | `src/controllers/regiments-overview.ts` (~330) | `open(state = -1)` ← military-overview, menu | medium |
| 7 | military-overview | `src/controllers/military-overview.ts` (~570) | `open()` | medium |
| 8 | heightmap-selection | `src/controllers/heightmap-selection.ts` (~340) | `open()` ← heightmap flow | medium |
| 9 | elevation-profile | `src/controllers/elevation-profile.ts` (~565) | `open(cells, routeLen, isRiver)` ← route/river editors | medium-hard |
| 10 | hierarchy-tree | `src/controllers/hierarchy-tree.ts` (~560) | `open(props)` ← states/cultures/religions editors | hard |
| 11 | production-chains | `src/controllers/production-chains.ts` (~880, static class) | `ProductionChains.open()` | hard |
| 12 | charts-overview | `src/controllers/charts-overview.ts` (~1,020 — largest) | `open()` | hard |

## Testing Decisions

Per recipe step 7, every slice ships the same three layers, plus the standing regression gate:

- **Accessor node tests** (`src/ui/world-state.test.ts`): the read shape of any getter the slice
  adds (guarded for an absent world); for surfaces with parity row-actions, the mutate/signal
  behavior.
- **Surface browser tests** (React Testing Library, `*.browser.test.tsx`): stub the world via the
  `window.X` bridge; assert rows/chart frame render, controls behave (search, sort, filters,
  toggles, selectors), exports match, reactivity re-reads on `act(() => notifyWorldChanged())`,
  and invalid-input guards fire. For d3 surfaces, assert the frame/controls behavior and that the
  chart mounts/cleans up — d3's internal geometry is not unit-asserted.
- **Parity e2e** (`tests/e2e/*-parity.spec.ts`): load `tests/fixtures/demo.map`, trigger via the
  REAL seam, assert the React panel and its actions, assert the legacy element is gone, and assert
  `collectConsoleErrors(page).critical()` is empty.
- **`.map` round-trip gate:** the existing round-trip tests must stay **byte-identical** on every
  slice — a read-only surface never perturbs them.

## Out of Scope

- **markets-overview** — the foundation census listed it as read-only, but it mutates: a manual
  market-assignment mode writing `pack.cells.market`, `removeMarket`, bulk recolor, regenerate,
  and an undo stack. It belongs with the Phase 4a economy editors, where the mutate →
  bridge-redraw pattern is established.
- **view-3d** — no dialog `open()` seam; it is a thin wrapper over a lazily-loaded Three.js
  renderer plus a control-panel UI. It doesn't fit the panel recipe and needs its own design when
  scheduled.
- **Everything the foundation PRD already excludes** — rendering map cells in React, the hybrid
  renderer program, mutating editors (Phase 4), presentation/renderer-coupled surfaces (Phase 5),
  app frame and cutover (Phases 6–7), window-manager/resize work behind the `<Panel>` interface.

## Further Notes

- **Roadmap:** this PRD is the Phase 3 row of `docs/roadmap.md` Wave 3. Note the renderer track
  only gates Phase 5 presentation surfaces, not Phase 3 (foundation PRD § Migration Waves) — this
  PRD has no unmet dependencies.
- **Slice discipline:** slices are linear (each blocked by the previous) so recurring patterns
  (thin TS seam, bulkBars replacement, d3-in-React) are settled once, early, and copied.
- **HITL:** exactly one HITL slice, at the end, covering all 12 surfaces (CLAUDE.md: HITL once per
  feature, not per slice).

## Vertical Slices

### Slice 1 — production-overview  [AFK]
- Status: todo
- Blocked by: none
- User stories: 1, 3, 4

**What to build:** Convert `src/controllers/production-overview.ts` (~400 LOC), the burg
production/deal-history overview opened by the burg editor via `open(burgId)`. Pure read. The
legacy code renders styled tables with expandable deal/decision rows into the shared `#alert`
dialog via `alertMessage.innerHTML` — convert it to a real registered `<Panel>` surface.

**Acceptance criteria:**
- [ ] `open(burgId)` (seam preserved) opens a `<Panel>` surface; the burg-editor caller is
  unchanged and still opens it.
- [ ] Production tables and expandable deal/decision rows reach parity with the legacy `#alert`
  rendering.
- [ ] The surface no longer touches `alertMessage.innerHTML`; legacy rendering code is deleted.
- [ ] Reads only via the accessor with `useWorldVersion()`; tests per recipe (accessor getters,
  RTL browser test, parity e2e); `.map` round-trip byte-identical.
- [ ] `tsc`, `biome`, vitest (node + browser), and playwright are green.

### Slice 2 — minimap  [AFK]
- Status: todo
- Blocked by: Slice 1
- User stories: 1, 3, 4

**What to build:** Convert `src/controllers/minimap.ts` (~140 LOC), opened via
`openMinimapDialog()`. Renders an SVG `<use href="#viewbox">` mirror of the map plus a viewport
rect, with click-to-pan via `zoomTo` and a `window.updateMinimap` hook. Today it builds its
markup and styles dynamically.

**Acceptance criteria:**
- [ ] `openMinimapDialog()` (seam preserved) opens the minimap in a `<Panel>`.
- [ ] The `<use href="#viewbox">` mirror, viewport rect, and click-to-pan (`zoomTo`, called
  guarded) reach parity; the `window.updateMinimap` hook keeps working.
- [ ] Legacy dynamic markup/styles are deleted.
- [ ] Tests per recipe; `.map` round-trip byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 3 — routes-overview  [AFK]
- Status: todo
- Blocked by: Slice 2
- User stories: 1, 3, 4, 5, 7

**What to build:** Convert `public/modules/ui/routes-overview.js` (~220 LOC), triggered by the
`overviewRoutes()` global. Table + search + lock-all/remove-all + bulk-delete, currently wired
through the legacy `window.bulkBars`. First legacy-JS conversion: add a thin typed controller
seam in `src/controllers/` so callers keep a lazy `open()`, and replace `bulkBars` per-surface
the way MarketDeals did.

**Acceptance criteria:**
- [ ] A thin TS controller seam in `src/controllers/` preserves the trigger; `overviewRoutes()`
  callers still open the surface.
- [ ] Search filter, lock-all/remove-all, and bulk-delete reach parity; bulk-delete uses the
  existing domain-core logic and signals via `notifyWorldChanged()` (no new mutation patterns).
- [ ] The `window.bulkBars` integration for this surface is replaced per the MarketDeals pattern.
- [ ] `public/modules/ui/routes-overview.js` and its static markup are deleted in this slice.
- [ ] Tests per recipe; `.map` round-trip byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 4 — rivers-overview  [AFK]
- Status: todo
- Blocked by: Slice 3
- User stories: 1, 3, 4, 5, 7

**What to build:** Convert `public/modules/ui/rivers-overview.js` (~220 LOC), triggered by the
`overviewRivers()` global. Same shape as routes-overview — table with multi-field search (name,
type, basin via basin lookup), bulk actions — reusing the seam + bulkBars-replacement pattern
Slice 3 established.

**Acceptance criteria:**
- [ ] Thin TS controller seam; `overviewRivers()` callers unchanged.
- [ ] Multi-field search (including basin lookup) and bulk row-actions reach parity, signalling
  via `notifyWorldChanged()`.
- [ ] `public/modules/ui/rivers-overview.js` and its static markup are deleted in this slice.
- [ ] Tests per recipe; `.map` round-trip byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 5 — markers-overview  [AFK]
- Status: todo
- Blocked by: Slice 4
- User stories: 1, 3, 4, 5, 7

**What to build:** Convert `public/modules/ui/markers-overview.js` (~260 LOC), triggered by the
`overviewMarkers()` global. Table + marker-type selector + pin/lock invert toggles + search +
bulk bar. Third and last legacy-JS overview; reuses the Slice 3 pattern.

**Acceptance criteria:**
- [ ] Thin TS controller seam; `overviewMarkers()` callers unchanged.
- [ ] Marker-type selector, pin/lock invert toggles, search filter, and bulk row-actions reach
  parity, signalling via `notifyWorldChanged()`.
- [ ] `public/modules/ui/markers-overview.js` and its static markup are deleted in this slice.
- [ ] Tests per recipe; `.map` round-trip byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 6 — regiments-overview  [AFK]
- Status: todo
- Blocked by: Slice 5
- User stories: 1, 3, 4, 7

**What to build:** Convert `src/controllers/regiments-overview.ts` (~330 LOC), opened via
`open(state = -1)` by military-overview and the menu. State filter, percentage toggle, and
bulk-delete using a composite id encoding (stateId + regimentId) delegating to
`regiments-cascade.ts`; deletion has an SVG side-effect removing the matching `#armies > g`
groups.

**Acceptance criteria:**
- [ ] `open(state = -1)` seam preserved; both callers (military-overview, menu) unchanged.
- [ ] State filter, percentage toggle, and bulk-delete (composite stateId+regimentId ids through
  `regiments-cascade.ts`, signalling via `notifyWorldChanged()`) reach parity.
- [ ] The `#armies > g` SVG removal on delete still happens (guarded global side-effect).
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 7 — military-overview  [AFK]
- Status: todo
- Blocked by: Slice 6
- User stories: 1, 3, 4

**What to build:** Convert `src/controllers/military-overview.ts` (~570 LOC), opened via
`open()`. Table + percentage toggle + d3 hover transitions highlighting a state's armies on the
map (`#armies`, `#regions`, `#debug`); a row action opens regiments-overview (converted in
Slice 6).

**Acceptance criteria:**
- [ ] `open()` seam preserved; table and percentage toggle reach parity.
- [ ] Hover highlighting of state armies on the map (`#armies`/`#regions`/`#debug` d3
  transitions) works, called as guarded side-effects with cleanup on unmount.
- [ ] Opening regiments-overview from a row works against the Slice 6 React surface.
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 8 — heightmap-selection  [AFK]
- Status: todo
- Blocked by: Slice 7
- User stories: 1, 3, 4

**What to build:** Convert `src/controllers/heightmap-selection.ts` (~340 LOC), opened via
`open()` from the heightmap flow. A canvas thumbnail grid of heightmap templates plus options and
Cancel / Select / New Map buttons.

**Acceptance criteria:**
- [ ] `open()` seam preserved; the heightmap flow still opens it.
- [ ] Canvas thumbnail grid renders all templates; options and Cancel/Select/New Map buttons
  reach parity (Select/New Map invoke the existing flow callbacks unchanged).
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 9 — elevation-profile  [AFK]
- Status: todo
- Blocked by: Slice 8
- User stories: 1, 2, 3, 4, 6

**What to build:** Convert `src/controllers/elevation-profile.ts` (~565 LOC), opened via
`open(cells, routeLen, isRiver)` by the route/river editors. A d3 line chart with a curve-type
selector, biome/burg bands, and CSV/SVG/PNG export. First d3-in-dialog surface: establish the
pattern — d3 renders into a ref'd SVG inside `useEffect` with cleanup; React owns the frame and
controls.

**Acceptance criteria:**
- [ ] `open(cells, routeLen, isRiver)` seam preserved; route and river editor callers unchanged.
- [ ] d3 chart renders in a ref'd SVG via `useEffect` with cleanup; curve-type selector re-renders
  the chart; biome/burg bands reach parity.
- [ ] CSV, SVG, and PNG exports match legacy output (CSV via `csvField`; downloads via existing
  guarded globals).
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 10 — hierarchy-tree  [AFK]
- Status: todo
- Blocked by: Slice 9
- User stories: 1, 2, 3, 4, 6

**What to build:** Convert `src/controllers/hierarchy-tree.ts` (~560 LOC), opened via
`open(props)` by the states, cultures, and religions editors. d3 `stratify`/tree layout with zoom
and drag, node enter/leave callbacks back into the calling editor, and a dynamically-injected
stylesheet. Follows the Slice 9 d3 pattern.

**Acceptance criteria:**
- [ ] `open(props)` seam preserved; states/cultures/religions editor callers unchanged.
- [ ] d3 stratify/tree renders in a ref'd SVG; zoom and drag reach parity; node enter/leave
  callbacks fire into the calling editor as before.
- [ ] The dynamic-stylesheet behavior is preserved (or replaced by equivalent scoped styles)
  with cleanup on unmount.
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 11 — production-chains  [AFK]
- Status: todo
- Blocked by: Slice 10
- User stories: 1, 2, 3, 4, 6

**What to build:** Convert `src/controllers/production-chains.ts` (~880 LOC, a static class),
opened via `ProductionChains.open()`. d3 graph layout with animated flow dots, zoom/pan, and
hover interactions. Follows the d3 pattern; the animation timers live inside the d3-owned chart
and are torn down in the effect cleanup.

**Acceptance criteria:**
- [ ] `ProductionChains.open()` seam preserved; callers unchanged.
- [ ] d3 graph layout, animated flow dots, zoom/pan, and hover interactions reach parity;
  animation timers stop on unmount (no leaks over open/close cycles).
- [ ] Legacy rendering + static markup deleted (the static class body reduced to the seam);
  tests per recipe; `.map` round-trip byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 12 — charts-overview  [AFK]
- Status: todo
- Blocked by: Slice 11
- User stories: 1, 2, 3, 4, 6

**What to build:** Convert `src/controllers/charts-overview.ts` (~1,020 LOC — the largest Phase 3
surface), opened via `open()`. d3 stacked-bar charts with dimension/metric selectors and multiple
aggregations. Last surface; pure application of the established d3 pattern.

**Acceptance criteria:**
- [ ] `open()` seam preserved; callers unchanged.
- [ ] Dimension and metric selectors re-render the chart; every aggregation mode matches legacy
  output; stacked bars reach visual/behavioral parity.
- [ ] Legacy rendering + static markup deleted; tests per recipe; `.map` round-trip
  byte-identical; `tsc`/`biome`/vitest/playwright green.

### Slice 13 — HITL verification: all 12 surfaces  [HITL]
- Status: todo
- Blocked by: Slice 12
- User stories: 1, 2, 3

**What to build:** Nothing — the single end-of-feature human check (per CLAUDE.md, HITL happens
once at the end of the feature). The user exercises each converted surface against a real map:

**Acceptance criteria:**
- [ ] **production-overview:** open a burg's production from the burg editor; tables render;
  deal/decision rows expand/collapse.
- [ ] **minimap:** open the minimap; it mirrors the map; clicking pans the main view; the
  viewport rect tracks zoom/pan.
- [ ] **routes-overview:** open; search filters; lock-all/remove-all and bulk-delete work; map
  routes update.
- [ ] **rivers-overview:** open; multi-field search (incl. basin) filters; bulk actions work.
- [ ] **markers-overview:** open; type selector filters; pin/lock invert toggles work; search +
  bulk bar work.
- [ ] **regiments-overview:** open from military-overview and from the menu; state filter and
  percentage toggle work; bulk-delete removes regiments and their `#armies` groups on the map.
- [ ] **military-overview:** open; percentage toggle works; hovering a state row highlights its
  armies on the map and clears on leave; a row opens regiments-overview.
- [ ] **heightmap-selection:** trigger the heightmap flow; template thumbnails render;
  Cancel/Select/New Map behave as before.
- [ ] **elevation-profile:** open from a route and from a river; chart renders with biome/burg
  bands; curve selector changes the line; CSV/SVG/PNG exports download.
- [ ] **hierarchy-tree:** open from states, cultures, and religions editors; tree renders; zoom/
  drag work; hovering/leaving nodes updates the calling editor.
- [ ] **production-chains:** open; graph renders with animated flow dots; zoom/pan and hover
  work; closing and reopening doesn't degrade (no timer leaks).
- [ ] **charts-overview:** open; switch dimensions, metrics, and aggregations; charts update
  correctly.
- [ ] General health: panels drag/close; the map and other menus are unaffected; a real `.map`
  saves and reloads identically.
