/**
 * The see-check-fix pass wired to the drawing: after a change is applied, the elements it added
 * are rendered to a small picture (`ctx.scene.renderPng`), the model looks at it with the
 * checklist (review.ts) and its fixes are checked like any edit (edits.ts). Apply at once: the
 * fixes go in (up to two rounds). Ask first: one round, and the fixes come back as a proposal.
 */
import { buildProposal, NoChange, type Proposal } from "./edits";
import { REVIEW_CHECKLIST, reviewOnce, type ReviewFix } from "./review";

import type { MessageImage } from "./images";
import type { PluginContext } from "@vaultdraw/api";

/** The instructions for the review call: short, with the edit op format. */
export const REVIEW_SYSTEM = `You check a drawing you just made in Vaultdraw (Excalidraw drawings). You get a picture of it and the list of its elements with ids. Fix only real problems, with small edits:
{"op":"move","id":"<id>","x":0,"y":0}
{"op":"restyle","id":"<id>","width":160,"height":80,"fontSize":20,"text":"…","backgroundColor":"#a5d8ff"}
{"op":"delete","id":"<id>"}
Ids must come from the list. Answer in one or two plain lines before the block.`;

/** "data:image/png;base64,AAAA" → the picture a model message carries. */
export function imageOf(dataUrl: string): MessageImage {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) {
    throw new Error("The picture of the drawing could not be read.");
  }
  return { mime: m[1] as MessageImage["mime"], data: m[2] };
}

/** The elements to check, as lines the model can name in its fixes. */
export function elementLines(
  ctx: PluginContext,
  ids: readonly string[],
): string {
  const want = new Set(ids);
  const r = Math.round;
  return ctx.scene
    .elements()
    .filter((e) => want.has(e.id))
    .map(
      (e) =>
        `- ${e.id}: ${e.type}${
          e.text ? ` "${e.text.replace(/\s+/g, " ").slice(0, 60)}"` : ""
        } at (${r(e.x)}, ${r(e.y)}) size ${r(e.width)}x${r(e.height)}`,
    )
    .join("\n");
}

export interface PassOptions {
  ctx: PluginContext;
  /** The elements the change added. */
  ids: readonly string[];
  /** Sends the review question with the picture; returns the reply text. */
  ask(system: string, text: string, image: MessageImage): Promise<string>;
  /** True: apply each round's fixes (Apply at once). False: one round, fixes as a proposal. */
  applyNow: boolean;
  maxRounds?: number;
  supportsImages: boolean;
  cancelled?: () => boolean;
}

export interface PassResult {
  /** What the pass did, for the thread ("" when nothing needed fixing). */
  said: string;
  /** Fixes waiting for Keep (Ask first). */
  proposal: Proposal | null;
  /** Fixes applied (Apply at once), as one line. */
  applied: string;
  /** Batches applied, so Undo knows how many steps the pass added. */
  steps: number;
  error?: string;
}

/** The fixes of a round as a checked proposal, or null when none can be applied. */
function proposalOf(ctx: PluginContext, fixes: ReviewFix[]): Proposal | null {
  try {
    return buildProposal(
      JSON.stringify({ title: "Tidy up", ops: fixes.flatMap((f) => f.ops) }),
      "edit",
      ctx.scene.elements(),
      ctx.scene.path(),
      60,
    );
  } catch (err) {
    if (err instanceof NoChange) {
      return null;
    }
    throw err;
  }
}

export async function runReviewPass(o: PassOptions): Promise<PassResult> {
  const { ctx, ids } = o;
  let steps = 0;
  const done: string[] = [];
  let waiting: Proposal | null = null;
  const result = await reviewOnce({
    supportsImages: o.supportsImages && ids.length > 0,
    maxRounds: o.applyNow ? o.maxRounds ?? 2 : 1,
    cancelled: o.cancelled,
    render: async () =>
      (
        await ctx.scene.renderPng({ ids: [...ids], maxSide: 768 })
      ).dataUrl,
    ask: (picture, checklist) =>
      o.ask(
        REVIEW_SYSTEM,
        `${checklist}\n\nThe elements in the picture:\n${elementLines(
          ctx,
          ids,
        )}`,
        imageOf(picture),
      ),
    ...(o.applyNow
      ? {
          apply: async (fixes: ReviewFix[]) => {
            const p = proposalOf(ctx, fixes);
            if (p) {
              await ctx.scene.batch(p.ops, { path: p.path ?? undefined });
              steps++;
              done.push(p.done);
            }
          },
        }
      : {}),
  });
  if (result.stopped === "error") {
    return {
      said: "",
      proposal: null,
      applied: "",
      steps,
      error: result.error,
    };
  }
  if (!o.applyNow && result.fixes.length) {
    waiting = proposalOf(ctx, result.fixes);
  }
  const last = result.rounds.at(-1)?.reply ?? "";
  const words = last.replace(/```[\s\S]*?```/g, "").trim();
  return {
    said: result.fixes.length ? words : "",
    proposal: waiting,
    applied: done.join(", "),
    steps,
  };
}

export { REVIEW_CHECKLIST };
