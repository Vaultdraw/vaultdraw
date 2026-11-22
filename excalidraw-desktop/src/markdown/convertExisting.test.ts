/**
 * Converting text already on the canvas (toimprove 345): one case table of
 * what each existing text becomes, plus the scene rules (what is never
 * touched, where new boxes go, one undo step).
 */
import { describe, expect, it, vi } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";

import { convertExistingText, planConversion } from "./convertExisting";
import { DEFAULT_MARKDOWN_TYPING_SETTINGS } from "./markdownTyping";

vi.mock("../editor/links/remeasure", () => ({
  fontsReady: async () => undefined,
  measureTextUpdate: (el: any, _map: unknown, source?: string) => {
    const text = source ?? el.originalText;
    return {
      text,
      height: text.split("\n").length * el.fontSize * el.lineHeight,
    };
  },
}));

type Case = [string, string, ReturnType<typeof planConversion>];

/** [what, source text, boxes it becomes (null = unchanged)] */
const CASES: Case[] = [
  ["heading 1", "# Title", [{ text: "Title", role: "h1" }]],
  ["heading 2", "## Title", [{ text: "Title", role: "h2" }]],
  ["heading 3", "### Title", [{ text: "Title", role: "h3" }]],
  ["heading 4", "#### Title", [{ text: "Title", role: "h4" }]],
  ["heading 5", "##### Title", [{ text: "Title", role: "h5" }]],
  ["heading 6", "###### Title", [{ text: "Title", role: "h6" }]],
  ["seven #: text", "####### Title", null],
  ["no space: a tag", "#tag", null],
  ["empty heading stays", "# ", null],
  [
    "extra spaces after the mark (the owner's case)",
    "#  All the Things to improve",
    [{ text: "All the Things to improve", role: "h1" }],
  ],
  ["indented #: text", " # Title", null],
  ["quote", "> wise words", [{ text: "wise words", role: "quote" }]],
  [
    "quote lines join; a bare > is a blank quote line",
    "> one\n>\n> two",
    [{ text: "one\n\ntwo", role: "quote" }],
  ],
  ["bullets: - * +", "- a\n* b\n+ c", [{ text: "• a\n• b\n• c", role: null }]],
  ["nested bullet", "  - a", [{ text: "  • a", role: null }]],
  ["numbered stays as typed", "1. one\n2. two", null],
  [
    "tasks",
    "[ ] open\n- [ ] dash\n[x] done\n1. [ ] numbered",
    [{ text: "☐ open\n☐ dash\n☑ done\n1. ☐ numbered", role: null }],
  ],
  [
    "heading splits from the text around it",
    "intro\n# Title\nbody one\n\nbody two",
    [
      { text: "intro", role: null },
      { text: "Title", role: "h1" },
      { text: "body one\n\nbody two", role: null },
    ],
  ],
  [
    "blank lines at block edges go",
    "# A\n\n- x\n",
    [
      { text: "A", role: "h1" },
      { text: "• x", role: null },
    ],
  ],
  [
    "lines inside a code fence are left alone",
    "```\n# not a heading\n- not a bullet\n```",
    null,
  ],
  [
    "a fence keeps its lines; text after it converts",
    "```\n# x\n```\n# After",
    [
      { text: "```\n# x\n```", role: null },
      { text: "After", role: "h1" },
    ],
  ],
  [
    "whole-box bold",
    "**Bold**",
    [{ text: "Bold", role: null, inline: "bold" }],
  ],
  ["whole-box code", "`code`", [{ text: "code", role: null, inline: "code" }]],
  ["bold inside a sentence stays", "some **bold** word", null],
  ["plain text", "hello world", null],
  ["empty text", "", null],
];

describe("planConversion: the case table", () => {
  it.each(CASES)("%s", (_what, source, expected) => {
    expect(
      planConversion(source, { isLabel: false, inlineStyles: true }),
    ).toEqual(expected);
  });

  it("inline styles off: a **bold** box stays as written", () => {
    expect(
      planConversion("**Bold**", { isLabel: false, inlineStyles: false }),
    ).toBeNull();
  });

  it("a label never splits: one heading converts, mixed text only changes list markers", () => {
    const label = { isLabel: true, inlineStyles: true };
    expect(planConversion("# Card", label)).toEqual([
      { text: "Card", role: "h1" },
    ]);
    expect(planConversion("# Card\n- a", label)).toEqual([
      { text: "# Card\n• a", role: null },
    ]);
    expect(planConversion("# Card\nbody", label)).toBeNull();
  });
});

type El = Record<string, any>;
const text = (t: string, extra: El = {}): El => ({
  ...newTextElement({
    text: t,
    x: 10,
    y: 20,
    fontSize: 20,
    fontFamily: 5,
  }),
  ...extra,
});

function fakeApi(elements: El[], selected: string[] = []) {
  let scene = elements;
  const updates: any[] = [];
  return {
    api: {
      getAppState: () => ({
        selectedElementIds: Object.fromEntries(selected.map((i) => [i, true])),
      }),
      getSceneElementsIncludingDeleted: () => scene,
      updateScene: (d: any) => {
        scene = d.elements;
        updates.push(d);
      },
    } as never,
    scene: () => scene,
    updates,
  };
}

const S = DEFAULT_MARKDOWN_TYPING_SETTINGS;

describe("convertExistingText: the scene", () => {
  it("restyles like typing: heading size, bold font, role, remembered body size; one undo step", async () => {
    const el = text("# Title", { strokeColor: "#c92a2a" });
    const f = fakeApi([el]);
    expect(await convertExistingText(f.api, S)).toBe(1);
    const [h] = f.scene();
    expect(h.id).toBe(el.id);
    expect(h.originalText).toBe("Title");
    expect(h.fontSize).toBe(40);
    expect(h.fontFamily).not.toBe(5); // the bold variant
    expect(h.customData).toEqual({
      role: "h1",
      roleBase: "#c92a2a",
      bodySize: 20,
    });
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0].captureUpdate).toBe("IMMEDIATELY");
  });

  it("a heading on a later line starts its own box below, in the same group and frame", async () => {
    const el = text("intro\n# Title\nbody", {
      groupIds: ["g"],
      frameId: "f",
    });
    const f = fakeApi([el]);
    await convertExistingText(f.api, S);
    const [a, b, c] = f.scene();
    expect(f.scene()).toHaveLength(3);
    expect([a.originalText, b.originalText, c.originalText]).toEqual([
      "intro",
      "Title",
      "body",
    ]);
    expect(b.customData.role).toBe("h1");
    expect(c.customData).toBeUndefined();
    expect(b.groupIds).toEqual(["g"]);
    expect(c.frameId).toBe("f");
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(c.y).toBeGreaterThan(b.y + b.height);
    expect(b.x).toBe(a.x);
  });

  it("never touches: texts with a role, code texts, locked or deleted texts, other shapes", async () => {
    const kept = [
      text("# Already", { customData: { role: "quote" } }),
      text("# Code", { fontFamily: FONT_FAMILY.Cascadia }),
      text("# Locked", { locked: true }),
      text("# Gone", { isDeleted: true }),
      { id: "r", type: "rectangle", isDeleted: false },
    ];
    const f = fakeApi(kept);
    expect(await convertExistingText(f.api, S)).toBe(0);
    expect(f.updates).toHaveLength(0);
  });

  it("with a selection, only the selected texts (and labels of selected shapes)", async () => {
    const a = text("# A");
    const b = text("# B");
    const f = fakeApi([a, b], [b.id]);
    expect(await convertExistingText(f.api, S)).toBe(1);
    expect(f.scene()[0].originalText).toBe("# A");
    expect(f.scene()[1].originalText).toBe("B");
  });

  it("whole-box code takes the code role and the code font", async () => {
    const f = fakeApi([text("`npm i`")]);
    await convertExistingText(f.api, S);
    const [c] = f.scene();
    expect(c.originalText).toBe("npm i");
    expect(c.fontFamily).toBe(FONT_FAMILY.Cascadia);
    expect(c.customData).toMatchObject({ role: "code", markFont: 5 });
  });

  it("a second run changes nothing (converted text has a role or no marks left)", async () => {
    const f = fakeApi([text("# T\n- a")]);
    await convertExistingText(f.api, S);
    expect(await convertExistingText(f.api, S)).toBe(0);
  });
});
