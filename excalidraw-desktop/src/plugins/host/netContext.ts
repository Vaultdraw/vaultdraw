/**
 * `ctx.net` (API 1.1.0, experimental): the gateway rows `net.open`, `net.read` and `net.close`
 * (permission `net`, raw bodies; see `plugins/net.rs`). The request is sent by Rust and pulled in
 * tagged chunks (`sdk/api/shared/netClient.ts`); closing a stream is the cancel.
 */
import {
  createCliClient,
  createNetClient,
} from "../../../../sdk/api/shared/netClient";
import { requirePermission } from "../../../../sdk/api/shared/vaultPaths";

import { createRawGateway } from "./gateway";

import type { CliApi, NetApi } from "../api";
import type { PluginRuntime } from "./types";

export function createNetApi(rt: PluginRuntime): NetApi {
  const id = rt.info.id;
  return createNetClient(createRawGateway(id), () =>
    requirePermission(id, rt.info.permissions, "net.request", "net"),
  );
}

/** `ctx.cli`: the gateway rows `cli.detect`, `cli.open`, `cli.read`, `cli.close` (permission `cli`; see `plugins/cli.rs`). */
export function createCliApi(rt: PluginRuntime): CliApi {
  const id = rt.info.id;
  return createCliClient(createRawGateway(id), () =>
    requirePermission(id, rt.info.permissions, "cli.run", "cli"),
  );
}
