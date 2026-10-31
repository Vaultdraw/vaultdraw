/**
 * "Export folder…" and "Export N drawings" (F31, F13): pick PNG or SVG and
 * whether subfolders count, choose the destination folder, then watch the
 * progress with Cancel. A lazy chunk: nothing loads until it opens.
 */
import { useEffect, useRef, useState } from "react";

import { Dialog } from "../../components/Dialog";

import {
  planExport,
  resultSummary,
  runBatchExport,
  type BatchFormat,
  type BatchProgress,
  type BatchResult,
  type BatchSource,
} from "./batchExport";

import type { ExportExistingMode } from "../../components/tree/treeSettings";
import type { ExportFolder, VaultEntry } from "../../vault/types";
import type { ExportWrite } from "./exportTarget";

export type BatchExportDeps = {
  list: (path: string) => Promise<VaultEntry[]>;
  /** Bytes of one drawing; null = empty (nothing to export). */
  render: (
    path: string,
    format: BatchFormat,
  ) => Promise<{ fileName: string; bytes: Uint8Array } | null>;
  pickFolder: () => Promise<ExportFolder | null>;
  write: (
    token: string,
    rel: string,
    bytes: Uint8Array,
    existing: ExportExistingMode,
  ) => Promise<ExportWrite>;
  release: (token: string) => Promise<void>;
  /** navigator.export_existing */
  existing: ExportExistingMode;
};

export type BatchExportRequest = {
  sources: BatchSource[];
  /** "the folder “DSA”", "3 drawings": what is exported, in the title. */
  label: string;
  format?: BatchFormat;
};

type Phase =
  | { kind: "options" }
  | { kind: "running"; folder: string; progress: BatchProgress }
  | { kind: "done"; folder: string; result: BatchResult };

const nameOf = (path: string | null) =>
  path
    ? path.slice(path.lastIndexOf("/") + 1).replace(/\.excalidraw$/i, "")
    : "";

export default function BatchExportDialog({
  request,
  deps,
  onClose,
}: {
  request: BatchExportRequest;
  deps: BatchExportDeps;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<BatchFormat>(request.format ?? "png");
  const [recursive, setRecursive] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "options" });
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const hasFolder = request.sources.some((s) => s.kind === "folder");

  // Closing the dialog (or the app view) stops a running export.
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    setError(null);
    let picked: ExportFolder | null;
    try {
      picked = await deps.pickFolder();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!picked) {
      return; // cancelled the folder picker: stay on the options
    }
    const controller = new AbortController();
    abort.current = controller;
    const folder = picked.path;
    const token = picked.token;
    setPhase({
      kind: "running",
      folder,
      progress: { done: 0, total: 0, current: null },
    });
    try {
      const items = await planExport(
        deps.list,
        request.sources,
        recursive,
        controller.signal,
      );
      const result = await runBatchExport({
        items,
        signal: controller.signal,
        render: (path) => deps.render(path, format),
        write: (rel, bytes, keepBoth) =>
          deps.write(token, rel, bytes, keepBoth ? "keep_both" : deps.existing),
        onProgress: (progress) =>
          setPhase({ kind: "running", folder, progress }),
      });
      setPhase({ kind: "done", folder, result });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ kind: "options" });
    } finally {
      abort.current = null;
      void deps.release(token).catch(() => undefined);
    }
  };

  const cancel = () => abort.current?.abort();
  const running = phase.kind === "running";

  const footer =
    phase.kind === "options" ? (
      <>
        <button type="button" className="vault-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="vault-btn vault-btn--primary"
          onClick={() => void start()}
        >
          Choose folder and export…
        </button>
      </>
    ) : running ? (
      <button type="button" className="vault-btn" onClick={cancel}>
        Stop
      </button>
    ) : (
      <button
        type="button"
        className="vault-btn vault-btn--primary"
        onClick={onClose}
        autoFocus
      >
        Done
      </button>
    );

  return (
    <Dialog
      title={`Export ${request.label}`}
      titleId="batch-export-title"
      testId="batch-export-dialog"
      // Escape or X while running stops the export first, like Stop.
      onClose={running ? cancel : onClose}
      footer={footer}
    >
      {phase.kind === "options" && (
        <div className="vault-field">
          <fieldset className="vd-batch-export__formats">
            <legend>Format</legend>
            {(["png", "svg"] as const).map((f) => (
              <label key={f} className="vd-batch-export__choice">
                <input
                  type="radio"
                  name="batch-export-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </fieldset>
          {hasFolder && (
            <label className="vd-batch-export__choice">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              Include subfolders
            </label>
          )}
          <span className="vd-dialog__hint">
            Each drawing becomes one image, with the same settings as Export
            image. Notes are left out.
          </span>
          {error && <div className="vault-error-text">{error}</div>}
        </div>
      )}
      {phase.kind === "running" && (
        <div className="vault-field" aria-live="polite">
          <progress
            className="vd-batch-export__bar"
            max={Math.max(1, phase.progress.total)}
            value={phase.progress.done}
          />
          <span data-testid="batch-export-progress">
            {phase.progress.total === 0
              ? "Finding drawings…"
              : `${phase.progress.done} of ${phase.progress.total}${
                  phase.progress.current
                    ? `: ${nameOf(phase.progress.current)}`
                    : ""
                }`}
          </span>
        </div>
      )}
      {phase.kind === "done" && (
        <div className="vault-field" data-testid="batch-export-result">
          <p>
            {phase.result.written +
              phase.result.skipped +
              phase.result.empty +
              phase.result.failed.length ===
              0 && !phase.result.cancelled
              ? `No drawings to export in ${request.label}.`
              : resultSummary(phase.result, phase.folder)}
          </p>
          {phase.result.failed.length > 0 && (
            <ul className="vd-batch-export__failed">
              {phase.result.failed.slice(0, 5).map((f) => (
                <li key={f.path}>
                  {nameOf(f.path)}: {f.reason}
                </li>
              ))}
              {phase.result.failed.length > 5 && (
                <li>and {phase.result.failed.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
