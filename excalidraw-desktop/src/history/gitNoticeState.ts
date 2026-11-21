/**
 * "Not now" of the git notice, remembered per vault (keyed by vault path) in
 * machine state (state.json in the app), so it survives a restart: the app's
 * webview forgets its localStorage at every quit (toimprove 343).
 */
import {
  getPreferences,
  MAX_GIT_NOTICE_DISMISSED,
  saveMachineState,
} from "../vault/preferences";

export const isGitNoticeDismissed = (
  vaultKey: string,
  win?: Window | null,
): boolean => getPreferences(win).gitNoticeDismissed.includes(vaultKey);

export function dismissGitNotice(vaultKey: string, win?: Window | null): void {
  const list = getPreferences(win).gitNoticeDismissed;
  if (!list.includes(vaultKey)) {
    // Newest first: the cap drops the vaults dismissed longest ago.
    saveMachineState(
      {
        gitNoticeDismissed: [vaultKey, ...list].slice(
          0,
          MAX_GIT_NOTICE_DISMISSED,
        ),
      },
      win,
    );
  }
}
