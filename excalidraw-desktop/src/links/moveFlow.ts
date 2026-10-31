/**
 * Rename/move decision for links: what to do with a move given the
 * `links.update_on_rename` setting and the native rename plan. Pure apart from
 * the injected `confirm`, so the three modes and `rePointed` are unit tested.
 *
 *  - "abort": the user declined a re-pointing warning; nothing moves.
 *  - "plain": move only (setting false, "ask" declined, or nothing to rewrite).
 *  - "rewrite": move and update the links that point at the moved drawings.
 */
import { stripExtension } from "./grammar";

import type { MovePlan, RePointed, UpdateOnRename, VaultLinks } from "./types";

export type MoveDecision = "abort" | "plain" | "rewrite";

export type ConfirmRequest = {
  title: string;
  message: string;
  /** One line per item (affected links). */
  details?: string[];
  confirmLabel: string;
  cancelLabel: string;
};

export type MoveFlowDeps = {
  links: VaultLinks | null;
  handle: string;
  mode: UpdateOnRename;
  /** true = the confirm button. */
  confirm(request: ConfirmRequest): Promise<boolean>;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const name = (path: string | null) =>
  path === null ? "nothing" : stripExtension(path);

export function rePointedRequest(
  rePointed: readonly RePointed[],
): ConfirmRequest {
  return {
    title: "Links will point elsewhere",
    message: `${plural(
      rePointed.length,
      "link would silently resolve",
      "links would silently resolve",
    )} to a different drawing after this move. Continue?`,
    details: rePointed.map(
      (r) =>
        `${stripExtension(r.path)}: [[${r.target}]] ${name(r.from)} → ${name(
          r.to,
        )}`,
    ),
    confirmLabel: "Move anyway",
    cancelLabel: "Cancel",
  };
}

export function updateRequest(plan: MovePlan): ConfirmRequest {
  const where =
    plan.files > 0
      ? plural(plan.files, "drawing", "drawings")
      : "the open drawing";
  return {
    title: "Update links?",
    message: `Update ${plural(plan.links, "link", "links")} in ${where}?`,
    confirmLabel: "Update",
    cancelLabel: "Don't update",
  };
}

export async function decideMove(
  deps: MoveFlowDeps,
  from: string,
  to: string,
): Promise<MoveDecision> {
  const { links, handle, mode } = deps;
  if (!links) {
    return "plain";
  }
  let plan: MovePlan | null = null;
  try {
    plan = await links.planMove(handle, from, to);
  } catch {
    plan = null;
  }
  if (plan && plan.rePointed.length > 0) {
    if (!(await deps.confirm(rePointedRequest(plan.rePointed)))) {
      return "abort";
    }
  }
  if (mode === false) {
    return "plain";
  }
  if (plan === null) {
    return mode === true ? "rewrite" : "plain";
  }
  if (plan.links === 0) {
    return "plain";
  }
  if (mode === true) {
    return "rewrite";
  }
  return (await deps.confirm(updateRequest(plan))) ? "rewrite" : "plain";
}

/** "Updated 3 links in 2 drawings". */
export const updatedMessage = (links: number, drawings: number) =>
  `Updated ${plural(links, "link", "links")} in ${plural(
    drawings,
    "drawing",
    "drawings",
  )}`;

/**
 * A confirm that asks each question once per batch (a multi-select move,
 * F13): the first answer to "Update links?" or "Move anyway?" applies to
 * every later item, as Obsidian asks once for a multi-file move.
 */
export function onceConfirm(
  confirm: MoveFlowDeps["confirm"],
  answers: Map<string, boolean>,
): MoveFlowDeps["confirm"] {
  return async (request) => {
    const known = answers.get(request.title);
    if (known !== undefined) {
      return known;
    }
    const answer = await confirm(request);
    answers.set(request.title, answer);
    return answer;
  };
}
