import { describe, expect, it } from "vitest";

import { parseAttrs, parseReply, streamingView } from "../src/reply";

const fence = (info: string, body: string) => `\`\`\`${info}\n${body}\n\`\`\``;

describe("parseReply: prose plus vd action blocks", () => {
  it("a reply without blocks is a plain answer", () => {
    const r = parseReply('Hello.\n\nA JSON example:\n```json\n{"a":1}\n```');
    expect(r.blocks).toEqual([]);
    expect(r.prose).toContain("```json");
    expect(r.open).toBe(false);
  });

  it.each([
    ["heading level=2", "Section", { kind: "heading", attrs: { level: "2" } }],
    ["text", "- one\n- two", { kind: "text", attrs: {} }],
    ["note", "Key terms", { kind: "note", attrs: {} }],
    [
      'diagram title="How JWT works" caption="Sign once" replace=selection',
      "sequenceDiagram\n  A->>B: hi",
      {
        kind: "diagram",
        attrs: {
          title: "How JWT works",
          caption: "Sign once",
          replace: "selection",
        },
      },
    ],
    [
      "draw replace=all",
      '[{"type":"rectangle"}]',
      { kind: "draw", attrs: { replace: "all" } },
    ],
    ["edit", '{"ops":[]}', { kind: "edit", attrs: {} }],
    ["settings", '{"pageMode":true}', { kind: "settings", attrs: {} }],
    [
      "new title='Networking'",
      "",
      { kind: "new", attrs: { title: "Networking" } },
    ],
  ])("vd %s", (info, body, want) => {
    const r = parseReply(`Sure.\n\n${fence(`vd ${info}`, body)}`);
    expect(r.prose).toBe("Sure.");
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ ...want, body });
  });

  it("many blocks keep their order, and the prose around them joins up", () => {
    const answer = [
      "I built the page.",
      fence("vd heading level=1", "Networking"),
      fence("vd text", "- packets"),
      "It has two parts.",
      fence("vd diagram", "flowchart LR\n A-->|bytes|B"),
    ].join("\n\n");
    const r = parseReply(answer);
    expect(r.blocks.map((b) => b.kind)).toEqual(["heading", "text", "diagram"]);
    expect(r.prose).toBe("I built the page.\n\nIt has two parts.");
  });

  it("Mermaid with its own code fence inside a longer fence stays whole", () => {
    const r = parseReply("````vd text\nUse:\n```\ncode\n```\n````");
    expect(r.blocks[0].body).toBe("Use:\n```\ncode\n```");
  });

  it("malformed: an unknown kind is skipped and named; an unclosed block is kept and flagged", () => {
    const r = parseReply(`${fence("vd sparkle", "x")}\n${"```vd text\nhalf"}`);
    expect(r.skipped).toEqual(['an unknown "sparkle" block']);
    expect(r.blocks).toEqual([{ kind: "text", attrs: {}, body: "half" }]);
    expect(r.open).toBe(true);
  });

  it("while streaming, the chat shows only the prose and says changes are coming", () => {
    expect(streamingView("Working on it\n```vd heading\nNet")).toEqual({
      prose: "Working on it",
      building: true,
    });
    expect(streamingView("Just words")).toEqual({
      prose: "Just words",
      building: false,
    });
  });

  it("attributes: quoted, single-quoted and bare values", () => {
    expect(
      parseAttrs(` title="a b" Level=2 caption='c d' replace=id1,id2`),
    ).toEqual({
      title: "a b",
      level: "2",
      caption: "c d",
      replace: "id1,id2",
    });
  });
});
