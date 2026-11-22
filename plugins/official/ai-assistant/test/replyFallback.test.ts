import { describe, expect, it } from "vitest";

import { parseReply } from "../src/reply";
import { parseFixes } from "../src/review";

// toimprove 367: real Haiku replies that the app dropped
describe("replies a real model writes", () => {
  it("a plain Markdown page becomes headings, text and diagrams, not lost", () => {
    const r = parseReply(
      [
        "Here is an intro to networking.",
        "",
        "# Networking basics",
        "Computers talk through layers.",
        "",
        "## The layers",
        "- Physical",
        "- Network",
        "",
        "```mermaid",
        "sequenceDiagram",
        "  A->>B: hello",
        "```",
      ].join("\n"),
    );
    expect(r.blocks.map((b) => b.kind)).toEqual([
      "heading",
      "text",
      "heading",
      "text",
      "diagram",
    ]);
    expect(r.prose).toBe("Here is an intro to networking.");
  });

  it("a short answer in words stays a chat answer", () => {
    const r = parseReply("TCP is reliable.\n\n# One heading\nok");
    expect(r.blocks).toEqual([]);
  });

  it("a bare ```vd fence with ops is an edit; with elements a drawing", () => {
    const r = parseReply('```vd\n{"ops":[{"op":"delete","id":"a"}]}\n```');
    expect(r.blocks[0].kind).toBe("edit");
    const d = parseReply('```vd\n[{"type":"rectangle"}]\n```');
    expect(d.blocks[0].kind).toBe("draw");
  });

  it("the review pass reads a bare ```vd fix too", () => {
    expect(
      parseFixes('```vd\n{"ops":[{"op":"update","id":"a","x":1}]}\n```'),
    ).toHaveLength(1);
  });
});
