import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { enterVault, openDrawing, reloadVault, trackErrors } from "./helpers";

// interface.font_size / interface.font_family: Settings > Interface changes the
// UI text (file tree, tabs) at once and after reload; drawings, the editor's
// own toolbar and notes keep theirs; the biggest size clips no tree label.

const style = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        size: cs.fontSize,
        family: cs.fontFamily,
        height: (el as HTMLElement).getBoundingClientRect().height,
      };
    });

const openInterfaceSettings = async (page: Page) => {
  await page
    .getByTestId("activity-bar")
    .locator('button[data-entry="settings"]')
    .click();
  await page.getByRole("tab", { name: "Interface" }).click();
};

test("Settings > Interface font size and font restyle the UI, not the drawing", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/e2e.html");
  await enterVault(page);

  const dsa = page.getByRole("treeitem", { name: /DSA/ }).first();
  if ((await dsa.getAttribute("aria-expanded")) === "false") {
    await dsa.locator(".vault-tree-item__name").first().click();
  }
  await openDrawing(page, "Graphs");

  const before = await style(page, ".vault-tree-item");
  expect(before.size).toBe("13px");
  expect(before.height).toBe(26);
  const editorBefore = await style(page, ".vault-editor .excalidraw");
  const tabBefore = await style(page, ".vault-tabs__name");

  await openInterfaceSettings(page);
  const size = page.getByRole("spinbutton", { name: "Interface font size" });
  await size.scrollIntoViewIfNeeded();
  await expect(size).toHaveValue("13 px");
  await size.fill("20");
  await size.press("Enter");
  await expect(size).toHaveValue("20 px");

  const font = page.getByLabel("Interface font", { exact: true });
  await font.selectOption({ label: "Monospace" });
  await page.keyboard.press("Escape");

  const tree = await style(page, ".vault-tree-item");
  expect(tree.size).toBe("20px");
  expect(tree.height).toBe(40);
  expect(tree.family).toMatch(/^ui-monospace/);
  const tab = await style(page, ".vault-tabs__name");
  expect(parseFloat(tab.size)).toBeGreaterThan(parseFloat(tabBefore.size));
  expect(tab.family).toMatch(/^ui-monospace/);

  // Excalidraw's own editor UI and the drawing are untouched.
  const editor = await style(page, ".vault-editor .excalidraw");
  expect(editor.family).toBe(editorBefore.family);
  expect(editor.size).toBe(editorBefore.size);

  // No tree label is clipped vertically, and the tree has no sideways scroll.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".vault-tree-item")]
      .filter((row) => row.offsetParent)
      .flatMap((row) =>
        [row, ...row.querySelectorAll<HTMLElement>("*")].filter(
          (el) => el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0,
        ),
      )
      .map((el) => el.className || el.tagName),
  );
  expect(clipped).toEqual([]);
  const sideways = await page
    .locator(".vault-tree-container")
    .first()
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(sideways).toBe(false);

  // Survives a reload.
  await reloadVault(page);
  const reloaded = await style(page, ".vault-tree-item");
  expect(reloaded.size).toBe("20px");
  expect(reloaded.family).toMatch(/^ui-monospace/);

  // Reset from Settings puts today's look back exactly.
  await openInterfaceSettings(page);
  await page.getByRole("button", { name: "Reset Interface font size" }).click();
  await page.getByLabel("Interface font", { exact: true }).selectOption({
    label: "Default (Assistant)",
  });
  await page.keyboard.press("Escape");
  const back = await style(page, ".vault-tree-item");
  expect(back.size).toBe("13px");
  expect(back.height).toBe(26);
  expect(back.family).toBe(before.family);
  expect(errors).toEqual([]);
});
