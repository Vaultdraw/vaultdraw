/**
 * Labels while zooming (toimprove 342): a small zoom wobble never toggles a label, a group of
 * same-degree nodes does not switch at one zoom, and every change is a short fade.
 */
import { describe, expect, it } from "vitest";

import { LabelLayer, SETTLE_MS } from "./labels";

const DT = 1000 / 60;

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** Records what `draw` paints in one frame: text -> alpha. */
const recorder = () => {
  const frame = new Map<string, number>();
  const ctx = {
    setTransform() {},
    clearRect() {
      frame.clear();
    },
    fillText(t: string) {
      frame.set(t, ctx.globalAlpha);
    },
    font: "",
    fillStyle: "",
    textBaseline: "",
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, frame };
};

type Scene = { n: number; pos: Float32Array; deg: number[] };

/** Visible on/off state per label, kept across `play` calls on the same layer. */
const seen = new WeakMap<LabelLayer, Map<string, boolean>>();

/** Drives `draw` through a list of zooms; counts each label's readable on/off switches. */
const play = (
  L: LabelLayer,
  s: Scene,
  scales: number[],
  opts: { width?: number; height?: number } = {},
) => {
  const { ctx, frame } = recorder();
  const on = seen.get(L) ?? new Map<string, boolean>();
  seen.set(L, on);
  const flips = new Map<string, number>();
  let worstFrame = 0;
  const alphas: Map<string, number>[] = [];
  for (const scale of scales) {
    L.draw(
      ctx,
      {
        positions: s.pos,
        camera: { x: 0, y: 0, scale },
        width: opts.width ?? 1200,
        height: opts.height ?? 800,
        dtMs: DT,
      },
      "#000",
    );
    alphas.push(new Map(frame));
    let switched = 0;
    for (const t of new Set([...on.keys(), ...frame.keys()])) {
      const v = (frame.get(t) ?? 0) > 0.3; // "readable"
      if ((on.get(t) ?? false) !== v) {
        flips.set(t, (flips.get(t) ?? 0) + 1);
        switched++;
      }
      on.set(t, v);
    }
    worstFrame = Math.max(worstFrame, switched);
  }
  return { flips, worstFrame, alphas, frame };
};

/** The zoom at which node i starts to show (searched through the layout itself). */
const showZoom = (s: Scene, i: number, fadeScale: number) => {
  let lo = 0.001;
  let hi = 10;
  for (let k = 0; k < 40; k++) {
    const mid = Math.sqrt(lo * hi);
    const L = new LabelLayer({ label: (j) => `n${j}`, fadeScale });
    L.setGraph(s.n, s.deg);
    L.layout({
      positions: s.pos,
      camera: { x: 0, y: 0, scale: mid },
      width: 1200,
      height: 800,
    });
    if (Array.from(L.index.slice(0, L.count)).includes(i)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
};

/** A vault-like graph: many drawings with 0-2 links, a few hubs, spread over the screen. */
const vault = (n = 600): Scene => {
  const r = rng(3);
  const pos = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) {
    pos[i] = (r() - 0.5) * 3000;
  }
  const deg = Array.from({ length: n }, () =>
    Math.max(0, Math.floor(1 / (r() + 0.02)) - 1),
  );
  return { n, pos, deg };
};

const wobble = (z: number, frames: number, amp = 0.02) =>
  Array.from({ length: frames }, (_, t) => z * (1 + amp * Math.sin(t / 15)));

describe("labels while zooming", () => {
  it("one label: zoom wobbling 2% around its threshold does not blink it; it fades in once", () => {
    const s: Scene = { n: 1, pos: new Float32Array([0, 0]), deg: [0] };
    const z = showZoom(s, 0, 0.5);
    const L = new LabelLayer({ label: () => "Plan", fadeScale: 0.5 });
    L.setGraph(1, s.deg);
    // every frame alternates 2% above and 2% below the threshold
    const scales = Array.from({ length: 60 }, (_, t) =>
      t % 2 === 0 ? z * 1.02 : z * 0.98,
    );
    const { alphas } = play(L, s, scales);
    const drawn = alphas.map((a) => a.get("Plan") ?? 0);
    const painted = drawn.map((a) => a > 0);
    let flips = 0;
    for (let k = 1; k < drawn.length; k++) {
      if (painted[k] !== painted[k - 1]) {
        flips++;
      }
    }
    expect(flips).toBe(0); // shown from the first frame, never hidden again
    // ... and it ramps up over several frames instead of popping
    expect(drawn[0]).toBeGreaterThan(0);
    expect(drawn[0]).toBeLessThan(0.5);
    for (let k = 1; k < drawn.length; k++) {
      expect(drawn[k]).toBeGreaterThanOrEqual(drawn[k - 1]);
    }
    expect(drawn[drawn.length - 1]).toBe(1);
  });

  it("one label hides only when zoomed clearly below the zoom that showed it", () => {
    const s: Scene = { n: 1, pos: new Float32Array([0, 0]), deg: [0] };
    const z = showZoom(s, 0, 0.5);
    const L = new LabelLayer({ label: () => "Plan", fadeScale: 0.5 });
    L.setGraph(1, s.deg);
    const shownAt = (scale: number) => {
      L.layout({
        positions: s.pos,
        camera: { x: 0, y: 0, scale },
        width: 1200,
        height: 800,
        dtMs: DT,
      });
      return L.count;
    };
    expect(shownAt(z * 0.97)).toBe(0); // not yet
    expect(shownAt(z * 1.01)).toBe(1); // shows at its zoom
    expect(shownAt(z * 0.95)).toBe(1); // a little lower: stays
    expect(shownAt(z * 0.85)).toBe(0); // clearly lower: hides
    expect(shownAt(z * 0.97)).toBe(0); // and does not come back until its zoom again
  });

  it("a vault graph under a slow 2% zoom wobble: no label switches more than once each way", () => {
    for (const z of [0.3, 0.45, 0.6, 0.8]) {
      const s = vault();
      const L = new LabelLayer({
        label: (i) => `drawing-${i}`,
        fadeScale: 0.5,
      });
      L.setGraph(s.n, s.deg);
      // settle at the zoom first, then wobble for 10 seconds
      play(L, s, Array(60).fill(z));
      const { flips, worstFrame } = play(L, s, wobble(z, 600));
      const most = Math.max(0, ...flips.values());
      expect(most, `zoom ${z}`).toBeLessThanOrEqual(2);
      expect(worstFrame, `zoom ${z}`).toBeLessThanOrEqual(12);
    }
  });

  it("a slow zoom in: drawings with the same number of links do not all appear at once", () => {
    const n = 200;
    const pos = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      pos[2 * i] = ((i % 20) - 10) * 400; // far apart: no collisions
      pos[2 * i + 1] = (Math.floor(i / 20) - 5) * 400;
    }
    // one hub elsewhere, so the 199 others share one importance
    const deg = Array(n).fill(1);
    deg[0] = 60;
    const s: Scene = { n, pos, deg };
    const L = new LabelLayer({
      label: (i) => `d${i}`,
      fadeScale: 0.5,
      maxLabels: 400,
    });
    L.setGraph(n, s.deg);
    const sweep: number[] = [];
    for (let k = 0.05; k < 1; k *= 1.003) {
      sweep.push(k);
    }
    const { worstFrame, frame } = play(L, s, sweep, {
      width: 20000,
      height: 20000,
    });
    expect(frame.size).toBe(n); // all shown at the end
    expect(worstFrame).toBeLessThanOrEqual(n / 10);
  });

  it("a label pushed out by a collision while zooming returns only after the zoom settles", () => {
    // two nodes 120 world px apart: their labels fit at zoom 1, collide at zoom 0.4
    const s: Scene = {
      n: 2,
      pos: new Float32Array([0, 0, 120, 0]),
      deg: [5, 1],
    };
    const L = new LabelLayer({ label: (i) => `drawing-${i}`, fadeScale: 0.01 });
    L.setGraph(2, s.deg);
    play(L, s, Array(30).fill(1));
    const both = play(L, s, [1]).frame;
    expect(both.size).toBe(2);
    // zoom out: the less linked label is pushed out
    const out: number[] = [];
    for (let k = 1; k > 0.4; k *= 0.97) {
      out.push(k);
    }
    play(L, s, out);
    // zoom back in within the same gesture, then hold still
    const back: number[] = [];
    for (let k = 0.4; k < 1; k *= 1.03) {
      back.push(k);
    }
    const during = play(L, s, back);
    expect(during.frame.has("drawing-1")).toBe(false);
    expect(L.animating).toBe(true); // keeps frames coming until it settles
    const settleFrames = Math.ceil((SETTLE_MS + 700) / DT);
    const after = play(L, s, Array(settleFrames).fill(1));
    expect(after.frame.get("drawing-1")).toBe(1);
    expect(L.animating).toBe(false);
  });

  it("reduced motion: no fade (full opacity at once), and the wobble still does not blink", () => {
    const s: Scene = { n: 1, pos: new Float32Array([0, 0]), deg: [0] };
    const z = showZoom(s, 0, 0.5);
    const L = new LabelLayer({
      label: () => "Plan",
      fadeScale: 0.5,
      reducedMotion: true,
    });
    L.setGraph(1, s.deg);
    const { alphas } = play(
      L,
      s,
      Array.from({ length: 20 }, (_, t) => (t % 2 ? z * 0.98 : z * 1.02)),
    );
    expect(alphas.every((a) => a.get("Plan") === 1)).toBe(true);
    const gone = play(L, s, [z * 0.5]).frame;
    expect(gone.size).toBe(0);
  });
});
