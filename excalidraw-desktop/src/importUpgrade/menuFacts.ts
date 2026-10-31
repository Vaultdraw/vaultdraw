/**
 * What the menus ask about the row they opened on, so an import action shows only where it can
 * act: on a note the import made, or a folder that holds one. A file is read only when its menu
 * opens, and a folder is scanned up to a cap (a larger folder shows the item, never hides it).
 */
import { hasDrawingExt } from "../vault/fileKind";

import { hasOldLook, IMPORT_MARK } from "./upgradeScene";
import { recognise } from "./recognise";

import type { UpgradeTarget } from "./upgradeScene";
import type { VaultRepository } from "../vault/types";
import type { MenuTarget } from "../plugins/api";

export const FACT_IMPORTED_NOTE = "markdown.importedNote";
export const FACT_IMPORT_OR_OLD = "markdown.importOrOld";
export const FACT_FOLDER_HAS_IMPORTS = "markdown.folderHasImports";

/** Files read when a folder's menu opens; past this the item shows. */
export const FOLDER_SCAN_CAP = 150;

interface Deps {
  repository: Pick<VaultRepository, "listDirectory" | "readDrawing">;
  handle: string;
  target: UpgradeTarget;
}

/** Only these may be imports, so only these are parsed (the mark, or page mode on). */
const mayBeImport = (json: string) =>
  json.includes(IMPORT_MARK) || /"enabled":\s*true/.test(json);

export function menuFacts(deps: () => Deps | null) {
  const readScene = async (path: string | null | undefined) => {
    const d = deps();
    if (!d || !path || !hasDrawingExt(path)) {
      return null;
    }
    try {
      const { json } = await d.repository.readDrawing(d.handle, path);
      return mayBeImport(json) ? { scene: JSON.parse(json), d } : null;
    } catch {
      return null;
    }
  };
  return {
    importedNote: async (t: MenuTarget) => {
      const hit = await readScene(t.path);
      return !!hit && recognise(hit.scene) !== null;
    },
    importOrOld: async (t: MenuTarget) => {
      const hit = await readScene(t.path);
      return (
        !!hit &&
        (recognise(hit.scene) !== null ||
          hasOldLook(hit.scene, hit.d.target, true))
      );
    },
    folderHasImports: async (t: MenuTarget) => {
      const d = deps();
      if (!d || t.path == null) {
        return false;
      }
      let read = 0;
      const walk = async (dir: string): Promise<boolean> => {
        for (const e of await d.repository.listDirectory(d.handle, dir)) {
          if (e.kind === "folder") {
            if (await walk(e.path)) {
              return true;
            }
          } else if (e.kind === "drawing") {
            if (read++ >= FOLDER_SCAN_CAP) {
              return true;
            }
            const hit = await readScene(e.path);
            if (hit && recognise(hit.scene) !== null) {
              return true;
            }
          }
        }
        return false;
      };
      try {
        return await walk(t.path);
      } catch {
        return false;
      }
    },
  };
}
