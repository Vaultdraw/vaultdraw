import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import {
  canvasBox,
  openDrawing,
  openVault,
  readScene,
  trackErrors,
} from "./helpers";

// Toimprove 345, through visible UI: a "# Title" text written with Markdown
// mode off stays plain; clicking the Markdown chip turns it into a heading,
// as Obsidian shows any "# " line; one Cmd+Z brings the plain text back.
const DRAWING = "DSA/Graphs.excalidraw";
const textarea = "textarea.excalidraw-wysiwyg";
const editor = (page: Page) => page.locator(".vault-editor");
const chip = (page: Page) => editor(page).getByTestId("markdown-chip");

const textWith = async (page: Page, text: string) =>
  (await readScene(page, DRAWING)).elements.find(
    (el: any) => !el.isDeleted && el.type === "text" && el.text === text,
  );

test("Markdown chip: text written before the mode was on becomes a heading; Cmd+Z restores it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await page
    .locator(".vault-tree-item__name", { hasText: "DSA" })
    .first()
    .click();
  await openDrawing(page, "Graphs");
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");

  // mode off: "# Title" is typed as plain text
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.8);
  await expect(page.locator(textarea)).toBeFocused();
  await page.keyboard.type("# Title", { delay: 20 });
  await expect(page.locator(textarea)).toHaveValue("# Title");
  await page.keyboard.press("Escape");
  await expect(page.locator(textarea)).toHaveCount(0);
  await expect
    .poll(async () => !!(await textWith(page, "# Title")), { timeout: 10_000 })
    .toBe(true);
  const plain = await textWith(page, "# Title");

  // the chip turns the mode on, and the text already there converts
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await textWith(page, "Title"))?.customData?.role, {
      timeout: 10_000,
    })
    .toBe("h1");
  const title = await textWith(page, "Title");
  expect(title.id).toBe(plain.id);
  expect(title.fontSize).toBe(plain.fontSize * 2);

  // one undo step brings the plain text back
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.95);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => !!(await textWith(page, "# Title")), { timeout: 10_000 })
    .toBe(true);
  expect((await textWith(page, "# Title")).customData?.role).toBeUndefined();
  // the mode stays on: undo only took the conversion back
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");

  expect(errors).toEqual([]);
});
