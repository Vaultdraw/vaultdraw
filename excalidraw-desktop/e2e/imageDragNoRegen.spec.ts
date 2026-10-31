import { expect } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault } from "./helpers";
import { live, rect, toClient } from "./pageHelpers";

// toimprove 189 family: a drag or a pan on a canvas with pictures redraws the
// cached bitmaps and never rebuilds them. A bitmap rebuilt per frame would
// re-scale the whole picture every frame (the cost the owner felt as lag).
// Counts the canvases the page creates while dragging and panning.

const IMAGES = 6;

test("dragging and panning with pictures builds no new bitmaps", async ({
  page,
}) => {
  await openVault(page);
  const elements: unknown[] = [rect("target", 100, 100, 160, 100)];
  for (let i = 0; i < IMAGES; i++) {
    elements.push({
      ...rect(`im${i}`, 400 + (i % 3) * 210, 60 + Math.floor(i / 3) * 150),
      type: "image",
      width: 200,
      height: 132,
      fileId: `img${i}`,
      status: "saved",
      scale: [1, 1],
      crop: null,
    });
  }
  await page.evaluate(
    async ([els, n]) => {
      const files: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const c = document.createElement("canvas");
        c.width = 600;
        c.height = 400;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = `hsl(${i * 50} 70% 55%)`;
        ctx.fillRect(0, 0, 600, 400);
        files[`img${i}`] = {
          mimeType: "image/png",
          id: `img${i}`,
          dataURL: c.toDataURL("image/png"),
          created: 1,
          lastRetrieved: 1,
        };
      }
      const repo = (window as any).__vaultRepo;
      repo.seedDrawing(
        "pics.excalidraw",
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          elements: els,
          appState: { viewBackgroundColor: "#ffffff" },
          files,
        }),
      );
      repo.emit({ handle: repo.handle, paths: [], rescan: true });
    },
    [elements, IMAGES] as const,
  );
  await openDrawing(page, "pics");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    const w = window as any;
    w.__canvases = 0;
    const orig = document.createElement.bind(document);
    document.createElement = ((tag: string, o?: any) => {
      if (String(tag).toLowerCase() === "canvas") {
        w.__canvases++;
      }
      return orig(tag, o);
    }) as any;
  });

  const im = (await live(page)).elements.find((e) => e.id === "im0")!;
  const from = await toClient(page, im.x + 20, im.y + 20);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(from.x + i * 3, from.y + i * 2);
  }
  await page.mouse.up();
  const moved = (await live(page)).elements.find((e) => e.id === "im0")!;
  expect(moved.x).toBeGreaterThan(im.x + 40);

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(i % 2 ? 20 : -20, 12);
  }
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__canvases)).toBe(0);
});
