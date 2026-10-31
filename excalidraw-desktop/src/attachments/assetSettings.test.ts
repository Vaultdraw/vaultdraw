import { describe, expect, it } from "vitest";

import {
  ASSET_DEFAULTS,
  ASSET_MAPPINGS,
  imageOptionsFor,
  normalizeAssetPreferences,
} from "./assetSettings";

describe("asset settings", () => {
  it("defaults are Excalidraw's own picture rules and pictures shown in the tree", () => {
    expect(ASSET_DEFAULTS).toEqual({
      filesShowAssets: "media",
      imagesCompress: "auto",
      imagesMaxSide: 1440,
      imagesMaxInsertMb: 4,
    });
    expect(imageOptionsFor(ASSET_DEFAULTS)).toEqual({
      maxWidthOrHeight: 1440,
      maxFileSizeBytes: 4 * 1024 * 1024,
    });
  });

  it("compress off never shrinks; the size limit still applies", () => {
    const o = imageOptionsFor({
      imagesCompress: "off",
      imagesMaxSide: 512,
      imagesMaxInsertMb: 10,
    });
    expect(o.maxWidthOrHeight).toBeGreaterThan(100_000);
    expect(o.maxFileSizeBytes).toBe(10 * 1024 * 1024);
  });

  it.each([
    [{ filesShowAssets: "all" }, "filesShowAssets", "all"],
    [{ filesShowAssets: "pictures" }, "filesShowAssets", "media"],
    [{ imagesCompress: "always" }, "imagesCompress", "auto"],
    [{ imagesMaxSide: 100 }, "imagesMaxSide", 1440],
    [{ imagesMaxSide: 2048 }, "imagesMaxSide", 2048],
    [{ imagesMaxSide: 2048.5 }, "imagesMaxSide", 1440],
    [{ imagesMaxInsertMb: 0 }, "imagesMaxInsertMb", 4],
    [{ imagesMaxInsertMb: 25 }, "imagesMaxInsertMb", 25],
    [{ imagesMaxInsertMb: "8" }, "imagesMaxInsertMb", 4],
  ] as const)("%j -> %s = %j", (input, field, out) => {
    expect(normalizeAssetPreferences(input)[field]).toBe(out);
  });

  it("every field has its config key", () => {
    expect(ASSET_MAPPINGS.map((m) => m.key)).toEqual([
      "files.show_assets",
      "images.compress",
      "images.max_side",
      "images.max_insert_mb",
    ]);
  });
});
