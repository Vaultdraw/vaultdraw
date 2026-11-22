import { describe, expect, it } from "vitest";

import { selectionIsDiagram, summarizeDrawing } from "../src/context";

import type { SceneElement } from "@vaultdraw/api";

const el = (i: number, type = "rectangle", text?: string) =>
  ({
    id: `e${i}`,
    type,
    x: (i % 50) * 200,
    y: Math.floor(i / 50) * 120,
    width: 160,
    height: 70,
    angle: 0,
    ...(text ? { text } : {}),
  } as SceneElement);

describe("the drawing summary", () => {
  it("a 2,000-element drawing stays under the cap, selection first", () => {
    const els = Array.from({ length: 2000 }, (_, i) =>
      el(
        i,
        i % 3 ? "rectangle" : "text",
        `Label number ${i} with some words in it`,
      ),
    );
    const c = summarizeDrawing(els, ["e1999", "e5"], 4000, "Big.excalidraw");
    expect(c.text.length).toBeLessThanOrEqual(4000);
    expect(c.text).toMatch(/^2000 elements: \d+ text, \d+ rectangle\./);
    expect(c.text).toContain("Selected (2), in full:");
    expect(c.text.indexOf("- id e5:")).toBeLessThan(
      c.text.indexOf("Texts, top to bottom"),
    );
    expect(c.text).toMatch(/\(\d+ more lines left out\)$/);
    expect(c.cut).toBeGreaterThan(0);
  });

  it("small drawings list their texts with ids, top to bottom", () => {
    const c = summarizeDrawing(
      [el(51, "text", "second row"), el(1, "rectangle", "Client")],
      [],
      4000,
      "a.excalidraw",
    );
    expect(c.text).toContain(
      '- e1 rectangle: "Client"\n- e51 text: "second row"',
    );
    expect(c.summary).toBe("The whole drawing: 2 elements");
    expect(
      summarizeDrawing([el(1)], ["e1"], 4000, "a.excalidraw", "selection")
        .summary,
    ).toBe("The selection: 1 element, 1 selected");
  });

  it("an empty drawing and no open drawing are said plainly", () => {
    expect(summarizeDrawing([], [], 4000, "a.excalidraw").text).toBe(
      "The drawing is empty.",
    );
    expect(summarizeDrawing([], [], 4000, null).text).toMatch(
      /^No drawing is open/,
    );
  });

  it("a selection of shapes joined by an arrow is a diagram", () => {
    const els = [el(1), el(2), el(3, "arrow"), el(4, "text", "x")];
    expect(selectionIsDiagram(els, ["e1", "e2", "e3"])).toBe(true);
    expect(selectionIsDiagram(els, ["e1", "e4"])).toBe(false);
  });
});
