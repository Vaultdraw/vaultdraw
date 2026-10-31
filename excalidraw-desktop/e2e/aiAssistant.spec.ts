import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
import { live, seedAndOpen } from "./pageHelpers";

// The AI assistant, reached the way a user does: it is off, so its commands are not in the palette;
// turn it on in Settings, Plugins (an official plugin needs no consent dialog); ask without a key
// (plain message, nothing sent); save a key; ask a question and watch the answer stream in from a
// scripted provider (no real network); see that the key never travelled with the request; stop an
// answer; Offline mode blocks it in plain words.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const options = (page: Page) => palette(page).getByRole("option");

const run = async (page: Page, query: string, title: RegExp) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(options(page).filter({ hasText: title }).first()).toBeVisible();
  await page.keyboard.press("Enter");
};

const base = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
  updated: 1,
  locked: false,
};
const text = (id: string, y: number, t: string) => ({
  ...base,
  id,
  type: "text",
  x: 60,
  y,
  width: 150,
  height: 25,
  seed: 1,
  text: t,
  originalText: t,
  fontSize: 20,
  fontFamily: 2,
  textAlign: "left",
  verticalAlign: "top",
  containerId: null,
  autoResize: true,
  lineHeight: 1.25,
  link: null,
  boundElements: null,
});

const KEY = "sk-ant-e2e-SECRET-9876";

test("AI assistant: turn it on, save a key, ask, stream, stop, offline", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=ai-assistant&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Plan.excalidraw", {
    elements: [text("a", 60, "Login page"), text("b", 130, "Checkout page")],
  });

  // Off: nothing of it in the palette.
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("AI: Ask");
  await expect(options(page).filter({ hasText: /^AI:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // On, through Settings, Plugins.
  await run(page, "open plugin settings", /Plugins: Open plugin settings/);
  await expect(page.getByTestId("plugins-page")).toBeVisible();
  const row = page.getByTestId("plugin-ai-assistant");
  await row
    .getByRole("switch", { name: "Enable AI assistant" })
    .click({ force: true });
  await expect(
    row.getByRole("switch", { name: "Enable AI assistant" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");

  // The scripted provider (Anthropic's stream format) and what it saw.
  await page.evaluate(() => {
    const net = (window as any).__plugins.backend.net;
    net.respond = () => ({
      chunks: [
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Two pages: "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"login and checkout."}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ],
      chunkDelayMs: 30,
    });
  });

  await run(page, "AI: Ask about", /AI: Ask about this drawing/);
  const input = page.getByLabel("Ask about this drawing");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // No key yet: a plain message and nothing is sent.
  await input.fill("What pages are there?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("No API key is saved");
  expect(
    await page.evaluate(
      () => (window as any).__plugins.backend.net.requests.length,
    ),
  ).toBe(0);

  // Save the key; it is hidden and not shown again.
  await page.getByText("Key and provider").click();
  const keyBox = page.getByLabel("API key");
  await expect(keyBox).toHaveAttribute("type", "password");
  await keyBox.fill(KEY);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("A key is saved on this computer")).toBeVisible();
  await expect(keyBox).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(KEY);

  // Ask: the answer streams in, and the request carries the drawing's text but not the key.
  await input.fill("What pages are there?");
  await page.getByLabel("Show what is sent").check();
  await expect(page.getByLabel("What is sent", { exact: true })).toContainText(
    "Login page",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Two pages: login and checkout.")).toBeVisible({
    timeout: 10_000,
  });
  const sent = await page.evaluate(() => {
    const r = (window as any).__plugins.backend.net.requests[0];
    return {
      ...r,
      authValue: r.authHeader?.value,
      authHeader: r.authHeader?.name,
    };
  });
  expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
  expect(sent.authHeader).toBe("x-api-key");
  expect(sent.authValue).toBe(KEY);
  expect(JSON.stringify({ ...sent, authValue: undefined })).not.toContain(KEY);
  expect(sent.body).toContain("Checkout page");

  // Stop a slow answer: what arrived stays, and no error shows.
  await page.evaluate(() => {
    (window as any).__plugins.backend.net.respond = () => ({
      chunks: Array.from(
        { length: 30 },
        (_, i) =>
          `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"w${i} "}}\n\n`,
      ),
      chunkDelayMs: 60,
    });
  });
  await input.fill("Long answer please");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText(/w2 /)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/w29 /)).toHaveCount(0);

  // Offline mode: plain words, nothing reaches another computer.
  await page.evaluate(() => {
    const backend = (window as any).__plugins.backend;
    backend.net.requests.length = 0;
    backend.net.offline = () => true;
  });
  await input.fill("Again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("Offline mode is on");
  expect(
    await page.evaluate(
      () => (window as any).__plugins.backend.net.requests.length,
    ),
  ).toBe(0);

  expect(errors).toEqual([]);
});

test("AI assistant: Summarise this note reads the note in the open tab, and leaves it unchanged", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=obsidian&plugins=ai-assistant");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await page.evaluate(() => {
    const net = (window as any).__plugins.backend.net;
    net.secrets["ai-assistant"] = { "api-key": "sk-ant-e2e-NOTE-1111" };
    net.respond = () => ({
      chunks: [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A welcome note."}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ],
    });
  });
  const before = await page.evaluate(() =>
    (window as any).__noteFiles.textOf("Welcome.md"),
  );

  // Open the note from the file list, then summarise it from the palette.
  await page
    .locator(".vault-tree-item__name", { hasText: "Welcome" })
    .first()
    .click();
  await expect(page.getByText("See", { exact: false }).first()).toBeVisible();
  await run(page, "AI: Summarise", /AI: Summarise this note/);
  await expect(page.getByText("A welcome note.")).toBeVisible({
    timeout: 10_000,
  });
  const sent = await page.evaluate(
    () => (window as any).__plugins.backend.net.requests[0].body as string,
  );
  expect(sent).toContain("[[Ideas#Later]]");
  expect(sent).toContain("#welcome");
  // The note on disk is exactly what it was.
  expect(
    await page.evaluate(() => (window as any).__noteFiles.textOf("Welcome.md")),
  ).toBe(before);
  expect(errors).toEqual([]);
});

test("AI assistant: an edit is proposed first, Discard changes nothing, Keep applies it and one undo removes it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=ai-assistant");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Plan.excalidraw", {
    elements: [text("a", 60, "Login page"), text("b", 130, "Checkout page")],
  });
  const plan = JSON.stringify({
    title: "More boxes",
    ops: [
      { op: "add", type: "rectangle", text: "Logout", x: 300, y: 60 },
      { op: "move", id: "b", x: 400, y: 200 },
    ],
  });
  await page.evaluate((reply) => {
    const net = (window as any).__plugins.backend.net;
    net.secrets["ai-assistant"] = { "api-key": "sk-ant-e2e-EDIT-2222" };
    net.respond = () => ({
      chunks: [
        `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(
          `\`\`\`json\n${reply}\n\`\`\``,
        )}}}\n\n`,
        'data: {"type":"message_stop"}\n\n',
      ],
    });
  }, plan);
  const count = async () => (await live(page)).elements.length;
  expect(await count()).toBe(2);

  const propose = async () => {
    await run(page, "AI: Edit this", /AI: Edit this drawing/);
    const input = page.getByLabel(/Say what to change/);
    await expect(input).toBeFocused();
    await input.fill("Add a Logout box and move the checkout text");
    await page.getByRole("button", { name: "Send" }).click();
    const card = page.getByLabel("Proposed change");
    await expect(card).toContainText("Adds 1 box, moves 1 text", {
      timeout: 10_000,
    });
    await expect(card.getByRole("listitem")).toHaveText([
      'Adds box "Logout"',
      'Moves text "Checkout page"',
    ]);
    await expect(
      card.getByRole("img", { name: "Preview of the change" }),
    ).toBeVisible();
    // Shown, not applied.
    expect(await count()).toBe(2);
    return card;
  };

  // Discard: nothing changes.
  let card = await propose();
  await card.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Proposed change")).toHaveCount(0);
  expect(await count()).toBe(2);

  // Keep through its palette command: applied at once as one change.
  card = await propose();
  await run(page, "AI: Keep", /AI: Keep the proposed change/);
  await expect(page.locator(".vd-ai-kept")).toContainText(
    "Applied: Adds 1 box, moves 1 text",
  );
  expect(await count()).toBeGreaterThan(2);
  const moved = (await live(page)).elements.find((e) => e.id === "b");
  expect(Math.round(moved!.x)).toBe(400);

  // One undo takes the whole change back.
  // Focus the editor without clicking (a click would add its own selection change).
  await page.evaluate(() =>
    (document.querySelector(".excalidraw") as HTMLElement).focus(),
  );
  await page.keyboard.press("Meta+KeyZ");
  await expect.poll(count).toBe(2);
  expect(
    Math.round((await live(page)).elements.find((e) => e.id === "b")!.x),
  ).toBe(60);
  expect(errors).toEqual([]);
});
