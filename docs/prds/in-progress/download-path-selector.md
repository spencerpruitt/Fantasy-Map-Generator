# PRD: Save-Location Picker for Save to Machine

Status: in-progress
Branch: `feat/download-path-selector`

## Problem Statement

When a user clicks **Save → machine** (or presses Ctrl+S), the `.map` project file is dropped silently into the browser's **Downloads** folder with an auto-generated name like `MyWorld 2026-06-27-21-45.map`. The user can't choose where the file goes or what it's called. This causes real friction:

- They can't save the map into the folder where they keep their world (e.g. a campaign folder), so they have to find it in Downloads and move it manually every time.
- Re-saving the same world produces a pile of duplicate files (`MyWorld ... .map`, each with a new timestamp) instead of updating one file, so the user can't tell which is current.
- There's no "Save" experience like a normal desktop program, where Save just writes back to the file you're working on.

## Solution

On **Save to Machine**, open the operating system's File Explorer "Save As" dialog (the **Save-Location Picker**) so the user picks the folder and filename. The app remembers that file (the **Save Target**) for the rest of the tab session, so every subsequent Save silently overwrites the same file — true desktop-style Save, no duplicate files, no repeated prompts.

This uses the browser's **File System Access API**, which only exists in Chromium-based browsers (Chrome, Edge, Opera, Brave). In Firefox and Safari the picker isn't available, so the app gracefully falls back to today's **Downloads Fallback** behavior, with a one-time note explaining why. Saving always works everywhere.

Scope is deliberately narrow: **`.map` Save to Machine only.** Dropbox, browser-storage save, auto-save, and all Export formats are untouched.

## User Stories

1. As a mapmaker, I want to choose the folder when I save my map, so that it lands directly in my campaign folder instead of Downloads.
2. As a mapmaker, I want to choose the filename when I save, so that I can name the file meaningfully instead of accepting a timestamped default.
3. As a mapmaker, I want the save dialog to pre-fill a sensible default name (current map name + date), so that I can accept it with one click or rename it freely.
4. As a mapmaker, I want the save dialog to default to `.map` files, so that the file type is correct without me thinking about it.
5. As a mapmaker who saves often, I want the second and later Saves to overwrite the same file without asking again, so that saving feels like Ctrl+S in a normal program.
6. As a mapmaker, I want repeated Saves to update one file rather than create `MyWorld (1).map`, `MyWorld (2).map`, etc., so that I always know which file is current.
7. As a mapmaker, I want pressing Ctrl+S to behave exactly like clicking the Save dialog's **machine** button, so that the keyboard shortcut and the button stay consistent.
8. As a mapmaker who opens a different map, I want the app to forget the previous save file, so that Ctrl+S never silently overwrites the wrong world's file.
9. As a mapmaker who generates a brand-new map, I want the app to forget the previous save file, so that my next Save prompts me for a fresh location.
10. As a mapmaker, I want a short confirmation each time I save (e.g. "Saved to MyWorld.map"), so that I know the save succeeded and to which file.
11. As a mapmaker, I want to cancel the save dialog without any error or side effect, so that backing out is harmless.
12. As a Firefox or Safari user, I want Save to keep working, so that my browser choice doesn't break saving.
13. As a Firefox or Safari user, I want a one-time note the first time I save, so that I understand why I'm not getting a location picker and that the file went to Downloads.
14. As a returning Firefox/Safari user, I do not want to see the Downloads note on every save, so that the message isn't nagging.
15. As a mapmaker, I want clear feedback if a save fails (e.g. I deny disk permission, or a disk error occurs), so that I know it didn't save and can retry.
16. As a mapmaker, I want Dropbox save, browser-storage save, auto-save, and all Exports to behave exactly as before, so that this change doesn't disrupt my other workflows.
17. As a mapmaker in edit/customization mode, I want saving to remain blocked with the existing message, so that I don't save an inconsistent map mid-edit.
18. As a mapmaker who reloads the page, I accept that the first Save after reload asks for a location again, so that the behavior stays simple and predictable (session-only memory).

## Implementation Decisions

### Scope
- The picker applies **only** to the `.map` **Save to Machine** path (`saveMap("machine")` → `saveToMachine`), which is reached from both the Save dialog's *machine* button and the Ctrl+S hotkey. Both inherit the new behavior automatically because they share that one code path.
- Dropbox (`method="dropbox"`), browser storage (`method="storage"`), auto-save (writes to browser storage), and every Export format (png/svg/jpeg/zip tiles/geojson/json) are explicitly **out of scope** and unchanged.

### New deep module: Save Target / file writer
A new IO module encapsulates all File System Access API complexity behind a tiny interface. It owns the in-memory **Save Target** ([[File Handle]]) state.

- `saveToFileSystem(mapData, suggestedName)` — the single entry point. Internally it:
  - Detects whether the **File System Access API** is available.
  - If available and no Save Target is held: opens the **Save-Location Picker** (`showSaveFilePicker`) with the suggested name pre-filled and the file type filtered to `.map`, writes the data, and stores the returned handle as the Save Target.
  - If available and a Save Target is already held: writes straight to the remembered handle (overwrite-in-place), no dialog.
  - If the user cancels the picker (AbortError): makes no changes and reports a `cancelled` outcome.
  - If the API is unavailable: performs the **Downloads Fallback** (the existing Blob + anchor download).
  - Returns a small discriminated **outcome** value so the caller owns user messaging: one of `saved-new`, `overwritten`, `downloaded-fallback`, `cancelled`, plus the resolved filename. (Errors propagate as thrown exceptions for the caller's existing error dialog.)
- `clearSaveTarget()` — forgets the remembered handle.

Rationale: the value of this module is hiding a lot of branchy, browser-specific logic (support detection, permission, cancel handling, overwrite vs. first-save, fallback) behind two functions, with a return value pure enough to unit-test by stubbing browser globals. Tips and dialogs stay in the caller so the module has no UI dependency.

### Modify `saveToMachine` (in the existing save module)
- `saveToMachine` becomes a thin wrapper: call `saveToFileSystem`, then map the returned outcome to the existing `tip(...)` calls:
  - `saved-new` / `overwritten` → success tip naming the file (e.g. "Saved to `<filename>`"). (Tip on every save.)
  - `downloaded-fallback` → success tip, plus a **one-time** Downloads-fallback note shown only the first time ever on that browser. The "already shown" flag is persisted in local settings, following the existing one-time-message pattern used by the save reminder (`noReminder` in `localStorage`).
  - `cancelled` → no tip, no error.
- The existing edit-mode guard, `closeDialogs`, and the existing try/catch error dialog (with Retry) are preserved. A denied-permission or disk error surfaces through that same error dialog.

### Reset wiring
- Call `clearSaveTarget()` at the two map-identity reset points:
  - `parseLoadedData` (a different map was loaded from file or storage).
  - `regenerateMap` (a brand-new map was generated).
- Initial page-load generation (`generateMapOnLoad`) needs no explicit reset — the Save Target starts empty.

### Persistence
- **Session-only (v1).** The Save Target lives in memory for the life of the tab. A page reload or new browser session starts with no target, so the first Save prompts again. No file handles are persisted to IndexedDB and there is no cross-session re-permission flow.

### Default filename and file type in the picker
- Suggested name = the existing `getFileName()` output + `.map` (current map name + timestamp), so the default matches today's naming.
- The picker's accepted type is `.map` (a single file-type entry with a `.map` extension), so the dialog defaults to the right extension while still allowing a rename.

## Testing Decisions

Good tests here assert **external, observable behavior** — which browser API gets called, what outcome value comes back, whether state was remembered or reset, which tip text is shown — not internal wiring. Browser capabilities are simulated by stubbing globals (`window.showSaveFilePicker`, the handle's `createWritable`, and the legacy anchor/Blob download path) rather than by reaching into module internals.

Prior art: existing Vitest unit tests in the repo, especially `src/controllers/bulk-action/bulk-selection.test.ts` and the bulk-action adapter tests (plain `describe/it/expect`, module-in-isolation style), and the generator/util tests under `src/generators/` and `src/utils/`. There are currently no tests under `src/io/`, so this introduces the first.

Modules to test:

1. **Save Target / file writer module** (primary):
   - Supported browser, no existing target → calls the picker once, stores the handle, returns `saved-new` with the chosen filename.
   - Supported browser, target already held → writes to the remembered handle **without** calling the picker, returns `overwritten`.
   - User cancels the picker (AbortError) → no state change, returns `cancelled`, no write performed.
   - Unsupported browser (no `showSaveFilePicker`) → uses the Downloads Fallback path, returns `downloaded-fallback`.
   - `clearSaveTarget()` → after reset, the next save re-opens the picker (target forgotten).

2. **`saveToMachine` outcome → tip mapping:**
   - Each outcome maps to the correct tip: success tip on `saved-new`/`overwritten`; success tip + the Downloads note on `downloaded-fallback`; no tip on `cancelled`.
   - The Downloads-fallback note is shown only once (flag persisted), not on subsequent fallback saves.

3. **Reset wiring:**
   - Loading a map (`parseLoadedData`) calls `clearSaveTarget()`.
   - Generating a new map (`regenerateMap`) calls `clearSaveTarget()`.
   - (This touches the load/main flows and may need heavier setup or targeted stubbing.)

## Out of Scope

- The picker for any **Export** format (png/svg/jpeg/zip tiles/geojson/json) and for **Dropbox** / **browser-storage** save.
- **Cross-session persistence** of the Save Target (remembering the file after a reload/restart, with its re-permission flow). Candidate for a future PRD.
- A separate **"Save As…"** action/menu entry (overwrite is the default; no explicit force-new-location command in v1).
- Auto-save changes — auto-save continues to write to browser storage.
- Changing the `.map` file format or `prepareMapData`.

## Further Notes

- Both Ctrl+S and the Save dialog's *machine* button route through `saveMap("machine")`, so no per-trigger handling is needed.
- The one-time Downloads-fallback note reuses the existing one-time-message convention (a `localStorage` flag, as the save reminder does with `noReminder`).
- New domain terms added to `docs/domain/glossary.md`: **Save to Machine**, **File System Access API**, **Save-Location Picker**, **File Handle**, **Save Target**, **Downloads Fallback**.
- Any change with a visual/runtime component is HITL-verified once at the end of the feature: exercise (1) first Save shows the picker and writes to the chosen location, (2) second Save overwrites silently with a confirmation tip, (3) loading a different map then Saving re-prompts, (4) generating a new map then Saving re-prompts, (5) cancelling the picker is a clean no-op, and (6) in Firefox/Safari, Save falls to Downloads with the one-time note.

## Vertical Slices

### Slice 1 — Save Target module  [AFK]
- Status: done
- Blocked by: none
- User stories: 1–6, 8–9, 11–12, 18

**What to build:** The deep Save Target / file-writer module in isolation, with no UI dependency. `saveToFileSystem(mapData, suggestedName)` detects File System Access API support; on a supported browser with no held handle it opens the Save-Location Picker (suggested name pre-filled, `.map` type filter), writes the data, and stores the returned File Handle as the session Save Target; with a handle already held it overwrites in place without a dialog; on user cancel (AbortError) it makes no change; on an unsupported browser it performs the Downloads Fallback. It returns a discriminated outcome (`saved-new` | `overwritten` | `downloaded-fallback` | `cancelled`) plus the resolved filename, and throws on real errors. `clearSaveTarget()` forgets the held handle. Verified headless via unit tests that stub the browser globals.

**Acceptance criteria:**
- [x] Supported browser, no target → picker called once, handle stored, returns `saved-new` with filename
- [x] Supported browser, target held → writes to handle without calling the picker, returns `overwritten`
- [x] User cancels picker → no write, no state change, returns `cancelled`
- [x] Unsupported browser → Downloads Fallback path used, returns `downloaded-fallback`
- [x] `clearSaveTarget()` forgets the target so the next save re-opens the picker
- [x] Real (non-cancel) failures propagate as thrown errors
- [x] Unit tests cover all of the above by stubbing browser globals

### Slice 2 — Wire into Save to Machine  [AFK]
- Status: todo
- Blocked by: Slice 1
- User stories: 7, 10, 13–17

**What to build:** Make `saveToMachine` call `saveToFileSystem` and map the outcome to user feedback: a success tip naming the file on `saved-new`/`overwritten`; a success tip plus a one-time Downloads-fallback note (persisted flag, following the existing `noReminder` one-time-message convention) on `downloaded-fallback`; nothing on `cancelled`. The existing edit-mode guard, `closeDialogs`, and the try/catch error dialog with Retry are preserved, so denied-permission/disk errors surface there. After this slice, both the Save dialog's *machine* button and Ctrl+S open the picker.

**Acceptance criteria:**
- [ ] `saved-new` / `overwritten` show a success tip naming the saved file
- [ ] `downloaded-fallback` shows a success tip plus the Downloads note only the first time ever (flag persisted), and not on later fallback saves
- [ ] `cancelled` shows no tip and no error
- [ ] Edit-mode guard and the existing error dialog (with Retry) still work
- [ ] Tests cover outcome → tip mapping including the one-time note

### Slice 3 — Reset wiring  [AFK]
- Status: todo
- Blocked by: Slice 2
- User stories: 8–9

**What to build:** Call `clearSaveTarget()` at the two map-identity reset points — `parseLoadedData` (a different map loaded) and `regenerateMap` (a new map generated) — so the next Save re-prompts for a location. Initial-load generation needs no explicit reset (target starts empty).

**Acceptance criteria:**
- [ ] Loading a map calls `clearSaveTarget()`
- [ ] Generating a new map calls `clearSaveTarget()`
- [ ] Tests assert the reset happens on load and on regenerate

### Slice 4 — HITL verification  [HITL]
- Status: todo
- Blocked by: Slice 2, Slice 3

**What to build:** Single end-of-feature manual verification in real browsers. No new code beyond fixes found during verification.

**Acceptance criteria:**
- [ ] Chromium: first Save opens the picker and writes to the chosen folder/name
- [ ] Chromium: second Save silently overwrites the same file with a confirmation tip (no duplicate files)
- [ ] Chromium: loading a different map, then Saving, re-prompts for a location
- [ ] Chromium: generating a new map, then Saving, re-prompts for a location
- [ ] Chromium: cancelling the picker is a clean no-op
- [ ] Firefox/Safari: Save falls back to Downloads with the one-time note shown once
