/**
 * Turns the model's Excalidraw-style element list (the shape the official Excalidraw MCP server
 * uses: `label` on shapes, arrows bound by id, palette names) into scene "add" ops for
 * `ctx.scene.batch`. Pure: no host calls. The host already centres and wraps a container's `text`
 * as its bound label and binds `start`/`end` arrows edge to edge, so this module only validates,
 * fills defaults, enforces readable sizes and fonts, and lays the group out from 0,0.
 */
import type { NewElement, SceneOp } from "@vaultdraw/api";

export interface ExpandOptions {
  /** Added to every position (default 0,0: the group's top-left is at the origin). */
  origin?: { x: number; y: number };
  /** Ids already on the canvas that an arrow may bind to. */
  existingIds?: ReadonlySet<string>;
  /** Elements past this count are dropped with a problem line (default 150). */
  maxElements?: number;
}

export interface ExpandResult {
  ops: SceneOp[];
  /** Plain lines for the model or the user: what was dropped, fixed or ignored. */
  problems: string[];
  /** Size of the whole group, origin offset not included. */
  width: number;
  height: number;
  /** The model's `cameraUpdate`, if any (in the output's coordinates). */
  camera?: { x: number; y: number; width: number; height: number };
  /** Ids from `delete` pseudo-elements, for the caller to resolve. */
  deletes: string[];
}

export const MIN_FONT = 16;
export const LABEL_FONT = 18;
export const MIN_W = 120;
export const MIN_H = 60;
const MAX_W = 320;
const PAD = 24;

/** Stroke colours: a name means a role. */
export const STROKES: Record<string, string> = {
  blue: "#4a9eed",
  amber: "#f59e0b",
  green: "#22c55e",
  red: "#ef4444",
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  lime: "#84cc16",
  black: "#1e1e1e",
};
/** Pastel fills, by colour and by meaning. */
export const FILLS: Record<string, string> = {
  "light-blue": "#a5d8ff",
  "light-green": "#b2f2bb",
  "light-orange": "#ffd8a8",
  "light-purple": "#d0bfff",
  "light-red": "#ffc9c9",
  "light-yellow": "#fff3bf",
  "light-teal": "#c3fae8",
  "light-pink": "#eebefa",
  input: "#a5d8ff",
  source: "#a5d8ff",
  success: "#b2f2bb",
  output: "#b2f2bb",
  warning: "#ffd8a8",
  pending: "#ffd8a8",
  external: "#ffd8a8",
  processing: "#d0bfff",
  middleware: "#d0bfff",
  error: "#ffc9c9",
  critical: "#ffc9c9",
  note: "#fff3bf",
  decision: "#fff3bf",
  storage: "#c3fae8",
  data: "#c3fae8",
  analytics: "#eebefa",
  blue: "#a5d8ff",
  green: "#b2f2bb",
  orange: "#ffd8a8",
  amber: "#ffd8a8",
  purple: "#d0bfff",
  red: "#ffc9c9",
  yellow: "#fff3bf",
  teal: "#c3fae8",
  pink: "#eebefa",
  white: "#ffffff",
  "zone-blue": "#dbe4ff",
  "zone-purple": "#e5dbff",
  "zone-green": "#d3f9d8",
};
const ZONES = new Set(["zone-blue", "zone-purple", "zone-green"]);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const TYPES = new Set([...SHAPES, "text", "arrow", "line"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6
    ? v
    : undefined;
const key = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

/** A colour the host accepts, from a hex, a palette name or "transparent"; undefined when unknown. */
export function resolveColor(
  v: unknown,
  role: "stroke" | "fill",
): string | undefined {
  if (typeof v !== "string") {
    return undefined;
  }
  const s = v.trim();
  if (HEX.test(s)) {
    return s.toLowerCase();
  }
  const k = key(s);
  if (k === "transparent" || k === "none") {
    return "transparent";
  }
  return role === "stroke" ? STROKES[k] ?? FILLS[k] : FILLS[k] ?? STROKES[k];
}

const cleanText = (s: string, problems: string[], id: string) => {
  const out = s.replace(EMOJI, "").replace(/ +$/gm, "").trim();
  if (out !== s) {
    problems.push(`${id}: emoji removed (the font cannot draw them)`);
  }
  return out.slice(0, 2000);
};

/** Word-wrap to `cpl` characters per line; long words are kept whole. */
function wrap(text: string, cpl: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + w.length > cpl) {
        lines.push(line);
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The container size that holds `text` at `fs`: grows what the model gave, never shrinks it. */
function fitShape(
  type: string,
  text: string,
  fs: number,
  w0: number,
  h0: number,
): { width: number; height: number; text: string } {
  const k = type === "diamond" ? 1.7 : type === "ellipse" ? 1.3 : 1;
  const charW = fs * 0.65;
  const longest = Math.max(...text.split("\n").map((l) => l.length), 1);
  let width = Math.max(MIN_W, w0);
  const need = (longest * charW + PAD) * k;
  if (need > width) {
    width = Math.min(need, Math.max(width, MAX_W * k));
  }
  const cpl = Math.max(4, Math.floor((width / k - PAD) / charW));
  const lines = wrap(text, cpl);
  const height = Math.max(MIN_H, h0, (lines.length * fs * 1.25 + PAD) * k);
  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    text: lines.join("\n"),
  };
}

interface Box {
  op: Extract<SceneOp, { op: "add" }>;
  /** Bounding box in group coordinates (arrows: from their points). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Reads the model's list; accepts an array, `{elements: [...]}` or a JSON string of either. */
function listOf(input: unknown, problems: string[]): unknown[] {
  let v = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      problems.push("The element list is not valid JSON.");
      return [];
    }
  }
  if (isObj(v) && Array.isArray(v.elements)) {
    v = v.elements;
  }
  if (!Array.isArray(v)) {
    problems.push("Expected a list of elements.");
    return [];
  }
  return v;
}

export function expandElements(
  input: unknown,
  opts: ExpandOptions = {},
): ExpandResult {
  const problems: string[] = [];
  const deletes: string[] = [];
  let camera: ExpandResult["camera"];
  const boxes: Box[] = [];
  const used = new Set<string>();
  const exist = opts.existingIds ?? new Set<string>();
  const max = opts.maxElements ?? 150;
  let seq = 0;
  const fresh = () => {
    let id: string;
    do {
      id = `e${++seq}`;
    } while (used.has(id));
    return id;
  };

  const raw = listOf(input, problems);
  // Pass 1: ids, so arrows may point at shapes that come later.
  const ids = new Map<number, string>();
  const byModelId = new Map<string, string>();
  raw.forEach((r, i) => {
    if (!isObj(r) || typeof r.type !== "string" || !TYPES.has(r.type)) {
      return;
    }
    let id =
      typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : "";
    if (id && used.has(id)) {
      problems.push(`${id}: id used twice, the second one was renamed`);
      id = "";
    }
    const given = id;
    id = id || fresh();
    used.add(id);
    ids.set(i, id);
    if (given && !byModelId.has(given)) {
      byModelId.set(given, id);
    }
  });

  const refOf = (v: unknown, owner: string, end: string) => {
    let id: string | undefined;
    if (typeof v === "string") {
      id = v;
    } else if (isObj(v)) {
      id =
        typeof v.id === "string"
          ? v.id
          : typeof v.elementId === "string"
          ? v.elementId
          : typeof v.ref === "string"
          ? v.ref
          : undefined;
    }
    if (!id) {
      return undefined;
    }
    const mine = byModelId.get(id);
    if (mine && mine !== owner) {
      return { ref: mine };
    }
    if (exist.has(id)) {
      return { id };
    }
    problems.push(`${owner}: ${end} points at "${id}", which does not exist`);
    return undefined;
  };

  let count = 0;
  raw.forEach((r, i) => {
    if (!isObj(r)) {
      problems.push(`Item ${i + 1} is not an object, dropped`);
      return;
    }
    const type = r.type;
    if (type === "cameraUpdate") {
      const [x, y, w, h] = [r.x, r.y, r.width, r.height].map(num);
      if (x !== undefined && y !== undefined && w && h) {
        camera = { x, y, width: w, height: h };
      }
      return;
    }
    if (type === "delete") {
      const list = Array.isArray(r.ids)
        ? r.ids
        : typeof r.ids === "string"
        ? r.ids.split(",")
        : [];
      deletes.push(
        ...list
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      return;
    }
    const id = ids.get(i);
    if (id === undefined || typeof type !== "string") {
      problems.push(`Item ${i + 1}: unknown type "${String(type)}", dropped`);
      return;
    }
    if (++count > max) {
      if (count === max + 1) {
        // plural-ok: max is the element cap (150 by default), never 1
        problems.push(`More than ${max} elements: the rest were dropped`);
      }
      return;
    }

    const el: Record<string, unknown> = { type };
    const fx = num(r.x);
    const fy = num(r.y);
    if (
      (fx === undefined || fy === undefined) &&
      type !== "arrow" &&
      type !== "line"
    ) {
      problems.push(`${id}: no x/y, placed at 0,0`);
    }
    const x = fx ?? 0;
    const y = fy ?? 0;
    let w = num(r.width) ?? 0;
    let h = num(r.height) ?? 0;

    const stroke = resolveColor(r.strokeColor, "stroke");
    if (r.strokeColor !== undefined && stroke === undefined) {
      problems.push(
        `${id}: unknown strokeColor "${String(r.strokeColor)}", ignored`,
      );
    }
    const fillName =
      typeof r.backgroundColor === "string" ? key(r.backgroundColor) : "";
    const fill = resolveColor(r.backgroundColor, "fill");
    if (r.backgroundColor !== undefined && fill === undefined) {
      problems.push(
        `${id}: unknown backgroundColor "${String(
          r.backgroundColor,
        )}", ignored`,
      );
    }
    if (stroke && stroke !== "#1e1e1e") {
      el.strokeColor = stroke;
    }
    if (fill && fill !== "transparent") {
      el.backgroundColor = fill;
      const fs = typeof r.fillStyle === "string" ? r.fillStyle : "solid";
      el.fillStyle = ["hachure", "cross-hatch", "solid", "zigzag"].includes(fs)
        ? fs
        : "solid";
    }
    const sw = num(r.strokeWidth);
    if (sw !== undefined && sw > 0 && sw !== 2) {
      el.strokeWidth = Math.min(sw, 8);
    }
    const op = num(r.opacity);
    if (op !== undefined && op >= 0 && op < 100) {
      el.opacity = op;
    }
    if (r.strokeStyle === "dashed" || r.strokeStyle === "dotted") {
      el.strokeStyle = r.strokeStyle;
    }
    if (typeof r.link === "string") {
      el.link = r.link;
    }

    // Label: `label: {text, fontSize}`, `label: "text"`, or `text` on a container.
    let labelText = "";
    let labelFs: number | undefined;
    if (typeof r.label === "string") {
      labelText = r.label;
    } else if (isObj(r.label) && typeof r.label.text === "string") {
      labelText = r.label.text;
      labelFs = num(r.label.fontSize);
    }
    if (!labelText && typeof r.text === "string") {
      labelText = r.text;
    }
    labelText = labelText ? cleanText(labelText, problems, id) : "";
    const reqFs = labelFs ?? num(r.fontSize);
    let fs = reqFs ?? LABEL_FONT;
    if (reqFs !== undefined && reqFs < MIN_FONT) {
      problems.push(`${id}: font ${reqFs} is too small, raised to ${MIN_FONT}`);
    }
    fs = Math.max(fs, MIN_FONT);

    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    const extra: Box[] = [];

    if (SHAPES.has(type)) {
      const zone =
        type === "rectangle" &&
        (ZONES.has(fillName) ||
          (op !== undefined && op <= 50 && w >= 300 && h >= 200));
      if (labelText && !zone) {
        const fit = fitShape(type, labelText, fs, w, h);
        w = fit.width;
        h = fit.height;
        el.text = fit.text;
        el.fontSize = fs;
      } else {
        w = Math.max(w, MIN_W);
        h = Math.max(h, MIN_H);
      }
      if (type === "rectangle") {
        el.roundness = r.roundness === "sharp" ? "sharp" : "round";
      }
      el.width = w;
      el.height = h;
      el.x = x;
      el.y = y;
      x0 = x;
      y0 = y;
      x1 = x + w;
      y1 = y + h;
      if (labelText && zone) {
        // A zone's title is its own text at the top, not a centred label.
        const t: Record<string, unknown> = {
          type: "text",
          x: x + 16,
          y: y + 12,
          text: labelText,
          fontSize: Math.max(fs, 20),
        };
        extra.push({
          op: { op: "add", element: t as unknown as NewElement, ref: fresh() },
          x0: x + 16,
          y0: y + 12,
          x1: x + 16,
          y1: y + 12,
        });
      }
    } else if (type === "text") {
      if (!labelText.trim()) {
        problems.push(`${id}: text element without text, dropped`);
        return;
      }
      el.text = labelText;
      if (reqFs !== undefined) {
        el.fontSize = fs;
      }
      el.x = x;
      el.y = y;
      const lines = labelText.split("\n");
      const tw = Math.max(...lines.map((l) => l.length)) * fs * 0.6;
      x0 = x;
      y0 = y;
      x1 = x + tw;
      y1 = y + lines.length * fs * 1.25;
    } else {
      // arrow or line
      const pts = Array.isArray(r.points)
        ? (r.points as unknown[]).filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              num(p[0]) !== undefined &&
              num(p[1]) !== undefined,
          )
        : [];
      const points: [number, number][] =
        pts.length >= 2
          ? pts.map((p) => [p[0], p[1]])
          : [
              [0, 0],
              [w || 100, h],
            ];
      el.points = points;
      el.x = x;
      el.y = y;
      const xs = points.map((p) => x + p[0]);
      const ys = points.map((p) => y + p[1]);
      x0 = Math.min(...xs);
      y0 = Math.min(...ys);
      x1 = Math.max(...xs);
      y1 = Math.max(...ys);
      if (type === "arrow") {
        const s = refOf(
          r.start ??
            r.from ??
            (isObj(r.startBinding) ? r.startBinding : undefined),
          id,
          "start",
        );
        const e = refOf(
          r.end ?? r.to ?? (isObj(r.endBinding) ? r.endBinding : undefined),
          id,
          "end",
        );
        if (s) {
          el.start = s;
        }
        if (e) {
          el.end = e;
        }
        if (labelText) {
          el.text =
            labelText.length > 24 ? `${labelText.slice(0, 23)}…` : labelText;
          el.fontSize = fs;
        }
      }
    }
    // x, y of the element are shifted after the group's top-left is known.
    boxes.push({
      op: { op: "add", element: el as unknown as NewElement, ref: id },
      x0,
      y0,
      x1,
      y1,
    });
    boxes.push(...extra);
  });

  // The whole group's top-left goes to 0,0, then the origin is added.
  const minX = boxes.length ? Math.min(...boxes.map((b) => b.x0)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((b) => b.y0)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((b) => b.x1)) : 0;
  const maxY = boxes.length ? Math.max(...boxes.map((b) => b.y1)) : 0;
  const ox = (opts.origin?.x ?? 0) - minX;
  const oy = (opts.origin?.y ?? 0) - minY;
  const ops = boxes.map((b) => {
    const e = b.op.element as NewElement;
    e.x = (e.x ?? 0) + ox;
    e.y = (e.y ?? 0) + oy;
    return b.op;
  });
  if (camera) {
    camera = { ...camera, x: camera.x + ox, y: camera.y + oy };
  }
  return {
    ops,
    problems,
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
    camera,
    deletes,
  };
}
