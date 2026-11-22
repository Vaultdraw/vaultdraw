/** The picture check after a change, through the panel (fake network, fake renderer). */
import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import plugin from "../src/main";
import { secretNameOf, type ProviderConfig } from "../src/providers";

import { ask as say } from "./ui";

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
const page = `Here is the page.\n\`\`\`vd heading level=1\nNetworking\n\`\`\`\n\`\`\`vd text\n- packets\n\`\`\``;

async function start(access: string, review = true) {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  await p.setSetting("review", review);
  await p.setSetting("access", access);
  p.scene.setElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
  ]);
  p.net.secrets["ai-assistant"] = {
    [secretNameOf({ provider: "openai", baseUrl: "" } as ProviderConfig)]:
      "sk-test",
  };
  await p.openPanel("assistant");
}

/** The first answer builds a page; every later one (the review) moves the heading. */
function answers() {
  let n = 0;
  p!.net.respond = () => {
    n++;
    if (n === 1) {
      return { chunks: sse(page) };
    }
    const heading = p!.scene.live().find((e) => e.text === "Networking")!;
    return {
      chunks: sse(
        n === 2
          ? `The heading is too close.\n\`\`\`vd edit\n${JSON.stringify({
              ops: [{ op: "move", id: heading.id, x: 0, y: 200 }],
            })}\n\`\`\``
          : "No issues.",
      ),
    };
  };
}

describe("checking the result from a picture", () => {
  it("Apply at once: the picture of what was added goes to the model, its fix is applied, then a clean look ends it", async () => {
    await start("auto");
    answers();
    say("teach me networking");
    await waitFor(() =>
      expect(screen.getByText(/^Tidied up: Moved 1 text/)).toBeTruthy(),
    );
    expect(p!.net.requests).toHaveLength(3);
    const review = JSON.parse(p!.net.requests[1].body!);
    const last = review.messages.at(-1);
    // the picture went along, with the checklist and the added elements by id
    expect(JSON.stringify(last)).toContain("data:image/png;base64,");
    expect(JSON.stringify(last)).toContain("Overlap");
    expect(JSON.stringify(last)).toContain('text \\"Networking\\"');
    expect(p!.scene.batches).toHaveLength(2);
    expect(p!.scene.live().find((e) => e.text === "Networking")!.y).toBe(200);
  });

  it("Ask first: after Keep, the fixes come as a Tidy up proposal and nothing more is applied", async () => {
    await start("ask");
    answers();
    say("teach me networking");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.getByText("Moves 1 text")).toBeTruthy());
    expect(p!.net.requests).toHaveLength(2);
    expect(p!.scene.batches).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(p!.scene.batches).toHaveLength(2));
    // a kept tidy-up is not checked again
    expect(p!.net.requests).toHaveLength(2);
  });

  it("review = false never sends a picture (Read only applies nothing, so it has nothing to check)", async () => {
    await start("auto", false);
    answers();
    say("teach me networking");
    await waitFor(() => expect(p!.scene.batches).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(p!.net.requests).toHaveLength(1);
  });
});
