import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openVault, reloadVault, trackErrors } from "./helpers";

// toimprove 341: Up/Down over "Theme: <name>" in the palette previews the
// theme (Telescope's colorscheme picker, Zed's theme selector); Enter keeps
// it, Esc / leaving the row / closing restores the saved one exactly.

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const input = (page: Page) => palette(page).getByRole("combobox");
const highlighted = (page: Page) =>
  palette(page).getByRole("option", { selected: true });

const look = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return {
      bg: getComputedStyle(root).getPropertyValue("--vault-bg").trim(),
      theme: root.dataset.vaultTheme ?? "",
      dark: root.classList.contains("dark"),
    };
  });

/** `config` null = the plain harness, where a chosen theme survives a reload. */
const open = async (page: Page, query: string, config: object | null) => {
  if (config) {
    await page.addInitScript((c) => {
      (window as any).__e2eConfig = c;
    }, config);
  }
  await openVault(page, config ? "?config=1" : "");
  await page.keyboard.press("Meta+Shift+KeyP");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(query);
  await expect(highlighted(page)).toContainText("Theme");
};

/** ArrowDown until a "Theme: " row whose look differs from `from` shows. */
const previewSomething = async (page: Page, from: string) => {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("ArrowDown");
    const text = (await highlighted(page).innerText()) ?? "";
    if (text.startsWith("Theme: ") && (await look(page)).bg !== from) {
      return text.split("\n")[0].replace(/^Theme: /, "");
    }
  }
  throw new Error("no theme row changed the colours");
};

for (const mode of ["light", "dark"] as const) {
  test.describe(`palette theme preview, ${mode} mode`, () => {
    const cfg = { appearance: { mode } };

    test("Down previews a theme, Esc restores exactly", async ({ page }) => {
      const errors = trackErrors(page);
      await open(page, "Theme: ", cfg);
      const before = await look(page);
      expect(before.dark).toBe(mode === "dark");
      await previewSomething(page, before.bg);
      const during = await look(page);
      expect(during.theme).not.toBe(before.theme);
      expect(during.dark).toBe(before.dark); // mode never changes
      await page.keyboard.press("Escape");
      await expect(palette(page)).toHaveCount(0);
      expect(await look(page)).toEqual(before);
      expect(errors).toEqual([]);
    });

    test("moving onto a non-theme row restores; Enter keeps and survives reload", async ({
      page,
    }) => {
      const errors = trackErrors(page);
      await open(page, "Theme: ", cfg);
      const before = await look(page);
      const name = await previewSomething(page, before.bg);
      const shown = await look(page);
      // Leave the theme family: the saved theme is back.
      await input(page).fill(">Toggle grid");
      await page.keyboard.press("ArrowDown");
      await expect(highlighted(page)).not.toContainText("Theme: ");
      expect(await look(page)).toEqual(before);
      // Back to the theme, Enter keeps it.
      await input(page).fill(`>Theme: ${name}`);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await expect(highlighted(page)).toContainText(`Theme: ${name}`);
      expect((await look(page)).theme).toBe(shown.theme);
      await page.keyboard.press("Enter");
      await expect(palette(page)).toHaveCount(0);
      await expect.poll(async () => (await look(page)).theme).toBe(shown.theme);
      expect(errors).toEqual([]);
    });
  });
}

test("Enter keeps the previewed theme across a reload; an unfinished preview does not", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, "Theme: ", null);
  const before = await look(page);
  const name = await previewSomething(page, before.bg);
  const shown = await look(page);
  // A reload in the middle of a preview leaves the saved theme.
  await reloadVault(page);
  expect(await look(page)).toEqual(before);
  await page.keyboard.press("Meta+Shift+KeyP");
  await page.keyboard.type(`Theme: ${name}`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(highlighted(page)).toContainText(`Theme: ${name}`);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(async () => (await look(page)).theme).toBe(shown.theme);
  await reloadVault(page);
  expect((await look(page)).theme).toBe(shown.theme);
  expect(errors).toEqual([]);
});

test("a mouse hover never previews", async ({ page }) => {
  await open(page, "Theme: ", { appearance: { mode: "light" } });
  const before = await look(page);
  const row = palette(page).getByRole("option").nth(3);
  await expect(row).toContainText("Theme: ");
  await row.hover();
  await expect(highlighted(page)).toContainText("Theme: ");
  expect(await look(page)).toEqual(before);
});

test("palette_theme_preview = false: arrows change nothing, Enter still applies", async ({
  page,
}) => {
  await open(page, "Theme: ", {
    appearance: { mode: "light", palette_theme_preview: false },
  });
  const before = await look(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(highlighted(page)).toContainText("Theme: ");
  expect(await look(page)).toEqual(before);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(async () => (await look(page)).bg).not.toBe(before.bg);
});
