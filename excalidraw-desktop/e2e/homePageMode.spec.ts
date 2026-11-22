import { expect } from "@playwright/test";

import { test } from "./fixture";

import { enterVault, reloadVault, trackErrors } from "./helpers";

// interface.home_page: Settings > Interface > Start page chooses what shows
// when no drawing is open (full, actions only, blank), at once and after reload.
test("Settings > Interface > Start page switches the home pane to minimal and blank", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/e2e.html");
  await enterVault(page);
  const pane = page.locator(".vault-home");
  await expect(pane).toHaveAttribute("data-home-page", "full");
  await expect(
    pane.getByRole("heading", { name: /No drawing open/i }),
  ).toBeVisible();

  await page
    .getByTestId("activity-bar")
    .locator('button[data-entry="settings"]')
    .click();
  await page.getByRole("tab", { name: "Interface" }).click();
  const select = page.getByLabel("Start page");
  await select.scrollIntoViewIfNeeded();
  await expect(select).toHaveValue("full");

  await select.selectOption("minimal");
  await page.keyboard.press("Escape");
  await expect(pane).toHaveAttribute("data-home-page", "minimal");
  await expect(pane.locator(".vault-home__action").first()).toBeVisible();
  await expect(pane.getByLabel("Recent drawings")).toHaveCount(0);

  await page
    .getByTestId("activity-bar")
    .locator('button[data-entry="settings"]')
    .click();
  await page.getByRole("tab", { name: "Interface" }).click();
  await page.getByLabel("Start page").selectOption("blank");
  await page.keyboard.press("Escape");
  await expect(pane).toHaveAttribute("data-home-page", "blank");
  await expect(pane.getByRole("button")).toHaveCount(0);
  await expect(pane).toHaveText("");

  await reloadVault(page);
  await expect(page.locator(".vault-home")).toHaveAttribute(
    "data-home-page",
    "blank",
  );
  expect(errors).toEqual([]);
});
