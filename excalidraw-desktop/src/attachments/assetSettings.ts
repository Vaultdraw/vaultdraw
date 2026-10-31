/**
 * `[files] show_assets` and the `[images]` table: preference fields, config.toml keys and
 * defaults. Pure data; preferences.ts and settingsSync.ts spread it in.
 */
import type { AssetListing } from "../vault/fileKind";
import type { ConfigMapping } from "../vault/settingsSync";

export const ASSET_FIELDS = [
  "filesShowAssets",
  "imagesCompress",
  "imagesMaxSide",
  "imagesMaxInsertMb",
] as const;
export type AssetField = typeof ASSET_FIELDS[number];

/** `off`: pictures go in at full size; `auto`: pictures larger than `images.max_side` are shrunk. */
export type ImageCompress = "off" | "auto";

export interface AssetPreferences {
  /** files.show_assets: which other files the tree lists beside drawings and notes. */
  filesShowAssets: AssetListing;
  /** images.compress: shrink big pictures when they go into a drawing. */
  imagesCompress: ImageCompress;
  /** images.max_side: longest side, in pixels, a shrunk picture keeps. */
  imagesMaxSide: number;
  /** images.max_insert_mb: largest picture, in megabytes (after shrinking), a drawing takes. */
  imagesMaxInsertMb: number;
}

/** Excalidraw's own defaults (1440 px, 4 MB), so nothing changes for anyone who never sets them. */
export const ASSET_DEFAULTS: AssetPreferences = {
  filesShowAssets: "media",
  imagesCompress: "auto",
  imagesMaxSide: 1440,
  imagesMaxInsertMb: 4,
};

export const ASSET_LIMITS = {
  imagesMaxSide: { min: 256, max: 8192, step: 64 },
  imagesMaxInsertMb: { min: 1, max: 25, step: 1 },
} as const;

const LISTINGS: readonly AssetListing[] = ["none", "media", "all"];
const COMPRESS: readonly ImageCompress[] = ["off", "auto"];

export const isAssetListing = (v: unknown): v is AssetListing =>
  LISTINGS.includes(v as AssetListing);
export const isImageCompress = (v: unknown): v is ImageCompress =>
  COMPRESS.includes(v as ImageCompress);
const inRange =
  (r: { min: number; max: number }) =>
  (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max;
export const isMaxSide = inRange(ASSET_LIMITS.imagesMaxSide);
export const isMaxInsertMb = inRange(ASSET_LIMITS.imagesMaxInsertMb);

export const ASSET_MAPPINGS: readonly ConfigMapping[] = [
  {
    field: "filesShowAssets",
    key: "files.show_assets",
    expected: '"none", "media" or "all"',
    valid: isAssetListing,
  },
  {
    field: "imagesCompress",
    key: "images.compress",
    expected: '"off" or "auto"',
    valid: isImageCompress,
  },
  {
    field: "imagesMaxSide",
    key: "images.max_side",
    expected: `a whole number from ${ASSET_LIMITS.imagesMaxSide.min} to ${ASSET_LIMITS.imagesMaxSide.max}`,
    valid: isMaxSide,
  },
  {
    field: "imagesMaxInsertMb",
    key: "images.max_insert_mb",
    expected: `a whole number from ${ASSET_LIMITS.imagesMaxInsertMb.min} to ${ASSET_LIMITS.imagesMaxInsertMb.max}`,
    valid: isMaxInsertMb,
  },
];

/** Stored preferences -> valid fields; a bad value gets the default. */
export const normalizeAssetPreferences = (
  input: Record<string, unknown>,
): AssetPreferences => ({
  filesShowAssets: isAssetListing(input.filesShowAssets)
    ? input.filesShowAssets
    : ASSET_DEFAULTS.filesShowAssets,
  imagesCompress: isImageCompress(input.imagesCompress)
    ? input.imagesCompress
    : ASSET_DEFAULTS.imagesCompress,
  imagesMaxSide: isMaxSide(input.imagesMaxSide)
    ? input.imagesMaxSide
    : ASSET_DEFAULTS.imagesMaxSide,
  imagesMaxInsertMb: isMaxInsertMb(input.imagesMaxInsertMb)
    ? input.imagesMaxInsertMb
    : ASSET_DEFAULTS.imagesMaxInsertMb,
});

/** No shrinking: larger than any picture a webview decodes. */
const NO_SHRINK_SIDE = 1_000_000;

/** Excalidraw's `imageOptions` for these preferences (the editor shrinks, then checks the size). */
export const imageOptionsFor = (
  p: Pick<
    AssetPreferences,
    "imagesCompress" | "imagesMaxSide" | "imagesMaxInsertMb"
  >,
): { maxWidthOrHeight: number; maxFileSizeBytes: number } => ({
  maxWidthOrHeight:
    p.imagesCompress === "off" ? NO_SHRINK_SIDE : p.imagesMaxSide,
  maxFileSizeBytes: p.imagesMaxInsertMb * 1024 * 1024,
});
