import {
  BACKGROUND_PATTERN_LIMITS,
  isBackgroundPatternType,
  type BackgroundPatternType,
} from "@excalidraw/excalidraw/data/backgroundPattern";

import {
  PAGE_LIMITS,
  isPageLayout,
  isPageOrientation,
  isPageSize,
  type PageLayout,
  type PageOrientation,
  type PageSize,
} from "@excalidraw/excalidraw/data/pageSetup";

import {
  DEFAULT_THUMB_CACHE_MB,
  DEFAULT_THUMB_MAX_ELEMENTS,
  MAX_THUMB_CACHE_MB,
  MIN_THUMB_CACHE_MB,
  MAX_THUMB_MAX_ELEMENTS,
  MIN_THUMB_MAX_ELEMENTS,
} from "../thumbnails/limits";

import {
  DEFAULT_LINKS_SETTINGS,
  type HoverPreview,
  type LinkIndicator,
  type LinksSettings,
  type NewLinkFormat,
  type OpenModifier,
  type ShapeLinkFormat,
  type UpdateOnRename,
} from "../links/types";
import {
  KEYS_DEFAULTS,
  normalizeKeysPreferences,
  type KeysPreferences,
} from "../commands/keySettings";
import {
  HISTORY_DEFAULTS,
  normalizeHistoryPreferences,
  type HistoryPreferences,
} from "../history/historySettings";
import {
  SYNC_DEFAULTS,
  normalizeSyncPreferences,
  type SyncPreferences,
} from "../sync/syncSettings";
import {
  TREE_DEFAULTS,
  normalizeTreePreferences,
  type TreePreferences,
} from "../components/tree/treeSettings";
import {
  MEMORY_DEFAULTS,
  normalizeMemoryPreferences,
  type MemoryPreferences,
} from "../memory/memorySettings";
import {
  normalizeSearchPreferences,
  SEARCH_DEFAULTS,
  type SearchPreferences,
} from "../search/searchSettings";
import {
  EXTENSION_DEFAULTS,
  normalizeExtensionPreferences,
  type ExtensionPreferences,
} from "../extensionSwitches/extensionSettings";
import {
  TABS_DEFAULTS,
  normalizeTabsPreferences,
  type TabsPreferences,
} from "../tabs/tabsSettings";
import {
  NOTES_DEFAULTS,
  normalizeNotesPreferences,
  type NotesPreferences,
} from "../notes/notesSettings";
import {
  MARKDOWN_DEFAULTS,
  normalizeMarkdownPreferences,
  type MarkdownPreferences,
} from "../markdown/markdownSettings";
import {
  SPECULATIVE_DEFAULTS,
  normalizeSpeculativePreferences,
  type SpeculativePreferences,
} from "../speculative/speculativeSettings";
import {
  SERVICES_DEFAULTS,
  normalizeServicesPreferences,
  type ServicesPreferences,
} from "../services/servicesSettings";
import {
  LAYOUT_DEFAULTS,
  normalizeLayoutPreferences,
  type LayoutPreferences,
} from "../layout/layoutSettings";
import {
  USER_COMMANDS_DEFAULTS,
  normalizeUserCommandsPreferences,
  type UserCommandsPreferences,
} from "../commands/userCommands";

import {
  DEFAULT_TAGS_SETTINGS,
  type TagSort,
  type TagsSettings,
} from "../tags/types";
import {
  DEFAULT_PDF_IMPORT_SETTINGS,
  PDF_IMPORT_LIMITS,
  type PdfImageFormat,
  type PdfImportSettings,
} from "../pdfImport/types";
import {
  disabledOfficial,
  DEFAULT_ON_IDS,
  resolveOfficial,
} from "../plugins/officialPlugins";
import { DEFAULT_TEMPLATES_FOLDER } from "../templates/types";
import { WATCHDOG_LIMITS } from "../watchdog/limits";

import {
  DEFAULT_LASER,
  LASER_LIMITS,
  inRange,
  type LaserSettings,
} from "../pens/laserSettings";
import {
  DEFAULT_PEN_PRESETS,
  isPenPresets,
  withPenDefaults,
  type PenPreset,
} from "../pens/penPresets";

import {
  isToolStyle,
  TOOL_DEFAULT_TOOLS,
  toolField,
  type ToolField,
  type ToolStyle,
} from "../toolDefaults/toolStyles";

import {
  ASSET_DEFAULTS,
  normalizeAssetPreferences,
  type AssetPreferences,
} from "../attachments/assetSettings";
import {
  WATCH_DEFAULTS,
  normalizeWatchPreferences,
  type WatchPreferences,
} from "../watch/watchSettings";

import { DEFAULT_WATCH_POLL_MS, isWatchPollMs } from "./watchPoll";

import { isWindowDecorations, type WindowDecorations } from "./windowChrome";

import {
  normalizePluginSettings,
  type PluginSettingsMap,
} from "./pluginSettingsTable";
import { DEFAULT_SORT_ORDER, isSortOrder, type SortOrder } from "./sortOrder";

import type { WorkspaceSessionV1 } from "../tabs/types";

/** `plugins.storage_limit_kb`: default and bounds (Rust refuses more than 16 MiB). */
export const DEFAULT_PLUGIN_STORAGE_KB = 1024;
export const MIN_PLUGIN_STORAGE_KB = 64;
export const MIN_NOTICE_SECONDS = 0;
export const MAX_NOTICE_SECONDS = 120;
export const DEFAULT_NOTICE_SECONDS = 8;
/** `interface.font_size`: UI text size in px (13 = the design system's body size). */
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 20;
export const DEFAULT_UI_FONT_SIZE = 13;
/** `interface.font_family`: longest accepted value (a name or a CSS font list). */
export const MAX_UI_FONT_FAMILY_LENGTH = 200;
export const MAX_PLUGIN_STORAGE_KB = 16384;
/** `plugins.scene_max_ops`: ops per plugin batch (sceneRules MAX_OPS and MAX_OPS_LIMIT; a test keeps them equal). */
export const DEFAULT_SCENE_MAX_OPS = 500;
export const MAX_SCENE_MAX_OPS = 1000;

export type VaultTheme = "light" | "dark" | "system";

/** Last-used image export options (machine state, not a user setting). */
export interface ExportOptions {
  scale: 1 | 2 | 3;
  background: boolean;
  embedScene: boolean;
  /** Draw the paper pattern in exports that include the background. */
  pattern: boolean;
  /** Page mode: export the whole page column instead of the content. */
  pageShaped: boolean;
}

const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;

/** Same default scale as the editor (appState.ts defaultExportScale). */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  scale: dpr === 2 || dpr === 3 ? dpr : 1,
  background: true,
  embedScene: false,
  pattern: true,
  pageShaped: false,
};

export function normalizeExportOptions(input: unknown): ExportOptions {
  const o =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const d = DEFAULT_EXPORT_OPTIONS;
  return {
    scale: o.scale === 1 || o.scale === 2 || o.scale === 3 ? o.scale : d.scale,
    background: typeof o.background === "boolean" ? o.background : d.background,
    embedScene: typeof o.embedScene === "boolean" ? o.embedScene : d.embedScene,
    pattern: typeof o.pattern === "boolean" ? o.pattern : d.pattern,
    pageShaped: typeof o.pageShaped === "boolean" ? o.pageShaped : d.pageShaped,
  };
}

/** Paper style of new drawings; "plain" = no pattern. */
export type PaperStyle = "plain" | BackgroundPatternType;

/** Default mode of new drawings: the infinite canvas or simulated pages. */
export type PageModeDefault = "normal" | "page";
/** Paper theme as spelled in config.toml (the model uses "oldSchool"). */
export type PagePaperTheme = "normal" | "old_school" | "match";
/** What the vault home pane shows when no drawing is open. */
export type HomePage = "full" | "minimal" | "blank";
export const HOME_PAGES: readonly HomePage[] = ["full", "minimal", "blank"];

/** One vault's Tags section state; every field is optional (not set = default). */
export type TagsPaneEntry = {
  sort?: "name" | "count";
  open?: boolean;
  collapsed?: string[];
};

interface VaultPreferencesBase {
  recentVaults: string[];
  lastVaultPath: string | null;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  /** Width in px of each plugin side panel the user resized, by panel id (machine state). */
  panelWidths: Record<string, number>;
  expandedFolders: Record<string, string[]>;
  /** Tags section state per vault path (sort, open, collapsed nodes); machine state. */
  tagsPane: Record<string, TagsPaneEntry>;
  /** Open tabs per vault path, restored at the next launch (machine state; checked again on load). */
  tabsSessions: PerVault<WorkspaceSessionV1>;
  /** The Links dock is shown (machine state). */
  linksDock: boolean;
  /** Vaults where the history panel's git notice got "Not now" (machine state). */
  gitNoticeDismissed: string[];
  /** The command palette's recent items, most recent first, per mode (machine state). */
  paletteRecent: PaletteRecent;
  /** Each vault's last appearance overrides, so its theme paints first at launch (machine state). */
  vaultAppearance: PerVault<VaultAppearanceEntry>;
  exportOptions: ExportOptions;
  /** The user has panned the canvas once: the "move canvas" hint stays hidden (machine state). */
  hasPanned: boolean;
  /** The profile you chose yourself, remembered while a vault's own profile is active (machine state); null = none to go back to, "default" = the plain config. */
  profileChoice: string | null;
  theme: VaultTheme;
  /** Colour theme name: a built-in name or a theme in the config themes/ folder. */
  colorTheme: string;
  /** Offline mode: every network feature off (config `network.offline`, default false). */
  networkOffline: boolean;
  /** The old master switch (`network.enabled`), still read: false counts as Offline mode. Use `isOffline`. */
  networkEnabled: boolean;
  /** Theme downloads (`network.allow_themes`): only an explicit false turns them off. */
  networkAllowThemes: boolean | undefined;
  /** The community plugins list and plugin downloads (`network.allow_plugins`): only an explicit false turns them off. */
  networkAllowPlugins: boolean | undefined;
  /** Web pictures (`network.allow_images`): only an explicit false turns them off. */
  networkAllowImages: boolean | undefined;
  /** AI requests (`network.allow_ai`): only an explicit false turns them off. */
  networkAllowAi: boolean | undefined;
  /** The update check (`network.allow_updates`): only an explicit false turns it off. */
  networkAllowUpdates: boolean | undefined;
  /** Look for a newer version once after startup (`updates.check_on_startup`, default true). */
  updatesCheckOnStartup: boolean;
  /** The first-run setup has been finished or skipped (`onboarding.completed`, default false). */
  onboardingCompleted: boolean;
  /** Extra hosts downloads may contact (`network.allowed_hosts`); Rust reads config.toml only. */
  networkAllowedHosts: string[];
  /** Computers on the user's network `ctx.net` may reach (`network.allow_private_hosts`); Rust reads config.toml only. */
  networkAllowPrivateHosts: string[];
  /** Where plugin keys are kept (`secrets.store`); Rust reads it, the page never writes it. */
  secretsStore: "auto" | "keychain" | "file";
  /** Where the community plugins list comes from (`plugins.registry_url`, https only). */
  pluginsRegistryUrl: string;
  /** Hours the cached plugins list is used before Browse fetches again (`plugins.registry_ttl_hours`). */
  pluginsRegistryTtlHours: number;
  /** Largest theme file to install, in KiB (`themes.max_install_kb`). */
  themeInstallMaxKb: number;
  /** Where the community themes list comes from (`themes.index_url`, https only). */
  themesIndexUrl: string;
  /** Hours the cached list is used before the browser fetches again (`themes.index_ttl_hours`). */
  themesIndexTtlHours: number;
  /** Fetch preview images in the theme browser (`themes.previews`); false = swatches only. */
  themesPreviews: boolean;
  /** Make the canvas background, pencil and palette colours follow the theme. */
  syncCanvas: boolean;
  /** Draw SVG pictures inverted in the dark theme, like Excalidraw (`appearance.invert_svg_in_dark`). */
  invertSvgInDark: boolean;
  /** Preview a theme as the palette highlight moves over it (`appearance.palette_theme_preview`). */
  paletteThemePreview: boolean;
  defaultFontFamily: number;
  defaultFontSize: number;
  defaultStrokeColor: string;
  defaultBackgroundColor: string;
  defaultFillStyle: string;
  defaultStrokeWidth: number;
  defaultRoughness: number;
  autosaveDelayMs: number;
  defaultCanvasBackground?: string;
  /** Paper pattern of new drawings. A vault's settings.toml may override the style. */
  paperStyle: PaperStyle;
  /** Distance between lines or dots in scene units; 0 = the style's preset. */
  paperSpacing: number;
  /** Pattern colour "#rrggbb"; "" = automatic. */
  paperColor: string;
  paperOpacity: number;
  /** Grid and graph: a major line every N; 0 = the style's preset. */
  paperMajorEvery: number;
  /** Ruled lines only. */
  paperMarginLine: boolean;
  /** Page mode defaults for new drawings (`[page]`). */
  pageMode: PageModeDefault;
  pageLayout: PageLayout;
  /** A preset id or "custom". */
  pageSize: PageSize;
  pageOrientation: PageOrientation;
  /** Custom page size in px, used when pageSize is "custom"; 0 = unset. */
  pageWidth: number;
  pageHeight: number;
  pagePaperTheme: PagePaperTheme;
  /** Replaces the theme's primary colour ("#rrggbb"); "" = the theme's own. */
  accentColor: string;
  /** Enabled CSS snippets (`<config>/snippets/<name>.css`), applied in order. */
  snippets: string[];
  /** Whole-window zoom in percent (webview zoom), 50 to 200. */
  zoom: number;
  /** Ask before moving a file or folder to the OS Trash. */
  confirmDelete: boolean;
  /** Show small tag chips after drawing names in the file tree. */
  showTagChips: boolean;
  /** Vault home pane: actions and recent drawings (`full`), actions only (`minimal`) or nothing (`blank`). */
  homePage: HomePage;
  /** UI text size in px (navigator, tabs, menus, dialogs, Settings); not drawings or notes. */
  interfaceFontSize: number;
  /** UI typeface: "" = the default (Assistant), else a font name or CSS font list. */
  interfaceFontFamily: string;
  /** Mount the vault home pane one frame after the file tree first paints (faster vault open). */
  deferHomePane: boolean;
  /** Seconds an error notice stays before it closes itself; 0 keeps it until dismissed. */
  noticeSeconds: number;
  /** Show drawing thumbnails (home, search, palette, gallery). */
  thumbnails: boolean;
  /** Largest drawing (elements) that gets a PNG thumbnail; bigger ones keep the placeholder. */
  thumbnailMaxElements: number;
  /** Size cap of a vault's thumbnail cache on disk, in megabytes. */
  thumbnailCacheMb: number;
  /** Show the icon bar on the left edge. A vault's settings.toml may override it. */
  activityBar: boolean;
  /** Activity bar entry ids in display order; unlisted entries follow in default order. */
  activityBarOrder: string[];
  /** Activity bar entry ids hidden from the bar (their commands still work). */
  activityBarHidden: string[];
  /** Extra folders of `.excalidrawlib` files shown as libraries (`[library] folders`). */
  libraryFolders: string[];
  /** Library that takes new items (`[library] default`); "" = Personal. */
  libraryDefault: string;
  /** Ids of enabled plugins (`[plugins] enabled`). */
  pluginsEnabled: string[];
  /** Official plugins the user turned off (see plugins/officialPlugins.ts). */
  pluginsDisabled: string[];
  /** `[plugins] importers`: file extension -> plugin id ("" = no plugin handles it). */
  pluginImporters: Record<string, string>;
  /** Limit of each plugin's `ctx.storage.global`, in KiB (`plugins.storage_limit_kb`). */
  pluginsStorageLimitKb: number;
  /** Most ops in one plugin `scene.batch` (`plugins.scene_max_ops`). */
  pluginsSceneMaxOps: number;
  /** Show the plugin status bar while an item has text (`plugins.status_bar`). */
  pluginsStatusBar: boolean;
  /** Show the plugin toolbar strip over the canvas (`plugins.toolbar`). */
  pluginsToolbar: boolean;
  /** Global navigator sort order; a vault's settings.toml may override it. */
  navigatorSort: SortOrder;
  /** Folder for new drawings, relative to the vault root ("" = unset). A vault's settings.toml may override it. */
  newDrawingFolder: string;
  /**
   * Vault folder holding templates, relative to the vault root. Never empty:
   * "" is not a valid value and falls back to "Templates". A vault's
   * settings.toml may override it.
   */
  templatesFolder: string;
  /** links.new_link_format */
  linkNewFormat: NewLinkFormat;
  /** links.shape_link_format */
  linkShapeFormat: ShapeLinkFormat;
  /** links.open_modifier */
  linkOpenModifier: OpenModifier;
  /** links.update_on_rename */
  linkUpdateOnRename: UpdateOnRename;
  /** links.autocomplete */
  linkAutocomplete: boolean;
  /** links.hint_chars */
  linkHintChars: string;
  /** links.style_links */
  linkStyle: boolean;
  /** links.color: "accent" or "#rrggbb" */
  linkColor: string;
  /** links.hover_preview */
  linkHoverPreview: HoverPreview;
  /** links.canvas_indicator */
  linkCanvasIndicator: LinkIndicator;
  /** tags.autocomplete */
  tagAutocomplete: boolean;
  /** tags.pane_sort */
  tagPaneSort: TagSort;
  /** ai.enabled: the AI master switch (off unless the file says literal true) */
  aiEnabled: boolean;
  /** ai.mcp_enabled: the AI tools interface, effective only while aiEnabled */
  aiMcpEnabled: boolean;
  /** control.notify_edits: notice when a script or AI tool edits the drawing */
  controlNotifyEdits: boolean;
  /** watchdog.enabled: the native hang dialog (the native side reads the key itself) */
  watchdogEnabled: boolean;
  /** watchdog.grace_ms: how long the page stays unresponsive before the dialog */
  watchdogGraceMs: number;
  /** files.watch_poll_ms: polling interval when the native file watcher cannot start (read by the native side) */
  filesWatchPollMs: number;
  /** window.decorations: Linux title bar, "custom" (in-app buttons) or "native"; read by the native side at launch */
  windowDecorations: WindowDecorations;
  /** pdf_import.max_side */
  pdfMaxSide: number;
  /** pdf_import.format */
  pdfFormat: PdfImageFormat;
  /** pdf_import.quality */
  pdfQuality: number;
  /** pdf_import.lock_pages */
  pdfLockPages: boolean;
  /** pdf_import.warn_pages */
  pdfWarnPages: number;
  /** pdf_import.pixel_budget_mp */
  pdfPixelBudgetMp: number;
  /** Hotkey overrides (`[hotkeys]`): command id -> chords. [] = unassigned. */
  hotkeys: Record<string, string[]>;
  /** Plugin settings (`[plugin.<id>]`): plugin id -> key -> value. */
  pluginSettings: PluginSettingsMap;
  /** Saved pens (1 to 9), selected with the pen.selectN commands (Alt+1..9). */
  penPresets: PenPreset[];
  laserColor: string;
  laserSize: number;
  laserDecayMs: number;
  laserLength: number;
}

/** Saved default style per drawing tool (`[tools.<tool>]`); {} = none. */
export type VaultPreferences = VaultPreferencesBase &
  HistoryPreferences &
  TabsPreferences &
  NotesPreferences &
  MarkdownPreferences &
  MemoryPreferences &
  SyncPreferences &
  TreePreferences &
  SearchPreferences &
  ExtensionPreferences &
  KeysPreferences &
  ServicesPreferences &
  SpeculativePreferences &
  WatchPreferences &
  AssetPreferences &
  LayoutPreferences &
  UserCommandsPreferences &
  Record<ToolField, ToolStyle>;

const STORAGE_KEY = "excalidraw-vault-preferences-v1";

/** Excalidraw's FONT_FAMILY.Excalifont (packages/common/src/constants.ts). */
export const DEFAULT_FONT_FAMILY = 5;

const emptyToolStyles = () =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => [toolField(tool), {}]),
  ) as Record<ToolField, ToolStyle>;

/** Untrusted -> a valid style per tool; anything invalid becomes {}. */
const normalizeToolStyles = (parsed: Partial<Record<ToolField, unknown>>) =>
  Object.fromEntries(
    TOOL_DEFAULT_TOOLS.map((tool) => {
      const value = parsed[toolField(tool)];
      return [
        toolField(tool),
        isToolStyle(tool, value) ? { ...(value as ToolStyle) } : {},
      ];
    }),
  ) as Record<ToolField, ToolStyle>;

export const DEFAULT_THEMES_INDEX_URL =
  "https://raw.githubusercontent.com/Vaultdraw/themes/main/index.json";

export const DEFAULT_PLUGINS_REGISTRY_URL =
  "https://raw.githubusercontent.com/Vaultdraw/plugin-registry/main/index.json";

export const DEFAULT_PREFERENCES: VaultPreferences = {
  recentVaults: [],
  lastVaultPath: null,
  navigatorCollapsed: false,
  navigatorWidth: 280,
  panelWidths: {},
  expandedFolders: {},
  tagsPane: {},
  tabsSessions: [],
  linksDock: false,
  gitNoticeDismissed: [],
  paletteRecent: { files: [], commands: [] },
  vaultAppearance: [],
  exportOptions: DEFAULT_EXPORT_OPTIONS,
  hasPanned: false,
  profileChoice: null,
  theme: "system",
  colorTheme: "Default",
  networkOffline: false,
  networkEnabled: true,
  updatesCheckOnStartup: true,
  onboardingCompleted: false,
  networkAllowThemes: undefined,
  networkAllowPlugins: undefined,
  networkAllowImages: undefined,
  networkAllowAi: undefined,
  networkAllowUpdates: undefined,
  networkAllowedHosts: [],
  networkAllowPrivateHosts: [],
  secretsStore: "auto",
  pluginsRegistryUrl: DEFAULT_PLUGINS_REGISTRY_URL,
  pluginsRegistryTtlHours: 24,
  themeInstallMaxKb: 64,
  themesIndexUrl: DEFAULT_THEMES_INDEX_URL,
  themesIndexTtlHours: 24,
  themesPreviews: true,
  syncCanvas: false,
  invertSvgInDark: true,
  paletteThemePreview: true,
  defaultFontFamily: DEFAULT_FONT_FAMILY,
  defaultFontSize: 20,
  defaultStrokeColor: "#1e1e1e",
  defaultBackgroundColor: "transparent",
  defaultFillStyle: "solid",
  defaultStrokeWidth: 2,
  defaultRoughness: 1,
  autosaveDelayMs: 500,
  defaultCanvasBackground: "#ffffff",
  paperStyle: "plain",
  paperSpacing: 0,
  paperColor: "",
  paperOpacity: 1,
  paperMajorEvery: 0,
  paperMarginLine: true,
  pageMode: "normal",
  pageLayout: "separate",
  pageSize: "a4",
  pageOrientation: "portrait",
  pageWidth: 0,
  pageHeight: 0,
  pagePaperTheme: "normal",
  accentColor: "",
  snippets: [],
  zoom: 100,
  confirmDelete: true,
  showTagChips: true,
  homePage: "full",
  interfaceFontSize: DEFAULT_UI_FONT_SIZE,
  interfaceFontFamily: "",
  deferHomePane: true,
  noticeSeconds: DEFAULT_NOTICE_SECONDS,
  thumbnails: true,
  thumbnailMaxElements: DEFAULT_THUMB_MAX_ELEMENTS,
  thumbnailCacheMb: DEFAULT_THUMB_CACHE_MB,
  activityBar: true,
  activityBarOrder: [],
  activityBarHidden: [],
  libraryFolders: [],
  libraryDefault: "",
  // Official plugins are on by default and load on first use (plugins/officialPlugins.ts).
  pluginsEnabled: [...DEFAULT_ON_IDS],
  pluginsDisabled: [],
  pluginImporters: {},
  pluginsStorageLimitKb: DEFAULT_PLUGIN_STORAGE_KB,
  pluginsSceneMaxOps: DEFAULT_SCENE_MAX_OPS,
  pluginsStatusBar: true,
  pluginsToolbar: true,
  navigatorSort: DEFAULT_SORT_ORDER,
  newDrawingFolder: "",
  templatesFolder: DEFAULT_TEMPLATES_FOLDER,
  linkNewFormat: DEFAULT_LINKS_SETTINGS.newLinkFormat,
  linkShapeFormat: DEFAULT_LINKS_SETTINGS.shapeLinkFormat,
  linkOpenModifier: DEFAULT_LINKS_SETTINGS.openModifier,
  linkUpdateOnRename: DEFAULT_LINKS_SETTINGS.updateOnRename,
  linkAutocomplete: DEFAULT_LINKS_SETTINGS.autocomplete,
  linkHintChars: DEFAULT_LINKS_SETTINGS.hintChars,
  linkStyle: DEFAULT_LINKS_SETTINGS.styleLinks,
  linkColor: DEFAULT_LINKS_SETTINGS.linkColor,
  linkHoverPreview: DEFAULT_LINKS_SETTINGS.hoverPreview,
  linkCanvasIndicator: DEFAULT_LINKS_SETTINGS.canvasIndicator,
  tagAutocomplete: DEFAULT_TAGS_SETTINGS.autocomplete,
  tagPaneSort: DEFAULT_TAGS_SETTINGS.paneSort,
  aiEnabled: false,
  aiMcpEnabled: true,
  controlNotifyEdits: true,
  watchdogEnabled: true,
  watchdogGraceMs: 5000,
  filesWatchPollMs: DEFAULT_WATCH_POLL_MS,
  windowDecorations: "custom",
  pdfMaxSide: DEFAULT_PDF_IMPORT_SETTINGS.maxSide,
  pdfFormat: DEFAULT_PDF_IMPORT_SETTINGS.format,
  pdfQuality: DEFAULT_PDF_IMPORT_SETTINGS.quality,
  pdfLockPages: DEFAULT_PDF_IMPORT_SETTINGS.lockPages,
  pdfWarnPages: DEFAULT_PDF_IMPORT_SETTINGS.warnPages,
  pdfPixelBudgetMp: DEFAULT_PDF_IMPORT_SETTINGS.pixelBudgetMp,
  hotkeys: {},
  pluginSettings: {},
  penPresets: DEFAULT_PEN_PRESETS.map((p) => ({ ...p })),
  laserColor: DEFAULT_LASER.color,
  laserSize: DEFAULT_LASER.size,
  laserDecayMs: DEFAULT_LASER.decayMs,
  laserLength: DEFAULT_LASER.length,
  ...HISTORY_DEFAULTS,
  ...TABS_DEFAULTS,
  ...NOTES_DEFAULTS,
  ...MARKDOWN_DEFAULTS,
  ...MEMORY_DEFAULTS,
  ...SYNC_DEFAULTS,
  ...TREE_DEFAULTS,
  ...SEARCH_DEFAULTS,
  ...EXTENSION_DEFAULTS,
  ...KEYS_DEFAULTS,
  ...SERVICES_DEFAULTS,
  ...SPECULATIVE_DEFAULTS,
  ...WATCH_DEFAULTS,
  ...ASSET_DEFAULTS,
  ...LAYOUT_DEFAULTS,
  ...USER_COMMANDS_DEFAULTS,
  ...emptyToolStyles(),
};

/** The laser fields of the preferences as one settings object. */
export const getLaserSettings = (
  prefs: PreferencesSnapshot,
): LaserSettings => ({
  color: prefs.laserColor,
  size: prefs.laserSize,
  decayMs: prefs.laserDecayMs,
  length: prefs.laserLength,
});

/** The links fields of the preferences as one settings object. */
export const getLinksSettings = (
  prefs: PreferencesSnapshot,
): LinksSettings => ({
  newLinkFormat: prefs.linkNewFormat,
  shapeLinkFormat: prefs.linkShapeFormat,
  openModifier: prefs.linkOpenModifier,
  updateOnRename: prefs.linkUpdateOnRename,
  autocomplete: prefs.linkAutocomplete,
  hintChars: prefs.linkHintChars,
  styleLinks: prefs.linkStyle,
  linkColor: prefs.linkColor,
  hoverPreview: prefs.linkHoverPreview,
  canvasIndicator: prefs.linkCanvasIndicator,
});

/** The tags fields of the preferences as one settings object. */
export const getTagsSettings = (prefs: PreferencesSnapshot): TagsSettings => ({
  autocomplete: prefs.tagAutocomplete,
  paneSort: prefs.tagPaneSort,
});

/** The `[pdf_import]` fields of the preferences as one settings object. */
export const getPdfImportSettings = (
  prefs: PreferencesSnapshot,
): PdfImportSettings => ({
  maxSide: prefs.pdfMaxSide,
  format: prefs.pdfFormat,
  quality: prefs.pdfQuality,
  lockPages: prefs.pdfLockPages,
  warnPages: prefs.pdfWarnPages,
  pixelBudgetMp: prefs.pdfPixelBudgetMp,
});

export const isPdfFormat = (v: unknown): v is PdfImageFormat =>
  v === "jpeg" || v === "png";
export const isPdfMaxSide = (v: unknown) =>
  Number.isInteger(v) && inRange(v, PDF_IMPORT_LIMITS.maxSide);
export const isPdfQuality = (v: unknown) =>
  inRange(v, PDF_IMPORT_LIMITS.quality);
export const isPdfWarnPages = (v: unknown) =>
  Number.isInteger(v) && inRange(v, PDF_IMPORT_LIMITS.warnPages);
export const isPdfPixelBudgetMp = (v: unknown) =>
  inRange(v, PDF_IMPORT_LIMITS.pixelBudgetMp);

export const isWatchdogGraceMs = (v: unknown) =>
  Number.isInteger(v) && inRange(v, WATCHDOG_LIMITS.graceMs);

export const isTagSort = (v: unknown): v is TagSort =>
  v === "name" || v === "count";

export const isNewLinkFormat = (v: unknown): v is NewLinkFormat =>
  v === "shortest" || v === "relative" || v === "absolute";
export const isShapeLinkFormat = (v: unknown): v is ShapeLinkFormat =>
  v === "wikilink" || v === "vaultdraw-url";
export const isOpenModifier = (v: unknown): v is OpenModifier =>
  v === "mod" || v === "alt" || v === "ctrl" || v === "shift";
export const isLinkColor = (v: unknown): v is string =>
  v === "accent" || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
export const isHoverPreview = (v: unknown): v is HoverPreview =>
  v === "always" || v === "modifier" || v === "off";
export const isLinkIndicator = (v: unknown): v is LinkIndicator =>
  v === "underline" || v === "icon" || v === "both";
export const isUpdateOnRename = (v: unknown): v is UpdateOnRename =>
  typeof v === "boolean" || v === "ask";
/** At least 2 distinct characters, no whitespace, nothing uppercase. */
export const isHintChars = (v: unknown): v is string => {
  if (typeof v !== "string" || /\s/.test(v) || v !== v.toLowerCase()) {
    return false;
  }
  const chars = Array.from(v);
  return chars.length >= 2 && new Set(chars).size === chars.length;
};

const PAPER_LIMITS = BACKGROUND_PATTERN_LIMITS;

export const isPaperStyle = (value: unknown): value is PaperStyle =>
  value === "plain" || isBackgroundPatternType(value);

/** "" = automatic colour. */
export const isPaperColor = (value: unknown): value is string =>
  value === "" || (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value));

/** 0 = the style's preset. */
export const isPaperSpacing = (value: unknown) =>
  value === 0 || inRange(value, PAPER_LIMITS.spacing);
export const isPaperOpacity = (value: unknown) =>
  inRange(value, PAPER_LIMITS.opacity);
export const isPaperMajorEvery = (value: unknown) =>
  value === 0 ||
  (Number.isInteger(value) && inRange(value, PAPER_LIMITS.majorEvery));

export const isPageMode = (value: unknown): value is PageModeDefault =>
  value === "normal" || value === "page";
export const isHomePage = (value: unknown): value is HomePage =>
  value === "full" || value === "minimal" || value === "blank";
export const isPagePaperTheme = (value: unknown): value is PagePaperTheme =>
  value === "normal" || value === "old_school" || value === "match";
/** 0 = unset (the A4 side is used). */
export const isPageSide = (value: unknown) =>
  value === 0 || (Number.isInteger(value) && inRange(value, PAGE_LIMITS.side));

/** An https address (plain http only for this machine, used by tests). */
export const isThemesIndexUrl = (v: unknown) => {
  if (typeof v !== "string" || v.length > 500) {
    return false;
  }
  try {
    const url = new URL(v);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

export const isThemesIndexTtlHours = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 720;

export const isThemeInstallMaxKb = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 256;

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;

export const isVaultTheme = (value: unknown): value is VaultTheme =>
  value === "light" || value === "dark" || value === "system";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const isExpandedFolders = (
  value: unknown,
): value is Record<string, string[]> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(isStringArray);

/** Tags section state per vault: keeps well-formed entries and fields only. */
/** Saved plugin-panel widths: only finite positive numbers under string ids survive. */
export const normalizePanelWidths = (
  value: unknown,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, w] of Object.entries(value)) {
      if (typeof w === "number" && Number.isFinite(w) && w > 0) {
        out[id] = Math.round(w);
      }
    }
  }
  return out;
};

export const normalizeTagsPane = (
  value: unknown,
): Record<string, TagsPaneEntry> => {
  const result: Record<string, TagsPaneEntry> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  for (const [vault, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const e = raw as Record<string, unknown>;
    const entry: TagsPaneEntry = {};
    if (e.sort === "name" || e.sort === "count") {
      entry.sort = e.sort;
    }
    if (typeof e.open === "boolean") {
      entry.open = e.open;
    }
    if (Array.isArray(e.collapsed)) {
      entry.collapsed = e.collapsed.filter(
        (k): k is string => typeof k === "string",
      );
    }
    result[vault] = entry;
  }
  return result;
};

/** The strings of a list; anything else is an empty list. */
export const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/** The palette's recent lists: drawings ("drawing:<path>") and everything else. */
export type PaletteRecent = { files: string[]; commands: string[] };

/** Most entries kept per palette recent list. */
export const MAX_PALETTE_RECENT = 30;

export const normalizePaletteRecent = (value: unknown): PaletteRecent => {
  const o =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    files: stringList(o.files).slice(0, MAX_PALETTE_RECENT),
    commands: stringList(o.commands).slice(0, MAX_PALETTE_RECENT),
  };
};

/**
 * Per-vault machine state is a list, most recent first: JSON objects lose
 * their key order through state.json (serde_json sorts keys), and the caps
 * below must drop the vaults used longest ago, not the last by name.
 */
export type PerVault<T> = { vault: string; value: T }[];

/** `list` with `vault` moved to the front holding `value` (or removed when `value` is null), capped. */
export const putPerVault = <T>(
  list: DeepReadonly<PerVault<T>> | PerVault<T>,
  vault: string,
  value: T | null,
  max: number,
): PerVault<T> => {
  const rest = (list as PerVault<T>).filter((e) => e.vault !== vault);
  return (value === null ? rest : [{ vault, value }, ...rest]).slice(0, max);
};

export const getPerVault = <T>(
  list: DeepReadonly<PerVault<T>> | PerVault<T>,
  vault: string,
): T | undefined => (list as PerVault<T>).find((e) => e.vault === vault)?.value;

const normalizePerVault = <T>(
  value: unknown,
  max: number,
  entry: (raw: unknown) => T | null,
): PerVault<T> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PerVault<T> = [];
  for (const item of value) {
    if (out.length >= max) {
      break;
    }
    const v = item as { vault?: unknown; value?: unknown } | null;
    if (
      !v ||
      typeof v.vault !== "string" ||
      out.some((e) => e.vault === v.vault)
    ) {
      continue;
    }
    const parsed = entry(v.value);
    if (parsed !== null) {
      out.push({ vault: v.vault, value: parsed });
    }
  }
  return out;
};

/** A vault's own theme, mode and accent, as its settings.toml last set them. */
export type VaultAppearanceEntry = {
  colorTheme?: string;
  theme?: VaultTheme;
  accentColor?: string;
};

/** Vaults whose appearance is remembered; the ones opened longest ago are dropped first. */
export const MAX_VAULT_APPEARANCE = 32;

export const normalizeVaultAppearance = (
  value: unknown,
): PerVault<VaultAppearanceEntry> =>
  normalizePerVault(value, MAX_VAULT_APPEARANCE, (raw) => {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const e = raw as Record<string, unknown>;
    const entry: VaultAppearanceEntry = {};
    if (typeof e.colorTheme === "string") {
      entry.colorTheme = e.colorTheme;
    }
    if (isVaultTheme(e.theme)) {
      entry.theme = e.theme;
    }
    if (typeof e.accentColor === "string") {
      entry.accentColor = e.accentColor;
    }
    return entry;
  });

/**
 * Vaults whose open tabs are remembered; the ones saved longest ago are
 * dropped first. Small enough that state.json stays well under its 1 MiB cap
 * even with many tabs per vault.
 */
export const MAX_TABS_SESSIONS = 10;

/**
 * Open tabs per vault: keeps object entries only (workspaceStore.deserialize
 * checks each one fully when it is restored).
 */
export const normalizeTabsSessions = (
  value: unknown,
): PerVault<WorkspaceSessionV1> =>
  normalizePerVault(value, MAX_TABS_SESSIONS, (raw) =>
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as WorkspaceSessionV1)
      : null,
  );

/** Vaults whose git notice got "Not now"; the oldest are dropped past this. */
export const MAX_GIT_NOTICE_DISMISSED = 64;

export const normalizeGitNoticeDismissed = (value: unknown): string[] =>
  stringList(value).slice(0, MAX_GIT_NOTICE_DISMISSED);

/** Keep only entries whose value is an array of strings. */
export const normalizeHotkeys = (value: unknown): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [id, keys] of Object.entries(value)) {
      if (isStringArray(keys)) {
        result[id] = [...keys];
      }
    }
  }
  return result;
};

const pick = <T>(
  value: unknown,
  guard: (value: unknown) => boolean,
  fallback: T,
): T => (guard(value) ? (value as T) : fallback);

const isNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const isNoticeSeconds = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_NOTICE_SECONDS &&
  value <= MAX_NOTICE_SECONDS;
export const isUiFontSize = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_UI_FONT_SIZE &&
  value <= MAX_UI_FONT_SIZE;
export const isUiFontFamily = (value: unknown) =>
  typeof value === "string" && value.length <= MAX_UI_FONT_FAMILY_LENGTH;
const isThumbCacheMb = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_THUMB_CACHE_MB &&
  value <= MAX_THUMB_CACHE_MB;
const isThumbMaxElements = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_THUMB_MAX_ELEMENTS &&
  value <= MAX_THUMB_MAX_ELEMENTS;
/** `plugins.importers`: a table of extension -> plugin id or "". */
export const isPluginImporters = (
  value: unknown,
): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string");
export const isPluginStorageKb = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_PLUGIN_STORAGE_KB &&
  value <= MAX_PLUGIN_STORAGE_KB;
export const isSceneMaxOps = (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_SCENE_MAX_OPS;
const isString = (value: unknown) => typeof value === "string";
const isBoolean = (value: unknown) => typeof value === "boolean";

/** Presets with missing optional fields filled in; invalid -> fallback. */
const normalizePenPresets = (value: unknown, fallback: PenPreset[]) => {
  const filled = withPenDefaults(value);
  return isPenPresets(filled) ? filled : fallback.map((p) => ({ ...p }));
};

/**
 * Field-by-field normalization of an untrusted preferences object: anything
 * with the wrong type falls back to that field's default.
 */
export function normalizePreferences(input: unknown): VaultPreferences {
  const parsed =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof VaultPreferences, unknown>>)
      : {};
  const d = DEFAULT_PREFERENCES;
  return {
    ...d,
    ...(parsed as Partial<VaultPreferences>),
    recentVaults: Array.isArray(parsed.recentVaults)
      ? (parsed.recentVaults as string[])
      : [],
    lastVaultPath:
      typeof parsed.lastVaultPath === "string" ? parsed.lastVaultPath : null,
    navigatorCollapsed: pick(
      parsed.navigatorCollapsed,
      isBoolean,
      d.navigatorCollapsed,
    ),
    navigatorWidth: pick(parsed.navigatorWidth, isNumber, d.navigatorWidth),
    panelWidths: normalizePanelWidths(parsed.panelWidths),
    expandedFolders:
      parsed.expandedFolders && typeof parsed.expandedFolders === "object"
        ? (parsed.expandedFolders as Record<string, string[]>)
        : {},
    tagsPane: normalizeTagsPane(parsed.tagsPane),
    tabsSessions: normalizeTabsSessions(parsed.tabsSessions),
    linksDock: pick(parsed.linksDock, isBoolean, d.linksDock),
    gitNoticeDismissed: normalizeGitNoticeDismissed(parsed.gitNoticeDismissed),
    paletteRecent: normalizePaletteRecent(parsed.paletteRecent),
    vaultAppearance: normalizeVaultAppearance(parsed.vaultAppearance),
    exportOptions: normalizeExportOptions(parsed.exportOptions),
    hasPanned: pick(parsed.hasPanned, isBoolean, d.hasPanned),
    profileChoice:
      typeof parsed.profileChoice === "string" ? parsed.profileChoice : null,
    theme: isVaultTheme(parsed.theme) ? parsed.theme : d.theme,
    colorTheme:
      typeof parsed.colorTheme === "string" && parsed.colorTheme.trim()
        ? parsed.colorTheme
        : d.colorTheme,
    syncCanvas: pick(parsed.syncCanvas, isBoolean, d.syncCanvas),
    invertSvgInDark: pick(parsed.invertSvgInDark, isBoolean, d.invertSvgInDark),
    paletteThemePreview: pick(
      parsed.paletteThemePreview,
      isBoolean,
      d.paletteThemePreview,
    ),
    defaultFontFamily: pick(
      parsed.defaultFontFamily,
      isNumber,
      d.defaultFontFamily,
    ),
    defaultFontSize: pick(parsed.defaultFontSize, isNumber, d.defaultFontSize),
    defaultStrokeColor: pick(
      parsed.defaultStrokeColor,
      isString,
      d.defaultStrokeColor,
    ),
    defaultBackgroundColor: pick(
      parsed.defaultBackgroundColor,
      isString,
      d.defaultBackgroundColor,
    ),
    defaultFillStyle: pick(
      parsed.defaultFillStyle,
      isString,
      d.defaultFillStyle,
    ),
    defaultStrokeWidth: pick(
      parsed.defaultStrokeWidth,
      isNumber,
      d.defaultStrokeWidth,
    ),
    defaultRoughness: pick(
      parsed.defaultRoughness,
      isNumber,
      d.defaultRoughness,
    ),
    autosaveDelayMs: pick(parsed.autosaveDelayMs, isNumber, d.autosaveDelayMs),
    defaultCanvasBackground: pick(
      parsed.defaultCanvasBackground,
      isString,
      d.defaultCanvasBackground,
    ),
    paperStyle: pick(parsed.paperStyle, isPaperStyle, d.paperStyle),
    paperSpacing: pick(parsed.paperSpacing, isPaperSpacing, d.paperSpacing),
    paperColor: pick(parsed.paperColor, isPaperColor, d.paperColor),
    paperOpacity: pick(parsed.paperOpacity, isPaperOpacity, d.paperOpacity),
    paperMajorEvery: pick(
      parsed.paperMajorEvery,
      isPaperMajorEvery,
      d.paperMajorEvery,
    ),
    paperMarginLine: pick(parsed.paperMarginLine, isBoolean, d.paperMarginLine),
    pageMode: pick(parsed.pageMode, isPageMode, d.pageMode),
    pageLayout: pick(parsed.pageLayout, isPageLayout, d.pageLayout),
    pageSize: pick(parsed.pageSize, isPageSize, d.pageSize),
    pageOrientation: pick(
      parsed.pageOrientation,
      isPageOrientation,
      d.pageOrientation,
    ),
    pageWidth: pick(parsed.pageWidth, isPageSide, d.pageWidth),
    pageHeight: pick(parsed.pageHeight, isPageSide, d.pageHeight),
    pagePaperTheme: pick(
      parsed.pagePaperTheme,
      isPagePaperTheme,
      d.pagePaperTheme,
    ),
    accentColor: pick(parsed.accentColor, isString, d.accentColor),
    snippets: pick(parsed.snippets, isStringArray, d.snippets),
    zoom: pick(
      parsed.zoom,
      (v) =>
        isNumber(v) && (v as number) >= MIN_ZOOM && (v as number) <= MAX_ZOOM,
      d.zoom,
    ),
    networkOffline: pick(parsed.networkOffline, isBoolean, d.networkOffline),
    networkEnabled: pick(parsed.networkEnabled, isBoolean, d.networkEnabled),
    updatesCheckOnStartup: pick(
      parsed.updatesCheckOnStartup,
      isBoolean,
      d.updatesCheckOnStartup,
    ),
    onboardingCompleted: pick(
      parsed.onboardingCompleted,
      isBoolean,
      d.onboardingCompleted,
    ),
    networkAllowThemes: pick(
      parsed.networkAllowThemes,
      isBoolean,
      d.networkAllowThemes,
    ),
    networkAllowPlugins: pick(
      parsed.networkAllowPlugins,
      isBoolean,
      d.networkAllowPlugins,
    ),
    networkAllowImages: pick(
      parsed.networkAllowImages,
      isBoolean,
      d.networkAllowImages,
    ),
    networkAllowAi: pick(parsed.networkAllowAi, isBoolean, d.networkAllowAi),
    networkAllowUpdates: pick(
      parsed.networkAllowUpdates,
      isBoolean,
      d.networkAllowUpdates,
    ),
    networkAllowedHosts: pick(
      parsed.networkAllowedHosts,
      isStringArray,
      d.networkAllowedHosts,
    ),
    networkAllowPrivateHosts: pick(
      parsed.networkAllowPrivateHosts,
      isStringArray,
      d.networkAllowPrivateHosts,
    ),
    secretsStore: pick(
      parsed.secretsStore,
      (v): v is VaultPreferences["secretsStore"] =>
        v === "auto" || v === "keychain" || v === "file",
      d.secretsStore,
    ),
    pluginsRegistryUrl: pick(
      parsed.pluginsRegistryUrl,
      isThemesIndexUrl,
      d.pluginsRegistryUrl,
    ),
    pluginsRegistryTtlHours: pick(
      parsed.pluginsRegistryTtlHours,
      isThemesIndexTtlHours,
      d.pluginsRegistryTtlHours,
    ),
    themeInstallMaxKb: pick(
      parsed.themeInstallMaxKb,
      isThemeInstallMaxKb,
      d.themeInstallMaxKb,
    ),
    themesIndexUrl: pick(
      parsed.themesIndexUrl,
      isThemesIndexUrl,
      d.themesIndexUrl,
    ),
    themesIndexTtlHours: pick(
      parsed.themesIndexTtlHours,
      isThemesIndexTtlHours,
      d.themesIndexTtlHours,
    ),
    themesPreviews: pick(parsed.themesPreviews, isBoolean, d.themesPreviews),
    confirmDelete: pick(parsed.confirmDelete, isBoolean, d.confirmDelete),
    showTagChips: pick(parsed.showTagChips, isBoolean, d.showTagChips),
    homePage: pick(parsed.homePage, isHomePage, d.homePage),
    interfaceFontSize: pick(
      parsed.interfaceFontSize,
      isUiFontSize,
      d.interfaceFontSize,
    ),
    interfaceFontFamily: pick(
      parsed.interfaceFontFamily,
      isUiFontFamily,
      d.interfaceFontFamily,
    ),
    deferHomePane: pick(parsed.deferHomePane, isBoolean, d.deferHomePane),
    noticeSeconds: pick(parsed.noticeSeconds, isNoticeSeconds, d.noticeSeconds),
    thumbnails: pick(parsed.thumbnails, isBoolean, d.thumbnails),
    thumbnailCacheMb: pick(
      parsed.thumbnailCacheMb,
      isThumbCacheMb,
      d.thumbnailCacheMb,
    ),
    thumbnailMaxElements: pick(
      parsed.thumbnailMaxElements,
      isThumbMaxElements,
      d.thumbnailMaxElements,
    ),
    activityBar: pick(parsed.activityBar, isBoolean, d.activityBar),
    activityBarOrder: pick(
      parsed.activityBarOrder,
      isStringArray,
      d.activityBarOrder,
    ),
    activityBarHidden: pick(
      parsed.activityBarHidden,
      isStringArray,
      d.activityBarHidden,
    ),
    libraryFolders: pick(
      parsed.libraryFolders,
      isStringArray,
      d.libraryFolders,
    ),
    libraryDefault: pick(
      parsed.libraryDefault,
      (v): v is string => typeof v === "string",
      d.libraryDefault,
    ),
    ...(() => {
      const r = resolveOfficial(
        pick(parsed.pluginsEnabled, isStringArray, undefined),
        pick(parsed.pluginsDisabled, isStringArray, undefined),
      );
      return { pluginsEnabled: r.enabled, pluginsDisabled: r.disabled };
    })(),
    pluginImporters: pick(
      parsed.pluginImporters,
      isPluginImporters,
      d.pluginImporters,
    ),
    pluginsStorageLimitKb: pick(
      parsed.pluginsStorageLimitKb,
      isPluginStorageKb,
      d.pluginsStorageLimitKb,
    ),
    pluginsSceneMaxOps: pick(
      parsed.pluginsSceneMaxOps,
      isSceneMaxOps,
      d.pluginsSceneMaxOps,
    ),
    pluginsStatusBar: pick(
      parsed.pluginsStatusBar,
      isBoolean,
      d.pluginsStatusBar,
    ),
    pluginsToolbar: pick(parsed.pluginsToolbar, isBoolean, d.pluginsToolbar),
    navigatorSort: pick(parsed.navigatorSort, isSortOrder, d.navigatorSort),
    newDrawingFolder: pick(
      parsed.newDrawingFolder,
      isString,
      d.newDrawingFolder,
    ),
    templatesFolder: pick(
      parsed.templatesFolder,
      (v) => isString(v) && (v as string).trim() !== "",
      d.templatesFolder,
    ),
    linkNewFormat: pick(parsed.linkNewFormat, isNewLinkFormat, d.linkNewFormat),
    linkShapeFormat: pick(
      parsed.linkShapeFormat,
      isShapeLinkFormat,
      d.linkShapeFormat,
    ),
    linkOpenModifier: pick(
      parsed.linkOpenModifier,
      isOpenModifier,
      d.linkOpenModifier,
    ),
    linkUpdateOnRename: pick(
      parsed.linkUpdateOnRename,
      isUpdateOnRename,
      d.linkUpdateOnRename,
    ),
    linkAutocomplete: pick(
      parsed.linkAutocomplete,
      isBoolean,
      d.linkAutocomplete,
    ),
    linkHintChars: pick(parsed.linkHintChars, isHintChars, d.linkHintChars),
    linkStyle: pick(parsed.linkStyle, isBoolean, d.linkStyle),
    linkColor: pick(parsed.linkColor, isLinkColor, d.linkColor),
    linkHoverPreview: pick(
      parsed.linkHoverPreview,
      isHoverPreview,
      d.linkHoverPreview,
    ),
    linkCanvasIndicator: pick(
      parsed.linkCanvasIndicator,
      isLinkIndicator,
      d.linkCanvasIndicator,
    ),
    tagAutocomplete: pick(parsed.tagAutocomplete, isBoolean, d.tagAutocomplete),
    tagPaneSort: pick(parsed.tagPaneSort, isTagSort, d.tagPaneSort),
    // Fail closed: anything but a literal true leaves AI off.
    aiEnabled: parsed.aiEnabled === true,
    aiMcpEnabled: pick(parsed.aiMcpEnabled, isBoolean, d.aiMcpEnabled),
    controlNotifyEdits: pick(
      parsed.controlNotifyEdits,
      isBoolean,
      d.controlNotifyEdits,
    ),
    watchdogEnabled: pick(parsed.watchdogEnabled, isBoolean, d.watchdogEnabled),
    watchdogGraceMs: pick(
      parsed.watchdogGraceMs,
      isWatchdogGraceMs,
      d.watchdogGraceMs,
    ),
    filesWatchPollMs: pick(
      parsed.filesWatchPollMs,
      isWatchPollMs,
      d.filesWatchPollMs,
    ),
    windowDecorations: pick(
      parsed.windowDecorations,
      isWindowDecorations,
      d.windowDecorations,
    ),
    pdfMaxSide: pick(parsed.pdfMaxSide, isPdfMaxSide, d.pdfMaxSide),
    pdfFormat: pick(parsed.pdfFormat, isPdfFormat, d.pdfFormat),
    pdfQuality: pick(parsed.pdfQuality, isPdfQuality, d.pdfQuality),
    pdfLockPages: pick(parsed.pdfLockPages, isBoolean, d.pdfLockPages),
    pdfWarnPages: pick(parsed.pdfWarnPages, isPdfWarnPages, d.pdfWarnPages),
    pdfPixelBudgetMp: pick(
      parsed.pdfPixelBudgetMp,
      isPdfPixelBudgetMp,
      d.pdfPixelBudgetMp,
    ),
    hotkeys: normalizeHotkeys(parsed.hotkeys),
    pluginSettings: normalizePluginSettings(parsed.pluginSettings),
    penPresets: normalizePenPresets(parsed.penPresets, d.penPresets),
    laserColor: pick(parsed.laserColor, isString, d.laserColor),
    laserSize: pick(
      parsed.laserSize,
      (v) => inRange(v, LASER_LIMITS.size),
      d.laserSize,
    ),
    laserDecayMs: pick(
      parsed.laserDecayMs,
      (v) => inRange(v, LASER_LIMITS.decayMs),
      d.laserDecayMs,
    ),
    laserLength: pick(
      parsed.laserLength,
      (v) => inRange(v, LASER_LIMITS.length),
      d.laserLength,
    ),
    ...normalizeHistoryPreferences(parsed as Record<string, unknown>),
    ...normalizeTabsPreferences(parsed as Record<string, unknown>),
    ...normalizeNotesPreferences(parsed as Record<string, unknown>),
    ...normalizeMarkdownPreferences(parsed as Record<string, unknown>),
    ...normalizeMemoryPreferences(parsed as Record<string, unknown>),
    ...normalizeSyncPreferences(parsed as Record<string, unknown>),
    ...normalizeTreePreferences(parsed as Record<string, unknown>),
    ...normalizeSearchPreferences(parsed as Record<string, unknown>),
    ...normalizeExtensionPreferences(parsed as Record<string, unknown>),
    ...normalizeKeysPreferences(parsed as Record<string, unknown>),
    ...normalizeServicesPreferences(parsed as Record<string, unknown>),
    ...normalizeSpeculativePreferences(parsed as Record<string, unknown>),
    ...normalizeWatchPreferences(parsed as Record<string, unknown>),
    ...normalizeAssetPreferences(parsed as Record<string, unknown>),
    ...normalizeLayoutPreferences(parsed as Record<string, unknown>),
    ...normalizeUserCommandsPreferences(parsed as Record<string, unknown>),
    ...normalizeToolStyles(parsed as Partial<Record<ToolField, unknown>>),
  };
}

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** What getPreferences returns: a frozen snapshot, identity stable until a change. */
export type PreferencesSnapshot = DeepReadonly<VaultPreferences>;

const isPlain = (v: unknown): v is object =>
  typeof v === "object" && v !== null;

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (!isPlain(a) || !isPlain(b) || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) {
    return false;
  }
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
};

/** Frozen deep copy; the caller's value is never frozen or retained. */
const freezeClone = <T>(v: T): T => {
  if (!isPlain(v)) {
    return v;
  }
  const copy: Record<string, unknown> | unknown[] = Array.isArray(v)
    ? v.map(freezeClone)
    : Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, freezeClone(x)]),
      );
  return Object.freeze(copy) as T;
};

/**
 * Next frozen snapshot built from `next`, reusing `prev`'s nested objects
 * where deep-equal (structural sharing). Returns `prev` itself when nothing
 * changed, so consumers can compare by identity.
 */
const toSnapshot = (
  prev: PreferencesSnapshot | null,
  next: DeepReadonly<Partial<VaultPreferences>> | PreferencesSnapshot,
): PreferencesSnapshot => {
  const out: Record<string, unknown> = {};
  let changed = prev === null;
  for (const [key, value] of Object.entries(next)) {
    const old = prev ? (prev as Record<string, unknown>)[key] : undefined;
    if (prev && deepEqual(old, value)) {
      out[key] = old;
    } else {
      out[key] = freezeClone(value);
      changed = true;
    }
  }
  if (prev && Object.keys(prev).length !== Object.keys(out).length) {
    changed = true;
  }
  return changed ? (Object.freeze(out) as PreferencesSnapshot) : prev!;
};

let defaultsSnapshot: PreferencesSnapshot | null = null;
const getDefaultsSnapshot = () =>
  (defaultsSnapshot ??= toSnapshot(null, DEFAULT_PREFERENCES));

// ---------------------------------------------------------------------------
// In-memory store (desktop config folder mode)
//
// In the Tauri app, settingsSync.ts attaches an in-memory store hydrated from
// config.toml + state.json. Reads come from memory; writes update memory
// synchronously and hand the change to the store's persist callback. Without
// an attached store (browser harness, unit tests) the module keeps its
// original localStorage behaviour.
// ---------------------------------------------------------------------------

type PersistCallback = (
  next: PreferencesSnapshot,
  prev: PreferencesSnapshot,
) => void;

let memoryStore: {
  prefs: PreferencesSnapshot;
  persist: PersistCallback;
} | null = null;

const listeners = new Set<() => void>();

/** Called after every preference change (any storage mode); returns unsubscribe. */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notifyPreferences = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

export function attachPreferencesStore(
  initial: DeepReadonly<VaultPreferences>,
  persist: PersistCallback,
): void {
  memoryStore = { prefs: toSnapshot(null, initial), persist };
}

export function detachPreferencesStore(): void {
  memoryStore = null;
}

export function isPreferencesStoreAttached(): boolean {
  return memoryStore !== null;
}

/** Replace the in-memory preferences without persisting (used on reload). */
export function replaceStoredPreferences(
  next: DeepReadonly<VaultPreferences>,
): void {
  if (memoryStore) {
    memoryStore.prefs = toSnapshot(memoryStore.prefs, next);
  }
  notifyPreferences();
}

function getStorage(win?: Window | null): Storage | null {
  try {
    return (
      win?.localStorage ??
      (typeof window !== "undefined" ? window.localStorage : null)
    );
  } catch {
    return null;
  }
}

/** Raw preferences object stored in localStorage, if any (for migration). */
export function readLocalStoragePreferences(
  win?: Window | null,
): Partial<VaultPreferences> | null {
  const storage = getStorage(win);
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<VaultPreferences>)
      : null;
  } catch {
    return null;
  }
}

// localStorage mode: the last stored string and its normalised preferences.
// getPreferences runs on many renders; re-parsing and re-normalising an
// unchanged string each time cost ~1 ms per call at 4x CPU throttling.
let parsedCache: { raw: string; prefs: PreferencesSnapshot } | null = null;

function readStoredRaw(win?: Window | null): string | null {
  const storage = getStorage(win);
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getPreferences(win?: Window | null): PreferencesSnapshot {
  if (memoryStore) {
    return memoryStore.prefs;
  }
  const raw = readStoredRaw(win);
  if (!raw) {
    parsedCache = null;
    return getDefaultsSnapshot();
  }
  if (parsedCache?.raw !== raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // unreadable: defaults, as for a missing value
    }
    if (!parsed || typeof parsed !== "object") {
      parsedCache = null;
      return getDefaultsSnapshot();
    }
    parsedCache = {
      raw,
      prefs: toSnapshot(
        parsedCache?.prefs ?? getDefaultsSnapshot(),
        normalizePreferences(parsed),
      ),
    };
  }
  return parsedCache.prefs;
}

/**
 * Save machine state (state.json fields such as open tabs or the palette's
 * recent items) without telling preference subscribers: nothing on screen
 * reads these fields live, and a notification re-renders the whole app.
 * Readers see the new value on their next getPreferences.
 */
export function saveMachineState(
  partial: DeepReadonly<Partial<VaultPreferences>>,
  win?: Window | null,
): void {
  if (memoryStore) {
    const prev = memoryStore.prefs;
    const next = toSnapshot(prev, { ...prev, ...partial });
    memoryStore.prefs = next;
    try {
      memoryStore.persist(next, prev);
    } catch {
      // persistence failures are reported by the store, never thrown here
    }
    return;
  }
  const current = getPreferences(win);
  const next = toSnapshot(current, { ...current, ...partial });
  const storage = getStorage(win);
  try {
    const written = JSON.stringify(next);
    storage?.setItem(STORAGE_KEY, written);
    parsedCache = { raw: written, prefs: next };
  } catch {
    // quota or security error: not remembered
  }
}

/**
 * `trusted`: the caller's values are already in normalised form (for example
 * a string list and a string path), so the written snapshot goes straight into
 * the parse cache instead of being parsed and normalised again on the next
 * read (about 3 ms at 4x CPU throttling on vault open).
 */
export function updatePreferences(
  partial: DeepReadonly<Partial<VaultPreferences>>,
  win?: Window | null,
  trusted = false,
): PreferencesSnapshot {
  // Changing the enabled list records which official plugins that leaves off.
  if (partial.pluginsEnabled && !partial.pluginsDisabled) {
    partial = {
      ...partial,
      pluginsDisabled: disabledOfficial(partial.pluginsEnabled),
    };
  }
  if (memoryStore) {
    const prev = memoryStore.prefs;
    const next = toSnapshot(prev, { ...prev, ...partial });
    memoryStore.prefs = next;
    try {
      memoryStore.persist(next, prev);
    } catch {
      // persistence failures are reported by the store, never thrown here
    }
    notifyPreferences();
    return next;
  }
  const current = getPreferences(win);
  const next = toSnapshot(current, { ...current, ...partial });
  const storage = getStorage(win);
  let stored = false;
  let written: string | null = null;
  if (storage) {
    try {
      written = JSON.stringify(next);
      storage.setItem(STORAGE_KEY, written);
      stored = true;
    } catch {
      // quota or security error ignored gracefully
    }
  }
  if (stored && trusted && written !== null) {
    parsedCache = { raw: written, prefs: next };
    notifyPreferences();
    return next;
  }
  notifyPreferences();
  // Re-read so the returned snapshot is the one later reads share identity with.
  return stored ? getPreferences(win) : next;
}

export function loadPreferences(win?: Window | null): PreferencesSnapshot {
  return getPreferences(win);
}

export function savePreferences(
  partial: DeepReadonly<Partial<VaultPreferences>>,
  win?: Window | null,
): PreferencesSnapshot {
  return updatePreferences(partial, win);
}

export function resolveTheme(
  theme: VaultTheme,
  win?: Window | null,
): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  if (win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
    return "dark";
  }
  return "light";
}

export function getTheme(win?: Window | null): VaultTheme {
  return getPreferences(win).theme;
}

export function setTheme(theme: VaultTheme, win?: Window | null): void {
  updatePreferences({ theme }, win);
}

export function getAutosaveDelayMs(win?: Window | null): number {
  return getPreferences(win).autosaveDelayMs;
}

export function setAutosaveDelayMs(delayMs: number, win?: Window | null): void {
  updatePreferences({ autosaveDelayMs: delayMs }, win);
}

export function getEditorDefaults(win?: Window | null) {
  const prefs = getPreferences(win);
  return {
    defaultFontFamily: prefs.defaultFontFamily,
    defaultFontSize: prefs.defaultFontSize,
    defaultStrokeColor: prefs.defaultStrokeColor,
    defaultBackgroundColor: prefs.defaultBackgroundColor,
    defaultFillStyle: prefs.defaultFillStyle,
    defaultStrokeWidth: prefs.defaultStrokeWidth,
    defaultRoughness: prefs.defaultRoughness,
    defaultCanvasBackground: prefs.defaultCanvasBackground,
  };
}

export function setEditorDefaults(
  defaults: Partial<
    Pick<
      VaultPreferences,
      | "defaultFontFamily"
      | "defaultFontSize"
      | "defaultStrokeColor"
      | "defaultBackgroundColor"
      | "defaultFillStyle"
      | "defaultStrokeWidth"
      | "defaultRoughness"
      | "defaultCanvasBackground"
    >
  >,
  win?: Window | null,
): void {
  updatePreferences(defaults, win);
}

export function getRecentVaults(win?: Window | null): readonly string[] {
  return getPreferences(win).recentVaults;
}

export function getLastVaultPath(win?: Window | null): string | null {
  return getPreferences(win).lastVaultPath;
}

export function addRecentVault(vaultPath: string, win?: Window | null): void {
  if (!vaultPath) {
    return;
  }
  const current = getRecentVaults(win);
  const filtered = current.filter((p) => p !== vaultPath);
  const updated = [vaultPath, ...filtered].slice(0, 10);
  updatePreferences(
    { recentVaults: updated, lastVaultPath: vaultPath },
    win,
    true,
  );
}

export function removeRecentVault(
  vaultPath: string,
  win?: Window | null,
): void {
  const current = getRecentVaults(win);
  const updated = current.filter((p) => p !== vaultPath);
  updatePreferences({ recentVaults: updated }, win);
}

export function getExpandedFolders(
  vaultKey: string,
  win?: Window | null,
): readonly string[] {
  const prefs = getPreferences(win);
  return prefs.expandedFolders[vaultKey] ?? [""];
}

export function setExpandedFolders(
  vaultKey: string,
  folders: string[],
  win?: Window | null,
): void {
  const current = getPreferences(win);
  const nextExpanded = {
    ...current.expandedFolders,
    [vaultKey]: folders,
  };
  updatePreferences({ expandedFolders: nextExpanded }, win);
}

export function toggleFolderExpanded(
  vaultKey: string,
  folderPath: string,
  win?: Window | null,
): boolean {
  const current = new Set(getExpandedFolders(vaultKey, win));
  let isExpanded: boolean;
  if (current.has(folderPath)) {
    current.delete(folderPath);
    isExpanded = false;
  } else {
    current.add(folderPath);
    isExpanded = true;
  }
  setExpandedFolders(vaultKey, Array.from(current), win);
  return isExpanded;
}

export function getNavigatorCollapsed(win?: Window | null): boolean {
  return getPreferences(win).navigatorCollapsed;
}

export function setNavigatorCollapsed(
  collapsed: boolean,
  win?: Window | null,
): void {
  updatePreferences({ navigatorCollapsed: collapsed }, win);
}

/** True while Offline mode is on (`network.offline`, or the old `network.enabled = false`). */
export const isOffline = (
  prefs: Pick<VaultPreferences, "networkOffline" | "networkEnabled">,
): boolean => prefs.networkOffline || !prefs.networkEnabled;
