/**
 * Modifier+click opens links (text `[[spans]]` and shapes with a link).
 * While the configured modifier is NOT held nothing but three tiny
 * listeners (keydown, keyup, blur) exists. While it is held: one
 * pointermove (rAF-throttled hit test, underline + pointer cursor) and one
 * capture pointerdown (open instead of selecting). Both go on key-up/blur.
 */
import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { spanRaw } from "../../links/format";

import { clientToScene, hitTestTextLink, shapeLinkAt } from "./textLinkHitTest";

import type { OpenModifier } from "../../links/types";
import type { OpenTarget } from "../../tabs/types";
import type { LinkOpenOptions } from "./onLinkOpen";
import type { LinkFragment, TextLike, TextLinkHit } from "./textLinkHitTest";

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** `event.key` values that are the modifier itself. */
export function modifierKeys(modifier: OpenModifier, mac = isMac()): string[] {
  switch (modifier) {
    case "alt":
      return ["Alt"];
    case "ctrl":
      return ["Control"];
    case "shift":
      return ["Shift"];
    default:
      return [mac ? "Meta" : "Control"];
  }
}

type ModifierState = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export function isModifierHeld(
  e: ModifierState,
  modifier: OpenModifier,
  mac = isMac(),
): boolean {
  switch (modifier) {
    case "alt":
      return e.altKey;
    case "ctrl":
      return e.ctrlKey;
    case "shift":
      return e.shiftKey;
    default:
      return mac ? e.metaKey : e.ctrlKey;
  }
}

/**
 * Where a link gesture opens: middle click -> new tab; the open modifier plus
 * Shift -> new tab (unless Shift is itself the open modifier); else current.
 */
export function linkOpenTarget(
  e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  modifier: OpenModifier,
  mac = isMac(),
): OpenTarget {
  if (e.button === 1) {
    return "new";
  }
  return modifier !== "shift" && e.shiftKey && isModifierHeld(e, modifier, mac)
    ? "new"
    : "current";
}

/** One underline segment in viewport coordinates. */
export type UnderlineRect = {
  left: number;
  top: number;
  width: number;
  /** Radians, about the left end. */
  angle: number;
};

export type HoverState = { rects: UnderlineRect[] };

type ViewState = Parameters<typeof clientToScene>[1];

export function underlineRects(
  fragments: readonly LinkFragment[],
  element: Pick<TextLike, "x" | "y" | "width" | "height" | "angle">,
  state: ViewState,
): UnderlineRect[] {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return fragments.map((f) => {
    const dx = f.x1 - cx;
    const dy = f.bottom - cy;
    const p = sceneCoordsToViewportCoords(
      {
        sceneX: cx + dx * cos - dy * sin,
        sceneY: cy + dx * sin + dy * cos,
      },
      state as never,
    );
    return {
      left: p.x,
      top: p.y,
      width: (f.x2 - f.x1) * state.zoom.value,
      angle: element.angle,
    };
  });
}

export interface ModifierLinksDeps {
  container: HTMLElement;
  getApi(): ExcalidrawImperativeAPI | null;
  getModifier(): OpenModifier;
  /** Opens a link value (`[[x]]`, url...); false when it is not a vault link. */
  openRaw(raw: string, opts?: LinkOpenOptions): boolean;
}

type Target = { raw: string; hit: TextLinkHit | null };

export class ModifierLinks {
  private armed = false;
  private hover: HoverState | null = null;
  private listeners = new Set<(h: HoverState | null) => void>();
  private frame = 0;
  private lastMove: PointerEvent | null = null;

  constructor(private readonly deps: ModifierLinksDeps) {}

  get state() {
    return this.hover;
  }

  subscribe(listener: (h: HoverState | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    // Middle click opens a link in a new tab; ignores every other button.
    this.deps.container.addEventListener("pointerdown", this.onDown, true);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.disarm);
  }

  stop(): void {
    this.deps.container.removeEventListener("pointerdown", this.onDown, true);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.disarm);
    this.disarm();
  }

  /** True while the pointer listeners are attached (tests, diagnostics). */
  get isArmed() {
    return this.armed;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.armed && modifierKeys(this.deps.getModifier()).includes(e.key)) {
      this.arm();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.armed && modifierKeys(this.deps.getModifier()).includes(e.key)) {
      this.disarm();
    }
  };

  private arm() {
    this.armed = true;
    const c = this.deps.container;
    c.addEventListener("pointermove", this.onMove, { passive: true });
  }

  private disarm = () => {
    if (!this.armed) {
      return;
    }
    this.armed = false;
    const c = this.deps.container;
    c.removeEventListener("pointermove", this.onMove);
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.lastMove = null;
    this.setHover(null);
  };

  private onMove = (e: PointerEvent) => {
    if (!isModifierHeld(e, this.deps.getModifier())) {
      this.disarm();
      return;
    }
    this.lastMove = e;
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.lastMove) {
          this.updateHover(this.lastMove);
        }
      });
    }
  };

  private onDown = (e: PointerEvent) => {
    const modifier = this.deps.getModifier();
    const middle = e.button === 1;
    if (!middle && (e.button !== 0 || !isModifierHeld(e, modifier))) {
      return;
    }
    const target = this.targetAt(e);
    if (
      target &&
      this.deps.openRaw(target.raw, { target: linkOpenTarget(e, modifier) })
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** The link under a pointer event, or null. */
  targetAt(e: { clientX: number; clientY: number }): Target | null {
    const api = this.deps.getApi();
    if (!api) {
      return null;
    }
    const state = api.getAppState();
    const point = clientToScene(e, state as never);
    const elements = api.getSceneElements() as unknown as (TextLike & {
      link?: string | null;
    })[];
    const hit = hitTestTextLink(elements, point);
    if (hit) {
      return { raw: spanRaw(hit.span), hit };
    }
    const shape = shapeLinkAt(elements, point);
    return shape?.link ? { raw: shape.link, hit: null } : null;
  }

  private updateHover(e: PointerEvent) {
    const target = this.targetAt(e);
    this.deps.container.classList.toggle("vault-link-pointer", !!target);
    if (!target?.hit) {
      this.setHover(null);
      return;
    }
    const state = this.deps.getApi()!.getAppState() as unknown as ViewState;
    this.setHover({
      rects: underlineRects(target.hit.fragments, target.hit.element, state),
    });
  }

  private setHover(next: HoverState | null) {
    if (!next) {
      this.deps.container.classList.remove("vault-link-pointer");
    }
    if (next === null && this.hover === null) {
      return;
    }
    this.hover = next;
    for (const l of [...this.listeners]) {
      l(next);
    }
  }
}
