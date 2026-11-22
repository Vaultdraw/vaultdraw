import { readFileSync } from "node:fs";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boot, type TestPlugin } from "@vaultdraw/api/testing";

import { parseManifest } from "../../../../sdk/examples/testing/readManifest";
import { nextAccess } from "../src/access";
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
const reply = (ops: unknown[]) =>
  `Done.\n\`\`\`vd edit\n${JSON.stringify({ ops })}\n\`\`\``;
const newDrawing = `Here.\n\`\`\`vd new title="Blob"\n\`\`\`\n\`\`\`vd text\nHello\n\`\`\``;

async function start(access?: string) {
  p = await boot(manifest(), plugin);
  await p.setSetting("provider", "openai");
  await p.setSetting("access", access ?? "ask"); // settings outlive a test in this kit
  p.scene.setElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
  ]);
  p.net.secrets["ai-assistant"] = {
    [secretNameOf({ provider: "openai", baseUrl: "" } as ProviderConfig)]:
      "sk-test",
  };
  await p.openPanel("assistant");
}

const ask = async (text: string, model: string) => {
  p!.net.respond = () => ({ chunks: sse(model) });
  say(text);
};

describe("permission modes", () => {
  it("the cycle goes ask, apply at once, read only, ask", () => {
    expect(nextAccess("ask")).toBe("auto");
    expect(nextAccess("auto")).toBe("read");
    expect(nextAccess("read")).toBe("ask");
  });

  it("ask first is the default: a proposal with Keep, nothing applied", async () => {
    await start();
    expect(screen.getByRole("button", { name: "Permission" })).toBeTruthy();
    await ask("x", reply([{ op: "add", type: "ellipse" }]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy(),
    );
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("apply at once: one undo step now, a result card with Undo, no Keep", async () => {
    await start("auto");
    await ask("x", reply([{ op: "add", type: "ellipse" }]));
    await waitFor(() => expect(screen.getByLabelText("Result")).toBeTruthy());
    expect(p!.scene.batches).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(
      within(screen.getByLabelText("Result")).getByRole("button", {
        name: "Undo",
      }),
    ).toBeTruthy();
  });

  it("apply at once still asks before making a new drawing", async () => {
    await start("auto");
    await ask("x", newDrawing);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy(),
    );
    expect(Object.keys(p!.vault.drawings())).toEqual([]);
  });

  it("read only: an edit request is answered in words and never proposes or applies", async () => {
    await start("read");
    await ask("make it red", "Select the box and pick red.");
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Select the box and pick red.",
      ),
    );
    expect(screen.queryByLabelText("Proposed change")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(p!.scene.batches).toHaveLength(0);
    // the model was told not to add action blocks
    expect(p!.net.requests[0].body).toContain("Read only");
  });

  it("the command cycles the setting and says which mode", async () => {
    await start();
    await p!.run("cycle-access");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Permission" }).title).toMatch(
        /^Apply at once/,
      ),
    );
    expect(p!.toasts()).toContain("AI assistant: Permission: Apply at once");
    await p!.run("cycle-access");
    await p!.run("cycle-access");
    expect(p!.toasts().at(-1)).toBe("AI assistant: Permission: Ask first");
  });

  it("the icon opens the three modes and picks one", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Permission" }));
    const list = screen.getByRole("listbox", { name: "Permission" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      expect.stringContaining("Ask first"),
      expect.stringContaining("Apply at once"),
      expect.stringContaining("Read only"),
    ]);
    fireEvent.click(within(list).getByRole("option", { name: /Read only/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Permission" }).title).toMatch(
        /^Read only/,
      ),
    );
  });
});

describe("drawing settings through the assistant", () => {
  it("Ask: shows 'Page mode on, lined paper', Keep applies the settings once, in one batch", async () => {
    await start();
    await ask(
      "page mode on, normal paper with lines",
      reply([
        { op: "drawing", pageMode: true, paper: "lines", paperTheme: "normal" },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Proposed change")).toBeTruthy(),
    );
    expect(
      screen.getByText("Page mode on, normal paper, lined paper"),
    ).toBeTruthy();
    expect(p!.scene.appState().pageSetup).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Result").textContent).toMatch(
        /^Page mode on, normal paper, lined paper/,
      ),
    );
    expect(p!.scene.batches).toHaveLength(1);
    expect(p!.scene.appState()).toMatchObject({
      pageSetup: { enabled: true, paperTheme: "normal" },
      viewBackgroundPattern: { type: "lines" },
    });
  });

  it("Apply at once: settings and shapes land together, with Undo", async () => {
    await start("auto");
    await ask(
      "x",
      reply([
        { op: "drawing", paper: "grid" },
        { op: "add", type: "ellipse" },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText("Result")).toBeTruthy());
    expect(p!.scene.batches).toHaveLength(1);
    expect(p!.scene.appState()).toMatchObject({
      viewBackgroundPattern: { type: "grid" },
    });
    expect(p!.scene.live()).toHaveLength(2);
    expect(screen.getByLabelText("Result").textContent).toMatch(
      /Added 1 ellipse, grid paper/,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("Read only: a reply with action blocks shows the words and says the drawing was not changed", async () => {
    await start("read");
    await ask("x", reply([{ op: "add", type: "ellipse" }]));
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Read only: the drawing was not changed.",
      ),
    );
    expect(screen.queryByLabelText("Proposed change")).toBeNull();
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("a reply with a drawing-settings block proposes the settings alone", async () => {
    await start();
    await ask(
      "paper with lines",
      'Done.\n```vd settings\n{"paper":"lines"}\n```',
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Proposed change")).toBeTruthy(),
    );
    expect(screen.getByText("Lined paper")).toBeTruthy();
  });
});
