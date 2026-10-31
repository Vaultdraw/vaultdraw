import { describe, expect, it } from "vitest";

import table from "../../src-tauri/crates/vaultdraw-core/src/contract/tag_grammar_cases.json";

import { findTags, keyUnder, tagKey } from "./grammar";

const tags = (s: string) => findTags(s).map((m) => m.display);

describe("findTags: the table shared with search/tags.rs (twins)", () => {
  it.each(table.cases)("$text", ({ text, tags }) => {
    expect(findTags(text).map((m) => m.display)).toEqual(tags);
  });
});

describe("findTags", () => {
  it("finds basic and nested tags", () => {
    expect(tags("#dsa and #dsa/graphs, #Interview_prep-2024")).toEqual([
      "dsa",
      "dsa/graphs",
      "Interview_prep-2024",
    ]);
    expect(tags("(#a) \"#b\" 'c' [#d] x:#e")).toEqual(["a", "b", "d", "e"]);
    expect(tags("line1\n#todo")).toEqual(["todo"]);
  });

  it("supports unicode letters and combining marks", () => {
    expect(tags("#café #数据库 #привет #über/größe")).toEqual([
      "café",
      "数据库",
      "привет",
      "über/größe",
    ]);
    expect(tags("#éte")).toEqual(["éte"]);
  });

  it("ignores hashes inside words, urls and entities", () => {
    for (const s of [
      "abc#def",
      "https://example.com/page#section",
      "&#123; &#x1F;",
      "##double",
      "# heading and # alone",
      "a/#b",
    ]) {
      expect(tags(s)).toEqual([]);
    }
  });

  it("rejects numbers and hex colours but keeps letter words", () => {
    expect(tags("#123 #2024 #1/2 #2024/10")).toEqual([]);
    expect(tags("colour #ff00aa and #1e1e1e and #a1b and #ABCDEF12")).toEqual(
      [],
    );
    expect(tags("#bad #add #face #2024q3 #3d")).toEqual([
      "bad",
      "add",
      "face",
      "2024q3",
      "3d",
    ]);
  });

  it("trims trailing punctuation and cuts at empty segments", () => {
    expect(tags("#todo. #done! #x, #y? #z)")).toEqual([
      "todo",
      "done",
      "x",
      "y",
      "z",
    ]);
    expect(tags("#a/ #b- #c// #d//e #/f #-g")).toEqual(["a", "b", "c", "d"]);
    expect(tags("#a/b/c/")).toEqual(["a/b/c"]);
    expect(tags("#_x")).toEqual(["_x"]);
  });

  it("limits tags to 64 characters", () => {
    expect(tags(`#${"a".repeat(64)}`)).toHaveLength(1);
    expect(tags(`#${"a".repeat(65)}`)).toEqual([]);
  });

  it("reports UTF-16 offsets of #tag", () => {
    const s = "😀 #Ab/c!";
    const [m] = findTags(s);
    expect(s.slice(m.start, m.end)).toBe("#Ab/c");
  });
});

describe("tagKey / keyUnder", () => {
  it("folds case and accents", () => {
    expect(tagKey("DSA/Café")).toBe("dsa/cafe");
  });

  it("matches self and descendants only", () => {
    expect(keyUnder("dsa/graphs", "dsa")).toBe(true);
    expect(keyUnder("dsa", "dsa")).toBe(true);
    expect(keyUnder("dsabc", "dsa")).toBe(false);
    expect(keyUnder("ds", "dsa")).toBe(false);
  });
});
