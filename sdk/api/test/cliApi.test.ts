import { afterEach, describe, expect, it } from "vitest";

import { boot } from "../testing";

import type { PluginContext } from "../src/index";
import type { TestPlugin } from "../testing";

let p: TestPlugin | undefined;
let ctx: PluginContext;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const start = async (permissions: string[] = ["cli"]) => {
  p = await boot(
    {
      id: "cli-t",
      permissions,
      contributes: { commands: [{ id: "go", title: "Go" }] },
    } as never,
    {
      activate(c: PluginContext) {
        ctx = c;
        c.commands.register("go", () => {});
      },
    } as never,
  );
  await p.run("go");
  return p;
};

const read = async (run: { body: AsyncIterable<Uint8Array> }) => {
  const dec = new TextDecoder();
  let out = "";
  for await (const c of run.body) {
    out += dec.decode(c);
  }
  return out;
};

describe("ctx.cli", () => {
  it("needs the permission cli", async () => {
    await start([]);
    await expect(ctx.cli.detect()).rejects.toMatchObject({
      code: "PERMISSION",
    });
    await expect(
      ctx.cli.run({ tool: "claude", prompt: "hi" }),
    ).rejects.toMatchObject({ code: "PERMISSION" });
  });

  it("detects tools, and runs the login check only when asked", async () => {
    const t = await start();
    t.net.cli.tools = {
      claude: { state: "ready", path: "/x/claude", detail: "ok" },
    };
    const quick = await ctx.cli.detect();
    expect(quick.find((x) => x.id === "claude")?.state).toBe("found");
    expect(quick.find((x) => x.id === "codex")).toMatchObject({
      state: "missing",
      path: null,
    });
    const checked = await ctx.cli.detect({ check: true });
    expect(checked.find((x) => x.id === "claude")?.state).toBe("ready");
    expect(t.net.cli.detects).toEqual([false, true]);
  });

  it("streams the output and records what was asked", async () => {
    const t = await start();
    t.net.cli.tools = { codex: { state: "ready" } };
    t.net.cli.respond = () => ({ chunks: ["a", "b"] });
    const run = await ctx.cli.run({
      tool: "codex",
      prompt: "q",
      model: "m",
      effort: "low",
    });
    expect(await read(run)).toBe("ab");
    expect(t.net.cli.runs[0]).toMatchObject({
      tool: "codex",
      prompt: "q",
      model: "m",
      effort: "low",
    });
  });

  it("refuses a missing tool, Offline mode, and reports a failing program", async () => {
    const t = await start();
    await expect(
      ctx.cli.run({ tool: "claude", prompt: "q" }),
    ).rejects.toMatchObject({ code: "CLI_NOT_FOUND" });
    t.net.cli.tools = { claude: { state: "ready" } };
    t.net.offline = () => true;
    await expect(
      ctx.cli.run({ tool: "claude", prompt: "q" }),
    ).rejects.toMatchObject({ code: "NETWORK_DISABLED" });
    t.net.offline = undefined;
    t.net.cli.respond = () => ({
      chunks: ["part"],
      error: { code: "CLI_FAILED", message: "please log in" },
    });
    const run = await ctx.cli.run({ tool: "claude", prompt: "q" });
    await expect(read(run)).rejects.toMatchObject({
      code: "CLI_FAILED",
      message: "please log in",
    });
  });

  it("closes the run when aborted", async () => {
    const t = await start();
    t.net.cli.tools = { claude: { state: "ready" } };
    t.net.cli.respond = () => ({ chunks: ["a", "b", "c"], chunkDelayMs: 20 });
    const ac = new AbortController();
    const run = await ctx.cli.run(
      { tool: "claude", prompt: "q" },
      { signal: ac.signal },
    );
    const it = run.body[Symbol.asyncIterator]();
    await it.next();
    ac.abort();
    await expect(it.next()).rejects.toMatchObject({ code: "ABORTED" });
    expect(t.net.closed.length).toBe(1);
  });
});
