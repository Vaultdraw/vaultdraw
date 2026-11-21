/**
 * toimprove 343: the app's webview is incognito, so localStorage is empty at
 * every launch. Only config.toml and state.json survive a quit. These tests
 * simulate a restart the way the packaged app does it: the settings runtime
 * stops, localStorage is cleared, and the runtime starts again from what the
 * fake native side kept. Playwright cannot see this bug: it keeps
 * localStorage across reloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  getPreferences,
  updatePreferences,
  type VaultPreferences,
} from "../vault/preferences";
import { createWorkspaceStore } from "../tabs/workspaceStore";
import { getDockVisible, setDockVisible } from "../links/dockState";
import {
  dismissGitNotice,
  isGitNoticeDismissed,
} from "../history/gitNoticeState";
import { getRecent, recordRecent } from "../palette/recent";
import {
  cachedVaultAppearance,
  rememberVaultAppearance,
} from "../theme/useVaultAppearance";

import {
  CONFIG_MAPPING,
  disposeSettings,
  flushSettings,
  initSettings,
  STATE_FIELDS,
} from "../vault/settingsSync";

import type { TabsState } from "../tabs/types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The native side: config.toml and state.json, which outlive the webview. */
export const createDisk = () => {
  const disk = {
    config: {} as Record<string, Record<string, unknown>>,
    state: {} as Record<string, unknown>,
    invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "load_settings":
          return {
            configDir: "/home/u/.config/vaultdraw",
            configPath: "/home/u/.config/vaultdraw/config.toml",
            statePath: "/home/u/.local/state/vaultdraw/state.json",
            config: clone(disk.config),
            configError: null,
            state: clone(disk.state),
          };
        case "update_config":
          for (const { key, value } of (args as any).changes) {
            const [table, name] = key.split(".");
            disk.config[table] ??= {};
            if (value === null) {
              delete disk.config[table][name];
            } else {
              disk.config[table][name] = value;
            }
          }
          return undefined;
        case "write_state":
          disk.state = clone((args as any).state);
          return undefined;
        default:
          return undefined;
      }
    }),
    listen: vi.fn(async () => () => undefined),
  };
  return disk;
};

export type Disk = ReturnType<typeof createDisk>;

export const launch = (disk: Disk) =>
  initSettings(window, {
    tauri: true,
    invoke: disk.invoke as any,
    listen: disk.listen as any,
  });

/** Quit (pending state is written, as the quit barrier does) and launch again. */
export const restart = async (disk: Disk) => {
  await flushSettings();
  disposeSettings();
  window.localStorage.clear();
  await launch(disk);
};

/**
 * One non-default value per state.json field. Typed as a full record, so a
 * new STATE_FIELDS entry without a sample fails the type check.
 */
const SAMPLES: { [K in typeof STATE_FIELDS[number]]: VaultPreferences[K] } = {
  recentVaults: ["/v/one", "/v/two"],
  lastVaultPath: "/v/one",
  navigatorCollapsed: true,
  navigatorWidth: 333,
  expandedFolders: { "/v/one": ["", "notes"] },
  tagsPane: { "/v/one": { sort: "count", open: false, collapsed: ["a"] } },
  tabsSessions: {
    "/v/one": {
      v: 1,
      tabs: [
        { path: "a.excalidraw", pinned: true },
        { path: "b.excalidraw", pinned: false },
      ],
      active: 1,
      mru: [1, 0],
    },
  },
  exportOptions: {
    scale: 3,
    background: false,
    embedScene: true,
    pattern: false,
    pageShaped: true,
  },
  linksDock: true,
  gitNoticeDismissed: ["/v/one"],
  paletteRecent: { files: ["drawing:a.excalidraw"], commands: ["command:x"] },
  vaultAppearance: { "/v/one": { colorTheme: "Nord", theme: "dark" } },
  hasPanned: true,
  profileChoice: "work",
  focusOn: true,
};

/**
 * Preference fields that are on purpose NOT kept across a restart, each
 * with its reason. Everything else must be in config.toml or state.json.
 */
const SESSION_ONLY: Record<string, string> = {};

/** Written to config.toml outside CONFIG_MAPPING (dynamic tables). */
const CONFIG_EXTRAS = [
  "hotkeys",
  "pluginSettings",
  "keysLabels",
  "userCommands",
];

describe("durable state: every choice survives a restart", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    disposeSettings();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("has a sample for exactly the state.json fields", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...STATE_FIELDS].sort());
  });

  it.each(STATE_FIELDS.map((f) => [f]))(
    "keeps %s across a restart",
    async (field) => {
      const disk = createDisk();
      await launch(disk);
      const value = SAMPLES[field as keyof typeof SAMPLES];
      expect(getPreferences(window)[field]).not.toEqual(value);
      updatePreferences(
        { [field]: value } as Partial<VaultPreferences>,
        window,
      );
      await restart(disk);
      expect(getPreferences(window)[field]).toEqual(value);
    },
  );

  it("every preference is kept in config.toml or state.json, or listed as per-session with a reason", () => {
    const config = new Set<string>([
      ...CONFIG_MAPPING.map((m) => m.field as string),
      ...CONFIG_EXTRAS,
    ]);
    const state = new Set<string>(STATE_FIELDS);
    const lost = Object.keys(DEFAULT_PREFERENCES).filter(
      (k) => !config.has(k) && !state.has(k) && !(k in SESSION_ONLY),
    );
    expect(lost).toEqual([]);
    for (const [field, reason] of Object.entries(SESSION_ONLY)) {
      expect(field in DEFAULT_PREFERENCES, field).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

describe("durable state: what each feature keeps across a restart", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    disposeSettings();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("open tabs come back after a restart, per vault, with the active tab and pins", async () => {
    const disk = createDisk();
    await launch(disk);
    const tab = (n: number, pinned = false) => ({
      id: `t${n}`,
      path: `d${n}.excalidraw`,
      pinned,
      missing: false,
    });
    const before = createWorkspaceStore();
    before.scheduleSave("/v/one", {
      tabs: [tab(1, true), tab(2), tab(3)],
      activeId: "t2",
      mru: ["t2", "t1", "t3"],
      closed: [],
    } as TabsState);
    before.scheduleSave("/v/two", {
      tabs: [tab(9)],
      activeId: "t9",
      mru: ["t9"],
      closed: [],
    } as TabsState);
    before.flush(); // the quit barrier's prepareLeave
    await restart(disk);
    const after = createWorkspaceStore();
    const one = after.load("/v/one", () => true);
    expect(one?.tabs.map((t) => [t.path, t.pinned])).toEqual([
      ["d1.excalidraw", true],
      ["d2.excalidraw", false],
      ["d3.excalidraw", false],
    ]);
    expect(one?.activeIndex).toBe(1);
    expect(after.load("/v/two", () => true)?.tabs[0].path).toBe(
      "d9.excalidraw",
    );
    after.clear("/v/two");
    await restart(disk);
    expect(createWorkspaceStore().load("/v/two", () => true)).toBeNull();
  });

  it("the Links dock stays shown after a restart", async () => {
    const disk = createDisk();
    await launch(disk);
    expect(getDockVisible(window)).toBe(false);
    setDockVisible(true, window);
    await restart(disk);
    expect(getDockVisible(window)).toBe(true);
    setDockVisible(false, window);
    await restart(disk);
    expect(getDockVisible(window)).toBe(false);
  });

  it("the git notice's Not now is remembered per vault after a restart", async () => {
    const disk = createDisk();
    await launch(disk);
    dismissGitNotice("/v/one", window);
    await restart(disk);
    expect(isGitNoticeDismissed("/v/one", window)).toBe(true);
    expect(isGitNoticeDismissed("/v/two", window)).toBe(false);
  });

  it("the palette's recent drawings and commands come back after a restart", async () => {
    const disk = createDisk();
    await launch(disk);
    recordRecent("drawing:a.excalidraw", window);
    recordRecent("drawing:b.excalidraw", window);
    recordRecent("command:view.toggleTheme", window);
    await restart(disk);
    expect(getRecent("files", window)).toEqual([
      "drawing:b.excalidraw",
      "drawing:a.excalidraw",
    ]);
    expect(getRecent("commands", window)).toEqual(["command:view.toggleTheme"]);
  });

  it("a vault's own theme is known at the next launch before its settings load (no flash)", async () => {
    const disk = createDisk();
    await launch(disk);
    rememberVaultAppearance(window, "/v/one", {
      colorTheme: "Nord",
      theme: "dark",
    });
    await restart(disk);
    expect(cachedVaultAppearance(window, "/v/one")).toEqual({
      colorTheme: "Nord",
      theme: "dark",
    });
    expect(cachedVaultAppearance(window, "/v/two")).toEqual({});
  });
});
