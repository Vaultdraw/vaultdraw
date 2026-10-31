import { describe, expect, it } from "vitest";

import {
  buildProposal,
  describeForEdit,
  drawingName,
  jsonFrom,
  stillValid,
} from "../src/edits";

import type { SceneElement } from "@vaultdraw/api";

const el = (
  id: string,
  type: SceneElement["type"],
  x = 0,
  y = 0,
  text?: string,
): SceneElement => ({
  id,
  type,
  x,
  y,
  width: 100,
  height: 50,
  angle: 0,
  ...(text ? { text } : {}),
});
const WORLD = [
  el("a", "rectangle"),
  el("b", "arrow", 10, 90),
  el("t", "text", 0, 200, "Login"),
];
const plan = (ops: unknown[], extra: object = {}) =>
  `\`\`\`json\n${JSON.stringify({ title: "T", ops, ...extra })}\n\`\`\``;
const build = (ops: unknown[], kind: "edit" | "create" = "edit", max = 60) =>
  buildProposal(
    plan(ops),
    kind,
    kind === "edit" ? WORLD : [],
    kind === "edit" ? "d.excalidraw" : null,
    max,
  );

describe("jsonFrom", () => {
  it("reads a fenced block, bare JSON, and JSON inside prose", () => {
    expect(jsonFrom('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(jsonFrom('{"a":2}')).toEqual({ a: 2 });
    expect(jsonFrom('Sure! Here you go: {"a":3} Enjoy.')).toEqual({ a: 3 });
  });
  it("says so in plain words when there is no JSON", () => {
    expect(() => jsonFrom("I cannot do that")).toThrow(/not a plan I can read/);
  });
});

describe("buildProposal", () => {
  it("lists what it does in plain words", () => {
    const p = build([
      { op: "add", type: "rectangle", text: "A", ref: "x" },
      { op: "add", type: "rectangle", text: "B", ref: "y" },
      { op: "add", type: "rectangle", text: "C", ref: "z" },
      { op: "move", id: "b", x: 5, y: 6 },
    ]);
    expect(p.headline).toBe("Adds 3 boxes, moves 1 arrow");
    expect(p.lines).toEqual([
      'Adds box "A"',
      'Adds box "B"',
      'Adds box "C"',
      "Moves arrow",
    ]);
    expect(p.touched).toEqual(["b"]);
    expect(p.ops).toHaveLength(4);
  });

  it("puts arrows after the shapes they join and binds refs and existing ids", () => {
    const p = build([
      { op: "add", type: "arrow", from: "x", to: "a" },
      { op: "add", type: "rectangle", ref: "x" },
    ]);
    expect(p.ops[0]).toMatchObject({
      op: "add",
      element: { type: "rectangle" },
      ref: "x",
    });
    expect(p.ops[1]).toMatchObject({
      op: "add",
      element: { type: "arrow", start: { ref: "x" }, end: { id: "a" } },
    });
  });

  it.each([
    ["an unknown id", { op: "move", id: "nope", x: 1 }],
    [
      "a bad colour",
      { op: "restyle", id: "a", strokeColor: "url(javascript:1)" },
    ],
    ["a bad number", { op: "move", id: "a", x: "far" }],
    ["an unknown shape", { op: "add", type: "freedraw" }],
    ["an unknown action", { op: "explode", id: "a" }],
    ["a text with no words", { op: "add", type: "text" }],
    ["an arrow to nothing", { op: "add", type: "arrow", from: "ghost" }],
    ["an empty restyle", { op: "restyle", id: "a" }],
    ["not an object", 7],
  ])("skips %s and counts it", (_n, bad) => {
    const p = build([{ op: "add", type: "ellipse" }, bad]);
    expect(p.skipped).toBe(1);
    expect(p.ops).toHaveLength(1);
  });

  it("drops unknown properties instead of passing them on", () => {
    const p = build([
      {
        op: "add",
        type: "rectangle",
        link: ["java", "script:alert(1)"].join(""),
        locked: true,
        x: 3,
        seed: 9,
      },
    ]);
    expect(JSON.stringify(p.ops)).not.toMatch(/javascript|locked|seed/);
  });

  it("ignores a change to a shape the same plan deletes", () => {
    const p = build([
      { op: "restyle", id: "a", strokeColor: "#f00" },
      { op: "delete", id: "a" },
    ]);
    expect(p.ops).toEqual([{ op: "delete", id: "a" }]);
    expect(p.skipped).toBe(1);
    expect(p.headline).toBe("Deletes 1 box");
  });

  it("move keeps only x and y; a new drawing cannot move or delete", () => {
    expect(
      build([{ op: "move", id: "a", x: 1, y: 2, strokeColor: "#f00" }]).ops,
    ).toEqual([{ op: "update", id: "a", props: { x: 1, y: 2 } }]);
    expect(() => build([{ op: "delete", id: "a" }], "create")).toThrow(
      /nothing I can draw/,
    );
  });

  it("marks each shape in the preview", () => {
    const p = build([
      { op: "delete", id: "t" },
      { op: "move", id: "a", x: 50 },
      { op: "add", type: "ellipse" },
    ]);
    expect(p.ghosts.map((g) => g.state).sort()).toEqual(
      ["moved", "new", "removed", "same"].sort(),
    );
  });

  it("keeps at most the allowed number of changes", () => {
    const ops = Array.from({ length: 10 }, () => ({
      op: "add",
      type: "rectangle",
    }));
    const p = build(ops, "edit", 4);
    expect(p.ops).toHaveLength(4);
    expect(p.skipped).toBe(6);
  });

  it("refuses a reply with nothing usable, in plain words", () => {
    expect(() => build([])).toThrow(/no change I can make/);
    expect(() => buildProposal('{"x":1}', "edit", WORLD, "d", 5)).toThrow(
      /no list of changes/,
    );
  });
});

describe("stillValid", () => {
  it("fails when the drawing switched or a touched shape is gone", () => {
    const p = build([{ op: "move", id: "a", x: 1 }]);
    expect(stillValid(p, WORLD, "d.excalidraw")).toBe(true);
    expect(stillValid(p, WORLD, "other.excalidraw")).toBe(false);
    expect(
      stillValid(
        p,
        WORLD.filter((e) => e.id !== "a"),
        "d.excalidraw",
      ),
    ).toBe(false);
  });
});

describe("names and context", () => {
  it("makes a safe file name from a title", () => {
    expect(drawingName("Login / flow: v2?")).toBe("Login flow v2");
    expect(drawingName("  ..  ")).toBe("AI drawing");
    expect(drawingName("x".repeat(200)).length).toBe(60);
  });
  it("gives the model ids and marks the selection", () => {
    const d = describeForEdit(WORLD, ["a"], 10000);
    expect(d.text).toContain("id a: rectangle");
    expect(d.text).toContain("[selected]");
    expect(describeForEdit([], [], 100).text).toBe("(the drawing is empty)");
  });
});
