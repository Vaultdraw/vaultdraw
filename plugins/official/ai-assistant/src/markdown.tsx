/**
 * A small Markdown renderer for the answers: paragraphs, headings, lists, quotes, fenced code,
 * `code`, **bold**, *italic* and links. It builds React elements (never HTML text), so nothing the
 * model writes can run; a link is shown as text with its address in the tooltip and is not
 * clickable, so an answer cannot move the app to another page.
 */
import { Fragment, type ReactNode } from "react";

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\([^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) {
      out.push(text.slice(last, at));
    }
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith("`")) {
      out.push(<code key={k}>{t.slice(1, -1)}</code>);
    } else if (t.startsWith("**")) {
      out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    } else if (t.startsWith("[")) {
      const close = t.indexOf("](");
      out.push(
        <span key={k} className="vd-ai-link" title={t.slice(close + 2, -1)}>
          {t.slice(1, close)}
        </span>,
      );
    } else {
      out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    }
    last = at + t.length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i++]);
      }
      i++;
      blocks.push(
        <pre
          key={k++}
          className="vd-ai-code"
          data-lang={fence[1].trim() || undefined}
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      blocks.push(
        <p key={k++} className="vd-ai-h">
          {inline(head[2], `h${k}`)}
        </p>,
      );
      i++;
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = NUMBER.test(line);
      const re = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(re.exec(lines[i++])![1]);
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `l${k}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      }
      blocks.push(
        <blockquote key={k++}>{inline(quote.join(" "), `q${k}`)}</blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBER.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={k++}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(l, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="vd-ai-md">{blocks}</div>;
}
