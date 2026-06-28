# PRD: Bulk Action Bar — multi-select delete/edit across civilization menus

Status: in-progress

## Problem Statement

Today, acting on map entities one at a time is tedious. To delete twelve states, a user
opens the States editor and clicks the trash icon twelve times, confirming each one. The
same is true for burgs, provinces, cultures, religions, regiments, markers, zones, and
routes — every list-style menu deletes (and edits) strictly one row at a time. A couple of
menus grew ad-hoc shortcuts (Burgs has a "Remove All" button, Zones has a remove-toggle
mode), but these are inconsistent, all-or-nothing, and exist nowhere else.

There is no way to say "these specific ones" and act on the whole set at once, and there is
no undo if a destructive action goes wrong.

## Solution

Add a single, reusable **Bulk Action Bar** to every list-style overview/editor dialog.
Each list gains a checkbox column and a filter-aware "select all" header checkbox. As soon
as one or more rows are checked, a bar appears showing "N selected" with bulk actions:
**Delete**, **Lock**, **Unlock**, and **Set color** (color shown only in menus whose entities
have a color). Selection is scoped to the open menu — you select states in the States menu,
markers in the Markers menu; there is no cross-type selection.

Bulk delete reuses each entity type's existing single-delete cascade, wrapped in one
confirmation dialog that summarizes exactly what will happen (counts + cascade), and notes
any locked rows that will be skipped. **Locked rows are protected from bulk delete**, giving
Lock a second meaning (protect-from-regeneration *and* protect-from-deletion) and a cheap
safety net in the absence of an undo system. In the States and Provinces menus only, the
confirmation dialog offers an optional "also delete contained burgs" checkbox.

The new bar replaces the ad-hoc "Remove All" (Burgs) and remove-mode (Zones) controls so
there is one consistent mechanism everywhere.

## User Stories

1. As a mapmaker, I want a checkbox on each row of a list menu, so that I can mark several entities at once instead of acting on them one by one.
2. As a mapmaker, I want a "select all" checkbox in the list header, so that I can grab every visible row in a single click.
3. As a mapmaker, I want "select all" to respect the menu's current filter and search, so that I only select the subset I'm actually looking at (e.g. only burgs of one state).
4. As a mapmaker, I want a bar showing how many rows I've selected, so that I always know the size of the action I'm about to take.
5. As a mapmaker, I want the bar to stay hidden until I select at least one row, so that it doesn't clutter the menu during normal browsing.
6. As a mapmaker, I want to delete all selected entities in one action, so that clearing out many states/burgs/etc. is fast.
7. As a mapmaker, I want a confirmation dialog before a bulk delete, so that I don't wipe data by accident.
8. As a mapmaker, I want the confirmation to spell out the cascade (e.g. "12 states, reassigning 87 burgs to neutral, removing 40 provinces"), so that I understand the downstream effects before committing.
9. As a mapmaker, I want locked rows to be skipped by bulk delete, so that I can shield important entities from accidental mass deletion.
10. As a mapmaker, I want the confirmation to tell me how many selected rows were skipped because they're locked, so that I'm not surprised that some survived.
11. As a mapmaker editing States, I want an optional "also delete contained burgs" choice in the delete confirmation, so that I can fully wipe a region rather than orphaning its burgs to neutral.
12. As a mapmaker editing Provinces, I want the same optional "also delete contained burgs" choice, so that province-level wipes behave consistently with state-level ones.
13. As a mapmaker, I want bulk delete to behave exactly like deleting each entity individually (same cascade) by default, so that I can trust it matches the behavior I already know.
14. As a mapmaker, I want to lock all selected entities at once, so that I can quickly protect a batch from regeneration and from bulk deletion.
15. As a mapmaker, I want to unlock all selected entities at once, so that I can release a batch I previously protected.
16. As a mapmaker, I want separate Lock and Unlock actions (not a single toggle), so that a mixed selection of locked and unlocked rows resolves predictably.
17. As a mapmaker, I want to set a single color on all selected entities at once, so that I can recolor a group of states/provinces/cultures/religions/zones consistently.
18. As a mapmaker, I want the "Set color" action to appear only in menus whose entities actually have a color, so that I'm not offered a meaningless action for burgs, markers, or routes.
19. As a mapmaker, I want the map to redraw after a bulk action, so that I immediately see the result of my delete/lock/color change.
20. As a mapmaker, I want non-deletable special rows (e.g. the "neutral" state) to be excluded from selection and select-all, so that I can't try to delete something the app forbids.
21. As a mapmaker, I want the same select-and-act experience in every list menu (States, Burgs, Provinces, Cultures, Religions, Military/Regiments, Markers, Zones, Routes), so that I don't have to relearn the UI per menu.
22. As a mapmaker who used the old "Remove All" button in Burgs, I want that workflow preserved as "check the header box, then Delete", so that I don't lose the ability to clear all burgs.
23. As a mapmaker who used the Zones remove-mode, I want the same deletion capability via the new bar, so that removing zones still works after the old control is gone.
24. As a mapmaker, I want my selection to survive a list refresh (or be clearly reset), so that re-rendering the list doesn't silently leave me in a confusing state.
25. As a mapmaker, I want the selection to clear after a successful bulk action, so that I start fresh for the next operation.
26. As a contributor, I want the selection logic and the destructive cascade logic to be unit-tested independently of the DOM, so that the risky parts are verified in isolation.

## Implementation Decisions

### Modules

- **`BulkSelection` (deep, pure, no DOM):** A selection state container for the currently
  open menu. Responsibilities: track selected entity ids, toggle/add/remove, filter-aware
  select-all over a supplied id set, clear, query `isSelected` / `getSelected` / count.
  Knows nothing about entity types or the DOM. This is the core deep module and the primary
  unit-test target.

- **`BulkEntityAdapter` (per-type seam, one small adapter per menu):** The only
  type-specific code. Each adapter describes how to operate on its entity type without the
  rest of the system knowing the type. Conceptual interface:
  - identity: a `type` name and the id of the list's DOM container
  - row mapping: extract an entity id from a row element
  - `isDeletable(id)` — false for special rows such as the neutral state (state 0)
  - `supportsColor` — whether the "Set color" action is offered
  - `isLocked(id)`, `setLock(id, locked)`
  - `setColor(id, color)` (only when `supportsColor`)
  - `deleteEntity(id, options)` — **delegates to the existing single-delete logic** for that
    type (e.g. `Burgs.remove`, the states editor's `stateRemove`, etc.). No reinvented cascade.
  - optional `childKind` + `deleteChildren(id)` — present only for States and Provinces,
    where the children are contained burgs
  - `describeCascade(ids, options)` — produce a **cascade summary** (counts of entities
    deleted, dependents reassigned/removed, locked rows skipped, child burgs deleted when the
    option is set) for the confirmation dialog
  Adapters reuse existing remove functions; they do not change the underlying cascade rules.

- **`BulkActionBar` (view/controller, DOM glue):** Mounts the checkbox column and select-all
  header into a list container, renders the "N selected" bar with Delete / Lock / Unlock /
  Set color (color hidden unless the adapter supports it), shows the bar only when the
  selection is non-empty, and re-mounts/re-syncs after the list re-renders. Wires DOM events
  to `BulkSelection` and the active `BulkEntityAdapter`. Must attach to both legacy-JS lists
  (`public/modules/ui/`) and migrated-TS lists (`src/controllers/`), since the nine target
  menus span both layers; all are `<div class="table">` containers of row `<div>`s.

- **`bulkDeleteConfirm` (confirm-dialog builder):** Turns a cascade summary into the
  confirmation message and, for States/Provinces, includes the optional "also delete
  contained burgs" checkbox. Reuses the app's existing confirmation-dialog helper. Returns
  the user's choice (confirmed + whether the child-delete option was set).

- **Per-menu integration shims:** Minimal edits to each of the nine list renderers to (a)
  register the type's adapter and mount the bar, and (b) remove the now-redundant ad-hoc
  controls (Burgs "Remove All", Zones remove-mode).

### Behavioral decisions

- **Scope (10 menus):** States, Burgs, Provinces, Cultures, Religions, Military/Regiments,
  Markers, Zones, Routes, and **Markets** (Markets added during HITL — see Slice 11).
- **Selection is per-menu**, never cross-type.
- **Shared edits are minimal:** Lock and Unlock (all types); Set color only for color-bearing
  types (States, Provinces, Cultures, Religions, Zones).
- **Delete reuses the existing per-type cascade.** Deleting a state still reassigns its burgs
  to neutral and removes its provinces, exactly as single-delete does today.
- **Optional child delete** ("also delete contained burgs") is offered only in States and
  Provinces, because only those types own deletable burgs. Cultures/Religions reassign cells
  on delete (no owned deletable entities); Markers/Zones/Routes have no children.
- **Locked rows are protected from bulk delete** and reported as skipped in the confirmation.
- **Lock/Unlock are explicit separate actions**, since a selection may mix locked and
  unlocked rows.
- **Set color** opens a single color picker and applies the chosen color to every selected
  entity, then triggers a redraw.
- **Select-all excludes non-deletable special rows** (e.g. neutral state 0).
- **The bar is hidden until at least one row is selected**, and selection clears after a
  successful bulk action.
- **Redraw** happens once after a bulk action completes (batch, not per-row), to keep large
  operations responsive.
- The new bar **replaces** the old Burgs "Remove All" button and Zones remove-mode; those
  controls are removed.

## Testing Decisions

Good tests here assert **external behavior**, not internal wiring: given a starting world
state and a set of selected ids, the right entities end up removed/reassigned/locked/recolored
— without asserting on private fields or call order. The user requested all four areas below
be covered.

- **`BulkSelection` (unit):** toggle adds/removes; filter-aware select-all selects only the
  supplied id set; clear empties; `isSelected`/count reflect state; selecting an excluded
  (non-deletable) id is rejected. Pure, no DOM — fastest and highest-value.
- **Adapter cascade summaries (unit):** for each adapter, `describeCascade` reports correct
  counts; neutral state is non-deletable; locked rows are counted as skipped; child-burg
  counts are correct for States/Provinces with and without the "delete children" option.
- **Bulk delete (integration):** select rows in a real menu, run delete, and assert the
  entities **and their dependents** land in the expected state (e.g. burgs reassigned to
  neutral, provinces removed; or with child-delete, burgs removed). Mirrors how the existing
  single-delete paths mutate `pack`.
- **Lock/color shared edits:** bulk lock/unlock applies to every selected row; a locked row
  resists bulk delete; set-color applies the chosen color to all selected color-bearing rows.

Prior art: existing controller tests under the project's Vitest setup, and the existing
single-delete functions (`Burgs.remove`, states editor `stateRemove`, etc.) which these tests
should treat as the trusted cascade and build on.

## Out of Scope

- **Cross-type selection** (selecting states and markers together in one list). Selection is
  per-menu.
- **Type-specific bulk edits** beyond Lock/Unlock/Set color — e.g. reassigning a batch of
  burgs to a different state, bulk-changing culture/religion, editing expansionism. Deferred
  to a future PRD.
- **A real undo/redo system.** Lock-protection + a clear confirmation are the safety model;
  full undo is a separate, app-wide architectural effort (would need its own ADR).
- **A separate unified sidebar** that aggregates all entity types. The original "sidebar"
  idea resolved into a shared bar embedded in each existing menu instead.
- **Migrating the four existing PRDs** out of `docs/prd/` into lifecycle folders.

## Further Notes

- New domain term recorded in `docs/domain/glossary.md`: **Bulk Action Bar**.
- The nine target menus are all `<div class="table">` row lists, each already carrying a
  per-row trash icon — confirmed during grilling. The shared component attaches to that shared
  shape.
- A known constraint: the nine lists are split between legacy JS (`public/modules/ui/`:
  burgs-overview, provinces-editor, zones-editor, markers-overview, routes-overview) and
  migrated TS (`src/controllers/`: states-editor, cultures-editor, religions-editor,
  regiments/military). The shared component must not assume the TS layer. This is a slicing
  consideration: a sensible first slice proves the bar end-to-end on one TS menu (e.g. States)
  before rolling out to the rest.
- Anything with a visual/runtime component is HITL-verified once at the end of the feature
  (per project workflow), not per slice.

## Vertical Slices

Slices are ordered so blockers come first. The States menu is the tracer that builds all
shared scaffolding (`BulkSelection`, `BulkActionBar`, `bulkDeleteConfirm`); every later slice
adds a per-type adapter and mounts the existing bar. Visual confirmation is deferred to the
single terminal HITL slice.

### Slice 1 — Core selection + States bulk delete  [AFK]
- Status: done
- Blocked by: none
- User stories: 1–10, 13, 20, 24, 25, 26

**What to build:** The full spine end-to-end on the States menu. Build `BulkSelection` (pure,
no DOM): toggle/add/remove, filter-aware select-all over a supplied id set, clear, query
`isSelected`/`getSelected`/count, and rejection of excluded ids. Build the States
`BulkEntityAdapter`: `isDeletable` (neutral state 0 excluded), `isLocked`, `describeCascade`
(counts of states deleted, burgs reassigned to neutral, provinces removed, locked rows
skipped), and `deleteEntity` delegating to the existing state-delete logic. Mount the
`BulkActionBar` on the States list: per-row checkbox column, filter-aware select-all header,
"N selected" indicator hidden until ≥1 selected. Wire the **Delete** action through
`bulkDeleteConfirm` (cascade summary + locked-skip count), skipping locked rows, then a single
redraw and selection clear.

**Acceptance criteria:**
- [x] `BulkSelection` unit tests cover toggle, filter-aware select-all, clear, isSelected/count, and excluded-id rejection
- [x] Selecting and deleting multiple states removes them and reassigns their burgs to neutral + removes their provinces (matches single-delete cascade)
- [x] The neutral state (state 0) cannot be selected or deleted
- [x] Locked states are skipped by bulk delete and reported as skipped in the confirmation
- [x] Select-all respects the menu's active state/culture filter and search (select-all enumerates only non-hidden rows)
- [x] The bar is hidden with zero selection and selection clears after a successful delete
- [x] Integration test asserts post-delete `pack` state for a multi-state selection

**Implementation notes:**
- Modules added under `src/controllers/bulk-action/`: `bulk-selection.ts` (pure),
  `bulk-entity-adapter.ts` (full interface contract for all slices), `bulk-action-bar.ts`
  (DOM glue), `bulk-delete-confirm.ts`, and `adapters/states-cascade.ts` (pure data cascade)
  + `adapters/states-adapter.ts` (factory taking an injected `redraw`, so the adapter stays
  free of the editor's module-load DOM side effects and is unit-testable).
- `states-editor.ts` single-delete (`stateRemove`) was refactored to route its data mutations
  through the shared `removeStateCascade`, so single and bulk delete share one cascade. DOM
  cleanup split into `removeStateDom` (per-row) and `redrawStatesAfterBulkDelete` (batch).
- **UI placement reconciliation (confirm at Slice 10 HITL):** the "select all" checkbox lives
  in the always-visible bulk bar rather than inside the list header grid (the nine menus have
  differing grid headers; a bar-hosted select-all is robust and consistent). The *action*
  group ("N selected" + Delete) stays hidden until ≥1 row is selected, satisfying the
  "hidden until selected" intent; per-row checkboxes are always visible.
- **Known minor (HITL):** a deleted state's former capital burg keeps its capital icon styling
  after bulk delete (the batch redraw doesn't re-group burg icons); single-delete still
  re-groups it. Cosmetic only — flag for Slice 10.

### Slice 2 — Shared edits on States: Lock / Unlock / Set color  [AFK]
- Status: done
- Blocked by: Slice 1
- User stories: 14–19

**What to build:** Add Lock, Unlock, and Set color actions to the bar. Lock/Unlock are
explicit separate actions applied to every selected row. Set color opens one color picker and
applies the chosen color to all selected states, then triggers one redraw. Selection clears
after the action.

**Acceptance criteria:**
- [x] Bulk Lock locks every selected row; bulk Unlock unlocks every selected row
- [x] A row locked via bulk Lock then resists bulk delete
- [x] Set color applies the chosen color to all selected states and redraws
- [x] Lock/Unlock/Set color are exposed as distinct actions (no single toggle)

**Implementation notes:**
- Bar shows Lock/Unlock when the adapter has `setLock`, and "Set color" when
  `supportsColor && setColor`. Set color reuses the global `openPicker`. Each action
  applies to the whole selection, then redraws once and clears the selection.
- States adapter gained `setLock`/`setColor` (pure pack mutations); unit-tested
  including the lock-then-resist-delete path. Army/region recolor fidelity is handled
  by the redraw — HITL to confirm at Slice 10.

### Slice 3 — Optional "also delete contained burgs"  [AFK]
- Status: done
- Blocked by: Slice 1
- User stories: 11, 12

**What to build:** Extend `bulkDeleteConfirm` with an optional "also delete contained burgs"
checkbox and the adapter `deleteChildren(id)` path, wired for States. When checked, contained
burgs are deleted instead of reassigned to neutral; the cascade summary reflects the choice.

**Acceptance criteria:**
- [x] The child-delete checkbox appears only in menus whose adapter declares a `childKind` (States here)
- [x] With the option set, deleting states removes their contained burgs; without it, burgs go neutral
- [x] Cascade summary counts reflect whether child-delete is enabled (and update live as the checkbox toggles)
- [x] Unit test covers the adapter cascade summary for both options

### Slice 4 — Roll out to Burgs (legacy-JS attach milestone)  [AFK]
- Status: done
- Blocked by: Slice 1
- User stories: 21, 22

**What to build:** Burgs `BulkEntityAdapter` (lock + delete; no color, no children) and mount
the bar on the legacy-JS Burgs list. Proves the shared component attaches to a
`public/modules/ui/` list and survives its refresh. Remove the old "Remove All" button — its
workflow becomes header select-all → Delete.

**Acceptance criteria:**
- [x] The bar mounts and re-syncs on the legacy-JS Burgs list across refreshes
- [x] Bulk delete on burgs removes the selected burgs (matches single-delete)
- [x] The old "Remove All" button is removed and "select all → Delete" reproduces it
- [x] Set color is not offered in the Burgs menu

**Implementation notes:**
- Legacy bridge `legacy-bridge.ts` registers `window.bulkBars.{mount,sync}` (eager via
  `src/controllers/index.ts`); documented in `docs/architecture/architecture.md` and tracked
  for removal by `docs/prd/legacy-menu-ts-migration.md`. Burgs menu calls `mount` on open and
  `sync` after each `burgsOverviewAddLines`.
- Burgs adapter: delete delegates to the trusted global `Burgs.remove`; `isDeletable` excludes
  the placeholder, capitals (single-delete forbids deleting a capital), and removed burgs. No
  color, no children. Old "Remove All" button + `triggerAllBurgsRemove` removed; "Lock All"
  kept. Select-all is filter-aware (operates on the currently-rendered, filtered rows).

### Slice 5 — Roll out to Provinces (+ child-delete)  [AFK]
- Status: done
- Blocked by: Slice 1, Slice 3
- User stories: 12, 21

**What to build:** Provinces `BulkEntityAdapter` + bar mount; reuse Slice 3's child-burg
delete option so the "also delete contained burgs" checkbox works for provinces too. Provinces
are color-bearing.

**Acceptance criteria:**
- [x] Bulk delete on provinces matches single-delete cascade
- [x] The child-delete option deletes contained burgs for provinces
- [x] Set color is offered for provinces

**Implementation note:** legacy menu; adapter declares `childKind: "burgs"`, enumerates a
province's burgs from cells (not the cache). Without child-delete burgs are unassigned; with
it they go through `Burgs.remove`. Mounted via the `window.bulkBars` bridge.

### Slice 6 — Roll out to Cultures + Religions  [AFK]
- Status: done
- Blocked by: Slice 1, Slice 2
- User stories: 17, 18, 21

**What to build:** Adapters for Cultures and Religions (color-bearing; delete reassigns cells
to none — no owned deletable children). Mount the bar on both menus.

**Acceptance criteria:**
- [x] Bulk delete reassigns affected cells/entities exactly as single-delete does for each type
- [x] No child-delete checkbox appears (neither type owns deletable entities)
- [x] Set color is offered for both

**Implementation notes:** Same pattern as States — pure `cultures-cascade`/`religions-cascade`
extracted from each editor's single-delete (cultures reassign burgs + dominant-culture
states to neutral + release cells + prune origins; religions release cells + prune
origins), `create{Cultures,Religions}Adapter(redraw)` factories, editor mount/sync, batch
redraw. `isDeletable` excludes id 0 (Wildlands / No religion). 40 new unit tests.

### Slice 7 — Roll out to Military / Regiments  [AFK]
- Status: done
- Blocked by: Slice 1
- User stories: 21

**What to build:** Regiments/Military adapter (delete; no color, no lock). Mount the bar.

**Scope change (user-approved):** the regiments overview had *no* single-delete to reuse, so
this slice **adds** a regiment delete: a pure `removeRegimentData(stateId, regimentId)` shared
by the regiment editor's `removeRegiment` and bulk delete. No lock field exists, so no
Lock/Unlock. Regiment `i` is per-state, so the bar row id is a composite of state + regiment.

**Acceptance criteria:**
- [x] Bulk delete on regiments removes the selected regiments (and the regiment editor reuses the same data path)
- [x] Set color is not offered

### Slice 8 — Roll out to Markers + Routes  [AFK]
- Status: done
- Blocked by: Slice 1, Slice 4
- User stories: 21

**What to build:** Adapters for Markers and Routes (legacy-JS lists; lock + delete only, no
color, no children). Mount the bar on both.

**Acceptance criteria:**
- [x] Bulk delete on markers and on routes matches single-delete
- [x] Set color is not offered in either menu
- [x] The bar attaches and re-syncs on both legacy lists

**Implementation note:** Markers rows use `data-i` (not data-id); `Routes.remove` takes the
route object (resolved from the row id). Both mounted via the bridge.

### Slice 9 — Roll out to Zones  [AFK]
- Status: done
- Blocked by: Slice 1, Slice 2, Slice 4
- User stories: 17, 21, 23

**What to build:** Zones adapter (color-bearing) + bar mount; remove the old remove-mode
toggle in favor of select → Delete.

**Acceptance criteria:**
- [x] Bulk delete on zones removes the selected zones
- [x] The old remove-mode toggle is removed and replaced by the bar's Delete
- [x] Set color is offered for zones

**Implementation note:** Zones have no lock (bar shows no Lock/Unlock). Removed the
`zonesRemove` button, its erase branch in `dragZoneBrush`, and the orphaned hotkeys handler.

### Slice 11 — Roll out to Markets (added during HITL)  [AFK]
- Status: done
- Blocked by: Slice 1, Slice 2
- User stories: 21 (extends scope by user request)

**What to build:** Markets adapter + bar mount on the markets overview (a migrated-TS menu,
attaches directly). Markets are color-bearing with no lock and no children; the "No market"
row (id 0) is non-deletable.

**Acceptance criteria:**
- [x] Bulk delete on markets matches single-delete (Markets.removeMarket); markets layer + list redraw once
- [x] Set color is offered for markets; no Lock/Unlock (markets have no lock)
- [x] The "No market" row cannot be selected/deleted

### Slice 10 — Terminal visual verification (all menus)  [HITL]
- Status: in-progress
- Blocked by: Slices 1–9, 11
- User stories: all

**What to build:** No new code — a single end-of-feature human verification across every
menu. The agent provides explicit workflows to exercise and expected correct behavior.

**UX note (HITL-revised):** the control is a top-right **"Bulk Options"** toggle; opening it
reveals per-row checkboxes + an inline toolbar (Select all + Delete / Lock / Unlock / Set
color). The toolbar persists after actions and the selection is kept (deleted rows drop off).

**Acceptance criteria:**
- [ ] In each of the ten menus: "Bulk Options" reveals checkboxes, filter-aware select-all works, and the toolbar toggles correctly
- [ ] Delete shows the cascade summary, skips locked rows, and redraws correctly
- [ ] Child-delete option works in States and Provinces only
- [ ] Lock/Unlock and Set color (where offered) apply to the whole selection
- [ ] The old Burgs "Remove All" and Zones remove-mode are gone with no lost capability
- [ ] Deleting burgs (Burgs menu, and States/Provinces child-delete) removes their map labels
