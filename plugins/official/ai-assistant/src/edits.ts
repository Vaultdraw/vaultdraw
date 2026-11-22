/**
 * Edit proposals: the model's reply is one JSON plan; it is checked here, turned into scene ops and
 * a plain list, and nothing touches the drawing until the user keeps it.
 */
import type {
  DrawingSettings,
  NewElement,
  SceneElement,
  SceneOp,
} from "@vaultdraw/api";

type Ref = NonNullable<NewElement["start"]>;

export type EditKind = "edit" | "create";

/** One shape in the small preview: where it is and what will happen to it. */
export interface Ghost {
  state: "new" | "moved" | "changed" | "removed" | "same";
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  /** Lines and arrows: the far end, when it is not x + width, y + height. */
  x2?: number;
  y2?: number;
}

export interface Proposal {
  kind: EditKind;
  /** The model's one-line title (also names a new drawing). */
  title: string;
  /** "Adds 3 boxes, moves 1 arrow" */
  headline: string;
  /** The same in the past tense for the result card: "Added 3 boxes, moved 1 arrow". */
  done: string;
  /** One plain line per change. */
  lines: string[];
  ops: SceneOp[];
  /** Changes to the drawing's own settings (page mode, paper, page size, background), applied with the ops. */
  drawing?: DrawingSettings;
  /** Parts of the reply that were left out because they made no sense. */
  skipped: number;
  /** Existing elements the plan changes or removes. */
  touched: string[];
  ghosts: Ghost[];
  /** The drawing the plan was made for (null for a new drawing). */
  path: string | null;
}

const ADD_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
] as const;
type AddType = typeof ADD_TYPES[number];
const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "text", "image"]);

const NUM_PROPS = [
  "x",
  "y",
  "width",
  "height",
  "fontSize",
  "strokeWidth",
  "opacity",
  "angle",
] as const;
const COLOR_PROPS = ["strokeColor", "backgroundColor"] as const;
const ENUM_PROPS: Record<string, readonly string[]> = {
  strokeStyle: ["solid", "dashed", "dotted"],
  fillStyle: ["hachure", "cross-hatch", "solid", "zigzag"],
  roundness: ["sharp", "round"],
};
const COLOR = /^(#[0-9a-f]{3,8}|transparent|[a-z]{3,20})$/i;

const NAMES: Record<string, [string, string]> = {
  rectangle: ["box", "boxes"],
  ellipse: ["ellipse", "ellipses"],
  diamond: ["diamond", "diamonds"],
  text: ["text", "texts"],
  arrow: ["arrow", "arrows"],
  line: ["line", "lines"],
};
const nameOf = (type: string, n: number) =>
  (NAMES[type] ?? ["shape", "shapes"])[n === 1 ? 0 : 1];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The reply holds nothing that can be applied. Not a failure: the panel shows `message` as a
 * normal answer, followed by what the model itself said (`said`), if anything.
 */
export class NoChange extends Error {
  readonly said: string;
  constructor(kind: EditKind, said = "") {
    super(
      kind === "create"
        ? "I couldn't turn that into a new drawing."
        : "I couldn't turn that into a change to this drawing.",
    );
    this.name = "NoChange";
    this.said = said.trim().slice(0, 2000);
  }
}

const PAPER_WORDS: Record<string, string> = {
  plain: "plain paper",
  lines: "lined paper",
  grid: "grid paper",
  dots: "dotted paper",
  graph: "graph paper",
  isometric: "isometric paper",
};
const THEME_WORDS: Record<string, string> = {
  normal: "normal paper",
  oldSchool: "old school paper",
  match: "paper that follows the app theme",
};
/** What people say for the paper pattern: "ruled", "squared" … */
const PAPER_ALIASES: Record<string, string> = {
  line: "lines",
  lines: "lines",
  dots: "dots",
  lined: "lines",
  ruled: "lines",
  grid: "grid",
  squared: "grid",
  square: "grid",
  dot: "dots",
  dotted: "dots",
  none: "plain",
  blank: "plain",
  plain: "plain",
  graph: "graph",
  isometric: "isometric",
};
const COLOR_NAMES: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  cream: "#f8efd4",
  beige: "#f5f0e1",
  grey: "#e9ecef",
  gray: "#e9ecef",
  yellow: "#fff9db",
  blue: "#e7f5ff",
  green: "#ebfbee",
  pink: "#fff0f6",
  transparent: "transparent",
};
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SIZE_WORDS: Record<string, string> = {
  a3: "A3",
  a4: "A4",
  a5: "A5",
  b5: "B5",
  letter: "Letter",
  legal: "Legal",
  tablet: "tablet",
  tabletLarge: "large tablet",
  phone: "phone",
};
const SIZES = Object.keys(SIZE_WORDS);

/** The drawing settings in a model's op, with only valid fields; null when it has none. */
function pickDrawing(src: Record<string, unknown>): DrawingSettings | null {
  const out: DrawingSettings = {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (typeof src.pageMode === "boolean") {
    out.pageMode = src.pageMode;
  } else if (src.pageMode === "page" || src.pageMode === "on") {
    out.pageMode = true;
  } else if (src.pageMode === "normal" || src.pageMode === "off") {
    out.pageMode = false;
  }
  const paper = PAPER_ALIASES[text(src.paper).toLowerCase()];
  if (paper) {
    out.paper = paper as DrawingSettings["paper"];
  }
  const theme = text(src.paperTheme)
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  const themes: Record<string, DrawingSettings["paperTheme"]> = {
    normal: "normal",
    oldschool: "oldSchool",
    match: "match",
  };
  if (themes[theme]) {
    out.paperTheme = themes[theme];
  }
  const size = SIZES.find(
    (k) => k.toLowerCase() === text(src.pageSize).toLowerCase(),
  );
  if (size) {
    out.pageSize = size as DrawingSettings["pageSize"];
  }
  const orientation = text(src.orientation).toLowerCase();
  if (orientation === "portrait" || orientation === "landscape") {
    out.orientation = orientation;
  }
  const layout = text(src.layout).toLowerCase();
  if (layout === "separate" || layout === "continuous") {
    out.layout = layout;
  }
  const bg = text(src.background).toLowerCase();
  const colour = HEX.test(bg) ? bg : COLOR_NAMES[bg];
  if (colour) {
    out.background = colour;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** "Page mode on, lined paper": the settings in plain words. */
export function drawingWords(d: DrawingSettings): string {
  const parts: string[] = [];
  if (d.pageMode !== undefined) {
    parts.push(`page mode ${d.pageMode ? "on" : "off"}`);
  }
  if (d.paperTheme) {
    parts.push(THEME_WORDS[d.paperTheme]);
  }
  if (d.paper) {
    parts.push(PAPER_WORDS[d.paper]);
  }
  if (d.pageSize) {
    // plural-ok: a page size name ("A4 pages"), not a count
    parts.push(`${SIZE_WORDS[d.pageSize]} pages`);
  }
  if (d.orientation) {
    parts.push(d.orientation);
  }
  if (d.layout) {
    parts.push(
      d.layout === "continuous" ? "one continuous page" : "separate pages",
    );
  }
  if (d.background) {
    parts.push(
      d.background === "transparent"
        ? "no background colour"
        : `background ${d.background}`,
    );
  }
  return parts.join(", ");
}

/** One plain line per changed setting, for the proposal's list. */
function drawingLines(d: DrawingSettings): string[] {
  const lines: string[] = [];
  if (d.pageMode !== undefined) {
    lines.push(`Turns page mode ${d.pageMode ? "on" : "off"}`);
  }
  if (d.paperTheme) {
    lines.push(`Uses ${THEME_WORDS[d.paperTheme]}`);
  }
  if (d.paper) {
    lines.push(`Uses ${PAPER_WORDS[d.paper]}`);
  }
  if (d.pageSize) {
    lines.push(`Sets the page size to ${SIZE_WORDS[d.pageSize]}`);
  }
  if (d.orientation) {
    lines.push(`Makes the pages ${d.orientation}`);
  }
  if (d.layout) {
    lines.push(
      d.layout === "continuous"
        ? "Uses one continuous page"
        : "Uses separate pages",
    );
  }
  if (d.background) {
    lines.push(`Sets the background to ${d.background}`);
  }
  return lines;
}

/** The JSON in a reply: a fenced block, or the first `{ … }` span. */
export function jsonFrom(reply: string): unknown {
  const fence = /```(?:json)?[ \t]*\n([\s\S]*?)```/i.exec(reply);
  const candidates = [fence?.[1], reply];
  const a = reply.indexOf("{");
  const b = reply.lastIndexOf("}");
  if (a >= 0 && b > a) {
    candidates.push(reply.slice(a, b + 1));
  }
  for (const c of candidates) {
    if (!c) {
      continue;
    }
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try the next */
    }
  }
  throw new Error(
    "The reply was not a plan I can read. Try again, or ask in other words.",
  );
}

/** Picks the allowed properties out of a model's object, dropping anything else. Returns null when it holds a bad value. */
function pickProps(src: Record<string, unknown>): Partial<NewElement> | null {
  const out: Record<string, unknown> = {};
  for (const k of NUM_PROPS) {
    if (src[k] === undefined) {
      continue;
    }
    const v = src[k];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e6) {
      return null;
    }
    if ((k === "width" || k === "height") && v < 0) {
      return null;
    }
    if (k === "opacity" && (v < 0 || v > 100)) {
      return null;
    }
    out[k] = v;
  }
  for (const k of COLOR_PROPS) {
    if (src[k] === undefined) {
      continue;
    }
    if (typeof src[k] !== "string" || !COLOR.test(src[k] as string)) {
      return null;
    }
    out[k] = src[k];
  }
  for (const [k, allowed] of Object.entries(ENUM_PROPS)) {
    if (src[k] === undefined) {
      continue;
    }
    if (typeof src[k] !== "string" || !allowed.includes(src[k] as string)) {
      return null;
    }
    out[k] = src[k];
  }
  if (src.text !== undefined) {
    if (typeof src.text !== "string" || src.text.length > 2000) {
      return null;
    }
    out.text = src.text;
  }
  return out as Partial<NewElement>;
}

const label = (e: { type: string; text?: string }) => {
  const t = (e.text ?? "").replace(/\s+/g, " ").trim();
  return t
    ? `${nameOf(e.type, 1)} "${t.length > 30 ? `${t.slice(0, 29)}…` : t}"`
    : nameOf(e.type, 1);
};

const SIZE: Record<string, [number, number]> = {
  rectangle: [140, 70],
  ellipse: [140, 70],
  diamond: [140, 90],
  text: [100, 24],
  arrow: [100, 1],
  line: [100, 1],
};

/**
 * Checks the reply against the drawing and builds the proposal. Throws a plain message when
 * nothing usable is left.
 */
export function buildProposal(
  reply: string,
  kind: EditKind,
  existing: readonly SceneElement[],
  path: string | null,
  maxOps: number,
): Proposal {
  let data: unknown;
  try {
    data = jsonFrom(reply);
  } catch {
    // the model answered in words instead of a plan: show its words
    throw new NoChange(kind, reply);
  }
  const said =
    isObj(data) && typeof data.message === "string" ? data.message : "";
  const rawOps =
    isObj(data) && Array.isArray(data.ops)
      ? (data.ops as unknown[])
      : Array.isArray(data)
      ? data
      : null;
  if (!rawOps) {
    throw new NoChange(kind, said);
  }
  const title =
    isObj(data) && typeof data.title === "string"
      ? data.title.trim().slice(0, 80)
      : "";
  const byId = new Map(existing.map((e) => [e.id, e]));
  const removed = new Set<string>();
  const addRefs = new Set<string>();
  let skipped = Math.max(0, rawOps.length - maxOps);

  const adds: SceneOp[] = [];
  const arrows: SceneOp[] = [];
  const rest: SceneOp[] = [];
  const lines: string[] = [];
  const counts = {
    add: new Map<string, number>(),
    move: new Map<string, number>(),
    restyle: new Map<string, number>(),
    delete: new Map<string, number>(),
  };
  const bump = (m: Map<string, number>, t: string) =>
    m.set(t, (m.get(t) ?? 0) + 1);
  let drawing: DrawingSettings | undefined;
  const touched = new Set<string>();
  const deleted = new Set<string>();
  const ghosts: Ghost[] = [];
  const ghostById = new Map<string, Ghost>();
  const ghostByRef = new Map<string, Ghost>();
  if (kind === "edit") {
    for (const e of existing) {
      const g: Ghost = {
        state: "same",
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        text: e.text,
      };
      ghosts.push(g);
      ghostById.set(e.id, g);
    }
  }

  for (const raw of rawOps.slice(0, maxOps)) {
    if (
      isObj(raw) &&
      raw.op === "add" &&
      typeof raw.type === "string" &&
      raw.type !== "arrow" &&
      (ADD_TYPES as readonly string[]).includes(raw.type) &&
      typeof raw.ref === "string" &&
      raw.ref.length > 0 &&
      raw.ref.length <= 40 &&
      pickProps(raw) !== null &&
      (raw.type !== "text" || (typeof raw.text === "string" && raw.text !== ""))
    ) {
      addRefs.add(raw.ref);
    }
  }
  // Deletes first, so a later change to a removed shape is skipped.
  const items = rawOps.slice(0, maxOps);
  for (const raw of items) {
    if (
      isObj(raw) &&
      raw.op === "delete" &&
      kind === "edit" &&
      typeof raw.id === "string"
    ) {
      const e = byId.get(raw.id);
      if (e && !removed.has(e.id)) {
        removed.add(e.id);
      }
    }
  }

  for (const raw of items) {
    if (!isObj(raw) || typeof raw.op !== "string") {
      skipped++;
      continue;
    }
    if (raw.op === "add") {
      const type = raw.type;
      if (
        typeof type !== "string" ||
        !(ADD_TYPES as readonly string[]).includes(type)
      ) {
        skipped++;
        continue;
      }
      const props = pickProps(raw);
      if (!props) {
        skipped++;
        continue;
      }
      const [dw, dh] = SIZE[type];
      const element: NewElement = {
        ...props,
        type: type as AddType,
        x: props.x ?? 0,
        y: props.y ?? 0,
      };
      if (type !== "text") {
        element.width = props.width ?? dw;
        element.height = props.height ?? dh;
      }
      const ref =
        typeof raw.ref === "string" &&
        raw.ref.length > 0 &&
        raw.ref.length <= 40
          ? raw.ref
          : undefined;
      if (type === "text" && !element.text) {
        skipped++;
        continue;
      }
      let ok = true;
      if (type === "arrow") {
        for (const [key, to] of [
          ["from", "start"],
          ["to", "end"],
        ] as const) {
          const v = raw[key];
          if (v === undefined) {
            continue;
          }
          if (typeof v !== "string") {
            ok = false;
            break;
          }
          const target = byId.get(v);
          if (addRefs.has(v)) {
            element[to] = { ref: v };
          } else if (
            kind === "edit" &&
            target &&
            BINDABLE.has(target.type) &&
            !removed.has(target.id)
          ) {
            element[to] = { id: v };
            touched.add(target.id);
          } else {
            ok = false;
            break;
          }
        }
      }
      if (!ok) {
        skipped++;
        continue;
      }
      let ghostEnds: Pick<Ghost, "x" | "y" | "x2" | "y2"> | null = null;
      if (type === "arrow" && (element.start || element.end)) {
        delete element.width;
        delete element.height;
        const centre = (r: Ref | undefined) => {
          if (!r) {
            return null;
          }
          const g = "ref" in r ? ghostByRef.get(r.ref) : ghostById.get(r.id);
          return g ? { x: g.x + g.width / 2, y: g.y + g.height / 2 } : null;
        };
        const a = centre(element.start);
        const b = centre(element.end);
        if (a && b) {
          ghostEnds = { x: a.x, y: a.y, x2: b.x, y2: b.y };
        }
      }
      const op: SceneOp = { op: "add", element, ...(ref ? { ref } : {}) };
      (type === "arrow" ? arrows : adds).push(op);
      bump(counts.add, type);
      lines.push(`Adds ${label(element)}`);
      const ghost: Ghost = {
        state: "new",
        type,
        x: element.x ?? 0,
        y: element.y ?? 0,
        width: element.width ?? 100,
        height: element.height ?? 24,
        text: element.text,
        ...ghostEnds,
      };
      ghosts.push(ghost);
      if (ref) {
        ghostByRef.set(ref, ghost);
      }
    } else if (raw.op === "move" || raw.op === "restyle") {
      const id = raw.id;
      const e = typeof id === "string" ? byId.get(id) : undefined;
      if (kind !== "edit" || !e || removed.has(e.id)) {
        skipped++;
        continue;
      }
      const props = pickProps(raw);
      if (!props) {
        skipped++;
        continue;
      }
      let picked: Partial<NewElement> = props;
      if (raw.op === "move") {
        if (props.x === undefined && props.y === undefined) {
          skipped++;
          continue;
        }
        picked = {
          ...(props.x !== undefined ? { x: props.x } : {}),
          ...(props.y !== undefined ? { y: props.y } : {}),
        };
      } else if (Object.keys(props).length === 0) {
        skipped++;
        continue;
      }
      rest.push({ op: "update", id: e.id, props: picked });
      touched.add(e.id);
      bump(raw.op === "move" ? counts.move : counts.restyle, e.type);
      lines.push(`${raw.op === "move" ? "Moves" : "Restyles"} ${label(e)}`);
      const g = ghostById.get(e.id);
      if (g) {
        g.state = raw.op === "move" ? "moved" : "changed";
        if (picked.x !== undefined) {
          g.x = picked.x;
        }
        if (picked.y !== undefined) {
          g.y = picked.y;
        }
        if (picked.width !== undefined) {
          g.width = picked.width;
        }
        if (picked.height !== undefined) {
          g.height = picked.height;
        }
      }
    } else if (raw.op === "delete") {
      const e = typeof raw.id === "string" ? byId.get(raw.id) : undefined;
      if (kind !== "edit" || !e) {
        skipped++;
        continue;
      }
      if (deleted.has(e.id)) {
        continue;
      }
      deleted.add(e.id);
      touched.add(e.id);
      rest.push({ op: "delete", id: e.id });
      bump(counts.delete, e.type);
      lines.push(`Deletes ${label(e)}`);
      const g = ghostById.get(e.id);
      if (g) {
        g.state = "removed";
      }
    } else if (raw.op === "drawing" || raw.op === "settings") {
      const picked = kind === "edit" ? pickDrawing(raw) : null;
      if (!picked) {
        skipped++;
        continue;
      }
      drawing = { ...drawing, ...picked };
    } else {
      skipped++;
    }
  }

  const ops = [...adds, ...arrows, ...rest];
  if (ops.length === 0 && !drawing) {
    throw new NoChange(kind, said);
  }
  if (drawing) {
    lines.push(...drawingLines(drawing));
  }
  const phrase = (verb: string, m: Map<string, number>) => {
    if (m.size === 0) {
      return "";
    }
    const kinds = [...m].map(([t, n]) => `${n} ${nameOf(t, n)}`);
    return `${verb} ${kinds.join(" and ")}`;
  };
  const settingsWords = drawing ? drawingWords(drawing) : "";
  const parts = [
    phrase("adds", counts.add),
    phrase("moves", counts.move),
    phrase("restyles", counts.restyle),
    phrase("deletes", counts.delete),
    settingsWords,
  ].filter(Boolean);
  const headline = parts.join(", ").replace(/^./, (c) => c.toUpperCase());
  const past = (verb: string, m: Map<string, number>) =>
    m.size === 0
      ? ""
      : `${verb} ${[...m].map(([t, n]) => `${n} ${nameOf(t, n)}`).join(", ")}`;
  const done = [
    past("added", counts.add),
    past("moved", counts.move),
    past("restyled", counts.restyle),
    past("deleted", counts.delete),
    settingsWords,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/^./, (c) => c.toUpperCase());
  return {
    kind,
    title,
    headline,
    done,
    lines,
    ops,
    ...(drawing ? { drawing } : {}),
    skipped,
    touched: [...touched],
    ghosts,
    path,
  };
}

/** True when every existing element the plan names is still there (the drawing was not changed under it). */
export function stillValid(
  p: Proposal,
  existing: readonly SceneElement[],
  path: string | null,
): boolean {
  if (p.path !== path) {
    return false;
  }
  const ids = new Set(existing.map((e) => e.id));
  return p.touched.every((id) => ids.has(id));
}

/** A file name for a new drawing from the model's title. */
export function drawingName(title: string): string {
  const clean = Array.from(title, (c) => (c.charCodeAt(0) < 32 ? " " : c))
    .join("")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 60)
    .trim();
  return clean || "AI drawing";
}

/** The drawing as text with ids, so the model can name what to change. */
export function describeForEdit(
  elements: readonly SceneElement[],
  selection: readonly string[],
  limit: number,
): { text: string; cut: number; summary: string } {
  const sel = new Set(selection);
  const lines = elements.map((e) => {
    const t = e.text ? ` "${e.text.replace(/\s+/g, " ").trim()}"` : "";
    const r = (n: number) => Math.round(n);
    return `- id ${e.id}: ${e.type}${t} at (${r(e.x)}, ${r(e.y)}) size ${r(
      e.width,
    )}x${r(e.height)}${sel.has(e.id) ? " [selected]" : ""}`;
  });
  let text = lines.join("\n");
  let cut = 0;
  if (text.length > limit) {
    cut = text.length - limit;
    text = text.slice(0, limit);
    text = text.slice(0, text.lastIndexOf("\n") + 1 || limit);
  }
  return {
    text: text || "(the drawing is empty)",
    cut,
    summary: `${elements.length} element${elements.length === 1 ? "" : "s"}${
      sel.size ? `, ${sel.size} selected` : ""
    }`,
  };
}
