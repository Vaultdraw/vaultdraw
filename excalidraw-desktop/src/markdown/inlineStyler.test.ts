import { afterEach, describe, expect, it } from "vitest";

import { FONT_FAMILY, getFontString } from "@excalidraw/common";
import { getTextRuns, setTextRunStyler } from "@excalidraw/element";

import { hitTestTextLink } from "../editor/links/textLinkHitTest";

import {
  INLINE_SLOT,
  inlineFontOf,
  inlineRunsOf,
  inlineStyler,
  installInlineStyler,
} from "./inlineStyler";

const el = (text: string, over: Record<string, unknown> = {}): any => ({
  id: "t",
  type: "text",
  x: 100,
  y: 50,
  width: text.length * 10,
  height: 25,
  angle: 0,
  fontSize: 20,
  fontFamily: FONT_FAMILY.Excalifont,
  lineHeight: 1.25,
  textAlign: "left",
  text,
  originalText: text,
  version: 1,
  ...over,
});

afterEach(() => {
  setTextRunStyler(null, INLINE_SLOT);
  setTextRunStyler(null);
});

describe("inline styler", () => {
  it("bold, italic and code words get their face; marks are hidden", () => {
    const e = el("a **b** *c* `d`");
    const runs = inlineRunsOf(e);
    const fonts = runs.filter((r) => r.font).map((r) => [r.start, r.font]);
    expect(fonts).toEqual([
      [4, inlineFontOf(e, true, false, false)],
      [9, inlineFontOf(e, false, true, false)],
      [13, getFontString({ fontFamily: FONT_FAMILY.Cascadia, fontSize: 20 })],
    ]);
    const hidden = runs.filter((r) => r.hidden).map((r) => [r.start, r.end]);
    expect(hidden).toHaveLength(6);
  });

  it("bold uses the family's bold face, or the browser's bold without one", () => {
    expect(inlineFontOf(el("x"), true, false, false)).toMatch(/^bold /);
    const nobold = el("x", { fontFamily: FONT_FAMILY.Cascadia });
    expect(inlineFontOf(nobold, true, true, false)).toMatch(/^italic bold /);
  });

  it("nested bold and italic draw bold italic", () => {
    const runs = inlineRunsOf(el("***x***"));
    expect(runs.find((r) => r.font && r.start === 3)?.font).toMatch(
      /^italic bold /,
    );
  });

  it("text without marks costs one test and no runs", () => {
    expect(inlineStyler(el("plain words"), false)).toBeNull();
  });

  it("caches runs by element version", () => {
    const e = el("**a**");
    const first = inlineStyler(e, false);
    expect(inlineStyler(e, false)).toBe(first);
    e.version = 2;
    expect(inlineStyler(e, false)).not.toBe(first);
  });

  it("is installed while any editor wants it", () => {
    const e = el("**a**");
    const offA = installInlineStyler();
    const offB = installInlineStyler();
    offA();
    offA(); // twice is a no-op
    expect(getTextRuns(e, false)).not.toBeNull();
    offB();
    expect(getTextRuns(e, false)).toBeNull();
  });

  it("a link after a bold word is clicked where it is drawn", () => {
    installInlineStyler()();
    const off = installInlineStyler();
    // "**ab** [[N]]": drawn "ab [[N]]"; 10 px per char in the hit test's measure
    const e = el("**ab** [[N]]");
    const measure = (t: string) => t.length * 10;
    // drawn: "ab" 0-20, " " 20-30, link 30-80 -> scene x 130..180
    expect(hitTestTextLink([e], { x: 135, y: 60 }, measure)?.span.target).toBe(
      "N",
    );
    expect(hitTestTextLink([e], { x: 115, y: 60 }, measure)).toBeNull();
    off();
    // without the styler the raw marks take room again: link at 170..220
    expect(hitTestTextLink([e], { x: 135, y: 60 }, measure)).toBeNull();
  });
});
