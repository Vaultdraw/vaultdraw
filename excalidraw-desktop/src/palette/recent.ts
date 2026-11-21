/**
 * Most-recently-used palette entries, one list per mode (files: drawings,
 * commands: items). Separate lists keep heavy drawing use from pushing recent
 * commands out, and vice versa. Kept in machine state (state.json in the
 * app), so they survive a restart: the app's webview forgets its localStorage
 * at every quit (toimprove 343).
 */
import {
  getPreferences,
  MAX_PALETTE_RECENT,
  saveMachineState,
} from "../vault/preferences";

import type { PaletteMode } from "./rank";

/** Without a window (tests, early boot): kept for this session only. */
const memory: Record<PaletteMode, string[]> = { files: [], commands: [] };

type MaybeWindow = Window | null | undefined;

const modeOfKey = (key: string): PaletteMode =>
  key.startsWith("drawing:") ? "files" : "commands";

const read = (mode: PaletteMode, win: MaybeWindow): readonly string[] =>
  win ? getPreferences(win).paletteRecent[mode] : memory[mode];

/** Keys of `mode`, most recent first. */
export function getRecent(mode: PaletteMode, win: MaybeWindow): string[] {
  return read(mode, win).slice(0, MAX_PALETTE_RECENT);
}

/**
 * Move `key` to the front of its mode's list (drawings are "drawing:<path>"
 * and go to files; item keys go to commands).
 */
export function recordRecent(key: string, win: MaybeWindow): void {
  const mode = modeOfKey(key);
  const current = read(mode, win);
  if (current[0] === key) {
    return;
  }
  const next = [key, ...current.filter((k) => k !== key)].slice(
    0,
    MAX_PALETTE_RECENT,
  );
  if (!win) {
    memory[mode] = next;
    return;
  }
  const lists = getPreferences(win).paletteRecent;
  // Silent: the palette reads the list when it opens.
  saveMachineState({ paletteRecent: { ...lists, [mode]: next } }, win);
}
