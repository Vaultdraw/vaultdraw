/**
 * Guard (toimprove 343): the app's webview is incognito, so localStorage and
 * sessionStorage are empty at every launch. A choice kept only there is lost
 * when the user quits. Keep user state in the preferences (state.json fields
 * in vault/settingsSync.ts STATE_FIELDS, or config.toml) instead.
 *
 * This scan lists every line of app code that touches web storage. Each file
 * is allowed with a reviewed reason and an exact count, so a new use (or a
 * new key in an allowed file) fails here until someone checks it is not user
 * state. A removed use fails too, so the list stays true.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

const DESKTOP = join(__dirname, "..", "..");
const USE = /\b(localStorage|sessionStorage)\b/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

/** File -> [number of code lines using web storage, why that is fine]. */
const ALLOWED: Record<string, [number, string]> = {
  "src/vault/preferences.ts": [
    2,
    "Browser mode only: in the app the preferences live in memory and are saved to config.toml and state.json (settingsSync attaches the store).",
  ],
  "src/extensionSwitches/bisectState.ts": [
    3,
    "Browser harness only: in the app the bisect state is in the launch file and arrives with load_settings.",
  ],
  "src/theme/catalogue/backends.ts": [
    2,
    "Browser harness only (browserCatalogueBackend): the app uses the Rust catalogue cache.",
  ],
  "src/theme/install/browserStore.ts": [
    1,
    "Browser harness only: the app installs themes into the config folder.",
  ],
  "src/plugins/host/fakeBackend.ts": [
    1,
    "Browser fake of the plugin host: reads the harness catalogue cache.",
  ],
  "src/perf/runDesktopPerf.ts": [
    1,
    "Perf run: blocks the recent-vaults preference write during the run.",
  ],
  "src/smoke/exportSmoke.ts": [
    3,
    "Smoke run: saves and restores one browser-mode key around a step.",
  ],
  "src/smoke/runDesktopSmoke.ts": [
    2,
    "Smoke run: suppresses a preference write; the reload marker lives in sessionStorage on purpose (one reload, same process).",
  ],
  "src/smoke/reloadSmoke.ts": [
    1,
    "Smoke run: the reload marker must survive only one in-process reload.",
  ],
};

// The file system, not git: a new file is checked before it is committed.
const files = (
  readdirSync(join(DESKTOP, "src"), { recursive: true }) as string[]
)
  .map((f) => `src/${f.split(sep).join("/")}`)
  .filter(
    (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.|\/tests?\/|\.d\.ts$/.test(f),
  );

const found: Record<string, number> = {};
for (const f of files) {
  const lines = readFileSync(join(DESKTOP, f), "utf8").split("\n");
  const n = lines.filter((l) => !COMMENT.test(l) && USE.test(l)).length;
  if (n > 0) {
    found[f] = n;
  }
}

describe("guard: no user state only in web storage (lost at every quit)", () => {
  it("every use of localStorage or sessionStorage is a reviewed one", () => {
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED).map(([f, [n]]) => [f, n]),
    );
    expect(found).toEqual(allowed);
  });

  it("each allowed file says why", () => {
    for (const [f, [, why]] of Object.entries(ALLOWED)) {
      expect(why.length, f).toBeGreaterThan(30);
    }
  });
});
