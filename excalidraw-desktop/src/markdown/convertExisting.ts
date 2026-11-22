/**
 * Convert text already on the canvas as if it had been typed in Markdown mode
 * (toimprove 345): text written before the mode was turned on, or pasted,
 * shows `# ` lines as headings, `> ` as quotes, `- ` as bullets, as Obsidian
 * shows any Markdown line however it got there.
 *
 * Runs when a drawing turns the mode on (`markdown.convert_on_enable`) and on
 * the "Markdown: Convert existing text" command. The line rules are the
 * typing ones: each line is replayed through `matchLineTrigger` space by
 * space, exactly what typing it would have triggered, and boxes are styled by
 * the shared blockStyle.ts. One undo step for the whole conversion. Loaded
 * only when used.
 *
 * Not touched: texts that already have a role, code texts (Cascadia font),
 * lines inside ``` fences, locked texts, deleted ones.
 */
import { FONT_FAMILY } from "@excalidraw/common";
import { newElementWith, newTextElement } from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { fontsReady, measureTextUpdate } from "../editor/links/remeasure";

import {
  MARK_FONT,
  belowAnchor,
  bodySizeOf,
  fontFor,
  scaleOf,
  withRoleAndBody,
} from "./blockStyle";
import { inlineFont, matchClosingMark } from "./inlineRules";
import { matchLineTrigger } from "./lineRules";
import {
  CODE_ROLE,
  QUOTE_ROLE,
  headingLevelOf,
  headingRole,
  roleOf,
  withRole,
} from "./roles";

import type { MarkdownTypingSettings } from "./markdownTyping";

/** One box of the result: its text and role (null = body text). */
export type PlannedBlock = {
  text: string;
  role: string | null;
  /** A body box that is entirely `**bold**` or `` `code` ``: its look. */
  inline?: "bold" | "code";
};

type LineResult =
  | { kind: "box"; role: string; text: string }
  | { kind: "body"; text: string; changed: boolean };

/** Longest line prefix a typed space can still trigger on (matchLineTrigger's own cap). */
const TRIGGER_REACH = 24;

/**
 * Replay a line as if typed: at every space within reach, ask the typing
 * rules what it would trigger. List markers replace the text before the
 * space; a heading or quote mark at the line start makes the line a box.
 */
const replayLine = (line: string, boxes: boolean): LineResult => {
  let out = "";
  let changed = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " " && out.length <= TRIGGER_REACH) {
      const t = matchLineTrigger(out);
      if (t?.kind === "list") {
        out = `${t.marker} `;
        changed = true;
        continue;
      }
      if (t && boxes) {
        // extra spaces after the mark are not part of the heading (Obsidian trims them)
        const text = line.slice(i + 1).replace(/^ +/, "");
        if (t.kind === "quote") {
          return { kind: "box", role: QUOTE_ROLE, text };
        }
        if (text !== "") {
          return { kind: "box", role: headingRole(t.level), text };
        }
      }
    }
    out += ch;
  }
  return { kind: "body", text: out, changed };
};

const isFence = (line: string) => /^ {0,3}(```|~~~)/.test(line);

const trimBlankEdges = (lines: string[]) => {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === "") {
    a++;
  }
  while (b > a && lines[b - 1].trim() === "") {
    b--;
  }
  return lines.slice(a, b);
};

/**
 * The boxes `text` becomes, or null when typing it would have changed
 * nothing. A label cannot split into boxes: it takes a heading or quote only
 * when that is all it holds, and otherwise only its list markers change.
 */
export function planConversion(
  text: string,
  opts: { isLabel: boolean; inlineStyles: boolean },
): PlannedBlock[] | null {
  const lines = text.split("\n");
  const blocks: PlannedBlock[] = [];
  let body: string[] = [];
  let bodyHasCode = false;
  let changed = false;
  let inCode = false;

  const flush = () => {
    const kept = trimBlankEdges(body);
    if (kept.length) {
      const joined = kept.join("\n");
      const m =
        opts.inlineStyles && !bodyHasCode && joined.length > 1
          ? matchClosingMark(joined.slice(0, -1), joined.slice(-1))
          : null;
      if (m) {
        changed = true;
        blocks.push({ text: m.inner, role: null, inline: m.kind });
      } else {
        blocks.push({ text: joined, role: null });
      }
    }
    body = [];
    bodyHasCode = false;
  };
  const lastIsOpenQuote = () =>
    body.length === 0 && blocks[blocks.length - 1]?.role === QUOTE_ROLE;

  for (const line of lines) {
    if (inCode || isFence(line)) {
      if (isFence(line)) {
        inCode = !inCode;
      }
      body.push(line);
      bodyHasCode = true;
      continue;
    }
    if (lastIsOpenQuote() && line === ">") {
      blocks[blocks.length - 1].text += "\n";
      continue;
    }
    const r = replayLine(line, true);
    if (r.kind === "box") {
      changed = true;
      if (r.role === QUOTE_ROLE) {
        // a quote line's own list markers convert as typed in the quote box
        const inner = replayLine(r.text, false).text;
        if (lastIsOpenQuote()) {
          blocks[blocks.length - 1].text += `\n${inner}`;
          continue;
        }
        flush();
        blocks.push({ text: inner, role: QUOTE_ROLE });
        continue;
      }
      flush();
      blocks.push({ text: r.text, role: r.role });
      continue;
    }
    changed ||= r.changed;
    body.push(r.text);
  }
  flush();

  if (!changed) {
    return null;
  }
  if (opts.isLabel && blocks.length !== 1) {
    // only the list markers: the label stays one box with its lines
    let code = false;
    const out = lines.map((line) => {
      if (code || isFence(line)) {
        code = isFence(line) ? !code : code;
        return line;
      }
      return replayLine(line, false).text;
    });
    const joined = out.join("\n");
    return joined === text ? null : [{ text: joined, role: null }];
  }
  return blocks;
}

type AnyElement = Record<string, any> & { id: string; type: string };

/** Texts this command may convert: plain (no role), not code, not locked. */
const isConvertible = (e: AnyElement) =>
  e.type === "text" &&
  !e.isDeleted &&
  !e.locked &&
  roleOf(e as never) === null &&
  e.fontFamily !== FONT_FAMILY.Cascadia;

/** The size, font and custom data a block's box takes, styled as typing it would. */
const styleOf = (
  el: ExcalidrawTextElement,
  block: PlannedBlock,
  first: boolean,
  settings: MarkdownTypingSettings,
) => {
  const bodySize = bodySizeOf(el);
  const base = first ? el.customData : undefined;
  const level = headingLevelOf(block.role);
  if (block.role) {
    return {
      fontSize: level ? bodySize * scaleOf(settings, level) : bodySize,
      fontFamily: fontFor(el.fontFamily, block.role, settings),
      customData: withRoleAndBody(base, block.role, el.strokeColor, bodySize),
    };
  }
  if (block.inline) {
    return {
      fontSize: bodySize,
      fontFamily: inlineFont(el.fontFamily, block.inline),
      customData: {
        ...(block.inline === "code"
          ? withRole(base, CODE_ROLE, el.strokeColor)
          : base),
        [MARK_FONT]: el.fontFamily,
      },
    };
  }
  return {
    fontSize: bodySize,
    fontFamily: el.fontFamily,
    customData: first ? el.customData : undefined,
  };
};

/** The elements `el` turns into: itself restyled, then a new box per block below it. */
const buildBoxes = (
  el: ExcalidrawTextElement,
  blocks: PlannedBlock[],
  settings: MarkdownTypingSettings,
  map: Map<string, AnyElement>,
): AnyElement[] => {
  const out: AnyElement[] = [];
  const measured = (e: AnyElement, text: string) => {
    map.set(e.id, e);
    const patch = measureTextUpdate(e, map, text);
    const next = patch
      ? (newElementWith(e as never, patch as never) as AnyElement)
      : e;
    map.set(next.id, next);
    return next;
  };
  let prev: ExcalidrawTextElement | null = null;
  for (const [i, block] of blocks.entries()) {
    const style = styleOf(el, block, i === 0, settings);
    if (i === 0) {
      const patched = newElementWith(
        el as never,
        {
          text: block.text,
          originalText: block.text,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          // the editor skips undefined values: "no custom data" is {}
          customData: style.customData ?? {},
        } as never,
      ) as AnyElement;
      prev = measured(patched, block.text) as never;
      out.push(prev as never);
      continue;
    }
    const from = prev!;
    const at = belowAnchor(from, bodySizeOf(el), settings);
    const made = newTextElement({
      ...at,
      text: block.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily as never,
      lineHeight: el.lineHeight,
      textAlign: el.textAlign,
      strokeColor: el.strokeColor,
      backgroundColor: el.backgroundColor,
      opacity: el.opacity,
      roughness: el.roughness,
      strokeWidth: el.strokeWidth,
      frameId: el.frameId,
      groupIds: [...el.groupIds],
      customData: style.customData,
      angle: el.angle,
    }) as unknown as AnyElement;
    let box = measured(made, block.text);
    if (el.angle) {
      // "below" in the rotated box's own frame, as typing places it
      const [cx, cy] = pointRotateRads(
        pointFrom(box.x + box.width / 2, box.y + box.height / 2),
        pointFrom(from.x + from.width / 2, from.y + from.height / 2),
        el.angle,
      );
      box = { ...box, x: cx - box.width / 2, y: cy - box.height / 2 };
      map.set(box.id, box);
    }
    prev = box as never;
    out.push(box);
  }
  return out;
};

/**
 * Convert the selected texts (or the labels of selected shapes), else every
 * text in the drawing. Returns how many texts changed.
 */
export async function convertExistingText(
  api: ExcalidrawImperativeAPI,
  settings: MarkdownTypingSettings,
): Promise<number> {
  const all = api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const selected = api.getAppState().selectedElementIds;
  const picked = all.filter(
    (e) =>
      e.type === "text" &&
      !e.isDeleted &&
      (selected[e.id] || (!!e.containerId && selected[e.containerId])),
  );
  const targets = (picked.length ? picked : all).filter(isConvertible);
  const plans = new Map<string, { source: string; blocks: PlannedBlock[] }>();
  for (const e of targets) {
    const source = e.originalText ?? e.text;
    const blocks = planConversion(source, {
      isLabel: !!e.containerId,
      inlineStyles: settings.inlineStyles,
    });
    if (blocks) {
      plans.set(e.id, { source, blocks });
    }
  }
  if (plans.size === 0) {
    return 0;
  }
  // the fonts the new boxes use, so they measure right
  await fontsReady(
    targets.flatMap((e) =>
      (plans.get(e.id)?.blocks ?? []).map(
        (b, i) =>
          newElementWith(
            e as never,
            {
              fontFamily: styleOf(e as never, b, i === 0, settings).fontFamily,
            } as never,
          ) as AnyElement,
      ),
    ),
  );
  // Re-read after the wait: anything drawn, typed or reloaded meanwhile stays.
  const current =
    api.getSceneElementsIncludingDeleted() as unknown as AnyElement[];
  const map = new Map(current.map((e) => [e.id, e]));
  let count = 0;
  const next = current.flatMap((e) => {
    const plan = plans.get(e.id);
    if (
      !plan ||
      !isConvertible(e) ||
      (e.originalText ?? e.text) !== plan.source
    ) {
      return [e];
    }
    count++;
    return buildBoxes(e as never, plan.blocks, settings, map);
  });
  if (count === 0) {
    return 0;
  }
  api.updateScene({
    elements: next as never,
    captureUpdate: "IMMEDIATELY" as never,
  });
  return count;
}
