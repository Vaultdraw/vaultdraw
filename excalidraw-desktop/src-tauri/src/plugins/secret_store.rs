//! Where `ctx.secret` keeps a plugin's keys: the system keychain (macOS Keychain, the Secret
//! Service on Linux through `secret-tool`) or the protected file in the state folder.
//!
//! `[secrets] store` in `config.toml`: `auto` (default: the keychain, and the file only when the
//! keychain cannot be used), `keychain` (never the file; an unusable keychain is an error) or
//! `file` (never the keychain). One keychain item per plugin holds all of its keys as JSON, so
//! "Delete data" is one delete and a save is one write.
//!
//! Moving from the file to the keychain loses nothing: the file's keys are written to the
//! keychain, read back and compared, and only then is the file removed. A key is never logged and
//! never part of an error message.
use super::net::{file_load, file_remove, file_save, secrets_path};
use crate::{err, Result};
use serde_json::{Map, Value};
use std::path::Path;

/// What a keychain says when a call fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeychainError {
    /// No keychain on this system, or it cannot be reached (locked, no desktop session).
    Unavailable(String),
    /// The user (or the system) refused access.
    Refused(String),
}

/// One secret per account, in the system keychain. Values are plain text.
pub(crate) trait KeyStore {
    fn get(&self, account: &str) -> std::result::Result<Option<String>, KeychainError>;
    fn set(&self, account: &str, value: &str) -> std::result::Result<(), KeychainError>;
    fn delete(&self, account: &str) -> std::result::Result<(), KeychainError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Auto,
    Keychain,
    File,
}

/// `secrets.store` of the parsed config; anything else reads as `auto`.
pub(crate) fn mode_of(config: Option<&Value>) -> Mode {
    match config.and_then(|c| c.get("secrets")?.get("store")?.as_str()) {
        Some("keychain") => Mode::Keychain,
        Some("file") => Mode::File,
        _ => Mode::Auto,
    }
}

const SERVICE: &str = "app.vaultdraw.plugin-secrets";

fn explain(e: &KeychainError) -> String {
    let (what, why) = match e {
        KeychainError::Unavailable(m) => ("The system keychain cannot be used", m),
        KeychainError::Refused(m) => ("The system keychain refused access", m),
    };
    format!("{what} ({why}). To keep keys in a protected file instead, set store = \"file\" under [secrets] in config.toml")
}

fn keychain_error(e: &KeychainError) -> crate::NativeError {
    err("KEYCHAIN_UNAVAILABLE", explain(e))
}

fn to_map(text: &str) -> Map<String, Value> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    }
}

/// A plugin's keys, in the place the mode says.
pub(crate) struct Store<'a> {
    state_dir: &'a Path,
    plugin_id: &'a str,
    mode: Mode,
    keychain: Option<&'a dyn KeyStore>,
}

impl<'a> Store<'a> {
    pub(crate) fn new(state_dir: &'a Path, plugin_id: &'a str, mode: Mode, keychain: Option<&'a dyn KeyStore>) -> Self {
        Store { state_dir, plugin_id, mode, keychain }
    }

    fn file_path(&self) -> Result<std::path::PathBuf> {
        secrets_path(self.state_dir, self.plugin_id)
    }

    /// The keychain to use, or why there is none. `file` mode never uses it.
    fn keychain(&self) -> std::result::Result<&'a dyn KeyStore, KeychainError> {
        match (self.mode, self.keychain) {
            (Mode::File, _) => Err(KeychainError::Unavailable("not used".into())),
            (_, Some(k)) => Ok(k),
            (_, None) => Err(KeychainError::Unavailable("this system has no supported keychain".into())),
        }
    }

    fn kc_load(&self, kc: &dyn KeyStore) -> std::result::Result<Map<String, Value>, KeychainError> {
        Ok(kc.get(self.plugin_id)?.map(|t| to_map(&t)).unwrap_or_default())
    }

    /// Writes `map` to the keychain and reads it back; an empty map deletes the item.
    fn kc_save(&self, kc: &dyn KeyStore, map: &Map<String, Value>) -> std::result::Result<(), KeychainError> {
        if map.is_empty() {
            return kc.delete(self.plugin_id);
        }
        let text = serde_json::to_string(map).map_err(|_| KeychainError::Unavailable("keys could not be encoded".into()))?;
        kc.set(self.plugin_id, &text)?;
        let back = self.kc_load(kc)?;
        if &back != map {
            return Err(KeychainError::Unavailable("the keychain did not return what was saved".into()));
        }
        Ok(())
    }

    /// The keys. In `keychain` and `auto` mode a key file from before is moved to the keychain
    /// first (verified, then the file goes); if that cannot be done the file's keys are used
    /// as they are (`auto`) or an error says why (`keychain`).
    pub(crate) fn load(&self) -> Result<Map<String, Value>> {
        let path = self.file_path()?;
        if self.mode == Mode::File {
            return Ok(file_load(&path));
        }
        let from_file = file_load(&path);
        let kc = match self.keychain() {
            Ok(kc) => kc,
            Err(e) => return self.fall_back(e, from_file),
        };
        let in_keychain = match self.kc_load(kc) {
            Ok(m) => m,
            Err(e) => return self.fall_back(e, from_file),
        };
        if from_file.is_empty() {
            return Ok(in_keychain);
        }
        // Migrate: the keychain's keys win over the file's.
        let mut merged = from_file;
        merged.extend(in_keychain);
        match self.kc_save(kc, &merged) {
            Ok(()) => {
                file_remove(&path)?;
                Ok(merged)
            }
            Err(e) => self.fall_back(e, merged),
        }
    }

    fn fall_back(&self, e: KeychainError, file_keys: Map<String, Value>) -> Result<Map<String, Value>> {
        if self.mode == Mode::Auto {
            Ok(file_keys)
        } else {
            Err(keychain_error(&e))
        }
    }

    /// Saves the keys: to the keychain, or in `auto` mode to the file when the keychain fails.
    pub(crate) fn save(&self, map: &Map<String, Value>) -> Result<()> {
        let path = self.file_path()?;
        if self.mode == Mode::File {
            return file_save(&path, map);
        }
        match self.keychain().and_then(|kc| self.kc_save(kc, map)) {
            Ok(()) => file_remove(&path),
            Err(e) if self.mode == Mode::Auto => {
                let _ = e;
                file_save(&path, map)
            }
            Err(e) => Err(keychain_error(&e)),
        }
    }

    /// Removes every key of the plugin, from the file and from the keychain.
    pub(crate) fn forget(&self) -> Result<()> {
        file_remove(&self.file_path()?)?;
        if self.mode == Mode::File {
            return Ok(());
        }
        match self.keychain().and_then(|kc| kc.delete(self.plugin_id)) {
            Ok(()) => Ok(()),
            // No keychain on this system: nothing was ever stored there.
            Err(KeychainError::Unavailable(_)) if self.mode == Mode::Auto => Ok(()),
            Err(e) => Err(keychain_error(&e)),
        }
    }
}

// ---------------------------------------------------------------------------
// The real keychains
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod os {
    use super::{KeyStore, KeychainError, SERVICE};
    use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

    pub(super) struct Keychain;

    const NOT_FOUND: i32 = -25300; // errSecItemNotFound
    const USER_CANCELED: i32 = -128; // errSecUserCanceled
    const AUTH_FAILED: i32 = -25293; // errSecAuthFailed
    const NO_INTERACTION: i32 = -25308; // errSecInteractionNotAllowed

    fn classify(e: &security_framework::base::Error) -> KeychainError {
        match e.code() {
            USER_CANCELED | AUTH_FAILED => KeychainError::Refused("access was not allowed".into()),
            NO_INTERACTION => KeychainError::Unavailable("the keychain is locked".into()),
            code => KeychainError::Unavailable(format!("Keychain error {code}")),
        }
    }

    impl KeyStore for Keychain {
        fn get(&self, account: &str) -> Result<Option<String>, KeychainError> {
            match get_generic_password(SERVICE, account) {
                Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                Err(e) if e.code() == NOT_FOUND => Ok(None),
                Err(e) => Err(classify(&e)),
            }
        }
        fn set(&self, account: &str, value: &str) -> Result<(), KeychainError> {
            set_generic_password(SERVICE, account, value.as_bytes()).map_err(|e| classify(&e))
        }
        fn delete(&self, account: &str) -> Result<(), KeychainError> {
            match delete_generic_password(SERVICE, account) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == NOT_FOUND => Ok(()),
                Err(e) => Err(classify(&e)),
            }
        }
    }
}

/// The Secret Service (GNOME Keyring, KWallet) through the `secret-tool` command, which takes the
/// secret on standard input, so it never appears in a process list.
#[cfg(target_os = "linux")]
mod os {
    use super::{KeyStore, KeychainError, SERVICE};
    use std::io::Write;
    use std::process::{Command, Stdio};

    pub(super) struct Keychain;

    fn run(args: &[&str], stdin: Option<&str>) -> Result<(bool, String, String), KeychainError> {
        let mut child = Command::new("secret-tool")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    KeychainError::Unavailable("secret-tool is not installed (package libsecret-tools)".into())
                } else {
                    KeychainError::Unavailable("secret-tool could not be started".into())
                }
            })?;
        if let Some(mut pipe) = child.stdin.take() {
            if let Some(text) = stdin {
                let _ = pipe.write_all(text.as_bytes());
            }
        }
        let out = child.wait_with_output().map_err(|_| KeychainError::Unavailable("secret-tool did not finish".into()))?;
        Ok((
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("").to_string(),
        ))
    }

    fn failed(stderr: String) -> KeychainError {
        KeychainError::Unavailable(if stderr.is_empty() { "the Secret Service did not answer".into() } else { stderr })
    }

    impl KeyStore for Keychain {
        fn get(&self, account: &str) -> Result<Option<String>, KeychainError> {
            let (ok, stdout, stderr) = run(&["lookup", "service", SERVICE, "account", account], None)?;
            if ok {
                Ok(Some(stdout))
            } else if stderr.is_empty() {
                Ok(None) // an unknown item exits 1 and says nothing
            } else {
                Err(failed(stderr))
            }
        }
        fn set(&self, account: &str, value: &str) -> Result<(), KeychainError> {
            let (ok, _, stderr) = run(&["store", "--label=Vaultdraw plugin keys", "service", SERVICE, "account", account], Some(value))?;
            if ok { Ok(()) } else { Err(failed(stderr)) }
        }
        fn delete(&self, account: &str) -> Result<(), KeychainError> {
            let (ok, _, stderr) = run(&["clear", "service", SERVICE, "account", account], None)?;
            if ok || stderr.is_empty() { Ok(()) } else { Err(failed(stderr)) }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod os {}

#[cfg(test)]
thread_local! {
    /// Tests pick the keychain: none (the file, as before), or a fake.
    pub(crate) static TEST_KEYCHAIN: std::cell::RefCell<Option<std::rc::Rc<dyn KeyStore>>> = const { std::cell::RefCell::new(None) };
}

/// Runs `f` with the system keychain, or `None` where there is none. Tests never reach the real one.
pub(crate) fn with_os_keychain<T>(f: impl FnOnce(Option<&dyn KeyStore>) -> T) -> T {
    #[cfg(test)]
    {
        let fake = TEST_KEYCHAIN.with(|k| k.borrow().clone());
        f(fake.as_deref())
    }
    #[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
    {
        f(Some(&os::Keychain))
    }
    #[cfg(all(not(test), not(any(target_os = "macos", target_os = "linux"))))]
    {
        f(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{cell::RefCell, collections::HashMap, rc::Rc};

    /// An in-memory keychain that can be made to fail.
    #[derive(Default)]
    struct Fake {
        items: RefCell<HashMap<String, String>>,
        fail: RefCell<Option<KeychainError>>,
        corrupt_reads: RefCell<bool>,
    }

    impl KeyStore for Fake {
        fn get(&self, a: &str) -> std::result::Result<Option<String>, KeychainError> {
            if let Some(e) = self.fail.borrow().clone() {
                return Err(e);
            }
            if *self.corrupt_reads.borrow() {
                return Ok(Some("{}".into()));
            }
            Ok(self.items.borrow().get(a).cloned())
        }
        fn set(&self, a: &str, v: &str) -> std::result::Result<(), KeychainError> {
            if let Some(e) = self.fail.borrow().clone() {
                return Err(e);
            }
            self.items.borrow_mut().insert(a.into(), v.into());
            Ok(())
        }
        fn delete(&self, a: &str) -> std::result::Result<(), KeychainError> {
            if let Some(e) = self.fail.borrow().clone() {
                return Err(e);
            }
            self.items.borrow_mut().remove(a);
            Ok(())
        }
    }

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    fn file_exists(d: &Path, id: &str) -> bool {
        secrets_path(d, id).unwrap().exists()
    }

    #[test]
    fn config_picks_the_mode() {
        assert_eq!(mode_of(None), Mode::Auto);
        assert_eq!(mode_of(Some(&json!({}))), Mode::Auto);
        assert_eq!(mode_of(Some(&json!({"secrets": {"store": "file"}}))), Mode::File);
        assert_eq!(mode_of(Some(&json!({"secrets": {"store": "keychain"}}))), Mode::Keychain);
        assert_eq!(mode_of(Some(&json!({"secrets": {"store": "auto"}}))), Mode::Auto);
        assert_eq!(mode_of(Some(&json!({"secrets": {"store": "nonsense"}}))), Mode::Auto);
        assert_eq!(mode_of(Some(&json!({"secrets": {"store": 3}}))), Mode::Auto);
    }

    #[test]
    fn a_key_goes_to_the_keychain_and_not_to_a_file() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        let s = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc));
        s.save(&map(json!({"api-key": "sk-1"}))).unwrap();
        assert_eq!(s.load().unwrap(), map(json!({"api-key": "sk-1"})));
        assert!(!file_exists(d.path(), "t-p"));
        assert_eq!(kc.items.borrow().len(), 1);
        // another plugin has its own item
        assert!(Store::new(d.path(), "t-q", Mode::Auto, Some(&kc)).load().unwrap().is_empty());
        // deleting the last key removes the item
        s.save(&Map::new()).unwrap();
        assert!(kc.items.borrow().is_empty());
    }

    #[test]
    fn existing_file_keys_move_to_the_keychain_without_loss() {
        let d = tempfile::tempdir().unwrap();
        let old = Store::new(d.path(), "t-p", Mode::File, None);
        old.save(&map(json!({"api-key": "sk-old", "other": "x"}))).unwrap();
        assert!(file_exists(d.path(), "t-p"));
        let kc = Fake::default();
        let s = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc));
        assert_eq!(s.load().unwrap(), map(json!({"api-key": "sk-old", "other": "x"})));
        assert!(!file_exists(d.path(), "t-p"), "the file goes only after the keychain holds the keys");
        let kept: Value = serde_json::from_str(kc.items.borrow().get("t-p").unwrap()).unwrap();
        assert_eq!(kept, json!({"api-key": "sk-old", "other": "x"}));
        // a second load changes nothing
        assert_eq!(s.load().unwrap().len(), 2);
    }

    #[test]
    fn a_failed_migration_keeps_the_file_and_the_keys() {
        for mode in [Mode::Auto, Mode::Keychain] {
            let d = tempfile::tempdir().unwrap();
            Store::new(d.path(), "t-p", Mode::File, None).save(&map(json!({"api-key": "sk-old"}))).unwrap();
            let kc = Fake::default();
            *kc.fail.borrow_mut() = Some(KeychainError::Refused("no".into()));
            let s = Store::new(d.path(), "t-p", mode, Some(&kc));
            let got = s.load();
            if mode == Mode::Auto {
                assert_eq!(got.unwrap(), map(json!({"api-key": "sk-old"})));
            } else {
                assert_eq!(got.unwrap_err().code, "KEYCHAIN_UNAVAILABLE");
            }
            assert!(file_exists(d.path(), "t-p"), "{mode:?}: the file must stay");
        }
    }

    #[test]
    fn a_keychain_that_does_not_return_what_was_saved_keeps_the_file() {
        let d = tempfile::tempdir().unwrap();
        Store::new(d.path(), "t-p", Mode::File, None).save(&map(json!({"api-key": "sk-old"}))).unwrap();
        let kc = Fake::default();
        *kc.corrupt_reads.borrow_mut() = true;
        let got = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc)).load().unwrap();
        assert_eq!(got, map(json!({"api-key": "sk-old"})));
        assert!(file_exists(d.path(), "t-p"));
    }

    #[test]
    fn auto_saves_to_the_file_when_the_keychain_fails_and_keychain_mode_refuses() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        *kc.fail.borrow_mut() = Some(KeychainError::Unavailable("locked".into()));
        Store::new(d.path(), "t-a", Mode::Auto, Some(&kc)).save(&map(json!({"k": "v"}))).unwrap();
        assert!(file_exists(d.path(), "t-a"));
        let e = Store::new(d.path(), "t-b", Mode::Keychain, Some(&kc)).save(&map(json!({"k": "v"}))).unwrap_err();
        assert_eq!(e.code, "KEYCHAIN_UNAVAILABLE");
        assert!(e.message.contains("store = \"file\""));
        assert!(!e.message.contains("\"v\""));
        assert!(!file_exists(d.path(), "t-b"), "keychain mode never writes the file");
        // with no keychain at all (Windows), keychain mode says so and auto uses the file
        assert_eq!(Store::new(d.path(), "t-c", Mode::Keychain, None).load().unwrap_err().code, "KEYCHAIN_UNAVAILABLE");
        Store::new(d.path(), "t-c", Mode::Auto, None).save(&map(json!({"k": "v"}))).unwrap();
        assert!(file_exists(d.path(), "t-c"));
    }

    #[test]
    fn file_mode_never_touches_the_keychain() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        *kc.fail.borrow_mut() = Some(KeychainError::Refused("must not be called".into()));
        let s = Store::new(d.path(), "t-p", Mode::File, Some(&kc));
        s.save(&map(json!({"k": "v"}))).unwrap();
        assert_eq!(s.load().unwrap(), map(json!({"k": "v"})));
        s.forget().unwrap();
        assert!(!file_exists(d.path(), "t-p"));
    }

    #[test]
    fn a_key_saved_to_the_file_while_the_keychain_was_down_moves_later() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        *kc.fail.borrow_mut() = Some(KeychainError::Unavailable("locked".into()));
        let s = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc));
        s.save(&map(json!({"k": "v1"}))).unwrap();
        *kc.fail.borrow_mut() = None;
        assert_eq!(s.load().unwrap(), map(json!({"k": "v1"})));
        assert!(!file_exists(d.path(), "t-p"));
        assert_eq!(kc.items.borrow().len(), 1);
    }

    #[test]
    fn forget_removes_the_file_and_the_keychain_item() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        Store::new(d.path(), "t-p", Mode::File, None).save(&map(json!({"k": "v"}))).unwrap();
        kc.items.borrow_mut().insert("t-p".into(), "{\"k\":\"v\"}".into());
        let s = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc));
        s.forget().unwrap();
        assert!(!file_exists(d.path(), "t-p"));
        assert!(kc.items.borrow().is_empty());
        s.forget().unwrap();
        *kc.fail.borrow_mut() = Some(KeychainError::Refused("no".into()));
        assert_eq!(s.forget().unwrap_err().code, "KEYCHAIN_UNAVAILABLE");
    }

    #[test]
    fn the_keychain_wins_over_a_stale_file_for_the_same_name() {
        let d = tempfile::tempdir().unwrap();
        let kc = Fake::default();
        kc.items.borrow_mut().insert("t-p".into(), "{\"k\":\"new\"}".into());
        Store::new(d.path(), "t-p", Mode::File, None).save(&map(json!({"k": "old", "j": "x"}))).unwrap();
        let got = Store::new(d.path(), "t-p", Mode::Auto, Some(&kc)).load().unwrap();
        assert_eq!(got, map(json!({"k": "new", "j": "x"})));
    }

    /// The real keychain, on the machine that runs it. Not run by default: it writes one item to
    /// the login keychain (or the Secret Service) and removes it again.
    #[test]
    #[ignore]
    fn the_system_keychain_round_trips() {
        with_os_keychain(|kc| {
            let kc = kc.expect("a keychain on this system");
            let account = format!("test-{}", std::process::id());
            assert_eq!(kc.get(&account), Ok(None));
            kc.set(&account, "{\"k\":\"v\"}").unwrap();
            assert_eq!(kc.get(&account), Ok(Some("{\"k\":\"v\"}".into())));
            kc.delete(&account).unwrap();
            assert_eq!(kc.get(&account), Ok(None));
        });
        let _ = Rc::new(0);
    }
}
