import { useEffect, type RefObject } from "react";

import { useUiTallRowHeight } from "../../theme/useInterfaceFont";

import { VersionRow } from "./VersionRow";

import { useRowWindow } from "./rowWindow";

import type { PanelThumbnails } from "./thumbnails";
import type { VersionInfo } from "../types";

export interface VersionListProps {
  versions: readonly VersionInfo[];
  selectedId: string | null;
  thumbs: PanelThumbnails;
  listRef: RefObject<HTMLUListElement | null>;
  onSelect: (id: string) => void;
  /** +1 = older (Down), -1 = newer (Up). */
  onStep: (delta: 1 | -1) => void;
  onEnter: () => void;
  /** Delete a checkpoint row; absent = no delete button. */
  onDelete?: (id: string) => void;
}

/** Windowed list: only the rows near the scroll position are mounted. */
export const VersionList = ({
  versions,
  selectedId,
  thumbs,
  listRef,
  onSelect,
  onStep,
  onEnter,
  onDelete,
}: VersionListProps) => {
  const rowHeight = useUiTallRowHeight();
  const { start, end, scrollToRow } = useRowWindow(
    listRef,
    versions.length,
    rowHeight,
  );

  const selectedIndex = selectedId
    ? versions.findIndex((v) => v.id === selectedId)
    : -1;
  useEffect(() => {
    scrollToRow(selectedIndex);
  }, [selectedIndex, scrollToRow]);

  return (
    <ul
      ref={listRef}
      className="vault-history-panel__list"
      aria-label="Versions"
      tabIndex={0}
      style={{
        paddingTop: start * rowHeight,
        paddingBottom: (versions.length - end) * rowHeight,
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          onStep(1);
        } else if (e.key === "ArrowUp") {
          onStep(-1);
        } else if (e.key === "Enter") {
          onEnter();
        } else {
          return;
        }
        e.preventDefault();
      }}
    >
      {versions.slice(start, end).map((v) => (
        <VersionRow
          key={v.id}
          version={v}
          selected={v.id === selectedId}
          thumbs={thumbs}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
};
