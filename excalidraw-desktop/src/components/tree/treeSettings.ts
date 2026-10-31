/**
 * File tree settings (`[navigator]` in config.toml) for multi-select and
 * folder export (F13, F31). Pure data, spread into preferences.ts and
 * settingsSync.ts like the other settings modules.
 */
import type { ConfigMapping } from "../../vault/settingsSync";

export const MOD_CLICK_MODES = ["select", "new_tab"] as const;
export type ModClickMode = typeof MOD_CLICK_MODES[number];

export const EXPORT_EXISTING_MODES = ["keep_both", "replace", "skip"] as const;
export type ExportExistingMode = typeof EXPORT_EXISTING_MODES[number];

export const TREE_FIELDS = [
  "navigatorModClick",
  "navigatorExportExisting",
] as const;
export type TreeField = typeof TREE_FIELDS[number];

export interface TreePreferences {
  /** Cmd/Ctrl+click on a tree row: add it to the selection, or open it in a new tab. */
  navigatorModClick: ModClickMode;
  /** Exporting into a folder that already has a file of that name. */
  navigatorExportExisting: ExportExistingMode;
}

export const TREE_DEFAULTS: TreePreferences = {
  navigatorModClick: "select",
  navigatorExportExisting: "keep_both",
};

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v);
const isModClick = oneOf(MOD_CLICK_MODES);
const isExportExisting = oneOf(EXPORT_EXISTING_MODES);
const quoted = (values: readonly string[]) =>
  values.map((v) => `"${v}"`).join(", ");

export const TREE_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "navigatorModClick",
    key: "navigator.mod_click",
    expected: quoted(MOD_CLICK_MODES),
    valid: isModClick,
  },
  {
    field: "navigatorExportExisting",
    key: "navigator.export_existing",
    expected: quoted(EXPORT_EXISTING_MODES),
    valid: isExportExisting,
  },
];

/** Stored preferences -> valid tree fields; bad ones default. */
export function normalizeTreePreferences(
  input: Record<string, unknown>,
): TreePreferences {
  return {
    navigatorModClick: isModClick(input.navigatorModClick)
      ? input.navigatorModClick
      : TREE_DEFAULTS.navigatorModClick,
    navigatorExportExisting: isExportExisting(input.navigatorExportExisting)
      ? input.navigatorExportExisting
      : TREE_DEFAULTS.navigatorExportExisting,
  };
}
