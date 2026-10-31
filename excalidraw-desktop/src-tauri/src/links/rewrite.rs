//! Byte-preserving link rewriter for closed drawings (RESEARCH.md section 3.4).
//!
//! One streaming pass over the raw bytes tracks the JSON path `root.elements[i].<key>` and
//! remembers the byte ranges of `id`, `text`, `originalText`, `link`, `version`,
//! `versionNonce` and `updated` of each element. When an element closes and its id is
//! targeted, only those values are spliced; everything else (including the multi-megabyte
//! image blobs, which are skipped with `memchr`) is copied byte for byte.
//!
//! For a text element whose `originalText` changed, `text` is set to the new `originalText`,
//! so a link that word-wrap had split is repaired (the frontend re-measures it).
//!
//! Tag mode (`FileRules::tag`, F6 rename tag) uses the same scanner: no element ids are given,
//! every live text element (and frame name) is checked for whole `#tag` tokens under the old
//! tag and only those byte ranges are replaced.

use super::grammar::{parse_link_field, pct_encode, text_links, url_file_param, FieldForm, EXT, VAULT_URL};
use super::resolve::{key_of_rel, key_of_target, rel_path};
use super::types::{EditField, ElementEdit};
use crate::search::{find_tags, key_under, tag_key};
use crate::{err, Result};
use memchr::{memchr2, memchr3};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One link of an element that must change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Replace {
    /// Normalised key of the link as it resolves today (for relative links, the old vault path).
    pub old_key: String,
    /// New target text for `[[x]]` and `vaultdraw://` links.
    pub new_target: String,
    /// New vault path (no extension) of the target, for relative links.
    pub new_path: String,
}

/// Rename of a tag (and its children): `#from/x` becomes `#to/x`. Keys are case/accent folded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagRule {
    /// Folded key of the tag being renamed.
    pub from_key: String,
    /// New spelling, without `#`.
    pub to: String,
    /// Replay of a rename whose new tag lies under the old one (`a` to `a/b`): tokens already
    /// under this key were rewritten by the interrupted run and are left alone.
    #[serde(default)]
    pub skip_under: Option<String>,
}

pub(crate) struct FileRules<'a> {
    /// Folder of the file before and after the move (relative links resolve from these).
    pub old_dir: &'a str,
    pub new_dir: &'a str,
    /// Element id to its replacements. Only these elements are touched.
    pub elements: &'a BTreeMap<String, Vec<Replace>>,
    /// Tag mode: ignores `elements` and rewrites tag tokens in every live text element.
    pub tag: Option<&'a TagRule>,
    pub now_ms: u64,
}

#[derive(Debug, Default)]
pub(crate) struct Rewritten {
    pub bytes: Vec<u8>,
    /// Links changed.
    pub links: u32,
    /// Text elements whose text changed (to re-measure).
    pub text_elements: Vec<String>,
    /// Decoded new values, for editors that hold the drawing open.
    pub edits: Vec<ElementEdit>,
}

// ---- string helpers ----

/// Decodes a raw JSON string body. `map[i]` is the raw offset of the char that produced decoded
/// byte `i` (`len + 1` entries). Malformed escapes decode to U+FFFD, never panic.
fn decode(raw: &[u8]) -> (String, Vec<u32>) {
    let mut out: Vec<u8> = Vec::with_capacity(raw.len());
    let mut map: Vec<u32> = Vec::with_capacity(raw.len() + 1);
    let hex4 = |b: &[u8]| -> Option<u32> {
        if b.len() < 4 {
            return None;
        }
        u32::from_str_radix(std::str::from_utf8(&b[..4]).ok()?, 16).ok()
    };
    let mut i = 0;
    while i < raw.len() {
        let start = i;
        if raw[i] != b'\\' || i + 1 >= raw.len() {
            out.push(raw[i]);
            i += 1;
        } else {
            let c = raw[i + 1];
            i += 2;
            match c {
                b'n' => out.push(b'\n'),
                b't' => out.push(b'\t'),
                b'r' => out.push(b'\r'),
                b'b' => out.push(8),
                b'f' => out.push(12),
                b'u' => {
                    let mut cp = hex4(&raw[i..]).unwrap_or(0xFFFD);
                    i = (i + 4).min(raw.len());
                    if (0xD800..0xDC00).contains(&cp) && raw.get(i) == Some(&b'\\') && raw.get(i + 1) == Some(&b'u') {
                        if let Some(lo) = hex4(&raw[(i + 2).min(raw.len())..]).filter(|l| (0xDC00..0xE000).contains(l)) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            i += 6;
                        }
                    }
                    out.extend_from_slice(char::from_u32(cp).unwrap_or('\u{FFFD}').encode_utf8(&mut [0; 4]).as_bytes());
                }
                c => out.push(c),
            }
        }
        while map.len() < out.len() {
            map.push(start as u32);
        }
    }
    map.push(raw.len() as u32);
    (String::from_utf8_lossy(&out).into_owned(), map)
}

/// JS-style JSON string escaping (no quotes added).
fn escape(s: &str, out: &mut Vec<u8>) {
    for c in s.chars() {
        match c {
            '"' => out.extend_from_slice(b"\\\""),
            '\\' => out.extend_from_slice(b"\\\\"),
            '\n' => out.extend_from_slice(b"\\n"),
            '\r' => out.extend_from_slice(b"\\r"),
            '\t' => out.extend_from_slice(b"\\t"),
            c if (c as u32) < 0x20 => out.extend_from_slice(format!("\\u{:04x}", c as u32).as_bytes()),
            c => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
        }
    }
}

/// Edits `(start, end, replacement target)` (byte ranges of `s`) for the `[[links]]` in `s`.
fn text_edits(s: &str, reps: &[Replace]) -> Vec<(usize, usize, String)> {
    let mut e = Vec::new();
    if !s.contains("[[") {
        return e;
    }
    text_links(s, |l| {
        let key = key_of_target(l.target);
        if let Some(r) = reps.iter().find(|r| r.old_key == key) {
            e.push((l.target_range.0, l.target_range.1, r.new_target.clone()));
        }
    });
    e
}

/// A text edit: `(start, end, replacement)` in bytes.
pub(super) type Edit = (usize, usize, String);

/// The edit renaming tag body `display` (written at byte `start`, without `#`) under `rule`:
/// only the segments of the old tag change, so children keep their own spelling.
pub(super) fn tag_body_edit(display: &str, start: usize, rule: &TagRule) -> Option<Edit> {
    let key = tag_key(display);
    if !key_under(&key, &rule.from_key) || rule.skip_under.as_deref().is_some_and(|k| key_under(&key, k)) {
        return None;
    }
    let depth = rule.from_key.matches('/').count();
    let end = display.match_indices('/').map(|(i, _)| i).nth(depth).unwrap_or(display.len());
    (display[..end] != rule.to).then(|| (start, start + end, rule.to.clone()))
}

/// Edits `(start, end, new spelling)` for the tag tokens of `s` under the renamed tag.
pub(super) fn tag_edits(s: &str, rule: &TagRule) -> Vec<Edit> {
    if !s.contains('#') {
        return Vec::new();
    }
    find_tags(s).into_iter().filter_map(|m| tag_body_edit(m.display, m.range.0 + 1, rule)).collect()
}

fn apply_edits(s: &str, edits: &[(usize, usize, String)]) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    let mut at = 0;
    for (a, b, r) in edits {
        out.push_str(&s[at..*a]);
        out.push_str(r);
        at = *b;
    }
    out.push_str(&s[at..]);
    out
}

/// The new value of a `link` field, or None when it is not (or needs no) rewritten.
pub(super) fn link_field_edit(s: &str, reps: &[Replace], rules: &FileRules) -> Option<String> {
    let f = parse_link_field(s)?;
    let new = match f.form {
        FieldForm::Wiki => {
            let e = text_edits(s.trim(), reps);
            return (!e.is_empty()).then(|| apply_edits(s.trim(), &e));
        }
        FieldForm::Url => {
            let r = reps.iter().find(|r| r.old_key == key_of_target(&f.target))?;
            let q = s.trim().strip_prefix(VAULT_URL)?;
            let params: Vec<String> = q
                .split('&')
                .map(|kv| match kv.split_once('=') {
                    Some(("file" | "path", _)) => format!("file={}", pct_encode(&r.new_target)),
                    _ => kv.to_string(),
                })
                .collect();
            debug_assert!(url_file_param(q).is_some());
            format!("{VAULT_URL}{}", params.join("&"))
        }
        FieldForm::Rel => {
            let r = reps.iter().find(|r| r.old_key == key_of_rel(rules.old_dir, &f.target))?;
            let mut p = format!("{}{EXT}", rel_path(rules.new_dir, &r.new_path));
            if !f.target.starts_with("./") && !f.target.starts_with("../") {
                if let Some(rest) = p.strip_prefix("./") {
                    p = rest.to_string();
                }
            }
            p
        }
    };
    (new != s).then_some(new)
}

// ---- scanner ----

#[derive(Clone, Copy, PartialEq)]
enum K {
    None,
    Elements,
    Id,
    Text,
    Orig,
    Link,
    Version,
    Nonce,
    Updated,
    Type,
    Name,
    Deleted,
    Other,
}

enum Ctx {
    Obj { key: K, expect_key: bool },
    Arr,
}

#[derive(Clone, Copy)]
struct Span {
    s: usize,
    e: usize,
    is_str: bool,
}

#[derive(Default)]
struct Fields {
    id: Option<Span>,
    text: Option<Span>,
    orig: Option<Span>,
    link: Option<Span>,
    version: Option<Span>,
    nonce: Option<Span>,
    updated: Option<Span>,
    ty: Option<Span>,
    name: Option<Span>,
    deleted: Option<Span>,
}

fn in_element(stack: &[Ctx]) -> bool {
    stack.len() == 3 && matches!(stack[0], Ctx::Obj { key: K::Elements, .. }) && matches!(stack[1], Ctx::Arr) && matches!(stack[2], Ctx::Obj { .. })
}

fn classify(raw: &[u8], element: bool) -> K {
    if element {
        match raw {
            b"id" => K::Id,
            b"text" => K::Text,
            b"originalText" => K::Orig,
            b"link" => K::Link,
            b"version" => K::Version,
            b"versionNonce" => K::Nonce,
            b"updated" => K::Updated,
            b"type" => K::Type,
            b"name" => K::Name,
            b"isDeleted" => K::Deleted,
            _ => K::Other,
        }
    } else if raw == b"elements" {
        K::Elements
    } else {
        K::Other
    }
}

fn set_field(f: &mut Fields, key: K, span: Span) {
    match key {
        K::Id => f.id = Some(span),
        K::Text => f.text = Some(span),
        K::Orig => f.orig = Some(span),
        K::Link => f.link = Some(span),
        K::Version => f.version = Some(span),
        K::Nonce => f.nonce = Some(span),
        K::Updated => f.updated = Some(span),
        K::Type => f.ty = Some(span),
        K::Name => f.name = Some(span),
        K::Deleted => f.deleted = Some(span),
        _ => {}
    }
}

struct Splice {
    start: usize,
    end: usize,
    bytes: Vec<u8>,
}

fn escaped(s: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(s.len() + 2);
    escape(s, &mut v);
    v
}

/// Splices the new targets into the raw string body `raw` (decoded as `text`).
fn splice_raw(raw: &[u8], map: &[u32], edits: &[(usize, usize, String)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + 16);
    let mut at = 0usize;
    for (a, b, r) in edits {
        out.extend_from_slice(&raw[at..map[*a] as usize]);
        escape(r, &mut out);
        at = map[*b] as usize;
    }
    out.extend_from_slice(&raw[at..]);
    out
}

struct Scan<'a> {
    src: &'a [u8],
    rules: &'a FileRules<'a>,
    splices: Vec<Splice>,
    result: Rewritten,
    seq: u64,
}

impl Scan<'_> {
    fn raw(&self, s: Span) -> &[u8] {
        &self.src[s.s..s.e]
    }

    fn finish(&mut self, f: &Fields) {
        let Some(id) = f.id.filter(|s| s.is_str) else { return };
        let tag = self.rules.tag;
        // Tag mode looks at live text elements and frame names (what the tag index reads).
        let is_frame = match tag {
            Some(_) => match f.ty.map(|t| self.raw(t)) {
                _ if f.deleted.is_some_and(|d| self.raw(d) == b"true") => return,
                Some(b"text") => false,
                Some(b"frame" | b"magicframe") => true,
                _ => return,
            },
            None => false,
        };
        let (id, _) = decode(self.raw(id));
        let reps: &[Replace] = match self.rules.elements.get(&id) {
            Some(r) => r,
            None if tag.is_some() => &[],
            None => return,
        };
        let mut local: Vec<Splice> = Vec::new();
        let mut links = 0u32;
        let mut edits: Vec<ElementEdit> = Vec::new();

        // Text: `originalText` is the source of truth, `text` when it has none.
        let orig = f.orig.filter(|s| s.is_str && s.e > s.s && !is_frame);
        let source = if is_frame { f.name.filter(|s| s.is_str) } else { orig.or(f.text.filter(|s| s.is_str)) };
        let mut text_changed = false;
        if let Some(src) = source {
            let (decoded, map) = decode(self.raw(src));
            let e = match tag {
                Some(rule) => tag_edits(&decoded, rule),
                None => text_edits(&decoded, reps),
            };
            if !e.is_empty() {
                let new_raw = splice_raw(self.raw(src), &map, &e);
                let value = apply_edits(&decoded, &e);
                links += e.len() as u32;
                text_changed = true;
                local.push(Splice { start: src.s, end: src.e, bytes: new_raw.clone() });
                for other in [f.text, f.orig].into_iter().flatten().filter(|o| o.is_str && o.s != src.s && !is_frame) {
                    // Keep `text` equal to the new `originalText` (fixes word-wrap splits).
                    if orig.is_some() || other.s == src.s {
                        local.push(Splice { start: other.s, end: other.e, bytes: new_raw.clone() });
                    }
                }
                edits.push(ElementEdit { element_id: id.clone(), field: if is_frame { EditField::Name } else { EditField::Text }, value });
            }
        }
        // Link field.
        if let Some(l) = f.link.filter(|s| s.is_str && tag.is_none()) {
            let (decoded, _) = decode(self.raw(l));
            if let Some(new) = link_field_edit(&decoded, reps, self.rules) {
                local.push(Splice { start: l.s, end: l.e, bytes: escaped(&new) });
                edits.push(ElementEdit { element_id: id.clone(), field: EditField::Link, value: new });
                links += 1;
            }
        }
        if local.is_empty() {
            return;
        }
        // Bookkeeping so editors and sync tools see the element as changed.
        let num = |s: Option<Span>| s.filter(|s| !s.is_str);
        if let Some(v) = num(f.version) {
            if let Some(n) = std::str::from_utf8(self.raw(v)).ok().and_then(|t| t.parse::<u64>().ok()) {
                local.push(Splice { start: v.s, end: v.e, bytes: (n + 1).to_string().into_bytes() });
            }
        }
        if let Some(v) = num(f.nonce) {
            self.seq += 1;
            let mut x = self.rules.now_ms ^ self.seq.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            local.push(Splice { start: v.s, end: v.e, bytes: (x % (1 << 31)).to_string().into_bytes() });
        }
        if let Some(v) = num(f.updated) {
            local.push(Splice { start: v.s, end: v.e, bytes: self.rules.now_ms.to_string().into_bytes() });
        }
        local.sort_by_key(|s| s.start);
        local.dedup_by_key(|s| s.start);
        self.splices.extend(local);
        self.result.links += links;
        self.result.edits.extend(edits);
        if text_changed && !is_frame {
            self.result.text_elements.push(id);
        }
    }
}

/// Rewrites `src` per `rules`. `Ok(None)` when nothing changed. The output is only as valid
/// as the input: callers validate JSON when writing (`write_drawing_file` does).
pub(crate) fn rewrite(src: &[u8], rules: &FileRules) -> Result<Option<Rewritten>> {
    if rules.elements.is_empty() && rules.tag.is_none() {
        return Ok(None);
    }
    let bad = || err("INVALID_FILE", "Drawing JSON is truncated");
    let mut scan = Scan { src, rules, splices: Vec::new(), result: Rewritten::default(), seq: 0 };
    let mut stack: Vec<Ctx> = Vec::with_capacity(8);
    let mut fields = Fields::default();
    let mut i = 0usize;
    while i < src.len() {
        match src[i] {
            b'{' => {
                stack.push(Ctx::Obj { key: K::None, expect_key: true });
                if in_element(&stack) {
                    fields = Fields::default();
                }
                i += 1;
            }
            b'[' => {
                stack.push(Ctx::Arr);
                i += 1;
            }
            b'}' => {
                if in_element(&stack) {
                    scan.finish(&fields);
                }
                stack.pop();
                i += 1;
            }
            b']' => {
                stack.pop();
                i += 1;
            }
            b',' => {
                if let Some(Ctx::Obj { expect_key, .. }) = stack.last_mut() {
                    *expect_key = true;
                }
                i += 1;
            }
            b':' => {
                if let Some(Ctx::Obj { expect_key, .. }) = stack.last_mut() {
                    *expect_key = false;
                }
                i += 1;
            }
            b'"' => {
                let s = i + 1;
                let mut j = s;
                loop {
                    let k = memchr2(b'"', b'\\', &src[j..]).ok_or_else(bad)?;
                    if src[j + k] == b'\\' {
                        j += k + 2;
                        if j > src.len() {
                            return Err(bad());
                        }
                    } else {
                        j += k;
                        break;
                    }
                }
                let element = in_element(&stack);
                let raw = &src[s..j];
                let root = stack.len() == 1;
                if let Some(Ctx::Obj { key, expect_key }) = stack.last_mut() {
                    if *expect_key {
                        *key = if element || root { classify(raw, element) } else { K::Other };
                    } else if element {
                        set_field(&mut fields, *key, Span { s, e: j, is_str: true });
                    }
                }
                i = j + 1;
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                if in_element(&stack) {
                    if let Some(Ctx::Obj { key, expect_key: false }) = stack.last() {
                        if !matches!(key, K::None | K::Other | K::Elements) {
                            let end = memchr3(b',', b'}', b']', &src[i..]).map_or(src.len(), |k| i + k);
                            let tok_end = src[i..end].iter().rposition(|b| !b.is_ascii_whitespace()).map_or(i, |p| i + p + 1);
                            set_field(&mut fields, *key, Span { s: i, e: tok_end, is_str: false });
                            i = end;
                            continue;
                        }
                    }
                }
                i += 1;
            }
        }
    }
    if scan.splices.is_empty() {
        return Ok(None);
    }
    let mut out = Vec::with_capacity(src.len() + 256);
    let mut at = 0;
    for sp in &scan.splices {
        out.extend_from_slice(&src[at..sp.start]);
        out.extend_from_slice(&sp.bytes);
        at = sp.end;
    }
    out.extend_from_slice(&src[at..]);
    let mut r = scan.result;
    r.bytes = out;
    Ok(Some(r))
}
