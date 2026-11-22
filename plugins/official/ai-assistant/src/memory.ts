/**
 * The conversation sent with each request: the recent turns in full (what was asked, what was
 * answered, what happened to each change), older turns as one line each, all within a size cap.
 */
import type { ChatMessage } from "./providers";

/** What history needs of a turn (session.ts's Turn has these fields). */
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  /** The user's own words (without the "+ 2 images" note). */
  ask?: string;
  error?: string;
  outcome?: string;
  summary?: string;
  applied?: boolean;
  undone?: boolean;
  /** The Mermaid or element JSON of a drawn diagram, so "make it clearer" can rewrite it. */
  source?: string;
}

/** Recent turns sent in full; older ones become one line each. */
export const RECENT_TURNS = 6;
/** The most characters the conversation takes in a request. */
export const HISTORY_CHARS = 12000;

const one = (t: string, n: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** What happened to an assistant turn's change, in one bracketed line ("" when it had none). */
export function outcomeLine(t: HistoryTurn): string {
  if (t.error) {
    return `[Failed: ${t.error}]`;
  }
  if (!t.outcome) {
    return t.summary ? `[Proposed, not decided yet: ${t.summary}]` : "";
  }
  if (t.applied) {
    return `[Applied to the drawing${
      t.undone ? ", then undone by the user" : ""
    }: ${t.outcome}]`;
  }
  return `[${t.outcome} by the user: ${t.summary ?? "the proposed change"}]`;
}

const fullText = (t: HistoryTurn, withSource: boolean) =>
  t.role === "user"
    ? t.ask ?? t.text
    : [
        t.text,
        outcomeLine(t),
        withSource && t.source ? `[What you drew]\n${t.source}` : "",
      ]
        .filter(Boolean)
        .join("\n");

const shortText = (t: HistoryTurn) =>
  t.role === "user"
    ? `- asked: ${one(t.ask ?? t.text, 140)}`
    : `- you: ${one(t.text || "(changed the drawing)", 140)}${
        outcomeLine(t) ? ` ${one(outcomeLine(t), 120)}` : ""
      }`;

/**
 * The earlier turns as chat messages, oldest first: alternating roles, starting with the user.
 * Only the last diagram's source goes along (the one a follow-up would change).
 */
export function conversation(
  turns: readonly HistoryTurn[],
  cap = HISTORY_CHARS,
  recent = RECENT_TURNS,
): ChatMessage[] {
  const usable = turns.filter((t) => t.text || t.ask || t.error || t.summary);
  let from = Math.max(0, usable.length - recent);
  // start the full part on a user turn
  while (from < usable.length && usable[from].role !== "user") {
    from++;
  }
  const lastSource = [...usable].reverse().find((t) => t.source);
  const build = (start: number) => {
    const older = usable.slice(0, start).map(shortText);
    const msgs: ChatMessage[] = [];
    for (const t of usable.slice(start)) {
      const content = fullText(t, t === lastSource);
      const prev = msgs[msgs.length - 1];
      if (prev && prev.role === t.role) {
        prev.content = `${prev.content}\n\n${content}`;
      } else {
        msgs.push({ role: t.role, content });
      }
    }
    if (older.length) {
      const head = `Earlier in this chat, summed up:\n${older.join("\n")}`;
      if (msgs[0]?.role === "user") {
        msgs[0] = { role: "user", content: `${head}\n\n${msgs[0].content}` };
      } else {
        msgs.unshift({ role: "user", content: head });
      }
    }
    return msgs;
  };
  let msgs = build(from);
  const size = (m: ChatMessage[]) =>
    m.reduce((n, x) => n + x.content.length, 0);
  while (size(msgs) > cap && from < usable.length) {
    from++;
    while (from < usable.length && usable[from].role !== "user") {
      from++;
    }
    msgs = build(from);
  }
  // still too long (very many old turns): keep the newest summary lines
  if (size(msgs) > cap && msgs.length) {
    const c = msgs[0].content;
    msgs[0] = { ...msgs[0], content: `…${c.slice(c.length - cap + 1)}` };
  }
  return msgs;
}
