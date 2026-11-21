import { afterEach, describe, expect, it } from "vitest";

import { getPreferences } from "../vault/preferences";

import { getRecent, recordRecent } from "./recent";

afterEach(() => localStorage.clear());

describe("recent", () => {
  it("records most recent first without duplicates, in the preferences", () => {
    recordRecent("a", window);
    recordRecent("b", window);
    recordRecent("a", window);
    expect(getRecent("commands", window)).toEqual(["a", "b"]);
    expect(getPreferences(window).paletteRecent.commands).toEqual(["a", "b"]);
  });

  it("keeps one list per mode", () => {
    recordRecent("drawing:x.excalidraw", window);
    recordRecent("command:file.save", window);
    recordRecent("drawing:y.excalidraw", window);
    expect(getRecent("files", window)).toEqual([
      "drawing:y.excalidraw",
      "drawing:x.excalidraw",
    ]);
    expect(getRecent("commands", window)).toEqual(["command:file.save"]);
  });

  it("keeps at most 30", () => {
    for (let i = 0; i < 40; i++) {
      recordRecent(`k${i}`, window);
    }
    const list = getRecent("commands", window);
    expect(list).toHaveLength(30);
    expect(list[0]).toBe("k39");
  });

  it("without a window keeps the list for this session", () => {
    recordRecent("x", null);
    expect(getRecent("commands", null)).toEqual(["x"]);
    expect(getRecent("files", null)).toEqual([]);
  });

  it("ignores non-string entries in stored preferences", () => {
    localStorage.setItem(
      "excalidraw-vault-preferences-v1",
      JSON.stringify({ paletteRecent: { commands: ["a", 3, null, "b"] } }),
    );
    expect(getRecent("commands", window)).toEqual(["a", "b"]);
    expect(getRecent("files", window)).toEqual([]);
  });
});
