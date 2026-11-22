/**
 * The assistant's handbook: a short core that is always sent, and named sections that are added
 * only when the request needs them (a `when:` pattern at the top of each file). The text lives in
 * `handbook/*.md`; value lists come from the code that checks them, so the help cannot drift.
 */
import brainstorm from "./handbook/brainstorm.md?raw";
import compare from "./handbook/compare.md?raw";
import core from "./handbook/core.md?raw";
import drawing from "./handbook/drawing.md?raw";
import edit from "./handbook/edit.md?raw";
import improve from "./handbook/improve.md?raw";
import markdown from "./handbook/markdown.md?raw";
import notes from "./handbook/notes.md?raw";
import sequence from "./handbook/sequence.md?raw";
import settings from "./handbook/settings.md?raw";
import teach from "./handbook/teach.md?raw";
import { SETTING_VALUES } from "./edits";

import type { AccessMode } from "./access";

export interface Section {
  name: string;
  when: RegExp;
  body: string;
}

/** Splits `---\nwhen: <pattern>\n---\n<body>` into a section. */
export function parseSection(name: string, raw: string): Section {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw.trim());
  const head = m?.[1] ?? "";
  const when = /^when:\s*(.+)$/m.exec(head)?.[1].trim();
  return {
    name,
    when: when ? new RegExp(when, "i") : /$^/,
    body: (m ? m[2] : raw).trim(),
  };
}

const fill = (text: string) =>
  text.replace(/\{\{(\w+)\}\}/g, (all, key: string) => {
    const list = (SETTING_VALUES as Record<string, readonly string[]>)[key];
    return list ? list.join(", ") : all;
  });

export const CORE = core.trim();

export const SECTIONS: readonly Section[] = Object.entries({
  teach,
  improve,
  drawing,
  notes,
  brainstorm,
  compare,
  sequence,
  edit,
  settings,
  markdown,
}).map(([name, raw]) => {
  const s = parseSection(name, raw);
  return { ...s, body: fill(s.body) };
});

/** A rough token count (four characters a token), for the budget checks. */
export const tokens = (text: string) => Math.ceil(text.length / 4);

export interface PromptNeeds {
  /** The newest request. */
  request: string;
  /** The previous request of the conversation: a vague follow-up keeps its recipe. */
  previous?: string;
  /** The selection holds a diagram (shapes and arrows): the improve recipe comes along. */
  selectionIsDiagram?: boolean;
}

/** The sections a request needs, in handbook order. */
export function pickSections(needs: PromptNeeds): Section[] {
  const said = [needs.request, needs.previous ?? ""];
  return SECTIONS.filter(
    (s) =>
      said.some((t) => s.when.test(t)) ||
      (s.name === "improve" && needs.selectionIsDiagram),
  );
}

/** The instructions sent with a request: the core, the sections it needs, the permission. */
export function systemPrompt(needs: PromptNeeds, access: AccessMode): string {
  const parts = [CORE, ...pickSections(needs).map((s) => s.body)];
  parts.push(
    access === "read"
      ? "## Permission now\nRead only: answer in words and never add action blocks."
      : access === "auto"
      ? "## Permission now\nApply at once: your blocks are applied as soon as you answer (the user can undo)."
      : "## Permission now\nAsk first: your blocks are shown to the user, who keeps or discards them.",
  );
  return parts.join("\n\n");
}
