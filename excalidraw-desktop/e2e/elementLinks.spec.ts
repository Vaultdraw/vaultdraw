import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { openDrawing, openVault, readScene, trackErrors } from "./helpers";
import {
  expectOpen,
  renameTo,
  scenePoint,
  settled,
  withMeta,
} from "./linksHelpers";

// Links that name one element: `[[Target#^id]]` (Obsidian's block link) in text and in a shape
// link, "Copy link to selected element" in the palette and "Copy link to object" in the element
// menu, and a rename that keeps the anchor.

/** The editor's live selection and view, read through React's fibers (as canvasEdgeCases does). */
const view = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".vault-editor canvas.interactive")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
    let fiber = (el as any)[key];
    while (fiber) {
      const s = fiber.stateNode;
      if (s && s.state && s.scene && typeof s.state.scrollX === "number") {
        const st = s.state;
        return {
          selected: Object.keys(st.selectedElementIds ?? {}).filter(
            (k) => st.selectedElementIds[k],
          ),
          groups: Object.keys(st.selectedGroupIds ?? {}).filter(
            (k) => st.selectedGroupIds[k],
          ),
          scrollX: st.scrollX as number,
          scrollY: st.scrollY as number,
        };
      }
      fiber = fiber.return;
    }
    throw new Error("no editor");
  });

/** Records what the app puts on the clipboard (WebKit gives a test no clipboard access). */
const recordClipboard = (page: Page) =>
  page.addInitScript(() => {
    const written: string[] = [];
    (window as any).__copied = written;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => void written.push(text),
        readText: async () => written.at(-1) ?? "",
      },
    });
  });
const copied = (page: Page) =>
  page.evaluate(() => (window as any).__copied as string[]);

const open = async (page: Page, name: string) => {
  await openVault(page, "?seed=elementlinks");
  await openDrawing(page, name);
};

const runCommand = async (page: Page, title: string) => {
  await page.keyboard.press("Meta+Shift+KeyP");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  // Commands mode: the input starts as ">"; filling it would replace that and search drawings.
  await expect(palette.getByRole("combobox")).toHaveValue(">");
  await page.keyboard.type(title);
  await palette
    .getByRole("option", { name: new RegExp(`Links: ${title}`) })
    .click();
  await expect(palette).toHaveCount(0);
};

const cmdClickAt = async (page: Page, sx: number, sy: number) => {
  const p = await scenePoint(page, sx, sy);
  await withMeta(page, async () => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  });
};

test("a text link with an element anchor opens the drawing at that element", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, "Source");
  await cmdClickAt(page, 260, 240);
  await expectOpen(page, "Target");
  await expect.poll(async () => (await view(page)).selected).toEqual(["t-far"]);
  // The far element is in view: the view moved away from the origin (the move is animated).
  await expect
    .poll(async () => {
      const v = await view(page);
      return Math.abs(v.scrollX) + Math.abs(v.scrollY);
    })
    .toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test("a shape link to a group selects the group", async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, "Source");
  await cmdClickAt(page, 300, 550);
  await expectOpen(page, "Target");
  await expect
    .poll(async () => (await view(page)).selected.sort())
    .toEqual(["t-g1", "t-g2"]);
  expect((await view(page)).groups).toEqual(["t-group"]);
  expect(errors).toEqual([]);
});

test("a link to an element that is gone opens the drawing and says so", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, "Source");
  await cmdClickAt(page, 260, 300);
  await expectOpen(page, "Target");
  await expect(
    page.getByText("That element is no longer in this drawing.").first(),
  ).toBeVisible();
  expect((await view(page)).selected).toEqual([]);
  expect(errors).toEqual([]);
});

test("Copy link to selected element puts [[Drawing#^id]] on the clipboard", async ({
  page,
}) => {
  await recordClipboard(page);
  const errors = trackErrors(page);
  await open(page, "Target");
  // Nothing selected: a plain hint, nothing copied.
  await runCommand(page, "Copy link to selected element");
  await expect(page.getByText("Select one element, or a group")).toBeVisible();
  expect(await copied(page)).toEqual([]);

  const near = await scenePoint(page, 300, 250);
  await page.mouse.click(near.x, near.y);
  await expect
    .poll(async () => (await view(page)).selected)
    .toEqual(["t-near"]);
  await runCommand(page, "Copy link to selected element");
  await expect(page.getByText("Copied [[Target#^t-near]]")).toBeVisible();
  expect(await copied(page)).toEqual(["[[Target#^t-near]]"]);
  expect(errors).toEqual([]);
});

test("the element menu's Copy link to object gives the same link", async ({
  page,
}) => {
  await recordClipboard(page);
  const errors = trackErrors(page);
  await open(page, "Target");
  const near = await scenePoint(page, 300, 250);
  await page.mouse.click(near.x, near.y);
  await page.mouse.click(near.x, near.y, { button: "right" });
  await page.getByRole("button", { name: "Copy link to object" }).click();
  await expect.poll(() => copied(page)).toEqual(["[[Target#^t-near]]"]);
  expect(errors).toEqual([]);
});

test("renaming the drawing keeps the element anchor in every link to it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, "Source");
  await renameTo(page, "Target", "Goal");
  await settled(page);
  await expect
    .poll(async () => {
      const scene = await readScene(page, "Source.excalidraw");
      return scene.elements
        .map((e: any) => e.originalText ?? e.link ?? "")
        .join("|");
    })
    .toContain("[[Goal#^t-far]]");
  const scene = await readScene(page, "Source.excalidraw");
  const all = scene.elements.map((e: any) => e.originalText ?? e.link ?? "");
  expect(all).toContain("Gone [[Goal#^nope]]");
  expect(all).toContain("[[Goal#^t-group]]");
  // The renamed link still opens the element.
  await cmdClickAt(page, 260, 240);
  await expectOpen(page, "Goal");
  await expect.poll(async () => (await view(page)).selected).toEqual(["t-far"]);
  expect(errors).toEqual([]);
});
