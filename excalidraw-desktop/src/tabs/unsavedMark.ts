/**
 * When to show that a drawing has unsaved edits (toimprove 347, Zed-style).
 *
 * With autosave writing within a couple of seconds, "unsaved" is a moment that
 * passes on its own: showing it would blink on every pause while typing. So the
 * mark shows only when edits really stay unsaved: autosave off (0, save with the
 * command) or a slow autosave. Save errors and conflicts always show (elsewhere).
 */
export const AUTOSAVE_KEEPS_UP_MS = 2000;

export type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

/** True when autosave saves soon enough that "unsaved" needs no mark. */
export const autosaveKeepsUp = (autosaveDelayMs: number): boolean =>
  autosaveDelayMs > 0 && autosaveDelayMs <= AUTOSAVE_KEEPS_UP_MS;

/** Whether the unsaved mark (tab dot, header "Unsaved") should show. */
export const showUnsavedMark = (
  status: SaveState,
  autosaveDelayMs: number,
): boolean =>
  (status === "dirty" || status === "saving") &&
  !autosaveKeepsUp(autosaveDelayMs);

/** The status the tab strip draws: dirty only when the mark should show. */
export const tabStatusFor = (
  status: SaveState,
  autosaveDelayMs: number,
): "saved" | "dirty" | "conflict" | "error" => {
  if (status === "conflict" || status === "error") {
    return status;
  }
  return showUnsavedMark(status, autosaveDelayMs) ? "dirty" : "saved";
};
