import { isBlockedIpLiteral } from "./blockedAddress";

/**
 * The browser build's stand-in for the native `net.*` and `secret.*` rows (permissions `net` and
 * `secret`): the tests and the e2e harness script the provider (`respond`), so nothing goes on the
 * wire. It mirrors the native rules that matter to a plugin: Offline mode blocks every host except
 * this computer, a missing stored key is `SECRET_MISSING`, ids belong to one plugin.
 */
export interface FakeNetReply {
  status?: number;
  /** The body, one entry per chunk. */
  chunks?: string[];
  /** Fail the stream after the chunks with this error. */
  error?: { code: string; message: string };
  /** Wait before each chunk, to let a test cancel mid-stream. */
  chunkDelayMs?: number;
}

export interface FakeNetRequest {
  pluginId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** The header the stored secret would have been put into by the app: name and the value that WOULD be sent. */
  authHeader?: { name: string; value: string };
}

/** One `ctx.cli.run` the fake saw. */
export interface FakeCliRun {
  pluginId: string;
  tool: string;
  model?: string;
  effort?: string;
  system?: string;
  prompt: string;
}

/** The stand-in for the `cli.*` rows (permission `cli`): script the tools and the output. */
export interface FakeCli {
  /** What `detect` reports per tool id; a tool not listed is missing. */
  tools: Record<
    string,
    { state: "found" | "ready" | "login"; path?: string; detail?: string }
  >;
  /** The tool's output (its stdout chunks). Unset: `CLI_FAILED`. */
  respond?: (run: FakeCliRun) => FakeNetReply | Promise<FakeNetReply>;
  /** Every run started, in order. */
  runs: FakeCliRun[];
  /** Every `detect` call: whether it asked for the login check. */
  detects: boolean[];
}

export interface FakeNet {
  /** `ctx.cli` in tests and the e2e harness. */
  cli: FakeCli;
  /** The provider: what to answer. Unset: a connection error. Throw `{code, message}` to fail the open. */
  respond?: (request: FakeNetRequest) => FakeNetReply | Promise<FakeNetReply>;
  /** Every request opened, in order. */
  requests: FakeNetRequest[];
  /** Stored secrets by plugin id and name (the native side keeps them in a 0600 file). */
  secrets: Record<string, Record<string, string>>;
  /** Offline mode now. */
  offline?: () => boolean;
  /**
   * The user's `network.allow_private_hosts` (entries such as `192.168.1.20:11434` or `ollama.lan`):
   * the hosts a request may reach although they are private, over http too. Default: none.
   */
  allowPrivateHosts?: string[];
  /** Streams closed by the plugin (cancel). */
  closed: number[];
}

export { isBlockedIpLiteral };

/** One entry of `allow_private_hosts` as host and optional port; null when it is neither. Like net.rs. */
const parsePrivateEntry = (
  entry: string,
): { host: string; port: number | null } | null => {
  const e = entry.trim().toLowerCase();
  if (e === "" || /[/@ \t?#\\]/.test(e)) {
    return null;
  }
  let host: string;
  let port: string | null = null;
  if (e.startsWith("[")) {
    const close = e.indexOf("]");
    if (close < 0) {
      return null;
    }
    host = e.slice(0, close + 1);
    const after = e.slice(close + 1);
    if (after !== "") {
      if (!after.startsWith(":")) {
        return null;
      }
      port = after.slice(1);
    }
  } else {
    const parts = e.split(":");
    if (parts.length > 2) {
      return null;
    }
    host = parts[0];
    port = parts.length === 2 ? parts[1] : null;
  }
  if (host === "" || host === "[]") {
    return null;
  }
  if (port === null) {
    return { host, port: null };
  }
  const n = /^\d{1,5}$/.test(port) ? Number(port) : 0;
  return n >= 1 && n <= 65535 ? { host, port: n } : null;
};

/** Whether `entries` allow `url`: equal host, and the port when the entry names one. Like net.rs. */
export const privateHostAllowed = (entries: readonly string[], url: URL) => {
  const host = url.hostname.toLowerCase();
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return entries.some((entry) => {
    const p = parsePrivateEntry(entry);
    return (
      p !== null && p.host === host && (p.port === null || p.port === port)
    );
  });
};

const coded = (code: string, message: string) =>
  Object.assign(new Error(message), { code, message });

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;

interface Stream {
  pluginId: string;
  reply: FakeNetReply;
  next: number;
  closed: boolean;
}

export const createFakeCli = (): FakeCli => ({
  tools: {},
  runs: [],
  detects: [],
});

export const createFakeNet = (): FakeNet => ({
  cli: createFakeCli(),
  requests: [],
  secrets: {},
  closed: [],
});

const enc = new TextEncoder();
const dec = new TextDecoder();
const tagged = (tag: number, rest?: Uint8Array) => {
  const out = new Uint8Array(1 + (rest?.length ?? 0));
  out[0] = tag;
  if (rest) {
    out.set(rest, 1);
  }
  return out;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const NET_ROWS = new Set(["net.open", "net.read", "net.close"]);
export const CLI_ROWS = new Set([
  "cli.detect",
  "cli.open",
  "cli.read",
  "cli.close",
]);
export const SECRET_ROWS = new Set([
  "secret.set",
  "secret.has",
  "secret.delete",
]);

const streams = new Map<number, Stream>();
let nextId = 1;

export async function fakeNetRow(
  fake: FakeNet,
  pluginId: string,
  method: string,
  body: Uint8Array,
): Promise<Uint8Array> {
  const arg = JSON.parse(dec.decode(body)) as Record<string, unknown>;
  if (method === "cli.detect") {
    fake.cli.detects.push(arg.check === true);
    const tools = ["claude", "codex"].map((id) => {
      const t = fake.cli.tools[id];
      if (!t) {
        return { id, path: null, state: "missing", detail: "" };
      }
      const state =
        arg.check === true || t.state === "found" ? t.state : "found";
      return {
        id,
        path: t.path ?? `/usr/local/bin/${id}`,
        state,
        detail: arg.check === true ? t.detail ?? "" : "",
      };
    });
    return enc.encode(JSON.stringify({ tools }));
  }
  if (method === "cli.open") {
    if (fake.offline?.()) {
      throw coded(
        "NETWORK_DISABLED",
        "Offline mode is on. Turn it off in Settings to use the internet.",
      );
    }
    const tool = String(arg.tool);
    if (!fake.cli.tools[tool]) {
      throw coded("CLI_NOT_FOUND", `${tool} is not installed on this computer`);
    }
    const run: FakeCliRun = {
      pluginId,
      tool,
      model: arg.model as string | undefined,
      effort: arg.effort as string | undefined,
      system: arg.system as string | undefined,
      prompt: String(arg.prompt),
    };
    fake.cli.runs.push(run);
    if (!fake.cli.respond) {
      throw coded("CLI_FAILED", "The program stopped with an error");
    }
    const reply = await fake.cli.respond(run);
    const id = nextId++;
    streams.set(id, { pluginId, reply, next: 0, closed: false });
    return enc.encode(JSON.stringify({ id }));
  }
  if (method === "cli.read" || method === "cli.close") {
    return fakeNetRow(fake, pluginId, method.replace("cli.", "net."), body);
  }
  if (method === "net.open") {
    // The same checks, in the same order, as the app's net.rs check_url (toimprove 274).
    let url: URL;
    try {
      url = new URL(String(arg.url));
    } catch {
      throw coded("INVALID_URL", "That is not a valid address");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw coded(
        "INVALID_URL",
        "Only https addresses are allowed, or http to this computer",
      );
    }
    if (url.username || url.password) {
      throw coded(
        "INVALID_URL",
        "Addresses with a user name or password are not allowed",
      );
    }
    const local = LOOPBACK.test(url.hostname);
    const listed =
      !local && privateHostAllowed(fake.allowPrivateHosts ?? [], url);
    if (!local && !listed && isBlockedIpLiteral(url.hostname)) {
      throw coded(
        "PRIVATE_ADDRESS",
        "That address is private or local, so it was not contacted. To allow a computer on your own network, list it in network.allow_private_hosts in config.toml",
      );
    }
    if (!local && !listed && url.protocol !== "https:") {
      throw coded(
        "INVALID_URL",
        "Only https addresses are allowed, or http to this computer",
      );
    }
    if (!local && fake.offline?.()) {
      throw coded(
        "NETWORK_DISABLED",
        "Offline mode is on. Turn it off in Settings to use the internet.",
      );
    }
    const headers = { ...((arg.headers as Record<string, string>) ?? {}) };
    const auth = arg.auth as
      | { secret: string; header: string; prefix?: string }
      | undefined;
    let authHeader: FakeNetRequest["authHeader"];
    if (auth) {
      const stored = fake.secrets[pluginId]?.[auth.secret];
      if (stored === undefined) {
        throw coded("SECRET_MISSING", "No API key is saved");
      }
      authHeader = { name: auth.header, value: (auth.prefix ?? "") + stored };
    }
    const request: FakeNetRequest = {
      pluginId,
      url: url.toString(),
      method: String(arg.method ?? (arg.body !== undefined ? "POST" : "GET")),
      headers,
      body: arg.body as string | undefined,
      authHeader,
    };
    fake.requests.push(request);
    if (!fake.respond) {
      throw coded("NETWORK_ERROR", "Request failed");
    }
    let reply: FakeNetReply;
    try {
      reply = await fake.respond(request);
    } catch (e) {
      const c = e as { code?: string; message?: string };
      throw coded(c.code ?? "NETWORK_ERROR", c.message ?? "Request failed");
    }
    const id = nextId++;
    streams.set(id, { pluginId, reply, next: 0, closed: false });
    return enc.encode(JSON.stringify({ id, status: reply.status ?? 200 }));
  }
  if (method === "net.read" || method === "net.close") {
    const id = Number(arg.id);
    const stream = streams.get(id);
    if (method === "net.close") {
      if (stream && stream.pluginId === pluginId) {
        stream.closed = true;
        streams.delete(id);
        fake.closed.push(id);
      }
      return new Uint8Array(0);
    }
    if (!stream || stream.pluginId !== pluginId) {
      throw coded("NOT_FOUND", "No such request");
    }
    if (stream.reply.chunkDelayMs) {
      await sleep(stream.reply.chunkDelayMs);
    }
    const chunks = stream.reply.chunks ?? [];
    if (stream.next < chunks.length) {
      return tagged(0, enc.encode(chunks[stream.next++]));
    }
    streams.delete(id);
    if (stream.reply.error) {
      return tagged(3, enc.encode(JSON.stringify(stream.reply.error)));
    }
    return tagged(1);
  }
  const store = (fake.secrets[pluginId] ??= {});
  const name = String(arg.name);
  if (method === "secret.set") {
    store[name] = String(arg.value);
    return new Uint8Array(0);
  }
  if (method === "secret.has") {
    return new Uint8Array([name in store ? 1 : 0]);
  }
  delete store[name];
  return new Uint8Array(0);
}
