# PRD (stub) — `.map` Format Compaction (deferred MAJOR break)

> **Source:** the dead-slot removal deferred out of [AR-1](./ar-1-map-schema-module.md) during grilling.
> **Status:** Backlog stub — **future MAJOR version**, not scheduled.

## Problem Statement

The `.map` format carries dead **deprecated positions** kept only to preserve index alignment:
two top-level `[]` slots (`pack.cells.road`, `pack.cells.crossroad`) and eight `""` placeholders
inside the `settings` sub-array. They add nothing but noise.

## Why deferred

Removing/renumbering them **breaks every existing `.map` file** — a MAJOR-version break requiring
an explicit migration path for old saves. The AR-1 PRD deliberately keeps these as named
`reserved` positions (compatibility-safe naming layer only). Compaction is only worth doing
bundled with another MAJOR `.map` change (most likely the **temporal save-states** format
extension), so the migration cost is paid once.

## Scope (when scheduled)

- Drop the reserved positions, renumber the schema, bump `VERSION` MAJOR.
- Provide an `auto-update.ts` migration that reads old-layout files and maps them to the new
  compact layout.
- Extend the AR-1 round-trip test with old→new migration fixtures.

## Further Notes

Do **not** pick this up standalone. Fold it into the next MAJOR `.map` change (temporal
save-states) to amortize the migration. Depends on [AR-1](./ar-1-map-schema-module.md) landing
first (the schema module is what makes renumbering safe to do at all).
