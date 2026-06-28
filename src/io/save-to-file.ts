// Save Target / file writer for the .map "Save to Machine" path.
//
// Encapsulates the File System Access API (Chromium-only): on the first save it
// opens the OS Save-Location Picker and remembers the chosen file (the session
// Save Target); later saves overwrite that file in place without a dialog. The
// remembered handle lives only for the tab session. The caller owns all user
// messaging — this module just reports a discriminated outcome.

export type SaveOutcome =
  | { type: "saved-new"; filename: string }
  | { type: "overwritten"; filename: string }
  | { type: "downloaded-fallback"; filename: string }
  | { type: "cancelled" };

let saveTarget: FileSystemFileHandle | null = null;

// Forget the remembered file (on map load or regenerate) so the next save
// re-opens the picker.
export function clearSaveTarget(): void {
  saveTarget = null;
}

// Expose the reset to legacy public/ scripts (e.g. regenerateMap in main.js),
// which can't import this module directly.
if (typeof window !== "undefined") {
  window.clearSaveTarget = clearSaveTarget;
}

function isFilePickerSupported(): boolean {
  return typeof window.showSaveFilePicker === "function";
}

// Restrict the picker to .map files so the chosen name defaults to the right
// extension.
const MAP_FILE_TYPES = [{ description: "Fantasy Map Generator map", accept: { "application/octet-stream": [".map"] } }];

async function writeToHandle(handle: FileSystemFileHandle, mapData: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(mapData);
  await writable.close();
}

export async function saveToFileSystem(mapData: string, suggestedName: string): Promise<SaveOutcome> {
  if (!isFilePickerSupported()) {
    // No File System Access API — reuse the app's shared download helper.
    downloadFile(mapData, suggestedName);
    return { type: "downloaded-fallback", filename: suggestedName };
  }

  if (saveTarget) {
    const handle = saveTarget;
    try {
      await writeToHandle(handle, mapData);
    } catch (error) {
      // The remembered file may have been moved, deleted, or had its write
      // permission revoked. Forget it so the next save re-opens the picker
      // instead of failing forever against a dead handle.
      saveTarget = null;
      throw error;
    }
    return { type: "overwritten", filename: handle.name };
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName, types: MAP_FILE_TYPES });
  } catch (error) {
    // The picker rejects with a DOMException named AbortError when the user
    // dismisses the dialog — not a failure, just nothing to save. (DOMException
    // isn't reliably `instanceof Error` across engines, so check the name only.)
    if ((error as { name?: string } | null)?.name === "AbortError") {
      return { type: "cancelled" };
    }
    throw error;
  }

  // Only remember the file once the first write succeeds, so a failed first
  // write re-opens the picker next time instead of trapping a bad handle.
  await writeToHandle(handle, mapData);
  saveTarget = handle;
  return { type: "saved-new", filename: handle.name };
}
