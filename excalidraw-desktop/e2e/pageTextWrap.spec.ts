import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, readScene, reloadVault, trackErrors } from "./helpers";
import { AFTER_AUTOSAVE_MS } from "./constants";
import { A4, live, seedAndOpen, setupOf, toClient } from "./pageHelpers";

// toimprove 340: in page mode, text never runs past the page edge; it wraps at the margin.
// Reached the way a user does: the text tool and typing, and a paste.

const LONG =
  "The quick brown fox jumps over the lazy dog and keeps running across the whole page without any pause ".repeat(
    3,
  );

const texts = async (page: Page) =>
  (await live(page)).elements.filter((e) => e.type === "text");

const pasteText = (page: Page, text: string) =>
  page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);

const modes = [
  { name: "light", dark: false },
  { name: "dark", dark: true },
];

for (const m of modes) {
  test.describe(`page text wrap (${m.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: m.dark ? "dark" : "light" });
    });

    for (const [label, x] of [
      ["near the left margin", 60],
      ["mid page", 400],
      ["near the right edge", 700],
    ] as const) {
      test(`typing a long line ${label} wraps inside the page`, async ({
        page,
      }) => {
        const errors = trackErrors(page);
        await openVault(page);
        await seedAndOpen(page, "Wrap.excalidraw", { pageSetup: setupOf() });
        const at = await toClient(page, x, 200);
        await page.keyboard.press("t");
        await page.mouse.click(at.x, at.y);
        await page.keyboard.type(LONG, { delay: 0 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        const t = await texts(page);
        expect(t.length).toBe(1);
        expect(t[0].x).toBeGreaterThanOrEqual(-0.5);
        expect(t[0].x + t[0].width).toBeLessThanOrEqual(A4.width + 0.5);
        expect(t[0].height).toBeGreaterThan(40); // it wrapped onto lines
        expect(errors).toEqual([]);
      });
    }

    test("pasting long text wraps inside the page", async ({ page }) => {
      const errors = trackErrors(page);
      await openVault(page);
      await seedAndOpen(page, "WrapPaste.excalidraw", {
        pageSetup: setupOf({ size: "a5", width: 559, height: 794 }),
      });
      const at = await toClient(page, 300, 200);
      await page.mouse.move(at.x, at.y);
      await page.mouse.click(at.x, at.y);
      await pasteText(page, LONG);
      await page.waitForTimeout(700);
      const t = await texts(page);
      expect(t.length).toBe(1);
      expect(t[0].x).toBeGreaterThanOrEqual(-0.5);
      expect(t[0].x + t[0].width).toBeLessThanOrEqual(559 + 0.5);
      expect(errors).toEqual([]);
    });

    test("after a reload the saved text stays wrapped", async ({ page }) => {
      const errors = trackErrors(page);
      await openVault(page);
      await seedAndOpen(page, "WrapUndo.excalidraw", { pageSetup: setupOf() });
      const at = await toClient(page, 500, 200);
      await page.keyboard.press("t");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.type(LONG, { delay: 0 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(AFTER_AUTOSAVE_MS);
      const wrapped = await texts(page);
      expect(wrapped.length).toBe(1);
      const width = wrapped[0].width;
      expect(wrapped[0].x + width).toBeLessThanOrEqual(A4.width + 0.5);

      // reload: the e2e vault lives in memory, so the saved file is put back as it was written;
      // the text must open as the same wrapped box
      const savedTexts = async () =>
        (
          (await readScene(page, "WrapUndo.excalidraw")).elements as any[]
        ).filter((e) => !e.isDeleted && e.type === "text");
      await expect
        .poll(async () => (await savedTexts()).length, {
          timeout: 15_000,
        })
        .toBe(1);
      const file = await readScene(page, "WrapUndo.excalidraw");
      const saved = (file.elements as any[]).filter(
        (e) => !e.isDeleted && e.type === "text",
      );
      expect(saved.length).toBe(1);
      expect(saved[0].x + saved[0].width).toBeLessThanOrEqual(A4.width + 0.5);
      expect(saved[0].width).toBeCloseTo(width, 0);
      await reloadVault(page);
      await seedAndOpen(page, "WrapReload.excalidraw", {
        pageSetup: setupOf(),
        elements: file.elements as unknown[],
      });
      const reopened = await texts(page);
      expect(reopened.length).toBe(1);
      expect(reopened[0].width).toBeCloseTo(width, 0);
      expect(reopened[0].height).toBeCloseTo(wrapped[0].height, 0);
      expect(reopened[0].x + reopened[0].width).toBeLessThanOrEqual(
        A4.width + 0.5,
      );
      expect(errors).toEqual([]);
    });

    test("undo takes the typed text away again", async ({ page }) => {
      await openVault(page);
      await seedAndOpen(page, "WrapUndo2.excalidraw", { pageSetup: setupOf() });
      const at = await toClient(page, 500, 200);
      await page.keyboard.press("t");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.type(LONG, { delay: 0 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      expect((await texts(page)).length).toBe(1);
      // undo takes the text out again
      await page.keyboard.press(`Meta+z`);
      await page.waitForTimeout(500);
      expect((await texts(page)).length).toBe(0);
    });

    test("outside page mode a long line is NOT capped to a page", async ({
      page,
    }) => {
      await openVault(page);
      await seedAndOpen(page, "Free.excalidraw", {});
      const at = await toClient(page, 100, 200);
      await page.keyboard.press("t");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.type(LONG, { delay: 0 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const t = await texts(page);
      expect(t.length).toBe(1);
      expect(t[0].width).toBeGreaterThan(300);
    });
  });
}
