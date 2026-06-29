# Architecture Review — Results

Durable log of the `/improve-codebase-architecture` review (run 2026-06-28). The review hunts
**deepening opportunities** — turning *shallow* modules (interface ≈ implementation) into *deep*
ones, judged by the **deletion test** (delete the module: does complexity vanish — a pass-through
— or reappear across N callers — earning its keep?). The full interactive HTML report was written
to a temp file and is ephemeral; **this doc is the canonical record.**

Each finding has a **Disposition** (`Open` until decided) to be resolved during PRD grilling.

> **Read this with the migration decision.** These findings interact with the open question of
> [where the migration stands and whether to finish or re-platform it](./migration-status.md).
> The **"Survives UI re-platform?"** tag on each finding flags whether it is a stack-independent
> core-domain win (do it regardless) or a UI-layer change a re-platform would change or obviate
> (defer until the migration direction is set). **Decide the migration direction first; it gates
> half of these findings.**

## Summary

| ID | Finding | Strength | Survives UI re-platform? | Disposition |
|----|---------|----------|--------------------------|-------------|
| AR-1 | `.map` serialization is a contract split across two files | **Strong** | ✅ Yes — persistence/domain | **Planned — now (first PRD)** |
| AR-6 | `grid` global is typed `any` | **Strong (small)** | ✅ Yes — domain types | **Planned — now (tiny PRD)** |
| AR-3 | Economy pipeline sequenced at one buried call site | Worth exploring | ✅ Yes — generators/domain | **Planned — soon (backlog)** |
| AR-2 | Per-type delete cascade logic split + re-derived 9× | Worth exploring | ◐ Partial — logic stays, UI changes | **Deferred — reshaped by re-platform** |
| AR-5 | ~50 SVG layer ids hardcoded across load + renderers + monolith | Worth exploring | ◐ Partial — tied to SVG/index.html | **Deferred — fold into renderer design** |
| AR-4 | Every editor hand-rolls the same dialog lifecycle | Worth exploring | ❌ No — a UI framework solves this natively | **Rejected — obviated by React** |
| AR-7 | Renderer draw scaffolding & exporter canvas boilerplate | Speculative | ❌ No — render/UI layer | **Deferred — reshaped by re-platform** |

**Stack-independent (do regardless of the migration call): AR-1, AR-6, AR-3.**
**Gated by the migration call: AR-2, AR-5, AR-4, AR-7.**

> **Decisions landed (2026-06-28 Align & Plan grilling).** The migration direction is set:
> **re-platform the UI on React with a hybrid WebGL+SVG renderer** ([ADR-0002](../adr/adr-0002-ui-replatform-react-webgl.md)),
> with UI/UX as the lead north-star goal. Stack-independent **AR-1** (first PRD) and **AR-6**
> (tiny PRD) proceed now; **AR-3** is queued in the backlog. The UI-gated findings are
> resolved by the re-platform: **AR-4** is obviated by React's component lifecycle; **AR-2**,
> **AR-5**, and **AR-7** are reshaped — their domain logic survives and folds into the new
> design rather than being refactored on the legacy stack. See each finding below for the
> per-finding rationale.

---

## Findings

### AR-1 — The `.map` serialized shape is a contract split across two files · Strong · survives re-platform
- **Files:** `src/io/save.ts` (258 lines; write side at `save.ts:137–184`), `src/io/load.ts` (843; read side at `load.ts:233–360+`).
- **Problem:** `save.ts` builds a ~46-element array joined by `\r\n`; `load.ts` reads it back by **raw positional index** (`data[33]` rulers, `data[34]` fonts, `settings[24]` urban density — none named). Adding a field means editing two files ~600 lines apart; **7 deprecated slots are kept as `""`/`[]` placeholders** purely so positions don't shift. The architecture doc already asserts "the serialized shape is a contract" — but the contract has no single home.
- **Deletion test:** reappears — both halves do real work, but the *knowledge* (which index means what) lives nowhere.
- **Deepening:** one schema module that names each field once and says how to read/write it; `save`/`load` project through it. The field list becomes the test surface — a single round-trip property test catches asymmetry.
- **Note:** the fork's **temporal save-states** goal will extend this format heavily — strong reason to deepen it *first*.
- **Disposition:** **Planned — now (first PRD).** Scope is a compatibility-safe naming layer only — current positions preserved, dead slots named as `reserved`, no renumbering. See `docs/prds/backlog/ar-1-map-schema-module.md` and [ADR-0002](../adr/adr-0002-ui-replatform-react-webgl.md).
- **Verified 2026-06-28:** confirmed against code — `save.ts:136` builds the joined array (incl. `[], // deprecated` slots); `load.ts` reads back by raw position (`data[N]`/`settings[N]`).

### AR-6 — Type the `grid` global · Strong (small) · survives re-platform
- **Files:** `src/types/global.ts:11` (`var grid: any`); ~264 `grid.*` accesses across generators/renderers/io.
- **Problem:** `pack` is typed `PackedGraph` (1,191 refs checked) but its sibling `grid` is `any` (264 refs unchecked) — a core domain entity hiding behind `any`.
- **Deepening:** write a `GridGraph` interface (mirroring `PackedGraph`) and point `var grid` at it. ~50 lines, consulted by 264 sites. Cheapest high-leverage win in the review.
- **Note:** does **not** propose removing the documented `window.X` bridge — only typing one global.
- **Disposition:** **Planned — now (tiny PRD).** Follows AR-1. See `docs/prds/backlog/ar-6-type-grid-global.md`.
- **Verified 2026-06-28:** confirmed — `global.ts:10-11` (`var pack: PackedGraph` vs `var grid: any`); ~150 `grid.*` accesses in `src/` (the 264 figure includes `public/`).

### AR-3 — The economy pipeline is sequenced at one buried call site · Worth exploring · survives re-platform
- **Files:** `src/generators/goods-generator.ts` (1,125), `markets-generator.ts` (595), `production-generator.ts` (849); sequenced only at `src/io/auto-update.ts:1175–1178`.
- **Problem:** `Goods.generate() → Markets.generate() → Production.produce() → States.collectTaxes()` is a tightly-ordered pipeline whose order lives in a version-migration file and is re-stated in editors/tests. `Production.produce()` reaches across the seam into `Markets.*`/`Goods.get()` via globals. The largest economic subsystem (~2,570 lines) can only be exercised by booting the whole `pack`.
- **Deepening:** one economy orchestrator with explicit in/out (state + options → deals/production/treasury); the order becomes named and testable. Matches the architecture doc's own pipeline vision.
- **Disposition:** **Planned — soon (backlog).** Stack-independent; queued after AR-1/AR-6, not in the first PRD. See `docs/prds/backlog/ar-3-economy-orchestrator.md`.
- **Verified 2026-06-28:** the doc *understates* this — the `Goods→Markets→Production→collectTaxes` order is duplicated across **6+ call sites** (`public/main.js:691-714`, `tools.js` ×2, `heightmap-editor.js` ×2, `auto-update.ts:1175`), several in legacy JS. An orchestrator would need `window.X` exposure to serve legacy callers during transition.

### AR-2 — Per-type delete cascade logic is split and re-derived 9× · Worth exploring · partial survival
- **Files:** `src/controllers/bulk-action/bulk-entity-adapter.ts` (54, the seam), `bulk-action/adapters/*.ts` (7 files, 397), `controllers/*-cascade.ts` (5 files, 322), plus inline adapters in states/cultures/religions editors.
- **Problem:** the `BulkEntityAdapter` interface is a good seam, but ~9 types hand-roll the same quartet (`find` → `isDeletable` → `isLocked` → `describeCascade` → factory), and each type's delete behavior is split between `adapters/` and `*-cascade.ts`.
- **Deepening:** co-locate each type's full delete story behind one registration; the shared core supplies describe/confirm/bulk choreography.
- **Re-platform caveat:** the cascade *logic* (which cells/burgs/notes to reassign) survives any UI; the *bar UI + adapter wiring* would be rebuilt on a new stack.
- **Disposition:** **Deferred — reshaped by re-platform.** Do not refactor on the legacy stack. The cascade *logic* folds into the domain core as React rebuilds the bar/adapter UI. Captured in `docs/prds/backlog/replatform-program.md`.

### AR-5 — ~50 SVG layer ids are magic strings across load + renderers + the monolith · Worth exploring · partial survival
- **Files:** `src/io/load.ts:346–397` (~50 `viewbox.select("#…")`), ~18 `renderers/draw-*.ts`, `src/index.html` (where the `<g>` groups and `<defs>` are declared).
- **Problem:** the Layer structure is an implicit interface with no declaration — ids are hardcoded in three places, declared in none.
- **Deepening:** one module declares the layer tree (id, parent, order, required defs); load re-selects from it, renderers reference it.
- **Re-platform caveat:** strongly tied to the SVG renderer + `index.html`; a WebGL/canvas re-platform reshapes this entirely. Worth it under "complete the migration," largely moot under "re-platform the renderer."
- **Disposition:** **Deferred — fold into renderer design.** The chosen hybrid WebGL+SVG renderer *needs* a declared layer tree (id, parent, order, which renderer owns it), so the idea survives and strengthens — but the current SVG-id form is superseded. Captured in `docs/prds/backlog/replatform-program.md`.

### AR-4 — Every editor hand-rolls the same dialog lifecycle · Worth exploring · does NOT survive re-platform
- **Files:** `states-editor.ts` (1,759), `cultures-editor.ts` (1,083), `religions-editor.ts` (958), markets/regiments overviews, etc.
- **Problem:** each `open()` repeats close-others → toggle-layers → refresh → mount-bulk-bar → `$.dialog` → close-handler (~200–300 lines of ceremony). The architecture doc's "build on open, destroy on close" is enforced by copy-paste, not a module.
- **Deepening:** a deep dialog-lifecycle module owning open/close/teardown, driven by a small per-editor declaration.
- **Re-platform caveat:** **a reactive UI framework gives this for free** (component mount/unmount). Doing this by hand now is largely wasted effort if the UI is re-platformed — **defer until the migration call.**
- **Disposition:** **Rejected — obviated by React.** The migration call (ADR-0002) chose React; component mount/unmount *is* this finding. No standalone work.

### AR-7 — Renderer draw scaffolding & exporter canvas boilerplate · Speculative · does NOT survive re-platform
- **Files:** ~12 `renderers/draw-*.ts` (repeat `time → clear group → build string → inject`), `io/export.ts` (794; PNG/JPEG/tiles repeat canvas/blob plumbing around the already-deep `getMapURL()`).
- **Problem:** thin, low-leverage repetition; the per-renderer content is the real substance.
- **Deepening:** a small shared `renderLayer` wrapper / `canvasToDownload` helper. Low urgency; fold into other work.
- **Disposition:** **Deferred — reshaped by re-platform.** The render layer is being rebuilt (hybrid WebGL+SVG); any scaffolding emerges from the new renderer, not a legacy-stack refactor. Captured in `docs/prds/backlog/replatform-program.md`.

---

## Top recommendation & suggested order

1. **AR-1 (`.map` schema) + AR-6 (`grid` typing)** — both **Strong**, both **stack-independent**, both directly relevant to the fork's data-layer future (temporal save-states). Highest value, lowest regret. Do these first **regardless** of the migration decision.
2. **AR-3 (economy orchestrator)** — stack-independent; unblocks testing the biggest untested subsystem.
3. **AR-2 / AR-5 / AR-4 / AR-7** — **gated by the migration decision** ([migration-status.md](./migration-status.md)). If the UI is re-platformed, AR-4/AR-7 are obviated and AR-2/AR-5 are reshaped. Do not invest here until the direction is set.

## How to use this doc

- Each finding's **Disposition** stays `Open` until decided in PRD grilling; update it to `Planned`, `Deferred`, or `Rejected` (with a one-line reason) as decisions land.
- Findings that become work should produce a PRD under `docs/prds/backlog/`; load-bearing architecture changes need an ADR (`docs/adr/`).
- This log is a snapshot; verify line numbers against the code before acting (the code is authoritative).
