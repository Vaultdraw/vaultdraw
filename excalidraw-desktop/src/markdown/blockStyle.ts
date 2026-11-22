/**
 * How a Markdown block box is styled: heading sizes, the remembered body size,
 * fonts, role data and where the next box goes. Shared by typing
 * (markdownTyping.ts) and converting text already on the canvas
 * (convertExisting.ts), so both give the same result.
 */
import { boldFontOf, regularFontOf } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { DEFAULT_HEADING_SCALES } from "./lineRules";
import { headingLevelOf, roleOf, withRole } from "./roles";

import type { MarkdownTypingSettings } from "./markdownTyping";

/** customData key: the font a box had before its marks made it bold or code (toimprove 282). */
export const MARK_FONT = "markFont";

export const scaleOf = (settings: MarkdownTypingSettings, level: number) => {
  const s = settings.headingScales[level - 1];
  return typeof s === "number" && s > 0 ? s : 1;
};

/** The Markdown import's heading steps (`HEADING_SCALE` in its layout/fonts.ts) and its data key. */
const IMPORT_HEADING_SCALE = [1.8, 1.6, 1.4, 1.25, 1.125, 1];
const IMPORT_DATA_KEYS = ["plugins.markdown-import"];

/**
 * The body text size of a box. A heading remembers the size it was made from (`bodySize` in its
 * custom data), so changing `markdown.h1_size` later does not change what Enter or Backspace gives.
 * A heading without it (an imported one, drawn at the default scale) is divided by the default scale.
 */
export const bodySizeOf = (el: ExcalidrawTextElement) => {
  const level = headingLevelOf(roleOf(el));
  if (!level) {
    return el.fontSize;
  }
  const stored = el.customData?.bodySize;
  if (typeof stored === "number" && stored > 0) {
    return stored;
  }
  // No remembered size: a heading from an import made before it stored one was drawn with the
  // import's own steps; a typed one, with the typing defaults.
  const fromImport = IMPORT_DATA_KEYS.some(
    (k) => (el.customData?.[k] as { heading?: unknown } | undefined)?.heading,
  );
  return (
    el.fontSize /
    (fromImport
      ? IMPORT_HEADING_SCALE[level - 1]
      : DEFAULT_HEADING_SCALES[level - 1])
  );
};

/** `withRole` plus the remembered body size of a heading (dropped for any other role). */
export const withRoleAndBody = (
  customData: Record<string, unknown> | undefined,
  role: string | null,
  base: string | undefined,
  bodySize: number,
) => {
  const next = withRole(customData, role, base);
  const { bodySize: _old, ...rest } = next ?? {};
  const out = headingLevelOf(role) ? { ...rest, bodySize } : rest;
  return Object.keys(out).length ? out : undefined;
};

/** The font a box with `role` is drawn in: headings in the bold variant, everything else regular. */
export const fontFor = (
  fontFamily: number,
  role: string | null,
  settings: MarkdownTypingSettings,
) =>
  headingLevelOf(role) && settings.headingBold
    ? boldFontOf(fontFamily)
    : regularFontOf(fontFamily);

/** Where a box placed right below `el` starts (top-left for its alignment). */
export const belowAnchor = (
  el: ExcalidrawTextElement,
  bodySize: number,
  settings: MarkdownTypingSettings,
) => {
  const x =
    el.textAlign === "center"
      ? el.x + el.width / 2
      : el.textAlign === "right"
      ? el.x + el.width
      : el.x;
  const gap = settings.blockGap * bodySize * el.lineHeight;
  return { x, y: el.y + el.height + gap };
};
