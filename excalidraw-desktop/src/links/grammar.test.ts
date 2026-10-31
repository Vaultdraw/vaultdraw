import { describe, expect, it } from "vitest";

import fixtures from "../../src-tauri/src/links/fixtures/grammar.json";

import { findLinks, parseLinkField } from "./grammar";
import {
  decodeVaultUrl,
  decodeVaultUrlAnchor,
  encodeVaultUrl,
} from "./linkUri";

describe("findLinks (shared fixtures)", () => {
  for (const c of fixtures.text) {
    it(JSON.stringify(c.input), () => {
      expect(findLinks(c.input)).toEqual(c.links);
    });
  }
  it("rejects over-long links and takes the inner of nested brackets", () => {
    expect(findLinks(`[[${"a".repeat(300)}]]`)).toEqual([]);
    expect(findLinks("[[a [[b]]")).toEqual([
      { start: 4, end: 9, target: "b", label: null, anchor: null },
    ]);
  });
  it("counts UTF-16 units for astral characters", () => {
    expect(findLinks("😀 [[x]]")[0]).toMatchObject({ start: 3, end: 8 });
  });
});

describe("parseLinkField (shared fixtures)", () => {
  for (const c of fixtures.linkField) {
    it(JSON.stringify(c.input), () => {
      const got = parseLinkField(c.input);
      if (c.target === null) {
        expect(got).toBeNull();
      } else {
        expect(got?.target).toBe(c.target);
        expect(got?.anchor ?? null).toBe(c.anchor);
        expect(!!got?.relative).toBe(!!(c as { relative?: boolean }).relative);
      }
    });
  }
  it("reads the older path= form and ignores extras", () => {
    expect(
      parseLinkField("vaultdraw://open?path=Graphs%2FBFS.excalidraw&x=1"),
    ).toEqual({ target: "Graphs/BFS", anchor: null });
    expect(parseLinkField(null)).toBeNull();
    expect(parseLinkField(["java", "script:alert(1)"].join(""))).toBeNull();
  });
});

describe("linkUri", () => {
  it.each(["Graphs/BFS and DFS", "Café/ünï & more?#%", "a+b=c/日本語", "x"])(
    "round trips %s",
    (target) => {
      const url = encodeVaultUrl(target);
      expect(url.startsWith("vaultdraw://open?file=")).toBe(true);
      expect(decodeVaultUrl(url)).toBe(target);
    },
  );
  it("keeps slashes readable", () => {
    expect(encodeVaultUrl("Graphs/BFS and DFS")).toBe(
      "vaultdraw://open?file=Graphs/BFS%20and%20DFS",
    );
  });
  it("carries an element anchor and round trips it", () => {
    const url = encodeVaultUrl("Graphs/BFS", "k9_-");
    expect(url).toBe("vaultdraw://open?file=Graphs/BFS&anchor=%5Ek9_-");
    expect(decodeVaultUrlAnchor(url)).toBe("k9_-");
    expect(decodeVaultUrl(url)).toBe("Graphs/BFS");
    expect(decodeVaultUrlAnchor("vaultdraw://open?file=a")).toBeNull();
    expect(
      decodeVaultUrlAnchor("vaultdraw://open?file=a&anchor=k9"),
    ).toBeNull();
    expect(decodeVaultUrlAnchor("https://x?anchor=%5Ek")).toBeNull();
    // Same as Rust: the first anchor that is an id wins.
    expect(
      decodeVaultUrlAnchor("vaultdraw://open?file=a&anchor=bad&anchor=%5Eid"),
    ).toBe("id");
  });
  it("rejects malformed input", () => {
    expect(decodeVaultUrl("https://x")).toBeNull();
    expect(decodeVaultUrl("vaultdraw://open?file=%E0%A4%A")).toBeNull();
    expect(decodeVaultUrl("vaultdraw://open")).toBeNull();
  });
});
