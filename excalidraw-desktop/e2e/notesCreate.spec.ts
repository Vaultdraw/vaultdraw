import { type Page } from "@playwright/test";

import { expect, test } from "./fixture";

import { openVault } from "./helpers";
import { runCommand } from "./pageHelpers";

// toimprove 182 (hunter F-8): notes can be made and copied from the app, as in Obsidian
// (New note in the folder menu and the palette, Make a copy on a note). Reached by clicking.

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const textOf = (page: Page, path: string) =>
  page.evaluate(
    (p) => (window as any).__noteFiles.textOf(p) as string | undefined,
    path,
  );

test("folder menu New note: names it, adds .md, opens it; Cancel and Esc make nothing", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  // Esc and Cancel leave the vault unchanged.
  for (const close of ["Escape", "Cancel"]) {
    await row(page, "Daily").click({ button: "right" });
    await page.getByRole("menuitem", { name: "New note" }).click();
    const dialog = page.getByRole("dialog", { name: "New note in /Daily" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Extension .md will be added")).toBeVisible();
    if (close === "Escape") {
      await page.keyboard.press("Escape");
    } else {
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }
    await expect(dialog).toHaveCount(0);
  }
  expect(await textOf(page, "Daily/Plan.md")).toBeUndefined();

  await row(page, "Daily").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note" }).click();
  const dialog = page.getByRole("dialog", { name: "New note in /Daily" });
  await dialog.getByLabel("Name").fill("Plan");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, "Daily/Plan.md")).toBeVisible();
  expect(await textOf(page, "Daily/Plan.md")).toBe("");
  // It opened: the note view shows its name.
  await expect(page.getByRole("tab", { name: /Plan/ }).first()).toBeVisible();

  // The same name again is refused in the dialog; the existing note is untouched.
  await row(page, "Daily").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note" }).click();
  await dialog.getByLabel("Name").fill("Plan.md");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.locator(".vault-error-text")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await textOf(page, "Daily/Plan.md")).toBe("");
});

test("note Duplicate copies the text to 'Ideas copy.md' and keeps the original; drawings still duplicate", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  const before = await textOf(page, "Ideas.md");
  expect(before?.length).toBeGreaterThan(0);
  await row(page, "Ideas.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(row(page, "Ideas copy.md")).toBeVisible();
  expect(await textOf(page, "Ideas copy.md")).toBe(before);
  expect(await textOf(page, "Ideas.md")).toBe(before);
  // A second copy gets the next free name.
  await row(page, "Ideas.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(row(page, "Ideas copy 2.md")).toBeVisible();
  // An Obsidian drawing (.excalidraw.md) is not a note: its menu has no note Duplicate.
  await row(page, "Drawings").click();
  await row(page, "Drawings/Plugin Sketch.excalidraw.md").click({
    button: "right",
  });
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
});

test("palette New note makes Untitled.md, then Untitled 1.md; never replaces a note", async ({
  page,
}) => {
  await openVault(page, "?seed=obsidian");
  await runCommand(page, "New note");
  await expect(row(page, "Untitled.md")).toBeVisible();
  expect(await textOf(page, "Untitled.md")).toBe("");
  await runCommand(page, "New note");
  await expect(row(page, "Untitled 1.md")).toBeVisible();
  await expect(page.locator(".vault-global-alert")).toHaveCount(0);
});
