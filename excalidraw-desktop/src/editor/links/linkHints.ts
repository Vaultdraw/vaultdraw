/**
 * Canvas link hint mode (Vimium style). Every visible link, shapes with a
 * link and `[[spans]]` in visible text, gets 1-2 letters from
 * `settings.hintChars`; typing them opens the link, Esc or any other key
 * cancels. Nothing is listening until `start()`.
 */
import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { spanRaw } from "../../links/format";
import { DEFAULT_LINKS_SETTINGS } from "../../links/types";

import { targetOf } from "./onLinkOpen";

import { textLinksWithGeometry } from "./textLinkHitTest";

import type { LinkOpenOptions } from "./onLinkOpen";

import type { MeasureFn, TextLike, ViewportState } from "./textLinkHitTest";

export const MAX_HINTS = 400;

export type HintTarget = {
  raw: string;
  elementId: string;
  containerId: string | null;
  /** Viewport coordinates of the badge. */
  x: number;
  y: number;
};
export type Hint = HintTarget & { label: string };

type LinkElement = TextLike & {
  link?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
};

type ViewState = ViewportState & { width: number; height: number };

const sorted = (chars: string) =>
  [...new Set(chars.toLowerCase())].join("") ||
  DEFAULT_LINKS_SETTINGS.hintChars;

/** Uniform-length, prefix-free labels (so a typed prefix is never an exact hit). */
export function assignLabels(count: number, hintChars: string): string[] {
  const chars = [...sorted(hintChars)];
  const n = chars.length;
  let length = 1;
  while (n ** length < count && length < 4) {
    length++;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let label = "";
    let rest = i;
    for (let k = 0; k < length; k++) {
      label = chars[rest % n] + label;
      rest = Math.floor(rest / n);
    }
    out.push(label);
  }
  return out;
}

/** Visible links in reading order, capped at MAX_HINTS. */
export function collectHintTargets(
  elements: readonly LinkElement[],
  state: ViewState,
  measure?: MeasureFn,
): HintTarget[] {
  const zoom = state.zoom.value;
  const left = -state.scrollX;
  const top = -state.scrollY;
  const right = left + state.width / zoom;
  const bottom = top + state.height / zoom;
  const found: (HintTarget & { sx: number; sy: number })[] = [];
  const add = (raw: string, el: LinkElement, sx: number, sy: number) => {
    const p = sceneCoordsToViewportCoords(
      { sceneX: sx, sceneY: sy },
      state as never,
    );
    found.push({
      raw,
      elementId: el.id,
      containerId: el.containerId ?? null,
      x: p.x,
      y: p.y,
      sx,
      sy,
    });
  };
  for (const el of elements) {
    if (
      el.isDeleted ||
      el.x > right ||
      el.x + el.width < left ||
      el.y > bottom ||
      el.y + el.height < top
    ) {
      continue;
    }
    if (el.link && targetOf(el.link)) {
      add(el.link, el, el.x, el.y);
    }
    if (el.type === "text" && el.text.includes("[[")) {
      for (const hit of textLinksWithGeometry(el, measure)) {
        const f = hit.fragments[0];
        if (f) {
          add(spanRaw(hit.span), el, f.x1, f.top);
        }
      }
    }
    if (found.length >= MAX_HINTS) {
      break;
    }
  }
  found.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
  return found.slice(0, MAX_HINTS).map(({ sx: _sx, sy: _sy, ...t }) => t);
}

export type HintsState = { hints: Hint[]; typed: string };

export interface LinkHintsDeps {
  getApi(): ExcalidrawImperativeAPI | null;
  getHintChars(): string;
  openRaw(raw: string, opts?: LinkOpenOptions): boolean;
}

export class LinkHints {
  private current: HintsState | null = null;
  /** Any hint key typed with Shift (Vimium `F`) opens in a new tab. */
  private shifted = false;
  private listeners = new Set<(s: HintsState | null) => void>();

  constructor(private readonly deps: LinkHintsDeps) {}

  get state() {
    return this.current;
  }

  get active() {
    return this.current !== null;
  }

  subscribe(listener: (s: HintsState | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Shows the hints; false (and nothing attached) when no link is visible. */
  start(): boolean {
    this.cancel();
    this.shifted = false;
    const api = this.deps.getApi();
    if (!api) {
      return false;
    }
    const targets = collectHintTargets(
      api.getSceneElements() as unknown as LinkElement[],
      api.getAppState() as unknown as ViewState,
    );
    if (targets.length === 0) {
      return false;
    }
    const labels = assignLabels(targets.length, this.deps.getHintChars());
    this.current = {
      hints: targets.map((t, i) => ({ ...t, label: labels[i] })),
      typed: "",
    };
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("pointerdown", this.cancel, true);
    document.addEventListener("wheel", this.cancel, true);
    this.emit();
    return true;
  }

  cancel = (): void => {
    if (!this.current) {
      return;
    }
    this.current = null;
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("pointerdown", this.cancel, true);
    document.removeEventListener("wheel", this.cancel, true);
    this.emit();
  };

  private onKey = (e: KeyboardEvent) => {
    const s = this.current;
    if (!s || e.isComposing) {
      return;
    }
    if (["Shift", "Control", "Meta", "Alt", "CapsLock"].includes(e.key)) {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
      this.cancel();
      return;
    }
    this.shifted ||= e.shiftKey;
    const typed = s.typed + e.key.toLowerCase();
    const matches = s.hints.filter((h) => h.label.startsWith(typed));
    if (matches.length === 0) {
      this.cancel();
      return;
    }
    const exact = matches.find((h) => h.label === typed);
    if (exact) {
      this.cancel();
      this.deps.openRaw(exact.raw, {
        target: this.shifted ? "new" : "current",
      });
      return;
    }
    this.current = { ...s, typed };
    this.emit();
  };

  private emit() {
    for (const l of [...this.listeners]) {
      l(this.current);
    }
  }
}
