/**
 * What a vault file is, decided by its name alone: the one place for the extension rules
 * (twin of `vaultdraw-core/src/filekind.rs`; shared fixtures: `fixtures/filekind.json`).
 */

export const DRAWING_EXT = ".excalidraw";
export const NOTE_EXT = ".md";
export const EXCALIDRAW_MD_EXT = ".excalidraw.md";

/** drawing: `*.excalidraw`; note: `*.md`; excalidrawMd: Obsidian Excalidraw plugin `*.excalidraw.md`. */
export type FileKind = "drawing" | "note" | "excalidrawMd" | "other";

/** `ext` is lower case ASCII; compares without allocating (it runs per item on large lists). */
const endsWithCi = (name: string, ext: string): boolean => {
  const offset = name.length - ext.length;
  if (offset < 0) {
    return false;
  }
  for (let i = 0; i < ext.length; i++) {
    const c = name.charCodeAt(offset + i);
    // ASCII upper case to lower case; other code units compare as they are.
    if ((c >= 65 && c <= 90 ? c + 32 : c) !== ext.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};

/** `name` (a file name or vault-relative path) ends with `.excalidraw`, in any case. */
export const hasDrawingExt = (name: string): boolean =>
  endsWithCi(name, DRAWING_EXT);

/**
 * A drawing's file name from what the user typed: `.excalidraw` is added when missing, as the
 * New dialog and the conflict's Save as copy do (toimprove 318). Trimmed.
 */
export const withDrawingExt = (name: string): string => {
  const t = name.trim();
  return hasDrawingExt(t) ? t : `${t}${DRAWING_EXT}`;
};

/** `name` without a trailing `.excalidraw` (any case); unchanged when it has none. */
export const stripDrawingExt = (name: string): string =>
  hasDrawingExt(name) ? name.slice(0, name.length - DRAWING_EXT.length) : name;

/**
 * A drawing's name without its extension, for an Obsidian drawing too: "Plan.excalidraw" and
 * "Plan.excalidraw.md" give "Plan" (toimprove 236). Notes and other files keep theirs.
 */
export const drawingStem = (name: string): string =>
  fileKind(name) === "excalidrawMd"
    ? name.slice(0, name.length - EXCALIDRAW_MD_EXT.length)
    : stripDrawingExt(name);

export const fileKind = (name: string): FileKind => {
  if (hasDrawingExt(name)) {
    return "drawing";
  }
  if (endsWithCi(name, EXCALIDRAW_MD_EXT)) {
    return "excalidrawMd";
  }
  if (endsWithCi(name, NOTE_EXT)) {
    return "note";
  }
  return "other";
};

/** A name starting with a dot (`.obsidian`, `.trash`, `.git`): never listed, scanned, indexed or watched. */
export const isHiddenName = (name: string): boolean => name.startsWith(".");

/** True when any component of a vault-relative path is hidden. */
export const hasHiddenComponent = (path: string): boolean =>
  path.split("/").some(isHiddenName);

/** The name a tree row, tab or title shows: no `.excalidraw`, `.excalidraw.md` or `.md`. */
export const entryDisplayName = (name: string): string => {
  const kind = fileKind(name);
  if (kind === "drawing") {
    return stripDrawingExt(name);
  }
  if (kind === "excalidrawMd") {
    return name.slice(0, name.length - EXCALIDRAW_MD_EXT.length);
  }
  if (kind === "note") {
    return name.slice(0, name.length - NOTE_EXT.length);
  }
  return name;
};

/** Drawings that Vaultdraw writes: only native `.excalidraw` files (Obsidian Excalidraw files are read-only here). */
export const isWritableDrawing = (path: string): boolean =>
  fileKind(path) === "drawing";

/** The extension a rename keeps for this name (none for folders and other files). */
export const entryExtension = (name: string): string => {
  const kind = fileKind(name);
  if (kind === "drawing") {
    return name.slice(name.length - DRAWING_EXT.length);
  }
  if (kind === "excalidrawMd") {
    return name.slice(name.length - EXCALIDRAW_MD_EXT.length);
  }
  if (kind === "note") {
    return name.slice(name.length - NOTE_EXT.length);
  }
  // A picture, PDF or other file keeps its own extension, like Obsidian's rename.
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
};

/** The word for an entry in dialogs: Drawing, Note, Folder, Picture, PDF or File. */
export const entryWord = (
  kind: string,
): "Drawing" | "Note" | "Folder" | "Picture" | "PDF" | "File" =>
  kind === "folder"
    ? "Folder"
    : kind === "note"
    ? "Note"
    : kind === "image"
    ? "Picture"
    : kind === "pdf"
    ? "PDF"
    : kind === "file"
    ? "File"
    : "Drawing";

/** Picture extensions the tree lists, the viewer shows and a drag inserts (twin of `IMAGE_EXTS`). */
export const IMAGE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
] as const;

/** A vault file that is neither a drawing nor a note (twin of `AssetKind`). */
export type AssetKind = "image" | "pdf" | "file";

/** What a non-drawing, non-note file is; null for drawings and notes. */
export const assetKind = (name: string): AssetKind | null => {
  if (fileKind(name) !== "other") {
    return null;
  }
  const file = name.slice(name.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const ext =
    dot > 0 && dot + 1 < file.length ? file.slice(dot + 1).toLowerCase() : "";
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) {
    return "image";
  }
  return ext === "pdf" ? "pdf" : "file";
};

/** `files.show_assets`: which other files the tree lists beside drawings and notes. */
export type AssetListing = "none" | "media" | "all";

/** True for the tree's asset kinds (pictures, PDFs, other files). */
export const isAssetKind = (kind: string): kind is AssetKind =>
  kind === "image" || kind === "pdf" || kind === "file";

/** `entryWord` inside a sentence: "drawing", "picture", but "PDF" keeps its capitals. */
export const entryWordInSentence = (kind: string): string => {
  const word = entryWord(kind);
  return word === "PDF" ? word : word.toLowerCase();
};
