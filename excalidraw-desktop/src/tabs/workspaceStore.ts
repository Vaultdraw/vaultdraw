/**
 * Tabs (F5): session persistence per vault (PLAN.md §3 "Session restore").
 * Stored in machine state (state.json via preferences), never inside the vault. Event-driven only: a
 * timer exists solely while a save is pending. Independent of tabsModel: the
 * glue builds TabsState from the plain data deserialize returns.
 *
 * Read-only vaults: the caller simply does not call scheduleSave.
 * Storage unavailable or throwing: silently no persistence.
 */
import {
  getPerVault,
  getPreferences,
  MAX_TABS_SESSIONS,
  putPerVault,
  saveMachineState,
} from "../vault/preferences";

import type { TabsState, ViewState, WorkspaceSessionV1 } from "./types";

export const SESSION_KEY_PREFIX = "vaultdraw.tabs.session:";
/** Bounds the work done on a corrupt or hostile payload. */
export const MAX_SESSION_TABS = 500;
const ZOOM_MIN = 0.01;
const ZOOM_MAX = 1000;
const COORD_MAX = 1e9;

export type RestoredSession = {
  tabs: { path: string | null; pinned: boolean; view?: ViewState }[];
  activeIndex: number;
  /** Indexes into tabs, most recent first, a permutation of all tabs. */
  mru: number[];
};

export function sessionKey(canonicalVaultPath: string): string {
  return `${SESSION_KEY_PREFIX}${canonicalVaultPath}`;
}

/** Drops ids, missing flags and the closed stack; MRU becomes indexes. */
export function serialize(state: TabsState): WorkspaceSessionV1 {
  const index = new Map(state.tabs.map((t, i) => [t.id, i]));
  const mru: number[] = [];
  for (const id of state.mru) {
    const i = index.get(id);
    if (i !== undefined) {
      mru.push(i);
    }
  }
  return {
    v: 1,
    tabs: state.tabs.map((t) => {
      const out: WorkspaceSessionV1["tabs"][number] = {
        path: t.path,
        pinned: t.pinned,
      };
      if (t.view) {
        out.view = {
          scrollX: t.view.scrollX,
          scrollY: t.view.scrollY,
          zoom: t.view.zoom,
        };
      }
      return out;
    }),
    active: Math.max(0, index.get(state.activeId) ?? 0),
    mru,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const coord = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= COORD_MAX;

function parseView(v: unknown): ViewState | undefined | null {
  if (v === undefined) {
    return undefined;
  }
  if (!isObj(v)) {
    return null;
  }
  const { scrollX, scrollY, zoom } = v;
  if (
    !coord(scrollX) ||
    !coord(scrollY) ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom < ZOOM_MIN ||
    zoom > ZOOM_MAX
  ) {
    return null;
  }
  return { scrollX, scrollY, zoom };
}

/**
 * Strict validation. Returns null for garbage (wrong version/types, bad view,
 * too many tabs). Missing paths and duplicates are dropped, indexes fixed up,
 * pinned tabs ordered first (stable). Active falls back to the MRU-first
 * surviving tab, else 0. Returns null when no tab survives.
 */
export function deserialize(
  raw: unknown,
  exists: (path: string) => boolean,
): RestoredSession | null {
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.tabs)) {
    return null;
  }
  if (raw.tabs.length === 0 || raw.tabs.length > MAX_SESSION_TABS) {
    return null;
  }
  const { active, mru } = raw;
  if (
    typeof active !== "number" ||
    !Number.isInteger(active) ||
    !Array.isArray(mru) ||
    mru.length > MAX_SESSION_TABS
  ) {
    return null;
  }

  type Item = {
    oldIndex: number;
    path: string | null;
    pinned: boolean;
    view?: ViewState;
  };
  const kept: Item[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.tabs.length; i++) {
    const t: unknown = raw.tabs[i];
    if (
      !isObj(t) ||
      typeof t.pinned !== "boolean" ||
      !(t.path === null || typeof t.path === "string")
    ) {
      return null;
    }
    const view = parseView(t.view);
    if (view === null) {
      return null;
    }
    const path = t.path as string | null;
    if (path !== null) {
      if (seen.has(path) || !exists(path)) {
        continue;
      }
      seen.add(path);
    }
    kept.push({
      oldIndex: i,
      path,
      pinned: t.pinned,
      ...(view ? { view } : {}),
    });
  }
  if (kept.length === 0) {
    return null;
  }

  // Pinned first (stable).
  const ordered = [
    ...kept.filter((k) => k.pinned),
    ...kept.filter((k) => !k.pinned),
  ];
  const newIndex = new Map(ordered.map((k, i) => [k.oldIndex, i]));

  const mruOut: number[] = [];
  const inMru = new Set<number>();
  for (const m of mru) {
    const ni = typeof m === "number" ? newIndex.get(m) : undefined;
    if (ni !== undefined && !inMru.has(ni)) {
      inMru.add(ni);
      mruOut.push(ni);
    }
  }
  for (let i = 0; i < ordered.length; i++) {
    if (!inMru.has(i)) {
      mruOut.push(i);
    }
  }
  const activeIndex = newIndex.get(active) ?? mruOut[0] ?? 0;
  // Keep the active tab first in the MRU.
  const mruFinal = [activeIndex, ...mruOut.filter((i) => i !== activeIndex)];

  return {
    tabs: ordered.map(({ path, pinned, view }) => ({
      path,
      pinned,
      ...(view ? { view } : {}),
    })),
    activeIndex,
    mru: mruFinal,
  };
}

type TimerId = unknown;

export type WorkspaceStoreOptions = {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  debounceMs?: number;
  setTimeout?: (fn: () => void, ms: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
};

export type WorkspaceStore = {
  load(
    vaultPath: string,
    exists: (path: string) => boolean,
  ): RestoredSession | null;
  /** Debounced; the latest state wins. No timer runs when nothing is pending. */
  scheduleSave(vaultPath: string, state: TabsState): void;
  /** Writes the pending save now (quit, vault switch). */
  flush(): void;
  clear(vaultPath: string): void;
  /** Drops any pending save without writing. */
  dispose(): void;
};

/**
 * The preferences field `tabsSessions`, seen as a key/value store. In the app
 * it is written to state.json, which outlives the incognito webview (whose
 * localStorage is empty at every launch, toimprove 343); in a plain browser
 * the preferences sit in localStorage as before. Saved silently: nothing on
 * screen reads it live.
 */
function defaultStorage(): WorkspaceStoreOptions["storage"] {
  const vaultOf = (key: string) =>
    key.startsWith(SESSION_KEY_PREFIX)
      ? key.slice(SESSION_KEY_PREFIX.length)
      : null;
  const sessions = () => getPreferences().tabsSessions;
  const put = (vault: string, session: WorkspaceSessionV1 | null) =>
    saveMachineState({
      tabsSessions: putPerVault(sessions(), vault, session, MAX_TABS_SESSIONS),
    });
  return {
    getItem(key) {
      const vault = vaultOf(key);
      const session =
        vault === null ? undefined : getPerVault(sessions(), vault);
      return session ? JSON.stringify(session) : null;
    },
    setItem(key, json) {
      const vault = vaultOf(key);
      if (vault !== null) {
        put(vault, JSON.parse(json) as WorkspaceSessionV1);
      }
    },
    removeItem(key) {
      const vault = vaultOf(key);
      if (vault !== null && getPerVault(sessions(), vault)) {
        put(vault, null);
      }
    },
  };
}

export function createWorkspaceStore(
  opts: WorkspaceStoreOptions = {},
): WorkspaceStore {
  const storage = opts.storage ?? defaultStorage();
  const debounceMs = opts.debounceMs ?? 1000;
  const setT = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT =
    opts.clearTimeout ??
    ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));

  let pending: { vaultPath: string; state: TabsState } | null = null;
  let timer: TimerId | null = null;
  const lastSaved = new Map<string, string>();

  const cancelTimer = () => {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  };

  const write = () => {
    cancelTimer();
    const p = pending;
    pending = null;
    if (!p) {
      return;
    }
    try {
      const json = JSON.stringify(serialize(p.state));
      if (lastSaved.get(p.vaultPath) === json) {
        return;
      }
      storage?.setItem(sessionKey(p.vaultPath), json);
      lastSaved.set(p.vaultPath, json);
    } catch {
      // Storage unavailable or full: the session is simply not remembered.
    }
  };

  return {
    load(vaultPath, exists) {
      try {
        const json = storage?.getItem(sessionKey(vaultPath));
        if (!json) {
          return null;
        }
        const restored = deserialize(JSON.parse(json), exists);
        if (restored) {
          lastSaved.set(vaultPath, json);
        }
        return restored;
      } catch {
        return null;
      }
    },
    scheduleSave(vaultPath, state) {
      if (pending && pending.vaultPath !== vaultPath) {
        write(); // never mix vaults in one pending save
      }
      pending = { vaultPath, state };
      if (timer === null) {
        timer = setT(write, debounceMs);
      }
    },
    flush: write,
    clear(vaultPath) {
      if (pending?.vaultPath === vaultPath) {
        pending = null;
        cancelTimer();
      }
      lastSaved.delete(vaultPath);
      try {
        storage?.removeItem(sessionKey(vaultPath));
      } catch {
        // ignore
      }
    },
    dispose() {
      pending = null;
      cancelTimer();
    },
  };
}
