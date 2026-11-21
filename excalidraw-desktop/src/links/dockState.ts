/**
 * Links dock visibility. A preference kept in machine state (state.json in
 * the app), so it survives a restart: the app's webview forgets its
 * localStorage at every quit (toimprove 343).
 */
import { getPreferences, updatePreferences } from "../vault/preferences";

export function getDockVisible(win?: Window | null): boolean {
  return getPreferences(win).linksDock;
}

export function setDockVisible(visible: boolean, win?: Window | null): void {
  if (getPreferences(win).linksDock !== visible) {
    updatePreferences({ linksDock: visible }, win);
  }
}
