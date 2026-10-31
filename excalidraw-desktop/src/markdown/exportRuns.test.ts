// Markdown inline step 2b: exports draw text the way the canvas does.
// SVG: real tspans (weight, style, family), marks absent. Off (no export
// scope, or the styler not installed): the output is byte-identical to before.
import { afterEach, describe, expect, it } from "vitest";

import { FONT_FAMILY } from "@excalidraw/common";
import {
  beginExportTextRuns,
  setTextRunStyler,
  splitLineByRuns,
} from "@excalidraw/element";
import { exportToSvg } from "@excalidraw/excalidraw/scene/export";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { INLINE_SLOT, inlineRunsOf, installInlineStyler } from "./inlineStyler";

const svgOf = async (text: string, over: Record<string, unknown> = {}) =>
  (
    await exportToSvg(
      [
        API.createElement({
          type: "text",
          id: "t1",
          text,
          originalText: text,
          fontFamily: FONT_FAMILY.Excalifont,
          fontSize: 20,
          ...over,
        } as any),
      ],
      { exportBackground: false, viewBackgroundColor: "#ffffff" },
      null,
      { skipInliningFonts: true },
    )
  ).outerHTML;

const textLines = (svg: string) => [
  ...new DOMParser()
    .parseFromString(svg, "image/svg+xml")
    .querySelectorAll("text"),
];

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
  setTextRunStyler(null, INLINE_SLOT);
});

describe("splitLineByRuns", () => {
  it("drops hidden marks and merges fonts per piece; null off the line", () => {
    const runs = [
      { start: 2, end: 4, hidden: true },
      { start: 4, end: 8, font: "bold 20px X" },
      { start: 8, end: 10, hidden: true },
    ];
    expect(splitLineByRuns("a **bold** z", 0, runs)).toEqual([
      { text: "a ", color: undefined, underline: undefined, font: undefined },
      {
        text: "bold",
        color: undefined,
        underline: undefined,
        font: "bold 20px X",
      },
      { text: " z", color: undefined, underline: undefined, font: undefined },
    ]);
    // a later line: offsets are the element's, not the line's
    expect(splitLineByRuns("next", 20, runs)).toBeNull();
    expect(splitLineByRuns("x **b** y", 0, [])).toBeNull();
  });
});

describe("SVG export with Markdown words", () => {
  it("is exactly the old output without an export scope", async () => {
    off = installInlineStyler();
    const styledOff = await svgOf("a **b** `c` *d*");
    off();
    off = null;
    const plain = await svgOf("a **b** `c` *d*");
    expect(styledOff).toBe(plain);
    expect(plain).toContain("a **b** `c` *d*");
    expect(plain).not.toContain("tspan");
  });

  it("draws tspans with real font attributes and no marks", async () => {
    off = installInlineStyler();
    const end = beginExportTextRuns();
    let svg: string;
    try {
      svg = await svgOf("a **b** `c` *d*\nplain line");
    } finally {
      end();
    }
    const [first, second] = textLines(svg);
    expect(first.textContent).toBe("a b c d");
    const spans = [...first.querySelectorAll("tspan")];
    const bold = spans.find((s) => s.textContent === "b")!;
    expect(bold.getAttribute("font-weight")).toBe("bold");
    expect(bold.getAttribute("font-style")).toBe("normal");
    const code = spans.find((s) => s.textContent === "c")!;
    expect(code.getAttribute("font-family")).toContain("Cascadia");
    const italic = spans.find((s) => s.textContent === "d")!;
    expect(italic.getAttribute("font-style")).toBe("italic");
    // the second line has nothing styled: a plain text node, as before
    expect(second.querySelector("tspan")).toBeNull();
    expect(second.textContent).toBe("plain line");
    expect(svg).not.toContain("**");
  });

  it("an unstyled drawing exports the same bytes inside the scope", async () => {
    off = installInlineStyler();
    const before = await svgOf("nothing styled here");
    const end = beginExportTextRuns();
    let inside: string;
    try {
      inside = await svgOf("nothing styled here");
    } finally {
      end();
    }
    expect(inside).toBe(before);
  });

  it("a nested scope ends only when every holder is done", () => {
    const a = beginExportTextRuns();
    const b = beginExportTextRuns();
    a();
    a(); // twice is harmless
    off = installInlineStyler();
    const el: any = API.createElement({ type: "text", text: "**b**" } as any);
    expect(inlineRunsOf(el).length).toBeGreaterThan(0);
    b();
  });
});
