/**
 * The composer's small rules, kept apart from the screen so each is tested with plain values:
 * how the toolbar shortens itself, what the context chip shows, which pasted or dropped files are
 * taken as images, and when the `/` list or the one-line hint is shown.
 */
import type { ContextMode } from "./session";

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * How much of the toolbar is spelled out. 0: model, effort and mode with words; 1: the mode is
 * only its icon; 2: the effort is an icon too. The model name is the last thing to give way: it
 * shortens with an ellipsis in the style sheet, and its full name is in its tooltip.
 */
export type BarLevel = 0 | 1 | 2;

/** Width of the toolbar (px) from which each level fits; below the last one it is level 2. */
export const BAR_FULL = 330;
export const BAR_MEDIUM = 270;

/** Chooses the level for a toolbar `width` px wide. An unknown width (no layout) means full. */
export function barLevel(width: number | null | undefined): BarLevel {
  if (!width || width <= 0) {
    return 0;
  }
  if (width >= BAR_FULL) {
    return 0;
  }
  return width >= BAR_MEDIUM ? 1 : 2;
}

/**
 * A short model name for the toolbar: no "(recommended)", no "Claude " lead, and when it is still
 * longer than `max` characters, whole words are dropped from the end (never a word cut in half).
 * A single long word is kept whole: the style sheet shortens it with an ellipsis.
 */
export function shortModelLabel(label: string, max = 16): string {
  let out = label
    .replace(/\s*\((?:recommended|your subscription)\)\s*/gi, " ")
    .replace(/^claude\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!out) {
    return "Default";
  }
  const words = out.split(" ");
  while (out.length > max && words.length > 1) {
    words.pop();
    out = words.join(" ");
  }
  return out;
}

/** The effort level as a short word for the toolbar ("medium" is "Med"). */
export function shortEffort(effort: string): string {
  if (!effort) {
    return "Effort";
  }
  const names: Record<string, string> = {
    low: "Low",
    medium: "Med",
    high: "High",
    xhigh: "XHigh",
    max: "Max",
  };
  return names[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}

// ---------------------------------------------------------------------------
// What is sent: the chip and the list behind the + button
// ---------------------------------------------------------------------------

export const DEFAULT_CONTEXT: ContextMode = "auto";

const CHIP_TEXT: Record<ContextMode, string> = {
  auto: "",
  drawing: "Whole drawing",
  selection: "Only selection",
  none: "No drawing",
};

/**
 * The text of the small chip above the toolbar, or null when there is nothing to show: the default
 * choice and no attached image keep the composer bare. `wantsContext` is false for the modes that
 * send no drawing (new drawing, diagram), where the choice does not matter.
 */
export function contextChip(
  mode: ContextMode,
  wantsContext: boolean,
): string | null {
  if (!wantsContext || mode === DEFAULT_CONTEXT) {
    return null;
  }
  return CHIP_TEXT[mode];
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** An image ready to send: base64 text without the `data:` lead. */
export interface ImageAttachment {
  /** For the remove button's name. */
  name: string;
  mime: (typeof IMAGE_TYPES)[number];
  data: string;
  /** Size of the file in bytes. */
  size: number;
}

export interface FileInfo {
  name: string;
  type: string;
  size: number;
}

/**
 * Which of the incoming files become attachments, and a plain sentence for each one refused.
 * `have` is how many images are attached already.
 */
export function checkImages(
  have: number,
  incoming: readonly FileInfo[],
): { accept: number[]; problems: string[] } {
  const accept: number[] = [];
  const problems: string[] = [];
  incoming.forEach((f, i) => {
    const label = f.name || "The image";
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) {
      problems.push(`${label} is not a PNG, JPEG, GIF or WebP image.`);
    } else if (f.size > MAX_IMAGE_BYTES) {
      problems.push(
        `${label} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    } else if (have + accept.length >= MAX_IMAGES) {
      problems.push(`At most ${MAX_IMAGES} images can be sent at once.`);
    } else {
      accept.push(i);
    }
  });
  // one sentence for the limit, however many files hit it
  return { accept, problems: [...new Set(problems)] };
}

/** The image files among the pasted or dropped ones (a file with no type counts only by its name). */
export function imageFilesOf(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter(
    (f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name),
  );
}

/**
 * A plain line about images when the provider cannot or may not read them, or null when it can.
 * All providers here take images: the two command lines and the three APIs; a local model only
 * reads them when it is one that can see.
 */
export function imageNote(provider: string): string | null {
  if (provider === "ollama") {
    return "Only models that can see images will use them.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The question box
// ---------------------------------------------------------------------------

/**
 * What the box shows under the text: the full list of modes after `/`, the context list after `@`,
 * or nothing. The box starts with one hint line instead of a list of everything.
 */
export function helperKind(draft: string): "slash" | "at" | null {
  if (/^\/([a-z]*)$/i.test(draft)) {
    return "slash";
  }
  return /(?:^|\s)@([a-z]*)$/i.test(draft) ? "at" : null;
}

/** The empty panel's one line; the full list of modes appears only when `/` is typed. */
export const EMPTY_HINT = "Type / for commands, @ to add context";
