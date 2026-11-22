/**
 * Toimprove 345: text already on the canvas (written before Markdown mode was
 * turned on, or pasted) converts when the mode is turned on, and with the
 * "Markdown: Convert existing text" command, as Obsidian shows any `# ` line
 * as a heading however it got there.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newTextElement } from "@excalidraw/element";

import { getRegisteredHandler } from "../commands/handlerRegistry";

import { useMarkdownMode } from "./useMarkdownMode";

vi.mock("../editor/links/remeasure", () => ({
  fontsReady: async () => undefined,
  // height from the line count, like the editor's measure
  measureTextUpdate: (el: any, _map: unknown, source?: string) => {
    const text = source ?? el.originalText;
    return {
      text,
      height: text.split("\n").length * el.fontSize * el.lineHeight,
    };
  },
}));

type El = Record<string, any>;

const text = (t: string, extra: El = {}): El => ({
  ...newTextElement({ text: t, x: 0, y: 0, fontSize: 20, fontFamily: 5 }),
  ...extra,
});

function setup(elements: El[], opts: { on?: boolean | null } = {}) {
  let scene = elements;
  let selected: Record<string, boolean> = {};
  const updates: any[] = [];
  const api = {
    getAppState: () => ({ selectedElementIds: selected }),
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    updateScene: (d: any) => {
      if (d.elements) {
        scene = d.elements;
      }
      updates.push(d);
    },
  };
  const onChange = vi.fn();
  const hook = renderHook(() =>
    useMarkdownMode({
      getWindow: () => window,
      getApi: () => api as never,
      getContainer: () => null,
      isWritable: () => true,
      onChange,
    }),
  );
  act(() => hook.result.current.load(opts.on ?? null));
  return {
    hook,
    scene: () => scene,
    updates,
    select: (ids: string[]) => {
      selected = Object.fromEntries(ids.map((id) => [id, true]));
    },
    byText: (t: string) => scene.find((e) => e.originalText === t),
  };
}

/** Scene changes that make an undo step (repaints of the styler make none). */
const undoSteps = (updates: any[]) =>
  updates.filter((u) => u.captureUpdate === "IMMEDIATELY").length;

const settle = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("turning Markdown mode on converts the text already there", () => {
  it("a plain `# Title` text becomes a heading 1 (the owner's screenshot case)", async () => {
    const t = setup([text("#  All the Things to improve")], { on: false });
    await act(async () => {
      t.hook.result.current.toggle();
      await settle();
    });
    const el = t.byText("All the Things to improve");
    expect(el?.customData?.role).toBe("h1");
    expect(el?.fontSize).toBe(40);
    // one undo step for the whole conversion
    expect(t.updates.filter((u) => u.elements)).toHaveLength(1);
    expect(t.updates.find((u) => u.elements).captureUpdate).toBe("IMMEDIATELY");
  });

  it("turning the mode off converts nothing", async () => {
    const t = setup([text("# Title")], { on: true });
    await act(async () => {
      t.hook.result.current.toggle();
      await settle();
    });
    expect(t.byText("# Title")?.customData?.role).toBeUndefined();
    expect(undoSteps(t.updates)).toBe(0);
  });

  it("the command converts the selection only, else the whole drawing; nothing with the mode off", async () => {
    const a = text("# A");
    const b = text("## B");
    const t = setup([a, b], { on: true });
    t.select([a.id]);
    await act(async () => {
      getRegisteredHandler("markdown.convertExisting")?.();
      await settle();
    });
    expect(t.byText("A")?.customData?.role).toBe("h1");
    expect(t.byText("## B")?.customData?.role).toBeUndefined();
    t.select([]);
    await act(async () => {
      getRegisteredHandler("markdown.convertExisting")?.();
      await settle();
    });
    expect(t.byText("B")?.customData?.role).toBe("h2");

    const off = setup([text("# Off")], { on: false });
    await act(async () => {
      getRegisteredHandler("markdown.convertExisting")?.();
      await settle();
    });
    expect(off.byText("# Off")?.customData?.role).toBeUndefined();
  });
});
