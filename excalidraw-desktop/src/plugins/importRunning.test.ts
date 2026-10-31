import { describe, expect, it } from "vitest";

import { readCustomContextKey } from "../commands/contextKeys";

import { beginImport, isImportRunning } from "./importerMap";
import { OFFICIAL_PLUGINS } from "./officialPlugins";

describe("Import: Cancel is offered only while an import runs", () => {
  it("import.running follows beginImport, and ending twice counts once", () => {
    expect(readCustomContextKey("import.running")).toBe(false);
    const a = beginImport();
    const b = beginImport();
    expect(readCustomContextKey("import.running")).toBe(true);
    a();
    a();
    expect(isImportRunning()).toBe(true);
    b();
    expect(readCustomContextKey("import.running")).toBe(false);
  });
});

describe("menu entries whose action depends on the row's state name a `when`", () => {
  const STATE_DEPENDENT = [
    "markdown-import.reimport-note",
    "markdown-import.reimport-notes",
  ];
  it("every such official menu entry has a when clause", () => {
    for (const plugin of OFFICIAL_PLUGINS) {
      for (const m of plugin.menus ?? []) {
        if (STATE_DEPENDENT.includes(`${plugin.id}.${m.command}`)) {
          expect(m.when?.length, `${plugin.id}.${m.command}`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });
});
