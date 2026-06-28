import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifySaveOutcome } from "./save";

describe("notifySaveOutcome", () => {
  let tipMock: ReturnType<typeof vi.fn>;
  let store: Record<string, string>;

  beforeEach(() => {
    tipMock = vi.fn();
    (globalThis as any).tip = tipMock;

    store = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a success tip naming the file for a new save", () => {
    notifySaveOutcome({ type: "saved-new", filename: "MyWorld.map" });

    expect(tipMock).toHaveBeenCalledTimes(1);
    expect(tipMock).toHaveBeenCalledWith(expect.stringContaining("MyWorld.map"), true, "success", 8000);
  });

  it("shows a success tip naming the file when overwriting", () => {
    notifySaveOutcome({ type: "overwritten", filename: "MyWorld.map" });

    expect(tipMock).toHaveBeenCalledTimes(1);
    expect(tipMock).toHaveBeenCalledWith(expect.stringContaining("MyWorld.map"), true, "success", 8000);
  });

  it("shows no tip and no error when the picker was cancelled", () => {
    notifySaveOutcome({ type: "cancelled" });

    expect(tipMock).not.toHaveBeenCalled();
  });

  it("on Downloads fallback shows the success tip plus a one-time explanatory note", () => {
    notifySaveOutcome({ type: "downloaded-fallback", filename: "MyWorld.map" });

    // One success tip ("Downloads folder") + one explanatory note.
    expect(tipMock).toHaveBeenCalledTimes(2);
    expect(tipMock).toHaveBeenCalledWith(expect.stringContaining("Downloads"), true, "success", 8000);
    expect(tipMock.mock.calls.some(([message]) => message.includes("save-location picker"))).toBe(true);
  });

  it("does not repeat the explanatory note on later fallback saves", () => {
    notifySaveOutcome({ type: "downloaded-fallback", filename: "MyWorld.map" });
    tipMock.mockClear();

    notifySaveOutcome({ type: "downloaded-fallback", filename: "MyWorld.map" });

    // Only the success tip this time; the explanatory note is suppressed.
    expect(tipMock).toHaveBeenCalledTimes(1);
    expect(tipMock).toHaveBeenCalledWith(expect.stringContaining("Downloads"), true, "success", 8000);
  });
});
