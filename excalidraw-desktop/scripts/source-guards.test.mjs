import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sourceGuardTests } from "./source-guards.mjs";

test("finds tests that read sources, skips benches and plain tests", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "guards-"));
  try {
    mkdirSync(path.join(dir, "src/tests"), { recursive: true });
    const put = (f, s) => writeFileSync(path.join(dir, f), s);
    put("src/tests/a.guard.test.ts", 'const t = readFileSync("x");');
    put("src/tests/b.family.test.tsx", "for (const f of readdirSync(d)) {}");
    put("src/tests/c.test.ts", 'import { x } from "../x";');
    put("src/tests/d.bench.test.ts", 'readFileSync("x");');
    put("src/tests/e.ts", 'readFileSync("x");');
    assert.deepEqual(sourceGuardTests(dir), [
      "src/tests/a.guard.test.ts",
      "src/tests/b.family.test.tsx",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app has source guards to run (the walk reaches src/)", () => {
  const desktop = path.resolve(import.meta.dirname, "..");
  const found = sourceGuardTests(path.join(desktop, "src"));
  assert.ok(found.includes("tests/tagCopies.guard.test.ts"), found.join("\n"));
});
