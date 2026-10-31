import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { test } from "./fixture";

import { canvasBox, openDrawing, openVault } from "./helpers";
import { live, rect, toClient } from "./pageHelpers";

// toimprove 189: dragging and panning on a canvas that holds large pictures.
// Frame times (requestAnimationFrame gaps) and main-thread cost while dragging
// a rectangle, dragging a picture and panning, with 0, 6 or 16 big pictures
// on screen. Chromium only; skipped unless E2E_PERF=1. Rows go to $PERF_OUT.
const PERF = process.env.E2E_PERF === "1";
const OUT = process.env.PERF_OUT ?? "../.cache/perf-image-drag.jsonl";
const IMAGES = (process.env.PERF_IMAGES ?? "0,6,16").split(",").map(Number);
const STEPS = 90;

test.skip(!PERF, "set E2E_PERF=1 to run the image drag measurements");
test.describe.configure({ timeout: 300_000 });

// A noisy picture so it is large to decode and cannot compress away.
const PX = Number(process.env.PERF_PX ?? 1600);
const installMaker = (page: Page) =>
  page.evaluate(() => {
    (window as any).__mk = async (n: number, size: number) => {
      const out: Record<string, any> = {};
      for (let i = 0; i < n; i++) {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = Math.round(size * 0.66);
        const ctx = c.getContext("2d")!;
        const img = ctx.createImageData(c.width, c.height);
        for (let p = 0; p < img.data.length; p += 4) {
          img.data[p] = (Math.random() * 255) | 0;
          img.data[p + 1] = (p / 4) % c.width & 255;
          img.data[p + 2] = (i * 40) & 255;
          img.data[p + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        out[`img${i}`] = {
          mimeType: "image/png",
          id: `img${i}`,
          dataURL: c.toDataURL("image/png"),
          created: 1,
          lastRetrieved: 1,
        };
      }
      return out;
    };
  });

for (const count of IMAGES) {
  test(`drag and pan with ${count} large pictures`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP is chromium only");
    await openVault(page);
    await installMaker(page);
    const elements: unknown[] = [rect("target", 100, 100, 160, 100)];
    for (let r = 0; r < 12; r++) {
      elements.push(rect(`r${r}`, 300 + (r % 4) * 40, 80 + r * 30));
    }
    for (let i = 0; i < count; i++) {
      elements.push({
        ...rect(`im${i}`, 400 + (i % 4) * 210, 60 + Math.floor(i / 4) * 150),
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
      async ([els, n, size]) => {
        const fl = await (0, (window as any).__mk)(n, size);
        const repo = (window as any).__vaultRepo;
        repo.seedDrawing(
          "imgdrag.excalidraw",
          JSON.stringify({
            type: "excalidraw",
            version: 2,
            elements: els,
            appState: { viewBackgroundColor: "#ffffff" },
            files: fl,
          }),
        );
        repo.emit({ handle: repo.handle, paths: [], rescan: true });
      },
      [elements, count, PX] as const,
    );
    await openDrawing(page, "imgdrag");
    await page.waitForTimeout(1500);
    // zoom to a typical viewport: show everything in view
    await page.keyboard.press("Shift+1");
    await page.waitForTimeout(800);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metric = async (name: string) =>
      (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === name,
      )!.value;
    const startFrames = () =>
      page.evaluate(() => {
        const w = window as any;
        w.__frames = [];
        let last = performance.now();
        const loop = (t: number) => {
          w.__frames.push(t - last);
          last = t;
          w.__raf = requestAnimationFrame(loop);
        };
        w.__raf = requestAnimationFrame(loop);
      });
    const stopFrames = () =>
      page.evaluate(() => {
        const w = window as any;
        cancelAnimationFrame(w.__raf);
        return (w.__frames as number[]).slice(3);
      });
    const pct = (a: number[], q: number) => {
      const s = [...a].sort((x, y) => x - y);
      return +s[Math.floor((s.length - 1) * q)].toFixed(1);
    };

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
    const RATE = Number(process.env.PERF_CPU ?? 1);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    const PROFILE = process.env.PERF_PROFILE === "1";
    if (PROFILE) {
      await cdp.send("Profiler.enable");
    }
    const measure = async (label: string, run: () => Promise<void>) => {
      if (PROFILE) {
        await cdp.send("Profiler.start");
      }
      await startFrames();
      await page.evaluate(() => ((window as any).__canvases = 0));
      const task0 = await metric("TaskDuration");
      const js0 = await metric("ScriptDuration");
      await run();
      const task = ((await metric("TaskDuration")) - task0) * 1000;
      const js = ((await metric("ScriptDuration")) - js0) * 1000;
      const frames = await stopFrames();
      if (PROFILE) {
        const { profile } = await cdp.send("Profiler.stop");
        const self = new Map<string, number>();
        const dt = profile.timeDeltas;
        const byId = new Map(profile.nodes.map((n: any) => [n.id, n]));
        profile.samples.forEach((id: number, i: number) => {
          const n: any = byId.get(id);
          const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url
            .split("/")
            .pop()}:${n.callFrame.lineNumber}`;
          self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0));
        });
        const top = [...self.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([k, v]) => `${(v / 1000 / STEPS).toFixed(2)}ms/step ${k}`);
        // eslint-disable-next-line no-console
        console.log(`PROFILE ${label} ${count}\n${top.join("\n")}`);
      }
      const row = {
        label,
        images: count,
        cpuRate: RATE,
        taskMsPerStep: +(task / STEPS).toFixed(2),
        jsMsPerStep: +(js / STEPS).toFixed(2),
        p50: pct(frames, 0.5),
        p95: pct(frames, 0.95),
        over12: frames.filter((f) => f > 12).length,
        frames: frames.length,
        canvasesCreated: await page.evaluate(() => (window as any).__canvases),
        load: await page.evaluate(() => 0),
      };
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      // eslint-disable-next-line no-console
      console.log(`PERF ${JSON.stringify(row)}`);
    };

    const dragFrom = async (sx: number, sy: number, label: string) => {
      const a = await toClient(page, sx, sy);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await measure(label, async () => {
        for (let i = 1; i <= STEPS; i++) {
          await page.mouse.move(
            a.x + Math.sin(i / 9) * 60,
            a.y + (i % 2 ? 6 : 0) + i * 1.2,
          );
          await page.waitForTimeout(8);
        }
      });
      await page.mouse.up();
    };

    await dragFrom(110, 110, "drag-rectangle");
    if (count > 0) {
      const im = (await live(page)).elements.find((e) => e.id === "im0")!;
      await dragFrom(im.x + 20, im.y + 20, "drag-image");
    }
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await measure("pan", async () => {
      for (let i = 0; i < STEPS; i++) {
        await page.mouse.wheel(i % 2 ? 20 : -20, 12);
        await page.waitForTimeout(8);
      }
    });
    expect(true).toBe(true);
  });
}
