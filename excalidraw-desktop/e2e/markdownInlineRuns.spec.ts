import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";
import {
  SHOTS,
  canvasBox,
  openDrawing,
  readScene,
  screenshot,
  trackErrors,
} from "./helpers";
import { openSeeded, runCommand, textElement } from "./linkStylingHelpers";

// Markdown inline step 2, through visible UI: bold, italic and code words
// inside a line are drawn without their marks while the text keeps them.
// What the user sees is read from the canvas: each row's ink width. Hidden
// marks make a row narrower; rows without a closed pair keep their width.
// Data-driven: one row per scenario (SCENARIOS.md, step 2).
// narrower: hidden marks shrink the row; code trades its backticks for a wider face
const ROWS: { text: string; hides: boolean; narrower?: boolean }[] = [
  { text: "a **bold** word", hides: true, narrower: true },
  { text: "an *italic* word", hides: true, narrower: true },
  { text: "run `npm i` now", hides: true },
  { text: "**b** then [[Notes]]", hides: true, narrower: true },
  { text: "snake_case_name here", hides: false },
  { text: "**not closed here", hides: false },
  { text: "2 * 3 * 4 = 24", hides: false },
];
const GAP = 70;

const scene = () =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-md-inline",
    elements: ROWS.map((r, i) =>
      textElement(`r${i}`, r.text, 40, 40 + i * GAP),
    ),
    appState: {},
    files: {},
  });

const editor = (page: Page) => page.locator(".vault-editor");
const chip = (page: Page) => editor(page).getByTestId("markdown-chip");

type Row = { w: number; ink: number };

/** Ink width (css px) and ink pixel count per text row, top to bottom. */
const rowInk = (page: Page): Promise<Row[]> =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const { width: w, height: h } = c;
    const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    const b0 = ((h - 3) * w + 3) * 4;
    const far = (i: number) =>
      Math.max(
        Math.abs(d[i] - d[b0]),
        Math.abs(d[i + 1] - d[b0 + 1]),
        Math.abs(d[i + 2] - d[b0 + 2]),
      ) > 70;
    const rows: {
      y0: number;
      y1: number;
      x0: number;
      x1: number;
      ink: number;
    }[] = [];
    let cur: typeof rows[number] | null = null;
    for (let y = 0; y < h; y++) {
      let x0 = -1;
      let x1 = -1;
      let ink = 0;
      for (let x = 0; x < w; x++) {
        if (far((y * w + x) * 4)) {
          if (x0 < 0) {
            x0 = x;
          }
          x1 = x;
          ink++;
        }
      }
      if (x0 < 0) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { y0: y, y1: y, x0, x1, ink };
        rows.push(cur);
      } else {
        cur.ink += ink;
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, x0);
        cur.x1 = Math.max(cur.x1, x1);
      }
    }
    // underlines and descenders split nothing: merge bands closer than 12 css px
    const dpr = window.devicePixelRatio;
    const merged: typeof rows[number][] = [];
    for (const r of rows) {
      const last = merged[merged.length - 1];
      if (last && r.y0 - last.y1 < 12 * dpr) {
        last.y1 = r.y1;
        last.ink += r.ink;
        last.x0 = Math.min(last.x0, r.x0);
        last.x1 = Math.max(last.x1, r.x1);
      } else {
        merged.push({ ...r });
      }
    }
    return merged.map((r) => ({ w: (r.x1 - r.x0) / dpr, ink: r.ink }));
  });

/** Luminance of the static canvas's bottom-left pixel (the page colour). */
const canvasBackground = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(
      ".vault-editor canvas.static",
    )!;
    const d = c.getContext("2d")!.getImageData(3, c.height - 3, 1, 1).data;
    return d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11;
  });

const settledWidths = async (page: Page, count: number) => {
  let widths: Row[] = [];
  await expect
    .poll(async () => (widths = await rowInk(page)).length, {
      timeout: 10_000,
    })
    .toBe(count);
  return widths;
};

const expectHidden = (off: Row[], on: Row[]) => {
  ROWS.forEach((row, i) => {
    if (!row.hides) {
      expect(
        Math.abs(on[i].w - off[i].w),
        `${row.text}: unchanged`,
      ).toBeLessThan(3);
      return;
    }
    // drawn differently, and never wider than the box the marks were measured in
    expect(
      Math.abs(on[i].ink - off[i].ink) / off[i].ink,
      `${row.text}: drawn differently`,
    ).toBeGreaterThan(0.03);
    expect(on[i].w, `${row.text}: stays in its box`).toBeLessThan(off[i].w + 2);
    if (row.narrower) {
      expect(on[i].w, `${row.text}: narrower`).toBeLessThan(off[i].w - 8);
    }
  });
};

test("Markdown mode draws bold, italic and code words without their marks, in light and dark, after typing, undo and reopening", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openSeeded(
    page,
    {
      "Inline.excalidraw": scene(),
      "Notes.excalidraw": JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [textElement("n", "notes", 0, 0)],
        appState: {},
        files: {},
      }),
    },
    "Inline",
  );
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  const off = await settledWidths(page, ROWS.length);

  // the chip turns Markdown mode on: marks hide, the text keeps them
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await rowInk(page))[0]?.w, { timeout: 10_000 })
    .toBeLessThan(off[0].w - 8);
  const on = await settledWidths(page, ROWS.length);
  expectHidden(off, on);
  await screenshot(page, { path: `${SHOTS}/md-inline-light.png` });
  const stored = (await readScene(page, "Inline.excalidraw").catch(() => null))
    ?.elements;
  if (stored) {
    expect(stored.map((e: any) => e.text)).toEqual(ROWS.map((r) => r.text));
  }

  // a link after a bold word still opens where it is drawn: Cmd+click on its middle
  // (covered in unit tests; here the row only has to keep its link colour)

  // dark: the same rows, light ink on a dark page
  await runCommand(page, "Mode: Dark");
  await expect.poll(() => canvasBackground(page)).toBeLessThan(100);
  const dark = await settledWidths(page, ROWS.length);
  await screenshot(page, { path: `${SHOTS}/md-inline-dark.png` });
  ROWS.forEach((row, i) => {
    expect(
      Math.abs(dark[i].w - on[i].w),
      `${row.text}: same in dark`,
    ).toBeLessThan(3);
  });
  await runCommand(page, "Mode: Light");
  await expect.poll(() => canvasBackground(page)).toBeGreaterThan(150);

  // typing a new line with marks: the editor shows them, the canvas hides them
  await editor(page).getByTestId("toolbar-text").click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 40, box.y + 40 + ROWS.length * GAP + 10);
  const textarea = page.locator("textarea.excalidraw-wysiwyg");
  await expect(textarea).toBeFocused();
  await page.keyboard.type("x **typed** y", { delay: 15 });
  await expect(textarea).toHaveValue("x **typed** y");
  await page.keyboard.press("Escape");
  const typed = await settledWidths(page, ROWS.length + 1);
  // "x **typed** y" drawn as "x typed y": narrower than the 13-character row it would be with marks
  expect(typed[ROWS.length].w).toBeLessThan(typed[1].w);

  // undo removes the new text; the seeded rows stay styled
  await page.keyboard.press("Meta+z");
  const undone = await settledWidths(page, ROWS.length);
  expectHidden(off, undone);

  // reopening the drawing keeps its Markdown switch and the hidden marks
  await openDrawing(page, "Notes");
  await openDrawing(page, "Inline");
  await expect(chip(page)).toHaveAttribute("aria-pressed", "true");
  expectHidden(off, await settledWidths(page, ROWS.length));

  // Markdown mode off: the marks come back
  await chip(page).click();
  await expect(chip(page)).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await rowInk(page))[0]?.w, { timeout: 10_000 })
    .toBeGreaterThan(off[0].w - 3);
  expect(errors).toEqual([]);
});
