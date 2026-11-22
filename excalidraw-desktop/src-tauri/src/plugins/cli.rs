//! `cli.*` plugin rows: ask the AI command line the user already has (Claude Code, Codex) and
//! stream its answer back, so a subscription works without pasting a key. The plugin never names a
//! program or its arguments: it names a tool id from the table below, and Rust finds that tool's
//! binary, builds the argument list and runs it.
//!
//! Safety rules, each one tested:
//! - the binary is found by absolute path (the PATH entries that are absolute, then the usual
//!   install folders); a relative path is never run;
//! - no shell: the program gets an argument array, so no text of the question is ever parsed;
//! - the question goes in on standard input, not on the command line;
//! - the tool runs in an empty folder of its own, with its own tools switched off where it has the flag;
//! - a time limit and a cancel both kill the whole process group;
//! - Offline mode and `network.allow_ai` block it like a request to a provider (the tools talk to
//!   their provider over the internet);
//! - Vaultdraw never reads, copies or stores the tool's login: the tool keeps its own;
//! - pictures (at most 4, 5 MiB each, PNG/JPEG/GIF/WebP) go to claude inside its input message and
//!   to codex as files in a folder made for that run, which is deleted when the run ends.
//!
//! `cli.detect` finds the tools and, when asked (`check`), asks each one whether it is logged in.
//! `cli.open` starts a run and returns `{"id"}`; `cli.read` pulls tagged chunks of its standard
//! output (first byte: 0 data, 1 ended, 2 nothing yet, 3 error JSON); `cli.close` cancels.
use crate::network;
use crate::{err, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{channel, Receiver, RecvTimeoutError, Sender},
        Arc, LazyLock, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime},
};

const PURPOSE: &str = "ai";
const MAX_PROMPT: usize = 2 * 1024 * 1024;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
const MAX_STREAMS: usize = 2;
const CHUNK: usize = 16 * 1024;
const READ_WAIT: Duration = Duration::from_millis(1500);
const DEFAULT_TIMEOUT_MS: u64 = 300_000;
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const STDERR_KEEP: usize = 2000;
const TAG_DATA: u8 = 0;
const TAG_END: u8 = 1;
const TAG_WAIT: u8 = 2;
const TAG_ERROR: u8 = 3;

// ---------------------------------------------------------------------------
// The tool table: one entry per supported command line
// ---------------------------------------------------------------------------

struct Tool {
    id: &'static str,
    binary: &'static str,
    /// Reasoning levels the tool accepts.
    efforts: &'static [&'static str],
    /// Arguments that print the login state, and how to read the answer.
    auth_args: &'static [&'static str],
}

const TOOLS: &[Tool] = &[
    Tool { id: "claude", binary: "claude", efforts: &["low", "medium", "high", "xhigh", "max"], auth_args: &["auth", "status"] },
    Tool { id: "codex", binary: "codex", efforts: &["low", "medium", "high", "xhigh"], auth_args: &["login", "status"] },
];

fn tool(id: &str) -> Result<&'static Tool> {
    TOOLS.iter().find(|t| t.id == id).ok_or_else(|| err("INVALID_ARGUMENT", format!("Unknown tool \"{id}\"")))
}

/// Folders searched after PATH: a macOS app does not inherit the shell's PATH, so the places these
/// tools install to are listed. `home` is the user's home folder.
fn usual_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(PathBuf::from).collect();
    if let Some(h) = home {
        for rel in [".local/bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin"] {
            v.push(h.join(rel));
        }
    }
    v
}

fn is_executable_file(p: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(p) else { return false };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The absolute path of `binary` in `dirs` (relative entries are skipped), first match wins.
fn find_in(binary: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().filter(|d| d.is_absolute()).map(|d| d.join(binary)).find(|p| is_executable_file(p))
}

fn find_binary(t: &Tool) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(usual_dirs(std::env::var_os("HOME").map(PathBuf::from).as_deref()));
    find_in(t.binary, &dirs)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Runs a `cli.*` row. `config` loads the parsed `config.toml` (Offline mode, `allow_ai`).
pub(crate) fn call(state_dir: &Path, config: impl Fn() -> Result<Option<Value>> + Copy, plugin_id: &str, method: &str, body: &[u8]) -> Result<Vec<u8>> {
    match method {
        "cli.detect" => detect(body),
        "cli.open" => open(state_dir, config, plugin_id, body),
        "cli.read" => read(plugin_id, body),
        "cli.close" => close(plugin_id, body),
        _ => Err(err("NOT_FOUND", format!("Plugins cannot call \"{method}\""))),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T> {
    serde_json::from_slice(body).map_err(|_| err("INVALID_ARGUMENT", "The request body is not the expected JSON"))
}

// ---------------------------------------------------------------------------
// cli.detect
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
struct DetectRequest {
    /// Also ask each found tool whether it is logged in (runs the tool's own status command).
    check: bool,
}

/// `{"tools":[{"id","path","state","detail"}]}` with state `missing`, `found` (not asked), `ready`
/// or `login` (found, but not logged in).
fn detect(body: &[u8]) -> Result<Vec<u8>> {
    let req: DetectRequest = if body.is_empty() { Default::default() } else { parse(body)? };
    let out: Vec<Value> = TOOLS.iter().map(|t| detect_one(t, find_binary(t), req.check)).collect();
    Ok(serde_json::to_vec(&json!({ "tools": out })).unwrap_or_default())
}

fn detect_one(t: &Tool, found: Option<PathBuf>, check: bool) -> Value {
    let Some(path) = found else {
        return json!({ "id": t.id, "path": null, "state": "missing", "detail": "" });
    };
    let shown = path.to_string_lossy().into_owned();
    if !check {
        return json!({ "id": t.id, "path": shown, "state": "found", "detail": "" });
    }
    let (state, detail) = match capture(&path, t.auth_args, CHECK_TIMEOUT) {
        Ok((0, text)) => (if logged_out_text(t, &text) { "login" } else { "ready" }, first_line(&text)),
        Ok((_, text)) => ("login", first_line(&text)),
        Err(e) => ("login", e),
    };
    json!({ "id": t.id, "path": shown, "state": state, "detail": detail })
}

/// `claude auth status` exits 0 even when logged out and says so in its JSON.
fn logged_out_text(t: &Tool, text: &str) -> bool {
    if t.id == "claude" {
        return serde_json::from_str::<Value>(text.trim()).ok().and_then(|v| v.get("loggedIn").and_then(Value::as_bool)) == Some(false);
    }
    false
}

fn first_line(text: &str) -> String {
    text.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('{') && !l.starts_with('}')).unwrap_or("").chars().take(120).collect()
}

/// Runs `bin args` (no input) and returns its exit code and combined output, within `limit`.
fn capture(bin: &Path, args: &[&str], limit: Duration) -> std::result::Result<(i32, String), String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    own_group(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("could not start: {e}"))?;
    let mut out = child.stdout.take().expect("piped");
    let mut errp = child.stderr.take().expect("piped");
    let a = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.by_ref().take(64 * 1024).read_to_string(&mut s);
        s
    });
    let b = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = errp.by_ref().take(64 * 1024).read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let text = format!("{}{}", a.join().unwrap_or_default(), b.join().unwrap_or_default());
                return Ok((status.code().unwrap_or(-1), text));
            }
            Ok(None) if start.elapsed() > limit => {
                kill_group(&mut child);
                let _ = child.wait();
                return Err("did not answer in time".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/// Puts the child in its own process group, so a kill reaches what it started too.
fn own_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = cmd;
    }
}

fn kill_group(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // SAFETY: signals the process group this child leads (set by `own_group`).
        unsafe {
            libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
        }
    }
    let _ = child.kill();
}

// ---------------------------------------------------------------------------
// cli.open
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct ImageIn {
    mime: String,
    /// The file's bytes as base64 text.
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenRequest {
    tool: String,
    model: Option<String>,
    effort: Option<String>,
    system: Option<String>,
    prompt: String,
    timeout_ms: Option<u64>,
    #[serde(default)]
    images: Vec<ImageIn>,
}

const MAX_IMAGES: usize = 4;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
static IMAGE_SEQ: AtomicU64 = AtomicU64::new(1);

/// The file extension for an accepted picture type.
fn image_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// Standard base64 (padding optional, no spaces) to bytes; `None` for any other character or a
/// length that cannot be base64. Small and local: the only decoder the app needs.
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let t = text.trim_end_matches('=').as_bytes();
    if t.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(t.len() / 4 * 3 + 2);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in t {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// Refuses too many pictures, a type that is not a picture, text that is not base64 and a picture
/// over the size cap. The size is judged from the text before anything is decoded.
fn check_images(images: &[ImageIn]) -> Result<()> {
    if images.len() > MAX_IMAGES {
        return Err(err("INVALID_ARGUMENT", format!("At most {MAX_IMAGES} images can be sent at once")));
    }
    for i in images {
        if image_ext(&i.mime).is_none() {
            return Err(err("INVALID_ARGUMENT", "Images must be PNG, JPEG, GIF or WebP"));
        }
        if i.data.len() / 4 * 3 > MAX_IMAGE_BYTES + 3 {
            return Err(err("TOO_LARGE", "An image is larger than 5 MiB"));
        }
        if !i.data.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'=') {
            return Err(err("INVALID_ARGUMENT", "An image is not base64 text"));
        }
    }
    Ok(())
}

/// Writes the pictures into a new folder inside `cwd` for codex's `--image`; returns the folder and
/// the files. The caller deletes the folder when the run ends.
fn write_images(cwd: &Path, images: &[ImageIn]) -> Result<(PathBuf, Vec<PathBuf>)> {
    sweep_old_image_folders(cwd);
    let dir = cwd.join(format!("img-{}-{}", std::process::id(), IMAGE_SEQ.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&dir).map_err(|e| err("INTERNAL", format!("Could not prepare the image folder: {e}")))?;
    let mut files = Vec::new();
    for (n, i) in images.iter().enumerate() {
        let bytes = decode_base64(&i.data).filter(|b| b.len() <= MAX_IMAGE_BYTES);
        let (Some(bytes), Some(ext)) = (bytes, image_ext(&i.mime)) else {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(err("INVALID_ARGUMENT", "An image could not be read"));
        };
        let f = dir.join(format!("image-{}.{ext}", n + 1));
        if let Err(e) = std::fs::write(&f, bytes) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(err("INTERNAL", format!("Could not save an image: {e}")));
        }
        files.push(f);
    }
    Ok((dir, files))
}

/// Folders a crashed run left behind (older than an hour) are removed; nothing else is touched.
fn sweep_old_image_folders(cwd: &Path) {
    let Ok(rd) = std::fs::read_dir(cwd) else { return };
    for e in rd.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|d| d > Duration::from_secs(3600));
        if old && e.file_name().to_string_lossy().starts_with("img-") && e.path().is_dir() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// A model name is plain: letters, digits and `. _ : - [ ]`.
fn check_model(m: &str) -> Result<()> {
    if m.is_empty() || m.len() > 64 || !m.chars().all(|c| c.is_ascii_alphanumeric() || "._:-[]/".contains(c)) || m.starts_with('-') {
        return Err(err("INVALID_ARGUMENT", "The model name has characters that cannot be used"));
    }
    Ok(())
}

/// What to run for a request: the argument array and the text for standard input. Pure.
fn build_run(t: &Tool, req: &OpenRequest, cwd: &Path, files: &[PathBuf]) -> Result<(Vec<String>, String)> {
    if let Some(m) = req.model.as_deref().filter(|m| !m.is_empty()) {
        check_model(m)?;
    }
    if let Some(e) = req.effort.as_deref().filter(|e| !e.is_empty()) {
        if !t.efforts.contains(&e) {
            return Err(err("INVALID_ARGUMENT", format!("{} has no effort level \"{e}\" (use {})", t.id, t.efforts.join(", "))));
        }
    }
    let model = req.model.as_deref().filter(|m| !m.is_empty());
    let effort = req.effort.as_deref().filter(|e| !e.is_empty());
    let system = req.system.as_deref().unwrap_or("");
    let s = |v: &str| v.to_string();
    if t.id == "claude" {
        let mut a: Vec<String> = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--setting-sources", ""].iter().map(|x| s(x)).collect();
        if !system.is_empty() {
            a.extend([s("--system-prompt"), s(system)]);
        }
        if let Some(m) = model {
            a.extend([s("--model"), s(m)]);
        }
        if let Some(e) = effort {
            a.extend([s("--effort"), s(e)]);
        }
        if req.images.is_empty() {
            return Ok((a, req.prompt.clone()));
        }
        // pictures travel in the input message (one JSON line), so the input is read as stream-json
        a.extend([s("--input-format"), s("stream-json")]);
        let mut content: Vec<Value> = req.images.iter().map(|i| json!({"type": "image", "source": {"type": "base64", "media_type": i.mime, "data": i.data}})).collect();
        content.push(json!({"type": "text", "text": req.prompt}));
        let line = json!({"type": "user", "message": {"role": "user", "content": content}});
        return Ok((a, format!("{line}\n")));
    }
    // codex has no system-prompt flag: the instructions lead the text on standard input.
    // each `--image` is followed by an option, because the flag takes every value up to the next one
    let mut a: Vec<String> = vec![s("exec")];
    for f in files {
        a.extend([s("--image"), f.to_string_lossy().into_owned()]);
    }
    a.extend(["--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-C"].iter().map(|x| s(x)));
    a.push(cwd.to_string_lossy().into_owned());
    if let Some(m) = model {
        a.extend([s("-m"), s(m)]);
    }
    if let Some(e) = effort {
        a.extend([s("-c"), format!("model_reasoning_effort=\"{e}\"")]);
    }
    a.push(s("-"));
    let stdin = if system.is_empty() { req.prompt.clone() } else { format!("{system}\n\n---\n\n{}", req.prompt) };
    Ok((a, stdin))
}

fn open(state_dir: &Path, config: impl Fn() -> Result<Option<Value>> + Copy, plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let req: OpenRequest = parse(body)?;
    let t = tool(&req.tool)?;
    if req.prompt.len() > MAX_PROMPT {
        return Err(err("TOO_LARGE", "The question is larger than 2 MiB"));
    }
    let timeout_ms = req.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(1000..=1_800_000).contains(&timeout_ms) {
        return Err(err("INVALID_ARGUMENT", "timeoutMs must be between 1000 and 1800000"));
    }
    network::check_consent(config()?.as_ref(), PURPOSE)?;
    let bin = find_binary(t).ok_or_else(|| err("CLI_NOT_FOUND", format!("{} is not installed on this computer", t.binary)))?;
    let cwd = state_dir.join("ai-cli");
    std::fs::create_dir_all(&cwd).map_err(|e| err("INTERNAL", format!("Could not prepare the work folder: {e}")))?;
    check_images(&req.images)?;
    // codex reads pictures from files; claude gets them in its input, so it needs no folder
    let (folder, files) = if t.id == "codex" && !req.images.is_empty() { write_images(&cwd, &req.images).map(|(d, f)| (Some(d), f))? } else { (None, Vec::new()) };
    let started = build_run(t, &req, &cwd, &files).and_then(|(args, stdin)| start(plugin_id, &bin, &args, stdin, &cwd, Duration::from_millis(timeout_ms), folder.clone()));
    let id = match started {
        Ok(id) => id,
        Err(e) => {
            if let Some(d) = folder {
                let _ = std::fs::remove_dir_all(d);
            }
            return Err(e);
        }
    };
    Ok(serde_json::to_vec(&json!({ "id": id })).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

enum Msg {
    Data(Vec<u8>),
    End,
    Error(String, String),
}

struct Stream {
    plugin: String,
    cancel: Arc<AtomicBool>,
    rx: Mutex<Receiver<Msg>>,
}

static STREAMS: LazyLock<Mutex<HashMap<u64, Arc<Stream>>>> = LazyLock::new(Default::default);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn streams() -> std::sync::MutexGuard<'static, HashMap<u64, Arc<Stream>>> {
    STREAMS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Starts `bin args` (absolute `bin`, no shell), feeds it `stdin`, and registers a stream for it.
/// `cleanup` is a folder deleted when the run ends (the pictures of a codex run).
fn start(plugin_id: &str, bin: &Path, args: &[String], stdin: String, cwd: &Path, limit: Duration, cleanup: Option<PathBuf>) -> Result<u64> {
    if !bin.is_absolute() {
        return Err(err("INVALID_ARGUMENT", "The program must be given by its full path"));
    }
    let (tx, rx) = channel();
    let cancel = Arc::new(AtomicBool::new(false));
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = streams();
        if map.values().filter(|s| s.plugin == plugin_id).count() >= MAX_STREAMS {
            return Err(err("TOO_MANY_STREAMS", format!("At most {MAX_STREAMS} answers can run at once")));
        }
        let mut cmd = Command::new(bin);
        cmd.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        own_group(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| err("CLI_FAILED", format!("Could not start the program: {e}")))?;
        let mut input = child.stdin.take().expect("piped");
        std::thread::spawn(move || {
            // The question goes in on standard input; closing it tells the tool it is complete.
            let _ = input.write_all(stdin.as_bytes());
        });
        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        map.insert(id, Arc::new(Stream { plugin: plugin_id.into(), cancel: cancel.clone(), rx: Mutex::new(rx) }));
        std::thread::spawn(move || {
            supervise(child, stdout, stderr, tx, cancel, limit);
            if let Some(d) = cleanup {
                let _ = std::fs::remove_dir_all(d);
            }
        });
    }
    Ok(id)
}

/// Owns one run: pumps its output, enforces the time limit and the cancel, reports how it ended.
fn supervise(mut child: std::process::Child, stdout: impl Read + Send + 'static, mut stderr: impl Read + Send + 'static, tx: Sender<Msg>, cancel: Arc<AtomicBool>, limit: Duration) {
    let over = Arc::new(AtomicBool::new(false));
    let reader: JoinHandle<()> = {
        let (tx, over) = (tx.clone(), over.clone());
        std::thread::spawn(move || pump(stdout, tx, over))
    };
    let err_text = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.by_ref().take(64 * 1024).read_to_end(&mut buf);
        let text = String::from_utf8_lossy(&buf).into_owned();
        let n = text.chars().count();
        text.chars().skip(n.saturating_sub(STDERR_KEEP)).collect::<String>()
    });
    let start = Instant::now();
    let end = loop {
        if cancel.load(Ordering::Relaxed) {
            over.store(true, Ordering::Relaxed);
            kill_group(&mut child);
            let _ = child.wait();
            break None;
        }
        if over.load(Ordering::Relaxed) {
            kill_group(&mut child);
            let _ = child.wait();
            break Some(Msg::Error("TOO_LARGE".into(), "The answer is larger than 16 MiB".into()));
        }
        if start.elapsed() > limit {
            over.store(true, Ordering::Relaxed);
            kill_group(&mut child);
            let _ = child.wait();
            break Some(Msg::Error("NETWORK_TIMEOUT".into(), "The program did not finish in time".into()));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break Some(if status.success() { Msg::End } else { Msg::Error("CLI_FAILED".into(), String::new()) });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => break Some(Msg::Error("CLI_FAILED".into(), e.to_string())),
        }
    };
    let _ = reader.join();
    let stderr_text = err_text.join().unwrap_or_default();
    match end {
        Some(Msg::Error(code, message)) if code == "CLI_FAILED" && message.is_empty() => {
            let _ = tx.send(Msg::Error(code, if stderr_text.trim().is_empty() { "The program stopped with an error".into() } else { stderr_text.trim().to_string() }));
        }
        Some(m) => {
            let _ = tx.send(m);
        }
        None => {}
    }
}

fn pump(mut reader: impl Read, tx: Sender<Msg>, over: Arc<AtomicBool>) {
    let mut buf = vec![0u8; CHUNK];
    let mut total = 0usize;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => return,
            Ok(n) => {
                total += n;
                if total > MAX_OUTPUT {
                    over.store(true, Ordering::Relaxed);
                    return;
                }
                if tx.send(Msg::Data(buf[..n].to_vec())).is_err() {
                    return;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

#[derive(Deserialize)]
struct IdBody {
    id: u64,
}

fn lookup(plugin_id: &str, id: u64) -> Result<Arc<Stream>> {
    streams().get(&id).filter(|s| s.plugin == plugin_id).cloned().ok_or_else(|| err("NOT_FOUND", "No such running answer"))
}

fn read(plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let id = parse::<IdBody>(body)?.id;
    let stream = lookup(plugin_id, id)?;
    let msg = stream.rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(READ_WAIT);
    let finish = || {
        streams().remove(&id);
    };
    Ok(match msg {
        Ok(Msg::Data(d)) => [&[TAG_DATA][..], &d].concat(),
        Ok(Msg::End) | Err(RecvTimeoutError::Disconnected) => {
            finish();
            vec![TAG_END]
        }
        Ok(Msg::Error(code, message)) => {
            finish();
            [&[TAG_ERROR][..], &serde_json::to_vec(&json!({ "code": code, "message": message })).unwrap_or_default()].concat()
        }
        Err(RecvTimeoutError::Timeout) => vec![TAG_WAIT],
    })
}

fn close(plugin_id: &str, body: &[u8]) -> Result<Vec<u8>> {
    let id = parse::<IdBody>(body)?.id;
    if let Ok(stream) = lookup(plugin_id, id) {
        stream.cancel.store(true, Ordering::Relaxed);
        streams().remove(&id);
    }
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    /// Reads a stream to its end: the bytes, and the error code if it failed.
    fn drain(plugin: &str, id: u64) -> (Vec<u8>, Option<(String, String)>) {
        let mut out = Vec::new();
        for _ in 0..200 {
            let r = read(plugin, format!("{{\"id\":{id}}}").as_bytes()).unwrap();
            match r[0] {
                TAG_DATA => out.extend_from_slice(&r[1..]),
                TAG_END => return (out, None),
                TAG_ERROR => {
                    let v: Value = serde_json::from_slice(&r[1..]).unwrap();
                    return (out, Some((v["code"].as_str().unwrap().into(), v["message"].as_str().unwrap().into())));
                }
                _ => {}
            }
        }
        panic!("stream did not end");
    }

    fn run(plugin: &str, bin: &Path, args: &[&str], stdin: &str, limit: Duration) -> Result<u64> {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        start(plugin, bin, &args, stdin.into(), std::env::temp_dir().as_path(), limit, None)
    }

    #[test]
    fn a_relative_program_is_never_run() {
        let e = run("t-cli-rel", Path::new("claude"), &[], "", Duration::from_secs(5)).unwrap_err();
        assert_eq!(e.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn the_question_arrives_on_standard_input_and_arguments_are_not_parsed() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "echoer", r#"printf 'args:'; for a in "$@"; do printf '[%s]' "$a"; done; printf '\nstdin:'; cat"#);
        let evil = "$(touch pwned); `touch pwned2`; & | > x";
        let id = run("t-cli-args", &bin, &[evil, "two words"], "the question\nline two", Duration::from_secs(10)).unwrap();
        let (out, err) = drain("t-cli-args", id);
        assert!(err.is_none(), "{err:?}");
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains(&format!("[{evil}][two words]")), "{text}");
        assert!(text.contains("stdin:the question\nline two"), "{text}");
        assert!(!d.path().join("pwned").exists() && !std::env::temp_dir().join("pwned").exists());
    }

    #[test]
    fn a_failing_program_reports_what_it_said() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "fail", "echo 'please log in' >&2; exit 3");
        let id = run("t-cli-fail", &bin, &[], "", Duration::from_secs(10)).unwrap();
        let (_, e) = drain("t-cli-fail", id);
        let (code, msg) = e.expect("an error");
        assert_eq!(code, "CLI_FAILED");
        assert!(msg.contains("please log in"), "{msg}");
    }

    #[test]
    fn the_time_limit_kills_the_program_and_what_it_started() {
        let d = tempfile::tempdir().unwrap();
        let marker = d.path().join("alive");
        let bin = script(d.path(), "slow", &format!("(sleep 3; touch {}) &\nsleep 30", marker.display()));
        let t = Instant::now();
        let id = run("t-cli-time", &bin, &[], "", Duration::from_millis(400)).unwrap();
        let (_, e) = drain("t-cli-time", id);
        assert_eq!(e.expect("an error").0, "NETWORK_TIMEOUT");
        assert!(t.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(3500));
        assert!(!marker.exists(), "the child of the program survived the kill");
    }

    #[test]
    fn closing_kills_the_program() {
        let d = tempfile::tempdir().unwrap();
        let marker = d.path().join("done");
        let bin = script(d.path(), "slow2", &format!("echo hi; sleep 2; touch {}", marker.display()));
        let id = run("t-cli-close", &bin, &[], "", Duration::from_secs(30)).unwrap();
        close("t-cli-close", format!("{{\"id\":{id}}}").as_bytes()).unwrap();
        assert_eq!(read("t-cli-close", format!("{{\"id\":{id}}}").as_bytes()).unwrap_err().code, "NOT_FOUND");
        std::thread::sleep(Duration::from_millis(2600));
        assert!(!marker.exists(), "the program kept running after Stop");
    }

    #[test]
    fn another_plugin_cannot_read_a_run() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "hi", "echo hi");
        let id = run("t-cli-own", &bin, &[], "", Duration::from_secs(10)).unwrap();
        assert_eq!(read("t-cli-other", format!("{{\"id\":{id}}}").as_bytes()).unwrap_err().code, "NOT_FOUND");
        drain("t-cli-own", id);
    }

    #[test]
    fn only_listed_tools_and_plain_options_are_accepted() {
        let d = Path::new("/tmp/w");
        let req = |tool: &str, model: Option<&str>, effort: Option<&str>| OpenRequest { tool: tool.into(), model: model.map(Into::into), effort: effort.map(Into::into), system: Some("sys".into()), prompt: "hi".into(), timeout_ms: None, images: Vec::new() };
        assert!(self::tool("rm").is_err());
        let claude = self::tool("claude").unwrap();
        let (a, stdin) = build_run(claude, &req("claude", Some("opus"), Some("high")), d, &[]).unwrap();
        assert_eq!(stdin, "hi");
        let at = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
        assert_eq!(at("--model").as_deref(), Some("opus"));
        assert_eq!(at("--effort").as_deref(), Some("high"));
        assert_eq!(at("--system-prompt").as_deref(), Some("sys"));
        assert_eq!(at("--tools").as_deref(), Some(""), "the tool's own tools are off");
        assert!(a.iter().any(|x| x == "--no-session-persistence"));
        assert!(build_run(claude, &req("claude", Some("--dangerous"), None), d, &[]).is_err());
        assert!(build_run(claude, &req("claude", Some("a b"), None), d, &[]).is_err());
        assert!(build_run(claude, &req("claude", None, Some("ludicrous")), d, &[]).is_err());
        let codex = self::tool("codex").unwrap();
        let (a, stdin) = build_run(codex, &req("codex", Some("gpt-5"), Some("low")), d, &[]).unwrap();
        assert!(stdin.starts_with("sys") && stdin.ends_with("hi"));
        assert_eq!(a.last().unwrap(), "-");
        assert!(a.contains(&"model_reasoning_effort=\"low\"".to_string()));
        assert!(a.windows(2).any(|w| w == ["-s", "read-only"]));
        assert!(build_run(codex, &req("codex", None, Some("max")), d, &[]).is_err(), "codex has no max level");
    }

    #[test]
    fn the_binary_is_found_by_absolute_path_only() {
        let d = tempfile::tempdir().unwrap();
        let bin = script(d.path(), "claude", "true");
        let plain = d.path().join("notexec");
        std::fs::write(&plain, "x").unwrap();
        assert_eq!(find_in("claude", &[PathBuf::from("relative/dir"), d.path().to_path_buf()]), Some(bin));
        assert_eq!(find_in("claude", &[PathBuf::from(".")]), None, "a relative entry is skipped");
        assert_eq!(find_in("notexec", &[d.path().to_path_buf()]), None, "not executable");
        assert!(usual_dirs(Some(Path::new("/Users/x"))).contains(&PathBuf::from("/Users/x/.local/bin")));
    }

    #[test]
    fn detection_reads_the_login_state() {
        let d = tempfile::tempdir().unwrap();
        let out = script(d.path(), "claude", r#"echo '{"loggedIn": false}'"#);
        let inn = script(d.path(), "claude2", r#"echo '{"loggedIn": true, "authMethod": "claude.ai"}'"#);
        let t = tool("claude").unwrap();
        assert_eq!(detect_one(t, Some(out), true)["state"], "login");
        assert_eq!(detect_one(t, Some(inn.clone()), true)["state"], "ready");
        assert_eq!(detect_one(t, Some(inn), false)["state"], "found");
        assert_eq!(detect_one(t, None, true)["state"], "missing");
        let codex = script(d.path(), "codex", "echo 'Not logged in' >&2; exit 1");
        assert_eq!(detect_one(tool("codex").unwrap(), Some(codex), true)["state"], "login");
    }

    #[test]
    fn offline_mode_stops_a_run_before_anything_starts() {
        let d = tempfile::tempdir().unwrap();
        let off = || Ok(Some(json!({"network": {"offline": true}})));
        let e = call(d.path(), off, "t-cli-off", "cli.open", br#"{"tool":"claude","prompt":"hi"}"#).unwrap_err();
        assert_eq!(e.code, "NETWORK_DISABLED");
        let no_ai = || Ok(Some(json!({"network": {"allow_ai": false}})));
        assert!(call(d.path(), no_ai, "t-cli-off", "cli.open", br#"{"tool":"claude","prompt":"hi"}"#).is_err());
        assert_eq!(call(d.path(), off, "t-cli-off", "cli.nope", b"{}").unwrap_err().code, "NOT_FOUND");
    }

    fn picture(mime: &str, data: &str) -> ImageIn {
        ImageIn { mime: mime.into(), data: data.into() }
    }

    fn image_req(tool: &str, images: Vec<ImageIn>) -> OpenRequest {
        OpenRequest { tool: tool.into(), model: None, effort: None, system: Some("sys".into()), prompt: "what is this".into(), timeout_ms: None, images }
    }

    #[test]
    fn base64_is_decoded_and_bad_text_is_refused() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8").unwrap(), b"hello", "padding is optional");
        assert_eq!(decode_base64("").unwrap(), b"");
        assert!(decode_base64("a").is_none(), "one leftover character cannot be base64");
        assert!(decode_base64("aGVs bG8=").is_none(), "a space is not base64");
        assert!(decode_base64("aGVs\nbG8=").is_none());
    }

    #[test]
    fn pictures_are_limited_in_number_type_and_size() {
        let ok = picture("image/png", "aGVsbG8=");
        assert!(check_images(&[ok.clone(), ok.clone(), ok.clone(), ok.clone()]).is_ok());
        assert_eq!(check_images(&vec![ok.clone(); 5]).unwrap_err().code, "INVALID_ARGUMENT");
        assert!(check_images(&[picture("image/svg+xml", "aGVsbG8=")]).is_err());
        assert!(check_images(&[picture("text/html", "aGVsbG8=")]).is_err());
        assert!(check_images(&[picture("image/png", "not base64!!")]).is_err());
        let big = "A".repeat(MAX_IMAGE_BYTES / 3 * 4 + 400);
        assert_eq!(check_images(&[picture("image/png", &big)]).unwrap_err().code, "TOO_LARGE");
    }

    #[test]
    fn claude_gets_pictures_in_its_input_message_and_nothing_on_the_command_line() {
        let claude = self::tool("claude").unwrap();
        let req = image_req("claude", vec![picture("image/png", "aGVsbG8=")]);
        let (a, stdin) = build_run(claude, &req, Path::new("/tmp/w"), &[]).unwrap();
        assert!(a.windows(2).any(|w| w == ["--input-format", "stream-json"]));
        assert!(!a.iter().any(|x| x.contains("aGVsbG8")), "picture data is never an argument");
        let v: Value = serde_json::from_str(stdin.trim_end()).unwrap();
        assert_eq!(v["type"], "user");
        let c = &v["message"]["content"];
        assert_eq!(c[0]["type"], "image");
        assert_eq!(c[0]["source"]["media_type"], "image/png");
        assert_eq!(c[0]["source"]["data"], "aGVsbG8=");
        assert_eq!(c[1]["text"], "what is this");
        assert!(stdin.ends_with('\n'));
        // without pictures nothing changes: plain text on standard input
        let (a, stdin) = build_run(claude, &image_req("claude", vec![]), Path::new("/tmp/w"), &[]).unwrap();
        assert!(!a.iter().any(|x| x == "--input-format"));
        assert_eq!(stdin, "what is this");
    }

    #[test]
    fn codex_gets_pictures_as_files_in_a_folder_that_is_deleted_after_the_run() {
        let d = tempfile::tempdir().unwrap();
        let req = image_req("codex", vec![picture("image/png", "aGVsbG8="), picture("image/jpeg", "d29ybGQ=")]);
        let (folder, files) = write_images(d.path(), &req.images).unwrap();
        assert!(folder.starts_with(d.path()), "the files are inside the work folder");
        assert_eq!(std::fs::read(&files[0]).unwrap(), b"hello");
        assert_eq!(std::fs::read(&files[1]).unwrap(), b"world");
        assert!(files[1].to_string_lossy().ends_with("image-2.jpg"));
        let (a, stdin) = build_run(self::tool("codex").unwrap(), &req, d.path(), &files).unwrap();
        assert_eq!(a.iter().filter(|x| *x == "--image").count(), 2);
        let last_image = a.iter().rposition(|x| x == "--image").unwrap();
        assert!(a[last_image + 2].starts_with("--"), "an option follows the last picture, so `-` stays the prompt");
        assert_eq!(a.last().unwrap(), "-");
        assert!(!stdin.contains("aGVsbG8"));
        // the folder goes away when the run ends
        let bin = script(d.path(), "quick", "cat >/dev/null");
        let args: Vec<String> = Vec::new();
        let id = start("t-cli-img", &bin, &args, String::new(), d.path(), Duration::from_secs(10), Some(folder.clone())).unwrap();
        let (_, err) = drain("t-cli-img", id);
        assert!(err.is_none(), "{err:?}");
        for _ in 0..100 {
            if !folder.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!folder.exists(), "the pictures are deleted when the run ends");
    }

    #[test]
    fn a_bad_picture_stops_the_run_before_anything_starts() {
        let d = tempfile::tempdir().unwrap();
        let on = || Ok(None);
        let body = br#"{"tool":"codex","prompt":"hi","images":[{"mime":"image/svg+xml","data":"aGk="}]}"#;
        assert_eq!(call(d.path(), on, "t-cli-badimg", "cli.open", body).unwrap_err().code, "INVALID_ARGUMENT");
        let nested = br#"{"tool":"codex","prompt":"hi","images":[{"mime":"image/png","data":"aGk=","path":"/etc/passwd"}]}"#;
        assert!(call(d.path(), on, "t-cli-badimg", "cli.open", nested).is_err(), "a picture has only a type and data");
    }
}
