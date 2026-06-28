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

// Forget the remembered file so the next save re-opens the picker. Called when a
// different map is loaded or a new map is generated.
export function clearSaveTarget(): void {
  saveTarget = null;
}

function isFilePickerSupported(): boolean {
  return typeof window.showSaveFilePicker === "function";
}

async function writeToHandle(handle: FileSystemFileHandle, mapData: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(mapData);
  await writable.close();
}

// Legacy download path for browsers without the File System Access API: write the
// blob to the Downloads folder via a transient anchor element.
function downloadToMachine(mapData: string, filename: string): void {
  const blob = new Blob([mapData], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();

  setTimeout(() => window.URL.revokeObjectURL(url), 5000);
}

export async function saveToFileSystem(mapData: string, suggestedName: string): Promise<SaveOutcome> {
  if (!isFilePickerSupported()) {
    downloadToMachine(mapData, suggestedName);
    return { type: "downloaded-fallback", filename: suggestedName };
  }

  if (saveTarget) {
    await writeToHandle(saveTarget, mapData);
    return { type: "overwritten", filename: saveTarget.name };
  }

  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName });
  } catch (error) {
    // The picker throws AbortError when the user dismisses the dialog — not a
    // failure, just nothing to save. Any other error is a real problem.
    if (error instanceof Error && error.name === "AbortError") {
      return { type: "cancelled" };
    }
    throw error;
  }

  saveTarget = handle;
  await writeToHandle(handle, mapData);
  return { type: "saved-new", filename: handle.name };
}
