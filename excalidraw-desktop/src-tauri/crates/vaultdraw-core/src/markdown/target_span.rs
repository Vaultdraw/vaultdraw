//! Where a parsed link's target is written in the source, so a rewrite (a note or drawing
//! renamed) edits exactly what the parser read. The parser owns what the target is; this only
//! finds those bytes, and gives up when the written text does not read as the parsed target, so
//! a second reader of the syntax can never drift from the first (toimprove 327, 328).

use super::inline::{decode_dest, split_target};
use super::{DocLink, DocLinkKind};

/// How the target is written, which decides how a new target must be written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetStyle {
    /// `[[Target#heading|alias]]` or `![[Target|40]]`: written as is, never encoded.
    Wiki,
    /// `[t](Target%20One.md#H "title")`: percent-encoded.
    Encoded,
    /// `[t](<Target One.md#H>)`: plain text between angle brackets.
    Angle,
}

/// The byte range in `text` of the file part of `link`'s target (without heading, block,
/// alias, size or title), and how it is written. `None` for web links and when the written
/// text does not read as what the parser found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetSpan {
    pub start: usize,
    pub end: usize,
    pub style: TargetStyle,
}

pub fn link_target_span(text: &str, link: &DocLink) -> Option<TargetSpan> {
    let (s, e) = (link.range[0], link.range[1]);
    let region = text.get(s..e)?;
    let wiki = matches!(link.kind, DocLinkKind::Wikilink) || (matches!(link.kind, DocLinkKind::Embed) && region.starts_with("![["));
    if wiki {
        let open = region.find("[[")?;
        if !region.ends_with("]]") || region.len() < open + 4 {
            return None;
        }
        let body = &region[open + 2..region.len() - 2];
        let lead = body.len() - body.trim_start().len();
        let rest = &body[lead..];
        let t = link.target.as_str();
        if t.is_empty() || !rest.starts_with(t) {
            return None;
        }
        // The target ends at a heading, an alias bar (`\|` in a table cell) or the end.
        if !matches!(rest[t.len()..].chars().next(), None | Some('#' | '|' | '\\' | ' ' | '\t')) {
            return None;
        }
        let start = s + open + 2 + lead;
        return Some(TargetSpan { start, end: start + t.len(), style: TargetStyle::Wiki });
    }
    if !region.ends_with(')') {
        return None;
    }
    let open = region.rfind("](")?;
    let inner = &region[open + 2..region.len() - 1];
    let lead = inner.len() - inner.trim_start().len();
    let rest = &inner[lead..];
    let (off, written, style) = if let Some(a) = rest.strip_prefix('<') {
        (1, &a[..a.find('>')?], TargetStyle::Angle)
    } else {
        (0, &rest[..rest.find(char::is_whitespace).unwrap_or(rest.len())], TargetStyle::Encoded)
    };
    let path = written.split('#').next().unwrap_or("");
    if path.is_empty() || path.contains("://") || path.split(['/', '?']).next().is_some_and(|h| h.contains(':')) {
        return None;
    }
    if split_target(&decode_dest(path)).0 != split_target(&link.target).0 {
        return None;
    }
    let start = s + open + 2 + lead + off;
    Some(TargetSpan { start, end: start + path.len(), style })
}
