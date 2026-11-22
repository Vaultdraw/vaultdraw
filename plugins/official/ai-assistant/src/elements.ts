/**
 * Excalidraw element JSON written by the model (a `vd draw` block) turned into scene ops.
 * The format and conventions follow the official Excalidraw MCP server (github.com/excalidraw/
 * excalidraw-mcp, MIT): a `label` on a shape or arrow is its centred text, arrows bind to shapes
 * with `start`/`end` ids, defaults are left out, array order is drawing order. Coordinates are the
 * model's own; the app moves the whole group to free space afterwards (layout.ts).
 */
import type { NewElement, SceneOp } from "@vaultdraw/api";

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const TYPES = new Set([...SHAPES, "text", "arrow", "line"]);
const STROKE = new Set(["solid", "dashed", "dotted"]);
const FILL = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);
const COLOR = /^(#[0-9a-f]{3,8}|transparent)$/i;
/** Labelled shapes are at least this big, text at least this size (the MCP cheat sheet's floors). */
export const MIN_SHAPE = { width: 120, height: 60 };
export const MIN_FONT = 16;
const MAX = 400;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo = -1e6, hi = 1e6) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi
    ? v
    : undefined;

/** The JSON array in a block's body (a bare array, or `{ "elements": [...] }`). */
function arrayOf(body: string): unknown[] | null {
  const text = body.trim();
  const tries = [text];
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a >= 0 && b > a) {
    tries.push(text.slice(a, b + 1));
  }
  for (const t of tries) {
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v)) {
        return v;
      }
      if (isObj(v) && Array.isArray(v.elements)) {
        return v.elements as unknown[];
      }
    } catch {
      /* next */
    }
  }
  return null;
}

export interface ElementsResult {
  /** `add` ops, the top left of the group at 0, 0. */
  ops: SceneOp[];
  width: number;
  height: number;
  /** Entries that were left out (unknown type, bad values). */
  skipped: number;
}

/** Converts the model's elements; throws a plain message when the body is not an array. */
export function drawToOps(body: string): ElementsResult {
  const list = arrayOf(body);
  if (!list) {
    throw new Error("The drawing in the reply was not readable JSON.");
  }
  const ids = new Set(
    list
      .filter(
        (e): e is Record<string, unknown> =>
          isObj(e) && typeof e.id === "string" && SHAPES.has(String(e.type)),
      )
      .map((e) => e.id as string),
  );
  const boxes: SceneOp[] = [];
  const links: SceneOp[] = [];
  let skipped = Math.max(0, list.length - MAX);
  for (const raw of list.slice(0, MAX)) {
    if (!isObj(raw) || !TYPES.has(String(raw.type))) {
      skipped++;
      continue;
    }
    const type = raw.type as NewElement["type"];
    const el: NewElement = {
      type,
      x: num(raw.x) ?? 0,
      y: num(raw.y) ?? 0,
    };
    for (const k of ["strokeColor", "backgroundColor"] as const) {
      if (typeof raw[k] === "string" && COLOR.test(raw[k] as string)) {
        el[k] = raw[k] as string;
      }
    }
    const sw = num(raw.strokeWidth, 0.5, 16);
    if (sw) {
      el.strokeWidth = sw;
    }
    const op = num(raw.opacity, 0, 100);
    if (op !== undefined) {
      el.opacity = op;
    }
    if (typeof raw.strokeStyle === "string" && STROKE.has(raw.strokeStyle)) {
      el.strokeStyle = raw.strokeStyle as NewElement["strokeStyle"];
    }
    if (typeof raw.fillStyle === "string" && FILL.has(raw.fillStyle)) {
      el.fillStyle = raw.fillStyle as NewElement["fillStyle"];
    } else if (el.backgroundColor && el.backgroundColor !== "transparent") {
      el.fillStyle = "solid";
    }
    if (raw.roundness) {
      el.roundness = "round";
    }
    const label = isObj(raw.label) ? raw.label : null;
    const text =
      typeof label?.text === "string"
        ? label.text
        : typeof raw.text === "string"
        ? raw.text
        : "";
    const size = num(label?.fontSize ?? raw.fontSize, 1, 200);
    if (text) {
      el.text = text.slice(0, 2000);
      el.fontSize = Math.max(MIN_FONT, size ?? (type === "text" ? 20 : 18));
    }
    if (type === "text") {
      if (!el.text) {
        skipped++;
        continue;
      }
      boxes.push({ op: "add", element: el });
      continue;
    }
    if (SHAPES.has(type)) {
      const w = num(raw.width, 1, 1e5) ?? MIN_SHAPE.width;
      const h = num(raw.height, 1, 1e5) ?? MIN_SHAPE.height;
      el.width = text ? Math.max(w, MIN_SHAPE.width) : w;
      el.height = text ? Math.max(h, MIN_SHAPE.height) : h;
      const ref = typeof raw.id === "string" ? raw.id : undefined;
      boxes.push({ op: "add", element: el, ...(ref ? { ref } : {}) });
      continue;
    }
    // arrows and lines: points relative to x, y
    const pts = Array.isArray(raw.points)
      ? (raw.points as unknown[]).filter(
          (p): p is [number, number] =>
            Array.isArray(p) &&
            num(p[0]) !== undefined &&
            num(p[1]) !== undefined,
        )
      : [];
    if (pts.length >= 2) {
      el.points = pts.slice(0, 50);
    } else {
      const w = num(raw.width) ?? 100;
      const h = num(raw.height) ?? 0;
      el.points = [
        [0, 0],
        [w, h],
      ];
    }
    if (type === "arrow") {
      const a = isObj(raw.start) ? raw.start.id : undefined;
      const b = isObj(raw.end) ? raw.end.id : undefined;
      if (typeof a === "string" && ids.has(a)) {
        el.start = { ref: a };
      }
      if (typeof b === "string" && ids.has(b)) {
        el.end = { ref: b };
      }
    } else {
      delete el.text;
      delete el.fontSize;
    }
    links.push({ op: "add", element: el });
  }
  return normalise([...boxes, ...links], skipped);
}

/** Moves the group so its top left is at 0, 0 and measures it. */
function normalise(ops: SceneOp[], skipped: number): ElementsResult {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const grow = (x: number, y: number) => {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  };
  for (const op of ops) {
    if (op.op !== "add") {
      continue;
    }
    const e = op.element;
    const x = e.x ?? 0;
    const y = e.y ?? 0;
    grow(x, y);
    if (e.points) {
      for (const [px, py] of e.points) {
        grow(x + px, y + py);
      }
    } else if (e.type === "text") {
      const lines = (e.text ?? "").split("\n");
      const fs = e.fontSize ?? 20;
      grow(
        x + Math.max(...lines.map((l) => l.length)) * fs * 0.6,
        y + lines.length * fs * 1.25,
      );
    } else {
      grow(x + (e.width ?? 0), y + (e.height ?? 0));
    }
  }
  if (x1 === Infinity) {
    return { ops: [], width: 0, height: 0, skipped };
  }
  const moved = ops.map((op) =>
    op.op === "add"
      ? {
          ...op,
          element: {
            ...op.element,
            x: (op.element.x ?? 0) - x1,
            y: (op.element.y ?? 0) - y1,
          },
        }
      : op,
  );
  return {
    ops: moved,
    width: Math.ceil(x2 - x1),
    height: Math.ceil(y2 - y1),
    skipped,
  };
}
