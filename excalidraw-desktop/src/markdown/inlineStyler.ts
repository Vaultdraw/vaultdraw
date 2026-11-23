/**
 * The canvas side of inline Markdown (step 2): a text-run styler that draws
 * `**bold**`, `*italic*` and `` `code` `` words in their face with the marks
 * hidden. Display only: the text keeps its marks (plain Markdown in the file,
 * readable on excalidraw.com) and the text editor shows them while editing.
 *
 * Loaded only once a drawing turns Markdown mode on with inline styles on;
 * installed in its own run slot ("markdown"), so `[[links]]` keep theirs and
 * both apply to the same words. Cost per raster of a text: one regex test when
 * it has no mark; runs are cached by element version.
 */
import {
  FONT_FAMILY,
  boldFontOf,
  getFontString,
  isBoldFont,
} from "@excalidraw/common";
import { invalidateTextRunStyles, setTextRunStyler } from "@excalidraw/element";

import type { TextRun, TextRunStyler } from "@excalidraw/element";
import type { FontFamilyValues } from "@excalidraw/element/types";

import { hardBreaks, parseInline } from "./inlineRuns";
import { listItemOf, TASK_BOX_SCALE, TASK_DONE, TASK_OPEN } from "./lineRules";

/** One run per task box: the box glyph drawn larger, the text unchanged. */
export const taskBoxRunsOf = (
  el: Pick<El, "text" | "fontFamily" | "fontSize">,
): TextRun[] => {
  const runs: TextRun[] = [];
  let at = 0;
  for (const line of el.text.split("\n")) {
    const item = listItemOf(line);
    const box = item?.marker.slice(-1);
    if (item && (box === TASK_OPEN || box === TASK_DONE)) {
      const start = at + item.length - 2;
      runs.push({
        start,
        end: start + 1,
        font: font(el.fontFamily, el.fontSize * TASK_BOX_SCALE),
      });
    }
    at += line.length + 1;
  }
  return runs;
};

const HAS_BOX = /[☐☑]/;

export const INLINE_SLOT = "markdown";

type El = Parameters<TextRunStyler>[0];

const font = (fontFamily: number, fontSize: number) =>
  getFontString({ fontFamily: fontFamily as FontFamilyValues, fontSize });

/** The CSS font of a piece of text with these marks around it. */
export const inlineFontOf = (
  el: Pick<El, "fontFamily" | "fontSize">,
  bold: boolean,
  italic: boolean,
  code: boolean,
): string => {
  if (code) {
    return font(FONT_FAMILY.Cascadia, el.fontSize);
  }
  let f: string = font(el.fontFamily, el.fontSize);
  if (bold && !isBoldFont(el.fontFamily)) {
    const b = boldFontOf(el.fontFamily);
    // a family without a bold face: the browser thickens it
    f = b === el.fontFamily ? `bold ${f}` : font(b, el.fontSize);
  }
  return italic ? `italic ${f}` : f;
};

/** Runs for `el`: one font run per styled piece, one hidden run per mark. */
export const inlineRunsOf = (el: El): TextRun[] => {
  const typed = el.originalText ?? el.text;
  const { spans, hidden } = parseInline(
    el.text,
    el.text === typed ? undefined : hardBreaks(el.text, typed),
  );
  if (spans.length === 0 && hidden.length === 0) {
    return [];
  }
  const edges = new Set<number>();
  for (const s of spans) {
    edges.add(s.start);
    edges.add(s.end);
  }
  const cuts = [...edges].sort((a, b) => a - b);
  const runs: TextRun[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    let bold = false;
    let italic = false;
    let code = false;
    for (const s of spans) {
      if (s.start <= from && s.end >= to) {
        bold ||= s.kind === "bold";
        italic ||= s.kind === "italic";
        code ||= s.kind === "code";
      }
    }
    if (bold || italic || code) {
      runs.push({
        start: from,
        end: to,
        font: inlineFontOf(el, bold, italic, code),
      });
    }
  }
  for (const [start, end] of hidden) {
    runs.push({ start, end, hidden: true });
  }
  return runs;
};

const cache = new WeakMap<object, { version: number; runs: TextRun[] }>();

export const inlineStyler: TextRunStyler = (el) => {
  const marks = /[*_`\\]/.test(el.text);
  const boxes = HAS_BOX.test(el.text);
  if (!marks && !boxes) {
    return null;
  }
  const hit = cache.get(el);
  if (hit && hit.version === el.version) {
    return hit.runs;
  }
  const runs = [
    ...(marks ? inlineRunsOf(el) : []),
    ...(boxes ? taskBoxRunsOf(el) : []),
  ];
  cache.set(el, { version: el.version, runs });
  return runs;
};

/** Editors that want inline marks drawn; the styler is installed while any does. */
let users = 0;

/** Turns the styler on for one editor; the returned function turns it off. */
export const installInlineStyler = (): (() => void) => {
  if (users++ === 0) {
    setTextRunStyler(inlineStyler, INLINE_SLOT);
  }
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    if (--users === 0) {
      setTextRunStyler(null, INLINE_SLOT);
    } else {
      invalidateTextRunStyles();
    }
  };
};
