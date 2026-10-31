// Vaultdraw: host hook to style runs of a text element on the on-screen
// canvas (e.g. `[[links]]`: colour + underline). Display only: the scene data
// is untouched and exports never call it (they draw with `isExporting`).
//
// Cost model: the styler is called only when an element's bitmap is
// (re)rasterised, never per frame. Per frame the cache check compares two
// integers. `invalidateTextRunStyles` re-rasterises only text whose last
// raster was styled; `setTextRunStyler` (install / remove) re-rasterises
// every text element once.

import type { ExcalidrawTextElement } from "./types";

export type TextRun = Readonly<{
  /** UTF-16 [start, end) into `element.text`. */
  start: number;
  end: number;
  /** Final on-screen colour (no dark mode filter is applied to it). */
  color?: string;
  underline?: "solid" | "dashed";
  /** CSS font for the run (e.g. a Markdown `**bold**` word); default: the element's. */
  font?: string;
  /** Not drawn and takes no width (e.g. the `**` marks around a bold word). */
  hidden?: boolean;
}>;

export type TextRunStyler = (
  element: ExcalidrawTextElement,
  isDarkMode: boolean,
) => readonly TextRun[] | null;

/** Installed stylers by slot (links, Markdown marks…); their runs are merged. */
const stylers = new Map<string, TextRunStyler>();
let stylerEpoch = 0;
let runsVersion = 0;

/** Installs (or with null removes) the styler of `slot`. */
export const setTextRunStyler = (
  next: TextRunStyler | null,
  slot = "default",
) => {
  if (next) {
    stylers.set(slot, next);
  } else {
    stylers.delete(slot);
  }
  stylerEpoch++;
  runsVersion++;
};

/** The styler's answers changed (colours, link targets): re-style on next render. */
export const invalidateTextRunStyles = () => {
  runsVersion++;
};

export const getTextRunStylerEpoch = () => stylerEpoch;
export const getTextRunsVersion = () => runsVersion;

/** Merged runs of several stylers, kept by identity so layouts are reused on zoom. */
const mergedCache = new WeakMap<
  readonly TextRun[],
  { parts: (readonly TextRun[])[]; merged: readonly TextRun[] }
>();

const mergeParts = (parts: (readonly TextRun[])[]): readonly TextRun[] => {
  const hit = mergedCache.get(parts[0]);
  if (
    hit &&
    hit.parts.length === parts.length &&
    hit.parts.every((p, i) => p === parts[i])
  ) {
    return hit.merged;
  }
  const merged = parts.flat();
  mergedCache.set(parts[0], { parts, merged });
  return merged;
};

/** Runs for an on-screen raster, or null (no styler, nothing to style, RTL, `\r`). */
export const getTextRuns = (
  element: ExcalidrawTextElement,
  isDarkMode: boolean,
): readonly TextRun[] | null => {
  if (stylers.size === 0 || element.text.includes("\r")) {
    return null;
  }
  let parts: (readonly TextRun[])[] | null = null;
  for (const styler of stylers.values()) {
    const runs = styler(element, isDarkMode);
    if (runs && runs.length > 0) {
      (parts ??= []).push(runs);
    }
  }
  return !parts ? null : parts.length === 1 ? parts[0] : mergeParts(parts);
};

type Segment = {
  text: string;
  /** [from, to) offsets in the line. */
  from: number;
  to: number;
  /** Offset from the line's left edge. */
  x: number;
  /** Segment end (and underline end), offset from the line's left edge. */
  x2: number;
  run: TextRun | null;
  /** Set when the segment is drawn in its own font (fonts or hidden marks on the line). */
  font?: string;
};

export type LineLayout = {
  width: number;
  segments: Segment[];
  /**
   * Horizontal squeeze (<= 1) when the styled line would be wider than the
   * plain one the element was measured with, so it never overflows its box.
   */
  squeeze: number;
};

/**
 * Measured segments of a styled text, reused across re-rasters of the same
 * element bitmap (zoom changes) while the runs (by identity) and font are the
 * same. Widths are in scene units, so they don't depend on the zoom. It lives
 * on the bitmap cache entry, which font loads and element changes delete.
 */
export type TextRunLayout = {
  runs: readonly TextRun[];
  font: string;
  /** By line start offset; null = no run on that line. */
  lines: Map<number, LineLayout | null>;
};

export const textRunLayoutFor = (
  prev: TextRunLayout | null | undefined,
  runs: readonly TextRun[],
  font: string,
): TextRunLayout =>
  prev && prev.runs === runs && prev.font === font
    ? prev
    : { runs, font, lines: new Map() };

export type MeasureTextFn = (text: string, font: string) => number;

type LocalRun = { start: number; end: number; run: TextRun };

/** Colour/underline-only runs: the plain line's prefix widths, the first run wins on overlap. */
const layoutColoured = (
  measure: MeasureTextFn,
  line: string,
  baseFont: string,
  local: LocalRun[],
): LineLayout => {
  // Prefix widths of the whole line, each measured once, so segment
  // positions match measureText-based hit testing.
  const widths = new Map<number, number>();
  const width = (n: number) => {
    if (n <= 0) {
      return 0;
    }
    let w = widths.get(n);
    if (w === undefined) {
      w = measure(line.slice(0, n), baseFont);
      widths.set(n, w);
    }
    return w;
  };
  const segments: Segment[] = [];
  let at = 0;
  const push = (from: number, to: number, run: TextRun | null) =>
    segments.push({
      text: line.slice(from, to),
      from,
      to,
      x: width(from),
      x2: width(to),
      run,
    });
  for (const { start, end, run } of local) {
    if (start < at) {
      continue; // overlapping runs: the first one wins
    }
    if (start > at) {
      push(at, start, null);
    }
    push(start, end, run);
    at = end;
  }
  if (line.length > at) {
    push(at, line.length, null);
  }
  return { width: width(line.length), segments, squeeze: 1 };
};

/**
 * Lines with a font change or hidden marks: split at every run edge, merge the
 * runs covering each piece (colour and underline of the first that has one,
 * the font of the last that has one), measure each piece in its font.
 */
const layoutFonted = (
  measure: MeasureTextFn,
  line: string,
  baseFont: string,
  local: LocalRun[],
): LineLayout => {
  const edges = new Set<number>([0, line.length]);
  for (const { start, end } of local) {
    edges.add(start);
    edges.add(end);
  }
  const cuts = [...edges].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let x = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    let hidden = false;
    let font: string | undefined;
    let color: string | undefined;
    let underline: TextRun["underline"];
    for (const { start, end, run } of local) {
      if (start <= from && end >= to) {
        hidden ||= !!run.hidden;
        font = run.font ?? font;
        color ??= run.color;
        underline ??= run.underline;
      }
    }
    if (hidden) {
      continue;
    }
    const text = line.slice(from, to);
    const segFont = font ?? baseFont;
    const w = measure(text, segFont);
    const run: TextRun | null =
      color || underline || font
        ? { start: from, end: to, color, underline, font }
        : null;
    segments.push({ text, from, to, x, x2: x + w, run, font: segFont });
    x += w;
  }
  const plain = measure(line, baseFont);
  const squeeze = x > plain && x > 0 ? plain / x : 1;
  if (squeeze < 1) {
    for (const s of segments) {
      s.x *= squeeze;
      s.x2 *= squeeze;
    }
  }
  return { width: x * squeeze, segments, squeeze };
};

/**
 * The drawn layout of one line of an element's text under `runs` (null when
 * no run touches it). `lineStart` is the line's offset in the element text.
 * Shared by drawing and by hit tests that map a point to a text offset.
 */
export const layoutTextLine = (
  measure: MeasureTextFn,
  line: string,
  lineStart: number,
  runs: readonly TextRun[],
  baseFont: string,
): LineLayout | null => {
  const lineEnd = lineStart + line.length;
  const local: LocalRun[] = [];
  let fonted = false;
  for (const run of runs) {
    const start = Math.max(run.start, lineStart) - lineStart;
    const end = Math.min(run.end, lineEnd) - lineStart;
    if (start < end) {
      local.push({ start, end, run });
      fonted ||= !!run.font || !!run.hidden;
    }
  }
  if (local.length === 0) {
    return null;
  }
  local.sort((a, b) => a.start - b.start);
  return fonted
    ? layoutFonted(measure, line, baseFont, local)
    : layoutColoured(measure, line, baseFont, local);
};

/**
 * Where offset `n` of the line is drawn, from the line's left edge. A hidden
 * mark collapses to the edge of the text next to it.
 */
export const offsetX = (layout: LineLayout, n: number): number => {
  let x = 0;
  for (const s of layout.segments) {
    if (n <= s.from) {
      return s.x;
    }
    if (n <= s.to) {
      if (n === s.to) {
        return s.x2;
      }
      // inside a segment: proportional (exact for the colour-only path's
      // prefix measures at the edges, close enough within one font)
      return s.x + ((s.x2 - s.x) * (n - s.from)) / (s.to - s.from);
    }
    x = s.x2;
  }
  return x;
};

const contextMeasure =
  (context: CanvasRenderingContext2D): MeasureTextFn =>
  (text, font) => {
    if (context.font !== font) {
      context.font = font;
    }
    return context.measureText(text).width;
  };

/**
 * `fillText(line, x, y)` with `runs` applied. `lineStart` is the line's offset
 * in the element text; `layout` (optional) caches the measured segments.
 * Restores the context's fill and alignment.
 */
export const fillTextLineWithRuns = (
  context: CanvasRenderingContext2D,
  line: string,
  lineStart: number,
  x: number,
  y: number,
  fontSize: number,
  runs: readonly TextRun[],
  layout?: TextRunLayout,
) => {
  const baseFont = context.font;
  let lineLayout = layout?.lines.get(lineStart);
  if (lineLayout === undefined) {
    lineLayout = layoutTextLine(
      contextMeasure(context),
      line,
      lineStart,
      runs,
      baseFont,
    );
    if (context.font !== baseFont) {
      context.font = baseFont;
    }
    layout?.lines.set(lineStart, lineLayout);
  }
  if (!lineLayout) {
    context.fillText(line, x, y);
    return;
  }
  const align = context.textAlign;
  const left =
    align === "center"
      ? x - lineLayout.width / 2
      : align === "right"
      ? x - lineLayout.width
      : x;
  const baseFill = context.fillStyle;
  const squeeze = lineLayout.squeeze;
  context.textAlign = "left";
  for (const { text, x: sx, x2: rx2, run, font } of lineLayout.segments) {
    context.fillStyle = run?.color ?? baseFill;
    if (font && context.font !== font) {
      context.font = font;
    }
    if (squeeze < 1) {
      context.fillText(text, left + sx, y, rx2 - sx);
    } else {
      context.fillText(text, left + sx, y);
    }
    if (run?.underline) {
      // fillRect, not a stroked path: no save/restore or dash state per run
      const t = Math.max(0.75, fontSize * 0.06);
      const uy = y + fontSize * 0.12 - t / 2;
      const x1 = left + sx;
      const x2 = left + rx2;
      if (run.underline === "dashed") {
        const on = fontSize * 0.25;
        const step = on + fontSize * 0.18;
        for (let dx = x1; dx < x2; dx += step) {
          context.fillRect(dx, uy, Math.min(on, x2 - dx), t);
        }
      } else {
        context.fillRect(x1, uy, x2 - x1, t);
      }
    }
  }
  if (context.font !== baseFont) {
    context.font = baseFont;
  }
  context.fillStyle = baseFill;
  context.textAlign = align;
};
