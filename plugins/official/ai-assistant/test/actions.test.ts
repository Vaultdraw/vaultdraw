import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildActions,
  prefixRefs,
  replacedIds,
  type ActionEnv,
} from "../src/actions";
import { overlaps } from "../src/layout";
import { completeOnly, parseReply } from "../src/reply";

import type { SceneElement, SceneOp } from "@vaultdraw/api";

const el = (id: string, type: string, x: number, y: number, text?: string) =>
  ({
    id,
    type,
    x,
    y,
    width: 140,
    height: 70,
    angle: 0,
    ...(text ? { text } : {}),
  } as SceneElement);

/** The owner's diagram from image_63: a few boxes and arrows about a concept. */
const diagram = [
  el("b1", "rectangle", 0, 0, "Client"),
  el("b2", "rectangle", 300, 0, "Server"),
  el("a1", "arrow", 140, 35),
  el("b3", "rectangle", 600, 0, "Database"),
];

const mermaidResult = {
  ops: [
    {
      op: "add",
      ref: "u",
      element: {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        text: "User",
      },
    },
    {
      op: "add",
      ref: "s",
      element: {
        type: "rectangle",
        x: 300,
        y: 0,
        width: 120,
        height: 60,
        text: "Server",
      },
    },
    {
      op: "add",
      element: {
        type: "arrow",
        x: 60,
        y: 150,
        points: [
          [0, 0],
          [300, 0],
        ],
        text: "POST /login (credentials)",
      },
    },
  ] as SceneOp[],
  width: 420,
  height: 160,
  skipped: 0,
};

const env = (over: Partial<ActionEnv> = {}): ActionEnv => ({
  elements: diagram,
  selection: [],
  path: "Concept.excalidraw",
  viewCenter: { x: 400, y: 300 },
  maxOps: 60,
  convertMermaid: vi.fn(async () => mermaidResult),
  ...over,
});

const fence = (info: string, body = "") => `\`\`\`${info}\n${body}\n\`\`\``;

describe("buildActions: one reply, one proposal, one undo step", () => {
  it('"make this diagram more descriptive" → a Mermaid diagram that replaces the old one in place', async () => {
    const reply = parseReply(
      `I rebuilt it as a numbered sequence.\n${fence(
        'vd diagram replace=all title="How login works" caption="The server checks the token."',
        "sequenceDiagram\n  autonumber\n  U->>S: POST /login (credentials)",
      )}`,
    );
    const e = env();
    const p = (await buildActions(reply, e))!;
    expect(e.convertMermaid).toHaveBeenCalledWith(
      "sequenceDiagram\n  autonumber\n  U->>S: POST /login (credentials)",
    );
    expect(p.kind).toBe("edit");
    // the old elements go and the new ones come in the same batch
    const deletes = p.ops
      .filter((o) => o.op === "delete")
      .map((o: any) => o.id);
    expect(deletes.sort()).toEqual(["a1", "b1", "b2", "b3"]);
    const texts = p.ops.flatMap((o) =>
      o.op === "add" && o.element.text ? [o.element.text] : [],
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        "How login works",
        "POST /login (credentials)",
        "The server checks the token.",
      ]),
    );
    // placed where the old diagram was (it all went, so the spot is free)
    const title = p.ops.find(
      (o) => o.op === "add" && o.element.text === "How login works",
    ) as any;
    expect([title.element.x, title.element.y]).toEqual([0, 0]);
    expect(p.headline).toBe("Replaces 4 elements, adds 1 drawing");
    expect(p.touched.sort()).toEqual(["a1", "b1", "b2", "b3"]);
    expect(p.ghosts.filter((g) => g.state === "removed")).toHaveLength(4);
  });

  it("replace=selection replaces only the selection", () => {
    expect(
      replacedIds("selection", { elements: diagram, selection: ["b1", "zz"] }),
    ).toEqual(["b1"]);
    expect(
      replacedIds("b2, a1 nope", { elements: diagram, selection: [] }),
    ).toEqual(["b2", "a1"]);
    expect(
      replacedIds(undefined, { elements: diagram, selection: [] }),
    ).toEqual([]);
  });

  it('"teach me networking": headings, text, notes and drawings in order, below the existing content, nothing overlapping', async () => {
    const reply = parseReply(
      [
        "Here is a page on networking.",
        fence("vd heading level=1", "How networks move your data"),
        fence(
          "vd text",
          "A network moves messages between computers.\n- Packets\n- Addresses",
        ),
        fence("vd heading level=2", "Packets"),
        fence(
          'vd draw title="A packet\'s trip"',
          JSON.stringify([
            {
              type: "rectangle",
              id: "pc",
              x: 0,
              y: 0,
              width: 160,
              height: 70,
              backgroundColor: "input",
              label: { text: "Laptop" },
            },
            {
              type: "rectangle",
              id: "r",
              x: 300,
              y: 0,
              width: 160,
              height: 70,
              backgroundColor: "processing",
              label: { text: "Router" },
            },
            {
              type: "arrow",
              x: 160,
              y: 35,
              points: [
                [0, 0],
                [140, 0],
              ],
              start: "pc",
              end: "r",
              label: { text: "1. packet" },
            },
          ]),
        ),
        fence("vd note", "Key terms\nPacket: a piece of a message"),
      ].join("\n\n"),
    );
    const p = (await buildActions(reply, env()))!;
    expect(p.headline).toBe("Adds 2 headings, 1 text, 1 note, 1 drawing");
    const adds = p.ops.filter((o) => o.op === "add") as Extract<
      SceneOp,
      { op: "add" }
    >[];
    const order = adds.map((o) => o.element.text).filter(Boolean);
    expect(order[0]).toBe("How networks move your data");
    expect(order.indexOf("Packets")).toBeLessThan(order.indexOf("Laptop"));
    // nothing new sits on the old diagram
    for (const o of adds) {
      const r = {
        x: o.element.x ?? 0,
        y: o.element.y ?? 0,
        width: o.element.width ?? 1,
        height: o.element.height ?? 1,
      };
      for (const e of diagram) {
        expect(overlaps(r, e)).toBe(false);
      }
    }
    // the drawing's arrow is bound to its shapes
    const arrow = adds.find((o) => o.element.type === "arrow")!;
    expect(arrow.element.start).toBeTruthy();
    expect(arrow.element.end).toBeTruthy();
  });

  it("edits, settings and content go together in one proposal", async () => {
    const reply = parseReply(
      [
        fence(
          "vd edit",
          JSON.stringify({
            ops: [{ op: "restyle", id: "b1", strokeColor: "#e03131" }],
          }),
        ),
        fence(
          "vd settings",
          JSON.stringify({ pageMode: true, paper: "lines" }),
        ),
        fence("vd text", "A note below"),
      ].join("\n"),
    );
    const p = (await buildActions(reply, env()))!;
    expect(p.drawing).toEqual({ pageMode: true, paper: "lines" });
    expect(p.ops[0]).toMatchObject({ op: "update", id: "b1" });
    expect(p.headline).toMatch(/^Adds 1 text, restyles 1 box/);
  });

  it("vd new, or no open drawing, makes a new drawing (edits there are left out and said so)", async () => {
    const reply = parseReply(
      [
        fence('vd new title="Networking basics"'),
        fence("vd heading", "Networking"),
        fence("vd edit", '{"ops":[]}'),
      ].join("\n"),
    );
    const p = (await buildActions(reply, env()))!;
    expect(p.kind).toBe("create");
    expect(p.title).toBe("Networking basics");
    expect(p.path).toBeNull();
    expect(p.problems).toEqual([
      "changes to existing shapes (there is no drawing to change)",
    ]);
    const q = (await buildActions(
      parseReply(fence("vd text", "hi")),
      env({ path: null, elements: [] }),
    ))!;
    expect(q.kind).toBe("create");
  });

  it("a diagram that cannot be drawn is said, and the rest still goes in", async () => {
    const reply = parseReply(
      [fence("vd diagram", "nonsense"), fence("vd text", "still here")].join(
        "\n",
      ),
    );
    const p = (await buildActions(
      reply,
      env({
        convertMermaid: vi.fn(async () => {
          throw new Error("Parse error on line 1");
        }),
      }),
    ))!;
    expect(p.problems).toEqual([
      "a diagram that could not be drawn (Parse error on line 1)",
    ]);
    expect(p.headline).toBe("Adds 1 text");
  });

  it("no blocks, or blocks that do nothing, propose nothing", async () => {
    expect(await buildActions(parseReply("Just an answer."), env())).toBeNull();
    expect(
      await buildActions(parseReply(fence("vd text", "")), env()),
    ).toBeNull();
  });
});

// Real replies from the claude command line (sonnet, 2026-11-23) to the handbook prompt; the
// prompts and replies are in personal/feature/ai-agent/evidence/03-real-call-*.txt.
describe("real model replies", () => {
  const sample = (n: string) =>
    readFileSync(`${__dirname}/samples/reply-${n}.md`, "utf8");

  it('"make this diagram more descriptive": one numbered sequence diagram replacing the old one, plus key terms', async () => {
    const r = parseReply(sample("improve"));
    expect(r.blocks.map((b) => b.kind)).toEqual(["diagram", "note"]);
    expect(r.blocks[0].attrs.replace).toBe("all");
    expect(r.blocks[0].body).toMatch(/^sequenceDiagram\n\s+autonumber/);
    const p = (await buildActions(r, env()))!;
    expect(p.headline).toBe("Replaces 4 elements, adds 1 note, 1 drawing");
    expect(r.prose).toMatch(/^I rebuilt it/);
  });

  it('"teach me networking": a whole page with sections, three diagrams, notes and a summary', async () => {
    const r = parseReply(sample("teach"));
    const kinds = r.blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(6);
    expect(kinds.filter((k) => k === "diagram")).toHaveLength(3);
    const conv = vi.fn(async () => mermaidResult);
    const p = (await buildActions(
      r,
      env({ elements: [], convertMermaid: conv }),
    ))!;
    expect(conv).toHaveBeenCalledTimes(3);
    expect(p.headline).toBe("Adds 6 headings, 6 texts, 2 notes, 3 drawings");
    expect(r.prose).not.toContain("```");
  });
});

// Review findings (code review of feature/ai-agent, 2026-11-23): each failed on the first version.
describe("a change the host accepts in one batch", () => {
  const box = (ref: string) =>
    ({
      op: "add",
      ref,
      element: {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        text: ref,
      },
    } as SceneOp);
  const arrow = (a: string, b: string) =>
    ({
      op: "add",
      element: {
        type: "arrow",
        x: 0,
        y: 0,
        start: { ref: a },
        end: { ref: b },
      },
    } as SceneOp);

  it("two drawings with the same node names get refs of their own, and arrows follow", async () => {
    const conv = vi.fn(async () => ({
      ops: [box("A"), box("B"), arrow("A", "B")],
      width: 300,
      height: 60,
      skipped: 0,
    }));
    const reply = parseReply(
      [
        fence("vd diagram", "flowchart LR\n A-->B"),
        fence("vd diagram", "flowchart LR\n A-->B"),
      ].join("\n"),
    );
    const p = (await buildActions(
      reply,
      env({ elements: [], convertMermaid: conv }),
    ))!;
    const refs = p.ops.flatMap((o) => (o.op === "add" && o.ref ? [o.ref] : []));
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toEqual(["d1-A", "d1-B", "d2-A", "d2-B"]);
    const arrows = p.ops.filter(
      (o) => o.op === "add" && o.element.type === "arrow",
    ) as any[];
    expect(arrows.map((a) => [a.element.start.ref, a.element.end.ref])).toEqual(
      [
        ["d1-A", "d1-B"],
        ["d2-A", "d2-B"],
      ],
    );
  });

  it("refs only use the characters the host accepts", () => {
    const out = prefixRefs(
      [box("login box"), box("step#1"), arrow("login box", "step#1")],
      "d1-",
    ) as any[];
    for (const o of out.filter((x) => x.ref)) {
      expect(o.ref).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
    }
    expect(out[2].element.start.ref).toBe(out[0].ref);
  });

  it("the whole change stays under the host's 500 operations, deletes and edits included", async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      el(`x${i}`, "rectangle", i * 200, 0),
    );
    const conv = vi.fn(async () => ({
      ops: Array.from({ length: 400 }, (_, i) => box(`n${i}`)),
      width: 200,
      height: 60,
      skipped: 0,
    }));
    const p = (await buildActions(
      parseReply(fence("vd diagram replace=all", "flowchart")),
      env({ elements: many, convertMermaid: conv }),
    ))!;
    expect(p.ops.length).toBeLessThanOrEqual(500);
    expect(p.ops.filter((o) => o.op === "delete")).toHaveLength(300);
    expect(p.problems![0]).toMatch(/new elements past the limit of one change/);
  });

  it("an arrow to an element the same change replaces is not bound to it", async () => {
    const reply = parseReply(
      fence(
        "vd draw replace=b1",
        JSON.stringify([
          {
            type: "rectangle",
            id: "n",
            x: 0,
            y: 0,
            width: 160,
            height: 70,
            label: { text: "New" },
          },
          {
            type: "arrow",
            x: 160,
            y: 35,
            points: [
              [0, 0],
              [100, 0],
            ],
            start: "n",
            end: { id: "b2" },
          },
          {
            type: "arrow",
            x: 160,
            y: 35,
            points: [
              [0, 0],
              [100, 0],
            ],
            start: "n",
            end: { id: "b1" },
          },
        ]),
      ),
    );
    const p = (await buildActions(reply, env()))!;
    const arrows = p.ops.filter(
      (o) => o.op === "add" && o.element.type === "arrow",
    ) as any[];
    expect(arrows[0].element.end).toEqual({ id: "b2" });
    expect(arrows[1].element.end).toBeUndefined();
  });

  it("a block the answer cut off is dropped, never applied", () => {
    const r = completeOnly(
      parseReply(
        `${fence(
          "vd text",
          "whole",
        )}\n\`\`\`vd diagram\nsequenceDiagram\n  A->>`,
      ),
    );
    expect(r.blocks.map((b) => b.kind)).toEqual(["text"]);
    expect(r.skipped).toEqual(["the last part, which the answer cut off"]);
  });
});
