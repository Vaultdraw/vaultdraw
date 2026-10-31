/**
 * `network.allow_private_hosts` exists twice: the app's `network::private_host_allowed` (Rust) and
 * the fake `ctx.net` of the browser harness and the SDK mock host (`sdk/api/shared/fakeNet.ts`).
 * One case table, read by both: vaultdraw-core/src/contract/private_entry_cases.json
 * (net.rs test `private_host_entries_match_by_host_and_optional_port`).
 */
import { describe, expect, it } from "vitest";

import { privateHostAllowed } from "../../../sdk/api/shared/fakeNet";
import table from "../../src-tauri/crates/vaultdraw-core/src/contract/private_entry_cases.json";

describe("the fake allows the same hosts as the app (private_entry_cases.json)", () => {
  for (const { entry, url, allowed } of table.cases as {
    entry: string;
    url: string;
    allowed: boolean;
  }[]) {
    it(`${JSON.stringify(entry)} for ${url} -> ${allowed}`, () => {
      expect(privateHostAllowed([entry], new URL(url))).toBe(allowed);
    });
  }
});
