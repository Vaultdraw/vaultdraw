/** Settings rows for `files.show_assets` and `[images]`. Spread into components/settings/schema.ts. */
import type { SettingSchema } from "../components/settings/schema";

export const ASSET_SETTINGS_SCHEMA: readonly SettingSchema[] = [
  {
    id: "files-show-assets",
    page: "files",
    label: "Other files in the tree",
    description:
      "Pictures and PDFs show in the file tree beside drawings and notes, open in a tab and drag onto a drawing. All files lists everything in the vault folder.",
    keywords: [
      "assets",
      "attachments",
      "images",
      "pictures",
      "pdf",
      "extensions",
      "detect all",
    ],
    configKey: "files.show_assets",
    perVault: false,
  },
  {
    id: "images-compress",
    page: "files",
    label: "Shrink big pictures",
    description:
      "A picture you paste, drop or drag into a drawing is shrunk to the longest side below. Only the drawing's copy changes; the file on disk stays as it is.",
    keywords: ["compress", "resize", "image", "picture", "attachment"],
    configKey: "images.compress",
    perVault: false,
    heading: "Pictures in drawings",
  },
  {
    id: "images-max-side",
    page: "files",
    label: "Longest side of a shrunk picture",
    description: "In pixels.",
    keywords: ["compress", "resize", "image", "picture", "pixels"],
    configKey: "images.max_side",
    perVault: false,
  },
  {
    id: "images-max-insert-mb",
    page: "files",
    label: "Largest picture a drawing takes",
    description:
      "In megabytes, after shrinking. A bigger picture is not added and a notice says why.",
    keywords: ["size", "limit", "image", "picture", "megabytes", "warning"],
    configKey: "images.max_insert_mb",
    perVault: false,
  },
];
