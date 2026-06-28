# PRD: Save-Location Picker for Save to Machine

Status: done
Branch: `feat/download-path-selector`

## Problem Statement

When a user clicks **Save → machine** (or presses Ctrl+S), the `.map` project file is dropped silently into the browser's **Downloads** folder with an auto-generated name like `MyWorld 2026-06-27-21-45.map`. The user can't choose where the file goes or what it's called. This causes real friction:

- They can't save the map into the folder where they keep their world (e.g. a campaign folder), so they have to find it in Downloads and move it manually every time.
- They can't decide, at save time, whether to overwrite an existing file or write a new copy — every save just lands in Downloads under a generated name.
- There's no "Save As" experience like a normal desktop program, where saving lets you choose exactly where and under what name the file is written.

## Solution

On **Save to Machine**, open the operating system's File Explorer "Save As" dialog (the **Save-Location Picker**) so the user picks the folder and filename — **every time they save**. This gives the user full control on each save: overwrite the same file by choosing it again, or write a different/new file by choosing a new name or folder. The dialog is pre-filled with a sensible default name and defaults to `.map`.

This uses the browser's **File System Access API**, which only exists in Chromium-based browsers (Chrome, Edge, Opera, Brave). In Firefox and Safari the picker isn't available, so the app gracefully falls back to the **Downloads Fallback** behavior, with a one-time note explaining why. Saving always works everywhere.

Scope is deliberately narrow: **`.map` Save to Machine only.** Dropbox, browser-storage save, auto-save, and all Export formats are untouched.

## User Stories

1. As a mapmaker, I want to choose the folder when I save my map, so that it lands directly in my campaign folder instead of Downloads.
2. As a mapmaker, I want to choose the filename when I save, so that I can name the file meaningfully instead of accepting a timestamped default.
3. As a mapmaker, I want the save dialog to appear **every time I save**, so that I can change the location or save a different file whenever I want.
4. As a mapmaker, I want to overwrite an existing map file by picking it in the dialog, so that I can update a file in place when I choose to.
5. As a mapmaker, I want to save a new/separate copy by picking a new name or folder, so that I can keep variants or backups when I choose to.
6. As a mapmaker, I want the save dialog to pre-fill a sensible default name (current map name + date), so that I can accept it with one click or rename it freely.
7. As a mapmaker, I want the save dialog to default to `.map` files, so that the file type is correct without me thinking about it.
8. As a mapmaker, I want pressing Ctrl+S to behave exactly like clicking the Save dialog's **machine** button, so that the keyboard shortcut and the button stay consistent.
9. As a mapmaker, I want a short confirmation each time I save (e.g. "Saved to MyWorld.map"), so that I know the save succeeded and to which file.
10. As a mapmaker, I want to cancel the save dialog without any error or side effect, so that backing out is harmless.
11. As a Firefox or Safari user, I want Save to keep working, so that my browser choice doesn't break saving.
12. As a Firefox or Safari user, I want a one-time note the first time I save, so that I understand why I'm not getting a location picker and that the file went to Downloads.
13. As a returning Firefox/Safari user, I do not want to see the Downloads note on every save, so that the message isn't nagging.
14. As a mapmaker, I want clear feedback if a save fails (e.g. I deny disk permission, or a disk error occurs), so that I know it didn't save and can retry.
15. As a mapmaker, I want Dropbox save, browser-storage save, auto-save, and all Exports to behave exactly as before, so that this change doesn't disrupt my other workflows.
16. As a mapmaker in edit/customization mode, I want saving to remain blocked with the existing message, so that I don't save an inconsistent map mid-edit.

## Implementation Decisions

### Scope
- The picker applies **only** to the `.map` **Save to Machine** path (`saveMap("machine")` → `saveToMachine`), reached from both the Save dialog's *machine* button and the Ctrl+S hotkey. Both inherit the new behavior automatically because they share that one code path.
- Dropbox (`method="dropbox"`), browser storage (`method="storage"`), auto-save (writes to browser storage), and every Export format (png/svg/jpeg/zip tiles/geojson/json) are explicitly **out of scope** and unchanged.

### Always prompt (no remembered file)
- **Every** save opens the picker. The module holds **no state** between saves — there is no remembered file handle, no silent overwrite-in-place, and therefore no reset wiring needed on map load/regenerate. The user decides on each save whether to overwrite (pick the same file) or write a new file (pick a new name/folder).

### Deep module: file writer
A small IO module encapsulates the File System Access API behind a single function.

- `saveToFileSystem(mapData, suggestedName)` — the single entry point. Internally it:
  - Detects whether the **File System Access API** is available.
  - If available: opens the **Save-Location Picker** (`showSaveFilePicker`) with the suggested name pre-filled and the file type filtered to `.map`, then writes the data to the chosen file.
  - If the user cancels the picker (AbortError, checked by name so a DOMException is handled): makes no changes and reports a `cancelled` outcome.
  - If the API is unavailable: performs the **Downloads Fallback** by delegating to the app's shared global `downloadFile` helper.
  - Returns a small discriminated **outcome** so the caller owns user messaging: `saved` (with the chosen filename), `downloaded-fallback` (with the suggested filename), or `cancelled`. Real errors (denied permission, write failure) propagate as thrown exceptions for the caller's existing error dialog.

Rationale: hide the branchy, browser-specific logic (support detection, cancel handling, fallback) behind one function whose return value is pure enough to unit-test by stubbing browser globals. Tips and dialogs stay in the caller so the module has no UI dependency.

### Modify `saveToMachine` (in the existing save module)
- `saveToMachine` is a thin wrapper: call `saveToFileSystem`, then map the outcome to `tip(...)`:
  - `saved` → success tip naming the chosen file.
  - `downloaded-fallback` → a **single** success tip that, the first time ever on that browser, also explains why no picker was offered; afterward just the plain success tip. (One tip, not two — a second `tip()` overwrites the first in the tooltip.) The "already explained" flag is persisted in `localStorage`, following the existing one-time-message convention (`noReminder`); the read/write is guarded so a save never fails when storage is blocked (e.g. Safari private mode).
  - `cancelled` → no tip, no error.
- The existing edit-mode guard, `closeDialogs`, and the try/catch error dialog (with Retry) are preserved. A denied-permission or disk error surfaces through that same error dialog.

### Default filename and file type in the picker
- Suggested name = the existing `getFileName()` output + `.map` (current map name + timestamp), so the default matches today's naming. Because the default carries a timestamp, accepting it repeatedly naturally produces distinct files; the user overwrites by choosing an existing name.
- The picker's accepted type filters to `.map`, so the dialog defaults to the right extension while still allowing a rename.

## Testing Decisions

Good tests assert **external, observable behavior** — which browser API gets called, what outcome value comes back, which tip text is shown — not internal wiring. Browser capabilities are simulated by stubbing globals (`window.showSaveFilePicker`, the handle's `createWritable`, the global `downloadFile`, `localStorage`) rather than reaching into module internals.

Prior art: existing Vitest unit tests, especially `src/controllers/bulk-action/bulk-selection.test.ts` and the bulk-action adapter tests (plain `describe/it/expect`, module-in-isolation style). These are the first tests under `src/io/`.

Modules tested:

1. **File writer module** (`saveToFileSystem`):
   - Supported browser → calls the picker, writes, returns `saved` with the chosen filename.
   - Picker is opened on **every** save (two consecutive saves → two picker calls, each can return a different file).
   - Suggested name is passed and the picker is constrained to `.map`.
   - User cancels (AbortError, including DOMException-style without `instanceof Error`) → no write, returns `cancelled`.
   - Unsupported browser → delegates to `downloadFile`, returns `downloaded-fallback`.
   - Real picker/write errors propagate as thrown errors.

2. **`saveToMachine` outcome → tip mapping** (`notifySaveOutcome`):
   - `saved` → success tip naming the file.
   - `downloaded-fallback` → one combined tip first time (confirms save + explains missing picker), plain success tip afterward.
   - `cancelled` → no tip.
   - Save still succeeds (no throw, success tip) when `localStorage` throws.

## Out of Scope

- The picker for any **Export** format (png/svg/jpeg/zip tiles/geojson/json) and for **Dropbox** / **browser-storage** save.
- **Remembering a save file** across saves (silent overwrite-in-place) or across sessions. Deliberately dropped: every save prompts.
- Auto-save changes — auto-save continues to write to browser storage.
- Changing the `.map` file format or `prepareMapData`.

## Further Notes

- Both Ctrl+S and the Save dialog's *machine* button route through `saveMap("machine")`, so no per-trigger handling is needed.
- The one-time Downloads-fallback explanation reuses the existing one-time-message convention (a `localStorage` flag, as the save reminder does with `noReminder`).
- New domain terms in `docs/domain/glossary.md`: **Save to Machine**, **File System Access API**, **Save-Location Picker**, **Downloads Fallback**.
- Design note: an earlier iteration of this feature remembered the chosen file and silently overwrote it on later saves (with reset-on-load/regenerate wiring). That was replaced — by request — with **always-prompt** so the user can change the path or save a different file on every save. The remembered-handle state and reset wiring were removed.
- Any change with a visual/runtime component is HITL-verified once at the end of the feature (see Slice 4).

## Vertical Slices

### Slice 1 — File writer module  [AFK]
- Status: done
- Blocked by: none
- User stories: 1–7, 10, 11

**What to build:** The deep file-writer module in isolation, no UI dependency and no cross-save state. `saveToFileSystem(mapData, suggestedName)` detects File System Access API support; when supported it opens the Save-Location Picker (suggested name pre-filled, `.map` type filter) on **every** call, writes the chosen file, and returns `saved` with the chosen filename; on user cancel (AbortError, name-checked) it makes no change and returns `cancelled`; on an unsupported browser it delegates to the shared `downloadFile` and returns `downloaded-fallback`. Real errors propagate. Verified headless via unit tests that stub the browser globals.

**Acceptance criteria:**
- [x] Supported browser → picker called, file written, returns `saved` with chosen filename
- [x] Picker opens on every save (consecutive saves → consecutive picker calls, possibly different files)
- [x] Suggested name passed and picker constrained to `.map`
- [x] User cancels picker (incl. DOMException-style AbortError) → no write, returns `cancelled`
- [x] Unsupported browser → delegates to `downloadFile`, returns `downloaded-fallback`
- [x] Real (non-cancel) picker/write failures propagate as thrown errors
- [x] Unit tests cover all of the above by stubbing browser globals

### Slice 2 — Wire into Save to Machine  [AFK]
- Status: done
- Blocked by: Slice 1
- User stories: 8, 9, 12–16

**What to build:** Make `saveToMachine` call `saveToFileSystem` and map the outcome to feedback: a success tip naming the file on `saved`; a single combined tip on the first Downloads fallback (confirms save + explains missing picker) and a plain success tip afterward, with the one-time flag persisted in guarded `localStorage`; nothing on `cancelled`. The edit-mode guard, `closeDialogs`, and the try/catch error dialog with Retry are preserved. After this slice both the *machine* button and Ctrl+S open the picker.

**Acceptance criteria:**
- [x] `saved` shows a success tip naming the saved file
- [x] First Downloads fallback shows one combined tip; later fallbacks show only the success tip
- [x] `cancelled` shows no tip and no error
- [x] Save never fails due to `localStorage` being unavailable
- [x] Edit-mode guard and the existing error dialog (with Retry) still work
- [x] Tests cover outcome → tip mapping including the one-time explanation and storage-unavailable

### Slice 3 — (removed)
- Status: done (removed)

The original "reset wiring" slice (forget a remembered save file on map load/regenerate) no longer applies: the always-prompt design holds no remembered file, so there is nothing to reset. The remembered-handle state, `clearSaveTarget`, the `window.clearSaveTarget` bridge, and the load/regenerate call sites were removed.

### Slice 4 — HITL verification  [HITL]
- Status: done
- Blocked by: Slice 2

**What to build:** Single end-of-feature manual verification in real browsers. No new code beyond fixes found during verification.

**Acceptance criteria:**
- [x] Chromium: every Save (button + Ctrl+S) opens the picker, pre-filled with a `.map` name
- [x] Chromium: choosing an existing file overwrites it; choosing a new name writes a new file
- [x] Chromium: the success tip names the chosen file
- [x] Chromium: cancelling the picker is a clean no-op (no error, nothing written)
- [x] Firefox/Safari: Save falls back to Downloads; the first save shows one combined tip, later saves show only the success tip

**Verified:** HITL passed — all scenarios confirmed working in Chromium (picker every save, overwrite vs new file, success tip, clean cancel) and the Downloads fallback path.
