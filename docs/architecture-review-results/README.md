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
| AR-1 | `.map` serialization is a contract split across two files | **Strong** | ✅ Yes — persistence/domain | Open |
| AR-6 | `grid` global is typed `any` | **Strong (small)** | ✅ Yes — domain types | Open |
| AR-3 | Economy pipeline sequenced at one buried call site | Worth exploring | ✅ Yes — generators/domain | Open |
| AR-2 | Per-type delete cascade logic split + re-derived 9× | Worth exploring | ◐ Partial — logic stays, UI changes | Open |
| AR-5 | ~50 SVG layer ids hardcoded across load + renderers + monolith | Worth exploring | ◐ Partial — tied to SVG/index.html | Open |
| AR-4 | Every editor hand-rolls the same dialog lifecycle | Worth exploring | ❌ No — a UI framework solves this natively | Open |
| AR-7 | Renderer draw scaffolding & exporter canvas boilerplate | Speculative | ❌ No — render/UI layer | Open |

**Stack-independent (do regardless of the migration call): AR-1, AR-6, AR-3.**
**Gated by the migration call: AR-2, AR-5, AR-4, AR-7.**

---

## Findings

### AR-1 — The `.map` serialized shape is a contract split across two files · Strong · survives re-platform
- **Files:** `src/io/save.ts` (258 lines; write side at `save.ts:137–184`), `src/io/load.ts` (843; read side at `load.ts:233–360+`).
- **Problem:** `save.ts` builds a ~46-element array joined by `\r\n`; `load.ts` reads it back by **raw positional index** (`data[33]` rulers, `data[34]` fonts, `settings[24]` urban density — none named). Adding a field means editing two files ~600 lines apart; **7 deprecated slots are kept as `""`/`[]` placeholders** purely so positions don't shift. The architecture doc already asserts "the serialized shape is a contract" — but the contract has no single home.
- **Deletion test:** reappears — both halves do real work, but the *knowledge* (which index means what) lives nowhere.
- **Deepening:** one schema module that names each field once and says how to read/write it; `save`/`load` project through it. The field list becomes the test surface — a single round-trip property test catches asymmetry.
- **Note:** the fork's **temporal save-states** goal will extend this format heavily — strong reason to deepen it *first*.

### AR-6 — Type the `grid` global · Strong (small) · survives re-platform
- **Files:** `src/types/global.ts:11` (`var grid: any`); ~264 `grid.*` accesses across generators/renderers/io.
- **Problem:** `pack` is typed `PackedGraph` (1,191 refs checked) but its sibling `grid` is `any` (264 refs unchecked) — a core domain entity hiding behind `any`.
- **Deepening:** write a `GridGraph` interface (mirroring `PackedGraph`) and point `var grid` at it. ~50 lines, consulted by 264 sites. Cheapest high-leverage win in the review.
- **Note:** does **not** propose removing the documented `window.X` bridge — only typing one global.

### AR-3 — The economy pipeline is sequenced at one buried call site · Worth exploring · survives re-platform
- **Files:** `src/generators/goods-generator.ts` (1,125), `markets-generator.ts` (595), `production-generator.ts` (849); sequenced only at `src/io/auto-update.ts:1175–1178`.
- **Problem:** `Goods.generate() → Markets.generate() → Production.produce() → States.collectTaxes()` is a tightly-ordered pipeline whose order lives in a version-migration file and is re-stated in editors/tests. `Production.produce()` reaches across the seam into `Markets.*`/`Goods.get()` via globals. The largest economic subsystem (~2,570 lines) can only be exercised by booting the whole `pack`.
- **Deepening:** one economy orchestrator with explicit in/out (state + options → deals/production/treasury); the order becomes named and testable. Matches the architecture doc's own pipeline vision.

### AR-2 — Per-type delete cascade logic is split and re-derived 9× · Worth exploring · partial survival
- **Files:** `src/controllers/bulk-action/bulk-entity-adapter.ts` (54, the seam), `bulk-action/adapters/*.ts` (7 files, 397), `controllers/*-cascade.ts` (5 files, 322), plus inline adapters in states/cultures/religions editors.
- **Problem:** the `BulkEntityAdapter` interface is a good seam, but ~9 types hand-roll the same quartet (`find` → `isDeletable` → `isLocked` → `describeCascade` → factory), and each type's delete behavior is split between `adapters/` and `*-cascade.ts`.
- **Deepening:** co-locate each type's full delete story behind one registration; the shared core supplies describe/confirm/bulk choreography.
- **Re-platform caveat:** the cascade *logic* (which cells/burgs/notes to reassign) survives any UI; the *bar UI + adapter wiring* would be rebuilt on a new stack.

### AR-5 — ~50 SVG layer ids are magic strings across load + renderers + the monolith · Worth exploring · partial survival
- **Files:** `src/io/load.ts:346–397` (~50 `viewbox.select("#…")`), ~18 `renderers/draw-*.ts`, `src/index.html` (where the `<g>` groups and `<defs>` are declared).
- **Problem:** the Layer structure is an implicit interface with no declaration — ids are hardcoded in three places, declared in none.
- **Deepening:** one module declares the layer tree (id, parent, order, required defs); load re-selects from it, renderers reference it.
- **Re-platform caveat:** strongly tied to the SVG renderer + `index.html`; a WebGL/canvas re-platform reshapes this entirely. Worth it under "complete the migration," largely moot under "re-platform the renderer."

### AR-4 — Every editor hand-rolls the same dialog lifecycle · Worth exploring · does NOT survive re-platform
- **Files:** `states-editor.ts` (1,759), `cultures-editor.ts` (1,083), `religions-editor.ts` (958), markets/regiments overviews, etc.
- **Problem:** each `open()` repeats close-others → toggle-layers → refresh → mount-bulk-bar → `$.dialog` → close-handler (~200–300 lines of ceremony). The architecture doc's "build on open, destroy on close" is enforced by copy-paste, not a module.
- **Deepening:** a deep dialog-lifecycle module owning open/close/teardown, driven by a small per-editor declaration.
- **Re-platform caveat:** **a reactive UI framework gives this for free** (component mount/unmount). Doing this by hand now is largely wasted effort if the UI is re-platformed — **defer until the migration call.**

### AR-7 — Renderer draw scaffolding & exporter canvas boilerplate · Speculative · does NOT survive re-platform
- **Files:** ~12 `renderers/draw-*.ts` (repeat `time → clear group → build string → inject`), `io/export.ts` (794; PNG/JPEG/tiles repeat canvas/blob plumbing around the already-deep `getMapURL()`).
- **Problem:** thin, low-leverage repetition; the per-renderer content is the real substance.
- **Deepening:** a small shared `renderLayer` wrapper / `canvasToDownload` helper. Low urgency; fold into other work.

---

## Top recommendation & suggested order

1. **AR-1 (`.map` schema) + AR-6 (`grid` typing)** — both **Strong**, both **stack-independent**, both directly relevant to the fork's data-layer future (temporal save-states). Highest value, lowest regret. Do these first **regardless** of the migration decision.
2. **AR-3 (economy orchestrator)** — stack-independent; unblocks testing the biggest untested subsystem.
3. **AR-2 / AR-5 / AR-4 / AR-7** — **gated by the migration decision** ([migration-status.md](./migration-status.md)). If the UI is re-platformed, AR-4/AR-7 are obviated and AR-2/AR-5 are reshaped. Do not invest here until the direction is set.

## How to use this doc

- Each finding's **Disposition** stays `Open` until decided in PRD grilling; update it to `Planned`, `Deferred`, or `Rejected` (with a one-line reason) as decisions land.
- Findings that become work should produce a PRD under `docs/prds/backlog/`; load-bearing architecture changes need an ADR (`docs/adr/`).
- This log is a snapshot; verify line numbers against the code before acting (the code is authoritative).
