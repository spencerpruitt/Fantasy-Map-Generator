# Roadmap — post-architecture-review work

_Dependency-ordered waves for the work coming out of the 2026-06-28 architecture review and the
UI re-platform decision ([ADR-0002](adr/adr-0002-ui-replatform-react-webgl.md)). A **wave** is a
set of branches with no unmet dependencies on each other; branches within a wave run in parallel
(one sub-agent per branch), slices within a branch stay serial. HITL verification and merges are
deferred to the end of each wave. See `CLAUDE.md` → Parallel execution (waves)._

**Legend:** ✅ done · 🟡 in progress · ⬜ todo · 💤 deferred/not scheduled.
PRDs live in `docs/prds/{backlog,in-progress,finished}`; this file tracks only sequencing and the
dependency graph.

---

## Wave 0 — Planning & docs (merge first)

Everything downstream references these ADRs/PRDs, so the docs branch merges before feature work.

| Item | Branch | PRD / doc | Status |
|---|---|---|---|
| Documentation schema + architecture review + ADR-0002 + AR-1/AR-6 PRDs | `documentation-refactor` | ADR-0001, ADR-0002, review results, this roadmap | 🟡 awaiting Review/merge |

**Exit:** `documentation-refactor` reviewed and merged to `master`.

---

## Wave 1 — Stack-independent core hardening (parallel)

Both are `.map`/domain-core wins that pay off regardless of the re-platform, have **no
dependency on each other**, and are **AFK** (no HITL). Run as two parallel branches.

| Item | Suggested branch | PRD | Type | Blocked by | Status |
|---|---|---|---|---|---|
| **AR-1 — `.map` schema module** | `feat/map-schema-module` | `prds/finished/ar-1-map-schema-module.md` (3 AFK slices) | AFK | none | ✅ merged |
| **AR-6 — type the `grid` global** | `feat/type-grid-global` | `prds/finished/ar-6-type-grid-global.md` (1 AFK slice) | AFK | none | ✅ merged |

**Notes:** AR-1 hardens the serialization contract the new UI reads through; AR-6 types the
second world graph. Both branch from `master` after Wave 0 merges (or from
`documentation-refactor` if started before the merge — they don't touch the docs).
**Exit:** both reviewed and merged; no HITL needed.

---

## Wave 2 — Re-platform groundwork

| Item | Suggested branch | PRD | Type | Blocked by | Status |
|---|---|---|---|---|---|
| **AR-3 — economy orchestrator** | `feat/economy-orchestrator` | `prds/backlog/ar-3-economy-orchestrator.md` (**stub — flesh out + slice first**) | AFK | Wave 1 (AR-6 helpful, not strict) | ⬜ stub |
| **Re-platform foundation spike** (React + build, 4 economy surfaces end-to-end, reactivity + recipe, `.map` intact) | `feat/replatform-foundation`, `feat/replatform-recipe-hardening` | `prds/finished/replatform-foundation.md` (Phases 0–2 / Slices 1–8; **ADR-0003**, **ADR-0004** accepted) | HITL (visual) | Wave 1 (AR-1 serialization boundary) | ✅ done |

**Notes:** AR-3 still needs a quick grill (window.X exposure for legacy callers; a
behavior-preservation/characterization test) before it's implementation-ready. The foundation
spike is the first **HITL** work and requires a follow-up ADR pinning the specific React + build
tooling (the new-tooling axiom). **Exit:** foundation spike verified with the user; AR-3 merged.

---

## Wave 3+ — Re-platform execution (program)

Tracked in `prds/backlog/replatform-program.md`; each becomes its own PRD (and ADR where the
axioms require) when scheduled.

| Item | Type | Blocked by | Status |
|---|---|---|---|
| Renderer spike — hybrid WebGL fill under SVG overlay + declared layer tree (absorbs AR-5) | HITL | Wave 2 foundation | ⬜ |
| Phase 3 — read-only overviews & tools (12 surfaces per the frozen recipe) — `feat/replatform-phase3-readonly`, `prds/in-progress/replatform-phase3-readonly-overviews.md` | HITL (once, end of feature) | none — the renderer track only gates Phase 5 presentation surfaces, not Phase 3 (foundation PRD § Migration Waves) | 🟡 in progress |
| Remaining per-surface migration PRDs (Phases 4–6) — rebuild mutating editors/shell one at a time on React; delete matching legacy file (absorbs AR-2, AR-4, AR-7) | HITL (per feature) | Phase 3; renderer for Phase 5 surfaces | ⬜ |
| Cutover — switch entry point to React app; remove `window.X` bridge + jQuery/d3 v5 | HITL | all surfaces at parity | ⬜ |

---

## Deferred / not scheduled

| Item | PRD | Why deferred |
|---|---|---|
| `.map` format compaction (remove dead slots, MAJOR break) | `prds/backlog/map-format-compaction.md` | Breaks existing `.map`; fold into the next MAJOR change (temporal save-states). Depends on AR-1. | 💤 |
| Temporal save-states (north-star #1) | — (needs grilling) | Large program; builds on AR-1 + a state-model rework. | 💤 |
| Multi-map globes (north-star #2) | — (needs grilling) | Large program; strains single-`pack` model + renderer. | 💤 |

---

## Out of this roadmap

Independent feature branches predating this review (`bulk-action-bar`, `feat/download-path-selector`,
`feat/save-location-picker`, …) are tracked separately and are not part of these waves.
