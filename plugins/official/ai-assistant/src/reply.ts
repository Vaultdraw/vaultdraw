/**
 * The model's reply: Markdown for the chat, then zero or more action blocks, each a fenced block
 * whose info line starts with `vd` (```` ```vd diagram replace=selection ````). Fences need no
 * escaping, so Mermaid and JSON go in as they are, and a reply without blocks is a plain answer.
 */

export const BLOCK_KINDS = [
  "new",
  "heading",
  "text",
  "note",
  "diagram",
  "draw",
  "edit",
  "settings",
] as const;
export type BlockKind = typeof BLOCK_KINDS[number];

export interface Block {
  kind: BlockKind;
  /** `key=value` pairs from the info line (`title="…"`, `replace=selection`, `level=2`). */
  attrs: Record<string, string>;
  body: string;
}

export interface Reply {
  /** What the chat shows: the reply without its action blocks. */
  prose: string;
  blocks: Block[];
  /** Blocks that were left out (an unknown kind), in plain words. */
  skipped: string[];
  /** A block was still open at the end (the stream stopped early). */
  open: boolean;
}

const OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*vd\b[ \t]*(.*)$/;

/** `a=1 title="two words" c='x'` → { a: "1", title: "two words", c: "x" }. */
export function parseAttrs(info: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  for (let m = re.exec(info); m; m = re.exec(info)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const tidy = (text: string) =>
  text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function parseReply(answer: string): Reply {
  const lines = answer.replace(/\r\n?/g, "\n").split("\n");
  const prose: string[] = [];
  const blocks: Block[] = [];
  const skipped: string[] = [];
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) {
      prose.push(lines[i]);
      continue;
    }
    const fence = m[1];
    const close = new RegExp(
      `^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`,
    );
    const info = m[2].trim();
    const word = /^([A-Za-z-]+)/.exec(info)?.[1].toLowerCase() ?? "";
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    if (j >= lines.length) {
      open = true;
    }
    i = j;
    if ((BLOCK_KINDS as readonly string[]).includes(word)) {
      blocks.push({
        kind: word as BlockKind,
        attrs: parseAttrs(info.slice(word.length)),
        body: body.join("\n").trim(),
      });
    } else {
      skipped.push(
        word ? `an unknown "${word}" block` : "a block with no kind",
      );
    }
  }
  return { prose: tidy(prose.join("\n")), blocks, skipped, open };
}

/** A reply cut off inside a block: that half block is dropped, never applied. */
export function completeOnly(reply: Reply): Reply {
  if (!reply.open || reply.blocks.length === 0) {
    return reply;
  }
  return {
    ...reply,
    blocks: reply.blocks.slice(0, -1),
    skipped: [...reply.skipped, "the last part, which the answer cut off"],
  };
}

/** What to show while the reply streams: the prose so far, and whether blocks are being written. */
export function streamingView(answer: string): {
  prose: string;
  building: boolean;
} {
  const r = parseReply(answer);
  return { prose: r.prose, building: r.blocks.length > 0 || r.open };
}
