/**
 * The open vault's appearance overrides (theme, mode, accent) for
 * useAppearance. While the vault's settings.toml is still loading, the last
 * overrides seen for that vault are used, so a vault with its own theme does
 * not first paint in the global one. The cache is a small preferences field
 * kept in machine state (state.json in the app), so it works at the next
 * launch too: the app's webview forgets its localStorage at every quit.
 */
import { useEffect, useMemo } from "react";

import { getPreferences, updatePreferences } from "../vault/preferences";

import type { VaultAppearance } from "../vault/useAppearance";
import type { UseVaultSettings } from "../vault/useVaultSettings";

/** The last overrides seen for `handle`, or {} (none, or never opened). */
export const cachedVaultAppearance = (
  win: Window | null,
  handle: string,
): VaultAppearance => getPreferences(win).vaultAppearance[handle] ?? {};

/** Remember `handle`'s overrides; an empty set forgets the vault. */
export const rememberVaultAppearance = (
  win: Window | null,
  handle: string,
  value: VaultAppearance,
) => {
  const cache = getPreferences(win).vaultAppearance;
  const empty = Object.keys(value).length === 0;
  if (
    empty
      ? !(handle in cache)
      : JSON.stringify(cache[handle]) === JSON.stringify(value)
  ) {
    return;
  }
  // Re-inserted last: the oldest vaults are the ones dropped at the cap.
  const { [handle]: _old, ...rest } = cache;
  updatePreferences(
    { vaultAppearance: empty ? rest : { ...rest, [handle]: value } },
    win,
  );
};

const pick = (o: UseVaultSettings["overrides"]): VaultAppearance => {
  const out: VaultAppearance = {};
  if (o.colorTheme !== undefined) {
    out.colorTheme = o.colorTheme;
  }
  if (o.theme !== undefined) {
    out.theme = o.theme;
  }
  if (o.accentColor !== undefined) {
    out.accentColor = o.accentColor;
  }
  return out;
};

export function useVaultAppearance(
  win: Window | null,
  handle: string | null,
  vaultSettings: Pick<UseVaultSettings, "overrides" | "loaded">,
): VaultAppearance {
  const { overrides, loaded } = vaultSettings;
  const live = useMemo(() => pick(overrides), [overrides]);
  const cached = useMemo(
    () => (handle && !loaded ? cachedVaultAppearance(win, handle) : {}),
    [win, handle, loaded],
  );
  useEffect(() => {
    if (handle && loaded) {
      rememberVaultAppearance(win, handle, live);
    }
  }, [win, handle, loaded, live]);
  return loaded ? live : cached;
}
