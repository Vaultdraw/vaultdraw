/**
 * Turns the action blocks of a reply into ONE proposal: element edits and settings checked by
 * edits.ts, content (headings, text, notes, element drawings, Mermaid diagrams) laid out by
 * layout.ts, replaced elements deleted, all applied together as one undo step on Keep.
 */
import { buildProposal, NoChange, type Ghost, type Proposal } from "./edits";
import { expandElements } from "./shapesKit";
import {
  anchorFor,
  bounds,
  FONT,
  rectsOf,
  stack,
  stackSize,
  type Item,
} from "./layout";

import type { Block, Reply } from "./reply";
import type {
  MermaidDrawing,
  NewElement,
  SceneElement,
  SceneOp,
} from "@vaultdraw/api";

export interface ActionEnv {
  elements: readonly SceneElement[];
  selection: readonly string[];
  /** The open drawing, or null when none is open (the content becomes a new drawing). */
  path: string | null;
  viewCenter: { x: number; y: number };
  /** The most element edits taken from `vd edit` blocks. */
  maxOps: number;
  convertMermaid(text: string): Promise<MermaidDrawing>;
}

/** The most ops one change may hold: the host's default `plugins.scene_max_ops` (500). */
export const MAX_REPLY_OPS = 500;

const REF_OK = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Gives a drawing's refs their own prefix (two drawings in one reply both have an "A" or "e1",
 * and the host refuses a ref used twice) and only the characters the host accepts in a ref.
 */
export function prefixRefs(ops: readonly SceneOp[], prefix: string): SceneOp[] {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const name = (ref: string) => {
    let out = map.get(ref);
    if (!out) {
      const clean = `${prefix}${ref.replace(/[^A-Za-z0-9_.:-]/g, "-")}`.slice(
        0,
        60,
      );
      out = clean;
      for (let n = 2; used.has(out) || !REF_OK.test(out); n++) {
        out = `${clean.slice(0, 56)}-${n}`;
      }
      used.add(out);
      map.set(ref, out);
    }
    return out;
  };
  const end = (e: NewElement["start"]) =>
    e && "ref" in e ? { ref: name(e.ref) } : e;
  return ops.map((op) => {
    if (op.op !== "add") {
      return op;
    }
    const element = { ...op.element };
    if (element.start) {
      element.start = end(element.start);
    }
    if (element.end) {
      element.end = end(element.end);
    }
    return { ...op, element, ...(op.ref ? { ref: name(op.ref) } : {}) };
  });
}

const HEADING_SIZE: Record<string, number> = {
  "1": FONT.h1,
  "2": FONT.h2,
  "3": FONT.h3,
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The ids a `replace=` names: the selection, everything, or a list of ids that exist. */
export function replacedIds(
  value: string | undefined,
  env: Pick<ActionEnv, "elements" | "selection">,
): string[] {
  if (!value) {
    return [];
  }
  const v = value.trim().toLowerCase();
  const all = env.elements.map((e) => e.id);
  if (v === "all" || v === "everything" || v === "drawing") {
    return all;
  }
  if (v === "selection" || v === "selected") {
    return env.selection.filter((id) => all.includes(id));
  }
  const ids = new Set(all);
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => ids.has(s));
}

/** The proposal for a reply's blocks, or null when it has none that do anything. */
export async function buildActions(
  reply: Reply,
  env: ActionEnv,
): Promise<Proposal | null> {
  const blocks = reply.blocks;
  if (blocks.length === 0) {
    return null;
  }
  const problems = [...reply.skipped];
  const wantsNew = blocks.some((b) => b.kind === "new");
  // an open drawing that is still empty is filled, not left for a new one (the user is on it)
  const kind: Proposal["kind"] =
    env.path === null || (wantsNew && env.elements.length > 0)
      ? "create"
      : "edit";
  const existing = kind === "edit" ? env.elements : [];

  // 1. Element edits and drawing settings, through the checks edits.ts already has.
  const editOps: unknown[] = [];
  for (const b of blocks) {
    if (b.kind === "edit" || b.kind === "settings") {
      if (kind === "create") {
        problems.push(
          b.kind === "edit"
            ? "changes to existing shapes (there is no drawing to change)"
            : "drawing settings (set them in the new drawing)",
        );
        continue;
      }
      try {
        const data = JSON.parse(b.body) as unknown;
        if (b.kind === "settings") {
          editOps.push({ ...(data as object), op: "drawing" });
        } else {
          const ops = Array.isArray(data)
            ? data
            : (data as { ops?: unknown[] })?.ops;
          editOps.push(...(Array.isArray(ops) ? ops : []));
        }
      } catch {
        problems.push(`a "${b.kind}" block that was not readable JSON`);
      }
    }
  }
  let base: Proposal | null = null;
  if (editOps.length) {
    try {
      base = buildProposal(
        JSON.stringify({ ops: editOps }),
        "edit",
        existing,
        env.path,
        env.maxOps,
      );
    } catch (err) {
      if (!(err instanceof NoChange)) {
        problems.push((err as Error).message);
      }
    }
  }

  // 2. Replaced elements.
  const replaced = new Set<string>();
  for (const b of blocks) {
    if (b.kind === "diagram" || b.kind === "draw") {
      for (const id of replacedIds(b.attrs.replace, {
        ...env,
        elements: existing,
      })) {
        replaced.add(id);
      }
    }
  }

  // 3. Content, in the order the model wrote it.
  const items: Item[] = [];
  const lines: string[] = [];
  const counts = { heading: 0, text: 0, note: 0, diagram: 0 };
  let shapes = 0;
  let title = blocks.find((b) => b.kind === "new")?.attrs.title ?? "";
  const titled = async (
    b: Block,
    drawn: { ops: SceneOp[]; width: number; height: number },
  ) => {
    if (b.attrs.title) {
      items.push({ kind: "text", text: b.attrs.title, fontSize: FONT.h3 });
    }
    items.push({
      kind: "diagram",
      ...drawn,
      ops: prefixRefs(drawn.ops, `d${counts.diagram + 1}-`),
    });
    if (b.attrs.caption) {
      items.push({ kind: "text", text: b.attrs.caption, fontSize: FONT.min });
    }
    counts.diagram++;
    shapes += drawn.ops.length;
    lines.push(
      `Adds a drawing${b.attrs.title ? ` "${b.attrs.title}"` : ""} (${plural(
        drawn.ops.length,
        "element",
        "elements",
      )})`,
    );
  };
  for (const b of blocks) {
    if (b.kind === "heading" && b.body) {
      const level = HEADING_SIZE[b.attrs.level ?? "1"]
        ? b.attrs.level ?? "1"
        : "2";
      items.push({
        kind: "text",
        text: b.body.replace(/^#+\s*/, ""),
        fontSize: HEADING_SIZE[level],
      });
      counts.heading++;
      title ||= b.body.replace(/^#+\s*/, "").split("\n")[0];
      lines.push(`Adds heading "${b.body.slice(0, 40)}"`);
    } else if (b.kind === "text" && b.body) {
      items.push({ kind: "text", text: b.body, fontSize: FONT.text });
      counts.text++;
      lines.push(`Adds text "${b.body.replace(/\s+/g, " ").slice(0, 40)}"`);
    } else if (b.kind === "note" && b.body) {
      items.push({
        kind: "text",
        text: b.body,
        fontSize: FONT.note,
        boxed: true,
      });
      counts.note++;
      lines.push(`Adds note "${b.body.replace(/\s+/g, " ").slice(0, 40)}"`);
    } else if (b.kind === "draw") {
      const r = expandElements(b.body, {
        existingIds: new Set(existing.map((e) => e.id)),
      });
      for (const id of r.deletes) {
        if (existing.some((e) => e.id === id)) {
          replaced.add(id);
        }
      }
      problems.push(...r.problems);
      if (r.ops.length) {
        await titled(b, r);
      }
    } else if (b.kind === "diagram") {
      const text = b.body.replace(/^```\w*\n?|```$/g, "").trim();
      try {
        const d = await env.convertMermaid(text);
        if (d.ops.length) {
          await titled(b, d);
        } else {
          problems.push("a diagram of a type that cannot be drawn");
        }
      } catch (err) {
        problems.push(
          `a diagram that could not be drawn (${(err as Error).message})`,
        );
      }
    }
  }

  // 4. Place the column: where the replaced elements were, else below everything.
  const deletedByEdit = new Set(
    (base?.ops ?? []).flatMap((o) => (o.op === "delete" ? [o.id] : [])),
  );
  const remaining = existing.filter(
    (e) => !replaced.has(e.id) && !deletedByEdit.has(e.id),
  );
  const replacedRect = bounds(
    rectsOf(existing.filter((e) => replaced.has(e.id))),
  );
  const size = stackSize(items);
  const at =
    kind === "create"
      ? { x: 0, y: 0 }
      : anchorFor(size, rectsOf(remaining), replacedRect, env.viewCenter);
  const placed = stack(items, at);
  const gone = new Set([...replaced, ...deletedByEdit]);
  // an arrow may not bind to an element this same change deletes
  let contentOps: SceneOp[] = placed.ops.map((op) => {
    if (op.op !== "add") {
      return op;
    }
    const el = { ...op.element };
    for (const k of ["start", "end"] as const) {
      const v = el[k];
      if (v && "id" in v && gone.has(v.id)) {
        delete el[k];
      }
    }
    return { ...op, element: el };
  });
  const deletes: SceneOp[] = [...replaced]
    .filter((id) => !deletedByEdit.has(id))
    .map((id) => ({ op: "delete", id }));
  // the whole change must fit one batch: edits and deletes first, content takes what is left
  const room = Math.max(
    0,
    MAX_REPLY_OPS - (base?.ops.length ?? 0) - deletes.length,
  );
  if (contentOps.length > room) {
    problems.push(
      `${contentOps.length - room} new elements past the limit of one change`,
    );
    contentOps = contentOps.slice(0, room);
  }

  const ops: SceneOp[] = [...(base?.ops ?? []), ...deletes, ...contentOps];
  if (ops.length === 0 && !base?.drawing) {
    return null;
  }

  // 5. The preview and the words for it.
  const ghosts: Ghost[] = base
    ? base.ghosts.map((g) => ({ ...g }))
    : existing.map((e) => ({
        state: "same" as const,
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        text: e.text,
      }));
  existing.forEach((e, i) => {
    if (replaced.has(e.id) && ghosts[i]) {
      ghosts[i].state = "removed";
    }
  });
  for (const op of contentOps) {
    if (op.op === "add") {
      const el = op.element;
      ghosts.push({
        state: "new",
        type: el.type,
        x: el.x ?? 0,
        y: el.y ?? 0,
        width: el.width ?? (el.points ? Math.abs(el.points.at(-1)![0]) : 100),
        height: el.height ?? (el.points ? Math.abs(el.points.at(-1)![1]) : 24),
        text: el.text,
      });
    }
  }
  if (replaced.size) {
    lines.unshift(`Replaces ${plural(replaced.size, "element", "elements")}`);
  }
  const parts = [
    counts.heading ? plural(counts.heading, "heading", "headings") : "",
    counts.text ? plural(counts.text, "text", "texts") : "",
    counts.note ? plural(counts.note, "note", "notes") : "",
    counts.diagram ? plural(counts.diagram, "drawing", "drawings") : "",
  ].filter(Boolean);
  const join = (verb: string) =>
    parts.length ? `${verb} ${parts.join(", ")}` : "";
  const repl = (verb: string) =>
    replaced.size
      ? `${verb} ${plural(replaced.size, "element", "elements")}`
      : "";
  const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
  const headline = cap(
    [
      repl("replaces"),
      join("adds"),
      base?.headline?.replace(/^./, (c) => c.toLowerCase()) ?? "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  const done = cap(
    [
      repl("replaced"),
      join("added"),
      base?.done?.replace(/^./, (c) => c.toLowerCase()) ?? "",
    ]
      .filter(Boolean)
      .join(", "),
  );
  void shapes;
  return {
    kind,
    title: title.slice(0, 80),
    headline,
    done,
    lines: [...lines, ...(base?.lines ?? [])],
    ops,
    ...(base?.drawing ? { drawing: base.drawing } : {}),
    skipped: (base?.skipped ?? 0) + problems.length,
    problems,
    touched: [...new Set([...(base?.touched ?? []), ...replaced])],
    ghosts,
    path: kind === "edit" ? env.path : null,
  };
}
