/** Width rules for a resizable plugin side panel (pure, so they are unit tested). */
export const PANEL_DEFAULT_WIDTH = 320;
export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_FRACTION = 0.6;
export const PANEL_KEY_STEP = 16;
/** The drawing always keeps this much room beside a docked panel (the file list overlay's rule too). */
export const DRAWING_MIN_WIDTH = 320;
/** The panel's own 1 px border, so the drawing is never one pixel short. */
const EDGE = 2;
/** The activity bar's width, which the drawing also shares the window with. */
export const ACTIVITY_BAR_WIDTH = 36;

/**
 * Keeps a width between the minimum and 60% of the window, and leaves the drawing at least
 * `DRAWING_MIN_WIDTH` (the minimum wins in a tiny window).
 */
export const clampPanelWidth = (
  value: number,
  windowWidth: number,
  /** The row's width left after the other docked parts (file list, activity bar), when measured. */
  room?: number,
): number => {
  const max = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(
      Math.floor(windowWidth * PANEL_MAX_FRACTION),
      (room ?? windowWidth - ACTIVITY_BAR_WIDTH) - DRAWING_MIN_WIDTH - EDGE,
    ),
  );
  const v = Number.isFinite(value) && value > 0 ? value : PANEL_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, v)));
};

/** The width to show: the saved one clamped, or the default when nothing is saved. */
export const savedPanelWidth = (
  widths: Readonly<Record<string, number>>,
  id: string,
  windowWidth: number,
): number => clampPanelWidth(widths[id] ?? PANEL_DEFAULT_WIDTH, windowWidth);

/** The preferences patch after a resize; a width equal to the default removes the entry. */
export const withPanelWidth = (
  widths: Readonly<Record<string, number>>,
  id: string,
  width: number,
): Record<string, number> => {
  const next = { ...widths };
  if (width === PANEL_DEFAULT_WIDTH) {
    delete next[id];
  } else {
    next[id] = width;
  }
  return next;
};

/** Drag math: the panel is on the right, so dragging left (smaller x) widens it. */
export const dragPanelWidth = (
  startWidth: number,
  startX: number,
  x: number,
  windowWidth: number,
): number => clampPanelWidth(startWidth + (startX - x), windowWidth);

/** Left widens (the handle is on the left edge), Right narrows; Home resets. null = not our key. */
export const keyPanelWidth = (
  key: string,
  width: number,
  windowWidth: number,
): number | null => {
  if (key === "ArrowLeft") {
    return clampPanelWidth(width + PANEL_KEY_STEP, windowWidth);
  }
  if (key === "ArrowRight") {
    return clampPanelWidth(width - PANEL_KEY_STEP, windowWidth);
  }
  if (key === "Home") {
    return PANEL_DEFAULT_WIDTH;
  }
  return null;
};

/** A docked panel fits only when the drawing keeps its room beside at least the narrowest panel. */
export const panelFits = (room: number): boolean =>
  room - DRAWING_MIN_WIDTH - EDGE >= PANEL_MIN_WIDTH;
