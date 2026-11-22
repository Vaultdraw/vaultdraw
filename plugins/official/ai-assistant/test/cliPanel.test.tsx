import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";

import { openSettings, pickMode, saveKey } from "./ui";

import type { PluginContext } from "@vaultdraw/api";

let p: TestPlugin | undefined;
let live: PluginContext | undefined;
/** The plugin's own setting as the app holds it now. */
const setting = (key: string) => live!.settings.get<string>(key);
const wrapped = {
  ...plugin,
  activate(ctx: PluginContext) {
    live = ctx;
    return plugin.activate(ctx);
  },
};
afterEach(async () => {
  vi.unstubAllGlobals();
  await p?.dispose();
  p = undefined;
});

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});

const claudeLines = (...parts: string[]) => [
  ...parts.map(
    (t) =>
      `${JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: t },
        },
      })}\n`,
  ),
  `${JSON.stringify({
    type: "result",
    is_error: false,
    result: parts.join(""),
  })}\n`,
];

/** A booted plugin with Claude found and logged in, the panel open, nothing chosen (Automatic). */
async function start(
  tools: Record<string, { state: "ready" | "login" | "found" }> = {
    claude: { state: "ready" },
  },
) {
  p = await boot(manifest(), wrapped as typeof plugin);
  for (const [k, v] of Object.entries({
    provider: "auto",
    model: "",
    effort: "",
    context: "auto",
  })) {
    await p.setSetting(k, v);
  }
  p.net.cli.tools = tools;
  p.net.cli.respond = () => ({ chunks: claudeLines("Hello ", "**world**") });
  p.scene.setElements([
    { type: "text", x: 10, y: 10, text: "Login page" },
    { type: "text", x: 10, y: 80, text: "Secret plan" },
  ]);
  await p.openPanel("assistant");
  await waitFor(() => expect(p!.net.cli.detects.length).toBeGreaterThan(0));
}

const type = (text: string) =>
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
const send = () =>
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
const ask = async (text: string) => {
  type(text);
  send();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
  );
};
const pick = (button: string, option: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: button }));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

describe("a subscription, one step", () => {
  it("Automatic picks the Claude command line and streams its answer as Markdown", async () => {
    await start();
    await ask("what is here?");
    const run = p!.net.cli.runs[0];
    expect(run.tool).toBe("claude");
    expect(run.prompt).toContain("Login page");
    expect(run.prompt).toContain("Secret plan");
    expect(run.system).toMatch(/help someone/i);
    expect(p!.net.requests).toHaveLength(0);
    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.getByLabelText("Current chat").textContent).toContain(
      "Claude",
    );
  });

  it("Codex is used when only Codex is on the computer", async () => {
    await start({ codex: { state: "ready" } });
    p!.net.cli.respond = () => ({
      chunks: [
        `${JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "from codex" },
        })}\n`,
      ],
    });
    await ask("hi");
    expect(p!.net.cli.runs[0].tool).toBe("codex");
    expect(screen.getByText("from codex")).toBeTruthy();
  });

  it("with neither found it falls back to Anthropic and asks for a key in plain words", async () => {
    await start({});
    await ask("hi");
    expect(p!.net.cli.runs).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toMatch(/No API key/);
  });

  it("opening the panel only looks for the tools; nothing runs and nothing is sent", async () => {
    await start();
    expect(p!.net.cli.detects).toEqual([false]);
    expect(p!.net.cli.runs).toHaveLength(0);
    expect(p!.net.requests).toHaveLength(0);
  });

  it("Stop kills the run, keeps what arrived and shows no error", async () => {
    await start();
    p!.net.cli.respond = () => ({
      chunks: claudeLines("one ", "two ", "three"),
      chunkDelayMs: 60,
    });
    type("go");
    send();
    await waitFor(() => screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(screen.getByRole("log").textContent).toContain("one"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(p!.net.closed.length).toBe(1);
    expect(screen.getByRole("log").textContent).toContain("one");
    expect(screen.getByRole("log").textContent).not.toContain("three");
  });

  it("Escape in the box stops it too", async () => {
    await start();
    p!.net.cli.respond = () => ({
      chunks: claudeLines("a ", "b ", "c "),
      chunkDelayMs: 60,
    });
    type("go");
    send();
    await waitFor(() => screen.getByRole("button", { name: "Stop" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Offline mode: says the tool needs the internet, and nothing runs", async () => {
    await start();
    p!.net.offline = () => true;
    await ask("hi");
    expect(screen.getByRole("alert").textContent).toMatch(
      /Offline mode is on.*Claude needs the internet/,
    );
  });

  it("a tool that is not signed in says how to fix it", async () => {
    await start();
    p!.net.cli.respond = () => ({
      chunks: [],
      error: {
        code: "CLI_FAILED",
        message: "Not logged in · Please run /login",
      },
    });
    await ask("hi");
    expect(screen.getByRole("alert").textContent).toMatch(
      /Claude is not signed in.*sign in/i,
    );
  });

  it("a tool that vanished says it is not installed", async () => {
    await start();
    p!.net.cli.tools = {};
    await ask("hi");
    expect(screen.getByRole("alert").textContent).toMatch(/not installed/);
  });
});

const modeTitle = () =>
  screen.getByRole("button", { name: "Mode" }).getAttribute("title") ?? "";

describe("model, effort, mode and context controls", () => {
  it("the model picker is searchable, grouped by provider, and takes a typed name", async () => {
    await start({ claude: { state: "ready" }, codex: { state: "ready" } });
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const list = screen.getByRole("listbox", { name: "Model" });
    expect(list.textContent).toContain("Claude (your subscription)");
    expect(list.textContent).toContain("Codex (your subscription)");
    // only what works now: no provider without a key, no Ollama, no "needs a key" row
    expect(list.textContent).not.toContain("Anthropic");
    expect(list.textContent).not.toContain("Ollama");
    expect(list.textContent).not.toContain("needs a key");
    fireEvent.change(screen.getByLabelText("Search model"), {
      target: { value: "opus" },
    });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([expect.stringMatching(/Opus/)]);
    fireEvent.change(screen.getByLabelText("Search model"), {
      target: { value: "my-model" },
    });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([expect.stringMatching(/Use "my-model" with Claude/)]);
    fireEvent.change(screen.getByLabelText("Search model"), {
      target: { value: "opus" },
    });
    fireEvent.click(within(list).getAllByRole("option")[0]);
    await waitFor(() => expect(setting("provider")).toBe("claude-cli"));
    expect(setting("model")).toBe("opus");
    await ask("hi");
    expect(p!.net.cli.runs[0].model).toBe("opus");
  });

  it("a tool that is not installed is not listed, and one provider shows no group header", async () => {
    await start({ claude: { state: "ready" } });
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const list = screen.getByRole("listbox", { name: "Model" });
    expect(list.textContent).not.toMatch(/not installed|needs a key|Codex/);
    expect(list.textContent).not.toContain("(your subscription)");
    expect(within(list).getAllByRole("option")).toHaveLength(4);
  });

  it("with nothing usable the picker is one line that opens the settings", async () => {
    await start({});
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const list = screen.getByRole("listbox", { name: "Model" });
    const rows = within(list).getAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual(["Connect a provider…"]);
    expect(screen.queryByLabelText("Search model")).toBeNull();
    fireEvent.click(rows[0]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Back to the chat" }),
      ).toBeTruthy(),
    );
  });

  it("effort shows only where the provider has levels, and reaches the tool", async () => {
    await start();
    pick("Reasoning effort", /^high/);
    await ask("hi");
    expect(p!.net.cli.runs[0].effort).toBe("high");
    await p!.setSetting("provider", "ollama");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Model" }).textContent).toMatch(
        /Llama/,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Reasoning effort" }),
      ).toBeNull(),
    );
  });

  it("AI: Cycle reasoning effort steps through the levels and back to default", async () => {
    await start();
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      await p!.run("cycle-effort");
      seen.push(setting("effort") as string);
    }
    expect(seen).toEqual(["low", "medium", "high", "xhigh", "max", "", "low"]);
  });

  it("the mode list and the slash helper change the mode", async () => {
    await start();
    pickMode("Describe the selection");
    expect(modeTitle()).toContain("Describe the selection");
    type("/ed");
    const helper = screen.getByRole("listbox", { name: "Modes" });
    expect(within(helper).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(modeTitle()).toContain("Edit this drawing");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(p!.net.cli.runs).toHaveLength(0);
  });

  it("@ chooses what is sent, and Nothing sends no drawing text", async () => {
    await start();
    type("@no");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Show what is sent" }).textContent,
    ).toBe("No drawing");
    await ask("just chat");
    expect(p!.net.cli.runs[0].prompt).toBe("just chat");
  });

  it("Only the selection with nothing selected says so and sends nothing", async () => {
    await start();
    pick("Add context", /^Only the selection/);
    await ask("hi");
    expect(screen.getByRole("alert").textContent).toMatch(/Select something/);
    expect(p!.net.cli.runs).toHaveLength(0);
  });

  it("the chip shows exactly what will be sent", async () => {
    await start();
    expect(
      screen.queryByRole("button", { name: "Show what is sent" }),
    ).toBeNull();
    pick("Add context", /^Show what is sent/);
    await waitFor(() =>
      expect(screen.getByLabelText("What is sent").textContent).toContain(
        "Secret plan",
      ),
    );
    expect(screen.getByLabelText("What is sent").textContent).toContain(
      "Claude",
    );
  });

  it("Enter sends, Shift+Enter does not", async () => {
    await start();
    type("hi");
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(p!.net.cli.runs).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(p!.net.cli.runs).toHaveLength(1));
  });
});

describe("the thread", () => {
  it("shows the questions and answers, Copy copies, New chat empties it", async () => {
    await start();
    await ask("first");
    await ask("second");
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("first");
    expect(log.textContent).toContain("second");
    expect(p!.net.cli.runs[1].prompt).toMatch(/first/); // a follow-up keeps the earlier turns
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByText("What can I do for you?")).toBeTruthy();
    expect(screen.getByRole("log").textContent).not.toContain("first");
  });

  it("a link in an answer is shown but cannot be followed, and HTML stays text", async () => {
    await start();
    p!.net.cli.respond = () => ({
      chunks: claudeLines(
        "See [docs](https://example.com) and <img src=x onerror=alert(1)>",
      ),
    });
    await ask("hi");
    expect(document.querySelector(".vd-ai-assistant a")).toBeNull();
    expect(document.querySelector(".vd-ai-assistant img")).toBeNull();
    expect(screen.getByText("docs").getAttribute("title")).toBe(
      "https://example.com",
    );
  });

  it("the empty state is one hint line; the modes list appears when / is typed", async () => {
    await start();
    expect(
      screen.getByText("Type / for commands, @ to add context"),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Modes" })).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Modes" })).toBeNull();
    type("/");
    const helper = screen.getByRole("listbox", { name: "Modes" });
    expect(within(helper).getAllByRole("option")).toHaveLength(6);
    fireEvent.click(within(helper).getByRole("option", { name: /\/diagram/ }));
    expect(modeTitle()).toContain("Generate a diagram");
  });
});

describe("settings: one place for everything", () => {
  it("the gear shows each subscription's status and checks again on request", async () => {
    await start({ claude: { state: "ready" }, codex: { state: "login" } });
    openSettings();
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Claude status" }).textContent,
      ).toBe("Connected"),
    );
    expect(
      screen.getByRole("status", { name: "Codex status" }).textContent,
    ).toBe("Not signed in");
    expect(p!.net.cli.detects.at(-1)).toBe(true);
    p!.net.cli.tools = {
      claude: { state: "ready" },
      codex: { state: "ready" },
    };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Codex status" }).textContent,
      ).toBe("Connected"),
    );
  });

  it("Codex always carries the one-line warning that it can read files", async () => {
    await start({ codex: { state: "ready" } });
    openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("codex-warning").textContent).toBe(
        "Codex can read files on this computer while answering.",
      ),
    );
    expect(screen.getAllByTestId("codex-warning")).toHaveLength(1);
  });

  it("a missing tool says how to get it", async () => {
    await start({});
    openSettings();
    await waitFor(() =>
      expect(screen.getByText(/Install Claude Code/)).toBeTruthy(),
    );
    // not a row of its own: only a hint under "Add a provider"
    expect(screen.queryByRole("status", { name: "Claude status" })).toBeNull();
    expect(screen.getByText("Add a provider")).toBeTruthy();
  });

  it("a key saved shows as saved, can be removed, and is never shown", async () => {
    await start();
    openSettings();
    saveKey("Anthropic", "sk-ant-SECRET-1");
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Anthropic key status" })
          .textContent,
      ).toBe("Key saved"),
    );
    expect(p!.net.secrets["ai-assistant"]?.["api-key"]).toBe("sk-ant-SECRET-1");
    expect(document.body.textContent).not.toContain("sk-ant-SECRET-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Anthropic key" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Anthropic key status" })
          .textContent,
      ).toBe("No key"),
    );
    expect(p!.net.secrets["ai-assistant"]).toEqual({});
  });

  it("defaults are plugin settings: provider, model, effort and what is sent", async () => {
    await start({ claude: { state: "ready" }, codex: { state: "ready" } });
    openSettings();
    fireEvent.change(screen.getByLabelText("Default provider"), {
      target: { value: "codex-cli" },
    });
    await waitFor(() => expect(setting("provider")).toBe("codex-cli"));
    fireEvent.change(screen.getByLabelText("Default reasoning effort"), {
      target: { value: "low" },
    });
    await waitFor(() => expect(setting("effort")).toBe("low"));
    fireEvent.change(screen.getByLabelText("Default context"), {
      target: { value: "none" },
    });
    await waitFor(() => expect(setting("context")).toBe("none"));
    fireEvent.click(screen.getByRole("button", { name: "Back to the chat" }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("a connected subscription has no connect action, and the default provider lists only usable ones", async () => {
    await start({ claude: { state: "ready" } });
    openSettings();
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Claude status" }).textContent,
      ).toBe("Connected"),
    );
    expect(screen.getByRole("button", { name: "Use Ollama" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use Claude" })).toBeNull();
    const options = within(screen.getByLabelText("Default provider"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Automatic (a subscription if found)",
      "Claude (your subscription)",
    ]);
  });
});

describe("palette commands", () => {
  it("open, new chat, choose model, connect and settings", async () => {
    await start();
    await ask("keep");
    await p!.run("new-chat");
    expect(screen.getByRole("log").textContent).not.toContain("keep");
    await p!.run("choose-model");
    await waitFor(() =>
      expect(screen.getByRole("listbox", { name: "Model" })).toBeTruthy(),
    );
    await p!.run("settings");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy(),
    );
    await p!.run("open");
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
  });
});

const png = (name = "shot.png", bytes = 8, type = "image/png") =>
  new File([new Uint8Array(bytes).fill(7)], name, { type });
const paste = (...files: File[]) =>
  fireEvent.paste(screen.getByRole("textbox"), {
    clipboardData: { files, types: ["Files"], getData: () => "" },
  });
const drop = (...files: File[]) =>
  fireEvent.drop(screen.getByRole("textbox").closest(".vd-ai-composer")!, {
    dataTransfer: { files, types: ["Files"] },
  });

describe("images in the composer", () => {
  it("a pasted image shows a thumbnail with Remove, and goes to the command line via ctx.cli", async () => {
    await start();
    paste(png());
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Attached images" }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "Remove shot.png" }),
    ).toBeTruthy();
    await ask("what is this?");
    const run = p!.net.cli.runs[0];
    expect(run.images).toHaveLength(1);
    expect(run.images![0].mime).toBe("image/png");
    expect(atob(run.images![0].data)).toHaveLength(8);
    // sent: the thumbnails are gone and the thread says an image went along
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("+ 1 image");
  });

  it("dropping works like pasting, Remove drops one, and a text paste is left alone", async () => {
    await start();
    drop(png("a.png"), png("b.jpg", 8, "image/jpeg"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(
        2,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    const notPrevented = fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [], types: ["text/plain"], getData: () => "hi" },
    });
    expect(notPrevented).toBe(true);
  });

  it("a file that is not an image, a big one and a fifth one are refused in plain words", async () => {
    await start();
    paste(png("big.png", 5 * 1024 * 1024 + 1));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "larger than 5 MB",
      ),
    );
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
    for (let i = 0; i < 5; i++) {
      paste(png(`p${i}.png`));
      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: /^Remove / }).length).toBe(
          Math.min(i + 1, 4),
        ),
      );
    }
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "At most 4 images",
      ),
    );
  });

  it("the + menu has Attach image and a size check for API providers says so before sending", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(screen.getByRole("option", { name: /^Attach image/ })).toBeTruthy();
    await p!.setSetting("provider", "anthropic");
    await waitFor(() => expect(setting("provider")).toBe("anthropic"));
    // no shrinking in this test: the browser cannot decode, so the files go as they are
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no")));
    paste(png("huge.png", 1_400_000), png("huge2.png", 1_400_000));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(
        2,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(
        /too large to send/,
      ),
    );
    expect(p!.net.requests).toEqual([]);
  });
});

describe("the toolbar and the + menu", () => {
  it("the effort and mode are icons with full names in their tooltips; the model has its full name too", async () => {
    await start();
    const mode = screen.getByRole("button", { name: "Mode" });
    expect(mode.textContent).toBe("");
    expect(mode.getAttribute("title")).toMatch(/^Mode: Ask \(\/ask\)/);
    const effort = screen.getByRole("button", { name: "Reasoning effort" });
    expect(effort.textContent).toBe("");
    expect(effort.getAttribute("title")).toBe("Reasoning effort: default");
    expect(
      screen.getByRole("button", { name: "Model" }).getAttribute("title"),
    ).toMatch(/^Model: /);
  });

  it("no context chip by default; a non-default choice shows one that resets", async () => {
    await start();
    expect(screen.queryByText(/elements/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show what is sent" }),
    ).toBeNull();
    pick("Add context", /^The whole drawing/);
    expect(
      screen.getByRole("button", { name: "Show what is sent" }).textContent,
    ).toBe("Whole drawing");
    fireEvent.click(
      screen.getByRole("button", { name: "Back to the default context" }),
    );
    expect(
      screen.queryByRole("button", { name: "Show what is sent" }),
    ).toBeNull();
  });

  it("Diagram and New drawing send no drawing, so the + menu has no context choices", async () => {
    await start();
    pickMode("Generate a diagram");
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Attach image…",
    ]);
  });
});
