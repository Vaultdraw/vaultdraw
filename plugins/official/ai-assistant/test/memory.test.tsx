/** Conversation memory: every request carries the earlier turns (toimprove 364, session.ts:661). */
import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";
import { conversation, outcomeLine, type HistoryTurn } from "../src/memory";
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

async function start() {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  p.scene.setElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 60, text: "Client" },
    { type: "rectangle", x: 300, y: 0, width: 100, height: 60, text: "Server" },
  ]);
  p.net.secrets["ai-assistant"] = {
    [secretNameOf({ provider: "openai", baseUrl: "" } as ProviderConfig)]:
      "sk-test",
  };
  await p.openPanel("assistant");
}

const say = async (text: string, answer: string) => {
  p!.net.respond = () => ({ chunks: sse(answer) });
  const n = p!.net.requests.length;
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(p!.net.requests.length).toBe(n + 1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
  );
};

describe("conversation memory", () => {
  it("a follow-up after a change request carries the earlier request and answer (toimprove 364: only Ask kept history)", async () => {
    await start();
    await say(
      "make this diagram better, more descriptive and illustrative",
      "I made it clearer.",
    );
    await say("u didn't change anything", "Sorry.");
    const body = JSON.parse(p!.net.requests[1].body!);
    const all = JSON.stringify(body.messages);
    expect(all).toContain("make this diagram better, more descriptive");
    expect(all).toContain("I made it clearer.");
    expect(body.messages.at(-1).content).toContain("u didn't change anything");
  });
});

describe("conversation(): recent turns in full, older ones summed up", () => {
  const turns = (n: number): HistoryTurn[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? { role: "user" as const, text: `question ${i}`, ask: `question ${i}` }
        : {
            role: "assistant" as const,
            text: `answer ${i}`,
            ...(i === 1
              ? {
                  outcome: "Added 3 boxes",
                  summary: "Adds 3 boxes",
                  applied: true,
                }
              : {}),
          },
    );

  it("keeps the newest turns in full and older ones as one line each", () => {
    const msgs = conversation(turns(20), 100000, 6);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toMatch(/^Earlier in this chat, summed up:/);
    expect(msgs[0].content).toContain("- asked: question 0");
    expect(msgs[0].content).toContain(
      "- you: answer 1 [Applied to the drawing: Added 3 boxes]",
    );
    expect(msgs.at(-1)).toEqual({ role: "assistant", content: "answer 19" });
    // roles alternate
    msgs.forEach((m, i) => expect(m.role).toBe(i % 2 ? "assistant" : "user"));
  });

  it("stays under the cap however long the chat", () => {
    const long = turns(400).map((t) => ({
      ...t,
      text: `${t.text} ${"x".repeat(300)}`,
    }));
    const msgs = conversation(long, 5000);
    const size = msgs.reduce((n, m) => n + m.content.length, 0);
    expect(size).toBeLessThanOrEqual(5000);
    expect(msgs.at(-1)!.content).toContain("answer 399");
  });

  it("says what happened to each change, and gives the last drawing's source", () => {
    const msgs = conversation([
      { role: "user", text: "draw jwt", ask: "draw jwt" },
      {
        role: "assistant",
        text: "Here.",
        summary: "Adds 1 drawing",
        outcome: "Discarded",
        source: "old",
      },
      { role: "user", text: "again", ask: "again" },
      {
        role: "assistant",
        text: "Better.",
        summary: "Adds 1 drawing",
        outcome: "Added 1 drawing",
        applied: true,
        undone: true,
        source: "```vd diagram\nsequenceDiagram\n```",
      },
    ]);
    const all = msgs.map((m) => m.content).join("\n");
    expect(all).toContain("[Discarded by the user: Adds 1 drawing]");
    expect(all).toContain(
      "[Applied to the drawing, then undone by the user: Added 1 drawing]",
    );
    expect(all).toContain("sequenceDiagram");
    expect(all).not.toContain("\nold");
  });

  it("an error turn is remembered as a failure", () => {
    expect(outcomeLine({ role: "assistant", text: "", error: "Offline" })).toBe(
      "[Failed: Offline]",
    );
  });
});
