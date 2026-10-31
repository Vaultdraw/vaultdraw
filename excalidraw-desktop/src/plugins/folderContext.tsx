/**
 * The folder listing the shell shares with plugin components (`ctx.workspace.useFolder`):
 * the navigator's directory map, sort order and templates folder. VaultApp provides it around
 * plugin overlays; a component outside it sees no folders.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { isInTemplatesFolder } from "../templates/listTemplates";
import { isAssetKind } from "../vault/fileKind";
import { sortEntries, type SortOrder } from "../vault/sortOrder";

import type { VaultEntry } from "../vault/types";

export interface FolderSource {
  directoryMap: Map<string, VaultEntry[]>;
  loadDirectory: (path: string) => unknown;
  sort: SortOrder;
  templatesFolder: string;
}

const FolderContext = createContext<FolderSource | null>(null);

export const FolderProvider = ({
  value,
  children,
}: {
  value: FolderSource;
  children?: ReactNode;
}) => <FolderContext.Provider value={value}>{children}</FolderContext.Provider>;

/** The sorted entries of `path` (templates folder left out), loading it when needed. */
/** A folder entry plugins see: drawings, notes and folders (not pictures or other files). */
type PluginEntry = VaultEntry & {
  kind: "folder" | "drawing" | "note" | "excalidrawMd";
};

const isPluginEntry = (e: VaultEntry): e is PluginEntry => !isAssetKind(e.kind);

export function useFolderEntries(
  path: string,
): readonly PluginEntry[] | undefined {
  const src = useContext(FolderContext);
  const entries = src?.directoryMap.get(path);
  const load = src?.loadDirectory;
  useEffect(() => {
    void load?.(path);
  }, [load, path]);
  const sort = src?.sort;
  const templates = src?.templatesFolder ?? "";
  return useMemo(
    () =>
      entries && sort
        ? sortEntries(entries, sort)
            // Plugins see drawings, notes and folders (FolderItem); pictures and other files
            // are not part of that API yet.
            .filter(isPluginEntry)
            .filter((e) => !isInTemplatesFolder(e.path, templates))
        : undefined,
    [entries, sort, templates],
  );
}
