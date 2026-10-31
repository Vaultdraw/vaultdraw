import { useMemo } from "react";

import {
  getMenuItems,
  menuItemShown,
  runMenuItem,
} from "../../plugins/menuRegistry";
import { useMenuFacts } from "../../plugins/useMenuFacts";

import { ContextMenu } from "./ContextMenu";
import {
  buildRowMenu,
  type PluginRowItem,
  type RowMenuActions,
} from "./rowMenuModel";

import type { MenuTarget } from "../../plugins/api";
import type { VaultEntry } from "../../vault/types";

export interface RowMenuState {
  entry: VaultEntry;
  x: number;
  y: number;
}

interface RowMenuProps {
  state: RowMenuState;
  readOnly: boolean;
  ownerDocument?: Document | null;
  onClose: () => void;
  actions: RowMenuActions;
}

/** Row actions shown from the "More actions" button, a right-click or `list.menu`. */
export const RowMenu = ({
  state,
  readOnly,
  ownerDocument,
  onClose,
  actions,
}: RowMenuProps) => {
  const { entry } = state;
  const rowKind: "folder" | "drawing" | "note" =
    entry.kind === "folder"
      ? "folder"
      : entry.kind === "drawing"
      ? "drawing"
      : "note";
  const target: MenuTarget = {
    surface: "tree",
    path: entry.path,
    kind: entry.kind === "excalidrawMd" ? "other" : rowKind,
  };
  const facts = useMenuFacts(getMenuItems("tree"), target);
  const nodes = useMemo(
    () => {
      // Items plugins declared for tree rows (`[[contributes.menus]]`), filtered by the row's kind.
      const pluginItems: PluginRowItem[] = getMenuItems("tree")
        .filter((it) => it.kinds.length === 0 || it.kinds.includes(rowKind))
        .filter((it) => menuItemShown(it, facts))
        .map((it) => ({
          command: it.command,
          title: it.title,
          run: () => runMenuItem(it, target),
        }));
      return buildRowMenu({ entry, readOnly, actions, pluginItems });
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, readOnly, actions, facts],
  );

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      label={`Actions for ${entry.name}`}
      ownerDocument={ownerDocument}
      onClose={onClose}
      nodes={nodes}
    />
  );
};
