/**
 * React side of colour themes: tracks preferences, OS appearance and the
 * theme registry, applies tokens + `html.dark`, and drives canvas sync.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  setCanvasSync,
  setCanvasThemeSource,
  setInvertSvgInDark,
} from "../editor/canvasSync";
import { openInstallDialog } from "../theme/install/installStore";
import { THEMES_REPO } from "../theme/removedThemes";
import { toastStore } from "../toasts/toastStore";
import {
  getThemeRegistry,
  isThemeReady,
  loadThemeEntry,
  resolveSelectedTheme,
  THEMES_CHANGED_EVENT,
  watchThemeRegistry,
  type ThemeRegistry,
} from "../theme/registry";

import { applyAppearance, computeAppearance } from "./appearance";
import { getPreferences, type VaultPreferences } from "./preferences";
import { PREFERENCES_CHANGED_EVENT } from "./settingsSync";

import type { AppearanceSnapshot } from "./appearance";

export interface AppearanceState {
  snapshot: AppearanceSnapshot;
  registry: ThemeRegistry;
  /** Re-read preferences after a local change (Settings, editor menu). */
  refresh: () => void;
  /**
   * Show a theme live (CSS variables and canvas sync only), or put the saved
   * one back with null. Never saved, never re-renders React: a crash or
   * reload during a preview leaves the saved theme.
   */
  previewTheme: (key: string | null) => void;
  /** The previewed theme was chosen: stop re-showing it, paint nothing. */
  endPreview: () => void;
}

/** What the open vault overrides (`<vault>/.excalidraw-vault/settings.toml`). */
export type VaultAppearance = Partial<
  Pick<VaultPreferences, "colorTheme" | "theme" | "accentColor">
>;

const NO_VAULT_APPEARANCE: VaultAppearance = {};
const noticed = new Set<string>();

export const useAppearance = (
  doc: Document | null,
  win: Window | null,
  vaultAppearance: VaultAppearance = NO_VAULT_APPEARANCE,
): AppearanceState => {
  const {
    colorTheme: vaultTheme,
    theme: vaultMode,
    accentColor: vaultAccent,
  } = vaultAppearance;
  const [registry, setRegistry] = useState<ThemeRegistry>(getThemeRegistry);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!win) {
      return;
    }
    const onThemes = () => setRegistry(getThemeRegistry());
    const media = win.matchMedia?.("(prefers-color-scheme: dark)");
    win.addEventListener(PREFERENCES_CHANGED_EVENT, refresh);
    win.addEventListener(THEMES_CHANGED_EVENT, onThemes);
    try {
      media?.addEventListener("change", refresh);
    } catch {
      media?.addListener(refresh);
    }
    const stopWatching = watchThemeRegistry(win);
    // The registry may have been loaded (main.tsx) before this mounted.
    onThemes();
    return () => {
      win.removeEventListener(PREFERENCES_CHANGED_EVENT, refresh);
      win.removeEventListener(THEMES_CHANGED_EVENT, onThemes);
      try {
        media?.removeEventListener("change", refresh);
      } catch {
        media?.removeListener(refresh);
      }
      stopWatching();
    };
  }, [win, refresh]);

  const shown = useRef<AppearanceSnapshot | null>(null);
  const snapshot = useMemo(() => {
    const global = getPreferences(win);
    const prefs = {
      ...global,
      colorTheme: vaultTheme ?? global.colorTheme,
      theme: vaultMode ?? global.theme,
      accentColor: vaultAccent ?? global.accentColor,
    };
    // A lazy built-in still loading: keep the current look (no flash of
    // Default); THEMES_CHANGED_EVENT brings a new registry when it lands.
    const { entry } = resolveSelectedTheme(registry, prefs.colorTheme);
    if (!isThemeReady(entry)) {
      void loadThemeEntry(entry);
      if (shown.current) {
        return shown.current;
      }
    }
    return computeAppearance(prefs, registry, win);
    // `tick` re-reads preferences after local edits and OS changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, tick, win, vaultTheme, vaultMode, vaultAccent]);
  shown.current = snapshot;

  const paint = useCallback(
    (snap: AppearanceSnapshot) => {
      if (doc) {
        applyAppearance(doc, snap);
      }
      // The canvas palette follows the theme, not the accent.
      const source = {
        variant: snap.entry.theme[snap.mode],
        mode: snap.mode,
        key: snap.key,
      };
      // Page mode's "match current theme" paper needs it even with sync off.
      setCanvasThemeSource(source);
      setCanvasSync(snap.syncCanvas ? source : null);
    },
    [doc],
  );

  // Transient palette preview: same pipeline, no state, nothing saved.
  const wanted = useRef<string | null>(null);
  const live = useRef({ vaultMode, vaultAccent });
  live.current = { vaultMode, vaultAccent };
  const previewTheme = useCallback(
    (key: string | null) => {
      wanted.current = key;
      const saved = shown.current;
      if (!doc || !saved) {
        return;
      }
      if (key === null) {
        paint(saved);
        return;
      }
      const { vaultMode: mode, vaultAccent: accent } = live.current;
      const reg = getThemeRegistry();
      const global = getPreferences(win);
      const prefs = {
        ...global,
        colorTheme: key,
        theme: mode ?? global.theme,
        accentColor: accent ?? global.accentColor,
      };
      const { entry } = resolveSelectedTheme(reg, key);
      if (!isThemeReady(entry)) {
        // A lazy built-in: load it, then show it if still the wanted one.
        void loadThemeEntry(entry).then(() => {
          if (wanted.current === key) {
            previewTheme(key);
          }
        });
        return;
      }
      paint(computeAppearance(prefs, reg, win));
    },
    [doc, win, paint],
  );

  const endPreview = useCallback(() => {
    wanted.current = null;
  }, []);

  // Layout effect: tokens land before the browser paints the new state. A
  // preview in progress is shown again on top (the registry may have changed).
  useLayoutEffect(() => {
    paint(snapshot);
    if (wanted.current !== null) {
      previewTheme(wanted.current);
    }
  }, [paint, previewTheme, snapshot]);

  // `appearance.invert_svg_in_dark`, live from config.toml and Settings.
  const invertSvg = useMemo(
    () => getPreferences(win).invertSvgInDark,
    // `tick` re-reads preferences after local edits and config reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, win],
  );
  useLayoutEffect(() => {
    setInvertSvgInDark(invertSvg);
  }, [invertSvg]);

  // The config names a theme that left the app: say so once, offer the install.
  const removed = snapshot.removed;
  useEffect(() => {
    if (removed && !noticed.has(removed)) {
      noticed.add(removed);
      toastStore.push({
        message: `"${removed}" is no longer built in. Showing Default.`,
        action: {
          label: "Install it",
          run: () =>
            openInstallDialog({
              mode: "install",
              input: THEMES_REPO,
              pick: removed,
            }),
        },
      });
    }
  }, [removed]);

  return { snapshot, registry, refresh, previewTheme, endPreview };
};
