/**
 * The picture viewer's one hook into the app: a tab kind for picture files. Registering is a few
 * object allocations; the view is a lazy chunk that loads when the first picture tab is shown.
 */
import { registerTabKind } from "../tabs/tabKinds";
import { assetKind } from "../vault/fileKind";

export const PICTURE_KIND_ID = "assets.picture";

export const isPicturePath = (path: string): boolean =>
  assetKind(path) === "image";

let dispose: (() => void) | null = null;

/** Registers the picture tab kind once (idempotent). */
export function ensurePictureKind(): void {
  if (!dispose) {
    dispose = registerTabKind({
      id: PICTURE_KIND_ID,
      pluginId: "assets",
      matches: isPicturePath,
      load: () => import("./PictureView"),
    });
  }
}
