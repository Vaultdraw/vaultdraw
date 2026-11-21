import { describe, expect, it, vi } from "vitest";

import { builtinRegistry, listThemeSummaries } from "../../theme/registry";

import { createCommandsProvider } from "./commands";
import { createThemesProvider } from "./themes";

const runnerWith = (available: (id: string) => boolean) => ({
  run: vi.fn(() => true),
  isAvailable: vi.fn((id: string) => available(id)),
  platform: "mac" as const,
});

describe("commands provider", () => {
  it("lists available registry commands with shortcuts, never the commands mode itself or hidden ones", () => {
    const runner = runnerWith(() => true);
    const items = createCommandsProvider({
      runner,
      overrides: () => ({}),
    }).items();
    const keys = items.map((i) => i.key);
    expect(keys).toContain("command:file.save");
    expect(keys).not.toContain("command:palette.commands");
    expect(keys).toContain("command:palette.files");
    expect(keys.some((k) => k.startsWith("command:pen.select"))).toBe(false);
    expect(items.find((i) => i.key === "command:file.save")).toMatchObject({
      title: "Save drawing",
      group: "File",
      shortcut: "⌘S",
    });
    expect(runner.isAvailable).toHaveBeenCalledWith("file.save", {
      fromPalette: true,
    });
  });

  it("skips unavailable commands, honours rebinds and checked", () => {
    const runner = runnerWith((id) => id !== "file.save");
    const items = createCommandsProvider({
      runner,
      overrides: () => ({ "vault.newDrawing": ["Mod+J"] }),
      checked: (id) => id === "appearance.mode.dark",
    }).items();
    expect(items.find((i) => i.key === "command:file.save")).toBeUndefined();
    expect(
      items.find((i) => i.key === "command:vault.newDrawing")?.shortcut,
    ).toBe("⌘J");
    expect(
      items.find((i) => i.key === "command:appearance.mode.dark")?.checked,
    ).toBe(true);
    expect(
      items.find((i) => i.key === "command:appearance.mode.light")?.checked,
    ).toBeUndefined();
  });

  it("runs through the runner with fromPalette", () => {
    const runner = runnerWith(() => true);
    const item = createCommandsProvider({
      runner,
      overrides: () => ({}),
    })
      .items()
      .find((i) => i.key === "command:file.save")!;
    void item.run();
    expect(runner.run).toHaveBeenCalledWith("file.save", { fromPalette: true });
  });
});

describe("themes provider", () => {
  it("lists every theme, marks the current one and selects by key", () => {
    const registry = builtinRegistry();
    const summaries = listThemeSummaries(registry);
    const select = vi.fn();
    const all = createThemesProvider({
      registry: () => registry,
      currentKey: () => summaries[0].key,
      select,
    }).items();
    expect(all[0]).toMatchObject({
      key: "family:theme",
      title: "Family: Theme",
      drill: "Theme: ",
      family: true,
    });
    const items = all.slice(1);
    expect(items).toHaveLength(summaries.length);
    expect(items[0]).toMatchObject({
      key: `theme:${summaries[0].name}`,
      title: `Theme: ${summaries[0].name}`,
      group: "Appearance",
      checked: true,
    });
    expect(items.filter((i) => i.checked)).toHaveLength(1);
    // Every theme row can be previewed; the family row cannot.
    expect(items.map((i) => i.previewKey)).toEqual(summaries.map((s) => s.key));
    expect(all[0].previewKey).toBeUndefined();
    void items[1].run();
    expect(select).toHaveBeenCalledWith(summaries[1].key);
  });
});
