/**
 * Context menu items plugins declared (`[[contributes.menus]]`). A menu asks
 * `getMenuItems(surface)` when it opens; with no plugin item that is one shared
 * empty array, so the menus cost nothing without plugins. Choosing an item runs
 * the plugin's command, which reads where it was chosen with `ctx.menus.target()`.
 */
import { getAppCommandRunner } from "../commands/appRunner";
import { runHandler } from "../commands/dispatcher";
import { getRegisteredHandler } from "../commands/handlerRegistry";
import { toastStore } from "../toasts/toastStore";

import { readCustomContextKey } from "../commands/contextKeys";

import type { MenuTarget } from "./api";

export type MenuSurface = MenuTarget["surface"];

export interface MenuItemStub {
  pluginId: string;
  pluginName: string;
  surface: MenuSurface;
  /** Text shown in the menu. */
  title: string;
  /** Full command id (`<pluginId>.<command>`). */
  command: string;
  /** Tree rows it shows for; empty means all. */
  kinds: readonly string[];
  /**
   * Shown only while every clause holds (`[[contributes.menus]] when`). A clause is a menu fact
   * (`registerMenuFact`, asked about the row the menu opened on) or a context key; one nobody
   * defines counts as false, so the item stays hidden rather than showing something that cannot work.
   */
  when?: readonly string[];
}

const NONE: readonly MenuItemStub[] = [];
let items: readonly MenuItemStub[] = NONE;
const bySurface = new Map<MenuSurface, readonly MenuItemStub[]>();

const rebuild = () => {
  bySurface.clear();
};

/** Registers a plugin's items; the returned function removes them. */
export function addMenuItems(added: readonly MenuItemStub[]): () => void {
  if (added.length === 0) {
    return () => {};
  }
  items = [...items, ...added];
  rebuild();
  return () => {
    items = items.filter((i) => !added.includes(i));
    rebuild();
  };
}

/** The items for a surface, in registration order (a stable array until the registry changes). */
export function getMenuItems(surface: MenuSurface): readonly MenuItemStub[] {
  if (items === NONE) {
    return NONE;
  }
  let list = bySurface.get(surface);
  if (!list) {
    list = items.filter((i) => i.surface === surface);
    bySurface.set(surface, list);
  }
  return list;
}

/**
 * Runs a command by id the way the palette does. No plugin host import here: the menus load with
 * the app, and the plugin host must stay out of the startup graph (startupGraph.test.ts).
 */
export function runCommand(id: string): void {
  const runner = getAppCommandRunner();
  if (runner) {
    if (!runner(id)) {
      throw new Error(`Command "${id}" is unknown or not available now`);
    }
    return;
  }
  const handler = getRegisteredHandler(id);
  if (!handler) {
    throw new Error(`Command "${id}" is unknown or not available now`);
  }
  runHandler(id, handler);
}

const targets = new Map<string, MenuTarget>();
/** A chosen item whose command has not started yet (the plugin may still be loading). */
let pending: { command: string; target: MenuTarget; at: number } | null = null;
/** A command that never starts (not available now) must not hand its target to a later run. */
const PENDING_MS = 15_000;

/** Where the menu item that started this plugin's running command was chosen. */
export const getMenuTarget = (pluginId: string): MenuTarget | null =>
  targets.get(pluginId) ?? null;

/**
 * Called when a plugin's command starts: when a menu item started it, its target is readable
 * through `ctx.menus.target()` until the returned function is called (the command finished).
 */
export function beginMenuRun(pluginId: string, command: string): () => void {
  const hit =
    pending &&
    pending.command === command &&
    performance.now() - pending.at < PENDING_MS
      ? pending.target
      : null;
  pending = null;
  if (!hit) {
    return () => {};
  }
  targets.set(pluginId, hit);
  return () => {
    if (targets.get(pluginId) === hit) {
      targets.delete(pluginId);
    }
  };
}

/**
 * For app commands a menu item runs (no plugin host): the row the item was chosen on, once, or
 * null when the command was started another way (palette, key).
 */
export function takeMenuTarget(command: string): MenuTarget | null {
  const hit =
    pending &&
    pending.command === command &&
    performance.now() - pending.at < PENDING_MS
      ? pending.target
      : null;
  if (hit) {
    pending = null;
  }
  return hit;
}

/** Runs the item's command; the command reads `target` through `ctx.menus.target()`. */
export function runMenuItem(item: MenuItemStub, target: MenuTarget): void {
  pending = { command: item.command, target, at: performance.now() };
  try {
    runCommand(item.command);
  } catch (err) {
    pending = null;
    toastStore.push({
      message: `${item.pluginName}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      kind: "error",
    });
  }
}

/** Answers a `when` clause for the row a menu opened on. May look at a file, so it may be async. */
export type MenuFact = (target: MenuTarget) => boolean | Promise<boolean>;
const facts = new Map<string, MenuFact>();

/** Registers a fact menu items can name in `when`; the returned function removes it. */
export function registerMenuFact(key: string, fact: MenuFact): () => void {
  facts.set(key, fact);
  return () => {
    if (facts.get(key) === fact) {
      facts.delete(key);
    }
  };
}

/** The `when` clauses that need the target (a registered fact), without duplicates. */
export function factClauses(list: readonly MenuItemStub[]): string[] {
  const out = new Set<string>();
  for (const it of list) {
    for (const c of it.when ?? []) {
      const key = c.startsWith("!") ? c.slice(1) : c;
      if (facts.has(key)) {
        out.add(key);
      }
    }
  }
  return [...out];
}

/** Resolves the given fact clauses for a target; a fact that throws counts as false. */
export async function resolveFacts(
  clauses: readonly string[],
  target: MenuTarget,
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  await Promise.all(
    clauses.map(async (c) => {
      try {
        out[c] = !!(await facts.get(c)?.(target));
      } catch {
        out[c] = false;
      }
    }),
  );
  return out;
}

/**
 * Whether an item shows: no `when` = always; a fact that has not answered yet = hidden (the menu
 * redraws when it does); a context key is read now; an unknown clause = false (`!clause` is the opposite of a known one).
 */
export function menuItemShown(
  item: MenuItemStub,
  resolved: Readonly<Record<string, boolean>>,
): boolean {
  return (item.when ?? []).every((clause) => {
    const not = clause.startsWith("!");
    const c = not ? clause.slice(1) : clause;
    if (facts.has(c)) {
      // A fact that has not answered keeps the item hidden, negated or not.
      return c in resolved && resolved[c] !== not;
    }
    return readCustomContextKey(c) !== not;
  });
}
