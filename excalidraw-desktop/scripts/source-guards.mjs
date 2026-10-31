/**
 * Test files that read the app's sources from disk (guards and family sweeps: readdirSync,
 * readFileSync, globSync). They import nothing they check, so `vitest related` never selects them,
 * and a change that breaks one merges unseen (toimprove 266: three were red on main at once).
 * They take seconds, so the fast tier runs all of them whenever app sources change.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const READS_DISK = /\b(readdirSync|readFileSync|globSync)\(/;
const TEST = /\.test\.tsx?$/;
const SKIP = new Set(["node_modules", "dist", ".cache"]);

/** Paths (relative to `dir`) of every test under `dir` that reads files from disk; benches excluded. */
export function sourceGuardTests(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) {
        if (!SKIP.has(name)) {
          walk(p);
        }
      } else if (
        TEST.test(name) &&
        !name.endsWith(".bench.test.ts") &&
        READS_DISK.test(readFileSync(p, "utf8"))
      ) {
        out.push(path.relative(dir, p).split(path.sep).join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}
