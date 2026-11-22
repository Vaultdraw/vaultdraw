import { describe, expect, it } from "vitest";

import { normalizePanelWidths } from "../../vault/preferences";

import {
  clampPanelWidth,
  dragPanelWidth,
  keyPanelWidth,
  PANEL_DEFAULT_WIDTH,
  savedPanelWidth,
  withPanelWidth,
} from "./panelWidth";

describe("panel width", () => {
  it("clamps to 280 and 60% of the window", () => {
    expect(clampPanelWidth(100, 1500)).toBe(280);
    expect(clampPanelWidth(5000, 1500)).toBe(900);
    expect(clampPanelWidth(400, 1500)).toBe(400);
    expect(clampPanelWidth(400, 300)).toBe(280);
    expect(clampPanelWidth(NaN, 1500)).toBe(PANEL_DEFAULT_WIDTH);
  });
  it("reads saved widths, clamped, default when missing", () => {
    expect(savedPanelWidth({}, "a", 1500)).toBe(320);
    expect(savedPanelWidth({ a: 450 }, "a", 1500)).toBe(450);
    expect(savedPanelWidth({ a: 450 }, "a", 600)).toBe(360);
  });
  it("writes widths and drops the default (reset)", () => {
    expect(withPanelWidth({ b: 300 }, "a", 450)).toEqual({ a: 450, b: 300 });
    expect(withPanelWidth({ a: 450 }, "a", PANEL_DEFAULT_WIDTH)).toEqual({});
  });
  it("drags left to widen, right to narrow", () => {
    expect(dragPanelWidth(320, 1000, 900, 1500)).toBe(420);
    expect(dragPanelWidth(320, 1000, 1200, 1500)).toBe(280);
  });
  it("arrow keys step, Home resets, others ignored", () => {
    expect(keyPanelWidth("ArrowLeft", 320, 1500)).toBe(336);
    expect(keyPanelWidth("ArrowRight", 320, 1500)).toBe(304);
    expect(keyPanelWidth("ArrowRight", 280, 1500)).toBe(280);
    expect(keyPanelWidth("Home", 500, 1500)).toBe(320);
    expect(keyPanelWidth("a", 320, 1500)).toBeNull();
  });
  it("normalizes stored widths", () => {
    expect(normalizePanelWidths({ a: 400.4, b: -1, c: "x", d: NaN })).toEqual({
      a: 400,
    });
    expect(normalizePanelWidths(null)).toEqual({});
    expect(normalizePanelWidths([1])).toEqual({});
  });
});
