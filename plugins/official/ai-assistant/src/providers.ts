/**
 * One small adapter per provider: how to build the request and how to read the stream back.
 * Pure (no host calls), so each wire format is tested with plain strings.
 */
import { wireMessages, type MessageImage } from "./images";

import type { NetRequest } from "@vaultdraw/api";

/** Where a provider is reached: the user's own command line, or an HTTP API. */
export type ProviderKind = "cli" | "http";

export type ProviderId =
  | "claude-cli"
  | "codex-cli"
  | "anthropic"
  | "openai"
  | "ollama";

export interface ModelDef {
  /** What is sent to the provider; empty is the provider's own default. */
  id: string;
  label: string;
}

/**
 * One row per provider. Adding a provider is one entry here (plus a stream parser for a new wire
 * format): the panel's picker, the settings and the error texts all read this table.
 */
export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** The group shown in the model picker. */
  group: "Your subscription" | "API key" | "On this computer";
  kind: ProviderKind;
  /** `kind: "cli"`: the tool `ctx.cli` runs. */
  tool?: "claude" | "codex";
  /** `kind: "http"`: the usual address. */
  base?: string;
  models: readonly ModelDef[];
  /** Reasoning levels the provider takes; empty: the control is hidden. */
  efforts: readonly string[];
  /** The model used when none is chosen. */
  defaultModel: string;
  /** Whether a stored key is needed (an OpenAI-style server on this computer may need none). */
  needsKey: boolean;
}

const EFFORTS = ["low", "medium", "high"] as const;

export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: "claude-cli",
    label: "Claude",
    group: "Your subscription",
    kind: "cli",
    tool: "claude",
    models: [
      { id: "", label: "Default (recommended)" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
      { id: "haiku", label: "Haiku" },
    ],
    efforts: [...EFFORTS, "xhigh", "max"],
    defaultModel: "",
    needsKey: false,
  },
  {
    id: "codex-cli",
    label: "Codex",
    group: "Your subscription",
    kind: "cli",
    tool: "codex",
    models: [{ id: "", label: "Default (recommended)" }],
    efforts: [...EFFORTS, "xhigh"],
    defaultModel: "",
    needsKey: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    group: "API key",
    kind: "http",
    base: "https://api.anthropic.com",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    ],
    efforts: [],
    defaultModel: "claude-sonnet-4-5",
    needsKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    group: "API key",
    kind: "http",
    base: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-5", label: "GPT-5" },
      { id: "o4-mini", label: "o4-mini" },
    ],
    efforts: EFFORTS,
    defaultModel: "gpt-4.1-mini",
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama",
    group: "On this computer",
    kind: "http",
    base: "http://localhost:11434",
    models: [{ id: "llama3.2", label: "Llama 3.2" }],
    efforts: [],
    defaultModel: "llama3.2",
    needsKey: false,
  },
];

export const providerDef = (id: ProviderId): ProviderDef =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[2];

export const providerLabel = (id: ProviderId): string =>
  id === "claude-cli" || id === "codex-cli"
    ? `${providerDef(id).label} (your subscription)`
    : providerDef(id).label;

/** What the model picker needs to know about the machine; all plain data. */
export interface AvailabilityInput {
  /** The command lines found on this computer; null until looked for. */
  tools: readonly { id: string; state?: string; path?: string | null }[] | null;
  /** Whether a key is saved, per provider id. */
  keys: Readonly<Record<string, boolean>>;
  /** The provider in use now, and the raw `provider` setting ("auto" or an id). */
  provider: ProviderId;
  rawProvider: string;
}

/** A model the user can use right now; `group` is set only when more than one provider is usable. */
export interface AvailableModel {
  provider: ProviderId;
  /** The id sent to the provider (empty: its own default). */
  id: string;
  label: string;
  group?: string;
}

/**
 * Whether a provider works right now: a command line that was found and is not known to be signed
 * out, a provider with a saved key, or Ollama once the user chose it (nothing is probed: a server
 * that may be off is never listed as a dead row).
 */
export function isUsable(p: ProviderDef, a: AvailabilityInput): boolean {
  if (p.kind === "cli") {
    const t = a.tools?.find((x) => x.id === p.tool);
    // before the first look, the one in use is trusted so the picker does not flash empty
    return t
      ? !!t.path && t.state !== "login" && t.state !== "missing"
      : a.tools === null && a.provider === p.id;
  }
  if (p.needsKey) {
    return a.keys[p.id] === true;
  }
  return a.rawProvider === p.id;
}

/**
 * The models for the picker: only providers that work now, grouped by provider only when there
 * are several. Empty means nothing is usable: the picker then offers "Connect a provider".
 */
export function availableModels(a: AvailabilityInput): AvailableModel[] {
  const usable = PROVIDERS.filter((p) => isUsable(p, a));
  return usable.flatMap((p) =>
    p.models.map((m) => ({
      provider: p.id,
      id: m.id,
      label: m.label,
      ...(usable.length > 1 ? { group: providerLabel(p.id) } : {}),
    })),
  );
}

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  /** Reasoning level; empty: the provider's own default. */
  effort: string;
  /** Empty: the provider's usual address. */
  baseUrl: string;
  timeoutMs: number;
  /** Whether a key is stored (an OpenAI-style server on this computer may need none). */
  hasKey: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Pictures that go with this message (only the newest message carries them). */
  images?: readonly MessageImage[];
}

export const DEFAULT_BASE: Record<ProviderId, string> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.base ?? ""]),
) as Record<ProviderId, string>;

export const DEFAULT_MODEL: Record<ProviderId, string> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.defaultModel]),
) as Record<ProviderId, string>;

export const isProvider = (v: unknown): v is ProviderId =>
  PROVIDERS.some((p) => p.id === v);

/** A server on this computer: no key needed for an OpenAI-style one. */
export const isLocalAddress = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
};

export const baseUrlOf = (cfg: ProviderConfig): string =>
  (cfg.baseUrl.trim() || DEFAULT_BASE[cfg.provider]).replace(/\/+$/, "");

/**
 * The name a key is saved under: one key per provider and address, so a key saved for one service
 * is never sent to another (toimprove 272; Zed keeps a credential per provider API URL). The
 * default Anthropic address keeps the first release's plain "api-key".
 */
export const secretNameOf = (cfg: ProviderConfig): string => {
  const base = baseUrlOf(cfg);
  if (cfg.provider === "anthropic" && base === DEFAULT_BASE.anthropic) {
    return "api-key";
  }
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    // an address that does not parse is refused later; keep a stable name for it
  }
  return `api-key-${cfg.provider}-${host.toLowerCase()}`
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, 64);
};

/** Whether this provider needs a stored key to be asked. */
export const needsKey = (cfg: ProviderConfig): boolean =>
  cfg.provider === "anthropic" ||
  (cfg.provider === "openai" && !isLocalAddress(baseUrlOf(cfg)));

/** The question as one text for a command line: earlier turns, then the new one. */
export function transcript(messages: readonly ChatMessage[]): string {
  if (messages.length <= 1) {
    return messages[0]?.content ?? "";
  }
  const last = messages[messages.length - 1];
  const earlier = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return `Earlier in this conversation:\n\n${earlier}\n\n---\n\nNew message from the user:\n${last.content}`;
}

export function buildRequest(
  cfg: ProviderConfig,
  system: string,
  messages: readonly ChatMessage[],
): NetRequest {
  const base = baseUrlOf(cfg);
  const model = cfg.model.trim() || DEFAULT_MODEL[cfg.provider];
  const effort = (cfg.effort ?? "").trim();
  const common = { method: "POST" as const, timeoutMs: cfg.timeoutMs };
  if (cfg.provider === "anthropic") {
    return {
      ...common,
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      auth: { secret: secretNameOf(cfg), header: "x-api-key" },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: wireMessages("anthropic", messages),
      }),
    };
  }
  const withSystem = [
    { role: "system", content: system },
    ...wireMessages(cfg.provider, messages),
  ];
  if (cfg.provider === "openai") {
    return {
      ...common,
      url: `${base}/chat/completions`,
      headers: { "content-type": "application/json" },
      ...(cfg.hasKey || !isLocalAddress(base)
        ? {
            auth: {
              secret: secretNameOf(cfg),
              header: "authorization",
              prefix: "Bearer ",
            },
          }
        : {}),
      body: JSON.stringify({
        model,
        stream: true,
        messages: withSystem,
        ...(effort ? { reasoning_effort: effort } : {}),
      }),
    };
  }
  return {
    ...common,
    url: `${base}/api/chat`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: withSystem }),
  };
}

/** A failure the provider reported inside a stream or an error body. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Text in, answer text out. `push` may be called with any split of the bytes. */
export interface StreamParser {
  push(text: string): string[];
  /** Call at the end of the body: flushes a last line without a newline. */
  end(): string[];
  /** True once the provider said the answer is complete. */
  readonly done: boolean;
}

/** Splits a stream into lines and hands each to `onLine`. */
function lineParser(
  onLine: (line: string) => string | null,
  isDone: () => boolean,
): StreamParser {
  let rest = "";
  const take = (lines: string[]) =>
    lines.flatMap((l) => {
      const out = onLine(l.replace(/\r$/, ""));
      return out ? [out] : [];
    });
  return {
    push(text) {
      rest += text;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      return take(lines);
    },
    end() {
      const last = rest;
      rest = "";
      return last ? take([last]) : [];
    },
    get done() {
      return isDone();
    },
  };
}

const parseJson = (text: string): Record<string, any> | null => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

const errorText = (e: unknown): string => {
  if (typeof e === "string") {
    return e;
  }
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "The provider reported an error";
};

/**
 * `claude -p --output-format stream-json --include-partial-messages`: one JSON object per line.
 * The text arrives as `content_block_delta` events; a `result` event ends the run, and carries the
 * whole text too (used when no delta came, for example when partial messages are not sent).
 */
function claudeCliParser(): StreamParser {
  let finished = false;
  let sawText = false;
  return lineParser(
    (line) => {
      const j = line.trim() ? parseJson(line) : null;
      if (!j) {
        return null;
      }
      if (j.type === "stream_event") {
        const d =
          j.event?.type === "content_block_delta" ? j.event.delta : null;
        if (d?.type === "text_delta" && typeof d.text === "string" && d.text) {
          sawText = true;
          return d.text;
        }
        return null;
      }
      if (j.type === "result") {
        finished = true;
        if (j.is_error) {
          throw new ProviderError(errorText(j.result ?? j.error));
        }
        if (!sawText && typeof j.result === "string" && j.result) {
          sawText = true;
          return j.result;
        }
      }
      return null;
    },
    () => finished,
  );
}

/**
 * `codex exec --json`: one JSON event per line. The answer comes as whole `agent_message` items
 * (Codex does not stream words), a `turn.completed` event ends the run.
 */
function codexCliParser(): StreamParser {
  let finished = false;
  let count = 0;
  return lineParser(
    (line) => {
      const j = line.trim() ? parseJson(line) : null;
      if (!j) {
        return null;
      }
      if (j.type === "turn.failed" || j.type === "error") {
        throw new ProviderError(errorText(j.error ?? j.message));
      }
      if (j.type === "turn.completed") {
        finished = true;
        return null;
      }
      if (
        j.type === "item.completed" &&
        j.item?.type === "agent_message" &&
        typeof j.item.text === "string" &&
        j.item.text
      ) {
        return `${count++ > 0 ? "\n\n" : ""}${j.item.text}`;
      }
      return null;
    },
    () => finished,
  );
}

export function createParser(provider: ProviderId): StreamParser {
  let finished = false;
  if (provider === "claude-cli") {
    return claudeCliParser();
  }
  if (provider === "codex-cli") {
    return codexCliParser();
  }
  if (provider === "ollama") {
    return lineParser(
      (line) => {
        const j = line.trim() ? parseJson(line) : null;
        if (!j) {
          return null;
        }
        if (j.error) {
          throw new ProviderError(errorText(j.error));
        }
        if (j.done) {
          finished = true;
        }
        const text = j.message?.content;
        return typeof text === "string" && text ? text : null;
      },
      () => finished,
    );
  }
  return lineParser(
    (line) => {
      if (!line.startsWith("data:")) {
        return null;
      }
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        finished = true;
        return null;
      }
      const j = parseJson(data);
      if (!j) {
        return null;
      }
      if (provider === "anthropic") {
        if (j.type === "error") {
          throw new ProviderError(errorText(j.error));
        }
        if (j.type === "message_stop") {
          finished = true;
        }
        const t = j.type === "content_block_delta" ? j.delta?.text : undefined;
        return typeof t === "string" && t ? t : null;
      }
      if (j.error) {
        throw new ProviderError(errorText(j.error));
      }
      const choice = j.choices?.[0];
      if (choice?.finish_reason) {
        finished = true;
      }
      const t = choice?.delta?.content;
      return typeof t === "string" && t ? t : null;
    },
    () => finished,
  );
}

/** The provider's own message out of an error body (JSON `error.message`, or the plain text). */
export function errorMessageOf(body: string): string {
  const j = parseJson(body);
  const e = j?.error ?? j?.message;
  if (e !== undefined) {
    return errorText(e).slice(0, 300);
  }
  return body.trim().slice(0, 300);
}
