import { expect, type Page } from "@playwright/test";

import { test } from "../fixture";

import { canvasBox, openDrawing, openVault, trackErrors } from "../helpers";

// Pictures, PDFs and other files in the tree (F14), like Obsidian's attachments: listed with
// their own icon, a picture opens in a viewer tab and drags onto a drawing, a PDF opens in the
// system's PDF app, other files show only with "All files". Reached through visible UI.

/** A 40 x 30 red PNG. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAAOUlEQVR4nO3OIQEAIAAEse9fGiIgDzExv53t/Gx1QFCwDggK1gFBwTogKFgHBAXrgKBgHRAUrAMvF2vxVygdvPjVAAAAAElFTkSuQmCC";

const seedAsset = (page: Page, path: string, png = false) =>
  page.evaluate(
    ({ p, b64 }) => {
      const bytes = b64
        ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        : new Uint8Array([37, 80, 68, 70]);
      (window as any).__vaultRepo.seedAsset(p, bytes);
    },
    { p: path, b64: png ? PNG_B64 : "" },
  );

const row = (page: Page, path: string) =>
  page.locator(`[data-tree-path="${path}"]`);

const refresh = (page: Page) =>
  page.getByRole("button", { name: "Refresh files" }).click();

const imageCount = (page: Page) =>
  page.evaluate(
    () =>
      (window as any)
        .__editorApis()
        .flatMap((api: any) => api.getSceneElements())
        .filter((e: any) => e.type === "image").length,
  );

const setShowAssets = async (page: Page, label: string) => {
  await page.keyboard.press("Meta+Comma");
  const modal = page.locator(".vault-settings-modal");
  await expect(modal).toBeVisible();
  await page.getByRole("tab", { name: "Files" }).click();
  await modal
    .getByRole("group", { name: "Other files in the tree" })
    .getByRole("button", { name: label })
    .click();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
};

test("a picture is listed with its icon and opens in a viewer that zooms and fits", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=empty");
  await seedAsset(page, "Pics/Red Square.png", true);
  await refresh(page);
  await row(page, "Pics").click();
  const pic = row(page, "Pics/Red Square.png");
  await expect(pic).toBeVisible();
  await expect(pic).toHaveAttribute("data-tree-kind", "image");
  // The name keeps its extension, like Obsidian's attachments.
  await expect(pic.locator(".vault-tree-item__name")).toHaveText(
    "Red Square.png",
  );

  await pic.click();
  const view = page.locator(".picture-view");
  await expect(view).toBeVisible();
  await expect(view).toContainText("40 × 30");
  const zoom = view.locator(".picture-view__zoom");
  // A small picture fits at its own size, never blown up.
  await expect(zoom).toHaveText("100%");
  await view.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toHaveText("125%");
  await view.getByRole("button", { name: "Zoom out" }).click();
  await view.getByRole("button", { name: "Zoom out" }).click();
  await expect(zoom).toHaveText("80%");
  await view.getByRole("button", { name: "Fit" }).click();
  await expect(zoom).toHaveText("100%");
  await expect(view.getByRole("button", { name: "Fit" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The image is drawn (decoded, not a broken image).
  await expect
    .poll(() =>
      view.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(40);
  expect(errors).toEqual([]);
});

test("a PDF opens in the system's PDF app; other files show only with All files", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page, "?seed=empty");
  await seedAsset(page, "Paper.pdf");
  await seedAsset(page, "data.csv");
  await refresh(page);
  await expect(row(page, "Paper.pdf")).toHaveAttribute("data-tree-kind", "pdf");
  await expect(row(page, "data.csv")).toHaveCount(0);

  await row(page, "Paper.pdf").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__vaultRepo.openedPdfs))
    .toEqual(["Paper.pdf"]);
  await expect(page.locator(".picture-view")).toHaveCount(0);

  await setShowAssets(page, "All files");
  await expect(row(page, "data.csv")).toHaveAttribute("data-tree-kind", "file");
  await setShowAssets(page, "None");
  await expect(row(page, "Paper.pdf")).toHaveCount(0);
  await expect(row(page, "data.csv")).toHaveCount(0);
  await setShowAssets(page, "Pictures and PDFs");
  await expect(row(page, "Paper.pdf")).toBeVisible();
  expect(errors).toEqual([]);
});

test("dragging a picture from the tree onto the drawing inserts it; the file stays as it was", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAsset(page, "photo.png", true);
  await refresh(page);
  await openDrawing(page, "Graphs");
  expect(await imageCount(page)).toBe(0);

  const from = (await row(page, "photo.png")
    .locator(".vault-tree-item__name")
    .boundingBox())!;
  const canvas = await canvasBox(page);
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 24, from.y + 10, { steps: 4 });
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
    {
      steps: 12,
    },
  );
  await expect(page.locator(".vault-tree-drag-ghost")).toContainText(
    "Insert into the drawing",
  );
  await page.mouse.up();
  await expect.poll(() => imageCount(page)).toBe(1);
  // Only read: the picture file keeps its bytes.
  const size = await page.evaluate(async () => {
    const repo = (window as any).__vaultRepo;
    return (await repo.readAsset(repo.handle, "photo.png")).length;
  });
  expect(size).toBe(atob(PNG_B64).length);
  expect(errors).toEqual([]);
});

test("the row menu offers Insert into drawing only while a drawing is open", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openVault(page);
  await seedAsset(page, "photo.png", true);
  await refresh(page);
  const menu = async () => {
    const r = row(page, "photo.png");
    await r.hover();
    await r.getByRole("button", { name: "More actions" }).click();
  };
  await menu();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Insert into drawing" }),
  ).toHaveCount(0);
  // A picture has no vaultdraw:// link.
  await page.getByRole("menuitem", { name: "Copy path" }).hover();
  await expect(
    page.getByRole("menuitem", { name: "Vaultdraw link" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await openDrawing(page, "Graphs");
  await menu();
  await page.getByRole("menuitem", { name: "Insert into drawing" }).click();
  await expect.poll(() => imageCount(page)).toBe(1);
  expect(errors).toEqual([]);
});
