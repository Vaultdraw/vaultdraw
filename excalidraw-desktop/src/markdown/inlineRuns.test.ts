import { describe, expect, it } from "vitest";

import { hardBreaks, parseInline } from "./inlineRuns";

/** The text as drawn: hidden marks dropped, spans wrapped in tags. */
const show = (text: string, hard?: Set<number> | null) => {
  const { spans, hidden } = parseInline(text, hard);
  const tag = { bold: "b", italic: "i", code: "c" } as const;
  const opens = new Map<number, string[]>();
  const closes = new Map<number, string[]>();
  for (const s of spans) {
    (opens.get(s.start) ?? opens.set(s.start, []).get(s.start)!).push(
      tag[s.kind],
    );
    (closes.get(s.end) ?? closes.set(s.end, []).get(s.end)!).unshift(
      tag[s.kind],
    );
  }
  const isHidden = (i: number) => hidden.some(([a, b]) => i >= a && i < b);
  let out = "";
  for (let i = 0; i <= text.length; i++) {
    for (const t of closes.get(i) ?? []) {
      out += `</${t}>`;
    }
    for (const t of opens.get(i) ?? []) {
      out += `<${t}>`;
    }
    if (i < text.length && !isHidden(i)) {
      out += text[i];
    }
  }
  return out;
};

describe("parseInline: CommonMark inline rules", () => {
  it.each([
    // [typed, drawn]
    ["Some **bold** words", "Some <b>bold</b> words"],
    ["Some *italic* words", "Some <i>italic</i> words"],
    ["Some _italic_ words", "Some <i>italic</i> words"],
    ["Some __bold__ words", "Some <b>bold</b> words"],
    ["run `npm i` now", "run <c>npm i</c> now"],
    ["***both***", "<i><b>both</b></i>"],
    ["**a *b* c**", "<b>a <i>b</i> c</b>"],
    ["*a **b** c*", "<i>a <b>b</b> c</i>"],
    [
      "**bold** and *it* and `code`",
      "<b>bold</b> and <i>it</i> and <c>code</c>",
    ],
    ["un*frigging*believable", "un<i>frigging</i>believable"],
    ["``a ` b``", "<c>a ` b</c>"],
    ["`**not bold**`", "<c>**not bold**</c>"],
    ["**a `b` c**", "<b>a <c>b</c> c</b>"],
    ["\\*not italic\\*", "*not italic*"],
    ["a \\`b\\` c", "a `b` c"],
    ["a \\\\ b", "a \\ b"],
    ["C:\\\\dir", "C:\\dir"],
    ["\\\\*it*", "\\<i>it</i>"],
    ["lone \\ stays", "lone \\ stays"],
    ["中文**粗体**字", "中文<b>粗体</b>字"],
    ["emoji **🎉 party**", "emoji <b>🎉 party</b>"],
  ])("%j draws as %j", (typed, drawn) => {
    expect(show(typed)).toBe(drawn);
  });

  it.each([
    "snake_case_name",
    "__init__x",
    "2 * 3 * 4",
    "** not bold **",
    "* list item",
    "a**b",
    "***",
    "unmatched **bold",
    "unmatched `code",
    "``",
    "` `",
    "plain text, no marks",
    "",
  ])("%j stays literal", (typed) => {
    expect(show(typed)).toBe(typed);
  });

  it("never crosses a line the user typed", () => {
    expect(show("**a\nb**")).toBe("**a\nb**");
    expect(show("*a*\n`b`")).toBe("<i>a</i>\n<c>b</c>");
  });

  it("crosses a line the box wrapped", () => {
    const typed = "Some **bold words** here";
    const wrapped = "Some **bold\nwords** here";
    const hard = hardBreaks(wrapped, typed);
    expect(hard).toEqual(new Set());
    expect(show(wrapped, hard)).toBe("Some <b>bold\nwords</b> here");
  });

  it("hardBreaks keeps typed breaks and drops wrap spaces", () => {
    expect(hardBreaks("a\nb", "a\nb")).toEqual(new Set([1]));
    expect(hardBreaks("aa\nbb\ncc", "aa bb\ncc")).toEqual(new Set([5]));
    expect(hardBreaks("aaaa\nbb", "aaaabb")).toEqual(new Set());
    expect(hardBreaks("zz", "aa")).toBeNull();
  });

  it("is linear on long text with many marks", () => {
    const text = "**a** *b* `c` ".repeat(2000);
    const t0 = performance.now();
    const { spans } = parseInline(text);
    expect(spans).toHaveLength(6000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
