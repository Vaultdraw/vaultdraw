import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";
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
