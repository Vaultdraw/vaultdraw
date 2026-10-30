import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("plain, true words in settings (design review 2026-10-30)", () => {
  it("an enabled plugin that is not loaded yet says it loads when used", () => {
    const row = read("components/settings/pages/PluginRow.tsx");
    expect(row).not.toContain("Not loaded");
    expect(row).toContain("Loads when used");
  });
  it("the Accent field placeholder fits its 110 px box", () => {
    const m = /aria-label="Accent colour hex"\s+placeholder="([^"]+)"/.exec(
      read("components/settings/pages/Appearance.tsx"),
    );
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(10);
  });
  it("the AI setting does not claim to be the offline switch", () => {
    const schema = read("components/settings/schema.ts");
    expect(schema).not.toMatch(/Off keeps your device fully offline/);
    expect(schema).toContain("no AI app can read or change your drawings");
  });
});
