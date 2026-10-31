//! Export into a folder (F31 and the multi-select export, F13): the user picks
//! a folder once, then the page sends each rendered image with a path relative
//! to it. The page never names a path outside that folder: it holds only an
//! opaque token, and every relative path is checked like a vault path.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::Serialize;

use crate::{clipboard, err, ioerr, random_id, validate_relative, write_atomic, write_atomic_new, Result};

/// Bytes of one exported image (a PNG of a huge drawing can be large).
const MAX_IMAGE_BYTES: u64 = 256 * 1024 * 1024;

fn chosen() -> &'static Mutex<HashMap<String, PathBuf>> {
    static CHOSEN: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    CHOSEN.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    token: String,
    /// The folder's path, to show the user where the files went.
    path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// "written" or "skipped" (a file was there and the rule is skip).
    status: &'static str,
    /// Where it went, relative to the chosen folder (a number added with keep_both).
    path: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Existing {
    KeepBoth,
    Replace,
    Skip,
}

impl Existing {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "keep_both" => Ok(Self::KeepBoth),
            "replace" => Ok(Self::Replace),
            "skip" => Ok(Self::Skip),
            _ => Err(err("INVALID_ARGUMENT", "existing is keep_both, replace or skip")),
        }
    }
}

fn pick_dir() -> Option<PathBuf> {
    // Trial and smoke builds answer the dialog from the environment.
    #[cfg(feature = "smoke-test")]
    if let Some(p) = std::env::var_os("VAULTDRAW_TRIAL_EXPORT").filter(|p| !p.is_empty()) {
        return Some(p.into());
    }
    rfd::FileDialog::new().set_title("Export to folder").pick_folder()
}

/// Asks for a folder with the native dialog. None = cancelled.
#[tauri::command]
pub async fn export_folder_pick() -> Result<Option<PickedFolder>> {
    let picked = tauri::async_runtime::spawn_blocking(pick_dir)
        .await
        .map_err(|e| err("INTERNAL", e.to_string()))?;
    let Some(dir) = picked else { return Ok(None) };
    let dir = dir.canonicalize().map_err(ioerr)?;
    if !dir.is_dir() {
        return Err(err("INVALID_PATH", "Not a folder"));
    }
    let token = random_id();
    let path = dir.to_string_lossy().into_owned();
    chosen().lock().map_err(|_| err("INTERNAL", "lock"))?.insert(token.clone(), dir);
    Ok(Some(PickedFolder { token, path }))
}

/// Forgets a picked folder (the export finished or was cancelled).
#[tauri::command]
pub async fn export_folder_release(token: String) -> Result<()> {
    chosen().lock().map_err(|_| err("INTERNAL", "lock"))?.remove(&token);
    Ok(())
}

/// Writes one image: headers `x-export-token`, `x-file-name` (relative path,
/// percent-encoded), `x-existing` (keep_both | replace | skip); raw body.
#[tauri::command]
pub async fn export_folder_write(request: tauri::ipc::Request<'_>) -> Result<WriteResult> {
    let token = clipboard::header(&request, "x-export-token")?;
    let rel = clipboard::percent_decode(&clipboard::header(&request, "x-file-name")?)?;
    let existing = Existing::parse(&clipboard::header(&request, "x-existing")?)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if !bytes.is_empty() => bytes.as_slice(),
        _ => return Err(err("INVALID_ARGUMENT", "Expected a non-empty raw binary body")),
    };
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(err("INVALID_FILE", "Export exceeds 256 MiB"));
    }
    let root = chosen()
        .lock()
        .map_err(|_| err("INTERNAL", "lock"))?
        .get(&token)
        .cloned()
        .ok_or_else(|| err("NOT_FOUND", "Choose the export folder again"))?;
    write_into(&root, &rel, bytes, existing)
}

/// Writes `bytes` at `rel` inside `root`, creating subfolders. Pure over the
/// file system so the rules are tested without a dialog.
pub fn write_into(root: &Path, rel: &str, bytes: &[u8], existing: Existing) -> Result<WriteResult> {
    let parts = validate_relative(rel)?;
    let Some((name, dirs)) = parts.split_last() else {
        return Err(err("INVALID_PATH", "Missing file name"));
    };
    // One folder at a time, each checked before anything is made inside it,
    // so a symbolic link never leads a write (or a new folder) outside root.
    let mut real = root.to_path_buf();
    for part in dirs {
        let next = real.join(part);
        if !next.exists() {
            std::fs::create_dir(&next).map_err(ioerr)?;
        }
        real = next.canonicalize().map_err(ioerr)?;
        if !real.starts_with(root) || !real.is_dir() {
            return Err(err("INVALID_PATH", "Path leaves the export folder"));
        }
    }
    let rel_dir = dirs.join("/");
    let join = |file: &str| if rel_dir.is_empty() { file.to_string() } else { format!("{rel_dir}/{file}") };
    let target = real.join(name);
    if !target.exists() {
        write_atomic_new(&target, bytes)?;
        return Ok(WriteResult { status: "written", path: join(name) });
    }
    match existing {
        Existing::Skip => Ok(WriteResult { status: "skipped", path: join(name) }),
        Existing::Replace => {
            if target.is_dir() {
                return Err(err("NAME_COLLISION", "A folder has that name"));
            }
            write_atomic(&target, bytes)?;
            Ok(WriteResult { status: "written", path: join(name) })
        }
        Existing::KeepBoth => {
            let (stem, ext) = split_ext(name);
            for n in 2..10_000 {
                let candidate = format!("{stem} {n}{ext}");
                let path = real.join(&candidate);
                if !path.exists() {
                    write_atomic_new(&path, bytes)?;
                    return Ok(WriteResult { status: "written", path: join(&candidate) });
                }
            }
            Err(err("NAME_COLLISION", "Too many files with that name"))
        }
    }
}

/// "Plan.png" -> ("Plan", ".png"); "Plan" -> ("Plan", "").
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vd-export-folder-{}", random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn writes_new_files_and_subfolders() {
        let root = temp_root();
        let r = write_into(&root, "Plan.png", b"a", Existing::KeepBoth).unwrap();
        assert_eq!(r, WriteResult { status: "written", path: "Plan.png".into() });
        let r = write_into(&root, "Sub/Deep/Plan.svg", b"b", Existing::KeepBoth).unwrap();
        assert_eq!(r.path, "Sub/Deep/Plan.svg");
        assert_eq!(std::fs::read(root.join("Sub/Deep/Plan.svg")).unwrap(), b"b");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_file_rules() {
        let root = temp_root();
        write_into(&root, "Plan.png", b"old", Existing::KeepBoth).unwrap();
        let kept = write_into(&root, "Plan.png", b"new", Existing::KeepBoth).unwrap();
        assert_eq!(kept.path, "Plan 2.png");
        assert_eq!(std::fs::read(root.join("Plan.png")).unwrap(), b"old");
        let skipped = write_into(&root, "Plan.png", b"x", Existing::Skip).unwrap();
        assert_eq!(skipped.status, "skipped");
        assert_eq!(std::fs::read(root.join("Plan.png")).unwrap(), b"old");
        write_into(&root, "Plan.png", b"new", Existing::Replace).unwrap();
        assert_eq!(std::fs::read(root.join("Plan.png")).unwrap(), b"new");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_paths_outside_the_folder() {
        let root = temp_root();
        for bad in ["../x.png", "/etc/x.png", "a/../../x.png", "a\\b.png", "", "a//b.png"] {
            assert!(write_into(&root, bad, b"x", Existing::Replace).is_err(), "{bad}");
        }
        #[cfg(unix)]
        {
            let outside = temp_root();
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            assert!(write_into(&root, "link/x.png", b"x", Existing::Replace).is_err());
            assert!(write_into(&root, "link/sub/x.png", b"x", Existing::Replace).is_err());
            assert!(!outside.join("x.png").exists());
            assert!(!outside.join("sub").exists(), "no folder made outside");
            std::fs::remove_dir_all(outside).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    /// The case table the browser fake answers too (testing.md: twins share one table).
    #[test]
    fn contract_cases() {
        let table: serde_json::Value =
            serde_json::from_str(include_str!("../crates/vaultdraw-core/src/contract/export_folder_cases.json")).unwrap();
        for case in table["writes"].as_array().unwrap() {
            let root = temp_root();
            for present in case["present"].as_array().unwrap() {
                let p = root.join(present.as_str().unwrap());
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, b"old").unwrap();
            }
            let rule = Existing::parse(case["existing"].as_str().unwrap()).unwrap();
            let got = write_into(&root, case["write"].as_str().unwrap(), b"new", rule).unwrap();
            assert_eq!(got.status, case["status"].as_str().unwrap(), "{case}");
            assert_eq!(got.path, case["path"].as_str().unwrap(), "{case}");
            std::fs::remove_dir_all(root).unwrap();
        }
        let root = temp_root();
        for bad in table["invalid"].as_array().unwrap() {
            assert!(write_into(&root, bad.as_str().unwrap(), b"x", Existing::Replace).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_existing_rule() {
        assert_eq!(Existing::parse("skip").unwrap(), Existing::Skip);
        assert!(Existing::parse("overwrite").is_err());
    }
}
