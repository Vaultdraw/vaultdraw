/**
 * Click a ☐ / ☑ box on the canvas to tick it (Obsidian's clickable task
 * checkbox; toimprove 369). A press on a task line's box, while no text is
 * being edited, flips that line's box in the text and nothing else happens
 * (no selection, no drag). Works with the Markdown mode off too: it only
 * flips boxes that are already there. One undo step per click.
 */
import { getFontString } from "@excalidraw/common";

import { listItemOf, TASK_BOX_SCALE, toggledTask } from "./lineRules";

/** The parts of a text element the hit test reads. */
export type TaskText = {
  x: number;
  y: number;
  width: number;
  angle: number;
  fontSize: number;
  lineHeight: number;
  textAlign: string;
  /** The text as drawn (wrapped lines). */
  text: string;
  /** The text as written (what is saved and edited). */
  originalText: string;
};

/** Width of `s` in the element's font (scene units). */
export type Measure = (s: string) => number;

/** Extra room around the box, as a share of the font size, so a near miss still ticks. */
const SLACK = 0.25;

const isTaskLine = (line: string) => toggledTask(line) !== null;

/**
 * `originalText` with the box under (sceneX, sceneY) flipped, or null when
 * the point is not on a box.
 */
export function taskClickAt(
  el: TaskText,
  sceneX: number,
  sceneY: number,
  measure: Measure,
): string | null {
  if (el.angle !== 0) {
    return null;
  }
  const lineH = el.fontSize * el.lineHeight;
  const drawn = el.text.split("\n");
  const row = Math.floor((sceneY - el.y) / lineH);
  if (row < 0 || row >= drawn.length) {
    return null;
  }
  const line = drawn[row];
  const item = listItemOf(line);
  if (!item || !isTaskLine(line)) {
    return null;
  }
  const lineWidth = measure(line);
  const left =
    el.textAlign === "center"
      ? el.x + (el.width - lineWidth) / 2
      : el.textAlign === "right"
      ? el.x + el.width - lineWidth
      : el.x;
  const boxStart = left + measure(line.slice(0, item.length - 2));
  // the box may be drawn larger (Markdown mode): count it at its drawn size
  const boxEnd =
    boxStart +
    (measure(line.slice(0, item.length - 1)) -
      measure(line.slice(0, item.length - 2))) *
      TASK_BOX_SCALE;
  const slack = el.fontSize * SLACK;
  if (sceneX < boxStart - slack || sceneX > boxEnd + slack) {
    return null;
  }
  // The n-th task line as drawn is the n-th task line as written (wrapping
  // only splits a line's text, never moves its box).
  const nth = drawn.slice(0, row).filter(isTaskLine).length;
  const written = el.originalText.split("\n");
  let seen = 0;
  for (let i = 0; i < written.length; i++) {
    if (isTaskLine(written[i])) {
      if (seen === nth) {
        written[i] = toggledTask(written[i])!;
        return written.join("\n");
      }
      seen++;
    }
  }
  return null;
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** A measure in the element's own font (a shared off-screen canvas). */
export function canvasMeasure(el: {
  fontSize: number;
  fontFamily: number;
}): Measure {
  ctx ??= document.createElement("canvas").getContext("2d");
  const font = getFontString(el as Parameters<typeof getFontString>[0]);
  return (s) => {
    if (!ctx) {
      return s.length * el.fontSize * 0.6;
    }
    ctx.font = font;
    return ctx.measureText(s).width;
  };
}
