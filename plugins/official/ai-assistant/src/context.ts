/**
 * What the model is told about the drawing: plain text built from the elements, capped in size.
 * The same text is shown to the user before anything is sent.
 */
import type { SceneElement } from "@vaultdraw/api";

export interface Context {
  /** The text that is sent. */
  text: string;
  /** One line for the panel: what it is made of. */
  summary: string;
  /** Characters dropped to stay under the limit. */
  cut: number;
  /** What to tell the user when `text` is empty (default: the drawing is empty). */
  emptyMessage?: string;
  /** The user chose to send nothing from the drawing. */
  none?: boolean;
  /** `text` only says that the note is empty (Summarise refuses it). */
  textless?: boolean;
}

const round = (n: number) => Math.round(n);

const line = (e: SceneElement): string => {
  const box = `at (${round(e.x)}, ${round(e.y)}) size ${round(e.width)}x${round(
    e.height,
  )}`;
  const label = e.text ? ` "${e.text.replace(/\s+/g, " ").trim()}"` : "";
  const name = e.name ? ` "${e.name}"` : "";
  return `- ${e.type}${label || name} ${box}`;
};

/** The elements as text. Labels of shapes come as their own text elements, in drawing order. */
export function describeElements(
  elements: readonly SceneElement[],
  limit: number,
): Context {
  const lines = elements.map(line);
  let text = lines.join("\n");
  let cut = 0;
  if (text.length > limit) {
    cut = text.length - limit;
    text = text.slice(0, limit);
    text = text.slice(0, text.lastIndexOf("\n") + 1 || limit);
  }
  const texts = elements.filter((e) => e.text).length;
  return {
    text,
    summary: `${elements.length} element${
      elements.length === 1 ? "" : "s"
    }, ${texts} with text`,
    cut,
  };
}

/** Only the words, for summaries: text elements in reading order (top to bottom, then left to right). */
export function textOf(
  elements: readonly SceneElement[],
  limit: number,
): Context {
  const words = elements
    .filter((e) => e.text && e.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => e.text!.trim());
  let text = words.join("\n\n");
  let cut = 0;
  if (text.length > limit) {
    cut = text.length - limit;
    text = text.slice(0, limit);
  }
  return {
    text,
    summary: `${words.length} piece${words.length === 1 ? "" : "s"} of text`,
    cut,
  };
}

/** The selection if there is one, else the whole drawing. */
export function pickElements(
  all: readonly SceneElement[],
  selection: readonly string[],
): { elements: readonly SceneElement[]; scope: "selection" | "drawing" } {
  if (selection.length > 0) {
    const set = new Set(selection);
    const picked = all.filter((e) => set.has(e.id));
    if (picked.length > 0) {
      return { elements: picked, scope: "selection" };
    }
  }
  return { elements: all, scope: "drawing" };
}

/** A note's text for a summary: cut at the limit on a line break when there is one. */
export function noteText(text: string, name: string, limit: number): Context {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  let out = clean;
  let cut = 0;
  if (out.length > limit) {
    cut = out.length - limit;
    out = out.slice(0, limit);
    const at = out.lastIndexOf("\n");
    if (at > limit / 2) {
      out = out.slice(0, at);
    }
  }
  const words = clean ? clean.split(/\s+/).length : 0;
  return {
    text: out,
    summary: `Note "${name}": ${words} word${words === 1 ? "" : "s"}`,
    cut,
    emptyMessage: "This note is empty, so there is nothing to summarise.",
  };
}

/** The note's display name: its file name without the folder and `.md`. */
export const noteName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

const clip = (t: string, n: number) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/**
 * A compact picture of the drawing for the assistant: counts, the area it covers, its texts with
 * ids (top to bottom), and the selection in full. Never longer than `limit` characters: the
 * selection comes first, then texts until the limit, then a count of what was left out.
 */
export function summarizeDrawing(
  elements: readonly SceneElement[],
  selection: readonly string[],
  limit: number,
  path: string | null,
  scope: "drawing" | "selection" = "drawing",
): Context {
  if (path === null && elements.length === 0) {
    return {
      text: "No drawing is open. Use `vd new` to make one.",
      summary: "No drawing open",
      cut: 0,
    };
  }
  if (elements.length === 0) {
    return {
      text: "The drawing is empty.",
      summary: "The drawing is empty",
      cut: 0,
    };
  }
  const counts = new Map<string, number>();
  for (const e of elements) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const box = {
    x1: Math.min(...elements.map((e) => e.x)),
    y1: Math.min(...elements.map((e) => e.y)),
    x2: Math.max(...elements.map((e) => e.x + e.width)),
    y2: Math.max(...elements.map((e) => e.y + e.height)),
  };
  const sel = new Set(selection);
  const picked = elements.filter((e) => sel.has(e.id));
  const head = [
    `${elements.length} element${elements.length === 1 ? "" : "s"}: ${[
      ...counts,
    ]
      .map(([t, n]) => `${n} ${t}`)
      .join(", ")}.`,
    `Area: x ${round(box.x1)} to ${round(box.x2)}, y ${round(
      box.y1,
    )} to ${round(box.y2)}.`,
  ];
  const out: string[] = [...head];
  let used = head.join("\n").length;
  let left = 0;
  const add = (line: string) => {
    if (used + line.length + 1 > limit - 40) {
      left++;
      return;
    }
    out.push(line);
    used += line.length + 1;
  };
  if (picked.length) {
    add(`Selected (${picked.length}), in full:`);
    for (const e of picked) {
      add(`- id ${e.id}: ${line(e).slice(2)}`);
    }
  }
  const texts = elements
    .filter((e) => !sel.has(e.id) && (e.text?.trim() || e.name))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (texts.length) {
    add("Texts, top to bottom (id, type, text):");
    for (const e of texts) {
      add(`- ${e.id} ${e.type}: "${clip(e.text || e.name || "", 80)}"`);
    }
  }
  if (left) {
    out.push(`(${left} more line${left === 1 ? "" : "s"} left out)`);
  }
  return {
    text: out.join("\n"),
    summary: `${
      scope === "selection" ? "The selection" : "The whole drawing"
    }: ${elements.length} element${elements.length === 1 ? "" : "s"}${
      picked.length ? `, ${picked.length} selected` : ""
    }`,
    cut: left,
  };
}

/** True when the selection looks like a diagram: shapes joined by arrows or lines. */
export function selectionIsDiagram(
  elements: readonly SceneElement[],
  selection: readonly string[],
): boolean {
  const sel = new Set(selection);
  const picked = elements.filter((e) => sel.has(e.id));
  return (
    picked.some((e) => e.type === "arrow" || e.type === "line") &&
    picked.filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type))
      .length >= 2
  );
}
