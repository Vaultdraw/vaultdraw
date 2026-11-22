import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

// Answers the browser fake of `ctx.cli` (claude) with the REAL `claude` command line, Haiku only.
// The arguments and the standard input are the ones `src-tauri/src/plugins/cli.rs` build_run makes
// for claude, except `--model` is always haiku (whatever the panel picked) and `--effort` is left
// out (Haiku has no effort levels). Opt-in: only aiRealHaiku.spec.ts uses it, with AI_REAL=1.

// REAL_CLAUDE_BIN is only for harness dry runs with a stub script.
const CLAUDE = process.env.REAL_CLAUDE_BIN ?? "/Users/kalon/.local/bin/claude";
/** The owner's hard limit on model calls, across all runs of the real test. */
export const MAX_REAL_CALLS = 5;
const RUN_LIMIT_MS = 170_000;

export type RealCall = {
  n: number;
  prompt: string;
  withImages: number;
  ms: number;
  stdoutBytes: number;
  stderr: string;
  text: string;
  isError: boolean;
};

/** Module-level on purpose: one counter for every spawn in this process. */
let spawned = 0;
export const realCalls: RealCall[] = [];
export const realCallCount = () => spawned;

type Run = {
  system?: string;
  prompt: string;
  images?: { mime: string; data: string }[];
};

/** The claude branch of cli.rs build_run. */
export const buildClaudeRun = (run: Run) => {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--setting-sources",
    "",
  ];
  if (run.system) {
    args.push("--system-prompt", run.system);
  }
  args.push("--model", "haiku");
  const images = run.images ?? [];
  if (images.length === 0) {
    return { args, stdin: run.prompt };
  }
  args.push("--input-format", "stream-json");
  const content: unknown[] = images.map((i) => ({
    type: "image",
    source: { type: "base64", media_type: i.mime, data: i.data },
  }));
  content.push({ type: "text", text: run.prompt });
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content },
  });
  return { args, stdin: `${line}\n` };
};

const realRun = (run: Run): Promise<string[]> => {
  if (spawned >= MAX_REAL_CALLS) {
    throw new Error(
      `real model call budget spent (${MAX_REAL_CALLS}); refusing to spawn`,
    );
  }
  spawned++;
  const n = spawned;
  const { args, stdin } = buildClaudeRun(run);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, args, {
      cwd: mkdtempSync(join(tmpdir(), "vd-real-claude-")),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_LIMIT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const lines = out.split("\n").filter((l) => l.trim() !== "");
      let text = "";
      let isError = false;
      for (const l of lines) {
        try {
          const j = JSON.parse(l);
          if (
            j.type === "stream_event" &&
            j.event?.type === "content_block_delta" &&
            j.event.delta?.type === "text_delta"
          ) {
            text += j.event.delta.text;
          }
          if (j.type === "result") {
            isError = j.is_error === true;
          }
        } catch {
          /* not json */
        }
      }
      const entry = {
        n,
        prompt: run.prompt,
        withImages: run.images?.length ?? 0,
        ms: Date.now() - started,
        stdoutBytes: out.length,
        stderr: err.slice(0, 500),
        text,
        isError,
      };
      realCalls.push(entry);
      // kept at once, so a test that fails later still leaves the reply on disk
      appendFileSync(
        "/Users/kalon/Opensource/vaultdraw/personal/feature/ai-realtest/real-calls.jsonl",
        `${JSON.stringify(entry)}\n`,
      );
      resolve(lines.map((l) => `${l}\n`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
};

/** Routes the page's fake `ctx.cli` (claude) to the real command line. */
export const bridgeRealClaude = async (page: Page) => {
  await page.exposeFunction("__realClaudeRun", (run: Run) => realRun(run));
  await page.evaluate(() => {
    const net = (window as any).__plugins.backend.net;
    net.cli.tools = {
      claude: { state: "ready", path: "/Users/kalon/.local/bin/claude" },
    };
    net.cli.respond = async (run: unknown) => ({
      chunks: await (window as any).__realClaudeRun(run),
    });
  });
};
