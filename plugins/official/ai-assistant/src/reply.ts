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
    if (!word && looksLikeJson(body.join("\n"))) {
      // a bare ```vd fence with JSON (models do this): ops are an edit, elements a drawing
      const text = body.join("\n").trim();
      blocks.push({
        kind: /"ops"\s*:/.test(text) ? "edit" : "draw",
        attrs: parseAttrs(info),
        body: text,
      });
    } else if ((BLOCK_KINDS as readonly string[]).includes(word)) {
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
  const text = tidy(prose.join("\n"));
  const content = blocks.some((b) => CONTENT.has(b.kind));
  if (!content && !open) {
    const page = proseToBlocks(text);
    if (page) {
      // the model wrote the page as plain Markdown instead of vd blocks: use it, don't lose it
      return {
        prose: page.intro,
        blocks: [...blocks, ...page.blocks],
        skipped,
        open,
      };
    }
  }
  return { prose: text, blocks, skipped, open };
}

const CONTENT = new Set<BlockKind>([
  "heading",
  "text",
  "note",
  "diagram",
  "draw",
]);

const looksLikeJson = (text: string) => /^\s*[[{]/.test(text);

/**
 * A plain Markdown page (headings, paragraphs, bullets, ```mermaid fences) as content blocks.
 * Used only when the reply has no vd content blocks and clearly is a page: a mermaid diagram or at
 * least two headings. The text before the first heading stays in the chat.
 */
export function proseToBlocks(
  prose: string,
): { intro: string; blocks: Block[] } | null {
  const lines = prose.split("\n");
  const headings = lines.filter((l) => /^#{1,6}\s+\S/.test(l)).length;
  const mermaid = lines.some((l) => /^\s*(`{3,}|~{3,})\s*mermaid\b/i.test(l));
  if (!mermaid && headings < 2) {
    return null;
  }
  const blocks: Block[] = [];
  const intro: string[] = [];
  let para: string[] = [];
  let started = false;
  const flush = () => {
    const body = para.join("\n").trim();
    para = [];
    if (!body) {
      return;
    }
    if (started) {
      blocks.push({ kind: "text", attrs: {}, body });
    } else {
      intro.push(body);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    const fence = /^\s*(`{3,}|~{3,})\s*(\w*)/.exec(line);
    if (h) {
      flush();
      started = true;
      blocks.push({
        kind: "heading",
        attrs: { level: String(Math.min(3, h[1].length)) },
        body: h[2].replace(/\*\*/g, ""),
      });
    } else if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) {
        body.push(lines[j]);
        j++;
      }
      i = j;
      if (fence[2].toLowerCase() === "mermaid") {
        started = true;
        blocks.push({
          kind: "diagram",
          attrs: {},
          body: body.join("\n").trim(),
        });
      } else {
        para.push(body.join("\n"));
      }
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks.length ? { intro: intro.join("\n\n"), blocks } : null;
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
