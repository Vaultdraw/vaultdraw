/** Palette provider: "Theme: <name>" for every installed colour theme. */
import { listThemeSummaries, type ThemeRegistry } from "../../theme/registry";

import type { PaletteItem, PaletteProvider } from "../types";

export interface ThemesProviderDeps {
  registry(): ThemeRegistry;
  /** Key of the selected theme (after the Default fallback). */
  currentKey(): string;
  /** Select a theme by key, as the Appearance settings page does. */
  select(key: string): void;
}

export function createThemesProvider({
  registry,
  currentKey,
  select,
}: ThemesProviderDeps): PaletteProvider {
  return {
    id: "themes",
    items(): PaletteItem[] {
      const current = currentKey();
      const themes = listThemeSummaries(registry()).map(
        ({ key, name }): PaletteItem => ({
          key: `theme:${name}`,
          title: `Theme: ${name}`,
          group: "Appearance",
          keywords: ["colour", "color", "theme"],
          checked: key === current,
          previewKey: key,
          run: () => select(key),
        }),
      );
      // Tab / Enter browse the family; "Theme: Dracula" still matches from the top.
      return [
        {
          key: "family:theme",
          title: "Family: Theme",
          group: "Appearance",
          keywords: ["colour", "color", "theme", "browse"],
          drill: "Theme: ",
          family: true,
          run: () => {},
        },
        ...themes,
      ];
    },
  };
}
