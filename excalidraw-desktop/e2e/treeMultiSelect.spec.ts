/**
 * Multi-select in the file tree (F13), through visible UI only: clicks,
 * right-clicks, drags and keys on a focused tree. SCENARIOS.md rows E1-E8.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, trackErrors } from "./helpers";

const row = (page: Page, path: string): Locator =>
  page.locator(
    `.vault-tree-container .vault-tree-item[data-tree-path="${path}"]`,
  );
const selected = (page: Page) =>
  page.locator(".vault-tree-container .vault-tree-item--selected");
const MOD = "Meta";

const seed = async (page: Page, folders: string[], drawings: string[]) => {
  await page.evaluate(
    ({ folders, drawings }) => {
      const repo = (window as any).__vaultRepo;
      const json = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "e2e",
        elements: [],
        appState: {},
        files: {},
      });
      folders.forEach((f: string) => repo.seedFolder(f));
      drawings.forEach((d: string) => repo.seedDrawing(d, json));
    },
    { folders, drawings },
  );
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type("navigator: refresh files");
  await page.keyboard.press("Enter");
  for (const p of [...folders, ...drawings]) {
    await expect(row(page, p)).toBeVisible();
  }
};

const exists = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const repo = (window as any).__vaultRepo;
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const list = await repo.listDirectory(repo.handle, parent);
    return list.some((e: any) => e.path === p);
  }, path);

const A = "Alpha multi.excalidraw";
const B = "Bravo multi.excalidraw";
const C = "Charlie multi.excalidraw";
const DEST = "Zeta destination";

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = trackErrors(page);
  await openVault(page);
  await seed(page, [DEST], [A, B, C]);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("E1 Cmd+click toggles rows; a plain click clears and opens", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, C).click({ modifiers: [MOD] });
  await expect(selected(page)).toHaveCount(2);
  await expect(row(page, A)).toHaveAttribute("aria-selected", "true");
  // Must not open a tab (Cmd+click selects by default).
  await expect(page.locator(".vault-editor")).toHaveCount(0);
  await row(page, C).click({ modifiers: [MOD] });
  await expect(selected(page)).toHaveCount(1);
  await row(page, B).click();
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator(".vault-editor")).toHaveCount(1);
});

test("E2 Shift+click selects a range; Escape clears it and keeps focus in the tree", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, C).click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
  await row(page, C).focus();
  await page.keyboard.press("Escape");
  await expect(selected(page)).toHaveCount(0);
  // The first Escape only clears: the tree keeps focus.
  await expect(page.locator(".vault-tree-container")).toContainText("Alpha");
  const inTree = await page.evaluate(
    () => !!document.activeElement?.closest(".vault-tree-container"),
  );
  expect(inTree).toBe(true);
});

test("E3 right-click a selected row: move both through the move dialog", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, B).click({ modifiers: [MOD] });
  await row(page, B).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move 2 drawings to…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Move 2 drawings");
  await dialog.getByLabel("Filter folders").fill("Zeta");
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => exists(page, `${DEST}/${A}`)).toBe(true);
  await expect.poll(() => exists(page, `${DEST}/${B}`)).toBe(true);
  expect(await exists(page, A)).toBe(false);
  expect(await exists(page, C)).toBe(true);
  await expect(selected(page)).toHaveCount(0);
});

test("E4 right-click a selected row: trash both after one confirmation", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, C).click({ modifiers: [MOD] });
  await row(page, A).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move 2 drawings to Trash" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete 2 drawings");
  await expect(dialog).toContainText(A);
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect.poll(() => exists(page, A)).toBe(false);
  expect(await exists(page, C)).toBe(false);
  // Must not touch the unselected row.
  expect(await exists(page, B)).toBe(true);
});

test("E5 right-click outside the selection acts on that row alone", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, B).click({ modifiers: [MOD] });
  await row(page, C).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Move 2 drawings/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(selected(page)).toHaveCount(0);
});

test("E6 dragging a selected row moves the whole selection", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, B).click({ modifiers: [MOD] });
  const from = await row(page, A)
    .locator(".vault-tree-item__name")
    .boundingBox();
  const to = await row(page, DEST).boundingBox();
  await page.mouse.move(from!.x + 10, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 22, from!.y + 14, { steps: 4 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 12,
  });
  await expect(page.locator(".vault-tree-drag-ghost")).toContainText(
    "2 drawings",
  );
  await page.mouse.up();
  await expect.poll(() => exists(page, `${DEST}/${A}`)).toBe(true);
  await expect.poll(() => exists(page, `${DEST}/${B}`)).toBe(true);
  expect(await exists(page, C)).toBe(true);
});

test("E7 keyboard: Shift+ArrowDown extends, D trashes the selection", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, A).focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press("d");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete 2 drawings");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Cancel keeps everything.
  expect(await exists(page, A)).toBe(true);
  expect(await exists(page, B)).toBe(true);
});

test("E8 keyboard: V starts visual mode, j extends, M moves the selection", async ({
  page,
}) => {
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, A).click({ modifiers: [MOD] });
  await row(page, A).focus();
  await page.keyboard.press("v");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(selected(page)).toHaveCount(3);
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Move 3 drawings");
  await dialog.getByLabel("Filter folders").fill("Zeta");
  await page.keyboard.press("Enter");
  await expect.poll(() => exists(page, `${DEST}/${C}`)).toBe(true);
});
