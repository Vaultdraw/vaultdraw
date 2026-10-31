/**
 * Export many drawings into one folder (F31 "Export folder…" and the
 * multi-select export, F13). Plans which drawings go where, then renders and
 * writes them one at a time, yielding between drawings so the app stays
 * responsive and Cancel takes effect between files. Rendering uses the same
 * path as the single export (renderExport); the bytes go to the native writer.
 *
 * Loaded only when an export to a folder starts (a lazy chunk).
 */
import type { VaultEntry } from "../../vault/types";
import type { ExportWrite } from "./exportTarget";

export type BatchFormat = "png" | "svg";

/** One drawing to export and the folder (relative to the chosen one) it lands in. */
export type BatchItem = { path: string; dir: string };

export type BatchSource = Pick<VaultEntry, "path" | "kind">;

type List = (path: string) => Promise<VaultEntry[]>;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Drawings in `folder` (and its subfolders when `recursive`), with their output folder under `dir`. */
export async function collectDrawings(
  list: List,
  folder: string,
  recursive: boolean,
  dir: string,
  signal?: AbortSignal,
): Promise<BatchItem[]> {
  const out: BatchItem[] = [];
  const walk = async (path: string, outDir: string) => {
    if (signal?.aborted) {
      return;
    }
    const entries = await list(path);
    const sorted = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    for (const e of sorted) {
      if (e.kind === "drawing") {
        out.push({ path: e.path, dir: outDir });
      }
    }
    if (recursive) {
      for (const e of sorted) {
        if (e.kind === "folder") {
          await walk(e.path, join(outDir, e.name));
        }
      }
    }
  };
  await walk(folder, dir);
  return out;
}

/**
 * The drawings a batch exports. One folder: its drawings land at the top of
 * the chosen folder, subfolders mirrored. A selection: each drawing at the
 * top, each folder as a subfolder of that name. Notes are not images: skipped.
 */
export async function planExport(
  list: List,
  sources: readonly BatchSource[],
  recursive: boolean,
  signal?: AbortSignal,
): Promise<BatchItem[]> {
  if (sources.length === 1 && sources[0].kind === "folder") {
    return collectDrawings(list, sources[0].path, recursive, "", signal);
  }
  const items: BatchItem[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (s.kind === "drawing") {
      items.push({ path: s.path, dir: "" });
    } else if (s.kind === "folder") {
      items.push(
        ...(await collectDrawings(
          list,
          s.path,
          recursive,
          baseName(s.path),
          signal,
        )),
      );
    }
  }
  // A drawing selected on its own and inside a selected folder: once.
  return items.filter((i) => !seen.has(i.path) && seen.add(i.path));
}

export type BatchProgress = {
  done: number;
  total: number;
  /** The drawing being exported now (vault path). */
  current: string | null;
};

export type BatchResult = {
  written: number;
  /** A file of that name was there and the rule is skip. */
  skipped: number;
  /** Drawings with nothing to export. */
  empty: number;
  failed: { path: string; reason: string }[];
  cancelled: boolean;
};

export async function runBatchExport(input: {
  items: readonly BatchItem[];
  /** Image bytes and file name of a drawing; null = nothing drawn (empty). */
  render: (
    path: string,
  ) => Promise<{ fileName: string; bytes: Uint8Array } | null>;
  /** Writes into the chosen folder; `force` keeps both copies whatever the rule. */
  write: (
    rel: string,
    bytes: Uint8Array,
    keepBoth: boolean,
  ) => Promise<ExportWrite>;
  signal: AbortSignal;
  onProgress: (p: BatchProgress) => void;
  /** Lets the page paint and handle input between drawings. */
  pause?: () => Promise<void>;
}): Promise<BatchResult> {
  const { items, signal } = input;
  const pause =
    input.pause ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const result: BatchResult = {
    written: 0,
    skipped: 0,
    empty: 0,
    failed: [],
    cancelled: false,
  };
  // Two drawings with one name in a batch both land (the second gets a number).
  const writtenNow = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) {
      result.cancelled = true;
      break;
    }
    const item = items[i];
    input.onProgress({ done: i, total: items.length, current: item.path });
    await pause();
    if (signal.aborted) {
      result.cancelled = true;
      break;
    }
    try {
      const out = await input.render(item.path);
      if (!out) {
        result.empty++;
        continue;
      }
      const rel = join(item.dir, out.fileName);
      const w = await input.write(rel, out.bytes, writtenNow.has(rel));
      writtenNow.add(rel);
      writtenNow.add(w.path);
      if (w.status === "written") {
        result.written++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.failed.push({
        path: item.path,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  input.onProgress({
    done: result.cancelled
      ? result.written + result.skipped + result.empty + result.failed.length
      : items.length,
    total: items.length,
    current: null,
  });
  return result;
}

/** "Exported 12 drawings", "2 skipped (already there)", ... in plain words. */
export function resultSummary(r: BatchResult, folder: string): string {
  const n = (k: number, one: string, many: string) =>
    `${k} ${k === 1 ? one : many}`;
  const parts = [
    `${r.cancelled ? "Cancelled after exporting" : "Exported"} ${n(
      r.written,
      "drawing",
      "drawings",
    )} to ${folder}.`,
  ];
  if (r.skipped > 0) {
    parts.push(
      `${n(r.skipped, "file was", "files were")} already there and kept.`,
    );
  }
  if (r.empty > 0) {
    parts.push(
      `${n(r.empty, "empty drawing was", "empty drawings were")} left out.`,
    );
  }
  if (r.failed.length > 0) {
    parts.push(
      `${n(r.failed.length, "drawing", "drawings")} could not be exported.`,
    );
  }
  return parts.join(" ");
}
