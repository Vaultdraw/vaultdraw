import { useMemo } from "react";

import { isAssetKind } from "../../vault/fileKind";

import {
  getMenuItems,
  menuItemShown,
  runMenuItem,
} from "../../plugins/menuRegistry";
import { useMenuFacts } from "../../plugins/useMenuFacts";

import { ContextMenu } from "./ContextMenu";
import {
  buildRowMenu,
  buildSelectionMenu,
  type PluginRowItem,
  type RowMenuActions,
  type SelectionMenuActions,
} from "./rowMenuModel";

import type { MenuTarget } from "../../plugins/api";
import type { VaultEntry } from "../../vault/types";

export interface RowMenuState {
  entry: VaultEntry;
  x: number;
  y: number;
  /** Two or more rows: the menu acts on all of them (multi-select, F13). */
  selection?: { entries: VaultEntry[]; label: string };
}

interface RowMenuProps {
  state: RowMenuState;
  readOnly: boolean;
  ownerDocument?: Document | null;
  onClose: () => void;
  actions: RowMenuActions;
  selectionActions?: SelectionMenuActions;
}

/** Row actions shown from the "More actions" button, a right-click or `list.menu`. */
export const RowMenu = ({
  state,
  readOnly,
  ownerDocument,
  onClose,
  actions,
  selectionActions,
}: RowMenuProps) => {
  const { entry, selection } = state;
  const rowKind: "folder" | "drawing" | "note" =
    entry.kind === "folder"
      ? "folder"
      : entry.kind === "drawing"
      ? "drawing"
      : "note";
  // Pictures, PDFs and other files are neither: plugins see "other" and only their kind-less items show.
  const asset = isAssetKind(entry.kind);
  const target: MenuTarget = {
    surface: "tree",
    path: entry.path,
    kind: entry.kind === "excalidrawMd" || asset ? "other" : rowKind,
  };
  const facts = useMenuFacts(getMenuItems("tree"), target);
  const nodes = useMemo(
    () => {
      if (selection && selectionActions) {
        return buildSelectionMenu({
          entries: selection.entries,
          label: selection.label,
          readOnly,
          actions: selectionActions,
        });
      }
      // Items plugins declared for tree rows (`[[contributes.menus]]`), filtered by the row's kind.
      const pluginItems: PluginRowItem[] = getMenuItems("tree")
        .filter(
          (it) =>
            it.kinds.length === 0 || (!asset && it.kinds.includes(rowKind)),
        )
        .filter((it) => menuItemShown(it, facts))
        .map((it) => ({
          command: it.command,
          title: it.title,
          run: () => runMenuItem(it, target),
        }));
      return buildRowMenu({ entry, readOnly, actions, pluginItems });
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, selection, readOnly, actions, selectionActions, facts],
  );

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      label={
        selection
          ? `Actions for ${selection.label}`
          : `Actions for ${entry.name}`
      }
      ownerDocument={ownerDocument}
      onClose={onClose}
      nodes={nodes}
    />
  );
};
