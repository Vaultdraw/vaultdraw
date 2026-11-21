/**
 * Unified command palette (F41) contract. The palette (Cmd+P) shows one
 * ranked list: drawings by name (a built-in source, see QuickSwitcher) plus
 * items from providers. A provider turns one feature's state into entries:
 * the command registry, Excalidraw's editor actions, installed themes, pen
 * presets, and later library items. Providers are asked once per open (and
 * again after a Mod+Enter run), never while the palette is closed.
 */
import type { ReactNode } from "react";

export interface PaletteItem {
  /**
   * Stable across opens and sessions (the recents key), unique across
   * providers: "command:file.save", "editor:alignLeft", "theme:Dracula".
   */
  key: string;
  /** Displayed and searched, e.g. "Align left", "Theme: Dracula". */
  title: string;
  /** Extra search terms, matched but not shown. */
  keywords?: readonly string[];
  /** Muted label after the title ("Appearance", "Editor", "Tools"). */
  group: string;
  /** Display text of the shortcut ("⇧⌘L"); empty or absent = none. */
  shortcut?: string;
  icon?: ReactNode;
  /** The current choice in a family (current theme, mode, paper style). */
  checked?: boolean;
  /**
   * Tab / → on this row drills into this query (e.g. "Theme: ").
   * Default: the title's prefix up to and including ": ", if any.
   */
  drill?: string;
  /**
   * A "Family: X" row: Enter and Tab both browse `drill` instead of running.
   * The row shows a "Tab browse" hint.
   */
  family?: boolean;
  /**
   * Set on rows that can be shown live (a theme's key): moving the highlight
   * onto the row with the keyboard previews it; leaving the row restores.
   */
  previewKey?: string;
  /** Runs the entry. Called after the palette closed, or in place (Mod+Enter). */
  run(): void | Promise<void>;
}

export interface PaletteProvider {
  /** Unique id; registering the same id again replaces the old provider. */
  id: string;
  /**
   * Entries available right now (already filtered by the feature's own
   * predicates). Must be synchronous and cheap: it runs on open.
   */
  items(): readonly PaletteItem[];
}
