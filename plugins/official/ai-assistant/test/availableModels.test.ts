import { describe, expect, it } from "vitest";

import { availableModels, type AvailabilityInput } from "../src/providers";

const base: AvailabilityInput = {
  tools: [],
  keys: { anthropic: false, openai: false },
  provider: "anthropic",
  rawProvider: "auto",
};
const providersOf = (a: AvailabilityInput) => [
  ...new Set(availableModels(a).map((m) => m.provider)),
];

describe("availableModels: only what works now", () => {
  it("only Claude found: its models, no group headers", () => {
    const a = availableModels({
      ...base,
      provider: "claude-cli",
      tools: [{ id: "claude", state: "ready", path: "/bin/claude" }],
    });
    expect(a.map((m) => m.label)).toEqual([
      "Default (recommended)",
      "Sonnet",
      "Opus",
      "Haiku",
    ]);
    expect(a.every((m) => m.group === undefined)).toBe(true);
  });

  it("Claude and Codex: both, grouped by provider", () => {
    const a = availableModels({
      ...base,
      provider: "claude-cli",
      tools: [
        { id: "claude", state: "ready", path: "/bin/claude" },
        { id: "codex", state: "ready", path: "/bin/codex" },
      ],
    });
    expect(providersOf({ ...base, tools: [] })).toEqual([]);
    expect([...new Set(a.map((m) => m.group))]).toEqual([
      "Claude (your subscription)",
      "Codex (your subscription)",
    ]);
  });

  it("a key saved for OpenAI: only OpenAI's models", () => {
    const a = availableModels({ ...base, keys: { openai: true } });
    expect(providersOf({ ...base, keys: { openai: true } })).toEqual([
      "openai",
    ]);
    expect(a.map((m) => m.label)).toContain("GPT-5");
    expect(a.every((m) => m.group === undefined)).toBe(true);
  });

  it("nothing usable: empty list (the picker shows Connect a provider)", () => {
    expect(availableModels(base)).toEqual([]);
  });

  it("a tool that is missing or signed out is not listed", () => {
    expect(
      availableModels({
        ...base,
        tools: [
          { id: "claude", state: "login", path: "/bin/claude" },
          { id: "codex", state: "missing" },
        ],
      }),
    ).toEqual([]);
  });

  it("before the first look, the command line in use is trusted", () => {
    expect(
      providersOf({ ...base, tools: null, provider: "claude-cli" }),
    ).toEqual(["claude-cli"]);
    expect(providersOf({ ...base, tools: null })).toEqual([]);
  });

  it("Ollama only when the user chose it", () => {
    expect(providersOf(base)).toEqual([]);
    expect(
      providersOf({ ...base, provider: "ollama", rawProvider: "ollama" }),
    ).toEqual(["ollama"]);
  });

  it("never lists a model with a 'needs a key' state", () => {
    const a = availableModels({
      ...base,
      keys: { anthropic: true, openai: true },
    });
    expect(
      providersOf({ ...base, keys: { anthropic: true, openai: true } }),
    ).toEqual(["anthropic", "openai"]);
    expect(a.every((m) => m.group)).toBe(true);
  });
});
