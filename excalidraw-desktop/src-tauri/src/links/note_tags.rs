//! Renaming a tag inside a note (toimprove 192), the way Obsidian's Tag Wrangler does it:
//! `#tag` tokens in the body and the values of the frontmatter `tags` / `tag` key change;
//! code (fenced, indented and inline), links and images stay as written. Children keep their
//! own spelling (`#a/b` renamed `a` to `x` gives `#x/b`).

use super::rewrite::{tag_body_edit, Edit, TagRule};
use vaultdraw_core::markdown::{parse_markdown, Block, BlockKind, ParseOptions};
use vaultdraw_core::search::find_tags;

/// Byte ranges no tag is read from: code blocks, images and embeds (any depth).
fn block_skips(blocks: &[Block], out: &mut Vec<(usize, usize)>) {
    for b in blocks {
        match &b.kind {
            BlockKind::Code { .. } | BlockKind::Image { .. } | BlockKind::Embed { .. } => out.push((b.range[0], b.range[1])),
            BlockKind::Blockquote { blocks } | BlockKind::Callout { blocks, .. } | BlockKind::FootnoteDef { blocks, .. } => block_skips(blocks, out),
            _ => {}
        }
    }
}

/// Inline code spans of `text[from..]` outside `skips`: a run of N backticks up to the next run
/// of exactly N, never across a blank line (CommonMark).
fn inline_code(text: &str, from: usize, skips: &[(usize, usize)], out: &mut Vec<(usize, usize)>) {
    let b = text.as_bytes();
    let mut i = from;
    while i < b.len() {
        if let Some(&(_, end)) = skips.iter().find(|r| r.0 <= i && i < r.1) {
            i = end;
            continue;
        }
        if b[i] != b'`' {
            i += 1;
            continue;
        }
        let n = b[i..].iter().take_while(|&&c| c == b'`').count();
        let open_end = i + n;
        let mut j = open_end;
        let mut close = None;
        while j < b.len() {
            if b[j] == b'\n' && text[j + 1..].trim_start_matches([' ', '\t', '\r']).starts_with('\n') {
                break;
            }
            if b[j] == b'`' {
                let m = b[j..].iter().take_while(|&&c| c == b'`').count();
                if m == n {
                    close = Some(j + m);
                    break;
                }
                j += m;
            } else {
                j += 1;
            }
        }
        match close {
            Some(c) => {
                out.push((i, c));
                i = c;
            }
            None => i = open_end,
        }
    }
}

/// The edit for one frontmatter value token at `start` (quotes and `#` already stripped).
fn value_edit(text: &str, start: usize, end: usize, rule: &TagRule) -> Option<Edit> {
    let body = &text[start..end];
    let probe = format!("#{body}");
    // Only a value that is exactly one tag (a `tags: [my notes]` entry with a space is not).
    match find_tags(&probe).as_slice() {
        [m] if m.range == (0, probe.len()) => tag_body_edit(body, start, rule),
        _ => None,
    }
}

/// Tokens of a frontmatter value at `base`: runs between `[ ] ,`, whitespace and quotes.
fn value_tokens(text: &str, base: usize, value: &str, rule: &TagRule, out: &mut Vec<Edit>) {
    let sep = |c: char| matches!(c, '[' | ']' | ',' | '"' | '\'') || c.is_whitespace();
    let mut at = 0;
    for part in value.split(sep) {
        let start = base + at;
        at += part.len() + value[at + part.len()..].chars().next().map_or(0, char::len_utf8);
        let t = part.strip_prefix('#').unwrap_or(part);
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let s = start + (part.len() - t.len());
        out.extend(value_edit(text, s, s + t.len(), rule));
    }
}

/// Edits for the `tags` / `tag` values of the frontmatter in `text[range]`.
fn frontmatter_edits(text: &str, range: (usize, usize), rule: &TagRule, out: &mut Vec<Edit>) {
    let mut in_tags = false;
    let mut pos = range.0;
    for line in text[range.0..range.1].split_inclusive('\n') {
        let start = pos;
        pos += line.len();
        let l = line.trim_end_matches(['\n', '\r']);
        if l.trim() == "---" || l.trim() == "..." || l.trim().is_empty() || l.trim_start().starts_with('#') {
            continue;
        }
        let item = l.trim_start().strip_prefix('-').filter(|r| r.is_empty() || r.starts_with([' ', '\t']));
        if let Some(rest) = item {
            if in_tags {
                let base = start + (l.len() - rest.len());
                value_tokens(text, base, rest, rule, out);
            }
            continue;
        }
        if l.starts_with([' ', '\t']) {
            continue; // a continuation of the current value
        }
        let Some(colon) = l.find(':') else {
            in_tags = false;
            continue;
        };
        let key = l[..colon].trim().trim_matches(['"', '\'']);
        in_tags = key.eq_ignore_ascii_case("tags") || key.eq_ignore_ascii_case("tag");
        if in_tags {
            let value = &l[colon + 1..];
            // Strip a trailing comment (` # ...`): a `#` after a space starts one in YAML.
            let value = value.find(" #").map_or(value, |i| &value[..i]);
            value_tokens(text, start + colon + 1, value, rule, out);
        }
    }
}

/// Every edit renaming the tag in note `text`, sorted, non-overlapping.
pub(crate) fn note_tag_edits(text: &str, rule: &TagRule) -> Vec<Edit> {
    let mut edits = Vec::new();
    if !text.contains('#') && !text.contains(':') {
        return edits;
    }
    let doc = parse_markdown(text, &ParseOptions::default());
    let body_from = doc.frontmatter.as_ref().map_or(0, |f| f.range[1]);
    if let Some(f) = &doc.frontmatter {
        frontmatter_edits(text, (f.range[0], f.range[1]), rule, &mut edits);
    }
    if text[body_from..].contains('#') {
        let mut skips = Vec::new();
        block_skips(&doc.blocks, &mut skips);
        skips.extend(doc.links.iter().map(|l| (l.range[0], l.range[1])));
        skips.sort_unstable();
        let mut code = Vec::new();
        inline_code(text, body_from, &skips, &mut code);
        skips.extend(code);
        for m in find_tags(&text[body_from..]) {
            let at = body_from + m.range.0;
            if skips.iter().any(|r| r.0 <= at && at < r.1) {
                continue;
            }
            edits.extend(tag_body_edit(m.display, at + 1, rule));
        }
    }
    edits.sort_by_key(|e| e.0);
    edits
}

/// `text` with the tag renamed, or None when nothing changes.
pub(crate) fn rename_in_note(text: &str, rule: &TagRule) -> Option<(String, u32)> {
    let edits = note_tag_edits(text, rule);
    if edits.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(text.len() + 16);
    let mut at = 0;
    for (a, b, r) in &edits {
        out.push_str(&text[at..*a]);
        out.push_str(r);
        at = *b;
    }
    out.push_str(&text[at..]);
    Some((out, edits.len() as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(from: &str, to: &str) -> TagRule {
        TagRule { from_key: vaultdraw_core::search::tag_key(from), to: to.into(), skip_under: None }
    }

    fn renamed(src: &str, from: &str, to: &str) -> String {
        rename_in_note(src, &rule(from, to)).map_or_else(|| src.to_string(), |x| x.0)
    }

    #[test]
    fn body_tags_and_children_change_code_and_links_do_not() {
        let src = "Intro #Project and #project/alpha, (#project)\n\n```\n#project in code\n```\n\nInline `#project` stays, [[Note#project]] and [[#project]] stay, [x](#project) stays.\n\n    #project indented code\n";
        let out = renamed(src, "project", "work");
        assert_eq!(
            out,
            "Intro #work and #work/alpha, (#work)\n\n```\n#project in code\n```\n\nInline `#project` stays, [[Note#project]] and [[#project]] stay, [x](#project) stays.\n\n    #project indented code\n"
        );
    }

    #[test]
    fn a_tag_in_bold_italic_or_strike_is_renamed() {
        assert_eq!(renamed("**#project** *#project* ~~#project~~\n", "project", "work"), "**#work** *#work* ~~#work~~\n");
    }

    #[test]
    fn other_tags_and_look_alikes_stay() {
        let src = "#projects #proj #ff00aa a#project https://x/#project #project-x\n";
        assert_eq!(renamed(src, "project", "work"), src);
    }

    #[test]
    fn frontmatter_flow_scalar_and_block_lists() {
        let src = "---\ntitle: project\ntags: [project, other, \"project/a\"]\ntag: project\naliases: [project]\n---\nbody #project\n";
        assert_eq!(renamed(src, "project", "work"), "---\ntitle: project\ntags: [work, other, \"work/a\"]\ntag: work\naliases: [project]\n---\nbody #work\n");
        let src = "---\ntags:\n  - project\n  - '#project'\n  - other\ncssclasses:\n  - project\n---\n";
        assert_eq!(renamed(src, "project", "work"), "---\ntags:\n  - work\n  - '#work'\n  - other\ncssclasses:\n  - project\n---\n");
        let src = "---\ntags: project other # project note\n---\n";
        assert_eq!(renamed(src, "project", "work"), "---\ntags: work other # project note\n---\n");
    }

    #[test]
    fn count_matches_the_tags_the_parser_reads_afterwards() {
        let src = "---\ntags: [project]\n---\n# Heading #project\n\n- item #project/a\n> quote #project\n\n| a | b |\n| - | - |\n| #project | x |\n";
        let (out, n) = rename_in_note(src, &rule("project", "work")).unwrap();
        assert_eq!(n, 5);
        let tags = parse_markdown(&out, &ParseOptions::default()).tags;
        assert!(tags.iter().all(|t| !vaultdraw_core::search::key_under(&vaultdraw_core::search::tag_key(t), "project")), "{tags:?}");
    }

    #[test]
    fn same_spelling_and_crlf() {
        assert_eq!(rename_in_note("#work\n", &rule("work", "work")), None);
        assert_eq!(renamed("---\r\ntags: [project]\r\n---\r\n#project\r\n", "project", "Work"), "---\r\ntags: [Work]\r\n---\r\n#Work\r\n");
    }
}
