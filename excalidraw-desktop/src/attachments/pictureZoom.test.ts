import { describe, expect, it } from "vitest";

import {
  actualSizeAt,
  fitView,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  percent,
  zoomAt,
  zoomCentre,
} from "./pictureZoom";

const stage = { w: 800, h: 600 };

describe("picture viewer zoom", () => {
  it.each([
    ["a big picture fits inside the pane", { w: 4000, h: 3000 }, 0.2],
    ["a tall picture fits its height", { w: 300, h: 1200 }, 0.5],
    ["a small picture stays at 100%", { w: 100, h: 50 }, 1],
  ])("%s", (_, picture, scale) => {
    const v = fitView(stage, picture);
    expect(v.scale).toBeCloseTo(scale);
    expect(v.fit).toBe(true);
    // Centred.
    expect(v.x + (picture.w * v.scale) / 2).toBeCloseTo(stage.w / 2);
    expect(v.y + (picture.h * v.scale) / 2).toBeCloseTo(stage.h / 2);
  });

  it("an empty stage or picture never divides by zero", () => {
    expect(fitView({ w: 0, h: 0 }, { w: 10, h: 10 }).scale).toBe(1);
    expect(fitView(stage, { w: 0, h: 0 }).scale).toBe(1);
  });

  it("zoom keeps the point under the pointer still", () => {
    const v = { scale: 0.5, x: 100, y: 50, fit: true };
    const z = zoomAt(v, 2, 300, 200);
    // The picture point under (300, 200) before and after.
    const before = { x: (300 - v.x) / v.scale, y: (200 - v.y) / v.scale };
    const after = { x: (300 - z.x) / z.scale, y: (200 - z.y) / z.scale };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.fit).toBe(false);
  });

  it("zoom stays between 5% and 3200%", () => {
    const v = { scale: 1, x: 0, y: 0, fit: false };
    expect(zoomCentre(v, 1e6, stage).scale).toBe(MAX_SCALE);
    expect(zoomCentre(v, 1e-6, stage).scale).toBe(MIN_SCALE);
  });

  it("actual size is 100% about the given point; pan moves and leaves fit", () => {
    const v = { scale: 0.25, x: 10, y: 10, fit: true };
    expect(actualSizeAt(v, 400, 300).scale).toBe(1);
    const p = panBy(v, 5, -7);
    expect([p.x, p.y, p.fit]).toEqual([15, 3, false]);
  });

  it("percent rounds", () => {
    expect(percent(0.3333)).toBe("33%");
    expect(percent(32)).toBe("3200%");
  });
});
