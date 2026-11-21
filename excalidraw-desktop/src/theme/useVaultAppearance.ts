/**
 * The open vault's appearance overrides (theme, mode, accent) for
 * useAppearance. While the vault's settings.toml is still loading, the last
 * overrides seen for that vault are used, so a vault with its own theme does
 * not first paint in the global one. The cache is a small preferences field
 * kept in machine state (state.json in the app), so it works at the next
 * launch too: the app's webview forgets its localStorage at every quit.
 */
import { useEffect, useMemo } from "react";

import {
  getPerVault,
  getPreferences,
  MAX_VAULT_APPEARANCE,
  putPerVault,
  saveMachineState,
} from "../vault/preferences";

import type { VaultAppearance } from "../vault/useAppearance";
import type { UseVaultSettings } from "../vault/useVaultSettings";

/** The last overrides seen for `handle`, or {} (none, or never opened). */
export const cachedVaultAppearance = (
  win: Window | null,
  handle: string,
): VaultAppearance =>
  getPerVault(getPreferences(win).vaultAppearance, handle) ?? {};

/** Remember `handle`'s overrides (most recent first); an empty set forgets the vault. */
export const rememberVaultAppearance = (
  win: Window | null,
  handle: string,
  value: VaultAppearance,
) => {
  const list = getPreferences(win).vaultAppearance;
  const empty = Object.keys(value).length === 0;
  const old = getPerVault(list, handle);
  if (
    empty
      ? old === undefined
      : list[0]?.vault === handle &&
        JSON.stringify(old) === JSON.stringify(value)
  ) {
    return;
  }
  saveMachineState(
    {
      vaultAppearance: putPerVault(
        list,
        handle,
        empty ? null : value,
        MAX_VAULT_APPEARANCE,
      ),
    },
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
