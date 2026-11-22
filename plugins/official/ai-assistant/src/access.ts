/**
 * How much the assistant may do with the drawing: ask first (changes wait for Keep), apply at once
 * (one undo step, with Undo on the result), or read only (answers, never changes). The choice is the
 * `access` setting; the panel's icon and the "AI: Cycle permission mode" command change it.
 */
export type AccessMode = "ask" | "auto" | "read";

export const ACCESS_MODES: readonly AccessMode[] = ["ask", "auto", "read"];

export const ACCESS_LABEL: Record<AccessMode, string> = {
  ask: "Ask first",
  auto: "Apply at once",
  read: "Read only",
};

export const ACCESS_HINT: Record<AccessMode, string> = {
  ask: "Changes wait for you to keep them",
  auto: "Changes are applied, with Undo",
  read: "Answers only, never changes the drawing",
};

export const isAccess = (v: unknown): v is AccessMode =>
  v === "ask" || v === "auto" || v === "read";

/** The mode after `mode` in the cycle. */
export const nextAccess = (mode: AccessMode): AccessMode =>
  ACCESS_MODES[(ACCESS_MODES.indexOf(mode) + 1) % ACCESS_MODES.length];
