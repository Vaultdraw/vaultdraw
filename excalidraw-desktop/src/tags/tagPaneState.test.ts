import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePreferences } from "../vault/preferences";

import { loadPaneState, savePaneState } from "./tagPaneState";

beforeEach(() => window.localStorage.clear());

describe("tag pane state", () => {
  it("round-trips per vault and merges patches", () => {
    savePaneState("/v1", { sort: "count" });
    savePaneState("/v1", { collapsed: ["a"], open: false });
    savePaneState("/v2", { sort: "name" });
    expect(loadPaneState("/v1")).toEqual({
      sort: "count",
      open: false,
      collapsed: ["a"],
    });
    expect(loadPaneState("/v2").sort).toBe("name");
    expect(loadPaneState("/none")).toEqual({});
  });

  it("keeps one vault's choice apart from another's, with odd paths", () => {
    savePaneState("/a b/Ünï", { open: false });
    savePaneState("/a b/Ünï/", { open: true });
    expect(loadPaneState("/a b/Ünï").open).toBe(false);
    expect(loadPaneState("/a b/Ünï/").open).toBe(true);
  });

  it("ignores corrupt data", () => {
    window.localStorage.setItem("excalidraw-vault-preferences-v1", "{nope");
    expect(loadPaneState("/v1")).toEqual({});
    updatePreferences(
      {
        tagsPane: { "/v1": { sort: "weird", collapsed: [1, "a"] } },
      } as never,
      window,
    );
    expect(loadPaneState("/v1")).toEqual({ collapsed: ["a"] });
  });

  it("survives unavailable storage", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(loadPaneState("/v1")).toEqual({});
    expect(() => savePaneState("/v1", { sort: "name" })).not.toThrow();
    spy.mockRestore();
  });
});
