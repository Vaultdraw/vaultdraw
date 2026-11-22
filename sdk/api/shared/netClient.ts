/**
 * The client half of `ctx.net` over any byte transport: `raw(method, body)` is the gateway in the
 * app and the scripted fake in the test host, so both behave the same. Rows: `net.open`,
 * `net.read` (one tagged chunk: 0 data, 1 end, 2 nothing yet, 3 error) and `net.close`.
 */
import { PluginApiError } from "./rules";

import type {
  CliApi,
  CliRequest,
  CliRun,
  CliToolStatus,
  NetApi,
  NetRequest,
  NetResponse,
} from "@vaultdraw/api";

export type RawCall = (
  method: string,
  body?: Uint8Array,
) => Promise<Uint8Array>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TAG_DATA = 0;
const TAG_END = 1;
const TAG_PENDING = 2;

/** A stopped request: its code is `ABORTED`, a `PluginErrorCode` since 1.3.0. */
const aborted = () =>
  Object.assign(new Error("The request was stopped"), { code: "ABORTED" });
const json = (value: unknown) => encoder.encode(JSON.stringify(value));

export function createNetClient(raw: RawCall, need: () => void): NetApi {
  return {
    async request(request: NetRequest, options): Promise<NetResponse> {
      need();
      if (!request || typeof request.url !== "string" || request.url === "") {
        throw new PluginApiError("INVALID_ARGUMENT", "url must be an address");
      }
      const signal = options?.signal;
      if (signal?.aborted) {
        throw aborted();
      }
      const opened = JSON.parse(
        decoder.decode(await raw("net.open", json(request))),
      ) as { id: number; status: number };
      const stream = openStream(raw, "net", opened.id, signal);
      return {
        status: opened.status,
        ok: opened.status >= 200 && opened.status < 300,
        body: stream.body,
        text: stream.text,
        close: stream.close,
      };
    },
  };
}

/**
 * The pull side shared by `ctx.net` and `ctx.cli`: reads tagged chunks of stream `id` through the
 * `<prefix>.read` row until the end, throws the coded error of a failed one, and closes the stream
 * (`<prefix>.close`) on the end, on an error and on abort.
 */
function openStream(
  raw: RawCall,
  prefix: "net" | "cli",
  id: number,
  signal: AbortSignal | undefined,
) {
  let closed = false;
  const onAbort = () => close();
  function close() {
    if (!closed) {
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      void raw(`${prefix}.close`, json({ id })).catch(() => {});
    }
  }
  signal?.addEventListener("abort", onAbort);

  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      while (!closed) {
        const out = await raw(`${prefix}.read`, json({ id }));
        if (closed) {
          break;
        }
        const tag = out[0];
        if (tag === TAG_END) {
          return;
        }
        if (tag === TAG_PENDING) {
          continue;
        }
        if (tag === TAG_DATA) {
          yield out.subarray(1);
          continue;
        }
        const err = JSON.parse(decoder.decode(out.subarray(1))) as {
          code: string;
          message: string;
        };
        throw new PluginApiError(err.code, err.message);
      }
      throw aborted();
    } finally {
      close();
    }
  }

  return {
    body: { [Symbol.asyncIterator]: chunks } as AsyncIterable<Uint8Array>,
    async text() {
      const dec = new TextDecoder();
      let out = "";
      for await (const part of chunks()) {
        out += dec.decode(part, { stream: true });
      }
      return out;
    },
    close,
  };
}

/** `ctx.cli` over the same transport: `cli.detect`, `cli.open` and the shared stream rows. */
export function createCliClient(raw: RawCall, need: () => void): CliApi {
  return {
    async detect(options) {
      need();
      const out = JSON.parse(
        decoder.decode(
          await raw("cli.detect", json({ check: options?.check === true })),
        ),
      ) as { tools: CliToolStatus[] };
      return out.tools;
    },
    async run(request: CliRequest, options): Promise<CliRun> {
      need();
      if (
        !request ||
        typeof request.tool !== "string" ||
        typeof request.prompt !== "string"
      ) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "tool and prompt must be text",
        );
      }
      const signal = options?.signal;
      if (signal?.aborted) {
        throw aborted();
      }
      const opened = JSON.parse(
        decoder.decode(await raw("cli.open", json(request))),
      ) as { id: number };
      const stream = openStream(raw, "cli", opened.id, signal);
      return { body: stream.body, close: stream.close };
    },
  };
}

export function createSecretClient(raw: RawCall, need: (m: string) => void) {
  const NAME = /^[a-z0-9._-]{1,64}$/;
  const body = (value: unknown) => encoder.encode(JSON.stringify(value));
  const checkName = (name: string) => {
    if (typeof name !== "string" || !NAME.test(name)) {
      throw new PluginApiError(
        "INVALID_ARGUMENT",
        "A secret name is 1 to 64 lower case letters, digits, '.', '_' or '-'",
      );
    }
  };
  return {
    async set(name: string, value: string) {
      need("secret.set");
      checkName(name);
      if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > 4096
      ) {
        throw new PluginApiError(
          "INVALID_ARGUMENT",
          "A secret is 1 to 4096 characters",
        );
      }
      await raw("secret.set", body({ name, value }));
    },
    async has(name: string) {
      need("secret.has");
      checkName(name);
      return (await raw("secret.has", body({ name })))[0] === 1;
    },
    async delete(name: string) {
      need("secret.delete");
      checkName(name);
      await raw("secret.delete", body({ name }));
    },
  };
}
