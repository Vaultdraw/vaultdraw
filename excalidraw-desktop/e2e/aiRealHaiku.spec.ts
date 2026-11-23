/* eslint-disable no-console -- this opt-in real-model run reports its call count and replies to the person running it */
import { writeFileSync } from "node:fs";

import { type Page } from "@playwright/test";

import { expect, test } from "./fixture";
import {
  realCallCount,
  realCalls,
  bridgeRealClaude,
} from "./helpers/realClaude";

import { openVault, trackErrors } from "./helpers";
import { seedAndOpen } from "./pageHelpers";

// ONE end-to-end test of the AI assistant against the REAL Haiku model, through the real `claude`
// command line (bridge: e2e/helpers/realClaude.ts, at most 5 calls in total). Skipped unless
// AI_REAL=1, so a normal run never calls a model. Headless. Screenshots and the scene facts go to
// personal/feature/ai-realtest/.

const OUT = "/Users/kalon/Opensource/vaultdraw/personal/feature/ai-realtest";

test.skip(process.env.AI_REAL !== "1", "real model test: set AI_REAL=1");

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const run = async (page: Page, query: string, title: RegExp) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(
    palette(page).getByRole("option").filter({ hasText: title }).first(),
  ).toBeVisible();
  await page.keyboard.press("Enter");
};

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  containerId?: string | null;
  boundIds: string[];
  hasStart: boolean;
  hasEnd: boolean;
};

/** Every non-deleted element of the live scene, with text and bindings. */
const scene = (page: Page): Promise<El[]> =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.state && s.scene && typeof s.state.scrollX === "number") {
        return s.scene.getNonDeletedElements().map((e: any) => ({
          id: e.id,
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          text: e.text,
          containerId: e.containerId ?? null,
          boundIds: (e.boundElements ?? []).map((b: any) => b.id),
          hasStart: !!e.startBinding,
          hasEnd: !!e.endBinding,
        }));
      }
      fiber = fiber.return;
    }
    throw new Error("editor instance not found");
  });

const facts = (els: El[]) => {
  const byId = new Map(els.map((e) => [e.id, e]));
  const texts = els.filter((e) => e.type === "text");
  const arrows = els.filter((e) => e.type === "arrow");
  const labelled = arrows.filter((a) =>
    texts.some((t) => t.containerId === a.id),
  );
  // free text (headings, paragraphs): not inside a shape or arrow
  const free = texts.filter((t) => !t.containerId);
  const shapes = els.filter((e) =>
    ["rectangle", "diamond", "ellipse"].includes(e.type),
  );
  // what must not overlap: every drawn thing except arrows/lines and text that lives inside a shape
  const solids = els.filter(
    (e) =>
      e.type !== "arrow" &&
      e.type !== "line" &&
      !(e.type === "text" && e.containerId && byId.has(e.containerId)),
  );
  const overlaps: string[] = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i];
      const b = solids[j];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      // a note's text sits fully inside its box by design: containment is not an overlap
      const inside = (p: El, q: El) =>
        p.x >= q.x - 1 &&
        p.y >= q.y - 1 &&
        p.x + p.width <= q.x + q.width + 1 &&
        p.y + p.height <= q.y + q.height + 1;
      if (w > 1 && h > 1 && !inside(a, b) && !inside(b, a)) {
        overlaps.push(
          `${a.type}:${(a.text ?? "").slice(0, 20)} x ${b.type}:${(
            b.text ?? ""
          ).slice(0, 20)}`,
        );
      }
    }
  }
  return {
    total: els.length,
    texts: texts.length,
    free: free.length,
    shapes: shapes.length,
    arrows: arrows.length,
    labelledArrows: labelled.length,
    arrowLabels: labelled.map(
      (a) => texts.find((t) => t.containerId === a.id)!.text,
    ),
    overlaps,
  };
};

const sig = (els: El[]) =>
  JSON.stringify(
    els
      .map((e) => [e.id, e.type, Math.round(e.x), Math.round(e.y), e.text])
      .sort(),
  );

let askedFirst = 0;

/** One chat turn: type, send, wait for the answer, the applied result and the review to finish. */
const ask = async (page: Page, message: string) => {
  const box = page.getByLabel("Ask, explain, draw or change anything");
  await box.fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByLabel("Proposed change");
  const result = page.getByLabel("Result");
  await expect(card.or(result.last())).toBeVisible({ timeout: 180_000 });
  if (await card.isVisible()) {
    // the permission was still "Ask first": keep the change (same as Apply at once for the scene)
    askedFirst++;
    await card.getByRole("button", { name: "Keep" }).click();
    await expect(result.last()).toBeVisible({ timeout: 30_000 });
  }
  // done: the Send button is back and no new call starts for 4 seconds in a row
  let stable = 0;
  let last = realCallCount();
  for (let i = 0; i < 100 && stable < 4; i++) {
    await page.waitForTimeout(1000);
    const sendBack = await page
      .getByRole("button", { name: "Send" })
      .isVisible();
    const n = realCallCount();
    stable = sendBack && n === last ? stable + 1 : 0;
    last = n;
  }
};

const shot = async (page: Page, name: string) => {
  await page.evaluate(() =>
    (document.querySelector(".excalidraw") as HTMLElement)?.focus(),
  );
  await page.keyboard.press("Shift+Digit1"); // zoom to fit, so the whole result is in the picture
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

test("AI assistant against real Haiku: teach me networking, make the diagram more descriptive, undo", async ({
  page,
}) => {
  test.setTimeout(14 * 60_000);
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1400, height: 1700 });
  await openVault(page, "?plugins=ai-assistant&enabled=none");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Networking.excalidraw", { elements: [] });
  await run(page, "open plugin settings", /Plugins: Open plugin settings/);
  const row = page.getByTestId("plugin-ai-assistant");
  await row
    .getByRole("switch", { name: "Enable AI assistant" })
    .click({ force: true });
  await expect(
    row.getByRole("switch", { name: "Enable AI assistant" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");

  await bridgeRealClaude(page);
  await run(page, "AI: Open the assistant", /AI: Open the assistant/);
  await expect(
    page.getByLabel("Ask, explain, draw or change anything"),
  ).toBeVisible();

  // Apply at once, through the panel's Permission menu.
  await page.getByRole("button", { name: "Permission" }).click();
  await page.getByRole("option", { name: /^Apply at once/ }).click();
  const permission = await page
    .getByRole("button", { name: "Permission" })
    .getAttribute("title");
  console.log(`PERMISSION AFTER PICK: ${permission}`);
  expect
    .soft(permission, "permission is Apply at once")
    .toContain("Apply at once");

  // 1. Teach me networking.
  const before0 = await scene(page);
  await ask(page, "teach me networking");
  const s1 = await scene(page);
  const f1 = facts(s1);
  await shot(page, "1-after-teach-me-networking");
  const calls1 = realCallCount();

  // 2. Make the diagram more descriptive.
  await ask(page, "make the diagram more descriptive");
  const s2 = await scene(page);
  const f2 = facts(s2);
  await shot(page, "2-after-more-descriptive");
  const calls2 = realCallCount();
  const tidied = await page.getByText(/^Tidied up/).count();

  // 3. Undo once, from the Undo button on the last result.
  await page.getByRole("button", { name: "Undo" }).last().click();
  await page.waitForTimeout(800);
  const s3 = await scene(page);
  await shot(page, "3-after-undo");

  const report = {
    realCalls: realCallCount(),
    keptFromCard: askedFirst,
    callsAfterTurn1: calls1,
    callsAfterTurn2: calls2,
    reviewImagesSent: realCalls.map((c) => c.withImages),
    tidiedUpLines: tidied,
    before: before0.length,
    turn1: f1,
    turn2: f2,
    afterUndo: { total: s3.length, sameAsTurn1: sig(s3) === sig(s1) },
    calls: realCalls.map((c) => ({
      n: c.n,
      ms: c.ms,
      images: c.withImages,
      isError: c.isError,
      stderr: c.stderr,
      prompt: c.prompt.slice(0, 300),
      reply: c.text,
    })),
  };
  writeFileSync(`${OUT}/run-report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/scene-turn1.json`, JSON.stringify(s1, null, 2));
  writeFileSync(`${OUT}/scene-turn2.json`, JSON.stringify(s2, null, 2));
  console.log(`REAL CALLS USED: ${realCallCount()} of 5`);
  console.log(
    `REVIEW RAN: ${realCalls.some(
      (c) => c.withImages > 0,
    )} (calls with images: ${realCalls
      .filter((c) => c.withImages > 0)
      .map((c) => c.n)})`,
  );
  console.log(JSON.stringify({ turn1: f1, turn2: f2 }, null, 1));

  expect.soft(realCallCount()).toBeLessThanOrEqual(5);
  expect.soft(f1.free, "headings/texts added").toBeGreaterThanOrEqual(3);
  expect
    .soft(f1.labelledArrows, "arrows with a bound label after turn 1")
    .toBeGreaterThanOrEqual(1);
  expect.soft(f1.overlaps, "overlaps after turn 1").toEqual([]);
  expect
    .soft(
      f2.total > f1.total ||
        f2.arrowLabels.join("|").length > f1.arrowLabels.join("|").length ||
        sig(s2) !== sig(s1),
      "the diagram changed",
    )
    .toBe(true);
  expect.soft(f2.overlaps, "overlaps after turn 2").toEqual([]);
  expect.soft(sig(s3), "undo changed the scene").not.toBe(sig(s2));
  if (tidied === 0) {
    expect.soft(sig(s3), "undo restores the state before turn 2").toBe(sig(s1));
  }
  expect(errors).toEqual([]);
});
