import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";
import { openSeeded, textElement } from "./linkStylingHelpers";

// Cost of drawing bold, italic and code words (Markdown inline step 2): a
// full re-raster of 600 texts with marks when Markdown mode turns on (styled)
// and off (plain). Each toggle repaints every text once; the longest frame gap
// after it is the user-visible cost. Pan, zoom and typing reuse the cached
// bitmaps and never call the styler. Opt in: E2E_PERF=1.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-md-inline.jsonl";
const N = 600;
const ROUNDS = 4; // the first on/off pair is a warm-up

test.skip(!PERF, "set E2E_PERF=1 to run the Markdown inline perf measurement");
test.describe.configure({ timeout: 300_000 });

const scene = () =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "e2e-md-inline-perf",
    elements: Array.from({ length: N }, (_, i) =>
      textElement(
        `t${i}`,
        `Item ${i}: a **bold** word, *italic* and \`code\``,
        (i % 6) * 700,
        Math.floor(i / 6) * 50,
      ),
    ),
    appState: {},
    files: {},
  });

/** Clicks the Markdown chip and returns the longest frame gap in the next second. */
const toggleGap = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const chip = document.querySelector<HTMLElement>(
          '.vault-editor [data-testid="markdown-chip"]',
        )!;
        let last = performance.now();
        let max = 0;
        const start = last;
        const tick = (t: number) => {
          max = Math.max(max, t - last);
          last = t;
          if (t - start < 1000) {
            requestAnimationFrame(tick);
          } else {
            resolve(+max.toFixed(1));
          }
        };
        requestAnimationFrame((t) => {
          last = t;
          chip.click();
          requestAnimationFrame(tick);
        });
      }),
  );

test("Markdown inline: full re-raster of 600 texts, styled vs plain", async ({
  page,
  browserName,
}) => {
  await openSeeded(page, { "Big.excalidraw": scene() }, "Big");
  const chip = page.locator('.vault-editor [data-testid="markdown-chip"]');
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+1"); // zoom to fit: every text on screen
  await page.waitForTimeout(500);
  const gaps: Record<"on" | "off", number[]> = { on: [], off: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const on = await toggleGap(page);
    const off = await toggleGap(page);
    if (r > 0) {
      gaps.on.push(on);
      gaps.off.push(off);
    }
  }
  const median = (xs: number[]) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const row = {
    test: "md-inline-reraster-600",
    browser: browserName,
    styledMaxGapMs: gaps.on,
    plainMaxGapMs: gaps.off,
    styledMedian: median(gaps.on),
    plainMedian: median(gaps.off),
  };
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(row)}`);
});
