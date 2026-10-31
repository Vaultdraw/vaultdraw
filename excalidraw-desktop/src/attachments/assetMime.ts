/** Picture MIME types by extension (the viewer's blob and a drag onto a drawing). */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export const pictureMime = (path: string): string =>
  MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ??
  "application/octet-stream";

/** The file name of a vault path. */
export const baseName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** "1.2 MB", "340 KB", "12 bytes". */
export const formatBytes = (n: number): string => {
  if (n < 1024) {
    return `${n} ${n === 1 ? "byte" : "bytes"}`;
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
