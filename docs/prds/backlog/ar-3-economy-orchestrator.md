# PRD (stub) — Economy Orchestrator (AR-3)

> **Source:** Architecture review finding [AR-3](../../architecture-review-results/README.md#ar-3--the-economy-pipeline-is-sequenced-at-one-buried-call-site--worth-exploring--survives-re-platform).
> **Direction:** [ADR-0002](../../adr/adr-0002-ui-replatform-react-webgl.md) — stack-independent; planned **soon**, after AR-1/AR-6.
> **Status:** Backlog stub.

## Problem Statement

The economy is a tightly-ordered pipeline — `Goods.generate() → Markets.generate() →
Production.produce() → States.collectTaxes()` — but that order is **not owned anywhere**. It is
copy-pasted across **6+ call sites** (verified 2026-06-28): `public/main.js:691-714`,
`public/modules/ui/tools.js` (×2), `public/modules/ui/heightmap-editor.js` (×2), and
`src/io/auto-update.ts:1175`. (The review's "sequenced at one buried call site" *understates*
it.) `Production.produce()` also reaches across the seam into `Markets.*`/`Goods.get()` via
globals. The largest economic subsystem (~2,570 lines) can only be exercised by booting the
whole `pack`.

## Solution

One economy orchestrator with explicit in/out (`state + options → deals/production/treasury`)
that names the order once; all call sites invoke it instead of re-stating the four-step sequence.
The order becomes named, single-sourced, and testable in isolation — matching the pipeline
vision already in `ARCHITECTURE.md`.

## Scope notes

- **Wrinkle (transition):** several call sites are legacy `public/` JS that cannot `import` ES
  modules, so the orchestrator must be exposed on the `window.X` bridge (like `window.Goods`
  etc.) until those callers are rebuilt under the re-platform. After cutover (ADR-0002) the
  bridge entry is dropped and callers import directly.
- **In scope:** the orchestrator module + tests; replacing the 6+ duplicated sequences with one
  call each.
- **Out of scope:** rewriting the individual economy generators' internals; changing economic
  behavior (outputs must match — a characterization/round-trip test should guard this).
- **Acceptance:** one named entry point; all call sites use it; behavior unchanged (guarded by
  test); the order is unit-testable without UI. AFK.

## Further Notes

Stack-independent. Sequenced after [AR-1](./ar-1-map-schema-module.md) and
[AR-6](./ar-6-type-grid-global.md). Run `/slice-prd` to expand before implementing.
