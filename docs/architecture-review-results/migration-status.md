# Migration Status & the Strategic Fork

*Companion to [the architecture review results](./README.md). Snapshot date 2026-06-28. Line
counts are approximate; the `src/` and `public/` trees are authoritative.*

The project has been incrementally migrating from un-bundled vanilla JavaScript (`public/`,
runtime globals, jQuery) toward the typed, modular **FMG 2.0** architecture in `src/` (see
`ARCHITECTURE.md` for the target, `docs/architecture/original-architecture.md` for the current
baseline). This doc answers two questions the fork now has to settle: **where is the migration,
and do we finish it or re-platform?**

## Where we are (by the numbers)

| Bucket | Lines | State |
|---|---:|---|
| `src/**/*.ts` (non-test) | ~48,800 | **Migrated** — generators, renderers, io, services, utils, types, and the *newer* controllers |
| `src/**/*.test.ts` | ~3,700 | test suite (≈26 unit files) |
| `public/modules/**/*.js` (39 files) | ~18,900 | **Legacy** — almost all of `public/modules/ui/` (38 editor/tool/overview scripts) |
| `public/main.js` | ~1,300 | **Legacy** — the true entry point / generation orchestrator |
| other `public/*.js` (config, versioning, sw) | ~1,900 | **Legacy** — config + service worker |
| `src/index.html` | ~9,000 | **Legacy shell** — the whole UI structure, SVG `<defs>`, CSS (HTML, not "port to TS" — *dismantle into components*) |
| `public/libs/*` | — | vendored globals for legacy: **d3 v5, jQuery + jQuery UI + touch-punch**, three, tinymce, jszip, dropbox-sdk, … |

**~49k TS migrated vs ~22k legacy JS + a 9k-line HTML monolith → roughly 70% by volume.** But
volume hides the truth: **the migrated 70% was the well-bounded, testable layers (the model and
the view); the remaining 30% is the UI editor/tool layer, the bootstrap, and the shell — the most
tightly globals-coupled, jQuery-bound, hardest part.**

### The UI is split-brain

- **Migrated to TS** (`src/controllers/`): the *newer* surfaces — economy UI (goods/markets/
  production/trade), states/cultures/religions editors, regiments, charts, the bulk-action bar.
- **Still legacy jQuery** (`public/modules/ui/`, ~38 files): most older editors — biomes, burg,
  coastline, diplomacy, emblems, heightmap, ice, labels, lakes, markers, notes, provinces, relief,
  rivers, routes, units, zones — plus overviews, `submap`/`transform` tools, and core UI
  (`layers`, `options`, `style`, `hotkeys`, `measurers`, `world-configurator`).

So "finishing the migration" is, almost exactly, **rebuilding the UI editor layer** — and the UI
is precisely what the fork's north star wants to overhaul anyway (see `AGENTS.md`: temporal
save-states, multi-map globes, performance, UI/UX). That coupling is the crux of the decision.

## The strategic options

### Option A — Complete the migration in place (vanilla TS)
Port the ~38 legacy editors + `main.js` to `src/`, dismantle `index.html` into build-on-open
components, drop the `window.X` bridge, and remove jQuery / d3 v5.
- **Pros:** one coherent stack; honors the existing `ARCHITECTURE.md` direction; leaner memory; no new dependencies; `.map` untouched.
- **Cons:** the remaining work *is* the hardest, most coupled code; hand-rolled vanilla DOM does not advance the UI/UX or temporal/multi-map goals — you'd port jQuery editors to TS and *then still* rebuild them for the new features. High effort, low strategic payoff.

### Option B — Re-platform the UI on a modern stack
Keep the proven TS **domain core** (generators, state, io/serialization) and rebuild the UI on a
reactive framework (e.g. Svelte/Solid/React), evaluating a **WebGL/canvas renderer** for
performance and multi-map globes.
- **Pros:** directly serves UI/UX + performance + the state-heavy temporal/multi-map goals; a component model gives editor lifecycle/teardown for free (obviates AR-4, reshapes AR-2/AR-5); fresh state management suits time-travel/save-states.
- **Cons:** large rewrite; introduces framework + build complexity (needs an ADR per the axioms); must preserve `.map` compatibility; a dual-renderer transition period.

### Option C — Strangler-fig hybrid (recommended starting hypothesis)
Freeze the legacy shell; build **new** features (temporal, multi-map) and newly-touched editors on
the new stack, mounted alongside the old; delete legacy as each surface is superseded. Migrate
opportunistically rather than big-bang.
- **Pros:** avoids a risky stop-the-world rewrite; ships fork value early; keeps `.map` + domain core stable; lets the new stack prove itself before full commitment.
- **Cons:** two UI stacks coexist for a while (the `window.X` bridge keeps earning its keep as the seam); needs discipline to actually retire legacy, not just accrete a third world.

## What to grill on (decision criteria)

1. **Which north-star goal leads first?** Temporal save-states and multi-map globes are
   data-model + state-management heavy; UI/UX and performance are renderer + framework heavy. The
   answer reorders everything.
2. **`.map` compatibility** is non-negotiable — every option must round-trip existing maps. This
   pressures AR-1 (schema) to the front.
3. **SVG ceiling vs WebGL.** Does "performance on large worlds + multiple stitched globes" need a
   canvas/WebGL renderer, or can SVG carry it? This is the single biggest re-platform lever.
4. **Rewrite-risk appetite & bandwidth** (solo project). Big-bang vs strangler.
5. **The `window.X` bridge & global `pack`/`grid`:** interop seam to keep during a strangler, or
   debt to excise? (Ties to AR-6.)

## Provisional lean (a hypothesis for grilling, **not** a decision)

Because the unfinished migration *is* the UI layer, and the fork's headline goals are UI- and
state-heavy, **hand-finishing the vanilla-TS migration (Option A) looks like the lowest-leverage
path.** A **strangler-fig re-platform (C → B)** that preserves the TS domain/generation/io core and
rebuilds the UI on a modern reactive stack — while seriously evaluating WebGL for the renderer —
is the most defensible direction. The domain core (generators, state, serialization) is an asset
to **preserve in every option**; the jQuery UI shell is the liability to retire.

This is a **load-bearing architecture decision** and must be made *with* the user and recorded as
an ADR — do not decide it unilaterally. The stack-independent review findings (**AR-1, AR-6,
AR-3**) are safe and valuable to pursue *now*, in parallel, no matter which option wins.
