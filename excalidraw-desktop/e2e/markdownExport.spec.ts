import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";
import {
  exportDialogButton,
  exportedNames,
  openExportDialogFromMenu,
  trackErrors,
} from "./helpers";
import { openSeeded, textElement } from "./linkStylingHelpers";

// Markdown inline step 2b, through visible UI: PNG, SVG and the copies draw
// bold, italic and code words like the canvas (marks hidden); with Markdown
// mode off the export is the plain text, as before.
const TEXT = "a **bold** and *it* and `code` word";
const scene = () =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-md-export",
    elements: [textElement("t1", TEXT, 40, 40)],
    appState: {},
    files: {},
  });

const chip = (page: Page) =>
  page.locator(".vault-editor").getByTestId("markdown-chip");

const stubClipboard = (page: Page) =>
  page.evaluate(() => {
    const calls: any[] = [];
    (window as any).__clipboardCalls = calls;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) =>
          calls.push({ kind: "write", types: items.flatMap((i) => i.types) }),
        writeText: async (text: string) => calls.push({ kind: "text", text }),
      },
    });
  });

/** Copy SVG from the dialog; the SVG text. */
const copySvg = async (page: Page): Promise<string> => {
  const before = await page.evaluate(
    () => (window as any).__clipboardCalls.length,
  );
  await exportDialogButton(page, "Copy SVG").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__clipboardCalls.length), {
      timeout: 15000,
    })
    .toBe(before + 1);
  return page.evaluate(() => (window as any).__clipboardCalls.at(-1).text);
};

/** Saves PNG from the dialog; the ink width (px) of the exported image. */
const savePngInk = async (page: Page, name: string): Promise<number> => {
  await exportDialogButton(page, "PNG").click();
  await expect
    .poll(() => exportedNames(page), { timeout: 15000 })
    .toContain(name);
  return page.evaluate(async (n) => {
    const e = (window as any).__vaultRepo.exported
      .filter((x: any) => x.name === n)
      .at(-1);
    const bmp = await createImageBitmap(
      new Blob([e.bytes], { type: "image/png" }),
    );
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width;
    let x1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 300) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
      }
    }
    return x1 - x0;
  }, name);
};

const closeDialog = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(page.locator(".ImageExportModal")).toHaveCount(0);
};

test("exports draw Markdown words like the canvas: SVG tspans, PNG ink, copies; plain when the mode is off", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeeded(page, { "Md.excalidraw": scene() }, "Md");
  await stubClipboard(page);
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");

  // mode off: the plain text with its marks, no tspans
  await openExportDialogFromMenu(page);
  const plainSvg = await copySvg(page);
  expect(plainSvg).toContain(TEXT);
  expect(plainSvg).not.toContain("<tspan");
  const plainInk = await savePngInk(page, "Md.png");
  await closeDialog(page);

  // mode on: marks gone, real tspans, a narrower picture
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");
  await openExportDialogFromMenu(page);
  const svg = await copySvg(page);
  expect(svg).not.toContain("**");
  expect(svg).not.toContain("`");
  expect(svg).toContain('font-weight="bold"');
  expect(svg).toContain('font-style="italic"');
  expect(svg).toContain("Cascadia");
  expect(svg.replace(/<[^>]+>/g, "")).toContain("a bold and it and code word");
  const styledInk = await savePngInk(page, "Md.png");
  expect(styledInk).toBeLessThan(plainInk - 20);
  await closeDialog(page);

  // back off: plain again (the scope never leaks)
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  await openExportDialogFromMenu(page);
  expect(await copySvg(page)).toContain(TEXT);
  expect(errors).toEqual([]);
});
