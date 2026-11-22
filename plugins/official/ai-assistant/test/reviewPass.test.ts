import { describe, expect, it, vi } from "vitest";

import { imageOf, runReviewPass } from "../src/reviewPass";

import type { PluginContext, SceneElement, SceneOp } from "@vaultdraw/api";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** A drawing with two boxes on top of each other, as a fake context. */
function fakeCtx() {
  const els: SceneElement[] = [
    {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 160,
      height: 70,
      angle: 0,
      text: "Browser",
    },
    {
      id: "b",
      type: "rectangle",
      x: 20,
      y: 10,
      width: 160,
      height: 70,
      angle: 0,
      text: "Server",
    },
  ];
  const batches: SceneOp[][] = [];
  const ctx = {
    scene: {
      elements: () => els,
      path: () => "Net.excalidraw",
      renderPng: vi.fn(async () => ({ dataUrl: PNG, width: 200, height: 100 })),
      batch: vi.fn(async (ops: SceneOp[]) => {
        batches.push(ops);
        for (const op of ops) {
          if (op.op === "update") {
            const e = els.find((x) => x.id === op.id)! as any;
            Object.assign(e, op.props);
          }
        }
        return { ids: [] };
      }),
    },
  } as unknown as PluginContext;
  return { ctx, batches };
}

const fix =
  '1 overlap.\n```vd edit\n{"ops":[{"op":"move","id":"b","x":300,"y":0}]}\n```';

describe("the see-check-fix pass", () => {
  it("Apply at once: one round finds the overlap, the fix is applied, the next round is clean", async () => {
    const { ctx, batches } = fakeCtx();
    const ask = vi
      .fn()
      .mockResolvedValueOnce(fix)
      .mockResolvedValueOnce("No issues.");
    const r = await runReviewPass({
      ctx,
      ids: ["a", "b"],
      ask,
      applyNow: true,
      supportsImages: true,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    // the picture and the element ids went to the model
    const [system, text, image] = ask.mock.calls[0];
    expect(system).toContain('"op":"move"');
    expect(text).toContain("Overlap");
    expect(text).toContain('- b: rectangle "Server" at (20, 10)');
    expect(image).toEqual({ mime: "image/png", data: "iVBORw0KGgo=" });
    expect(batches).toHaveLength(1);
    expect(r.applied).toBe("Moved 1 box");
    expect(r.steps).toBe(1);
    // the second picture was taken after the fix
    expect(ask.mock.calls[1][1]).toContain(
      '- b: rectangle "Server" at (300, 0)',
    );
  });

  it("stops at the cap of two rounds even if the model keeps finding things", async () => {
    const { ctx, batches } = fakeCtx();
    const ask = vi.fn().mockResolvedValue(fix);
    await runReviewPass({
      ctx,
      ids: ["a", "b"],
      ask,
      applyNow: true,
      supportsImages: true,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(batches).toHaveLength(2);
  });

  it("Ask first: one round, nothing applied, the fixes come back as a proposal", async () => {
    const { ctx, batches } = fakeCtx();
    const ask = vi.fn().mockResolvedValue(fix);
    const r = await runReviewPass({
      ctx,
      ids: ["a", "b"],
      ask,
      applyNow: false,
      supportsImages: true,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(0);
    expect(r.proposal?.headline).toBe("Moves 1 box");
    expect(r.said).toBe("1 overlap.");
  });

  it("a model that cannot see pictures, or nothing added, costs no call", async () => {
    const { ctx } = fakeCtx();
    const ask = vi.fn();
    await runReviewPass({
      ctx,
      ids: ["a"],
      ask,
      applyNow: true,
      supportsImages: false,
    });
    await runReviewPass({
      ctx,
      ids: [],
      ask,
      applyNow: true,
      supportsImages: true,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(ctx.scene.renderPng).not.toHaveBeenCalled();
  });

  it("a clean first look says nothing", async () => {
    const { ctx } = fakeCtx();
    const r = await runReviewPass({
      ctx,
      ids: ["a"],
      ask: async () => "No issues.",
      applyNow: true,
      supportsImages: true,
    });
    expect(r).toMatchObject({
      said: "",
      proposal: null,
      applied: "",
      steps: 0,
    });
  });

  it("reads a data URL into a message picture", () => {
    expect(imageOf(PNG)).toEqual({ mime: "image/png", data: "iVBORw0KGgo=" });
    expect(() => imageOf("nope")).toThrow();
  });
});
