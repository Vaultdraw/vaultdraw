// @vitest-environment jsdom
/**
 * Every link form a note rename rewrites (`vaultdraw-core/src/markdown/link_target_cases.json`,
 * read by the native parser's test and the link index's test) points the reading view at the
 * same file: the table cell `[[Old\|a]]`, `[t](<Old One.md>)`, headings, titles, embeds.
 * Twins share one case table (testing.md); toimprove 327, 328.
 */
import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/markdown/link_target_cases.json";

import { renderNoteHtml } from "./render/obsidian";
import { sanitizeNoteHtml } from "./render/sanitize";

type Row = { note: string; src: string; written: (string | null)[] };

/** The file each link in the reading view points at, in source order; `null` for a web link. */
const viewTargets = (md: string): (string | null)[] => {
  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(
    renderNoteHtml(md, { resolve: () => null, highlight: false, math: true }),
    { remoteImages: false },
  );
  return [
    ...div.querySelectorAll<HTMLElement>("[data-target], a[href], img[src]"),
  ].map((el) => {
    if (el.dataset.target !== undefined) {
      return el.dataset.target;
    }
    if (el.dataset.external) {
      return null;
    }
    const raw = el.getAttribute("href") ?? el.getAttribute("src") ?? "";
    return decodeURIComponent(raw.split("#")[0]);
  });
};

describe("link forms: the reading view reads the targets the native parser reads", () => {
  for (const r of table as Row[]) {
    it(r.note, () => {
      const want = r.written.map((w) =>
        w === null ? null : decodeURIComponent(w),
      );
      expect(viewTargets(r.src)).toEqual(want);
    });
  }
});
