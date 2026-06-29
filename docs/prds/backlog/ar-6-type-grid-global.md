# PRD (stub) — Type the `grid` Global (AR-6)

> **Source:** Architecture review finding [AR-6](../../architecture-review-results/README.md#ar-6--type-the-grid-global--strong-small--survives-re-platform).
> **Direction:** [ADR-0002](../../adr/adr-0002-ui-replatform-react-webgl.md) — stack-independent; scheduled right after AR-1.
> **Status:** Backlog stub — to be fleshed out / sliced when picked up.

## Problem Statement

`pack` (the repacked world) is typed `PackedGraph` and checked across ~1,191 references, but its
sibling `grid` (the pre-repack Voronoi) is typed **`any`** at `src/types/global.ts:11`, leaving
~150+ `grid.*` accesses across generators, renderers, and io completely unchecked. A core domain
entity hides behind `any` — typos and shape drift go uncaught.

## Solution

Write a `GridGraph` interface mirroring `PackedGraph` (cells typed arrays `h`/`t`/`f`/`temp`/
`prec`, plus `features`, `points`, `boundary`, `spacing`, `cellsX`/`cellsY`/`cellsDesired`,
etc.) and point `var grid` at it. ~50 lines consulted by ~150 sites — the cheapest high-leverage
win in the review.

## Scope notes

- **In scope:** the `GridGraph` interface, retyping `var grid`, and fixing whatever real type
  errors surface (expected to be few; some may reveal genuine bugs — fix with a regression test
  per the bug rule).
- **Out of scope:** removing or reshaping the `window.X` bridge; any runtime behavior change.
  This is types-only.
- **Acceptance:** `tsc` passes with `grid` fully typed; no `any` on `grid`; no behavior change.
  AFK (no visual/runtime component).

## Further Notes

Stack-independent — pure win regardless of the UI re-platform. Sequenced after
[AR-1](./ar-1-map-schema-module.md). Run `/slice-prd` to expand before implementing (likely a
single slice).
