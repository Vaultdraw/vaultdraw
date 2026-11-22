/**
 * Reading a picture file for the composer: shrunk when large (a screenshot of a big screen is
 * several megabytes, and the providers resize anything over about 1.5k pixels anyway), and the
 * size check against what each way of sending can carry.
 */
import { IMAGE_TYPES, type ImageAttachment } from "./composerLogic";

/** The longest side kept, in pixels. */
export const MAX_SIDE = 1568;
/** A picture under this many bytes and within MAX_SIDE is sent as it is. */
const KEEP_BYTES = 400 * 1024;
/** What the app's request sender takes (2 MiB) leaves this much for the pictures of an API call. */
export const API_IMAGE_BUDGET = 1_500_000;

const toBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
};

const bytesOf = (blob: Blob): Promise<ArrayBuffer> =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer()
    : new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result as ArrayBuffer);
        r.onerror = () => no(r.error);
        r.readAsArrayBuffer(blob);
      });

/** Redraws a large picture smaller as JPEG; null when the browser cannot (the original is used). */
async function shrink(
  file: File,
): Promise<{ data: string; size: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= KEEP_BYTES) {
      bmp.close();
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const g = canvas.getContext("2d");
    if (!g) {
      return null;
    }
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) {
      return null;
    }
    return {
      data: toBase64(new Uint8Array(await bytesOf(blob))),
      size: blob.size,
    };
  } catch {
    return null;
  }
}

/** The file as an attachment (shrunk when large and not an animation). */
export async function readImage(file: File): Promise<ImageAttachment> {
  const mime = (IMAGE_TYPES as readonly string[]).includes(file.type)
    ? (file.type as ImageAttachment["mime"])
    : "image/png";
  const small = mime === "image/gif" ? null : await shrink(file);
  if (small) {
    return { name: file.name, mime: "image/jpeg", ...small };
  }
  return {
    name: file.name,
    mime,
    data: toBase64(new Uint8Array(await bytesOf(file))),
    size: file.size,
  };
}

/**
 * A plain sentence when the pictures cannot go with the question, or null. The requests of the API
 * providers are capped at 2 MiB by the app; the command lines take the full size.
 */
export function imageProblem(
  provider: string,
  images: readonly ImageAttachment[],
): string | null {
  if (provider === "claude-cli" || provider === "codex-cli") {
    return null;
  }
  const total = images.reduce((n, i) => n + i.data.length, 0);
  return total > API_IMAGE_BUDGET
    ? "These images are too large to send to this provider. Remove one, or use a smaller picture."
    : null;
}
