import { describe, expect, it } from "vitest";

import { FOLDER_SCAN_CAP, menuFacts } from "./menuFacts";

import type { VaultEntry } from "../vault/types";

const MARK = { "plugins.markdown-import": { heading: 1 } };
const imported = JSON.stringify({
  type: "excalidraw",
  appState: { pageSetup: { enabled: true } },
  elements: [{ id: "h", type: "text", fontFamily: 5, customData: MARK }],
});
const plain = JSON.stringify({
  type: "excalidraw",
  appState: {},
  elements: [{ id: "t", type: "text" }],
});

const entry = (path: string, kind: VaultEntry["kind"]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind,
  modifiedAt: 0,
  size: 1,
});

const target = {
  look: {},
  fontFamily: 5,
  headingColors: true,
  measure: () => 0,
} as never;

const facts = (files: Record<string, string>) => {
  let reads = 0;
  const f = menuFacts(() => ({
    handle: "h",
    target,
    repository: {
      listDirectory: async (_h: string, dir: string) =>
        Object.keys(files)
          .filter((p) => p.startsWith(dir ? `${dir}/` : ""))
          .map((p) => p.slice(dir ? dir.length + 1 : 0))
          .map((rest, i) => {
            const base = dir ? `${dir}/` : "";
            const first = rest.split("/")[0];
            return rest.includes("/")
              ? entry(`${base}${first}`, "folder")
              : entry(
                  Object.keys(files).filter((p) => p.startsWith(base))[i],
                  "drawing",
                );
          })
          .filter((e, i, a) => a.findIndex((x) => x.path === e.path) === i),
      readDrawing: async (_h: string, path: string) => {
        reads++;
        if (!(path in files)) {
          throw new Error("missing");
        }
        return { json: files[path], revision: "1", readOnly: false } as never;
      },
    },
  }));
  return { f, reads: () => reads };
};

const at = (path: string | null) => ({ surface: "tree" as const, path });

describe("import menu facts (a row's menu shows an import action only where it can act)", () => {
  it("importedNote: true for an import, false for a hand-made drawing, a note, a missing file", async () => {
    const { f } = facts({ "a.excalidraw": imported, "b.excalidraw": plain });
    expect(await f.importedNote(at("a.excalidraw"))).toBe(true);
    expect(await f.importedNote(at("b.excalidraw"))).toBe(false);
    expect(await f.importedNote(at("n.md"))).toBe(false);
    expect(await f.importedNote(at("gone.excalidraw"))).toBe(false);
    expect(await f.importedNote(at(null))).toBe(false);
  });

  it("folderHasImports: finds an import in a subfolder, false for a folder of own drawings", async () => {
    const { f } = facts({
      "x/own.excalidraw": plain,
      "y/deep/in.excalidraw": imported,
    });
    expect(await f.folderHasImports(at("x"))).toBe(false);
    expect(await f.folderHasImports(at("y"))).toBe(true);
  });

  it("folderHasImports: a folder bigger than the cap shows the item instead of hiding it", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= FOLDER_SCAN_CAP + 1; i++) {
      files[`big/d${i}.excalidraw`] = plain;
    }
    const { f, reads } = facts(files);
    expect(await f.folderHasImports(at("big"))).toBe(true);
    expect(reads()).toBeLessThanOrEqual(FOLDER_SCAN_CAP);
  });
});
