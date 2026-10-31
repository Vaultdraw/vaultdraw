/**
 * Bold, italic and code inside a line of text (Markdown mode, step 2): the
 * marks stay in the text (the file is plain Markdown, readable on
 * excalidraw.com) and are hidden on the canvas, where the words take the bold,
 * italic or monospaced face, like Obsidian's live preview. Display only: the
 * text editor shows the marks while the box is edited.
 *
 * The rules are CommonMark's (spec 0.31, "Emphasis and strong emphasis" and
 * "Code spans"), trimmed to what a drawing needs:
 * - code spans first: a run of n backticks closes at the next run of exactly n;
 * - `*` and `_` delimiter runs open or close by the flanking rules; `_` never
 *   opens or closes inside a word, so `snake_case` stays text;
 * - the rule of 3 and the opener-bottom search, so `***x***`, `**a *b***` and
 *   `*a **b***` nest like everywhere else;
 * - `\*`, `\_` and `` \` `` are literal marks (the backslash is hidden);
 * - spans never cross a line the user typed (each is its own block in
 *   Markdown mode); they do cross a line the box wrapped.
 * Pure functions, no DOM.
 */

export type InlineSpanKind = "bold" | "italic" | "code";

export type InlineSpan = {
  kind: InlineSpanKind;
  /** [start, end) of the shown text (marks excluded). */
  start: number;
  end: number;
};

export type InlineParse = {
  spans: InlineSpan[];
  /** [start, end) ranges of marks and escape backslashes, never drawn. */
  hidden: [number, number][];
};

const MARK = /[*_`]/;
const ESCAPABLE = new Set(["*", "_", "`", "\\"]);

/** Unicode whitespace (a wrap break counts as one) or the text's edge. */
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined) =>
  c !== undefined && /[\p{P}\p{S}]/u.test(c);

type Delim = {
  char: "*" | "_";
  /** Index of the first character of the remaining run. */
  pos: number;
  /** Remaining length. */
  len: number;
  /** Length when found (rule of 3). */
  orig: number;
  canOpen: boolean;
  canClose: boolean;
  active: boolean;
};

/** Code spans of one block: [open mark start, content start, content end, close mark end]. */
const codeSpans = (
  text: string,
  from: number,
  to: number,
  escaped: Set<number>,
): [number, number, number, number][] => {
  const out: [number, number, number, number][] = [];
  let i = from;
  while (i < to) {
    if (text[i] !== "`" || escaped.has(i)) {
      i++;
      continue;
    }
    let n = 0;
    while (i + n < to && text[i + n] === "`") {
      n++;
    }
    // find a closing run of exactly n
    let j = i + n;
    let close = -1;
    while (j < to) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (j + m < to && text[j + m] === "`") {
        m++;
      }
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close < 0) {
      i += n; // literal backticks
      continue;
    }
    if (close > i + n && text.slice(i + n, close).trim() !== "") {
      out.push([i, i + n, close, close + n]);
    }
    i = close + n;
  }
  return out;
};

/** Emphasis inside one block, outside code spans (CommonMark "process emphasis"). */
const emphasis = (
  text: string,
  from: number,
  to: number,
  blocked: (i: number) => boolean,
  spans: InlineSpan[],
  hidden: [number, number][],
) => {
  const delims: Delim[] = [];
  let i = from;
  while (i < to) {
    const c = text[i];
    if ((c !== "*" && c !== "_") || blocked(i)) {
      i++;
      continue;
    }
    let n = 0;
    while (i + n < to && text[i + n] === c && !blocked(i + n)) {
      n++;
    }
    const before = i > from ? text[i - 1] : undefined;
    const after = i + n < to ? text[i + n] : undefined;
    const left =
      !isSpace(after) &&
      (!isPunct(after) || isSpace(before) || isPunct(before));
    const right =
      !isSpace(before) &&
      (!isPunct(before) || isSpace(after) || isPunct(after));
    const canOpen = c === "*" ? left : left && (!right || isPunct(before));
    const canClose = c === "*" ? right : right && (!left || isPunct(after));
    if (canOpen || canClose) {
      delims.push({
        char: c,
        pos: i,
        len: n,
        orig: n,
        canOpen,
        canClose,
        active: true,
      });
    }
    i += n;
  }
  // openers_bottom per char and closer length mod 3 and canOpen
  const bottom = new Map<string, number>();
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (!closer.canClose || !closer.active) {
      continue;
    }
    while (closer.len > 0) {
      const key = `${closer.char}${closer.orig % 3}${closer.canOpen}`;
      const floor = bottom.get(key) ?? -1;
      let oi = ci - 1;
      for (; oi > floor; oi--) {
        const o = delims[oi];
        if (!o.active || o.len === 0 || o.char !== closer.char || !o.canOpen) {
          continue;
        }
        const odd =
          (o.canClose || closer.canOpen) &&
          (o.orig + closer.orig) % 3 === 0 &&
          !(o.orig % 3 === 0 && closer.orig % 3 === 0);
        if (!odd) {
          break;
        }
      }
      if (oi <= floor) {
        bottom.set(key, ci - 1);
        if (!closer.canOpen) {
          closer.active = false;
        }
        break;
      }
      const opener = delims[oi];
      const use = opener.len >= 2 && closer.len >= 2 ? 2 : 1;
      // the opener's innermost marks are its last `use` characters
      const openEnd = opener.pos + opener.len;
      const closeStart = closer.pos;
      hidden.push([openEnd - use, openEnd], [closeStart, closeStart + use]);
      spans.push({
        kind: use === 2 ? "bold" : "italic",
        start: openEnd,
        end: closeStart,
      });
      opener.len -= use;
      closer.pos += use;
      closer.len -= use;
      for (let k = oi + 1; k < ci; k++) {
        delims[k].active = false;
      }
    }
  }
};

/**
 * Hard line breaks of `text` (the drawn, possibly wrapped text) given the
 * text the user typed: offsets of `\n` that are in the typed text too. Null
 * when the two cannot be lined up (then every break counts as hard).
 */
export const hardBreaks = (text: string, typed: string): Set<number> | null => {
  const hard = new Set<number>();
  if (text === typed) {
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
      hard.add(i);
    }
    return hard;
  }
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === typed[j]) {
      if (c === "\n") {
        hard.add(i);
      }
      j++;
      continue;
    }
    if (c === "\n") {
      // a wrap: the typed text may have had spaces here
      while (j < typed.length && (typed[j] === " " || typed[j] === "\t")) {
        j++;
      }
      continue;
    }
    // spaces the wrap dropped before this character
    while (j < typed.length && (typed[j] === " " || typed[j] === "\t")) {
      j++;
    }
    if (c !== typed[j]) {
      return null;
    }
    j++;
  }
  return hard;
};

/**
 * Spans and hidden marks of `text`. `hard` = offsets of the line breaks the
 * user typed (default: every `\n`). Cost: one scan, and nothing beyond a
 * single regex test for text without any mark.
 */
export const parseInline = (
  text: string,
  hard?: Set<number> | null,
): InlineParse => {
  const spans: InlineSpan[] = [];
  const hidden: [number, number][] = [];
  if (!MARK.test(text)) {
    return { spans, hidden };
  }
  const escaped = new Set<number>();
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "\\" && ESCAPABLE.has(text[i + 1])) {
      if (text[i + 1] !== "\\") {
        hidden.push([i, i + 1]);
      }
      escaped.add(i + 1);
      i++;
    }
  }
  let from = 0;
  const blocks: [number, number][] = [];
  for (let i = 0; i <= text.length; i++) {
    if (
      i === text.length ||
      (text[i] === "\n" && (hard ? hard.has(i) : true))
    ) {
      blocks.push([from, i]);
      from = i + 1;
    }
  }
  for (const [a, b] of blocks) {
    const code = codeSpans(text, a, b, escaped);
    for (const [o, s, e, c] of code) {
      hidden.push([o, s], [e, c]);
      spans.push({ kind: "code", start: s, end: e });
    }
    const inCode = (i: number) => code.some(([o, , , c]) => i >= o && i < c);
    emphasis(text, a, b, (i) => escaped.has(i) || inCode(i), spans, hidden);
  }
  return { spans, hidden };
};
