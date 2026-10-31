import { expect, test } from "./fixture";

import { openVault } from "./helpers";

// Runs only in the "linux" project (playwright.config.ts, toimprove 325): a Linux user agent, so
// the app takes its Linux key and wording paths on any test machine. Each row is what a Linux user
// sees, and what they must NOT see (a Mac key symbol or a Mac app name).

const palette = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Command palette" });

test("the profile is Linux: the app sees a Linux platform", async ({
  page,
}) => {
  await openVault(page);
  expect(await page.evaluate(() => navigator.platform)).toMatch(/Linux/);
});

test("Ctrl+Shift+P opens the commands palette and its keys read Ctrl, never Mac symbols", async ({
  page,
}) => {
  await openVault(page);
  await page.keyboard.press("Control+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("New drawing");
  const option = palette(page).getByRole("option").first();
  await expect(option).toContainText("New drawing");
  await expect(option).toContainText("Ctrl");
  await expect(option).not.toContainText("⌘");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  // The Mac chord does nothing here.
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.waitForTimeout(300);
  await expect(palette(page)).toHaveCount(0);
});

test("Ctrl+P opens the files palette", async ({ page }) => {
  await openVault(page);
  await page.keyboard.press("Control+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the file tree menu says file manager, and Settings names Ctrl, not Cmd or Finder", async ({
  page,
}) => {
  await openVault(page);
  await page.locator('[data-tree-path="DSA"]').click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Reveal in file manager" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Finder/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Settings, Tabs: the open-in key is Ctrl+click on Linux. Ctrl+, opens Settings.
  await page.keyboard.press("Control+Comma");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Found the way a user finds it: the Settings search.
  await page.keyboard.type("Open drawings from the file tree");
  const row = dialog.locator('[data-setting-id="tabs-open-from-navigator"]');
  await expect(row).toContainText("Ctrl+click does the other one");
  await expect(dialog.getByText(/Cmd\+click/)).toHaveCount(0);
});
