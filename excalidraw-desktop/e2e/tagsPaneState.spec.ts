import { expect } from "@playwright/test";

import { test } from "./fixture";

import { reloadVault, trackErrors } from "./helpers";
import { openTagsVault, tagsPanel, tagRow } from "./tagsHelpers";

const sectionButton = (page: import("@playwright/test").Page) =>
  tagsPanel(page).getByRole("button", { name: "Tags", exact: true });

test("the Tags section stays collapsed after the vault is reloaded", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  await expect(sectionButton(page)).toHaveAttribute("aria-expanded", "true");
  await sectionButton(page).click();
  await expect(sectionButton(page)).toHaveAttribute("aria-expanded", "false");

  await reloadVault(page);
  await expect(tagsPanel(page)).toBeVisible();
  await expect(sectionButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(tagRow(page, "dsa")).toHaveCount(0);

  // Opening it again is remembered too.
  await sectionButton(page).click();
  await reloadVault(page);
  await expect(sectionButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(tagRow(page, "dsa")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a collapsed tag node stays collapsed after the vault is reloaded", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openTagsVault(page);
  await expect(tagRow(page, "dsa/graphs")).toBeVisible();
  await tagsPanel(page).getByRole("button", { name: "Collapse dsa" }).click();
  await expect(tagRow(page, "dsa/graphs")).toHaveCount(0);

  await reloadVault(page);
  await expect(tagRow(page, "dsa")).toBeVisible();
  await expect(tagRow(page, "dsa/graphs")).toHaveCount(0);
  await expect(
    tagsPanel(page).getByRole("button", { name: "Expand dsa" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const mode of ["light", "dark"] as const) {
  for (const collapsed of [true, false]) {
    test(`the first file row has room under the Tags section (${mode}, ${
      collapsed ? "collapsed" : "open"
    })`, async ({ page }) => {
      await openTagsVault(page);
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        mode === "dark",
      );
      if (collapsed) {
        await sectionButton(page).click();
      }
      const section = await tagsPanel(page).boundingBox();
      const first = await page
        .locator(".vault-tree-body .vault-tree-item")
        .first()
        .boundingBox();
      const header = await sectionButton(page).boundingBox();
      expect(section && first && header).toBeTruthy();
      // Text of the header has air above and below it inside its section ...
      expect(header!.height).toBeGreaterThanOrEqual(30);
      // ... and the first file row starts clear of the section's bottom line.
      expect(first!.y - (section!.y + section!.height)).toBeGreaterThanOrEqual(
        4,
      );
    });
  }
}
