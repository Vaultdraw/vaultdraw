/**
 * Mermaid-to-Excalidraw skeleton elements as plugin scene ops (`ctx.diagrams.mermaidToElements`).
 * Pure: the converter itself is loaded by diagramsContext.ts.
 */
import type { MermaidDrawing, NewElement, SceneOp } from "../api";

type Skeleton = Record<string, unknown> & { id?: string; type: string };

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const STROKE_STYLES = new Set(["solid", "dashed", "dotted"]);
const FILL_STYLES = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);

/** How far (px) an arrow's end may sit from a shape's box and still be bound to it. */
const TOUCH = 12;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Look and size shared by every element type; only values the ops accept are copied. */
function common(sk: Skeleton): Partial<NewElement> {
  const out: Partial<NewElement> = {};
  const stroke = str(sk.strokeColor);
  const bg = str(sk.backgroundColor);
  const sw = num(sk.strokeWidth);
  const op = num(sk.opacity);
  if (stroke) {
    out.strokeColor = stroke;
  }
  if (bg) {
    out.backgroundColor = bg;
  }
  if (sw !== undefined && sw > 0) {
    out.strokeWidth = sw;
  }
  if (op !== undefined && op >= 0 && op <= 100) {
    out.opacity = op;
  }
  if (typeof sk.strokeStyle === "string" && STROKE_STYLES.has(sk.strokeStyle)) {
    out.strokeStyle = sk.strokeStyle as NewElement["strokeStyle"];
  }
  if (typeof sk.fillStyle === "string" && FILL_STYLES.has(sk.fillStyle)) {
    out.fillStyle = sk.fillStyle as NewElement["fillStyle"];
  }
  return out;
}

/** Ops for a converter result, the top left of the diagram at 0, 0. */
export function skeletonsToOps(skeletons: readonly Skeleton[]): MermaidDrawing {
  const ids = new Set(skeletons.map((s) => s.id).filter(Boolean) as string[]);
  // The box of every shape, so an arrow is bound only to shapes its ends really touch.
  const boxes = new Map<string, [number, number, number, number]>();
  for (const sk of skeletons) {
    if (sk.id && (SHAPES.has(sk.type) || sk.type === "text")) {
      const x = num(sk.x) ?? 0;
      const y = num(sk.y) ?? 0;
      boxes.set(sk.id, [
        x,
        y,
        x + (num(sk.width) ?? 0),
        y + (num(sk.height) ?? 0),
      ]);
    }
  }
  const touches = (id: string, px: number, py: number) => {
    const b = boxes.get(id);
    return (
      !!b &&
      px >= b[0] - TOUCH &&
      px <= b[2] + TOUCH &&
      py >= b[1] - TOUCH &&
      py <= b[3] + TOUCH
    );
  };
  const boxed: SceneOp[] = [];
  const linked: SceneOp[] = [];
  let skipped = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const shift: Array<(dx: number, dy: number) => void> = [];

  for (const sk of skeletons) {
    const x = num(sk.x) ?? 0;
    const y = num(sk.y) ?? 0;
    const label = sk.label as
      | { text?: unknown; fontSize?: unknown }
      | undefined;
    if (sk.type === "text") {
      const el: NewElement = {
        type: "text",
        x,
        y,
        text: str(sk.text) ?? "",
        ...common(sk),
      };
      const fs = num(sk.fontSize);
      if (fs) {
        el.fontSize = fs;
      }
      grow(x, y);
      grow(x + (num(sk.width) ?? 0), y + (num(sk.height) ?? 0));
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      boxed.push({ op: "add", element: el });
    } else if (SHAPES.has(sk.type)) {
      const text0 = str(label?.text) ?? "";
      const height = num(sk.height) ?? 50;
      const el: NewElement = {
        type: sk.type as NewElement["type"],
        x,
        y,
        // A box with no width (a sequence diagram's step number) is as wide as its label needs.
        width:
          num(sk.width) ??
          (text0 ? Math.max(height, text0.length * 9 + 16) : 100),
        height,
        ...common(sk),
      };
      if (sk.roundness) {
        el.roundness = "round";
      }
      const text = str(label?.text);
      if (text) {
        el.text = text;
        const fs = num(label?.fontSize);
        if (fs) {
          el.fontSize = fs;
        }
      }
      grow(x, y);
      grow(x + (el.width ?? 0), y + (el.height ?? 0));
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      boxed.push({ op: "add", ref: sk.id, element: el });
    } else if (sk.type === "arrow" || sk.type === "line") {
      const pts = Array.isArray(sk.points)
        ? (sk.points as unknown[]).filter(
            (p): p is [number, number] =>
              Array.isArray(p) &&
              typeof p[0] === "number" &&
              typeof p[1] === "number",
          )
        : [];
      const el: NewElement = { type: sk.type, x, y, ...common(sk) };
      if (pts.length >= 2) {
        el.points = pts;
      }
      for (const [px, py] of pts) {
        grow(x + px, y + py);
      }
      const text = str(label?.text);
      if (sk.type === "arrow" && text) {
        el.text = text;
      }
      // A straight arrow between two shapes is bound to them (the app lays it on their outlines);
      // a bent one keeps its points. A sequence diagram's message names the two actors' header
      // boxes but runs far below them: binding would pull it up onto the headers, so an arrow is
      // bound only when its ends touch the shapes.
      const a = (sk.start as { id?: unknown } | undefined)?.id;
      const b = (sk.end as { id?: unknown } | undefined)?.id;
      if (
        sk.type === "arrow" &&
        pts.length <= 2 &&
        typeof a === "string" &&
        typeof b === "string" &&
        ids.has(a) &&
        ids.has(b) &&
        pts.length === 2 &&
        touches(a, x + pts[0][0], y + pts[0][1]) &&
        touches(b, x + pts[1][0], y + pts[1][1])
      ) {
        el.start = { ref: a };
        el.end = { ref: b };
      }
      shift.push((dx, dy) => {
        el.x = x + dx;
        el.y = y + dy;
      });
      linked.push({ op: "add", element: el });
    } else {
      skipped++;
    }
  }
  if (minX === Infinity) {
    return { ops: [], width: 0, height: 0, skipped };
  }
  for (const move of shift) {
    move(-minX, -minY);
  }
  return {
    ops: [...boxed, ...linked],
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
    skipped,
  };
}
