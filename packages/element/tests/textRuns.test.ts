import rough from "roughjs/bin/rough";

import { arrayToMap, THEME } from "@excalidraw/common";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import {
  clearElementCanvasCache,
  elementWithCanvasCache,
  renderElement,
} from "../src/renderElement";
import {
  fillTextLineWithRuns,
  getTextRuns,
  invalidateTextRunStyles,
  layoutTextLine,
  offsetX,
  setTextRunStyler,
} from "../src/textRuns";

import type { TextRun, TextRunStyler } from "../src/textRuns";

/** A context that records fillText / fillRect calls; 10 px per character. */
const recordingContext = () => {
  const calls: { text: string; x: number; fill: string }[] = [];
  const rects: { x: number; w: number; fill: string }[] = [];
  const ctx: any = {
    textAlign: "left",
    fillStyle: "#000",
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (text: string, x: number) =>
      calls.push({ text, x, fill: ctx.fillStyle }),
    fillRect: (x: number, _y: number, w: number) =>
      rects.push({ x, w, fill: ctx.fillStyle }),
  };
  return { ctx: ctx as CanvasRenderingContext2D, calls, rects };
};

describe("fillTextLineWithRuns", () => {
  const runs: TextRun[] = [
    { start: 3, end: 5, color: "dim" },
    { start: 5, end: 8, color: "link", underline: "solid" },
    { start: 8, end: 10, color: "dim" },
  ];

  it("splits a line into plain and styled segments at prefix widths", () => {
    const { ctx, calls, rects } = recordingContext();
    fillTextLineWithRuns(ctx, "go [[Map]] now", 0, 0, 20, 20, runs);
    expect(calls).toEqual([
      { text: "go ", x: 0, fill: "#000" },
      { text: "[[", x: 30, fill: "dim" },
      { text: "Map", x: 50, fill: "link" },
      { text: "]]", x: 80, fill: "dim" },
      { text: " now", x: 100, fill: "#000" },
    ]);
    // one solid underline under "Map" only
    expect(rects).toEqual([{ x: 50, w: 30, fill: "link" }]);
    expect(ctx.fillStyle).toBe("#000");
    expect(ctx.textAlign).toBe("left");
  });

  it("honours centre alignment and the line's offset in the text", () => {
    const { ctx, calls, rects } = recordingContext();
    ctx.textAlign = "center";
    // line "ab [[x]]" starts at offset 10 of the element text
    fillTextLineWithRuns(ctx, "ab [[x]]", 10, 100, 0, 20, [
      { start: 13, end: 18, color: "link", underline: "dashed" },
    ]);
    expect(calls.map((c) => [c.text, c.x])).toEqual([
      ["ab ", 60],
      ["[[x]]", 90],
    ]);
    // dashed: 5 px on, 3.6 px off over 50 px
    expect(rects.length).toBe(6);
    expect(rects[0]).toMatchObject({ x: 90, w: 5 });
    expect(ctx.textAlign).toBe("center");
  });

  it("draws the line once when no run touches it", () => {
    const { ctx, calls } = recordingContext();
    fillTextLineWithRuns(ctx, "plain", 20, 5, 0, 20, runs);
    expect(calls).toEqual([{ text: "plain", x: 5, fill: "#000" }]);
  });
});

describe("text run styler and the element bitmap cache", () => {
  const rc = rough.canvas(document.createElement("canvas"));
  const ctx = document.createElement("canvas").getContext("2d")!;
  const appState: any = {
    zoom: { value: 1 },
    scrollX: 0,
    scrollY: 0,
    theme: THEME.LIGHT,
    shouldCacheIgnoreZoom: false,
    frameRendering: { enabled: true, clip: true, name: true, outline: true },
    selectedElementIds: {},
  };
  const config = (isExporting = false): any => ({
    canvasBackgroundColor: "#fff",
    imageCache: new Map(),
    renderGrid: false,
    isExporting,
    embedsValidationStatus: new Map(),
    elementsPendingErasure: new Set(),
    pendingFlowchartNodes: null,
    theme: THEME.LIGHT,
  });
  const draw = (el: any, isExporting = false) => {
    const map = arrayToMap([el]) as any;
    renderElement(el, map, map, rc, ctx, config(isExporting), appState);
  };

  afterEach(() => {
    setTextRunStyler(null);
    clearElementCanvasCache();
  });

  it("styles once per raster, re-styles only styled text on invalidate", () => {
    const styler = vi.fn<TextRunStyler>((el) =>
      el.text.includes("[[") ? [{ start: 0, end: 7, color: "#00f" }] : null,
    );
    setTextRunStyler(styler);
    const linked = API.createElement({ type: "text", text: "[[Map]]" });
    const plain = API.createElement({ type: "text", text: "plain" });
    draw(linked);
    draw(plain);
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(2);

    invalidateTextRunStyles();
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(3);
    expect(styler.mock.calls[2][0]).toBe(linked);

    // install / remove re-rasterises every text once
    setTextRunStyler(styler);
    draw(linked);
    draw(plain);
    expect(styler).toHaveBeenCalledTimes(5);
  });

  it("reuses the measured layout when only the zoom changes", () => {
    const runs = [{ start: 0, end: 7, color: "#00f", underline: "solid" }];
    setTextRunStyler(() => runs as TextRun[]);
    const el = API.createElement({ type: "text", text: "[[Map]]" });
    draw(el);
    const first = elementWithCanvasCache.get(el)!.textRunLayout;
    expect(first?.lines.size).toBe(1);
    appState.zoom = { value: 2 };
    draw(el);
    appState.zoom = { value: 1 };
    const second = elementWithCanvasCache.get(el)!;
    expect(second.zoomValue).toBe(2);
    expect(second.textRunLayout).toBe(first);
    // new runs (e.g. the target got created) -> fresh layout
    setTextRunStyler(() => [...runs] as TextRun[]);
    draw(el);
    expect(elementWithCanvasCache.get(el)!.textRunLayout).not.toBe(first);
  });

  it("never styles exports", () => {
    const styler = vi.fn<TextRunStyler>(() => [{ start: 0, end: 2 }]);
    setTextRunStyler(styler);
    draw(API.createElement({ type: "text", text: "[[a]]" }), true);
    expect(styler).not.toHaveBeenCalled();
  });

  it("returns null without a styler, for empty runs and for \\r text", () => {
    const el = API.createElement({ type: "text", text: "[[a]]" }) as any;
    expect(getTextRuns(el, false)).toBeNull();
    setTextRunStyler(() => []);
    expect(getTextRuns(el, false)).toBeNull();
    setTextRunStyler(() => [{ start: 0, end: 1 }]);
    expect(getTextRuns(el, false)).toHaveLength(1);
    expect(getTextRuns({ ...el, text: "[[a]]\r\nb" }, false)).toBeNull();
  });
});

describe("runs with fonts and hidden marks (Markdown inline)", () => {
  // 10 px per character, 20 in the "wide" font
  const measure = (t: string, f: string) => t.length * (f === "wide" ? 20 : 10);

  it("hides marks, measures each piece in its font, keeps the line in its box", () => {
    // "a **bb** c": marks at 2-4 and 6-8, bold "bb" at 4-6
    const layout = layoutTextLine(
      measure,
      "a **bb** c",
      0,
      [
        { start: 2, end: 4, hidden: true },
        { start: 4, end: 6, font: "wide" },
        { start: 6, end: 8, hidden: true },
      ],
      "base",
    )!;
    expect(layout.segments.map((s) => s.text)).toEqual(["a ", "bb", " c"]);
    expect(layout.segments.map((s) => [s.x, s.x2])).toEqual([
      [0, 20],
      [20, 60],
      [60, 80],
    ]);
    expect(layout.squeeze).toBe(1);
    expect(layout.width).toBe(80);
    // a hidden mark collapses onto the text next to it
    expect(offsetX(layout, 3)).toBe(20);
    expect(offsetX(layout, 8)).toBe(60);
    expect(offsetX(layout, 10)).toBe(80);
  });

  it("squeezes a styled line wider than the plain one", () => {
    const layout = layoutTextLine(
      measure,
      "`codecode`",
      0,
      [
        { start: 0, end: 1, hidden: true },
        { start: 1, end: 9, font: "wide" },
        { start: 9, end: 10, hidden: true },
      ],
      "base",
    )!;
    // drawn 160 > plain 100
    expect(layout.squeeze).toBeCloseTo(100 / 160);
    expect(layout.width).toBeCloseTo(100);
  });

  it("merges a link's colour with a bold font on the same words", () => {
    const layout = layoutTextLine(
      measure,
      "**[[a]]**",
      0,
      [
        { start: 2, end: 7, color: "link", underline: "solid" },
        { start: 0, end: 2, hidden: true },
        { start: 2, end: 7, font: "wide" },
        { start: 7, end: 9, hidden: true },
      ],
      "base",
    )!;
    expect(layout.segments).toHaveLength(1);
    expect(layout.segments[0].run).toMatchObject({
      color: "link",
      underline: "solid",
      font: "wide",
    });
  });

  it("draws each piece in its font and restores the context font", () => {
    const fonts: string[] = [];
    const ctx: any = {
      textAlign: "left",
      fillStyle: "#000",
      font: "base",
      measureText: (t: string) => ({ width: measure(t, ctx.font) }),
      fillText: () => fonts.push(ctx.font),
      fillRect: () => {},
    };
    fillTextLineWithRuns(ctx, "a *b* c", 0, 0, 0, 20, [
      { start: 2, end: 3, hidden: true },
      { start: 3, end: 4, font: "wide" },
      { start: 4, end: 5, hidden: true },
    ]);
    expect(fonts).toEqual(["base", "wide", "base"]);
    expect(ctx.font).toBe("base");
  });

  it("merges the runs of several stylers and keeps the merge by identity", () => {
    const links = [{ start: 0, end: 1, color: "#00f" }];
    const marks = [{ start: 1, end: 2, hidden: true }];
    setTextRunStyler(() => links);
    setTextRunStyler(() => marks, "markdown");
    const el = API.createElement({ type: "text", text: "ab" }) as any;
    const first = getTextRuns(el, false)!;
    expect(first).toEqual([...links, ...marks]);
    expect(getTextRuns(el, false)).toBe(first);
    setTextRunStyler(null, "markdown");
    expect(getTextRuns(el, false)).toBe(links);
    setTextRunStyler(null);
    expect(getTextRuns(el, false)).toBeNull();
  });
});
