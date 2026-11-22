/**
 * Applies `interface.font_size` / `interface.font_family` to the window and
 * keeps them live. Mount once in the app shell. At the defaults it writes
 * nothing (see interfaceFont.ts).
 */
import { useLayoutEffect } from "react";

import { usePreference } from "../components/settings/usePreference";
import { getPreferences, updatePreferences } from "../vault/preferences";

import {
  applyInterfaceFont,
  nextUiFontSize,
  uiRowHeight,
  uiTallRowHeight,
  type UiFontCommand,
} from "./interfaceFont";

/** Bigger / smaller / reset (the "Interface font: …" commands). */
export const runUiFontCommand = (
  command: UiFontCommand,
  win: Window | null = typeof window === "undefined" ? null : window,
): void => {
  const current = getPreferences(win).interfaceFontSize;
  const next = nextUiFontSize(current, command);
  if (next !== current) {
    updatePreferences({ interfaceFontSize: next }, win);
  }
};

export const useInterfaceFont = (win: Window | null) => {
  const w = win ?? window;
  const size = usePreference("interfaceFontSize", w);
  const family = usePreference("interfaceFontFamily", w);
  useLayoutEffect(() => {
    applyInterfaceFont(w.document.documentElement, size, family);
  }, [w, size, family]);
};

/** Row height of the file tree and tag lists at the current size. */
export const useUiRowHeight = () =>
  uiRowHeight(usePreference("interfaceFontSize"));
/** Row height of the version history list at the current size. */
export const useUiTallRowHeight = () =>
  uiTallRowHeight(usePreference("interfaceFontSize"));
