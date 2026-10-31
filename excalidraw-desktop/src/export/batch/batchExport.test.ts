/**
 * Export to a folder (F31, F13): SCENARIOS.md rows X1-X10 at the unit level.
 */
import { describe, expect, it, vi } from "vitest";

import cases from "../../../src-tauri/crates/vaultdraw-core/src/contract/export_folder_cases.json";

import {
  planExport,
  resultSummary,
  runBatchExport,
  type BatchItem,
} from "./batchExport";
import { exportTarget, isValidExportPath } from "./exportTarget";

import type { ExportExistingMode } from "../../components/tree/treeSettings";
import type { VaultEntry } from "../../vault/types";

const e = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 0,
});
// DSA/ { Graphs, Trees, Notes.md, DP/ { Intro, Deep/ { Last } } }, Top.excalidraw
const TREE: Record<string, VaultEntry[]> = {
  "": [e("DSA", "folder"), e("Top.excalidraw", "drawing")],
  DSA: [
    e("DSA/Trees.excalidraw", "drawing"),
    e("DSA/Graphs.excalidraw", "drawing"),
    e("DSA/Notes.md", "note"),
    e("DSA/DP", "folder"),
  ],
  "DSA/DP": [
    e("DSA/DP/Intro.excalidraw", "drawing"),
    e("DSA/DP/Deep", "folder"),
  ],
  "DSA/DP/Deep": [e("DSA/DP/Deep/Last.excalidraw", "drawing")],
};
const list = async (path: string) => TREE[path] ?? [];

describe("twin of the native writer (contract table)", () => {
  it.each(cases.writes)("$write with $existing over $present", (c) => {
    const present = new Set(c.present);
    expect(
      exportTarget(
        (p) => present.has(p),
        c.write,
        c.existing as ExportExistingMode,
      ),
    ).toEqual({ status: c.status, path: c.path });
  });
  it.each(cases.invalid)("refuses %j", (bad) => {
    expect(isValidExportPath(bad)).toBe(false);
  });
});

describe("planExport", () => {
  it("X1 a folder, with subfolders: its drawings at the top, subfolders mirrored, notes left out", async () => {
    expect(
      await planExport(list, [{ path: "DSA", kind: "folder" }], true),
    ).toEqual([
      { path: "DSA/Graphs.excalidraw", dir: "" },
      { path: "DSA/Trees.excalidraw", dir: "" },
      { path: "DSA/DP/Intro.excalidraw", dir: "DP" },
      { path: "DSA/DP/Deep/Last.excalidraw", dir: "DP/Deep" },
    ]);
  });

  it("X2 a folder without subfolders: only its own drawings", async () => {
    expect(
      (await planExport(list, [{ path: "DSA", kind: "folder" }], false)).map(
        (i) => i.path,
      ),
    ).toEqual(["DSA/Graphs.excalidraw", "DSA/Trees.excalidraw"]);
  });

  it("X3 the vault root exports the whole vault", async () => {
    expect(
      await planExport(list, [{ path: "", kind: "folder" }], true),
    ).toHaveLength(5);
  });

  it("X4 a selection: drawings at the top, folders as subfolders, notes skipped, no duplicates", async () => {
    const items = await planExport(
      list,
      [
        { path: "Top.excalidraw", kind: "drawing" },
        { path: "DSA/DP", kind: "folder" },
        { path: "DSA/DP/Intro.excalidraw", kind: "drawing" },
        { path: "DSA/Notes.md", kind: "note" },
      ],
      true,
    );
    expect(items).toEqual([
      { path: "Top.excalidraw", dir: "" },
      { path: "DSA/DP/Intro.excalidraw", dir: "DP" },
      { path: "DSA/DP/Deep/Last.excalidraw", dir: "DP/Deep" },
    ]);
  });

  it("X5 an empty folder plans nothing", async () => {
    expect(
      await planExport(list, [{ path: "Empty", kind: "folder" }], true),
    ).toEqual([]);
  });
});

describe("runBatchExport", () => {
  const items: BatchItem[] = [
    { path: "a/One.excalidraw", dir: "" },
    { path: "b/One.excalidraw", dir: "" },
    { path: "Empty.excalidraw", dir: "" },
    { path: "Broken.excalidraw", dir: "sub" },
  ];
  const render = vi.fn(async (path: string) => {
    if (path === "Empty.excalidraw") {
      return null;
    }
    if (path === "Broken.excalidraw") {
      throw new Error("Not a drawing");
    }
    return { fileName: "One.png", bytes: new Uint8Array([1]) };
  });

  it("X6 writes each drawing; same names in one batch both land; empty and broken are reported", async () => {
    const write = vi.fn(
      async (rel: string, _b: Uint8Array, keepBoth: boolean) => ({
        status: "written" as const,
        path: keepBoth ? rel.replace(".png", " 2.png") : rel,
      }),
    );
    const progress = vi.fn();
    const r = await runBatchExport({
      items,
      render,
      write,
      signal: new AbortController().signal,
      onProgress: progress,
      pause: async () => undefined,
    });
    expect(write.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["One.png", false],
      ["One.png", true],
    ]);
    expect(r).toEqual({
      written: 2,
      skipped: 0,
      empty: 1,
      failed: [{ path: "Broken.excalidraw", reason: "Not a drawing" }],
      cancelled: false,
    });
    expect(progress).toHaveBeenLastCalledWith({
      done: 4,
      total: 4,
      current: null,
    });
    expect(progress.mock.calls[1][0]).toEqual({
      done: 1,
      total: 4,
      current: "b/One.excalidraw",
    });
  });

  it("X7 Cancel stops before the next drawing and writes nothing more", async () => {
    const controller = new AbortController();
    const write = vi.fn(async (rel: string) => {
      controller.abort();
      return { status: "written" as const, path: rel };
    });
    const r = await runBatchExport({
      items,
      render,
      write,
      signal: controller.signal,
      onProgress: () => undefined,
      pause: async () => undefined,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(r.cancelled).toBe(true);
    expect(r.written).toBe(1);
  });

  it("X8 the summary is plain words", () => {
    expect(
      resultSummary(
        {
          written: 3,
          skipped: 1,
          empty: 2,
          failed: [{ path: "x", reason: "y" }],
          cancelled: false,
        },
        "/Exports",
      ),
    ).toBe(
      "Exported 3 drawings to /Exports. 1 file was already there and kept. 2 empty drawings were left out. 1 drawing could not be exported.",
    );
    expect(
      resultSummary(
        { written: 1, skipped: 0, empty: 0, failed: [], cancelled: true },
        "/E",
      ),
    ).toBe("Cancelled after exporting 1 drawing to /E.");
  });
});
