import { expect } from "@playwright/test";

import { test } from "./fixture";
import { enterVault, reloadVault } from "./helpers";
import { clickTree, readTabs, trackErrors } from "./tabsHelpers";

/**
 * toimprove 343: what the user arranged comes back after a restart. The app's
 * webview forgets localStorage at every quit, so these choices now live in the
 * preferences that the app writes to state.json. A browser keeps localStorage
 * across a reload, so this spec checks the user-visible path end to end
 * (UI -> preferences -> restore); the restart without localStorage is
 * src/tests/durableState.test.ts.
 */
test("open tabs and the Links dock come back after a reload", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/e2e.html");
  await enterVault(page);

  // The harness vault: DSA/Graphs and DSA/Dynamic Programming/01 Introduction.
  await clickTree(page, "DSA");
  await clickTree(page, "Graphs");
  await clickTree(page, "Dynamic Programming");
  await clickTree(page, "01 Introduction", ["Meta"]);
  await expect.poll(async () => (await readTabs(page)).length).toBe(2);
  const before = await readTabs(page);

  await page.keyboard.press("Meta+Alt+b");
  await expect(page.locator(".vault-links")).toBeVisible();

  // The session is kept in the preferences (state.json in the app).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const prefs = JSON.parse(
          localStorage.getItem("excalidraw-vault-preferences-v1") ?? "{}",
        );
        return (prefs.tabsSessions ?? []).length;
      }),
    )
    .toBe(1);

  await reloadVault(page);
  await expect
    .poll(async () => (await readTabs(page)).map((t) => t.path))
    .toEqual(before.map((t) => t.path));
  expect((await readTabs(page)).find((t) => t.active)?.path).toBe(
    before.find((t) => t.active)?.path,
  );
  await expect(page.locator(".vault-links")).toBeVisible();
  expect(errors).toEqual([]);
});
