/**
 * Scene point -> text element -> line -> `[[span]]`, using Excalidraw's own
 * measuring. Handles textAlign, wrapped (bound / fixed-width) text whose link
 * is split across lines, rotation and zoom (via `clientToScene`). Cost: one
 * `includes("[[")` per element, then a binary search of the clicked line
 * (about log2(line length) measurements).
 */
import { getFontString, viewportCoordsToSceneCoords } from "@excalidraw/common";
import {
  getLineHeightInPx,
  getLineWidth,
  getTextRuns,
  layoutTextLine,
  offsetX,
} from "@excalidraw/element";

import { findLinks } from "../../links/grammar";

import type { LinkSpan } from "../../links/grammar";

export type Point = { x: number; y: number };

/** The slice of a text element the hit test reads. */
export type TextLike = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  isDeleted?: boolean;
  text: string;
  fontSize: number;
  fontFamily: number;
  lineHeight: number;
  textAlign: string;
  containerId?: string | null;
  autoResize?: boolean;
};

export type MeasureFn = (text: string, font: string) => number;

const defaultMeasure: MeasureFn = (text, font) =>
  getLineWidth(text, font as never);

/** One line's part of a link, in unrotated scene coordinates. */
export type LinkFragment = {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
};

export type TextLinkHit = {
  element: TextLike;
  span: LinkSpan;
  /** Spans are offsets into the (flattened for wrapped text) element text. */
  fragments: LinkFragment[];
};

const ALIGN: Record<string, number> = { left: 0, center: 0.5, right: 1 };

export const isWrapped = (el: TextLike) =>
  !!el.containerId || el.autoResize === false;

/** Rotate `p` about the element's centre by `-angle`. */
function unrotate(el: TextLike, p: Point): Point {
  if (!el.angle) {
    return p;
  }
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(-el.angle);
  const sin = Math.sin(-el.angle);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** `[start, end)` of every line, as offsets into `text`. */
function lineRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (;;) {
    const nl = text.indexOf("\n", at);
    if (nl < 0) {
      out.push([at, text.length]);
      return out;
    }
    out.push([at, nl]);
    at = nl + 1;
  }
}

/** Links of `text`; wrapped text is flattened (`\n` -> space) so split links resolve. */
export function linksOf(el: TextLike): LinkSpan[] {
  if (!el.text.includes("[[")) {
    return [];
  }
  return findLinks(isWrapped(el) ? el.text.replace(/\n/g, " ") : el.text);
}

/** Where a line's offsets are drawn: plain measuring, or the styled layout when marks are hidden or fonts change. */
type LineGeom = { width: number; xOf: (n: number) => number };

/** Runs that move text (fonts, hidden Markdown marks), or null. */
function movingRuns(el: TextLike) {
  if (!/[*_`\\]/.test(el.text)) {
    return null;
  }
  const runs = getTextRuns(el as never, false);
  return runs?.some((r) => r.font || r.hidden) ? runs : null;
}

function lineGeom(
  el: TextLike,
  line: string,
  lineStart: number,
  font: string,
  measure: MeasureFn,
  runs: ReturnType<typeof movingRuns>,
): LineGeom {
  const layout = runs
    ? layoutTextLine(measure, line, lineStart, runs, font)
    : null;
  if (layout) {
    return { width: layout.width, xOf: (n) => offsetX(layout, n) };
  }
  return {
    width: measure(line, font),
    xOf: (n) => measure(line.slice(0, n), font),
  };
}

function lineStartX(el: TextLike, geom: LineGeom): number {
  const k = ALIGN[el.textAlign] ?? 0;
  return el.x + (el.width - geom.width) * k;
}

function fragmentsOf(
  el: TextLike,
  span: LinkSpan,
  ranges: [number, number][],
  lineH: number,
  font: string,
  measure: MeasureFn,
  runs: ReturnType<typeof movingRuns>,
): LinkFragment[] {
  const out: LinkFragment[] = [];
  ranges.forEach(([s, e], i) => {
    const from = Math.max(span.start, s);
    const to = Math.min(span.end, e);
    if (from >= to) {
      return;
    }
    const geom = lineGeom(el, el.text.slice(s, e), s, font, measure, runs);
    const x0 = lineStartX(el, geom);
    out.push({
      x1: x0 + geom.xOf(from - s),
      x2: x0 + geom.xOf(to - s),
      top: el.y + i * lineH,
      bottom: el.y + (i + 1) * lineH,
    });
  });
  return out;
}

/** The text link under a scene point, topmost element first. */
export function hitTestTextLink(
  elements: readonly TextLike[],
  scenePoint: Point,
  measure: MeasureFn = defaultMeasure,
): TextLinkHit | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type !== "text" || el.isDeleted || !el.text.includes("[[")) {
      continue;
    }
    const p = unrotate(el, scenePoint);
    if (
      p.x < el.x ||
      p.x > el.x + el.width ||
      p.y < el.y ||
      p.y > el.y + el.height
    ) {
      continue;
    }
    const lineH = getLineHeightInPx(el.fontSize, el.lineHeight as never);
    const ranges = lineRanges(el.text);
    const lineIdx = Math.min(
      ranges.length - 1,
      Math.max(0, Math.floor((p.y - el.y) / lineH)),
    );
    const [ls, le] = ranges[lineIdx];
    const line = el.text.slice(ls, le);
    const font = getFontString(el as never);
    const runs = movingRuns(el);
    const geom = lineGeom(el, line, ls, font, measure, runs);
    const localX = p.x - lineStartX(el, geom);
    if (localX < 0 || localX > geom.width) {
      continue;
    }
    // First prefix length whose width passes the click, minus one.
    let lo = 0;
    let hi = line.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (geom.xOf(mid) <= localX) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const idx = ls + lo;
    const span = linksOf(el).find((s) => idx >= s.start && idx < s.end);
    if (span && idx < le) {
      return {
        element: el,
        span,
        fragments: fragmentsOf(el, span, ranges, lineH, font, measure, runs),
      };
    }
  }
  return null;
}

/** Every link of a text element with its fragments (hints, overlays). */
export function textLinksWithGeometry(
  el: TextLike,
  measure: MeasureFn = defaultMeasure,
): TextLinkHit[] {
  const spans = linksOf(el);
  if (spans.length === 0) {
    return [];
  }
  const lineH = getLineHeightInPx(el.fontSize, el.lineHeight as never);
  const ranges = lineRanges(el.text);
  const font = getFontString(el as never);
  const runs = movingRuns(el);
  return spans.map((span) => ({
    element: el,
    span,
    fragments: fragmentsOf(el, span, ranges, lineH, font, measure, runs),
  }));
}

export type ViewportState = {
  zoom: { value: number };
  offsetLeft: number;
  offsetTop: number;
  scrollX: number;
  scrollY: number;
};

/** Pointer client coordinates -> scene coordinates (zoom and scroll aware). */
export const clientToScene = (
  client: { clientX: number; clientY: number },
  state: ViewportState,
): Point =>
  viewportCoordsToSceneCoords(client, state as never) as unknown as Point;

/** Topmost element with a `link` whose (rotated) bounds contain the point. */
export function shapeLinkAt<T extends TextLike & { link?: string | null }>(
  elements: readonly T[],
  scenePoint: Point,
): T | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || !el.link) {
      continue;
    }
    const p = unrotate(el, scenePoint);
    if (
      p.x >= el.x &&
      p.x <= el.x + el.width &&
      p.y >= el.y &&
      p.y <= el.y + el.height
    ) {
      return el;
    }
  }
  return null;
}
