import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { friendlyError } from "../src/errors";
import {
  DEFAULT_MODEL,
  PROVIDERS,
  ProviderError,
  buildRequest,
  createParser,
  providerDef,
  providerLabel,
  transcript,
  type ProviderConfig,
  type ProviderId,
} from "../src/providers";

const sample = (name: string) =>
  readFileSync(`${__dirname}/samples/${name}`, "utf8");

/** Feeds `body` in pieces of `size` characters and returns the answer text. */
const run = (provider: ProviderId, body: string, size: number) => {
  const parser = createParser(provider);
  let out = "";
  for (let i = 0; i < body.length; i += size) {
    out += parser.push(body.slice(i, i + size)).join("");
  }
  out += parser.end().join("");
  return { out, done: parser.done };
};

describe("the provider table", () => {
  it("has one unique entry per provider with what the panel needs", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDERS) {
      expect(p.label).toBeTruthy();
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.models.map((m) => m.id)).toContain(p.defaultModel);
      expect(DEFAULT_MODEL[p.id]).toBe(p.defaultModel);
      if (p.kind === "cli") {
        expect(p.tool).toMatch(/^(claude|codex)$/);
        expect(p.needsKey).toBe(false);
      } else {
        expect(p.base).toMatch(/^https?:\/\//);
      }
    }
    expect(providerDef("claude-cli").tool).toBe("claude");
    expect(providerLabel("codex-cli")).toBe("Codex (your subscription)");
    expect(providerLabel("openai")).toBe("OpenAI");
  });

  it("only offers efforts the tools accept", () => {
    expect(providerDef("claude-cli").efforts).toContain("max");
    expect(providerDef("codex-cli").efforts).not.toContain("max");
    expect(providerDef("ollama").efforts).toEqual([]);
  });
});

describe("Claude Code output (a real recorded run)", () => {
  const body = sample("claude-stream.jsonl");
  it.each([1, 7, 64, 100000])(
    "reads the text in pieces of %i characters",
    (n) => {
      const r = run("claude-cli", body, n);
      expect(r.out).toBe("ok");
      expect(r.done).toBe(true);
    },
  );

  it("a failed run throws the tool's words", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "Invalid API key · Please run /login",
    });
    expect(() => run("claude-cli", `${line}\n`, 50)).toThrow(ProviderError);
    try {
      run("claude-cli", `${line}\n`, 50);
    } catch (e) {
      expect(friendlyError(e, "claude-cli")).toMatch(/Claude is not signed in/);
    }
  });

  it("uses the final result when no word came as a delta", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: false,
      result: "whole",
    });
    expect(run("claude-cli", `${line}\n`, 5).out).toBe("whole");
  });
});

describe("Codex output (a real recorded run)", () => {
  const body = sample("codex-exec.jsonl");
  it.each([1, 9, 1000])("reads the message in pieces of %i characters", (n) => {
    const r = run("codex-cli", body, n);
    expect(r.out).toBe("ok");
    expect(r.done).toBe(true);
  });

  it("a failed turn throws the tool's words, and two messages are separate paragraphs", () => {
    const fail = JSON.stringify({
      type: "turn.failed",
      error: { message: "not logged in" },
    });
    expect(() => run("codex-cli", `${fail}\n`, 20)).toThrow(/not logged in/);
    const two = ["a", "b"]
      .map((t) =>
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: t },
        }),
      )
      .join("\n");
    expect(run("codex-cli", `${two}\n`, 8).out).toBe("a\n\nb");
  });
});

describe("what a command line is asked", () => {
  it("joins earlier turns into one text", () => {
    expect(transcript([{ role: "user", content: "hi" }])).toBe("hi");
    const t = transcript([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(t).toMatch(/User: one[\s\S]*Assistant: two[\s\S]*three$/);
  });

  it("OpenAI gets the reasoning level only when one is chosen", () => {
    const cfg = {
      provider: "openai",
      model: "o4-mini",
      effort: "",
      baseUrl: "",
      timeoutMs: 1000,
      hasKey: true,
    } as ProviderConfig;
    expect(
      JSON.parse(buildRequest(cfg, "s", []).body!).reasoning_effort,
    ).toBeUndefined();
    expect(
      JSON.parse(buildRequest({ ...cfg, effort: "high" }, "s", []).body!)
        .reasoning_effort,
    ).toBe("high");
  });
});
