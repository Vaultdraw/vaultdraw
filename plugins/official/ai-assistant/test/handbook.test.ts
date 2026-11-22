import { describe, expect, it } from "vitest";

import { SETTING_VALUES } from "../src/edits";
import {
  CORE,
  DRAWING_CORE,
  pickSections,
  SECTIONS,
  systemPrompt,
  tokens,
} from "../src/handbook";

const names = (
  request: string,
  previous?: string,
  selectionIsDiagram = false,
) => pickSections({ request, previous, selectionIsDiagram }).map((s) => s.name);

describe("the handbook", () => {
  it("the always-on core stays under its budget (about 1,500 tokens)", () => {
    expect(tokens(CORE)).toBeLessThanOrEqual(1500);
  });

  it("each section stays small (about 700 tokens)", () => {
    for (const s of SECTIONS) {
      expect(tokens(s.body), s.name).toBeLessThanOrEqual(700);
    }
  });

  it("the core names every action block, the checklist and the recipes, and carries the drawing paragraph", () => {
    for (const kind of [
      "heading",
      "text",
      "note",
      "draw",
      "diagram",
      "edit",
      "settings",
      "new",
    ]) {
      expect(CORE).toContain(`\`\`\`vd ${kind}`);
    }
    expect(CORE).toContain("Label every arrow");
    expect(CORE).toContain("autonumber");
    expect(CORE).not.toMatch(/keep (node )?labels short/i);
    for (const recipe of [
      "teach",
      "improve",
      "notes",
      "brainstorm",
      "compare",
    ]) {
      expect(CORE).toContain(`- ${recipe}:`);
    }
    expect(DRAWING_CORE.length).toBeGreaterThan(50);
    expect(CORE).toContain(DRAWING_CORE);
    expect(CORE).not.toContain("{{");
  });

  it('"teach me networking" pulls the teaching recipe and drawing help, not unrelated ones', () => {
    const got = names("teach me networking");
    expect(got).toContain("teach");
    expect(got).toContain("drawing");
    for (const no of [
      "settings",
      "compare",
      "brainstorm",
      "notes",
      "markdown",
    ]) {
      expect(got).not.toContain(no);
    }
  });

  it('"make this diagram more descriptive" pulls the improve recipe', () => {
    expect(
      names("make this diagram better, more descriptive and illustrative"),
    ).toContain("improve");
  });

  it("a vague follow-up keeps the recipe of the request before it", () => {
    expect(names("whole drawing")).not.toContain("improve");
    expect(names("whole drawing", "make this diagram better")).toContain(
      "improve",
    );
  });

  it("a selected diagram brings the improve recipe along", () => {
    expect(names("what is wrong here", undefined, true)).toContain("improve");
  });

  it("settings help lists the values the app accepts (one source with the checks)", () => {
    const settings = SECTIONS.find((s) => s.name === "settings")!;
    for (const v of [...SETTING_VALUES.paper, ...SETTING_VALUES.pageSize]) {
      expect(settings.body).toContain(v);
    }
    expect(names("use lined paper in A4")).toContain("settings");
  });

  it("the permission is stated, and read only forbids blocks", () => {
    const read = systemPrompt({ request: "hi" }, "read");
    expect(read).toContain("Read only");
    expect(read).toContain("never add action blocks");
    expect(systemPrompt({ request: "hi" }, "ask")).toContain("Ask first");
  });

  it("a plain question gets the core only", () => {
    expect(systemPrompt({ request: "hi there" }, "ask").length).toBeLessThan(
      CORE.length + 300,
    );
  });
});
