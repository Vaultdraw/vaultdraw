/**
 * Tags pane UI state per vault: sort override, section open/closed and
 * collapsed node keys. It lives in the machine state (`state.json` in the
 * desktop app, through the preferences store), keyed by the vault's path.
 * The app's webview keeps no storage between launches, so browser storage
 * alone would forget the choice at every restart.
 */
import {
  getPreferences,
  normalizeTagsPane,
  updatePreferences,
  type TagsPaneEntry,
} from "../vault/preferences";

export type TagPaneState = TagsPaneEntry;

export function loadPaneState(
  vaultKey: string,
  win?: Window | null,
): TagPaneState {
  try {
    const entry = normalizeTagsPane(getPreferences(win).tagsPane)[vaultKey];
    return entry ? { ...entry } : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the vault's state. Silent when storage is unavailable. */
export function savePaneState(
  vaultKey: string,
  patch: TagPaneState,
  win?: Window | null,
): void {
  try {
    const all = getPreferences(win).tagsPane;
    updatePreferences(
      { tagsPane: { ...all, [vaultKey]: { ...all[vaultKey], ...patch } } },
      win,
    );
  } catch {
    // Storage unavailable: the choice is simply not remembered.
  }
}
