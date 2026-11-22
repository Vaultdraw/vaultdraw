import { describe, expect, it } from "vitest";

import { sortEntries, type SortOrder } from "./sortOrder";

import type { VaultEntry } from "./types";

const e = (
  name: string,
  kind: VaultEntry["kind"],
  modifiedAt: number,
): VaultEntry => ({
  path: name,
  name,
  kind,
  modifiedAt,
  size: 0,
});

// The owner's screenshot: Lec 1..6 with mixed modification times, plus files.
const entries = [
  e("Lec 3", "folder", 60),
  e("Lec 2", "folder", 50),
  e("Lec 1", "folder", 40),
  e("Lec 6", "folder", 30),
  e("Lec 5", "folder", 20),
  e("Lec 4", "folder", 10),
  e("old.excalidraw", "drawing", 1),
  e("new.excalidraw", "drawing", 99),
  e("mid.md", "note", 50),
];
const LEC = ["Lec 1", "Lec 2", "Lec 3", "Lec 4", "Lec 5", "Lec 6"];
const run = (o: SortOrder) => sortEntries(entries, o).map((x) => x.name);

describe("folders keep name order under a date sort", () => {
  it("modified_desc: folders Lec 1..6, files newest first", () => {
    expect(run("modified_desc")).toEqual([
      ...LEC,
      "new.excalidraw",
      "mid.md",
      "old.excalidraw",
    ]);
  });
  it("modified_asc: folders Lec 1..6, files oldest first", () => {
    expect(run("modified_asc")).toEqual([
      ...LEC,
      "old.excalidraw",
      "mid.md",
      "new.excalidraw",
    ]);
  });
  it("name_asc: folders and files by name", () => {
    expect(run("name_asc")).toEqual([
      ...LEC,
      "mid.md",
      "new.excalidraw",
      "old.excalidraw",
    ]);
  });
  it("name_desc: folders follow the name sort too", () => {
    expect(run("name_desc")).toEqual([
      ...[...LEC].reverse(),
      "old.excalidraw",
      "new.excalidraw",
      "mid.md",
    ]);
  });
});
