/** Conversation memory: every request carries the earlier turns (toimprove 364, session.ts:661). */
import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";
import { secretNameOf, type ProviderConfig } from "../src/providers";

import { pickMode } from "./ui";

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
  it("a follow-up after a change request carries the earlier request and answer", async () => {
    await start();
    pickMode("Edit this drawing");
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
