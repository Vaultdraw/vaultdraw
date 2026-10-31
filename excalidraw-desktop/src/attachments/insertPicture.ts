/**
 * A vault picture into the open drawing (drag from the tree, the row menu, `list.insertPicture`).
 * The bytes are read from the vault and handed to the editor like a dropped file, so the editor's
 * own shrink and size check (`images.*`, Excalidraw's `imageOptions`) apply. The file on disk is
 * only read.
 */
import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { userError } from "../components/userError";

import { baseName, formatBytes, pictureMime } from "./assetMime";

import type { AssetPreferences } from "./assetSettings";

export interface InsertPictureDeps {
  read: (path: string) => Promise<Uint8Array>;
  /** The editor showing a drawing now (null: none). */
  editor: { api: ExcalidrawImperativeAPI; readOnly: boolean } | null;
  prefs: Pick<AssetPreferences, "imagesCompress" | "imagesMaxInsertMb">;
  notify: (message: string) => void;
}

/** Why a picture of `bytes` cannot go in at full size, or null. Only checked when nothing shrinks it. */
export const tooBigMessage = (
  name: string,
  bytes: number,
  prefs: InsertPictureDeps["prefs"],
): string | null =>
  prefs.imagesCompress === "off" &&
  bytes > prefs.imagesMaxInsertMb * 1024 * 1024
    ? `"${name}" is ${formatBytes(bytes)}, more than the ${
        prefs.imagesMaxInsertMb
      } MB a drawing takes. Turn on "Shrink big pictures" or raise the limit in Settings, Files.`
    : null;

/**
 * Inserts the picture at `path`; `at` is a screen point (a drop), else the middle of the view.
 * Resolves true when the picture was handed to the editor.
 */
export async function insertVaultPicture(
  deps: InsertPictureDeps,
  path: string,
  at?: { x: number; y: number },
): Promise<boolean> {
  const name = baseName(path);
  const { editor } = deps;
  if (!editor) {
    deps.notify("Open a drawing first, then insert the picture.");
    return false;
  }
  if (editor.readOnly) {
    deps.notify("This drawing is read-only, so the picture can't be added.");
    return false;
  }
  let bytes: Uint8Array;
  try {
    bytes = await deps.read(path);
  } catch (err) {
    deps.notify(
      `Couldn't add "${name}". ${userError(
        err,
        "The picture couldn't be read.",
      )}`,
    );
    return false;
  }
  const tooBig = tooBigMessage(name, bytes.length, deps.prefs);
  if (tooBig) {
    deps.notify(tooBig);
    return false;
  }
  const file = new File([bytes as BlobPart], name, { type: pictureMime(path) });
  const scene = at
    ? viewportCoordsToSceneCoords(
        { clientX: at.x, clientY: at.y },
        editor.api.getAppState(),
      )
    : undefined;
  try {
    await editor.api.insertImages([file], scene);
  } catch (err) {
    deps.notify(`Couldn't add "${name}". ${userError(err, "")}`.trim());
    return false;
  }
  return true;
}
