/**
 * `ctx.scene.renderPng`: the open drawing (or some elements of it) as a small PNG data URL, for a
 * model to look at. Read only. The editor is imported when the first picture is asked for, and the
 * canvas is released at once, so nothing costs anything until used.
 */
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  fitRenderSize,
  type CheckedRenderOptions,
} from "../../../sdk/api/shared/renderRules";
import { PluginApiError } from "../../../sdk/api/shared/rules";
import { withStandardColors } from "../thumbnails/standardColors";

import type { ActiveScene } from "./sceneBus";

export interface RenderedPng {
  dataUrl: string;
  width: number;
  height: number;
}

const touches = (
  el: ExcalidrawElement,
  box: NonNullable<CheckedRenderOptions["box"]>,
): boolean => {
  const [x1, y1, x2, y2] = getCommonBounds([el]);
  return (
    x2 >= box.x &&
    x1 <= box.x + box.width &&
    y2 >= box.y &&
    y1 <= box.y + box.height
  );
};

/** The elements a request draws: by ids (plus the text bound to them), by box, or all. Throws NOT_FOUND when none. */
export function pickElements<T extends ExcalidrawElement>(
  all: readonly T[],
  options: CheckedRenderOptions,
): T[] {
  let picked: T[];
  if (options.ids) {
    const want = new Set(options.ids);
    const known = new Set(all.map((e) => e.id));
    const missing = options.ids.filter((id) => !known.has(id));
    if (missing.length) {
      throw new PluginApiError(
        "NOT_FOUND",
        `scene.renderPng: no element with id ${missing.slice(0, 3).join(", ")}`,
      );
    }
    picked = all.filter(
      (e) =>
        want.has(e.id) ||
        ("containerId" in e &&
          e.containerId != null &&
          want.has(e.containerId)),
    );
  } else if (options.box) {
    const box = options.box;
    picked = all.filter((e) => touches(e, box));
  } else {
    picked = [...all];
  }
  if (picked.length === 0) {
    throw new PluginApiError("NOT_FOUND", "scene.renderPng: nothing to draw");
  }
  return picked;
}

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

export async function renderScenePng(
  scene: ActiveScene,
  options: CheckedRenderOptions,
): Promise<RenderedPng> {
  const elements = pickElements(scene.api.getSceneElements(), options);
  const state = scene.api.getAppState();
  const { exportToCanvas } = await import("@excalidraw/excalidraw");
  return withStandardColors(async () => {
    let size = { width: 1, height: 1 };
    const canvas = await exportToCanvas({
      elements,
      appState: {
        ...state,
        exportBackground: true,
        exportWithDarkMode: false,
        exportScale: 1,
      },
      files: scene.api.getFiles(),
      exportPadding: options.padding,
      getDimensions: (width: number, height: number) => {
        const fit = fitRenderSize(width, height, options.maxSide);
        size = { width: fit.width, height: fit.height };
        return { width: fit.width, height: fit.height, scale: fit.scale };
      },
    });
    const dataUrl = canvas.toDataURL("image/png");
    releaseCanvas(canvas);
    return { dataUrl, ...size };
  });
}
