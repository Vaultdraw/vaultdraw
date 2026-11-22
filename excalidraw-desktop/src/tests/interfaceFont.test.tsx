import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getCommand } from "../commands/commands";
import {
  INTERFACE_FONT_COMMAND_HANDLERS,
  uiFontCommandId,
} from "../commands/interfaceFontCommands";
import {
  applyInterfaceFont,
  interfaceFontVars,
  nextUiFontSize,
  UI_SIZE_TOKENS,
  uiFontStack,
  uiRowHeight,
  uiTallRowHeight,
} from "../theme/interfaceFont";
import { useInterfaceFont } from "../theme/useInterfaceFont";
import {
  computeWindow,
  TREE_ROW_HEIGHT,
} from "../components/tree/useTreeWindow";
import { HISTORY_ROW_HEIGHT } from "../history/panel/rowWindow";
import { ROW_HEIGHT as TAG_ROW_HEIGHT } from "../components/tags/TagsPanel";
import {
  DEFAULT_UI_FONT_SIZE,
  getPreferences,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";

const root = document.documentElement;

afterEach(() => {
  cleanup();
  updatePreferences(
    { interfaceFontSize: DEFAULT_UI_FONT_SIZE, interfaceFontFamily: "" },
    window,
  );
  root.removeAttribute("style");
  localStorage.clear();
});

describe("interface.font_size / font_family preferences", () => {
  it("default to 13 px and the default font", () => {
    const d = normalizePreferences({});
    expect(d.interfaceFontSize).toBe(13);
    expect(d.interfaceFontFamily).toBe("");
  });

  it("accept whole sizes 11 to 20 and refuse anything else", () => {
    const size = (v: unknown) =>
      normalizePreferences({ interfaceFontSize: v }).interfaceFontSize;
    expect(size(MIN_UI_FONT_SIZE)).toBe(11);
    expect(size(MAX_UI_FONT_SIZE)).toBe(20);
    expect(size(16)).toBe(16);
    for (const bad of [10, 21, 14.5, "16", null, Number.NaN]) {
      expect(size(bad), String(bad)).toBe(DEFAULT_UI_FONT_SIZE);
    }
  });

  it("accept any font name or list up to 200 characters", () => {
    const fam = (v: unknown) =>
      normalizePreferences({ interfaceFontFamily: v }).interfaceFontFamily;
    expect(fam("Inter")).toBe("Inter");
    expect(fam("Inter, sans-serif")).toBe("Inter, sans-serif");
    expect(fam("x".repeat(201))).toBe("");
    expect(fam(12)).toBe("");
  });
});

describe("tokens written for a size and family", () => {
  it("write nothing at the defaults (zero cost when unused)", () => {
    const vars = interfaceFontVars(DEFAULT_UI_FONT_SIZE, "");
    expect(Object.values(vars).every((v) => v === null)).toBe(true);
    applyInterfaceFont(root, DEFAULT_UI_FONT_SIZE, "");
    expect(root.getAttribute("style") ?? "").toBe("");
  });

  it("scale every size token to whole pixels", () => {
    const at20 = interfaceFontVars(20, "");
    expect(at20["--vd-fs-body"]).toBe("20px");
    expect(at20["--vd-fs-caption"]).toBe("17px");
    expect(at20["--vd-row"]).toBe("40px");
    expect(at20["--vd-row-tall"]).toBe("86px");
    const at11 = interfaceFontVars(11, "");
    expect(at11["--vd-fs-body"]).toBe("11px");
    expect(at11["--vd-row"]).toBe("22px");
    for (const v of Object.values(at20)) {
      if (v) {
        expect(v).toMatch(/^\d+px$|var\(/);
      }
    }
  });

  it("virtualised rows use the same height the CSS gets", () => {
    for (let s = MIN_UI_FONT_SIZE; s <= MAX_UI_FONT_SIZE; s++) {
      const vars = interfaceFontVars(s, "");
      const css = (n: string) => vars[n] ?? `${UI_SIZE_TOKENS[n]}px`;
      expect(css("--vd-row")).toBe(`${uiRowHeight(s)}px`);
      expect(css("--vd-row-tall")).toBe(`${uiTallRowHeight(s)}px`);
    }
    expect(uiRowHeight(DEFAULT_UI_FONT_SIZE)).toBe(TREE_ROW_HEIGHT);
    expect(uiRowHeight(DEFAULT_UI_FONT_SIZE)).toBe(TAG_ROW_HEIGHT);
    expect(uiTallRowHeight(DEFAULT_UI_FONT_SIZE)).toBe(HISTORY_ROW_HEIGHT);
    // A bigger row mounts fewer rows for the same viewport.
    const small = computeWindow(1000, 0, 800, uiRowHeight(11));
    const big = computeWindow(1000, 0, 800, uiRowHeight(20));
    expect(big.end).toBeLessThan(small.end);
  });

  it("defaults in designSystem.css (and the editor's pinned copy) match UI_SIZE_TOKENS", () => {
    for (const file of ["designSystem.css", "excalidrawChrome.css"]) {
      const css = readFileSync(join(__dirname, "..", "theme", file), "utf8");
      for (const [name, px] of Object.entries(UI_SIZE_TOKENS)) {
        expect(css, `${file} ${name}`).toMatch(
          new RegExp(`${name}:\\s*${px}px;`),
        );
      }
    }
  });

  it("quote a single font name, keep lists and generic names, fall back", () => {
    expect(uiFontStack("")).toBeNull();
    expect(uiFontStack("   ")).toBeNull();
    expect(uiFontStack("Inter")).toBe('"Inter", var(--vd-font-default)');
    expect(uiFontStack("Iosevka Aile")).toBe(
      '"Iosevka Aile", var(--vd-font-default)',
    );
    expect(uiFontStack("system-ui")).toBe("system-ui, var(--vd-font-default)");
    expect(uiFontStack("Inter, sans-serif")).toBe(
      "Inter, sans-serif, var(--vd-font-default)",
    );
    expect(uiFontStack("Foo; color: red}")).toBe(
      '"Foo color: red", var(--vd-font-default)',
    );
  });

  it("apply sets the tokens and clears them when back to the defaults", () => {
    applyInterfaceFont(root, 16, "Inter");
    expect(root.style.getPropertyValue("--vd-fs-body")).toBe("16px");
    expect(root.style.getPropertyValue("--vd-font")).toContain('"Inter"');
    applyInterfaceFont(root, DEFAULT_UI_FONT_SIZE, "");
    expect(root.style.getPropertyValue("--vd-fs-body")).toBe("");
    expect(root.style.getPropertyValue("--vd-font")).toBe("");
  });
});

describe("live reload", () => {
  const Probe = () => {
    useInterfaceFont(window);
    return null;
  };

  it("a preference change (Settings or config.toml) restyles at once", () => {
    render(<Probe />);
    expect(root.style.getPropertyValue("--vd-fs-body")).toBe("");
    act(() => {
      updatePreferences({ interfaceFontSize: 18 }, window);
    });
    expect(root.style.getPropertyValue("--vd-fs-body")).toBe("18px");
    act(() => {
      updatePreferences({ interfaceFontFamily: "system-ui" }, window);
    });
    expect(root.style.getPropertyValue("--vd-font")).toMatch(/^system-ui/);
    act(() => {
      updatePreferences(
        { interfaceFontSize: DEFAULT_UI_FONT_SIZE, interfaceFontFamily: "" },
        window,
      );
    });
    expect(root.style.getPropertyValue("--vd-fs-body")).toBe("");
    expect(root.style.getPropertyValue("--vd-font")).toBe("");
  });
});

describe("Interface font palette commands", () => {
  const run = (cmd: "bigger" | "smaller" | "reset") =>
    void INTERFACE_FONT_COMMAND_HANDLERS[uiFontCommandId(cmd)]!();
  const size = () => getPreferences(window).interfaceFontSize;

  it("exist in the registry with no default keys", () => {
    for (const cmd of ["bigger", "smaller", "reset"] as const) {
      const def = getCommand(uiFontCommandId(cmd));
      expect(def, cmd).toBeDefined();
      expect(def!.title).toMatch(/^Interface font: /);
      expect(def!.keys.default).toEqual([]);
    }
  });

  it("step by 1 px, stop at the ends, and reset to 13", () => {
    run("bigger");
    expect(size()).toBe(14);
    run("smaller");
    run("smaller");
    expect(size()).toBe(12);
    for (let i = 0; i < 20; i++) {
      run("smaller");
    }
    expect(size()).toBe(MIN_UI_FONT_SIZE);
    for (let i = 0; i < 20; i++) {
      run("bigger");
    }
    expect(size()).toBe(MAX_UI_FONT_SIZE);
    run("reset");
    expect(size()).toBe(DEFAULT_UI_FONT_SIZE);
    expect(nextUiFontSize(Number.NaN, "bigger")).toBe(14);
  });
});
