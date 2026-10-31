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
