/**
 * The file tree's keyboard actions as a ListController (commands/listNav.ts):
 * the `list.*` commands call these, so every key is rebindable in `[hotkeys]`.
 * Pure over a snapshot of the tree's state, computed only when a command
 * asks (lazyTreeController), never per render.
 *
 * Safety: rename, delete, move and the menu need a focused row. With none,
 * they are not offered (the key passes, the palette hides them), even while
 * a drawing is open: navigation may start at the open drawing, edits never.
 * The row menu's other items (duplicate, export ...) follow the same rule.
 */
import { isAssetKind } from "../../vault/fileKind";
import { getParentPath } from "../../vault/treeStore";

import {
  EMPTY_SELECTION,
  selectAll,
  selectRange,
  toggleSelection,
  topLevelPaths,
  type TreeSelection,
} from "./treeSelection";

import type { ListAction } from "../../commands/listNav";
import type { ExplorerExportFormat } from "../../export/exportFromFile";
import type { VaultEntry } from "../../vault/types";
import type { TreeRow } from "./flattenTree";

export interface TreeKeyDeps {
  rows: readonly TreeRow[];
  focusedPath: string | null;
  /** The open drawing: the cursor starts there when nothing is focused. */
  activePath: string | null;
  readOnly: boolean;
  /** A row is being dragged: Escape belongs to the drag. */
  dragging: boolean;
  setFocusedPath(path: string): void;
  expand(folder: string): void;
  /** Toggle a folder open/closed. */
  toggle(folder: string): void;
  open(path: string, newTab: boolean): void;
  rename(entry: VaultEntry): void;
  trash(entry: VaultEntry): void;
  move(entry: VaultEntry): void;
  create(parentFolder: string, kind: "drawing" | "note" | "folder"): void;
  /** Notes are on (`extensions.notes`): "New note here" is offered. */
  notes?: boolean;
  menu(entry: VaultEntry): void;
  exit(): void;
  /** Multi-select (F13); absent = the tree offers no selection keys. */
  selection?: TreeSelection;
  setSelection?(sel: TreeSelection): void;
  /** Vim-style visual mode (V): moving the cursor extends the selection. */
  visual?: boolean;
  setVisual?(on: boolean): void;
  /** Bulk move and trash of these paths (top-level only). */
  moveMany?(paths: string[]): void;
  trashMany?(paths: string[]): void;
  /** Export these drawings and folders into a chosen folder (F13, F31). */
  exportMany?(paths: string[], format: "png" | "svg"): void;
  /** Row menu items (command audit S8); absent = not offered. */
  row?: TreeRowActions;
}

/** The row menu's items, each taking the focused row's path. */
export interface TreeRowActions {
  duplicate(path: string): void;
  reveal(path: string): void;
  showAsGrid?(path: string): void;
  saveAsTemplate?(path: string): void;
  localGraph?(path: string): void;
  history?(path: string): void;
  export?(path: string, format: ExplorerExportFormat): void;
  /** A folder: export every drawing in it into a chosen folder (F31). */
  exportFolder?(path: string): void;
  /** Copy the row's path: relative to the vault, absolute, or a vaultdraw:// link. */
  copyPath?(path: string, kind: "relative" | "absolute" | "link"): void;
  /** A sync-service row: compare a conflict copy, download an iCloud placeholder. */
  sync?(entry: VaultEntry, action: "compare" | "download"): void;
  /** A picture row while a writable drawing is open: insert it into that drawing. */
  insertPicture?(path: string): void;
}

/** Everything the tree implements (it has no second view: Tab leaves it). */
export type TreeAction = Exclude<ListAction, "nextView">;

export const TREE_ACTIONS: readonly TreeAction[] = [
  "down",
  "up",
  "first",
  "last",
  "expand",
  "collapse",
  "open",
  "select",
  "openInNewTab",
  "rename",
  "delete",
  "newItem",
  "newFolder",
  "newNote",
  "move",
  "menu",
  "exit",
  "duplicate",
  "saveAsTemplate",
  "reveal",
  "showAsGrid",
  "localGraph",
  "history",
  "exportPng",
  "exportSvg",
  "exportPdf",
  "saveCopy",
  "copyPath",
  "copyAbsolutePath",
  "copyLink",
  "compareConflict",
  "downloadFromCloud",
  "extendDown",
  "extendUp",
  "toggleSelection",
  "visual",
  "selectAll",
  "clearSelection",
  "exportFolder",
  "insertPicture",
];

/**
 * The folder a new item goes in: `path` itself when it is a folder, else its
 * parent; the vault root when there is no path. Shared with the palette's
 * "New drawing in selected folder".
 */
export function targetFolder(
  path: string | null,
  isFolder: (path: string) => boolean,
): string {
  if (!path) {
    return "";
  }
  return isFolder(path) ? path : getParentPath(path) ?? "";
}

type TreeActions = Partial<Record<TreeAction, () => void>>;

export function treeActions(d: TreeKeyDeps): TreeActions {
  const { rows } = d;
  const indexOf = (path: string | null) =>
    path === null ? -1 : rows.findIndex((r) => r.entry.path === path);
  const index = indexOf(d.focusedPath);
  const row = index >= 0 ? rows[index] : undefined;
  const item = row?.entry;
  // Where navigation starts without a focused row: the open drawing.
  const cursor = index >= 0 ? index : indexOf(d.activePath);
  const sel = d.selection ?? EMPTY_SELECTION;
  const selecting = !!d.setSelection;
  /** Move the cursor; in visual mode (or with `extend`) the range follows it. */
  const go = (i: number, extend = d.visual) => {
    if (rows.length === 0) {
      return;
    }
    // A range never wraps around the ends.
    const next = extend
      ? Math.min(rows.length - 1, Math.max(0, i))
      : (i + rows.length) % rows.length;
    const path = rows[next].entry.path;
    d.setFocusedPath(path);
    if (extend && d.setSelection) {
      const from = index >= 0 ? rows[index].entry.path : path;
      d.setSelection(selectRange(sel, rows, path, from));
    }
  };
  // Bulk targets: the selection when there is one (Zed's marked entries).
  const many = sel.paths.size > 0 ? topLevelPaths(sel.paths) : null;
  const start = () => go(cursor < 0 ? 0 : cursor);
  const onRow = (fn: (row: TreeRow) => void) => () => row ? fn(row) : start();
  // Every row (folder, drawing, note) can be renamed, moved and deleted from the keyboard.
  const edit = (fn: (entry: VaultEntry) => void) =>
    item && !d.readOnly ? () => fn(item) : undefined;
  const createIn = (kind: "drawing" | "note" | "folder") =>
    d.readOnly || (kind === "note" && !d.notes)
      ? undefined
      : () =>
          d.create(
            targetFolder(
              d.focusedPath ?? d.activePath,
              (p) => rows[indexOf(p)]?.entry.kind === "folder",
            ),
            kind,
          );
  const activate = (newTab: boolean) =>
    onRow(({ entry }) => {
      if (entry.kind === "folder") {
        d.toggle(entry.path);
      } else {
        d.open(entry.path, newTab);
      }
    });

  return {
    down: () => go(cursor < 0 ? 0 : cursor + 1),
    up: () => go(cursor < 0 ? rows.length - 1 : cursor - 1),
    first: () => go(0),
    last: () => go(rows.length - 1),
    // Folder: open it, or step into its first child when already open.
    expand: onRow((r) => {
      if (r.entry.kind !== "folder") {
        return;
      }
      if (!r.expanded) {
        d.expand(r.entry.path);
      } else if (rows[index + 1]?.depth > r.depth) {
        go(index + 1);
      }
    }),
    // Open folder: close it; anything else: go to the parent folder.
    collapse: onRow((r) => {
      if (r.entry.kind === "folder" && r.expanded) {
        d.toggle(r.entry.path);
        return;
      }
      const parent = getParentPath(r.entry.path);
      if (parent) {
        d.setFocusedPath(parent);
      }
    }),
    open: activate(false),
    select: activate(false),
    openInNewTab: activate(true),
    rename: edit(d.rename),
    delete:
      many && d.trashMany && !d.readOnly
        ? () => d.trashMany?.(many)
        : edit(d.trash),
    move:
      many && d.moveMany && !d.readOnly
        ? () => d.moveMany?.(many)
        : edit(d.move),
    ...(selecting ? selectionActions(d, sel, cursor, go) : {}),
    newItem: createIn("drawing"),
    newFolder: createIn("folder"),
    newNote: createIn("note"),
    menu: item ? () => d.menu(item) : undefined,
    // Escape: leave visual mode and clear the selection first, then the tree.
    ...rowMenuActions(item, d),
    // A selection exports as a batch into a chosen folder.
    ...(many && d.exportMany
      ? {
          exportPng: () => d.exportMany?.(many, "png"),
          exportSvg: () => d.exportMany?.(many, "svg"),
        }
      : {}),
    exit: d.dragging
      ? undefined
      : sel.paths.size > 0 || d.visual
      ? () => {
          d.setVisual?.(false);
          d.setSelection?.(EMPTY_SELECTION);
        }
      : d.exit,
  };
}

/** Shift+J/K, X, V, Mod+A and "Clear selection" (F13). */
function selectionActions(
  d: TreeKeyDeps,
  sel: TreeSelection,
  cursor: number,
  go: (i: number, extend?: boolean) => void,
): TreeActions {
  const { rows } = d;
  const set = (next: TreeSelection) => d.setSelection?.(next);
  const here = cursor >= 0 ? rows[cursor]?.entry.path : undefined;
  return {
    extendDown: () => go(cursor < 0 ? 0 : cursor + 1, true),
    extendUp: () => go(cursor < 0 ? rows.length - 1 : cursor - 1, true),
    toggleSelection: here
      ? () => {
          d.setFocusedPath(here);
          set(toggleSelection(sel, here));
        }
      : undefined,
    visual: here
      ? () => {
          if (d.visual) {
            d.setVisual?.(false);
            return;
          }
          d.setFocusedPath(here);
          d.setVisual?.(true);
          set(selectRange(EMPTY_SELECTION, rows, here, here));
        }
      : undefined,
    selectAll: rows.length > 0 ? () => set(selectAll(rows)) : undefined,
    clearSelection:
      sel.paths.size > 0
        ? () => {
            d.setVisual?.(false);
            set(EMPTY_SELECTION);
          }
        : undefined,
  };
}

/** Same conditions as the row menu (VaultNavigator RowMenu). */
function rowMenuActions(
  item: VaultEntry | undefined,
  d: TreeKeyDeps,
): TreeActions {
  const r = d.row;
  if (!item || !r) {
    return {};
  }
  const { path } = item;
  const bind = (fn: ((path: string) => void) | undefined, when = true) =>
    fn && when ? () => fn(path) : undefined;
  const sync = r.sync;
  // Same conditions as the menu's "Compare with original…" and "Download from iCloud".
  const syncActions: TreeActions = sync
    ? {
        ...(item.kind === "drawing" && item.sync === "conflict"
          ? { compareConflict: () => sync(item, "compare") }
          : {}),
        ...(item.sync === "placeholder"
          ? { downloadFromCloud: () => sync(item, "download") }
          : {}),
      }
    : {};
  if (item.kind === "folder") {
    return {
      ...syncActions,
      reveal: bind(r.reveal),
      showAsGrid: bind(r.showAsGrid),
      exportFolder: bind(r.exportFolder),
      ...copyActions(path, r, true),
    };
  }
  // Like the menu: notes and Obsidian drawings get only the shared items (reveal, copy path).
  const drawing = item.kind === "drawing";
  const exportAs = (format: ExplorerExportFormat) =>
    drawing && r.export ? () => r.export?.(path, format) : undefined;
  return {
    // Notes too, as Obsidian's "Make a copy" (toimprove 182).
    duplicate: bind(
      r.duplicate,
      (drawing || item.kind === "note") && !d.readOnly,
    ),
    saveAsTemplate: bind(r.saveAsTemplate, drawing),
    reveal: bind(r.reveal),
    localGraph: bind(r.localGraph, drawing),
    history: bind(r.history, drawing),
    exportPng: exportAs("png"),
    exportSvg: exportAs("svg"),
    exportPdf: exportAs("pdf"),
    saveCopy: exportAs("copy"),
    insertPicture: bind(r.insertPicture, item.kind === "image"),
    ...syncActions,
    ...copyActions(path, r, isAssetKind(item.kind)),
  };
}

/** "Copy path" submenu items: any row; a folder has no link. */
function copyActions(
  path: string,
  r: TreeRowActions,
  folder = false,
): TreeActions {
  const copy = r.copyPath;
  if (!copy) {
    return {};
  }
  return {
    copyPath: () => copy(path, "relative"),
    copyAbsolutePath: () => copy(path, "absolute"),
    ...(folder ? {} : { copyLink: () => copy(path, "link") }),
  };
}

/**
 * A stable ListController over `deps` (a ref updated each render): each
 * getter computes the actions only when the dispatcher or palette asks.
 */
export function lazyTreeController(deps: {
  readonly current: TreeKeyDeps | null;
}): TreeActions {
  const controller: TreeActions = {};
  for (const action of TREE_ACTIONS) {
    Object.defineProperty(controller, action, {
      enumerable: true,
      get: () => (deps.current ? treeActions(deps.current)[action] : undefined),
    });
  }
  return controller;
}
