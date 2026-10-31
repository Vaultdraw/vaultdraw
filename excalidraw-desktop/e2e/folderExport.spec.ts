/**
 * Export to a folder (F31) and export of a selection (F13), through visible
 * UI: the folder menu, the selection menu, the palette. SCENARIOS.md X11-X16.
 * The fake folder picker answers "/Users/me/Exports"; files land in
 * `__vaultRepo.exportFolder` by relative path.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

const row = (page: Page, path: string): Locator =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );
const dialog = (page: Page) => page.getByTestId("batch-export-dialog");
const written = (page: Page) =>
  page.evaluate(() =>
    [...(window as any).__vaultRepo.exportFolder.keys()].sort(),
  );

const expand = async (page: Page, path: string) => {
  const r = row(page, path);
  if ((await r.getAttribute("aria-expanded")) !== "true") {
    await r.locator(".vault-tree-item__toggle").click();
  }
  await expect(r).toHaveAttribute("aria-expanded", "true");
};

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = trackErrors(page);
  await openVault(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("X11 folder menu: Export folder… writes every drawing, subfolders mirrored", async ({
  page,
}) => {
  await row(page, "DSA").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export folder…" }).click();
  await expect(dialog(page)).toContainText("Export the folder “DSA”");
  await expect(dialog(page).getByLabel("Include subfolders")).toBeChecked();
  await dialog(page)
    .getByRole("button", { name: "Choose folder and export…" })
    .click();
  await expect(page.getByTestId("batch-export-result")).toContainText(
    "Exported 2 drawings to /Users/me/Exports.",
  );
  expect(await written(page)).toEqual([
    "Dynamic Programming/01 Introduction.png",
    "Graphs.png",
  ]);
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("X12 SVG without subfolders; exporting again keeps both copies", async ({
  page,
}) => {
  for (const round of [1, 2]) {
    await row(page, "DSA").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Export folder…" }).click();
    await dialog(page).getByLabel("SVG").check();
    await dialog(page).getByLabel("Include subfolders").uncheck();
    await dialog(page)
      .getByRole("button", { name: "Choose folder and export…" })
      .click();
    await expect(page.getByTestId("batch-export-result")).toContainText(
      "Exported 1 drawing",
    );
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await written(page)).length).toBe(round);
  }
  expect(await written(page)).toEqual(["Graphs 2.svg", "Graphs.svg"]);
});

test("X13 cancelling the folder picker stays on the options and writes nothing", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).__vaultRepo.exportFolderPath = null;
  });
  await row(page, "DSA").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export folder…" }).click();
  await dialog(page)
    .getByRole("button", { name: "Choose folder and export…" })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "Choose folder and export…" }),
  ).toBeVisible();
  expect(await written(page)).toEqual([]);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("X14 Stop during an export keeps what was written and says so", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).__vaultRepo.exportWriteDelayMs = 800;
  });
  await row(page, "DSA").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export folder…" }).click();
  await dialog(page)
    .getByRole("button", { name: "Choose folder and export…" })
    .click();
  await expect(page.getByTestId("batch-export-progress")).toContainText("of 2");
  await dialog(page).getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("batch-export-result")).toContainText(
    "Cancelled after exporting",
  );
  expect((await written(page)).length).toBeLessThan(2);
});

test("X15 a selection exports from its menu, folders as subfolders", async ({
  page,
}) => {
  await expand(page, "DSA");
  await row(page, "DSA/Graphs.excalidraw").click({ modifiers: ["Meta"] });
  await row(page, "DSA/Dynamic Programming").click({ modifiers: ["Meta"] });
  await row(page, "DSA/Graphs.excalidraw").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export as PNG…" }).click();
  await expect(dialog(page)).toContainText("Export 2 items");
  await dialog(page)
    .getByRole("button", { name: "Choose folder and export…" })
    .click();
  await expect(page.getByTestId("batch-export-result")).toContainText(
    "Exported 2 drawings",
  );
  expect(await written(page)).toEqual([
    "Dynamic Programming/01 Introduction.png",
    "Graphs.png",
  ]);
});

test("X16 palette: Navigator: Export folder as images… uses the open drawing's folder", async ({
  page,
}) => {
  await expand(page, "DSA");
  await row(page, "DSA/Graphs.excalidraw").click();
  await expect(page.locator(".vault-editor")).toHaveCount(1);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("export folder as images");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toContainText("Export the folder “DSA”");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});
