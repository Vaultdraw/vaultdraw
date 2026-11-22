import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const reply = (ops: unknown[]) =>
  `Done.\n\`\`\`vd edit\n${JSON.stringify({ ops })}\n\`\`\``;

async function start() {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  p.scene.setElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
    { type: "text", x: 10, y: 120, text: "Login page" },
  ]);
  p.net.secrets["ai-assistant"] = {
    [secretNameOf({ provider: "openai", baseUrl: "" } as ProviderConfig)]:
      "sk-test",
  };
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

const edit = async (text: string, ops: unknown[]) => {
  p!.net.respond = () => ({ chunks: sse(reply(ops)) });
  fireEvent.change(
    screen.getByLabelText("Ask, explain, draw or change anything"),
    {
      target: { value: text },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Proposed change");
};

describe("one clean result per answer (toimprove 351)", () => {
  it("Keep leaves ONE result line with a small Undo, and undo is one key press of the app's own undo", async () => {
    await start();
    await edit("add boxes", [
      { op: "add", type: "rectangle", x: 200, y: 0 },
      { op: "add", type: "rectangle", x: 400, y: 0 },
      { op: "add", type: "ellipse", x: 600, y: 0 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    const result = await screen.findByLabelText("Result");
    expect(result.textContent).toContain("Added 2 boxes, 1 ellipse");
    // the duplicate cannot come back: one result, no "Applied", no key sentence, no status line
    expect(screen.getAllByLabelText("Result")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Applied|Undo with/);
    expect(screen.queryByLabelText("Proposed change")).toBeNull();

    const keys: KeyboardEvent[] = [];
    document.addEventListener("keydown", (e) => keys.push(e));
    fireEvent.click(within(result).getByRole("button", { name: "Undo" }));
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("z");
    expect(keys[0].metaKey || keys[0].ctrlKey).toBe(true);
    expect(screen.getByLabelText("Result").textContent).toContain("(undone)");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo is offered only on the latest applied change, and not in another drawing", async () => {
    await start();
    await edit("one", [{ op: "add", type: "rectangle" }]);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await screen.findByLabelText("Result");
    await edit("two", [{ op: "add", type: "ellipse" }]);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getAllByLabelText("Result")).toHaveLength(2),
    );
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("Discard leaves one muted line, no Undo", async () => {
    await start();
    await edit("x", [{ op: "add", type: "ellipse" }]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const result = screen.getByLabelText("Result");
    expect(result.textContent).toMatch(/Discarded/);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the model's own text is plain thread text, not a muted status line", async () => {
    await start();
    await ask("what is here?", "A login box.");
    const text = screen.getByText("A login box.");
    expect(text.closest(".vd-ai-result, .vd-ai-via, .vd-ai-kept")).toBeNull();
  });
});

describe("one box, no modes", () => {
  it("the composer renders no Mode control, and typing '/' shows no list", async () => {
    await start();
    expect(screen.queryByRole("button", { name: "Mode" })).toBeNull();
    const box = screen.getByLabelText("Ask, explain, draw or change anything");
    fireEvent.change(box, { target: { value: "/" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("no mode label on every message (toimprove 352)", () => {
  it("user bubbles hold only what the user wrote", async () => {
    await start();
    await ask("first question", "First answer");
    await ask("second question", "Second answer");
    const bubbles = [...document.querySelectorAll(".vd-ai-user")];
    expect(bubbles.map((b) => b.textContent)).toEqual([
      "first question",
      "second question",
    ]);
  });
});

describe("chat history (toimprove 356)", () => {
  it("reads no storage until the history button is clicked", async () => {
    await start();
    await ask("hello", "Hi there");
    // saving wrote the chat; nothing was listed or read for the view yet
    await waitFor(() => expect(p!.storage.data().chats).toHaveLength(1));
    expect(screen.queryByLabelText("Earlier chats")).toBeNull();
  });

  it("saves, lists newest first, reopens and deletes", async () => {
    await start();
    await ask("first topic", "Answer one");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await ask("second topic", "Answer two");
    await waitFor(() => expect(p!.storage.data().chats).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const list = await screen.findByLabelText("Earlier chats");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("second topic"),
      expect.stringContaining("first topic"),
    ]);

    // reopen the older one: its turns are back and the thread is the chat view again
    fireEvent.click(within(rows[1]).getByText("first topic"));
    await screen.findByText("Answer one");
    expect(screen.queryByText("Answer two")).toBeNull();
    expect(screen.queryByLabelText("Earlier chats")).toBeNull();

    // continuing it updates the same chat instead of adding one
    await ask("more", "Answer three");
    await waitFor(() =>
      expect(JSON.stringify(p!.storage.data())).toContain("Answer three"),
    );
    expect(p!.storage.data().chats).toHaveLength(2);

    // delete one
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    const again = await screen.findByLabelText("Earlier chats");
    fireEvent.click(
      within(again).getByRole("button", { name: /Delete chat: second topic/ }),
    );
    await waitFor(() => expect(p!.storage.data().chats).toHaveLength(1));
    expect(within(again).queryByText("second topic")).toBeNull();
    expect(
      Object.keys(p!.storage.data()).filter((k) => k.startsWith("chat:")),
    ).toHaveLength(1);
  });

  it("keeps the last 50 chats and drops the oldest with its data", async () => {
    await start();
    const seeded = Array.from({ length: 50 }, (_, i) => ({
      id: `old${i}`,
      title: `chat ${i}`,
      at: 1000 + i,
      provider: "openai",
      vault: "",
    }));
    // newest first, as the app stores it
    seeded.reverse();
    const data: Record<string, unknown> = { chats: seeded };
    for (const c of seeded) {
      data[`chat:${c.id}`] = { ...c, turns: [] };
    }
    p!.storage.seed(data as never);
    await ask("brand new", "Fresh answer");
    await waitFor(() => {
      const d = p!.storage.data();
      expect(d.chats).toHaveLength(50);
      expect((d.chats as { title: string }[])[0].title).toBe("brand new");
    });
    const d = p!.storage.data();
    expect(d["chat:old0"]).toBeUndefined();
    expect(d["chat:old1"]).toBeDefined();
  });

  it("shows only the chats of the open vault, and a note when there are none", async () => {
    await start();
    p!.storage.seed({
      chats: [
        {
          id: "x",
          title: "elsewhere",
          at: 1,
          provider: "openai",
          vault: "Other vault",
        },
      ],
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
    await screen.findByText(/No earlier chats/);
    expect(screen.queryByText("elsewhere")).toBeNull();
  });

  it("the palette command opens the history", async () => {
    await start();
    await p!.run("history");
    await screen.findByText(/No earlier chats/);
  });

  it("an unkept proposal is stored without its operations", async () => {
    await start();
    await edit("boxes", [{ op: "add", type: "rectangle" }]);
    await waitFor(() => expect(p!.storage.data().chats).toHaveLength(1));
    const rec = Object.entries(p!.storage.data()).find(([k]) =>
      k.startsWith("chat:"),
    )![1] as { turns: Record<string, unknown>[] };
    const t = rec.turns.at(-1)!;
    expect(t.outcome).toBe("Not applied");
    expect(t.proposal).toBeUndefined();
    expect(JSON.stringify(rec)).not.toContain('"op"');
  });
});

vi.setConfig({ testTimeout: 20000 });
