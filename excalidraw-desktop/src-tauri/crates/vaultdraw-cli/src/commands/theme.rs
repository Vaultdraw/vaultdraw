//! Theme commands: install from a web address through the running app's installer.

use super::request;
use crate::cli::{Cli, ThemeAction};
use crate::error::Fail;
use serde_json::{json, Map, Value};
use vaultdraw_protocol::methods;

pub fn run(cli: &Cli, action: &ThemeAction) -> Result<(), Fail> {
    match action {
        ThemeAction::Install { url, theme, replace } => {
            let mut params = Map::new();
            params.insert("url".into(), json!(url));
            if let Some(t) = theme {
                params.insert("theme".into(), json!(t));
            }
            if *replace {
                params.insert("replace".into(), json!(true));
            }
            let human = |v: &Value| format!("installed {}", v.get("name").and_then(Value::as_str).unwrap_or(""));
            request(cli, methods::THEME_INSTALL, Some(Value::Object(params)), human, false)
        }
    }
}
