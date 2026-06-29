# PRD (stub / program) — UI Re-platform on React + Hybrid WebGL/SVG

> **Direction:** [ADR-0002](../../adr/adr-0002-ui-replatform-react-webgl.md).
> **Status:** Backlog program stub — this is a large, multi-PRD effort, not a single sliceable PRD.
> Individual surfaces become their own PRDs as they are picked up.

## Problem Statement

The fork's lead north-star goal is a **UI/UX overhaul** (see `AGENTS.md`). The unfinished part of
the codebase migration *is* the UI layer: ~38 legacy jQuery editors in `public/modules/ui/`,
`public/main.js` (the true entry point), and the ~9,000-line `src/index.html` monolith. Finishing
in vanilla TS would rebuild these twice; the strategic move is to re-platform the UI on a modern
stack while preserving the proven TS **domain core**.

## Solution (the committed direction)

Per ADR-0002:
- **React** for all UI **chrome** (panels, editors, dialogs, toolbars, lists) — **never** the map
  cells. Large per-entity lists are **windowed**.
- **Hybrid renderer**: WebGL/canvas for dense fills/terrain; **SVG/HTML overlay** for labels,
  vector paths, filters, and click-targets.
- **Full-replacement end-state**, executed as **incremental merged slices**; legacy app stays
  live and shippable on `master` until **cutover**. `.map` round-trips at every slice.
- **Preserve unchanged:** generators, world state, io.
- The **`window.X` bridge** carries the transition and is removed at cutover.

## Review findings absorbed by this program

These are **not** separate refactors on the legacy stack — they are resolved by the re-platform:

- **AR-4 (dialog lifecycle)** — *obviated*. React component mount/unmount *is* the
  "build on open, destroy on close" discipline. No standalone work.
- **AR-2 (delete cascade)** — *reshaped*. The cascade **logic** (which cells/burgs/notes/etc. to
  reassign on delete) survives and folds into the **domain core** as reusable functions; the bar
  UI + per-type adapter wiring are rebuilt in React.
- **AR-5 (SVG layer ids)** — *folds into renderer design*. The hybrid renderer needs a **declared
  layer tree** (id, parent, draw order, owning renderer SVG vs WebGL); the AR-5 idea survives and
  strengthens, replacing today's ~50 hardcoded id strings.
- **AR-7 (render/export scaffolding)** — *reshaped*. Any shared draw/export scaffolding emerges
  from the new renderer, not a legacy-stack refactor.

## Suggested early sequencing (to be turned into real PRDs)

1. **Prerequisites first (separate, stack-independent):** AR-1 (`.map` schema), then AR-6 (`grid`
   typing), then AR-3 (economy orchestrator). These ship before/independently of the re-platform.
2. **Foundation spike:** stand up React + build integration alongside the legacy shell; render one
   trivial real surface end-to-end with `.map` round-tripping intact. De-risks the stack before
   committing the full UI. (Needs its own ADR-level package choices note if specifics arise.)
3. **Renderer spike:** prove the hybrid boundary — a WebGL fill layer under an SVG overlay — and a
   declared layer tree (absorbing AR-5).
4. **Per-surface migration PRDs:** rebuild editors/overviews one surface at a time on React,
   deleting the matching legacy file, until parity.
5. **Cutover:** switch the entry point to the React app; remove `window.X` bridge + jQuery/d3 v5.

## Out of scope (for now)

- Pure WebGL (rejected in favor of hybrid). Multi-map globes and temporal save-states are
  *separate* north-star programs that build on this one — not part of reaching UI parity.

## Further Notes

- `ARCHITECTURE.md` must be updated when ADR-0002 is accepted (React as UI framework; hybrid
  WebGL+SVG as renderer direction; the chrome-vs-renderer line for "framework-free direct
  injection").
- This stub exists so the deferred review findings (AR-2/AR-4/AR-5/AR-7) and the re-platform
  itself are not lost. Each numbered step above becomes its own PRD (and ADR where the axioms
  require) when scheduled.
