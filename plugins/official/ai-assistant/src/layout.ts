/**
 * Lays out what the assistant adds: headings, text, notes and diagrams are stacked top to bottom in
 * one column, each measured, so nothing overlaps; the model never guesses pixels. The column goes
 * where the replaced elements were when it fits there, else below everything on the canvas.
 */
import type { NewElement, SceneElement, SceneOp } from "@vaultdraw/api";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One piece of content to place: a text (heading, paragraph, boxed note) or a converted diagram. */
export type Item =
  | { kind: "text"; text: string; fontSize: number; boxed?: boolean }
  | { kind: "diagram"; ops: SceneOp[]; width: number; height: number };

/** About this many pixels a character of the hand-drawn font takes, per pixel of font size. */
const CHAR = 0.6;
const LINE = 1.25;
/** The column's width: about 60 characters of 20 px text. */
export const COLUMN = 720;
const GAP = 28;
const GAP_BEFORE_HEADING = 56;
const PAD = 20;
/** Space kept between the new column and anything already on the canvas. */
export const MARGIN = 80;

/** Fonts the app writes: never below 16 px (readable when zoomed out). */
export const FONT = { h1: 36, h2: 28, h3: 24, text: 20, note: 18, min: 16 };

/** Pastel fills with a meaning (as the Excalidraw MCP cheat sheet): used for notes and diagrams. */
export const PALETTE = {
  blue: "#a5d8ff",
  green: "#b2f2bb",
  amber: "#ffd8a8",
  purple: "#d0bfff",
  red: "#ffc9c9",
  note: "#fff3bf",
};

/** Wraps text at `chars` characters a line, keeping a bullet's text under its first word. */
export function wrap(text: string, chars: number): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const indent = /^(\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s+)/.exec(raw)?.[1] ?? "";
    const hang = " ".repeat(indent.length);
    const parts = wrapWords(raw.slice(indent.length), chars - indent.length);
    if (parts.length === 0) {
      out.push(indent.trimEnd());
    }
    parts.forEach((p, i) => out.push(`${i === 0 ? indent : hang}${p}`));
  }
  return out.join("\n");
}

function wrapWords(text: string, chars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > Math.max(8, chars)) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

/** The size a text takes at a font size, wrapped to the column. */
export function measureText(
  text: string,
  fontSize: number,
  width = COLUMN,
): { text: string; width: number; height: number } {
  const chars = Math.max(10, Math.floor(width / (fontSize * CHAR)));
  const wrapped = wrap(text.trim(), chars);
  const lines = wrapped.split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return {
    text: wrapped,
    width: Math.ceil(longest * fontSize * CHAR),
    height: Math.ceil(lines.length * fontSize * LINE),
  };
}

export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** The box around some elements, or null when there are none. */
export function bounds(els: readonly Rect[]): Rect | null {
  if (els.length === 0) {
    return null;
  }
  const x1 = Math.min(...els.map((e) => Math.min(e.x, e.x + e.width)));
  const y1 = Math.min(...els.map((e) => Math.min(e.y, e.y + e.height)));
  const x2 = Math.max(...els.map((e) => Math.max(e.x, e.x + e.width)));
  const y2 = Math.max(...els.map((e) => Math.max(e.y, e.y + e.height)));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The diagram's shapes get solid pastel fills and readable fonts; given colours are kept. */
export function styleDiagram(ops: readonly SceneOp[]): SceneOp[] {
  const fills = [PALETTE.blue, PALETTE.purple, PALETTE.green, PALETTE.amber];
  let n = 0;
  return ops.map((op) => {
    if (op.op !== "add") {
      return op;
    }
    const el: NewElement = { ...op.element };
    const shape =
      el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";
    if (
      shape &&
      el.text &&
      (!el.backgroundColor || el.backgroundColor === "transparent")
    ) {
      el.backgroundColor =
        el.type === "diamond" ? PALETTE.amber : fills[n++ % 2];
      el.fillStyle = "solid";
    }
    if (el.fontSize !== undefined && el.fontSize < FONT.min) {
      el.fontSize = FONT.min;
    }
    return { ...op, element: el };
  });
}

/** Moves a diagram's add ops by dx, dy (points of lines are relative, so x and y are enough). */
function shift(ops: readonly SceneOp[], dx: number, dy: number): SceneOp[] {
  return ops.map((op) =>
    op.op === "add"
      ? {
          ...op,
          element: {
            ...op.element,
            x: (op.element.x ?? 0) + dx,
            y: (op.element.y ?? 0) + dy,
          },
        }
      : op,
  );
}

/** The column's size without placing it. */
export function stackSize(items: readonly Item[]): {
  width: number;
  height: number;
} {
  const r = stack(items, { x: 0, y: 0 });
  return { width: r.rect.width, height: r.rect.height };
}

/** Places the items in a column with its top left at `at`. Returns the ops and the column's box. */
export function stack(
  items: readonly Item[],
  at: { x: number; y: number },
): { ops: SceneOp[]; rect: Rect; placed: Rect[] } {
  const ops: SceneOp[] = [];
  const placed: Rect[] = [];
  let y = at.y;
  let width = 0;
  items.forEach((it, i) => {
    const heading = it.kind === "text" && it.fontSize > FONT.text;
    if (i > 0) {
      y += heading ? GAP_BEFORE_HEADING : GAP;
    }
    if (it.kind === "text") {
      const size = Math.max(FONT.min, it.fontSize);
      const inner = it.boxed ? COLUMN - 2 * PAD : COLUMN;
      const m = measureText(it.text, size, inner);
      if (it.boxed) {
        const box = {
          x: at.x,
          y,
          width: Math.min(COLUMN, m.width + 2 * PAD),
          height: m.height + 2 * PAD,
        };
        ops.push({
          op: "add",
          element: {
            type: "rectangle",
            ...box,
            backgroundColor: PALETTE.note,
            fillStyle: "solid",
            roundness: "round",
          },
        });
        ops.push({
          op: "add",
          element: {
            type: "text",
            x: at.x + PAD,
            y: y + PAD,
            text: m.text,
            fontSize: size,
          },
        });
        placed.push(box);
        width = Math.max(width, box.width);
        y += box.height;
      } else {
        ops.push({
          op: "add",
          element: { type: "text", x: at.x, y, text: m.text, fontSize: size },
        });
        placed.push({ x: at.x, y, width: m.width, height: m.height });
        width = Math.max(width, m.width);
        y += m.height;
      }
    } else {
      ops.push(...shift(styleDiagram(it.ops), at.x, y));
      placed.push({ x: at.x, y, width: it.width, height: it.height });
      width = Math.max(width, it.width);
      y += it.height;
    }
  });
  return {
    ops,
    rect: { x: at.x, y: at.y, width, height: y - at.y },
    placed,
  };
}

/**
 * Where the column goes: at the replaced elements' top left when it fits there without touching
 * anything that stays; else below everything (left aligned with it); on an empty canvas, around
 * the view's centre.
 */
export function anchorFor(
  size: { width: number; height: number },
  remaining: readonly Rect[],
  replaced: Rect | null,
  viewCenter: { x: number; y: number },
): { x: number; y: number } {
  if (replaced) {
    const spot = { x: replaced.x, y: replaced.y, ...size };
    if (!remaining.some((r) => overlaps(spot, r, MARGIN / 2))) {
      return { x: replaced.x, y: replaced.y };
    }
  }
  const all = bounds(remaining);
  if (!all) {
    return replaced
      ? { x: replaced.x, y: replaced.y }
      : {
          x: Math.round(viewCenter.x - Math.min(size.width, COLUMN) / 2),
          y: Math.round(viewCenter.y - Math.min(size.height, 400) / 2),
        };
  }
  return { x: Math.round(all.x), y: Math.round(all.y + all.height + MARGIN) };
}

/** The elements as boxes (labels inside shapes are part of their shape). */
export const rectsOf = (els: readonly SceneElement[]): Rect[] =>
  els.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
