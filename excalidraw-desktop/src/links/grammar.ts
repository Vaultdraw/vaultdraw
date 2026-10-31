/**
 * Link grammar, a port of src-tauri/src/links/grammar.rs (keep them in sync;
 * both pass src-tauri/src/links/fixtures/grammar.json). Offsets are UTF-16.
 *
 * - Text: `[[target]]` and `[[target|label]]` on one line, `.excalidraw`
 *   dropped from the target, at most MAX_LINK_CHARS inside the brackets.
 * - Link field: `[[x]]`, `vaultdraw://open?file=x`, `./x.excalidraw`,
 *   `x.excalidraw`. Anything else (web URLs, `/...`) is not a vault link.
 * - Element anchor: `[[x#^id]]` (Obsidian's block link) and `vaultdraw://open?file=x&anchor=%5Eid`
 *   name one element of the drawing. The target never holds the anchor, so a link resolves,
 *   is renamed and counted exactly like one without it.
 */
import { hasDrawingExt, stripDrawingExt } from "../vault/fileKind";

import {
  decodeVaultUrl,
  decodeVaultUrlAnchor,
  VAULT_URL_PREFIX,
} from "./linkUri";

export const MAX_LINK_CHARS = 256;

export type LinkSpan = {
  /** UTF-16 [start, end) of the whole `[[...]]` token. */
  start: number;
  end: number;
  target: string;
  label: string | null;
  /** The element id after `#^`, or null. */
  anchor: string | null;
};

export type LinkField = {
  target: string;
  relative?: boolean;
  /** The element id the link points at, or null. */
  anchor?: string | null;
};

/** An element id as written after `#^`: letters, digits, `-` and `_` (Obsidian block ids, Excalidraw ids). */
const ANCHOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `x#^id` -> `x` and `id`; anything else stays whole. */
export function splitAnchor(written: string): {
  target: string;
  anchor: string | null;
} {
  const at = written.lastIndexOf("#^");
  if (at > 0 && ANCHOR_ID.test(written.slice(at + 2))) {
    const target = written.slice(0, at).trimEnd();
    if (target) {
      return { target, anchor: written.slice(at + 2) };
    }
  }
  return { target: written, anchor: null };
}

export const stripExtension = (target: string) => stripDrawingExt(target);

/** `inner` of `[[inner]]` -> target/label, or null when it is not a link. */
function parseInner(
  inner: string,
): { target: string; label: string | null; anchor: string | null } | null {
  if (inner.length > MAX_LINK_CHARS) {
    return null;
  }
  const bar = inner.indexOf("|");
  const rawTarget = bar < 0 ? inner : inner.slice(0, bar);
  const split = splitAnchor(rawTarget.trim());
  const target = stripExtension(split.target);
  if (!target) {
    return null;
  }
  const label = bar < 0 ? null : inner.slice(bar + 1).trim();
  return { target, label: label ? label : null, anchor: split.anchor };
}

/**
 * All `[[...]]` links in `text`, in order. Same scan as the Rust grammar:
 * from each `[[`, the body runs to the first `]`, `[` or newline. `]]` closes
 * it; a `[` restarts the scan at that bracket (so `[[[a]]]` links `a`); a lone
 * `]` or a newline means no link. A body with `\r` is rejected.
 */
export function findLinks(text: string): LinkSpan[] {
  const out: LinkSpan[] = [];
  let pos = 0;
  for (;;) {
    const start = text.indexOf("[[", pos);
    if (start < 0) {
      return out;
    }
    const bs = start + 2;
    let j = bs;
    while (j < text.length) {
      const c = text[j];
      if (c === "]" || c === "[" || c === "\n") {
        break;
      }
      j++;
    }
    if (j >= text.length) {
      return out;
    }
    if (text[j] === "[") {
      pos = j - 1;
      continue;
    }
    if (text[j] === "]" && text[j + 1] === "]") {
      const inner = text.slice(bs, j);
      const parsed = inner.includes("\r") ? null : parseInner(inner);
      if (parsed) {
        out.push({ start, end: j + 2, ...parsed });
        pos = j + 2;
      } else {
        pos = bs;
      }
      continue;
    }
    pos = j;
  }
}

/** The target of an element `link` field, or null when it is not a vault link. */
export function parseLinkField(
  link: string | null | undefined,
): LinkField | null {
  const raw = link?.trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("[[")) {
    const first = findLinks(raw)[0];
    return first ? { target: first.target, anchor: first.anchor } : null;
  }
  if (raw.startsWith(VAULT_URL_PREFIX)) {
    const target = decodeVaultUrl(raw);
    return target
      ? { target: stripExtension(target), anchor: decodeVaultUrlAnchor(raw) }
      : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/")) {
    return null;
  }
  if (hasDrawingExt(raw)) {
    return { target: stripExtension(raw), relative: true };
  }
  return null;
}
