import { describe, expect, it } from "vitest";

import { taskClickAt, type TaskText } from "./taskClick";

// Every character 10 wide: a box at "☐ " sits at x 0..10 of the line.
const measure = (s: string) => s.length * 10;
const LINE = 20 * 1.25;

const text = (t: string, extra: Partial<TaskText> = {}): TaskText => ({
  x: 0,
  y: 0,
  width: 300,
  angle: 0,
  fontSize: 20,
  lineHeight: 1.25,
  textAlign: "left",
  text: t,
  originalText: t,
  ...extra,
});

describe("clicking a task box on the canvas (toimprove 369)", () => {
  const list = "☐ mapping\n☐ schema\n☑ rules";

  it("a click on a box ticks that line only", () => {
    expect(taskClickAt(text(list), 5, LINE * 1 + 5, measure)).toBe(
      "☐ mapping\n☑ schema\n☑ rules",
    );
  });

  it("a click on a ticked box unticks it", () => {
    expect(taskClickAt(text(list), 5, LINE * 2 + 5, measure)).toBe(
      "☐ mapping\n☐ schema\n☐ rules",
    );
  });

  it("a click on the words does nothing (select and edit stay as they were)", () => {
    expect(taskClickAt(text(list), 60, 5, measure)).toBeNull();
  });

  it("a click on a line that is not a task does nothing", () => {
    expect(taskClickAt(text("Title\n☐ a"), 5, 5, measure)).toBeNull();
  });

  it("an indented box is found where it is drawn", () => {
    const t = "☐ a\n  ☐ b";
    expect(taskClickAt(text(t), 2, LINE + 5, measure)).toBeNull();
    expect(taskClickAt(text(t), 25, LINE + 5, measure)).toBe("☐ a\n  ☑ b");
  });

  it("a wrapped line maps to the right written line", () => {
    const el = text("☐ long\nwrapped\n☐ next", {
      originalText: "☐ long wrapped\n☐ next",
    });
    expect(taskClickAt(el, 5, LINE * 2 + 5, measure)).toBe(
      "☐ long wrapped\n☑ next",
    );
  });

  it("centred text: the box is where the centred line starts", () => {
    const el = text("☐ ab", { textAlign: "center", width: 100 });
    // line 40 wide, starts at 30
    expect(taskClickAt(el, 5, 5, measure)).toBeNull();
    expect(taskClickAt(el, 35, 5, measure)).toBe("☑ ab");
  });

  it("a rotated text is left alone", () => {
    expect(taskClickAt(text(list, { angle: 1 }), 5, 5, measure)).toBeNull();
  });
});

describe("task boxes drawn larger (toimprove 370)", () => {
  it("a click just right of the plain glyph still hits the larger drawn box", () => {
    // glyph 10 wide drawn 14 wide: x 12 is inside it
    expect(taskClickAt(text("☐ a"), 12, 5, measure)).toBe("☑ a");
  });

  it("one larger run per box, on the box only", async () => {
    const { taskBoxRunsOf } = await import("./inlineStyler");
    const runs = taskBoxRunsOf({
      text: "Title\n☐ a\n  ☑ b",
      fontFamily: 3,
      fontSize: 20,
    });
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [6, 7],
      [12, 13],
    ]);
    expect(runs[0].font).toContain("28px");
  });
});
