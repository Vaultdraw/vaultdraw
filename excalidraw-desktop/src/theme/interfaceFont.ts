/**
 * Interface font: `interface.font_size` and `interface.font_family`.
 *
 * The design system (designSystem.css) sizes all UI text with the
 * `--vd-fs-*` tokens and all UI rows and controls with `--vd-row`,
 * `--vd-bar` and `--vd-control*`. A size other than the default writes every
 * one of them, scaled from the default and rounded to whole pixels, inline on
 * <html>; a family writes `--vd-font`. At the defaults nothing is written, so
 * the setting costs nothing until it is used.
 *
 * Drawings (canvas text), exports, thumbnails and the note body never read
 * these tokens: notes keep `--vd-font-default` and their own size setting.
 */
import {
  DEFAULT_UI_FONT_SIZE,
  MAX_UI_FONT_FAMILY_LENGTH,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
} from "../vault/preferences";

/** The default pixel value of every token that follows the size. */
export const UI_SIZE_TOKENS: Readonly<Record<string, number>> = {
  "--vd-fs-kbd": 10,
  "--vd-fs-caption": 11,
  "--vd-fs-small": 12,
  "--vd-fs-body": 13,
  "--vd-fs-emph": 14,
  "--vd-fs-title": 16,
  "--vd-fs-display": 20,
  "--vd-row": 26,
  "--vd-row-tall": 56,
  "--vd-bar": 38,
  "--vd-control": 28,
  "--vd-control-sm": 24,
  "--vd-control-lg": 34,
};

export const UI_FONT_TOKEN = "--vd-font";
export const UI_FONT_SIZE_STEP = 1;

/** A whole size inside the allowed range (bad input gives the default). */
export const clampUiFontSize = (size: number): number => {
  if (!Number.isFinite(size)) {
    return DEFAULT_UI_FONT_SIZE;
  }
  return Math.min(
    MAX_UI_FONT_SIZE,
    Math.max(MIN_UI_FONT_SIZE, Math.round(size)),
  );
};

/** `base` px (a value at the default size) scaled to `size`, whole pixels. */
export const scaleUiPx = (base: number, size: number): number =>
  Math.round((base * clampUiFontSize(size)) / DEFAULT_UI_FONT_SIZE);

/** File tree and tag rows (virtualised: JS and CSS must agree). */
export const uiRowHeight = (size: number) => scaleUiPx(26, size);
/** Version history rows. */
export const uiTallRowHeight = (size: number) => scaleUiPx(56, size);

export type UiFontCommand = "bigger" | "smaller" | "reset";

export const nextUiFontSize = (
  current: number,
  command: UiFontCommand,
): number => {
  if (command === "reset") {
    return DEFAULT_UI_FONT_SIZE;
  }
  const step = command === "bigger" ? UI_FONT_SIZE_STEP : -UI_FONT_SIZE_STEP;
  return clampUiFontSize(clampUiFontSize(current) + step);
};

/** CSS generic families and keywords that must not be quoted. */
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
]);

/**
 * The `--vd-font` value for a configured family, or null for the default.
 * A single name is quoted ("Inter"); a list (with commas or quotes) or a
 * generic family is used as written. The default stack always follows, so a
 * font that isn't installed falls back to the usual UI font.
 */
export const uiFontStack = (family: string): string | null => {
  const value = family.trim().slice(0, MAX_UI_FONT_FAMILY_LENGTH);
  // Characters that could end a declaration or open a block have no place
  // in a font name; drop them rather than refusing the whole value.
  const clean = value.replace(/[;{}<>\\]/g, "").trim();
  if (!clean) {
    return null;
  }
  const isList = /[,"']/.test(clean);
  const head =
    isList || GENERIC.has(clean.toLowerCase()) ? clean : `"${clean}"`;
  return `${head}, var(--vd-font-default)`;
};

/** Every custom property to set (string) or remove (null) for these values. */
export const interfaceFontVars = (
  size: number,
  family: string,
): Record<string, string | null> => {
  const s = clampUiFontSize(size);
  const out: Record<string, string | null> = {};
  for (const [name, base] of Object.entries(UI_SIZE_TOKENS)) {
    out[name] = s === DEFAULT_UI_FONT_SIZE ? null : `${scaleUiPx(base, s)}px`;
  }
  out[UI_FONT_TOKEN] = uiFontStack(family);
  return out;
};

/** Writes (or clears) the interface font tokens on `root`. */
export const applyInterfaceFont = (
  root: HTMLElement,
  size: number,
  family: string,
): void => {
  for (const [name, value] of Object.entries(interfaceFontVars(size, family))) {
    if (value === null) {
      if (root.style.getPropertyValue(name)) {
        root.style.removeProperty(name);
      }
    } else if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  }
};
