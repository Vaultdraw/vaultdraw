/**
 * Multi-select in the file tree (F13): SCENARIOS.md rows S1-S16 at the unit
 * level. Each table row is one behaviour, what it does and what it must not.
 */
import { describe, expect, it, vi } from "vitest";

import { bulkMoveCheck } from "../MoveModal";
import { buildSelectionMenu } from "../menu/rowMenuModel";
import { bulkFailureMessage, bulkTrashMessage } from "../trashMessage";
import { onceConfirm } from "../../links/moveFlow";

import { treeActions, type TreeKeyDeps } from "./treeKeys";
import {
  EMPTY_SELECTION,
  actionTargets,
  countLabel,
  pruneSelection,
  selectAll,
  selectRange,
  toggleSelection,
  topLevelPaths,
  type TreeSelection,
} from "./treeSelection";

import type { MenuNode } from "../menu/menuModel";
import type { VaultEntry } from "../../vault/types";
import type { TreeRow } from "./flattenTree";

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 0,
});
const row = (path: string, kind: VaultEntry["kind"] = "drawing"): TreeRow => ({
  entry: entry(path, kind),
  depth: path.split("/").length - 1,
  expanded: kind === "folder",
});
// a/ > a/x, a/y ; b.excalidraw ; c.md ; d/
const ROWS = [
  row("a", "folder"),
  row("a/x.excalidraw"),
  row("a/y.excalidraw"),
  row("b.excalidraw"),
  row("c.md", "note"),
  row("d", "folder"),
];
const sel = (...paths: string[]): TreeSelection => ({
  paths: new Set(paths),
  anchor: paths[paths.length - 1] ?? null,
});
const list = (s: TreeSelection) => [...s.paths].sort();

describe("selection model", () => {
  it.each([
    // [what, start, path, expected]
    ["S1 Cmd+click adds a row", [], "b.excalidraw", ["b.excalidraw"]],
    [
      "S1 Cmd+click adds a second row",
      ["a/x.excalidraw"],
      "c.md",
      ["a/x.excalidraw", "c.md"],
    ],
    [
      "S2 Cmd+click on a selected row removes it",
      ["b.excalidraw", "c.md"],
      "c.md",
      ["b.excalidraw"],
    ],
  ])("%s", (_name, start, path, expected) => {
    expect(list(toggleSelection(sel(...start), path))).toEqual(expected);
  });

  it("S2 removing the last row gives the shared empty selection (no cost)", () => {
    expect(toggleSelection(sel("b.excalidraw"), "b.excalidraw")).toBe(
      EMPTY_SELECTION,
    );
  });

  it.each([
    [
      "S3 down from the anchor",
      "a/x.excalidraw",
      "c.md",
      ["a/x.excalidraw", "a/y.excalidraw", "b.excalidraw", "c.md"],
    ],
    [
      "S3 up from the anchor",
      "c.md",
      "a/y.excalidraw",
      ["a/y.excalidraw", "b.excalidraw", "c.md"],
    ],
    ["S3 the anchor alone", "b.excalidraw", "b.excalidraw", ["b.excalidraw"]],
  ])("Shift+click: %s", (_name, anchor, to, expected) => {
    const start: TreeSelection = { paths: new Set(), anchor };
    expect(list(selectRange(start, ROWS, to, null))).toEqual(expected);
  });

  it("S4 a second Shift+click replaces the range and keeps the anchor (Zed, Obsidian)", () => {
    const first = selectRange(
      { paths: new Set(), anchor: "b.excalidraw" },
      ROWS,
      "d",
      null,
    );
    const second = selectRange(first, ROWS, "a/y.excalidraw", null);
    expect(list(second)).toEqual(["a/y.excalidraw", "b.excalidraw"]);
    expect(second.anchor).toBe("b.excalidraw");
  });

  it("S4 with no anchor the focused row starts the range; a hidden anchor starts at the target", () => {
    expect(
      list(selectRange(EMPTY_SELECTION, ROWS, "c.md", "b.excalidraw")),
    ).toEqual(["b.excalidraw", "c.md"]);
    const hidden: TreeSelection = {
      paths: new Set(),
      anchor: "gone/z.excalidraw",
    };
    expect(list(selectRange(hidden, ROWS, "c.md", null))).toEqual(["c.md"]);
    // A target that is not a visible row changes nothing.
    const s = sel("c.md");
    expect(selectRange(s, ROWS, "nope", null)).toBe(s);
  });

  it("S5 select all takes every visible row; no rows = empty", () => {
    expect(selectAll(ROWS).paths.size).toBe(ROWS.length);
    expect(selectAll([])).toBe(EMPTY_SELECTION);
  });

  it("S6 rows that no longer exist leave the selection; unchanged returns the same object", () => {
    const s = sel("a/x.excalidraw", "c.md");
    expect(pruneSelection(s, () => true)).toBe(s);
    expect(list(pruneSelection(s, (p) => p !== "c.md"))).toEqual([
      "a/x.excalidraw",
    ]);
    expect(pruneSelection(s, () => false)).toBe(EMPTY_SELECTION);
    expect(pruneSelection(EMPTY_SELECTION, () => false)).toBe(EMPTY_SELECTION);
  });

  it("S7 a folder takes its contents: selected children of a selected folder are dropped", () => {
    expect(
      topLevelPaths(["a/x.excalidraw", "a", "ab.excalidraw", "d", "d/e/f.md"]),
    ).toEqual(["a", "ab.excalidraw", "d"]);
  });

  it.each([
    [
      "S8 a row in a multi-selection acts on all",
      sel("b.excalidraw", "c.md"),
      "c.md",
      ["b.excalidraw", "c.md"],
    ],
    [
      "S8 a row outside the selection acts alone",
      sel("b.excalidraw", "c.md"),
      "d",
      ["d"],
    ],
    [
      "S8 a selection of one acts on the clicked row",
      sel("b.excalidraw"),
      "b.excalidraw",
      ["b.excalidraw"],
    ],
  ])("%s", (_name, s, path, expected) => {
    expect(actionTargets(s, path)).toEqual(expected);
  });

  it.each([
    [[entry("a.excalidraw", "drawing")], "1 drawing"],
    [
      [entry("a.excalidraw", "drawing"), entry("b.excalidraw", "excalidrawMd")],
      "2 drawings",
    ],
    [[entry("a", "folder"), entry("b", "folder")], "2 folders"],
    [[entry("a.md", "note"), entry("b.excalidraw", "drawing")], "2 items"],
  ])("count label %#", (entries, label) => {
    expect(countLabel(entries)).toBe(label);
  });
});

describe("tree keys with a selection", () => {
  const deps = (over: Partial<TreeKeyDeps>) => {
    const d: TreeKeyDeps = {
      rows: ROWS,
      focusedPath: "b.excalidraw",
      activePath: null,
      readOnly: false,
      dragging: false,
      setFocusedPath: vi.fn(),
      expand: vi.fn(),
      toggle: vi.fn(),
      open: vi.fn(),
      rename: vi.fn(),
      trash: vi.fn(),
      move: vi.fn(),
      create: vi.fn(),
      menu: vi.fn(),
      exit: vi.fn(),
      selection: EMPTY_SELECTION,
      setSelection: vi.fn(),
      setVisual: vi.fn(),
      moveMany: vi.fn(),
      trashMany: vi.fn(),
      ...over,
    };
    return { d, a: treeActions(d) };
  };
  const lastSelection = (d: TreeKeyDeps) =>
    list((d.setSelection as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);

  it("S9 Shift+J / Shift+K extend from the cursor and never wrap", () => {
    let t = deps({});
    t.a.extendDown!();
    expect(t.d.setFocusedPath).toHaveBeenCalledWith("c.md");
    expect(lastSelection(t.d)).toEqual(["b.excalidraw", "c.md"]);
    t = deps({ focusedPath: "d" });
    t.a.extendDown!();
    expect(t.d.setFocusedPath).toHaveBeenCalledWith("d");
    t = deps({ focusedPath: "a" });
    t.a.extendUp!();
    expect(lastSelection(t.d)).toEqual(["a"]);
  });

  it("S10 X toggles the focused row; nothing focused = not offered", () => {
    const t = deps({});
    t.a.toggleSelection!();
    expect(lastSelection(t.d)).toEqual(["b.excalidraw"]);
    expect(deps({ focusedPath: null }).a.toggleSelection).toBeUndefined();
  });

  it("S11 V starts visual mode on the cursor; in visual mode j extends; V again ends it", () => {
    let t = deps({});
    t.a.visual!();
    expect(t.d.setVisual).toHaveBeenCalledWith(true);
    expect(lastSelection(t.d)).toEqual(["b.excalidraw"]);
    t = deps({ visual: true, selection: sel("b.excalidraw") });
    t.a.down!();
    expect(lastSelection(t.d)).toEqual(["b.excalidraw", "c.md"]);
    t.a.visual!();
    expect(t.d.setVisual).toHaveBeenLastCalledWith(false);
  });

  it("S12 without visual mode j moves the cursor and keeps the selection", () => {
    const t = deps({ selection: sel("a") });
    t.a.down!();
    expect(t.d.setSelection).not.toHaveBeenCalled();
  });

  it("S13 Escape clears the selection first, then leaves the tree", () => {
    let t = deps({ selection: sel("a", "c.md") });
    t.a.exit!();
    expect(t.d.setSelection).toHaveBeenCalledWith(EMPTY_SELECTION);
    expect(t.d.exit).not.toHaveBeenCalled();
    t = deps({});
    t.a.exit!();
    expect(t.d.exit).toHaveBeenCalled();
    expect(
      deps({ dragging: true, selection: sel("a") }).a.exit,
    ).toBeUndefined();
  });

  it("S14 M and D act on the whole selection (top-level paths); with none, on the focused row", () => {
    let t = deps({ selection: sel("a", "a/x.excalidraw", "c.md") });
    t.a.move!();
    expect(t.d.moveMany).toHaveBeenCalledWith(["a", "c.md"]);
    t.a.delete!();
    expect(t.d.trashMany).toHaveBeenCalledWith(["a", "c.md"]);
    expect(t.d.trash).not.toHaveBeenCalled();
    t = deps({});
    t.a.delete!();
    expect(t.d.trash).toHaveBeenCalledWith(ROWS[3].entry);
  });

  it("S15 read-only vault: no bulk move or trash", () => {
    const t = deps({ readOnly: true, selection: sel("a", "c.md") });
    expect(t.a.move).toBeUndefined();
    expect(t.a.delete).toBeUndefined();
  });

  it("S16 clear selection and select all are offered only when they do something", () => {
    expect(deps({}).a.clearSelection).toBeUndefined();
    expect(deps({ selection: sel("a") }).a.clearSelection).toBeDefined();
    expect(deps({ rows: [] }).a.selectAll).toBeUndefined();
  });

  it("a tree without selection support offers no selection keys", () => {
    const t = deps({ setSelection: undefined });
    expect(t.a.extendDown).toBeUndefined();
    expect(t.a.visual).toBeUndefined();
  });
});

describe("bulk move check (move dialog and drag)", () => {
  it.each([
    [["a/x.excalidraw", "b.excalidraw"], "d", true, undefined],
    // One item already there: skipped, the rest move.
    [["a/x.excalidraw", "b.excalidraw"], "", true, undefined],
    // Every item already there.
    [["b.excalidraw", "c.md"], "", false, "Item is already in this folder"],
    // A folder into itself or its own subfolder blocks the whole move.
    [["a", "b.excalidraw"], "a", false, "Cannot move entry into itself"],
    [
      ["a", "b.excalidraw"],
      "a/sub",
      false,
      "Cannot move a folder into its own subfolder",
    ],
  ])("%j -> %j", (paths, target, allowed, reason) => {
    const check = bulkMoveCheck(paths, target);
    expect(check.allowed).toBe(allowed);
    expect(check.reason).toBe(reason);
  });
});

describe("selection menu", () => {
  const ids = (nodes: MenuNode[]): string[] =>
    nodes.flatMap((n) =>
      n.kind === "item"
        ? [n.id]
        : n.kind === "submenu"
        ? [n.id, ...ids(n.items as MenuNode[])]
        : [],
    );
  const actions = {
    move: vi.fn(),
    trash: vi.fn(),
    clear: vi.fn(),
    exportAs: vi.fn(),
  };
  const drawings = [
    entry("a.excalidraw", "drawing"),
    entry("b.excalidraw", "drawing"),
  ];

  it("S17 drawings: move, export PNG/SVG, clear, trash with the count in the labels", () => {
    const nodes = buildSelectionMenu({
      entries: drawings,
      label: "2 drawings",
      readOnly: false,
      actions,
    });
    expect(ids(nodes)).toEqual([
      "move",
      "export",
      "exportPng",
      "exportSvg",
      "clearSelection",
      "trash",
    ]);
    const labels = nodes.flatMap((n) => (n.kind === "item" ? [n.label] : []));
    expect(labels).toContain("Move 2 drawings to…");
    expect(labels).toContain("Move 2 drawings to Trash");
  });

  it("S17 notes only: no export; read-only: no move or trash", () => {
    const notes = [entry("a.md", "note"), entry("b.md", "note")];
    expect(
      ids(
        buildSelectionMenu({
          entries: notes,
          label: "2 notes",
          readOnly: false,
          actions,
        }),
      ),
    ).not.toContain("export");
    expect(
      ids(
        buildSelectionMenu({
          entries: drawings,
          label: "2 drawings",
          readOnly: true,
          actions,
        }),
      ),
    ).toEqual(["export", "exportPng", "exportSvg", "clearSelection"]);
  });
});

describe("bulk messages", () => {
  it("trash question names the first three and counts the rest; folders say so", () => {
    const four = ["a", "b", "c", "d"].map((n) =>
      entry(`${n}.excalidraw`, "drawing"),
    );
    expect(bulkTrashMessage(four)).toBe(
      "Move “a.excalidraw”, “b.excalidraw”, “c.excalidraw” and 1 more to the Trash? You can restore them from the system Trash.",
    );
    expect(
      bulkTrashMessage([entry("f", "folder"), entry("g.md", "note")]),
    ).toContain("Folders go with everything inside them.");
  });

  it("failure notice says how many worked and which failed", () => {
    expect(bulkFailureMessage("move", ["x.excalidraw"], 3, "it exists")).toBe(
      'Moved 2 of 3. Couldn\'t move "x.excalidraw": it exists',
    );
    expect(bulkFailureMessage("trash", ["a", "b"], 2, "denied")).toBe(
      'Couldn\'t move to the Trash "a", "b": denied',
    );
  });
});

describe("link questions in a bulk move", () => {
  it("S18 each question is asked once; its answer is reused for the batch", async () => {
    const ask = vi.fn(async () => true);
    const answers = new Map<string, boolean>();
    const confirm = onceConfirm(ask, answers);
    const req = {
      title: "Update links?",
      message: "m",
      confirmLabel: "Update",
      cancelLabel: "No",
    };
    expect(await confirm(req)).toBe(true);
    expect(await confirm({ ...req, message: "other counts" })).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    await confirm({ ...req, title: "Move anyway?" });
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
