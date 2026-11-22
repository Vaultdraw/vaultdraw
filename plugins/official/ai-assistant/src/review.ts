/**
 * The see-check-fix pass (what the Excalidraw MCP servers do): after the assistant draws, the app
 * renders the result to a small picture, the model looks at it once against a checklist, and its
 * fixes come back as `vd edit` blocks. Pure: the caller supplies the renderer, the model call and
 * (to run a second round) the way fixes are applied.
 */

/** The checklist sent with the picture (about 190 tokens; a test keeps it under 250). */
export const REVIEW_CHECKLIST = `Review the picture of the drawing you just made. Check:
1. Overlap: shapes or labels lying on each other.
2. Truncated text: a label cut off or spilling out of its shape.
3. Crossing arrows: arrows that cross each other or run through a shape.
4. Unlabelled arrows: arrows that need a short label (12 characters at most) and have none.
5. Small text: text under 16 px.
6. Cramped spacing: under 40 px between groups (20 to 30 px inside a group).
7. Zones: a zone's label must sit on the zone, at its top.
8. Contrast: text hard to read on its fill.
Reply "No issues." if all is fine. Otherwise list each problem in one line, then give the fixes in one \`\`\`vd edit block with JSON {"ops":[...]}, using the element ids you know. Do not redraw what is fine.`;

/** One `vd edit` block of a reply: its operations as the model wrote them. */
export interface ReviewFix {
  ops: unknown[];
}

export interface ReviewRound {
  /** The model's reply text. */
  reply: string;
  /** The fixes found in the reply (empty when it said "no issues"). */
  fixes: ReviewFix[];
}

export interface ReviewResult {
  /** One entry per picture sent to the model. */
  rounds: ReviewRound[];
  /** Every fix of every round, in order. */
  fixes: ReviewFix[];
  /** `clean`: the model found nothing; `capped`: the round cap was reached; `once`: fixes found but no `apply` to run another round; `no-images`: the model cannot see pictures; `error`: render or ask failed. */
  stopped: "clean" | "capped" | "once" | "no-images" | "error";
  /** The reason when `stopped` is `error`. */
  error?: string;
}

export interface ReviewOptions {
  /** The picture of the drawing as a data URL (`ctx.scene.renderPng`). */
  render: () => Promise<string>;
  /** Asks the model about the picture and returns its reply text. */
  ask: (imageDataUrl: string, checklistText: string) => Promise<string>;
  /** Defaults to `REVIEW_CHECKLIST`. */
  checklist?: string;
  /** Default 2. */
  maxRounds?: number;
  /** False skips the pass without calling `render` or `ask`. Default true. */
  supportsImages?: boolean;
  /**
   * Applies the fixes of a round to the drawing so the next round sees them. Without it only one
   * round runs (a second picture would be the same).
   */
  apply?: (fixes: ReviewFix[]) => Promise<void>;
  /** Stops the loop between steps (the user pressed Stop). */
  cancelled?: () => boolean;
}

const OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*vd(?:[ \t]+edit\b.*)?[ \t]*$/;

/** The `vd edit` blocks of a reply; a block whose JSON is bad or has no `ops` list is skipped. */
export function parseFixes(reply: string): ReviewFix[] {
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  const fixes: ReviewFix[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]);
    if (!open) {
      continue;
    }
    const fence = open[1];
    const close = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    i = j;
    try {
      const json: unknown = JSON.parse(body.join("\n"));
      const ops = (json as { ops?: unknown } | null)?.ops;
      if (Array.isArray(ops) && ops.length > 0) {
        fixes.push({ ops });
      }
    } catch {
      // not JSON: ignore this block
    }
  }
  return fixes;
}

export async function reviewOnce(
  options: ReviewOptions,
): Promise<ReviewResult> {
  const {
    render,
    ask,
    checklist = REVIEW_CHECKLIST,
    maxRounds = 2,
    supportsImages = true,
    apply,
    cancelled,
  } = options;
  const result: ReviewResult = { rounds: [], fixes: [], stopped: "capped" };
  if (!supportsImages) {
    return { ...result, stopped: "no-images" };
  }
  const cap = Math.max(1, Math.floor(maxRounds));
  try {
    for (let round = 0; round < cap; round++) {
      if (cancelled?.()) {
        return { ...result, stopped: "capped" };
      }
      const picture = await render();
      const reply = await ask(picture, checklist);
      const fixes = parseFixes(reply);
      result.rounds.push({ reply, fixes });
      if (fixes.length === 0) {
        // "No issues", or problems named without a fix: either way there is nothing to apply.
        return { ...result, stopped: "clean" };
      }
      result.fixes.push(...fixes);
      if (!apply) {
        return { ...result, stopped: "once" };
      }
      await apply(fixes);
    }
  } catch (err) {
    return {
      ...result,
      stopped: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ...result, stopped: "capped" };
}
