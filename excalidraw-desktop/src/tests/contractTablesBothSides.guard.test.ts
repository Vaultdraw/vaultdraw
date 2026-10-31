/**
 * Guard: every shared case table is read by BOTH twins.
 *
 * testing.md "Twins share one case table": code that exists twice (a Rust parser and its
 * TypeScript copy, a native command and its browser fake) is pinned by one JSON table that
 * both test suites read. A table only one side reads pins nothing: the other twin drifts
 * unseen. On 2026-10-31 seven twin drifts (toimprove 311, 314-317, 320, 322) escaped because
 * twins older than the rule had no table; this guard keeps every table two-sided from now on.
 *
 * Tables: `src-tauri/crates/<crate>/src/contract/*.json` and `*_cases.json` under a crate's src.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const desktop = path.resolve(__dirname, "../..");
const repo = path.resolve(desktop, "..");
const crates = path.join(desktop, "src-tauri/crates");

const SKIP = new Set(["node_modules", "target", "dist", ".git", ".cache"]);

const walk = (
  dir: string,
  keep: (f: string) => boolean,
  out: string[] = [],
) => {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) {
      continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, keep, out);
    } else if (keep(p)) {
      out.push(p);
    }
  }
  return out;
};

const tables = walk(
  crates,
  (f) =>
    f.endsWith(".json") &&
    f.includes(`${path.sep}src${path.sep}`) &&
    (f.includes(`${path.sep}contract${path.sep}`) || f.endsWith("_cases.json")),
);

const rustSources = walk(path.join(desktop, "src-tauri"), (f) =>
  f.endsWith(".rs"),
).map((f) => fs.readFileSync(f, "utf8"));

const tsTests = [
  path.join(desktop, "src"),
  path.join(repo, "plugins"),
  path.join(repo, "sdk"),
  path.join(repo, "packages"),
]
  .flatMap((d) => walk(d, (f) => /\.test\.(tsx?|mjs)$/.test(f)))
  .map((f) => fs.readFileSync(f, "utf8"));

describe("shared case tables are read by both twins", () => {
  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  for (const t of tables) {
    const name = path.basename(t);
    it(`${path.relative(
      crates,
      t,
    )}: read by a Rust test and a JavaScript or TypeScript test`, () => {
      expect({
        name,
        rust: rustSources.some((s) => s.includes(name)),
        typescript: tsTests.some((s) => s.includes(name)),
      }).toEqual({ name, rust: true, typescript: true });
    });
  }
});
