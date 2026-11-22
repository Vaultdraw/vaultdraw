import { PluginApiError } from "./rules";

import type { RenderPngOptions } from "@vaultdraw/api";

export const RENDER_MAX_SIDE_DEFAULT = 768;
export const RENDER_MAX_SIDE_MIN = 64;
export const RENDER_MAX_SIDE_MAX = 2048;
export const RENDER_PADDING_DEFAULT = 16;
export const RENDER_PADDING_MAX = 200;

export interface CheckedRenderOptions {
  ids?: readonly string[];
  box?: { x: number; y: number; width: number; height: number };
  maxSide: number;
  padding: number;
}

const bad = (what: string): never => {
  throw new PluginApiError("INVALID_ARGUMENT", `scene.renderPng: ${what}`);
};

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/** Validates `ctx.scene.renderPng` options and fills the defaults. Shared by the app and the test mock. */
export function checkRenderOptions(
  input: RenderPngOptions | undefined,
): CheckedRenderOptions {
  const o: Partial<RenderPngOptions> = input ?? {};
  if (typeof o !== "object") {
    bad("options must be an object");
  }
  for (const key of Object.keys(o)) {
    if (!["ids", "box", "maxSide", "padding"].includes(key)) {
      bad(`unknown option "${key}"`);
    }
  }
  const maxSide = o.maxSide ?? RENDER_MAX_SIDE_DEFAULT;
  if (
    !finite(maxSide) ||
    maxSide < RENDER_MAX_SIDE_MIN ||
    maxSide > RENDER_MAX_SIDE_MAX
  ) {
    bad(
      `maxSide must be a number from ${RENDER_MAX_SIDE_MIN} to ${RENDER_MAX_SIDE_MAX}`,
    );
  }
  const padding = o.padding ?? RENDER_PADDING_DEFAULT;
  if (!finite(padding) || padding < 0 || padding > RENDER_PADDING_MAX) {
    bad(`padding must be a number from 0 to ${RENDER_PADDING_MAX}`);
  }
  let ids: readonly string[] | undefined;
  if (o.ids !== undefined) {
    if (
      !Array.isArray(o.ids) ||
      o.ids.length === 0 ||
      o.ids.some((id) => typeof id !== "string")
    ) {
      bad("ids must be a non-empty list of element ids");
    }
    ids = o.ids;
  }
  let box: CheckedRenderOptions["box"];
  if (o.box !== undefined) {
    const b = o.box;
    if (
      !b ||
      !finite(b.x) ||
      !finite(b.y) ||
      !finite(b.width) ||
      !finite(b.height) ||
      b.width <= 0 ||
      b.height <= 0
    ) {
      bad("box needs finite x, y and a positive width and height");
    }
    box = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return { ids, box: ids ? undefined : box, maxSide, padding };
}

/** Pixel size of a picture of a `width` x `height` scene area: longest side at most `maxSide`, never enlarged. */
export function fitRenderSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, maxSide / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
