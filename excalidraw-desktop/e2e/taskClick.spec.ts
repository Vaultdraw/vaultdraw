import { expect } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault, readScene } from "./helpers";

// Toimprove 369: a click on a ☐ box in canvas text ticks it.
const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";

const taskText = async (page: any) =>
  (await readScene(page, DRAWING)).elements.find(
    (el: any) => !el.isDeleted && el.type === "text" && el.text.includes("two"),
  );

test("clicking a task box on the canvas ticks that line", async ({ page }) => {
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  const editor = page.locator(".vault-editor");
  await editor.getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.7;
  await page.mouse.click(x0, y0);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("☐ one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("☐ two");
  await page.keyboard.press("Escape");
  await expect.poll(async () => !!(await taskText(page))).toBe(true);
  const el = await taskText(page);
  await page.keyboard.press("Escape");
  // second line's box: the text's left edge, one line down
  const lineH = el.height / 2;
  const bx = x0 + 6;
  const by = y0 - lineH / 2 + lineH * 1.5;
  const canvas = page.locator("canvas.interactive").first();
  // a hand pointer over the box, the editor's own pointer over the words
  await page.mouse.move(bx, by);
  await expect(canvas).toHaveCSS("cursor", "pointer");
  await page.mouse.click(bx, by);
  await expect
    .poll(async () => (await taskText(page))?.text, { timeout: 5000 })
    .toBe("☐ one\n☑ two");
});
