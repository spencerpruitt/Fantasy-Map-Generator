import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSaveTarget, saveToFileSystem } from "./save-to-file";

// A fake FileSystemFileHandle: records what was written and how often.
function makeHandle(name: string) {
  const writes: string[] = [];
  let closed = 0;
  const handle = {
    name,
    writes,
    closeCount: () => closed,
    createWritable: vi.fn(async () => ({
      write: async (data: string) => {
        writes.push(data);
      },
      close: async () => {
        closed++;
      }
    }))
  };
  return handle;
}

function abortError() {
  const error = new Error("The user aborted a request.");
  error.name = "AbortError";
  return error;
}

describe("saveToFileSystem", () => {
  beforeEach(() => {
    clearSaveTarget();
  });

  afterEach(() => {
    delete (globalThis as any).showSaveFilePicker;
    delete (globalThis as any).downloadFile;
    vi.restoreAllMocks();
  });

  it("opens the picker on first save and reports saved-new with the chosen filename", async () => {
    const handle = makeHandle("Chosen.map");
    const picker = vi.fn(async () => handle);
    (globalThis as any).showSaveFilePicker = picker;

    const outcome = await saveToFileSystem("map-data", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(handle.writes).toEqual(["map-data"]);
    expect(outcome).toEqual({ type: "saved-new", filename: "Chosen.map" });
  });

  it("offers the suggested name and constrains the picker to .map files", async () => {
    const picker = vi.fn(async (_options?: any) => makeHandle("Chosen.map"));
    (globalThis as any).showSaveFilePicker = picker;

    await saveToFileSystem("map-data", "Suggested.map");

    const options = picker.mock.calls[0][0];
    expect(options.suggestedName).toBe("Suggested.map");
    const acceptedExtensions = options.types.flatMap((t: any) => Object.values(t.accept).flat());
    expect(acceptedExtensions.includes(".map")).toBe(true);
  });

  it("overwrites the remembered file without re-opening the picker on later saves", async () => {
    const handle = makeHandle("Chosen.map");
    const picker = vi.fn(async () => handle);
    (globalThis as any).showSaveFilePicker = picker;

    await saveToFileSystem("first", "Suggested.map");
    const outcome = await saveToFileSystem("second", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(handle.writes).toEqual(["first", "second"]);
    expect(outcome).toEqual({ type: "overwritten", filename: "Chosen.map" });
  });

  it("treats a cancelled picker as a no-op and remembers nothing", async () => {
    const picker = vi.fn(async () => {
      throw abortError();
    });
    (globalThis as any).showSaveFilePicker = picker;

    const outcome = await saveToFileSystem("map-data", "Suggested.map");
    expect(outcome).toEqual({ type: "cancelled" });

    // Nothing was remembered: a following successful save must open the picker again.
    const handle = makeHandle("Chosen.map");
    (globalThis as any).showSaveFilePicker = vi.fn(async () => handle);
    const second = await saveToFileSystem("map-data", "Suggested.map");
    expect(second).toEqual({ type: "saved-new", filename: "Chosen.map" });
  });

  it("propagates non-cancel picker errors to the caller", async () => {
    const securityError = new Error("denied");
    securityError.name = "SecurityError";
    (globalThis as any).showSaveFilePicker = vi.fn(async () => {
      throw securityError;
    });

    await expect(saveToFileSystem("map-data", "Suggested.map")).rejects.toThrow("denied");
  });

  it("falls back to the shared downloadFile helper when the picker API is unavailable", async () => {
    delete (globalThis as any).showSaveFilePicker;
    const downloadFile = vi.fn();
    (globalThis as any).downloadFile = downloadFile;

    const outcome = await saveToFileSystem("map-data", "Suggested.map");

    expect(downloadFile).toHaveBeenCalledWith("map-data", "Suggested.map");
    expect(outcome).toEqual({ type: "downloaded-fallback", filename: "Suggested.map" });
  });

  it("does not remember the target when the first write fails", async () => {
    const handle = makeHandle("Chosen.map");
    handle.createWritable.mockImplementationOnce(async () => {
      throw new Error("write failed");
    });
    (globalThis as any).showSaveFilePicker = vi.fn(async () => handle);

    await expect(saveToFileSystem("data", "Suggested.map")).rejects.toThrow("write failed");

    // The bad handle wasn't remembered: the next save re-opens the picker.
    const fresh = makeHandle("Fresh.map");
    const picker = vi.fn(async () => fresh);
    (globalThis as any).showSaveFilePicker = picker;
    const outcome = await saveToFileSystem("data", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ type: "saved-new", filename: "Fresh.map" });
  });

  it("forgets the target and re-opens the picker when an overwrite write fails", async () => {
    const good = makeHandle("Chosen.map");
    (globalThis as any).showSaveFilePicker = vi.fn(async () => good);
    await saveToFileSystem("first", "Suggested.map");

    // The remembered file becomes unwritable (moved/deleted/permission revoked).
    good.createWritable.mockImplementationOnce(async () => {
      throw new Error("NotAllowedError");
    });
    await expect(saveToFileSystem("second", "Suggested.map")).rejects.toThrow("NotAllowedError");

    // The next save must re-open the picker rather than reuse the dead handle.
    const fresh = makeHandle("Fresh.map");
    const picker = vi.fn(async () => fresh);
    (globalThis as any).showSaveFilePicker = picker;
    const outcome = await saveToFileSystem("third", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ type: "saved-new", filename: "Fresh.map" });
  });

  it("treats a cancelled picker (DOMException-style AbortError) as a no-op", async () => {
    // DOMException is not reliably instanceof Error across engines.
    const abort = { name: "AbortError", message: "aborted" };
    (globalThis as any).showSaveFilePicker = vi.fn(async () => {
      throw abort;
    });

    const outcome = await saveToFileSystem("data", "Suggested.map");
    expect(outcome).toEqual({ type: "cancelled" });
  });

  it("re-opens the picker after the save target is cleared", async () => {
    const first = makeHandle("First.map");
    (globalThis as any).showSaveFilePicker = vi.fn(async () => first);
    await saveToFileSystem("a", "Suggested.map");

    clearSaveTarget();

    const second = makeHandle("Second.map");
    const picker = vi.fn(async () => second);
    (globalThis as any).showSaveFilePicker = picker;
    const outcome = await saveToFileSystem("b", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ type: "saved-new", filename: "Second.map" });
  });

  it("exposes clearSaveTarget on window so legacy scripts can reset the target", async () => {
    expect((globalThis as any).clearSaveTarget).toBe(clearSaveTarget);

    const first = makeHandle("First.map");
    (globalThis as any).showSaveFilePicker = vi.fn(async () => first);
    await saveToFileSystem("a", "Suggested.map");

    // Legacy regenerateMap calls window.clearSaveTarget?.()
    (globalThis as any).clearSaveTarget();

    const second = makeHandle("Second.map");
    const picker = vi.fn(async () => second);
    (globalThis as any).showSaveFilePicker = picker;
    const outcome = await saveToFileSystem("b", "Suggested.map");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ type: "saved-new", filename: "Second.map" });
  });
});
