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
const reply = (ops: unknown[], title = "Plan") =>
  `\`\`\`json\n${JSON.stringify({ title, ops })}\n\`\`\``;

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

const send = async (
  tab: string,
  label: RegExp,
  text: string,
  model: string,
) => {
  p!.net.respond = () => ({ chunks: sse(model) });
  pickMode(tab);
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Proposed change")).toBeTruthy(),
  );
};

describe("edit this drawing", () => {
  it("shows the plan first and changes nothing until Keep, then one undo step", async () => {
    await start();
    const id = p!.scene.live()[0].id;
    await send(
      "Edit this drawing",
      /Say what to change/,
      "red box, add two",
      reply([
        { op: "restyle", id, strokeColor: "#e03131" },
        { op: "add", type: "rectangle", text: "Logout", x: 200, y: 0 },
        { op: "add", type: "rectangle", text: "Help", x: 400, y: 0 },
      ]),
    );
    expect(screen.getByText("Adds 2 boxes, restyles 1 box")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      "Restyles box",
      'Adds box "Logout"',
      'Adds box "Help"',
    ]);
    // the model was told the ids and the request
    const body = JSON.parse(p!.net.requests[0].body!);
    expect(body.messages.at(-1).content).toContain(`id ${id}`);
    // nothing applied, the touched shape is shown on the canvas
    expect(p!.scene.batches).toHaveLength(0);
    expect(p!.scene.live()).toHaveLength(2);
    expect(p!.scene.scrolledTo()).toEqual([id]);

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Result").textContent).toMatch(
        /^Added 2 boxes, restyled 1 box/,
      ),
    );
    // ONE result per answer: no second "Applied" line, no key-hint sentence
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByLabelText("Result")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Applied:|Undo with/);
    expect(p!.scene.batches).toHaveLength(1);
    expect(p!.scene.live().filter((e) => e.type === "rectangle").length).toBe(
      3,
    );
    expect(screen.queryByLabelText("Proposed change")).toBeNull();
  });

  it("Discard drops the plan and writes nothing", async () => {
    await start();
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([{ op: "add", type: "ellipse" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText("Proposed change")).toBeNull();
    expect(p!.scene.batches).toHaveLength(0);
    expect(Object.keys(p!.vault.drawings())).toEqual([]);
  });

  it("the keep and discard commands do the same, and say so when nothing is proposed", async () => {
    await start();
    await p!.run("keep");
    expect(p!.toasts()).toContain(
      "AI assistant: There is no proposed change to keep",
    );
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([{ op: "add", type: "ellipse" }]),
    );
    await p!.run("keep");
    await waitFor(() => expect(p!.scene.batches).toHaveLength(1));
    await send(
      "Edit this drawing",
      /Say what to change/,
      "y",
      reply([{ op: "add", type: "ellipse" }]),
    );
    await p!.run("discard");
    expect(screen.queryByLabelText("Proposed change")).toBeNull();
    expect(p!.scene.batches).toHaveLength(1);
  });

  it("refuses to apply when the drawing changed under the plan", async () => {
    await start();
    const id = p!.scene.live()[0].id;
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([{ op: "move", id, x: 9 }]),
    );
    p!.scene.setElements([]);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /drawing changed since/,
      ),
    );
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("refuses when another drawing is now open", async () => {
    await start();
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([{ op: "add", type: "ellipse" }]),
    );
    p!.scene.switchTo("other.excalidraw");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /drawing changed since/,
      ),
    );
    expect(p!.scene.batches).toHaveLength(0);
  });

  it("a reply that is not a plan is a plain error with nothing to keep", async () => {
    await start();
    p!.net.respond = () => ({ chunks: sse("Sorry, I can't.") });
    pickMode("Edit this drawing");
    fireEvent.change(screen.getByLabelText(/Say what to change/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /not a plan I can read/,
      ),
    );
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("wrong parts are left out and said so", async () => {
    await start();
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([
        { op: "add", type: "ellipse" },
        { op: "move", id: "ghost", x: 1 },
      ]),
    );
    expect(screen.getByText(/1 part of the reply made no sense/)).toBeTruthy();
  });

  it("asks for words and for an open drawing before sending anything", async () => {
    await start();
    pickMode("Edit this drawing");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /Say what to change/,
      ),
    );
    p!.scene.switchTo(null);
    fireEvent.change(screen.getByLabelText(/Say what to change/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /Open a drawing first/,
      ),
    );
    expect(p!.net.requests).toEqual([]);
  });

  it("Offline mode blocks it in plain words and proposes nothing", async () => {
    await start();
    p!.net.offline = () => true;
    pickMode("Edit this drawing");
    fireEvent.change(screen.getByLabelText(/Say what to change/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /Offline mode is on/,
      ),
    );
    expect(p!.net.requests).toEqual([]);
  });

  it("a new request drops an old proposal", async () => {
    await start();
    await send(
      "Edit this drawing",
      /Say what to change/,
      "x",
      reply([{ op: "add", type: "ellipse" }]),
    );
    p!.net.respond = () => ({ chunks: sse("no plan") });
    fireEvent.change(screen.getByLabelText(/Say what to change/), {
      target: { value: "again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Proposed change")).toBeNull(),
    );
  });
});

describe("create a new drawing", () => {
  it("writes nothing until Keep, then creates it under a free name and opens it", async () => {
    await start();
    p!.vault.seed({ "Login flow.excalidraw": [] });
    await send(
      "New drawing",
      /Describe the new drawing/,
      "login",
      reply(
        [
          { op: "add", type: "rectangle", text: "User", ref: "u", x: 0, y: 0 },
          {
            op: "add",
            type: "rectangle",
            text: "Server",
            ref: "s",
            x: 200,
            y: 0,
          },
          { op: "add", type: "arrow", from: "u", to: "s" },
        ],
        "Login flow",
      ),
    );
    expect(screen.getByText("Adds 2 boxes and 1 arrow")).toBeTruthy();
    expect(Object.keys(p!.vault.drawings())).toEqual(["Login flow.excalidraw"]);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Result").textContent).toMatch(
        /Created "Login flow 2.excalidraw"/,
      ),
    );
    expect(
      p!.vault.drawings()["Login flow 2.excalidraw"].filter((e) => !e.isDeleted)
        .length,
    ).toBeGreaterThanOrEqual(3);
    expect(p!.workspace.opened().at(-1)?.path).toBe("Login flow 2.excalidraw");
  });

  it("the create_folder setting picks the folder", async () => {
    await start();
    await p!.setSetting("create_folder", "AI/");
    await send(
      "New drawing",
      /Describe the new drawing/,
      "x",
      reply([{ op: "add", type: "ellipse" }], "Blob"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(Object.keys(p!.vault.drawings())).toContain("AI/Blob.excalidraw"),
    );
  });
});
