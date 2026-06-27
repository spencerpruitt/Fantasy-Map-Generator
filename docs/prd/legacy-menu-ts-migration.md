# PRD (backlog): Migrate legacy UI menus to TypeScript

Status: backlog

## Problem

Five list menus still live as legacy plain-JS `<script>` files under
`public/modules/ui/`: `burgs-overview.js`, `provinces-editor.js`, `zones-editor.js`,
`markers-overview.js`, `routes-overview.js`. They cannot import ES modules, so they reach
migrated TS features only through `window` globals. The Bulk Action Bar feature added a
deliberate temporary seam for this — `src/controllers/bulk-action/legacy-bridge.ts`
(`window.bulkBars`) — documented in `docs/architecture/architecture.md` → "Bulk Action Bar
bridge". This is consistent with the codebase's existing `window.X` pattern but is debt we
chose to defer, not keep.

## Goal

Migrate each of the five menus to a TS controller (matching states/cultures/religions:
`open()` exported, routed through the `lazy` registry, callers updated from the global
function to `lazy.<menu>().then(m => m.open())`). Once migrated, each menu drops its
`window.bulkBars.mount/sync` calls and instead constructs the bar directly via the adapter
factory + `BulkActionBar` (the path TS menus already use). When all five are migrated,
delete `legacy-bridge.ts` and the `window.bulkBars` global.

## Scope / sequencing

One menu per slice/PR, each with its own HITL (these files carry complex d3 + jQuery
dialog + drag behavior). Suggested order smallest-first (e.g. routes/markers before
provinces, which is ~1400 lines). Each migration must keep behavior identical and update
every caller of the menu's current global entry point.

## Out of scope

The Bulk Action Bar feature itself (delivered separately) — this PRD only removes the
legacy seam it introduced.
