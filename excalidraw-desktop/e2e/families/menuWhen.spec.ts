import { expect } from "@playwright/test";

import { test } from "../fixture";

import { openVault, trackErrors } from "../helpers";
import { seedAndOpen } from "../pageHelpers";

// Family: a menu item for a state-dependent action shows only where it can act
// (review-fixes-1030, item 1). A drawing the user made is not an imported note.
test("a hand-made drawing's row menu and tab menu hide the import actions", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?plugins=markdown-import");
  await page.waitForFunction(() => (window as any).__pluginsReady === true);
  await seedAndOpen(page, "Mine.excalidraw");
  const row = page.locator(
    '.vault-tree-container .vault-tree-item[data-tree-path="Mine.excalidraw"]',
  );
  await row.click({ button: "right" });
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeVisible();
  await page.waitForTimeout(500); // file facts have answered by now
  await expect(
    page.getByRole("menuitem", { name: "Re-import from its Markdown" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Update to my theme and font anyway" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.locator('[role="tab"]').first().click({ button: "right" });
  await expect(page.getByTestId("vault-tab-menu")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("menuitem", { name: "Re-import from its Markdown" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
