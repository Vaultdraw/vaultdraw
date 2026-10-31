import type { FolderCount } from "../vault/types";

/** Confirmation text for moving a folder to the Trash; names how many files it holds once counted. */
export const folderTrashMessage = (
  name: string,
  count: FolderCount | null,
): string => {
  const restore = "You can restore it from the system Trash.";
  if (!count || count.count === 0) {
    return `Move the folder \u201c${name}\u201d to the Trash? ${restore}`;
  }
  const items = count.capped
    ? "1,000+ items"
    : `${count.count} ${count.count === 1 ? "item" : "items"}`;
  return `Move \u201c${name}\u201d and its ${items} to the Trash? ${restore}`;
};

/** The bulk Trash question (multi-select, F13): how many, and the first few names. */
export const bulkTrashMessage = (
  entries: readonly { name: string; kind: string }[],
): string => {
  const names = entries.slice(0, 3).map((e) => `“${e.name}”`);
  const more = entries.length - names.length;
  const list =
    more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  const folders = entries.some((e) => e.kind === "folder")
    ? " Folders go with everything inside them."
    : "";
  return `Move ${list} to the Trash?${folders} You can restore them from the system Trash.`;
};

/** One notice for a bulk move or trash where some items failed. */
export const bulkFailureMessage = (
  action: "move" | "trash",
  failed: readonly string[],
  total: number,
  reason: string,
): string => {
  const verb = action === "move" ? "move" : "move to the Trash";
  const names = failed
    .slice(0, 3)
    .map((n) => `"${n}"`)
    .join(", ");
  const more = failed.length > 3 ? ` and ${failed.length - 3} more` : "";
  const done = total - failed.length;
  const lead =
    done > 0
      ? `${action === "move" ? "Moved" : "Trashed"} ${done} of ${total}. `
      : "";
  return `${lead}Couldn't ${verb} ${names}${more}: ${reason}`;
};
