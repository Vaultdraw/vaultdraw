import { useCallback, useEffect, useRef, useState } from "react";

import { resolveDropFolder } from "../../vault/treeStore";

import type { VaultEntry } from "../../vault/types";

/**
 * Pointer-event drag and drop for the navigator tree.
 *
 * HTML5 drag and drop is not used: in the Tauri window the native drag
 * handler (`dragDropEnabled`, on by default) claims every drag that enters
 * the webview, so WebKit never delivers dragover/drop to the page on macOS
 * (and WebView2 behaves the same on Windows). Pointer events work the same
 * in every webview, give full control over the ghost, auto-scroll and
 * Escape, and leave Excalidraw's own file drop path untouched.
 */

export type DragSource = Pick<VaultEntry, "path" | "name" | "kind">;

export type DropCheck = { allowed: boolean; reason?: string };

export interface TreeDragState {
  source: DragSource;
  /** Folder that would receive the drop ("" = vault root), null = no target. */
  targetFolder: string | null;
  allowed: boolean;
  reason?: string;
  /** Over the drawing (a picture being dragged in): the drop inserts it there. */
  onCanvas?: boolean;
}

interface Options {
  containerRef: React.RefObject<HTMLElement | null>;
  ghostRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  check: (source: DragSource, targetFolder: string) => DropCheck;
  onDrop: (source: DragSource, targetFolder: string) => void;
  isExpanded: (folderPath: string) => boolean;
  onExpandFolder: (folderPath: string) => void;
  /**
   * A row dropped outside the tree, on the drawing (`.vault-editor`): pictures go into the drawing.
   * Absent, or false for this source, keeps such a drop a no-op.
   */
  canDropOnCanvas?: (source: DragSource) => boolean;
  onDropOnCanvas?: (source: DragSource, x: number, y: number) => void;
}

export const DRAG_THRESHOLD = 4;
export const HOVER_EXPAND_MS = 600;
const SCROLL_EDGE = 32;

export const ghostTransform = (x: number, y: number) =>
  `translate(${x + 14}px, ${y + 10}px)`;
const SCROLL_MAX_SPEED = 14;

export function useTreeDrag(options: Options) {
  const [drag, setDrag] = useState<TreeDragState | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cleanupRef = useRef<(() => void) | null>(null);
  /** Last pointer position, so the ghost renders in place on first paint. */
  const pointerRef = useRef({ x: 0, y: 0 });

  // Abort a drag in progress if the tree unmounts.
  useEffect(() => () => cleanupRef.current?.(), []);

  const onRowPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, entry: DragSource) => {
      const opts = optionsRef.current;
      const container = opts.containerRef.current;
      if (
        !opts.enabled ||
        !container ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        cleanupRef.current ||
        (event.target as Element).closest(".vault-tree-item__actions")
      ) {
        return;
      }
      const doc = container.ownerDocument;
      const view = doc.defaultView;
      if (!view) {
        return;
      }
      const win: Window = view;

      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let started = false;
      let lastX = startX;
      let lastY = startY;
      let current: TreeDragState = {
        source: entry,
        targetFolder: null,
        allowed: false,
      };
      let hoverFolder: string | null = null;
      let hoverTimer: number | undefined;
      let scrollFrame: number | undefined;

      const publish = (next: TreeDragState) => {
        if (
          next.targetFolder !== current.targetFolder ||
          next.allowed !== current.allowed ||
          next.reason !== current.reason ||
          next.onCanvas !== current.onCanvas
        ) {
          current = next;
          setDrag(next);
        }
      };

      const placeGhost = () => {
        pointerRef.current = { x: lastX, y: lastY };
        const ghost = optionsRef.current.ghostRef.current;
        if (ghost) {
          ghost.style.transform = ghostTransform(lastX, lastY);
        }
      };

      const setHoverFolder = (folder: string | null) => {
        if (folder === hoverFolder) {
          return;
        }
        hoverFolder = folder;
        win.clearTimeout(hoverTimer);
        hoverTimer = undefined;
        if (folder !== null && !optionsRef.current.isExpanded(folder)) {
          hoverTimer = win.setTimeout(() => {
            if (hoverFolder === folder) {
              optionsRef.current.onExpandFolder(folder);
            }
          }, HOVER_EXPAND_MS);
        }
      };

      const hitTest = () => {
        const tree = optionsRef.current.containerRef.current;
        const el = doc.elementFromPoint(lastX, lastY);
        let folder: string | null = null;
        let hoveredFolderRow: string | null = null;
        if (
          el &&
          !(tree && tree.contains(el)) &&
          el.closest(".vault-editor") &&
          optionsRef.current.canDropOnCanvas?.(entry)
        ) {
          setHoverFolder(null);
          publish({
            source: entry,
            targetFolder: null,
            allowed: true,
            onCanvas: true,
            reason: "Insert into the drawing",
          });
          return;
        }
        if (tree && el && tree.contains(el)) {
          const row = el.closest<HTMLElement>("[data-tree-path]");
          if (row && tree.contains(row)) {
            const path = row.dataset.treePath ?? "";
            const kind =
              row.dataset.treeKind === "folder" ? "folder" : "drawing";
            folder = resolveDropFolder(path, kind);
            if (kind === "folder") {
              hoveredFolderRow = path;
            }
          } else {
            folder = "";
          }
        }
        setHoverFolder(hoveredFolderRow);
        if (folder === null) {
          publish({ source: entry, targetFolder: null, allowed: false });
          return;
        }
        const verdict = optionsRef.current.check(entry, folder);
        publish({
          source: entry,
          targetFolder: folder,
          allowed: verdict.allowed,
          reason: verdict.reason,
        });
      };

      const autoScroll = () => {
        scrollFrame = undefined;
        const tree = optionsRef.current.containerRef.current;
        if (!tree || !started) {
          return;
        }
        const rect = tree.getBoundingClientRect();
        const inside = lastX >= rect.left && lastX <= rect.right;
        let delta = 0;
        if (inside && lastY < rect.top + SCROLL_EDGE) {
          delta = -Math.ceil(
            (SCROLL_MAX_SPEED * (rect.top + SCROLL_EDGE - lastY)) / SCROLL_EDGE,
          );
        } else if (inside && lastY > rect.bottom - SCROLL_EDGE) {
          delta = Math.ceil(
            (SCROLL_MAX_SPEED * (lastY - (rect.bottom - SCROLL_EDGE))) /
              SCROLL_EDGE,
          );
        }
        if (delta !== 0) {
          const before = tree.scrollTop;
          tree.scrollTop =
            before +
            Math.max(-SCROLL_MAX_SPEED, Math.min(SCROLL_MAX_SPEED, delta));
          if (tree.scrollTop !== before) {
            hitTest();
          }
          scrollFrame = win.requestAnimationFrame(autoScroll);
        }
      };

      const start = () => {
        started = true;
        pointerRef.current = { x: lastX, y: lastY };
        doc.body.classList.add("vault-tree-dragging");
        win.getSelection()?.removeAllRanges();
        current = { source: entry, targetFolder: null, allowed: false };
        setDrag(current);
      };

      const finish = () => {
        win.removeEventListener("pointermove", onMove, true);
        win.removeEventListener("pointerup", onUp, true);
        win.removeEventListener("pointercancel", onCancel, true);
        win.removeEventListener("keydown", onKey, true);
        win.removeEventListener("blur", onCancel);
        win.clearTimeout(hoverTimer);
        if (scrollFrame !== undefined) {
          win.cancelAnimationFrame(scrollFrame);
        }
        doc.body.classList.remove("vault-tree-dragging");
        cleanupRef.current = null;
        if (started) {
          setDrag(null);
        }
      };

      // The pointerup that ends a drag must not also click the row under it.
      const swallowNextClick = () => {
        const swallow = (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
        };
        win.addEventListener("click", swallow, true);
        win.setTimeout(
          () => win.removeEventListener("click", swallow, true),
          0,
        );
      };

      function onMove(e: PointerEvent) {
        if (e.pointerId !== pointerId) {
          return;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        if (!started) {
          if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD) {
            return;
          }
          start();
        }
        e.preventDefault();
        placeGhost();
        hitTest();
        if (scrollFrame === undefined) {
          scrollFrame = win.requestAnimationFrame(autoScroll);
        }
      }

      function onUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) {
          return;
        }
        if (!started) {
          finish();
          return;
        }
        lastX = e.clientX;
        lastY = e.clientY;
        hitTest();
        const result = current;
        swallowNextClick();
        finish();
        if (result.allowed && result.onCanvas) {
          optionsRef.current.onDropOnCanvas?.(result.source, lastX, lastY);
        } else if (result.allowed && result.targetFolder !== null) {
          optionsRef.current.onDrop(result.source, result.targetFolder);
        }
      }

      function onCancel() {
        finish();
      }

      function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") {
          const wasDragging = started;
          finish();
          if (wasDragging) {
            e.preventDefault();
            e.stopPropagation();
            // The button is still down: its release must not click the row.
            const drop = () => {
              win.removeEventListener("pointerup", onRelease, true);
              win.removeEventListener("pointerdown", drop, true);
            };
            const onRelease = () => {
              drop();
              swallowNextClick();
            };
            win.addEventListener("pointerup", onRelease, true);
            win.addEventListener("pointerdown", drop, true);
          }
        }
      }

      win.addEventListener("pointermove", onMove, true);
      win.addEventListener("pointerup", onUp, true);
      win.addEventListener("pointercancel", onCancel, true);
      win.addEventListener("keydown", onKey, true);
      win.addEventListener("blur", onCancel);
      cleanupRef.current = finish;
    },
    [],
  );

  return { drag, onRowPointerDown, pointerRef };
}
