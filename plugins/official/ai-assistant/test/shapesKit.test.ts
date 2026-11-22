import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expandElements, resolveColor } from "../src/shapesKit";

import type { NewElement, SceneOp } from "@vaultdraw/api";

const el = (op: SceneOp) => (op as Extract<SceneOp, { op: "add" }>).element;
const byRef = (ops: SceneOp[], ref: string) =>
  ops.find((o) => o.op === "add" && o.ref === ref) as Extract<
    SceneOp,
    { op: "add" }
  >;

const TWO = [
  {
    type: "rectangle",
    id: "a",
    x: 300,
    y: 200,
    width: 200,
    height: 80,
    label: { text: "Start", fontSize: 20 },
  },
  {
    type: "rectangle",
    id: "b",
    x: 600,
    y: 200,
    width: 200,
    height: 80,
    backgroundColor: "success",
    label: { text: "End" },
  },
  {
    type: "arrow",
    id: "r",
    x: 500,
    y: 240,
    points: [
      [0, 0],
      [100, 0],
    ],
    start: "a",
    end: "b",
  },
];

describe("expandElements", () => {
  it("puts the label on the container as its text, with the font", () => {
    const { ops, problems } = expandElements(TWO);
    expect(problems).toEqual([]);
    const a = el(byRef(ops, "a"));
    expect(a.text).toBe("Start");
    expect(a.fontSize).toBe(20);
    expect(el(byRef(ops, "b")).fontSize).toBe(18);
    expect(ops.filter((o) => el(o).type === "text")).toHaveLength(0);
  });

  it("binds arrows to both ends by ref", () => {
    const { ops } = expandElements(TWO);
    const r = el(byRef(ops, "r"));
    expect(r.start).toEqual({ ref: "a" });
    expect(r.end).toEqual({ ref: "b" });
  });

  it("binds to a shape that comes later, and to existing canvas ids", () => {
    const { ops, problems } = expandElements(
      [
        { type: "arrow", id: "r", start: "a", end: "canvas-1" },
        { type: "rectangle", id: "a", x: 0, y: 0 },
      ],
      { existingIds: new Set(["canvas-1"]) },
    );
    expect(problems).toEqual([]);
    expect(el(byRef(ops, "r")).start).toEqual({ ref: "a" });
    expect(el(byRef(ops, "r")).end).toEqual({ id: "canvas-1" });
  });

  it("accepts startBinding/endBinding", () => {
    const { ops } = expandElements([
      { type: "rectangle", id: "a", x: 0, y: 0 },
      { type: "rectangle", id: "b", x: 300, y: 0 },
      {
        type: "arrow",
        id: "r",
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
      },
    ]);
    expect(el(byRef(ops, "r")).end).toEqual({ ref: "b" });
  });

  it("reports an arrow end that points nowhere", () => {
    const { ops, problems } = expandElements([
      { type: "rectangle", id: "a", x: 0, y: 0 },
      { type: "arrow", id: "r", start: "a", end: "ghost" },
    ]);
    expect(el(byRef(ops, "r")).end).toBeUndefined();
    expect(problems.join()).toContain('"ghost"');
  });

  it("enforces minimum sizes and fonts", () => {
    const { ops, problems } = expandElements([
      { type: "rectangle", id: "a", x: 0, y: 0, width: 40, height: 20 },
      {
        type: "ellipse",
        id: "b",
        x: 0,
        y: 100,
        label: { text: "Tiny", fontSize: 10 },
      },
      { type: "text", id: "t", x: 0, y: 300, text: "Note", fontSize: 12 },
    ]);
    expect(el(byRef(ops, "a")).width).toBeGreaterThanOrEqual(120);
    expect(el(byRef(ops, "a")).height).toBeGreaterThanOrEqual(60);
    expect(el(byRef(ops, "b")).fontSize).toBe(16);
    expect(el(byRef(ops, "t")).fontSize).toBe(16);
    expect(problems.filter((p) => p.includes("too small"))).toHaveLength(2);
  });

  it("grows a shape to fit its label and wraps long text", () => {
    const { ops } = expandElements([
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        label: { text: "Authentication service" },
      },
      {
        type: "rectangle",
        id: "b",
        x: 0,
        y: 0,
        label: {
          text: "A very long label that cannot possibly fit on one single line of a box",
        },
      },
    ]);
    expect(el(byRef(ops, "a")).width).toBeGreaterThanOrEqual(160);
    const b = el(byRef(ops, "b"));
    expect(b.width).toBeLessThanOrEqual(320);
    expect(b.text).toContain("\n");
    expect(b.height).toBeGreaterThan(60);
  });

  it("maps palette names and keeps hex", () => {
    expect(resolveColor("input", "fill")).toBe("#a5d8ff");
    expect(resolveColor("Light Green", "fill")).toBe("#b2f2bb");
    expect(resolveColor("blue", "stroke")).toBe("#4a9eed");
    expect(resolveColor("blue", "fill")).toBe("#a5d8ff");
    expect(resolveColor("#ABCDEF", "fill")).toBe("#abcdef");
    expect(resolveColor("nonsense", "fill")).toBeUndefined();
    const { ops, problems } = expandElements([
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        backgroundColor: "warning",
        strokeColor: "red",
      },
      {
        type: "rectangle",
        id: "b",
        x: 0,
        y: 0,
        backgroundColor: "fuchsia-ish",
      },
    ]);
    expect(el(byRef(ops, "a")).backgroundColor).toBe("#ffd8a8");
    expect(el(byRef(ops, "a")).strokeColor).toBe("#ef4444");
    expect(el(byRef(ops, "a")).fillStyle).toBe("solid");
    expect(el(byRef(ops, "b")).backgroundColor).toBeUndefined();
    expect(problems.join()).toContain("fuchsia-ish");
  });

  it("omits defaults", () => {
    const { ops } = expandElements([
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        strokeWidth: 2,
        opacity: 100,
        roughness: 1,
      },
    ]);
    const e = el(ops[0]) as unknown as Record<string, unknown>;
    for (const k of [
      "strokeColor",
      "backgroundColor",
      "fillStyle",
      "strokeWidth",
      "opacity",
      "roughness",
      "fontFamily",
    ]) {
      expect(e[k]).toBeUndefined();
    }
  });

  it("turns a zone's label into a title text at its top", () => {
    const { ops } = expandElements([
      {
        type: "rectangle",
        id: "z",
        x: 0,
        y: 0,
        width: 600,
        height: 300,
        backgroundColor: "zone-blue",
        opacity: 30,
        label: { text: "Frontend" },
      },
    ]);
    expect(ops).toHaveLength(2);
    expect(el(ops[0]).text).toBeUndefined();
    const t = el(ops[1]);
    expect(t.type).toBe("text");
    expect(t.text).toBe("Frontend");
    expect(t.fontSize).toBeGreaterThanOrEqual(20);
    expect(t.x).toBeGreaterThan(0);
  });

  it("never throws on partial or malformed input", () => {
    for (const bad of [
      null,
      undefined,
      5,
      "{nope",
      {},
      [
        null,
        3,
        "x",
        [],
        { type: 4 },
        { type: "blob" },
        { type: "text" },
        { type: "arrow", points: "x", start: 7 },
        { type: "rectangle", x: "a", width: NaN },
      ],
    ]) {
      const r = expandElements(bad);
      expect(Array.isArray(r.ops)).toBe(true);
      expect(Array.isArray(r.problems)).toBe(true);
    }
    const r = expandElements([
      { type: "blob", id: "q" },
      { type: "text", id: "t" },
      { type: "rectangle" },
    ]);
    expect(r.ops).toHaveLength(1);
    expect(r.problems.some((p) => p.includes("blob"))).toBe(true);
    expect(r.problems.some((p) => p.includes("without text"))).toBe(true);
  });

  it("reads a JSON string and an {elements} wrapper", () => {
    expect(expandElements(JSON.stringify(TWO)).ops).toHaveLength(3);
    expect(expandElements({ elements: TWO }).ops).toHaveLength(3);
  });

  it("makes ids unique and generates missing ones", () => {
    const { ops, problems } = expandElements([
      { type: "rectangle", id: "a", x: 0, y: 0 },
      { type: "rectangle", id: "a", x: 200, y: 0 },
      { type: "rectangle", x: 400, y: 0 },
      { type: "rectangle", id: "e1", x: 600, y: 0 },
    ]);
    const refs = ops.map((o) => (o as { ref?: string }).ref);
    expect(new Set(refs).size).toBe(4);
    expect(refs.every(Boolean)).toBe(true);
    expect(problems.some((p) => p.includes("twice"))).toBe(true);
  });

  it("puts the group's top-left at 0,0 and reports its size", () => {
    const r = expandElements(TWO);
    const xs = r.ops.map((o) => el(o).x as number);
    const ys = r.ops.map((o) => el(o).y as number);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(r.width).toBeGreaterThanOrEqual(500);
    expect(r.height).toBeGreaterThanOrEqual(80);
    // arrow keeps its distance to the shapes
    expect(el(byRef(r.ops, "r")).x).toBe(200);
  });

  it("offsets by an origin", () => {
    const a = expandElements(TWO);
    const b = expandElements(TWO, { origin: { x: 1000, y: -50 } });
    a.ops.forEach((o, i) => {
      expect(el(b.ops[i]).x).toBe((el(o).x as number) + 1000);
      expect(el(b.ops[i]).y).toBe((el(o).y as number) - 50);
    });
    expect(b.width).toBe(a.width);
  });

  it("returns cameraUpdate and delete separately and drops emoji", () => {
    const r = expandElements([
      { type: "cameraUpdate", x: 0, y: 0, width: 800, height: 600 },
      { type: "rectangle", id: "a", x: 0, y: 0, label: { text: "Ship 🚀" } },
      { type: "delete", ids: "x1, x2" },
    ]);
    expect(r.camera).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(r.deletes).toEqual(["x1", "x2"]);
    expect(r.ops).toHaveLength(1);
    expect(el(r.ops[0]).text).toBe("Ship");
    expect(r.problems.join()).toContain("emoji");
  });

  it("caps the element count", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: "rectangle",
      id: `r${i}`,
      x: i * 200,
      y: 0,
    }));
    const r = expandElements(many, { maxElements: 4 });
    expect(r.ops).toHaveLength(4);
    expect(r.problems.some((p) => p.includes("dropped"))).toBe(true);
  });
});

describe("drawing handbook", () => {
  const file = readFileSync(
    path.join(__dirname, "../src/handbook/drawing.md"),
    "utf8",
  );
  const tokens = (s: string) => Math.ceil(s.length / 4);

  it("starts with front matter holding a valid regex", () => {
    const m = /^---\nwhen: (.+)\n---\n/.exec(file);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1], "i");
    expect(re.test("draw me a diagram")).toBe(true);
    expect(re.test("explain how it works")).toBe(true);
    expect(re.test("rename this note")).toBe(false);
  });

  it("is within the token budgets and credits its source", () => {
    expect(tokens(file)).toBeLessThanOrEqual(900);
    const core = /<!-- drawing-core -->([\s\S]*?)<!-- \/drawing-core -->/.exec(
      file,
    );
    expect(core).not.toBeNull();
    expect(tokens(core![1])).toBeLessThanOrEqual(200);
    expect(file).toContain(
      "Based on the excalidraw-mcp cheat sheet (MIT, Excalidraw)",
    );
  });

  it("its example expands without problems", () => {
    const ex = /## Example\n([\s\S]*)$/.exec(file)![1];
    const r = expandElements(ex);
    expect(r.problems).toEqual([]);
    expect(r.ops.length).toBe(5);
    const a = el(
      r.ops.find((o) => (o as { ref?: string }).ref === "a1")!,
    ) as NewElement;
    expect(a.start).toEqual({ ref: "a" });
  });
});
