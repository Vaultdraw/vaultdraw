/**
 * `ctx.net` and `ctx.secret` of the mock host: script the provider with `net.respond`, read what
 * was sent in `net.requests`, and see stored keys in `net.secrets`. Nothing goes on the wire. The
 * permissions `net` and `secret` are checked first, as in the app.
 */
import {
  createFakeCli,
  createFakeNet,
  fakeNetRow,
  type FakeNet,
} from "../shared/fakeNet";
import {
  createCliClient,
  createNetClient,
  createSecretClient,
} from "../shared/netClient";
import { permissionError } from "../shared/vaultPaths";

import type { CliApi, NetApi, SecretApi } from "@vaultdraw/api";

export type {
  FakeCli,
  FakeCliRun,
  FakeNet,
  FakeNetReply,
  FakeNetRequest,
} from "../shared/fakeNet";

export function createNetModel() {
  const fake: FakeNet = createFakeNet();
  const raw = (id: string) => (method: string, body?: Uint8Array) =>
    fakeNetRow(fake, id, method, body ?? new Uint8Array(0));
  return {
    fake,
    netApi(id: string, permissions: readonly string[]): NetApi {
      return createNetClient(raw(id), () => {
        if (!permissions.includes("net")) {
          throw permissionError(id, "net.request", "net");
        }
      });
    },
    cliApi(id: string, permissions: readonly string[]): CliApi {
      return createCliClient(raw(id), () => {
        if (!permissions.includes("cli")) {
          throw permissionError(id, "cli.run", "cli");
        }
      });
    },
    secretApi(id: string, permissions: readonly string[]): SecretApi {
      return createSecretClient(raw(id), (method) => {
        if (!permissions.includes("secret")) {
          throw permissionError(id, method, "secret");
        }
      });
    },
    reset() {
      fake.cli = createFakeCli();
      fake.respond = undefined;
      fake.requests = [];
      fake.secrets = {};
      fake.offline = undefined;
      fake.allowPrivateHosts = undefined;
      fake.closed = [];
    },
  };
}
