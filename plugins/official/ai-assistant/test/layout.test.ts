import { describe, expect, it } from "vitest";

import {
  anchorFor,
  measureText,
  overlaps,
  stack,
  stackSize,
  styleDiagram,
  wrap,
  type Item,
  type Rect,
} from "../src/layout";

const items: Item[] = [
  { kind: "text", text: "How networks work", fontSize: 36 },
  {
    kind: "text",
    text: "- A packet is a small piece of a message, with an address on it, sent on its own",
    fontSize: 20,
  },
  {
    kind: "diagram",
    ops: [
      {
        op: "add",
        ref: "a",
        element: {
          type: "rectangle",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "Router",
        },
      },
    ],
    width: 200,
    height: 80,
  },
  {
    kind: "text",
    text: "Key terms\nPacket: a piece of a message",
    fontSize: 18,
    boxed: true,
  },
];

describe("the stacker", () => {
  it("stacks items top to bottom with no overlaps between them", () => {
    const r = stack(items, { x: 100, y: 50 });
    for (let i = 0; i < r.placed.length; i++) {
      for (let j = i + 1; j < r.placed.length; j++) {
        expect(overlaps(r.placed[i], r.placed[j])).toBe(false);
      }
      if (i > 0) {
        expect(r.placed[i].y).toBeGreaterThan(r.placed[i - 1].y);
      }
    }
    expect(r.rect.x).toBe(100);
    // the diagram's shape moved with the column and got a solid pastel fill
    const box = r.ops.find(
      (o) => o.op === "add" && o.element.text === "Router",
    ) as any;
    expect(box.element.y).toBe(r.placed[2].y);
    expect(box.element.fillStyle).toBe("solid");
  });

  it.each([
    ["empty canvas", [] as Rect[], null],
    [
      "below a busy canvas",
      [
        { x: 0, y: 0, width: 900, height: 600 },
        { x: 1000, y: 200, width: 300, height: 900 },
      ],
      null,
    ],
    [
      "replacing, room to fit",
      [{ x: 2000, y: 0, width: 100, height: 100 }],
      { x: 0, y: 0, width: 800, height: 900 },
    ],
    [
      "replacing, no room: something sits right under the old diagram",
      [{ x: 0, y: 220, width: 400, height: 100 }],
      { x: 0, y: 0, width: 300, height: 200 },
    ],
  ])(
    "never overlaps what stays on the canvas: %s",
    (_n, remaining, replaced) => {
      const size = stackSize(items);
      const at = anchorFor(size, remaining, replaced, { x: 500, y: 500 });
      const r = stack(items, at);
      for (const p of r.placed) {
        for (const e of remaining) {
          expect(overlaps(p, e)).toBe(false);
        }
      }
      if (
        replaced &&
        remaining.every((e) => !overlaps({ ...replaced, ...size }, e, 40))
      ) {
        expect(at).toEqual({ x: replaced.x, y: replaced.y });
      }
    },
  );

  it("wraps long text to the column and keeps bullets hanging", () => {
    const w = wrap("- one two three four five six", 12);
    expect(w).toBe("- one two\n  three four\n  five six");
    const m = measureText("word ".repeat(60), 20);
    expect(m.width).toBeLessThanOrEqual(720);
    expect(m.text.split("\n").length).toBeGreaterThan(3);
  });

  it("fonts never go below 16 px; given colours are kept", () => {
    const out = styleDiagram([
      { op: "add", element: { type: "text", text: "tiny", fontSize: 10 } },
      {
        op: "add",
        element: {
          type: "rectangle",
          text: "Mine",
          backgroundColor: "#ff0000",
        },
      },
    ]) as any[];
    expect(out[0].element.fontSize).toBe(16);
    expect(out[1].element.backgroundColor).toBe("#ff0000");
  });
});
