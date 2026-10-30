/**
 * Maps vault tokens onto Excalidraw's own UI CSS variables
 * (packages/excalidraw/css/theme.scss) so its toolbars, menus, dialogs and
 * sidebar match the vault shell.
 *
 * Excalidraw declares these variables on `.excalidraw` (and again on
 * `.excalidraw.theme--dark`), so values inherited from <html> do NOT win; see
 * `applyThemeTokens` in ./index.ts, which injects a higher-specificity rule.
 *
 * Variables that Excalidraw defines as `var(--other)` (e.g. --icon-fill-color,
 * --button-hover-bg, --default-border-color, --popup-bg-color in light) follow
 * automatically once their source variable is overridden; they are only set
 * here when the dark block hard-codes a value.
 */

import { adjustLightness, hexToOklab, mix, toRgba } from "./color";

import type { ThemeMode, ThemeTokens } from "./types";

export const excalidrawVariableOverrides = (
  tokens: ThemeTokens,
  mode: ThemeMode,
): Record<string, string> => {
  const dark = mode === "dark";
  const t = tokens;
  const bg = t["--vault-bg"];
  const text = t["--vault-text"];
  const menu = t["--vault-menu-bg"];
  const primary = t["--vault-primary"];
  // "darker" in Excalidraw means "stronger": darker in light, lighter in dark.
  const strengthen = (step: number) =>
    adjustLightness(primary, dark ? 0.035 * step : -0.05 * step);

  // Selected tool / toggle: translucent selection tint with on-surface
  // content (no filled primary tile). Contrast of text on the tint over every
  // surface is guaranteed by the token tests.
  const primaryContainer = t["--vault-sel"];
  const onPrimaryContainer = text;
  const lightEnd = hexToOklab(bg).l > hexToOklab(text).l ? bg : text;
  const darkEnd = lightEnd === bg ? text : bg;
  const gray = (pct: number) => mix(lightEnd, darkEnd, pct / 100);

  return {
    // --- surfaces ----------------------------------------------------------
    // Default page/canvas-area background (welcome screen etc.) = canvas.
    "--default-bg-color": t["--vault-canvas"],
    // Floating islands (toolbar, properties panel, zoom/undo, library button)
    // = surface-variant with the 1 px island shadow. Popovers re-point these
    // to the menu surface in theme/excalidrawChrome.css.
    "--island-bg-color": t["--vault-surface"],
    "--shadow-island": t["--vault-shadow-island"],
    "--shadow-island-stronger": t["--vault-shadow-pop"],
    // Control sizes are NOT set here: a theme changes colours, never layout
    // (Excalidraw's own --lg-button-size stays in every theme, Default
    // included).
    "--border-radius-md": "6px",
    "--border-radius-lg": "8px",
    "--button-hover-bg": t["--vault-hover"],
    "--button-active-bg": t["--vault-sel"],
    // Alternate island bg (used by a few nested panels) = chrome surface.
    "--island-bg-color-alt": t["--vault-surface"],
    // Popovers / dropdowns (light block references island; dark hard-codes).
    "--popup-bg-color": menu,
    "--popup-secondary-bg-color": t["--vault-surface-hover"],
    "--popup-text-color": text,
    "--popup-text-inverted-color": bg,
    // Library/sidebar panel matches the vault sidebar.
    "--sidebar-bg-color": t["--vault-surface"],
    "--sidebar-border-color": t["--vault-border"],
    // Material-ish surface ladder used by buttons, toolbars and pickers:
    //   lowest = page, mid = chrome, low = hover, high = tinted hover/active
    //   (--button-hover-bg / --button-active-bg / --default-border-color
    //   reference --color-surface-high).
    "--color-surface-lowest": bg,
    "--color-surface-mid": t["--vault-surface"],
    "--color-surface-low": t["--vault-surface-hover"],
    "--color-surface-high": t["--vault-surface-active"],
    // Selected tool / active toggle background and its foreground.
    "--color-surface-primary-container": primaryContainer,
    "--color-on-primary-container": onPrimaryContainer,

    // --- text & icons ------------------------------------------------------
    // --icon-fill-color and --text-primary-color reference this.
    "--color-on-surface": text,
    "--text-primary-color": text,
    "--keybinding-color": t["--vault-text-faint"],
    "--input-label-color": t["--vault-text-muted"],
    // Neutral ramp (10 = lightest … 100 = darkest) tinted by the palette;
    // used directly by many components for secondary text/borders.
    "--color-gray-10": gray(4),
    "--color-gray-20": gray(9),
    "--color-gray-30": gray(17),
    "--color-gray-40": gray(29),
    "--color-gray-50": gray(41),
    "--color-gray-60": gray(53),
    "--color-gray-70": gray(65),
    "--color-gray-80": gray(77),
    "--color-gray-85": gray(86),
    "--color-gray-90": gray(91),
    "--color-gray-100": gray(97),

    // --- borders -----------------------------------------------------------
    "--dialog-border-color": t["--vault-border"],
    "--color-border-outline": t["--vault-text-faint"],
    "--color-border-outline-variant": t["--vault-border-strong"],
    "--avatar-border-color": t["--vault-border-strong"],

    // --- primary / brand ---------------------------------------------------
    "--color-primary": primary,
    "--color-primary-darker": strengthen(1),
    "--color-primary-darkest": strengthen(2),
    "--color-primary-hover": t["--vault-primary-hover"],
    // Selected-item tints (light: pale wash; dark: deeper tint).
    "--color-primary-light": mix(menu, primary, dark ? 0.3 : 0.16),
    "--color-primary-light-darker": mix(menu, primary, dark ? 0.24 : 0.22),
    "--color-brand-hover": t["--vault-primary-hover"],
    "--color-brand-active": t["--vault-primary-active"],
    "--color-logo-icon": primary,
    "--focus-highlight-color": t["--vault-primary-border"],
    "--select-highlight-color": primary,
    "--link-color": primary,
    "--link-color-hover": t["--vault-primary-hover"],
    "--link-color-active": t["--vault-primary-active"],
    "--color-slider-track": t["--vault-primary-border"],
    // Canvas selection outline (read via getComputedStyle by the renderer and
    // drawn as-is in both modes).
    "--color-selection": primary,
    // Icons drawn on primary-coloured buttons.
    "--color-icon-white": t["--vault-on-primary"],

    // --- buttons & inputs --------------------------------------------------
    "--button-gray-1": t["--vault-surface-hover"],
    "--button-gray-2": t["--vault-border"],
    "--button-gray-3": t["--vault-border-strong"],
    "--input-bg-color": bg,
    "--input-border-color": t["--vault-border-strong"],
    "--input-hover-bg-color": t["--vault-surface"],
    "--scrollbar-thumb": t["--vault-border-strong"],
    "--scrollbar-thumb-hover": t["--vault-text-faint"],
    "--overlay-bg-color": toRgba(darkEnd, dark ? 0.65 : 0.35),

    // --- status ------------------------------------------------------------
    "--color-danger": t["--vault-danger"],
    "--color-danger-text": t["--vault-danger"],
    "--color-danger-background": t["--vault-danger-bg"],
    "--button-destructive-color": t["--vault-danger"],
    "--button-destructive-bg-color": t["--vault-danger-bg"],
    "--color-success-text": t["--vault-success"],
  };
};
