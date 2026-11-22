/**
 * Ask an AI command line the user already has on this computer (Claude Code, Codex) and read its
 * answer as it streams. Needs the permission `cli`. The plugin names a tool from a fixed list and
 * the app builds the command: no program path, no argument and no shell text comes from the plugin.
 * The question is sent on standard input, the tool runs in an empty folder of its own with its own
 * tools switched off where it can be, a time limit and `signal` stop it, and Offline mode (and
 * `network.allow_ai = false`) refuse it, because the tools talk to their provider over the internet.
 * The tool keeps its own login: the app never reads or stores it.
 *
 * @experimental
 * @since 1.4.0
 */
export type CliToolId = "claude" | "codex";

/**
 * What `detect` found for one tool: `missing` (not installed), `found` (installed, login not
 * checked), `ready` (installed and logged in) or `login` (installed but not logged in).
 *
 * @experimental
 * @since 1.4.0
 */
export interface CliToolStatus {
  /** @since 1.4.0 */
  id: CliToolId;
  /** The absolute path of the program, or null when it is missing. @since 1.4.0 */
  path: string | null;
  /** @since 1.4.0 */
  state: "missing" | "found" | "ready" | "login";
  /** A short line the tool printed about its login, may be empty. @since 1.4.0 */
  detail: string;
}

/**
 * One question for a tool.
 *
 * @experimental
 * @since 1.4.0
 */
export interface CliRequest {
  /** @since 1.4.0 */
  tool: CliToolId;
  /** The model name the tool knows (letters, digits and `. _ : - [ ]`). Empty: the tool's default. @since 1.4.0 */
  model?: string;
  /** Reasoning level: `low`, `medium`, `high`, `xhigh`, and `max` for claude only. @since 1.4.0 */
  effort?: string;
  /** Instructions that lead the question. @since 1.4.0 */
  system?: string;
  /** The question, at most 2 MiB; sent on standard input. @since 1.4.0 */
  prompt: string;
  /** Total time to wait, 1000 to 1800000 milliseconds (default 300000). @since 1.4.0 */
  timeoutMs?: number;
}

/**
 * A running answer: the tool's standard output as it arrives (its own JSON lines).
 *
 * @experimental
 * @since 1.4.0
 */
export interface CliRun {
  /** Throws a coded error when the program fails (`CLI_FAILED`, `NETWORK_TIMEOUT`, `TOO_LARGE`). @since 1.4.0 */
  readonly body: AsyncIterable<Uint8Array>;
  /** Stops the program. Safe to call twice. @since 1.4.0 */
  close(): void;
}

/**
 * Error codes: `CLI_NOT_FOUND`, `CLI_FAILED`, `NETWORK_DISABLED`, `NETWORK_NOT_ALLOWED`,
 * `NETWORK_TIMEOUT`, `TOO_LARGE`, `TOO_MANY_STREAMS`, `ABORTED`, `INVALID_ARGUMENT`.
 *
 * @experimental
 * @since 1.4.0
 */
export interface CliApi {
  /**
   * Finds the tools. With `check`, runs each found tool's own login-status command (a few
   * seconds); without it nothing is run.
   *
   * @since 1.4.0
   */
  detect(options?: { check?: boolean }): Promise<CliToolStatus[]>;
  /** Starts the tool and resolves at once; `signal` stops it. @since 1.4.0 */
  run(request: CliRequest, options?: { signal?: AbortSignal }): Promise<CliRun>;
}
