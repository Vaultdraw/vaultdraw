import { readFileSync } from "node:fs";

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";
import { secretNameOf, type ProviderConfig } from "../src/providers";

let p: TestPlugin | undefined;
afterEach(async () => {
  await p?.dispose();
  p = undefined;
});

const manifest = () => ({
  ...parseManifest(readFileSync(`${__dirname}/../plugin.toml`, "utf8")),
  mainBytes: 1,
  dir: __dirname,
});
const sse = (t: string) => [
  `data: {"choices":[{"delta":{"content":${JSON.stringify(t)}}}]}\n\n`,
  "data: [DONE]\n\n",
];

async function start(seed?: Record<string, unknown>) {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  p.scene.setElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
  ]);
  p.net.secrets["ai-assistant"] = {
    [secretNameOf({ provider: "openai", baseUrl: "" } as ProviderConfig)]:
      "sk-test",
  };
  if (seed) {
    p.storage.seed(seed as never);
  }
  await p.openPanel("assistant");
}

const ask = async (question: string, answer: string) => {
  p!.net.respond = () => ({ chunks: sse(answer) });
  fireEvent.change(
    screen.getByLabelText("Ask, explain, draw or change anything"),
    {
      target: { value: question },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(answer);
};

const tabs = () => screen.getAllByRole("tab");
const names = () => tabs().map((t) => t.textContent);
const selected = () =>
  tabs().find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
const plus = () =>
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));

describe("chat tabs (toimprove 362)", () => {
  it("starts with one empty tab called New chat", async () => {
    await start();
    expect(names()).toEqual(["New chat"]);
  });

  it("the first message names the tab, trimmed", async () => {
    await start();
    await ask("  what   is\n here?  ", "A box");
    expect(names()).toEqual(["what is here?"]);
    p!.net.respond = () => ({ chunks: sse("ok") });
  });

  it("+ opens a new tab and shows it; each tab keeps its thread", async () => {
    await start();
    await ask("first topic", "Answer one");
    plus();
    expect(names()).toEqual(["first topic", "New chat"]);
    expect(selected()).toBe("New chat");
    expect(screen.queryByText("Answer one")).toBeNull();
    await ask("second topic", "Answer two");
    fireEvent.click(tabs()[0]);
    await screen.findByText("Answer one");
    expect(screen.queryByText("Answer two")).toBeNull();
    expect(selected()).toBe("first topic");
    fireEvent.click(tabs()[1]);
    await screen.findByText("Answer two");
  });

  it("+ on an empty tab does not pile up empty tabs", async () => {
    await start();
    plus();
    plus();
    expect(names()).toEqual(["New chat"]);
  });

  it("each tab keeps its own unsent text", async () => {
    await start();
    await ask("one", "A1");
    fireEvent.change(
      screen.getByLabelText("Ask, explain, draw or change anything"),
      {
        target: { value: "half a thought" },
      },
    );
    plus();
    expect(
      (
        screen.getByLabelText(
          "Ask, explain, draw or change anything",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    fireEvent.click(tabs()[0]);
    expect(
      (
        screen.getByLabelText(
          "Ask, explain, draw or change anything",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("half a thought");
  });

  it("each tab keeps its own context choice, and no tab has a Mode control", async () => {
    await start();
    await ask("one", "A1");
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    fireEvent.click(
      screen.getByRole("option", { name: /^Only the selection/ }),
    );
    plus();
    expect(screen.queryByRole("button", { name: "Mode" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    // the new tab starts on the default choice, the first one still has its own
    expect(
      screen
        .getByRole("option", { name: /^Selection, or the whole drawing/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    // Escape inside the open menu closes only the menu (focus moves into it on a timer)
    fireEvent.keyDown(document.querySelector(".vd-ai-pop")!, {
      key: "Escape",
    });
    fireEvent.click(tabs()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(
      screen
        .getByRole("option", { name: /^Only the selection/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("closing: x closes, the neighbour is shown, middle-click closes, the last leaves an empty chat", async () => {
    await start();
    await ask("one", "A1");
    plus();
    await ask("two", "A2");
    plus();
    await ask("three", "A3");
    expect(names()).toEqual(["one", "two", "three"]);
    // close the shown (last) tab: the one to its left is shown
    fireEvent.click(screen.getByRole("button", { name: "Close chat: three" }));
    expect(names()).toEqual(["one", "two"]);
    expect(selected()).toBe("two");
    // middle-click closes a tab that is not shown
    fireEvent.mouseDown(tabs()[0], { button: 1 });
    act(() => {
      tabs()[0].parentElement!.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });
    expect(names()).toEqual(["two"]);
    // the last one: replaced by an empty New chat
    fireEvent.click(screen.getByRole("button", { name: "Close chat: two" }));
    expect(names()).toEqual(["New chat"]);
    expect(screen.queryByText("A2")).toBeNull();
    // closed chats are still in the history
    await waitFor(() => expect(p!.storage.data().chats).toHaveLength(3));
  });

  it("restores the open tabs after a reload, with the shown one", async () => {
    await start();
    await ask("one", "A1");
    plus();
    await ask("two", "A2");
    fireEvent.click(tabs()[0]);
    await waitFor(() => {
      const t = Object.entries(p!.storage.data()).find(([k]) =>
        k.startsWith("tabs:"),
      )?.[1] as { open: string[]; active: string };
      expect(t.open).toHaveLength(2);
    });
    const data = p!.storage.data() as Record<string, unknown>;
    await p!.dispose();
    await start(data);
    await waitFor(() => expect(names()).toEqual(["one", "two"]));
    expect(selected()).toBe("one");
    await screen.findByText("A1");
    fireEvent.click(tabs()[1]);
    await screen.findByText("A2");
  });

  it("opening a chat from the history focuses its tab when open, else opens one", async () => {
    await start();
    await ask("one", "A1");
    plus();
    await ask("two", "A2");
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const list = await screen.findByLabelText("Earlier chats");
    fireEvent.click(within(list).getByText("one"));
    await screen.findByText("A1");
    expect(names()).toEqual(["one", "two"]);
    expect(selected()).toBe("one");
    // close "one", then reopen it from the history: a tab comes back
    fireEvent.click(screen.getByRole("button", { name: "Close chat: one" }));
    expect(names()).toEqual(["two"]);
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const again = await screen.findByLabelText("Earlier chats");
    fireEvent.click(within(again).getByText("one"));
    await screen.findByText("A1");
    expect(names()).toEqual(["two", "one"]);
  });

  it("deleting a chat from the history closes its tab", async () => {
    await start();
    await ask("one", "A1");
    plus();
    await ask("two", "A2");
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const list = await screen.findByLabelText("Earlier chats");
    fireEvent.click(
      within(list).getByRole("button", { name: /Delete chat: one/ }),
    );
    await waitFor(() => expect(names()).toEqual(["two"]));
  });

  it("the commands: next, previous (wrapping) and close", async () => {
    await start();
    await ask("one", "A1");
    plus();
    await ask("two", "A2");
    plus();
    await ask("three", "A3");
    await p!.run("next-tab");
    expect(selected()).toBe("one");
    await p!.run("previous-tab");
    expect(selected()).toBe("three");
    await p!.run("previous-tab");
    expect(selected()).toBe("two");
    await p!.run("close-tab");
    expect(names()).toEqual(["one", "three"]);
    expect(selected()).toBe("three");
  });

  it("switching away from a running answer keeps what streamed, and the answer does not land in the other tab", async () => {
    await start();
    await ask("one", "A1");
    p!.net.respond = () => ({
      chunks: [sse("partial")[0], sse(" late")[0], "data: [DONE]\n\n"],
      chunkDelayMs: 120,
    });
    plus();
    fireEvent.change(
      screen.getByLabelText("Ask, explain, draw or change anything"),
      {
        target: { value: "slow" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("partial");
    fireEvent.click(tabs()[0]);
    await screen.findByText("A1");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText(/late/)).toBeNull();
    expect(screen.queryByText(/partial/)).toBeNull();
    fireEvent.click(tabs()[1]);
    await screen.findByText("partial");
  });
});

vi.setConfig({ testTimeout: 20000 });
