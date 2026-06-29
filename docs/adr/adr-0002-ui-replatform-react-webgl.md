# ADR-0002: Re-platform the UI on React with a hybrid WebGL+SVG renderer

**Status:** Accepted

**Date:** 2026-06-28

**Category:** Architecture

**Affected Areas:** the entire UI/editor layer (`public/modules/ui/`, `src/controllers/`, `src/index.html` shell), the renderer layer (`src/renderers/`), the `window.X` migration seam, and the build/tooling stack. Explicitly **not** the domain core (`src/generators/`, state, `src/io/`).

## Context

The project is a fork of Azgaar's Fantasy Map Generator being evolved into a full
worldbuilding tool (see `AGENTS.md`). Its north-star goals are temporal save-states,
multi-map globes, performance, and UI/UX.

A `/improve-codebase-architecture` review (2026-06-28,
`docs/architecture-review-results/`) and a migration-status assessment
(`docs/architecture-review-results/migration-status.md`) established the current state:

- ~70% of the codebase by volume is migrated to typed, modular TS (`src/`), but **the
  migrated portion is the well-bounded model and view layers** (generators, renderers, io,
  utils, types). The remaining ~30% is the hardest part: the **UI editor/tool layer** —
  ~38 legacy jQuery files in `public/modules/ui/`, `public/main.js` (the true entry point),
  and the ~9,000-line `src/index.html` monolith (UI shell + SVG `<defs>` + CSS).
- The UI is **split-brain**: newer surfaces (economy, states/cultures/religions editors,
  bulk-action bar) are TS in `src/controllers/`; most older editors are still legacy jQuery.
- "Finishing the migration" is, almost exactly, **rebuilding the UI editor layer** — which
  is precisely what the fork's UI/UX north star wants to overhaul anyway.

During Align & Plan grilling, the user resolved the decision criteria:

1. **Lead north-star goal: UI/UX overhaul.** This is renderer/framework-heavy and tilts
   the whole effort toward a re-platform rather than a data-layer-first sequence.
2. **`.map` backward-compatibility is non-negotiable** — every option must round-trip
   existing maps at every step. This pressures the `.map` serialization contract (review
   finding AR-1) to the front as prerequisite work.
3. **Performance & memory on large maps (100k cells)** is an architectural constraint, not
   polish.

Given UI/UX leads, hand-finishing the migration in vanilla TS (migration "Option A") is
dominated: it would port jQuery editors to vanilla TS only to rebuild them again for the new
experience — high effort, no strategic payoff. The real choice is between an incremental
strangler-fig (Option C) and a committed full re-platform (Option B).

## Decision

**Re-platform the UI layer on React with a hybrid WebGL+SVG renderer, preserving the TS
domain core unchanged.** Concretely:

- **Migration shape — full replacement end-state (Option B), executed incrementally.**
  Commit that the end state is 100% the new stack (no permanent hybrid). *Execute* it as a
  sequence of merged vertical slices: the legacy app stays live and shippable on `master`
  until the new stack reaches feature parity, then cut over in one switch. "Big-bang"
  describes the destination, **not** a single giant PR. `.map` round-trips at every slice.

- **UI framework — React.** Chosen for its ecosystem, documentation, and AI-tooling
  coverage. **Boundary (load-bearing): React governs UI _chrome_ only — panels, editors,
  dialogs, toolbars, lists — and never the map itself.** The map's up-to-100k cells stay in
  the dedicated renderer layer, drawn as one injected write per layer. Rendering map cells as
  React components is forbidden; it would reintroduce exactly the per-node DOM cost the
  performance discipline in `ARCHITECTURE.md` exists to prevent. Large per-entity lists (a
  row per state/culture/burg) must be **windowed** (render only visible rows), per
  `ARCHITECTURE.md`.

- **Renderer — hybrid WebGL+SVG.** WebGL/canvas draws the dense, slow layers (cell fills,
  terrain, heightmap); an **SVG/HTML overlay** keeps crisp text labels, anti-aliased vector
  paths (coastlines, rivers, borders), filters (relief, texture), and click-targets. This is
  the standard architecture for performant map applications and avoids rebuilding text and
  vector rendering as shaders from scratch — the most common place a solo WebGL rewrite
  stalls. `three.js` is already a dependency (the 3D view), so WebGL infrastructure partially
  exists.

- **Preserve the domain core in every step.** Generators, world state (`pack`/`grid`), and
  io/serialization are an asset, not a liability; they are not rewritten. The jQuery UI shell
  is the liability being retired.

- **The `window.X` bridge remains the transitional interop seam** between new React surfaces
  and surviving legacy code, shrinking as each surface is cut over, and removed at cutover.

### Prerequisite, stack-independent work (do first, in parallel)

Two review findings are stack-independent and are scheduled **before/alongside** the
re-platform because they are pure wins that the new UI will depend on:

- **AR-1 — consolidate the `.map` serialization contract** into one named-field schema with
  a round-trip property test. This de-risks the non-negotiable `.map` constraint *before* the
  rewrite churns everything around it. **First PRD.** Scope is a compatibility-safe naming
  layer only — no renumbering or slot removal (those would break existing `.map` files).
- **AR-6 — type the `grid` global** (`GridGraph` interface). Cheap, high-leverage; helps all
  downstream code reason about state.

`AR-3` (economy orchestrator) is also stack-independent and planned soon, but not in the
first PRD. `AR-4` (dialog lifecycle) is **obviated** by React's component mount/unmount.
`AR-2` (delete cascade), `AR-5` (SVG layer ids), and `AR-7` (render/export scaffolding) are
**reshaped** by the re-platform and deferred; their domain logic (e.g. the cascade
reassignments, a declared layer tree) survives and folds into the new design.

## Alternatives Considered

| Alternative | Pros | Cons |
|---|---|---|
| **(B) Full re-platform on React + hybrid WebGL/SVG (chosen)** | Directly serves the lead UI/UX goal plus performance and the state-heavy temporal/multi-map goals; component model gives editor lifecycle/teardown for free; clean end-state with no permanent hybrid | Largest scope; introduces React + WebGL complexity; long stretch before full cutover; solo-bandwidth risk — mitigated by incremental merged slices keeping `master` shippable |
| (C) Strangler-fig hybrid (C→B) | Lowest regret; ships value earliest; lets the stack prove itself | Risks a permanent third world if legacy is never retired; the user wants a committed clean end-state, not indefinite coexistence |
| (A) Complete migration in vanilla TS | One coherent stack; no new deps; `.map` untouched | Does nothing for the lead UI/UX goal; editors would be rebuilt twice. Dominated. |
| Pure WebGL renderer | Best raw perf; cleanest for multi-map globes eventually | Must rebuild text, anti-aliased strokes, every filter as shaders — highest risk; most likely stall point for a solo dev |
| Svelte/Solid instead of React | Smaller bundle, lower memory, closer to the "direct injection" spirit | Smaller ecosystem / AI-tooling coverage; React's overhead is contained to chrome (not the map), so its main downside is largely neutralized here |

## Consequences

- **`ARCHITECTURE.md` must be updated** to reflect React as the UI framework and the hybrid
  WebGL+SVG renderer as the view-layer direction (today it names SVG with WebGL only as a
  future possibility, and is framework-agnostic / "framework-free direct injection"). That
  update references this ADR. The "framework-free, direct injection" guidance now applies to
  the **renderer** (map drawing), while the **chrome** moves to React — the doc must draw
  that line explicitly.
- **New tooling/dependencies** (React + its build integration; a WebGL rendering approach)
  enter the project. This ADR is the required approval per the CLAUDE.md axiom on new tooling;
  specific package choices may get follow-up notes but are covered in principle here.
- A **dual-renderer / dual-UI transition period** is expected; the `window.X` seam carries it
  and is removed at cutover.
- The first concrete work is **not** the re-platform itself but the AR-1 `.map` schema PRD
  (`docs/prds/backlog/`), followed by AR-6, sequencing the non-negotiable compatibility work
  ahead of the churn.
- **Accepted 2026-06-28.** `ARCHITECTURE.md` updated in the same change to name React (UI
  chrome) and the hybrid WebGL+SVG renderer, and to draw the chrome-vs-renderer line for the
  "framework-free, direct injection" guidance.
- No code or `.map` impact from this ADR itself — it records direction. The `.map` format is
  explicitly protected (round-trip preserved) by every step it authorizes.
