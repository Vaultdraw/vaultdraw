import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Row height at the default interface font size; must match `--vd-row-tall`
 * (`.vault-history-row`). Other sizes pass `uiTallRowHeight(size)`.
 */
export const HISTORY_ROW_HEIGHT = 56;
const OVERSCAN = 6;
/** Used before the list has layout (first paint, jsdom). */
const FALLBACK_VIEWPORT = 600;

export type RowWindow = { start: number; end: number };

/** Rows [start, end) to mount for a scroll position; pure for testing. */
export function computeRowWindow(
  total: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number = HISTORY_ROW_HEIGHT,
): RowWindow {
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewport / rowHeight) + 1;
  const start = Math.min(Math.max(0, first - OVERSCAN), total);
  const end = Math.min(total, first + visible + OVERSCAN);
  return { start: Math.min(start, end), end };
}

/**
 * Mounts only the rows near the scroll position of `ref` (the list's own
 * scroller). State changes when the first visible row or the viewport changes,
 * not on every scroll pixel, so scrolling re-renders a handful of times.
 */
export function useRowWindow(
  ref: RefObject<HTMLElement | null>,
  total: number,
  rowHeight: number = HISTORY_ROW_HEIGHT,
) {
  const [view, setView] = useState({ first: 0, viewport: FALLBACK_VIEWPORT });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const first = Math.floor(el.scrollTop / rowHeight);
    const viewport = el.clientHeight || FALLBACK_VIEWPORT;
    setView((v) =>
      v.first === first && v.viewport === viewport ? v : { first, viewport },
    );
  }, [ref, rowHeight]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref, measure]);

  /** Scrolls so row `index` is fully visible (no-op when it already is). */
  const scrollToRow = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el || index < 0) {
        return;
      }
      const top = index * rowHeight;
      const height = el.clientHeight || FALLBACK_VIEWPORT;
      if (top < el.scrollTop) {
        el.scrollTop = top;
      } else if (top + rowHeight > el.scrollTop + height) {
        el.scrollTop = top + rowHeight - height;
      }
    },
    [ref, rowHeight],
  );

  return {
    ...computeRowWindow(
      total,
      view.first * rowHeight,
      view.viewport,
      rowHeight,
    ),
    scrollToRow,
  };
}
