/**
 * Zoom and pan of the picture viewer, as pure functions so the rules are unit-tested without a
 * DOM: fit shows the whole picture (never above 100%), zoom keeps the point under the pointer
 * still, and the scale stays between 5% and 3200%.
 */

export interface View {
  scale: number;
  /** Top-left of the picture inside the stage, in CSS pixels. */
  x: number;
  y: number;
  /** True while the view follows the stage size (Fit). */
  fit: boolean;
}

export interface Size {
  w: number;
  h: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;
/** One zoom step (keys and buttons); the wheel uses its own delta. */
export const ZOOM_STEP = 1.25;

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/** The whole picture, centred; small pictures stay at their own size. */
export const fitView = (stage: Size, picture: Size): View => {
  if (picture.w <= 0 || picture.h <= 0 || stage.w <= 0 || stage.h <= 0) {
    return { scale: 1, x: 0, y: 0, fit: true };
  }
  const scale = clamp(Math.min(stage.w / picture.w, stage.h / picture.h, 1));
  return {
    scale,
    x: (stage.w - picture.w * scale) / 2,
    y: (stage.h - picture.h * scale) / 2,
    fit: true,
  };
};

/** Scale by `factor` about the stage point (px, py). */
export const zoomAt = (
  view: View,
  factor: number,
  px: number,
  py: number,
): View => {
  const scale = clamp(view.scale * factor);
  const k = scale / view.scale;
  return {
    scale,
    x: px - (px - view.x) * k,
    y: py - (py - view.y) * k,
    fit: false,
  };
};

/** Scale by `factor` about the stage centre (keys and buttons). */
export const zoomCentre = (view: View, factor: number, stage: Size): View =>
  zoomAt(view, factor, stage.w / 2, stage.h / 2);

/** 100%, centred on the stage point (px, py) of the current view. */
export const actualSizeAt = (view: View, px: number, py: number): View =>
  zoomAt(view, 1 / view.scale, px, py);

export const panBy = (view: View, dx: number, dy: number): View => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
  fit: false,
});

/** The zoom as the toolbar shows it: "37%", "100%", "3200%". */
export const percent = (scale: number): string => `${Math.round(scale * 100)}%`;
