/**
 * Multi-select in the file tree (F13), like Zed's project panel and
 * Obsidian's file explorer: Cmd/Ctrl+click toggles a row, Shift+click and
 * Shift+arrows select a range from the anchor, Escape clears.
 *
 * Pure and immutable: VaultNavigator keeps one TreeSelection in state. An
 * empty selection is the shared EMPTY_SELECTION, so the tree pays nothing
 * (no Set, no re-render of rows) until the user selects something.
 */
import type { VaultEntry } from "../../vault/types";

export interface TreeSelection {
  /** Selected paths, in the order they were added. */
  readonly paths: ReadonlySet<string>;
  /** Where a Shift range starts: the last row clicked or toggled. */
  readonly anchor: string | null;
}

export const EMPTY_SELECTION: TreeSelection = {
  paths: new Set(),
  anchor: null,
};

type Row = { entry: Pick<VaultEntry, "path"> };

export const isSelected = (sel: TreeSelection, path: string) =>
  sel.paths.has(path);

/** Cmd/Ctrl+click: add or remove one row; it becomes the anchor. */
export function toggleSelection(
  sel: TreeSelection,
  path: string,
): TreeSelection {
  const paths = new Set(sel.paths);
  if (paths.has(path)) {
    paths.delete(path);
  } else {
    paths.add(path);
  }
  return paths.size === 0 ? EMPTY_SELECTION : { paths, anchor: path };
}

/**
 * Shift+click or Shift+arrow: the visible rows from the anchor (else
 * `fallbackAnchor`, the focused row) to `path`, replacing the selection as
 * Zed and Obsidian do. The anchor stays put so the range can grow or shrink.
 */
export function selectRange(
  sel: TreeSelection,
  rows: readonly Row[],
  path: string,
  fallbackAnchor: string | null,
): TreeSelection {
  const anchor = sel.anchor ?? fallbackAnchor ?? path;
  const indexOf = (p: string) => rows.findIndex((r) => r.entry.path === p);
  const to = indexOf(path);
  // The anchor may have scrolled into a closed folder: start from the target.
  const from = indexOf(anchor) < 0 ? to : indexOf(anchor);
  if (to < 0) {
    return sel;
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const paths = new Set(rows.slice(lo, hi + 1).map((r) => r.entry.path));
  return { paths, anchor: indexOf(anchor) < 0 ? path : anchor };
}

/** Every visible row (Mod+A in the tree). */
export function selectAll(rows: readonly Row[]): TreeSelection {
  if (rows.length === 0) {
    return EMPTY_SELECTION;
  }
  return {
    paths: new Set(rows.map((r) => r.entry.path)),
    anchor: rows[0].entry.path,
  };
}

/**
 * Drops paths that no longer exist (trashed, moved or renamed elsewhere).
 * Returns `sel` itself when nothing changed, so React skips the update.
 */
export function pruneSelection(
  sel: TreeSelection,
  exists: (path: string) => boolean,
): TreeSelection {
  if (sel.paths.size === 0) {
    return sel;
  }
  const kept = [...sel.paths].filter(exists);
  if (kept.length === sel.paths.size) {
    return sel;
  }
  if (kept.length === 0) {
    return EMPTY_SELECTION;
  }
  return {
    paths: new Set(kept),
    anchor: sel.anchor && exists(sel.anchor) ? sel.anchor : kept[0],
  };
}

/**
 * The paths a bulk move, trash or export acts on: a folder takes everything
 * inside it, so selected descendants of a selected folder are dropped (moving
 * both would fail on the second). Sorted, parents first.
 */
export function topLevelPaths(paths: Iterable<string>): string[] {
  const sorted = [...new Set(paths)].sort();
  const out: string[] = [];
  for (const path of sorted) {
    if (!out.some((p) => path.startsWith(`${p}/`))) {
      out.push(path);
    }
  }
  return out;
}

/**
 * What an action from a row (menu, drag, key) acts on: the whole selection
 * when the row is part of a selection of two or more, else the row alone
 * (right-clicking an unselected row in Zed and Obsidian acts on that row).
 */
export function actionTargets(sel: TreeSelection, path: string): string[] {
  return sel.paths.size > 1 && sel.paths.has(path)
    ? topLevelPaths(sel.paths)
    : [path];
}

/** "3 items", "1 drawing", "2 folders": plain words for dialogs and menus. */
export function countLabel(
  entries: readonly Pick<VaultEntry, "kind">[],
): string {
  const n = entries.length;
  const kinds = new Set(
    entries.map((e) => (e.kind === "excalidrawMd" ? "drawing" : e.kind)),
  );
  if (kinds.size === 1) {
    const kind = [...kinds][0];
    const word =
      kind === "folder" ? "folder" : kind === "note" ? "note" : "drawing";
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }
  return `${n} item${n === 1 ? "" : "s"}`;
}
