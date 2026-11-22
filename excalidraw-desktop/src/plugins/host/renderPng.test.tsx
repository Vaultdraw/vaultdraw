import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  checkRenderOptions,
  fitRenderSize,
} from "../../../../sdk/api/shared/renderRules";
import { pickElements } from "../../sceneOps/renderPng";

import { boot, type TestPlugin } from "../testing";

import type { Plugin, PluginContext } from "../api";

const render = vi.hoisted(() => vi.fn());
vi.mock("../../sceneOps/renderPng", async (orig) => ({
  ...(await orig<typeof import("../../sceneOps/renderPng")>()),
  renderScenePng: render,
}));

let t: TestPlugin | undefined;
beforeEach(() => {
  localStorage.clear();
  render.mockReset();
  render.mockResolvedValue({
    dataUrl: "data:image/png;base64,AAAA",
    width: 768,
    height: 400,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  await t?.dispose();
  t = undefined;
  vi.restoreAllMocks();
});

const bootCtx = async (extra: Plugin["activate"] = () => {}) => {
  let ctx!: PluginContext;
  t = await boot(
    { id: "rp", contributes: { commands: [{ id: "go" }] } },
    {
      activate(c) {
        ctx = c;
        return extra(c);
      },
    },
  );
  await t.run("go").catch(() => {});
  return ctx;
};

describe("ctx.scene.renderPng", () => {
  it("renders the open drawing with the defaults and returns the data URL", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.setElements([
      { type: "rectangle", width: 10, height: 10, id: "a" },
    ]);
    const out = await ctx.scene.renderPng();
    expect(out).toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      width: 768,
      height: 400,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][1]).toEqual({
      ids: undefined,
      box: undefined,
      maxSide: 768,
      padding: 16,
    });
  });

  it("passes ids, size and padding through", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.setElements([
      { type: "rectangle", width: 10, height: 10, id: "a" },
    ]);
    await ctx.scene.renderPng({ ids: ["a"], maxSide: 512, padding: 0 });
    expect(render.mock.calls[0][1]).toMatchObject({
      ids: ["a"],
      maxSide: 512,
      padding: 0,
    });
  });

  it("rejects with NOT_FOUND when no drawing is open", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    t!.scene.switchTo(null);
    await expect(ctx.scene.renderPng()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("no drawing is open"),
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("rejects bad options before rendering", async () => {
    const ctx = await bootCtx((c) => void c.commands.register("go", () => {}));
    for (const bad of [
      { maxSide: 10 },
      { maxSide: 5000 },
      { maxSide: Number.NaN },
      { padding: -1 },
      { ids: [] },
      { ids: [1] },
      { box: { x: 0, y: 0, width: 0, height: 5 } },
      { colour: "red" },
    ]) {
      await expect(ctx.scene.renderPng(bad as never)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    }
    expect(render).not.toHaveBeenCalled();
  });
});

describe("renderPng rules", () => {
  it("fits the longest side to maxSide and never enlarges", () => {
    expect(fitRenderSize(1536, 768, 768)).toEqual({
      width: 768,
      height: 384,
      scale: 0.5,
    });
    expect(fitRenderSize(300, 200, 768)).toEqual({
      width: 300,
      height: 200,
      scale: 1,
    });
    expect(fitRenderSize(0, 0, 768).width).toBe(1);
  });

  it("ids win over a box", () => {
    const o = checkRenderOptions({
      ids: ["a"],
      box: { x: 0, y: 0, width: 5, height: 5 },
    });
    expect(o.box).toBeUndefined();
    expect(o.ids).toEqual(["a"]);
  });
});

describe("pickElements", () => {
  const el = (id: string, x: number, extra = {}): ExcalidrawElement =>
    ({
      id,
      type: "rectangle",
      x,
      y: 0,
      width: 10,
      height: 10,
      angle: 0,
      ...extra,
    } as never);
  const all = [
    el("a", 0),
    el("b", 500),
    el("t", 0, { type: "text", containerId: "a" }),
  ];

  it("picks ids and the text bound to them", () => {
    const got = pickElements(all, { ids: ["a"], maxSide: 768, padding: 16 });
    expect(got.map((e) => e.id)).toEqual(["a", "t"]);
  });

  it("picks the elements touching a box", () => {
    const got = pickElements(all, {
      box: { x: 400, y: 0, width: 200, height: 50 },
      maxSide: 768,
      padding: 16,
    });
    expect(got.map((e) => e.id)).toEqual(["b"]);
  });

  it("an unknown id or an empty result is NOT_FOUND", () => {
    expect(() =>
      pickElements(all, { ids: ["zz"], maxSide: 768, padding: 16 }),
    ).toThrow(/no element with id zz/);
    expect(() => pickElements([], { maxSide: 768, padding: 16 })).toThrow(
      /nothing to draw/,
    );
  });
});
