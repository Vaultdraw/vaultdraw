# Plugin API change log

The history of `@vaultdraw/api` (the types), the manifest and the `vaultdraw-plugin` tool. The API follows [semantic versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0 on; [stability.md](../docs/stability.md) says what that promises. The app's own change log is `CHANGELOG.md` at the repository root.

## 1.6.0

### Added

- **Render a picture** (`@experimental`): `ctx.scene.renderPng({ ids?, box?, maxSide?, padding? })` draws the open drawing, some elements (with the text bound to them) or the elements touching a box to a PNG data URL, at most `maxSide` pixels on the longest side (64 to 2048, default 768, never enlarged), in light colours whatever the theme. It resolves `{ dataUrl, width, height }`. It only reads, so it needs no permission. It rejects with `NOT_FOUND` when no drawing is open or nothing matches, and `INVALID_ARGUMENT` for a bad option.

## 1.5.0

### Added

- **Drawing settings** (`@experimental`): `ctx.scene.batch(ops, { drawing })` changes the drawing's own settings in the same undo step as the ops (the ops list may be empty): `pageMode`, `paper` (`plain`, `lines`, `grid`, `dots`, `graph`, `isometric`), `paperTheme`, `pageSize`, `orientation`, `layout` and `background`. A field left out stays as it is; a bad value rejects with `INVALID_ARGUMENT` before anything changes. `ctx.scene.drawing()` reads the current settings (null with no drawing open). Needs the same permission as `batch` (none for a plugin acting on the open drawing).

## 1.4.0

### Added

- **`ctx.cli`** (permission `cli`, `@experimental`): `detect()` finds the AI command lines the user already has (Claude Code, Codex) and, with `check`, whether each is logged in; `run(...)` asks one and streams its output. The plugin names the tool; the app builds the command (absolute path, no shell, the question on standard input, a time limit, killed on `signal`). Offline mode and `network.allow_ai = false` refuse it. The tool keeps its own login; the app never reads or stores it.
- `CliRequest.images`: up to 4 pictures (5 MiB each) go with the question; the app puts them in the run's own empty folder for Codex and in the message for Claude Code, and deletes them when the run ends.
- Error codes `CLI_NOT_FOUND` and `CLI_FAILED`. The permission `cli` counts as a write permission: an update that adds it asks the user again.

## 1.3.0

### Added

- **`ctx.vault.readNote(path)`**: the text and revision of a Markdown note, read only. Needs `vault.read`. The path rules are those of drawings, with `.md` instead of `.excalidraw` (never `.excalidraw.md`, no dot folders). Files over 16 MiB and files that are not UTF-8 text are refused.
- **`ctx.workspace.activeNotePath()`**: the path of the note shown in the active tab, or `null`. Free.

## 1.1.0

An addition for the official AI assistant plugin. Nothing a 1.0 plugin uses changes.

### Added

- **`ctx.net`** (permission `net`, `@experimental`): `request(...)` sends a request from the app, not the page (the page's content policy allows no `fetch`) and streams the answer. https only, or http to this computer; no private address; no redirects; Offline mode blocks other computers and still allows this computer. `auth` adds a stored secret as a header, so the page never holds it.
- **`ctx.secret`** (permission `secret`, `@experimental`): `set`, `has`, `delete` for secrets such as API keys. There is no read-back.
- Errors of `ctx.net` carry the codes listed on its members (`NETWORK_DISABLED`, `NETWORK_TIMEOUT`, `PRIVATE_ADDRESS`, `SECRET_MISSING`, `ABORTED` and others); the `PluginErrorCode` type is unchanged.
- The permission names `net` and `secret` are no longer reserved.

## 1.3.0

### Added

- **`PluginErrorCode` lists every code a call can reject with.** New: `INTERNAL` (something failed inside the app, not in the call) and the `ctx.net` codes `ABORTED`, `INVALID_URL`, `NETWORK_DISABLED`, `NETWORK_TIMEOUT`, `PRIVATE_ADDRESS`, `SECRET_MISSING` and `TOO_MANY_STREAMS`. The app already sent them; the type now says so. A `switch (e.code)` with a default branch keeps working; one without it can now handle these codes by name.
- **`MenuContribution.when`**: context keys that must all hold for a menu item to be listed (`!key` negates), as in a command's `when`. Absent or empty: always listed.

## 1.2.0

### Added

- **`ctx.text.fold(text)`** (`@experimental`, since 1.2.0): folds text the way the app's search does (lower case, accents and look-alikes removed, `ß` to `ss`). A plugin that filters names compares folded strings instead of copying the fold. The official graph plugin uses it. Needs `min_api = "1.2.0"`.

## 1.0.0

The API is frozen after an audit of every exported name (the audit is in the project notes; its table has 250 type members, 13 manifest keys, 7 permissions, 6 events and 6 commands, none removed).

### Changed

- **API level 1.** `ctx.host.api.level` is `1` and `plugin.toml` says `api = 1`. A manifest with `api = 0` still loads, with a warning in the plugin log and in `vaultdraw-plugin check` (`api-deprecated`), until API 2.0.
- `MethodsApi.register(name, …)` is `register(id, …)`. Types only.
- The note parse stand-in used by the mock host and the browser test host now shares the app's tag grammar and `alt|size` parser (`#fff` is a tag, `#ff00aa` is not; `![[a.png|caption|300x200]]` keeps alt and both sizes), so plugin tests see what the app sees.

### Added

- **`min_api`** in `plugin.toml`: the oldest API revision the plugin needs, such as `"1.2.0"`. An app with an older revision refuses the plugin and says why in the plugin list. `vaultdraw-plugin check` reports `min-api-invalid`.
- **`PluginApiError` and `PluginErrorCode`**: the error the API throws and the codes it uses are now public types.
- **`@experimental`**: `ctx.thumbnails`, `ctx.vault.graph` and `ctx.vault.table` are outside the promise and may change in a minor release.
- The surface guard: `sdk/api/etc/api-surface.d.ts` is pinned by a test that needs a version bump to change.

### Deprecated (removed in 2.0)

- `ToastOptions.action`: use `actions`. The plugin log warns once per plugin.
- `PluginManifestInfo.dir`: an internal path.
- `api = 0` in `plugin.toml`: use `api = 1`.

## 0.37.0 and earlier

API 0.x was experimental. Each revision is listed under "Plugin API" in the app's [CHANGELOG](../../CHANGELOG.md).
