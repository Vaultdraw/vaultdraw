/**
 * Bug family (toimprove 342): everything drawn by zoom level must not blink when the zoom wobbles
 * a little. A small zoom change may change opacity or size only a little; nothing may switch on
 * and off. One row per member; a new zoom-dependent drawing adds a row.
 */
import { describe, expect, it } from "vitest";

import { patternLevelAlpha } from "../../../../packages/excalidraw/data/backgroundPattern";

import { LabelLayer } from "./labels";
import { edgeAlpha } from "./renderer/shared";

/**
 * Graph label: 1 if a label shown at zoom*1.02 is gone at zoom*0.98 (a blink), else 0.
 * (Shown or not is the output that matters for labels; opacity is a time fade.)
 */
const labelBlink = (zoom: number) => {
  const L = new LabelLayer({ label: () => "Plan", fadeScale: 0.5 });
  L.setGraph(1, [0]);
  const at = (scale: number) =>
    L.layout({
      positions: new Float32Array([0, 0]),
      camera: { x: 0, y: 0, scale },
      width: 800,
      height: 600,
    });
  return at(zoom * 1.02) === 1 && at(zoom * 0.98) === 0 ? 1 : 0;
};

/** Each member: the largest output change a 2% zoom wobble may cause, over a zoom range. */
const MEMBERS: {
  name: string;
  jump: (zoom: number) => number;
  range: [number, number];
  maxJump: number;
}[] = [
  {
    name: "graph label: shown stays shown",
    jump: labelBlink,
    range: [0.05, 4],
    maxJump: 0,
  },
  {
    name: "graph edge opacity",
    jump: (z) =>
      Math.abs(edgeAlpha(z * 1.02, 1000) - edgeAlpha(z * 0.98, 1000)),
    range: [0.005, 8],
    maxJump: 0.1,
  },
  {
    name: "paper pattern level opacity (gap 20 px at zoom 1)",
    jump: (z) =>
      Math.abs(
        patternLevelAlpha(20 * z * 1.02) - patternLevelAlpha(20 * z * 0.98),
      ),
    range: [0.1, 10],
    maxJump: 0.15,
  },
];

describe("zoom wobble family: nothing switches on and off with a 2% zoom change", () => {
  for (const m of MEMBERS) {
    it(m.name, () => {
      let worst = 0;
      for (let z = m.range[0]; z < m.range[1]; z *= 1.01) {
        worst = Math.max(worst, m.jump(z));
      }
      expect(worst).toBeLessThanOrEqual(m.maxJump);
    });
  }
});
