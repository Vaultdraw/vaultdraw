//! Rewrites the links of a note when a drawing or note they point at moves (or the note itself
//! moves and a link was relative). Works on the note's current text, by link key, so a stale
//! plan or a replayed journal changes nothing twice. The file is written through
//! `write_note_file` (revision check, history copy, atomic rename).

use super::plan::FilePlan;
use super::rewrite::Replace;
use vaultdraw_core::links::grammar::{pct_encode, strip_ext};
use vaultdraw_core::links::resolve::{key_of_note_target, rel_path};
use vaultdraw_core::markdown::{link_target_span, parse_markdown, ParseOptions, TargetStyle};
use vaultdraw_core::search::notes::is_attachment_ext;

/// A new written target that keeps how the old one was spelled: `.md` and `.excalidraw`
/// suffixes are written only if the old text had them.
fn fit(old: &str, new_path: &str) -> String {
    let lo = old.to_ascii_lowercase();
    let new_note = new_path.to_ascii_lowercase().ends_with(".md");
    if new_note {
        return if lo.ends_with(".md") { new_path.to_string() } else { new_path[..new_path.len() - 3].to_string() };
    }
    let stem = strip_ext(new_path);
    if lo.ends_with(".excalidraw") {
        format!("{stem}.excalidraw")
    } else {
        stem.to_string()
    }
}

/// The text of the link target `old` (as written in a note in `old_dir`) after the change `r`;
/// `new_dir` is where the note will be.
fn new_text(old: &str, r: &Replace, new_dir: &str) -> String {
    if old.starts_with("./") || old.starts_with("../") {
        let rel = rel_path(new_dir, &r.new_path);
        let mut s = fit(old, &rel);
        if !s.starts_with("./") && !s.starts_with("../") {
            s = format!("./{s}");
        }
        return s;
    }
    if r.new_target.is_empty() {
        return fit(old, &r.new_path);
    }
    // `new_target` is the shortest unique text from the plan; `Folder/Note` keeps its folders.
    fit(old, &r.new_target)
}

pub(crate) struct Rewritten {
    pub text: String,
    pub links: u32,
}

/// Applies the plan of one note to its current text; `None` when no link needed changing.
pub(crate) fn rewrite_note(text: &str, plan: &FilePlan) -> Option<Rewritten> {
    let reps: Vec<&Replace> = plan.elements.values().flatten().collect();
    if reps.is_empty() {
        return None;
    }
    let (old_dir, new_dir) = (super::resolve::dir_of(&plan.from_path), super::resolve::dir_of(&plan.to_path));
    let doc = parse_markdown(text, &ParseOptions::default());
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    for l in &doc.links {
        // The parser decides what the target is; `link_target_span` only finds where it is
        // written (a table cell's `\|`, `<angle brackets>`, a title or heading after it).
        let Some(sp) = link_target_span(text, l) else { continue };
        let raw = &text[sp.start..sp.end];
        let span = (sp.start, sp.end);
        let written = match sp.style {
            TargetStyle::Wiki => raw.to_string(),
            TargetStyle::Encoded | TargetStyle::Angle => vaultdraw_core::links::grammar::pct_decode(raw),
        };
        if written.is_empty() || is_attachment_ext(&written) {
            continue;
        }
        let (key, _) = key_of_note_target(old_dir, &written);
        let Some(r) = reps.iter().find(|r| r.old_key == key) else { continue };
        let mut new = new_text(&written, r, new_dir);
        if sp.style != TargetStyle::Wiki {
            if !new.to_ascii_lowercase().ends_with(".md") && !new.to_ascii_lowercase().ends_with(".excalidraw") {
                new.push_str(".md");
            }
            if sp.style == TargetStyle::Encoded {
                new = pct_encode(&new);
            }
        }
        if new != text[span.0..span.1] {
            edits.push((span.0, span.1, new));
        }
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|e| e.0);
    let mut out = String::with_capacity(text.len() + 32);
    let mut at = 0;
    for (s, e, n) in &edits {
        if *s < at {
            continue;
        }
        out.push_str(&text[at..*s]);
        out.push_str(n);
        at = *e;
    }
    out.push_str(&text[at..]);
    Some(Rewritten { text: out, links: edits.len() as u32 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn plan(from: &str, to: &str, reps: &[(&str, &str, &str)]) -> FilePlan {
        let mut elements = BTreeMap::new();
        elements.insert("L1".to_string(), reps.iter().map(|(k, t, p)| Replace { old_key: (*k).into(), new_target: (*t).into(), new_path: (*p).into() }).collect());
        FilePlan { from_path: from.into(), to_path: to.into(), elements }
    }

    #[test]
    fn wikilinks_keep_heading_alias_embed_and_the_spelling() {
        let src = "[[Old]] [[Old#H|shown]] ![[Old]] [[Old.md]] [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n";
        let p = plan("n.md", "n.md", &[("old.md", "New.md", "New.md")]);
        let r = rewrite_note(src, &p).unwrap();
        assert_eq!(r.text, "[[New]] [[New#H|shown]] ![[New]] [[New.md]] [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n");
        assert_eq!(r.links, 4);
    }

    #[test]
    fn a_renamed_drawing_keeps_its_extension_style() {
        // `[[Map]]` in a note is the note Map.md; only the written `.excalidraw` names the drawing.
        let src = "[[Map]] and [[Map.excalidraw]]\n";
        let p = plan("n.md", "n.md", &[("map", "Atlas", "Atlas")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "[[Map]] and [[Atlas.excalidraw]]\n");
    }

    #[test]
    fn markdown_links_are_percent_encoded() {
        let src = "[x](Old%20One.md) [y](https://a.b/Old.md)\n";
        let p = plan("n.md", "n.md", &[("old one.md", "New Name.md", "New Name.md")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "[x](New%20Name.md) [y](https://a.b/Old.md)\n");
    }

    #[test]
    fn relative_links_follow_a_moved_note_and_replays_change_nothing() {
        let src = "[[./Two]] [[../Top]]\n";
        // The note moves from a/ to a/b/: its targets are now one folder deeper.
        let p = plan("a/One.md", "a/b/One.md", &[("a/two.md", "", "a/Two.md"), ("top.md", "", "Top.md")]);
        let r = rewrite_note(src, &p).unwrap();
        assert_eq!(r.text, "[[../Two]] [[../../Top]]\n");
        // Unrelated links and an already rewritten note: nothing to do.
        assert!(rewrite_note("[[Other]]\n", &plan("n.md", "n.md", &[("old.md", "New.md", "New.md")])).is_none());
    }

    #[test]
    fn crlf_and_frontmatter_bytes_survive() {
        let src = "---\r\ntitle: x\r\n---\r\nsee [[Old]]\r\n";
        let p = plan("n.md", "n.md", &[("old.md", "New.md", "New.md")]);
        assert_eq!(rewrite_note(src, &p).unwrap().text, "---\r\ntitle: x\r\n---\r\nsee [[New]]\r\n");
    }

    // Found by the bug hunter (launch hunter 5, toimprove 327): `[[Old\|shown]]` in a table cell.
    #[test]
    fn huntl3_table_escaped_pipe_alias_is_rewritten() {
        let src = "| a |\n|---|\n| [[Old\\|shown]] |\n";
        let p = plan("n.md", "n.md", &[("old.md", "New.md", "New.md")]);
        let r = rewrite_note(src, &p);
        assert_eq!(r.map(|r| r.text), Some("| a |\n|---|\n| [[New\\|shown]] |\n".to_string()));
    }

    // Found by the bug hunter (launch hunter 5, toimprove 328): `[t](<Old One.md>)`.
    #[test]
    fn huntl3_angle_bracket_link_is_rewritten() {
        let src = "[x](<Old One.md>)\n";
        let p = plan("n.md", "n.md", &[("old one.md", "New Name.md", "New Name.md")]);
        let r = rewrite_note(src, &p);
        assert_eq!(r.map(|r| r.text), Some("[x](<New Name.md>)\n".to_string()));
    }

    /// The family: every way a note can point at a renamed note or drawing (the forms in
    /// `vaultdraw-core/src/markdown/link_target_cases.json`), and the ones that must not change.
    #[test]
    fn every_link_form_follows_a_rename() {
        let note = &[("old.md", "New.md", "New.md")];
        let spaced = &[("old one.md", "New Name.md", "New Name.md")];
        let drawing = &[("map", "Atlas", "Atlas")];
        let cases: &[(&str, &[(&str, &str, &str)], &str)] = &[
            ("| a |\n|---|\n| [[Old#H\\|a]] |\n", note, "| a |\n|---|\n| [[New#H\\|a]] |\n"),
            ("| a |\n|---|\n| ![[Map.excalidraw\\|40]] |\n", drawing, "| a |\n|---|\n| ![[Atlas.excalidraw\\|40]] |\n"),
            ("![[Map.excalidraw|40]]", drawing, "![[Atlas.excalidraw|40]]"),
            ("[[Old#^blk]] [[ Old ]]", note, "[[New#^blk]] [[ New ]]"),
            ("[[Old^block]]", note, "[[Old^block]]"),
            ("[x](<Old One.md#H>)", spaced, "[x](<New Name.md#H>)"),
            ("[x](Old%20One.md#H)", spaced, "[x](New%20Name.md#H)"),
            ("[x](Old.md#H) [y](Old.md \"t\") ![a](Old.md)", note, "[x](New.md#H) [y](New.md \"t\") ![a](New.md)"),
            ("> [!note] T\n> see [[Old|y]] and [x](Old.md)\n", note, "> [!note] T\n> see [[New|y]] and [x](New.md)\n"),
            ("- [ ] task [[Old]]\n", note, "- [ ] task [[New]]\n"),
            ("`[[Old]]` `[x](Old.md)`\n```\n[[Old]]\n```\n", note, "`[[Old]]` `[x](Old.md)`\n```\n[[Old]]\n```\n"),
            ("[y](https://a.b/Old.md) <https://a.b/Old.md>", note, "[y](https://a.b/Old.md) <https://a.b/Old.md>"),
        ];
        for (src, reps, want) in cases {
            let got = rewrite_note(src, &plan("n.md", "n.md", reps)).map_or_else(|| src.to_string(), |r| r.text);
            assert_eq!(&got, want, "{src:?}");
        }
    }
}
