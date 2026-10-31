import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "../fixture";

import { openVault } from "../helpers";

// Family (test-net-2): "a setting does not take effect, is not saved or cannot be reset" fails for
// every row in Settings. Rows come from registry-snapshot.json (kept equal to the settings schema
// by src/commands/registrySnapshot.test.ts). Each row with a simple control is changed through the
// visible Settings window to a non-default value; then: no page error, the window answers, the
// config layer has the key when the schema names one, and Reset (when the row has it) puts the
// config layer back. A row with no simple control needs a reason in SKIP.

type Row = {
  id: string;
  page: string;
  label: string;
  configKey: string | null;
  section: string | null;
};
const snap = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "e2e/families/registry-snapshot.json"),
    "utf8",
  ),
) as { settings: Row[]; pages: { id: string; label: string }[] };

/** Rows without a simple control, each with its reason. Every entry must match a row. */
const SKIP: { match: RegExp; reason: string }[] = [
  {
    match:
      /^(canvas-background|stroke-color|background-fill|vault-folder|new-drawing-folder|templates-folder|recovery-store|settings-file|link-hint-chars|history-retention-preset|history-privacy|history-delete-all)$/,
    reason:
      "colour pickers, folder pickers, text boxes and destructive buttons (or rows shown only in another state): no simple control to flip; covered by their own specs and the crawler",
  },
  {
    match:
      /^(profile|backup|config-file|install-theme|themes-folder|css-snippets|hotkeys-list)$/,
    reason:
      "lists, pickers and folder buttons: covered by their own specs and the crawler",
  },
];

/** Logged bugs: a problem for this row is not a failure (and fails when it stops showing). */
const KNOWN: { id: RegExp; match: RegExp; bug: string }[] = [];

// The config stand-in leaves an empty table behind when its last key is reset: not a difference.
const overrides = (p: Page) =>
  p.evaluate(() => {
    const prune = (v: any): any => {
      if (v && typeof v === "object") {
        const out: any = {};
        for (const [k, x] of Object.entries(v)) {
          const y = prune(x);
          if (!(y && typeof y === "object" && !Object.keys(y).length)) {
            out[k] = y;
          }
        }
        return out;
      }
      return v;
    };
    return JSON.stringify(prune((window as any).__e2eOverrides ?? {}));
  });

const answers = (p: Page) =>
  Promise.race([
    p.evaluate(() => 1).then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
  ]);

/** Changes the row's first control to another value. Returns what it did, or null. */
const change = async (row: Locator, page: Page): Promise<string | null> => {
  const sw = row.locator('input[role="switch"]').first();
  if (await sw.count()) {
    await sw.click({ force: true });
    return "switch";
  }
  const radio = row.locator('[role="radio"][aria-checked="false"]').first();
  if (await radio.count()) {
    await radio.click();
    return "radio";
  }
  const off = row
    .locator('[role="group"] button[aria-pressed="false"]')
    .first();
  if (await off.count()) {
    await off.click();
    return "choice";
  }
  const select = row.locator("select").first();
  if (await select.count()) {
    const values = await select
      .locator("option")
      .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    const cur = await select.inputValue();
    const next = values.find((v) => v !== cur);
    if (next === undefined) {
      return null;
    }
    await select.selectOption(next);
    return "drop-down";
  }
  const spin = row.locator('[role="spinbutton"], input[type="range"]').first();
  if (await spin.count()) {
    await spin.focus();
    const was = await overrides(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    if ((await overrides(page)) === was) {
      // Already at the top: go down.
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowDown");
    }
    return "number";
  }
  return null;
};

test("every setting: changed through Settings, saved, reset", async ({
  page,
  errors,
}) => {
  test.setTimeout(20 * 60_000);
  for (const s of SKIP) {
    expect(
      snap.settings.some((r) => s.match.test(r.id)),
      `skip entry matches nothing: ${s.match}`,
    ).toBe(true);
  }
  const problems: string[] = [];
  const stats = {
    changed: 0,
    skipped: 0,
    notShown: [] as string[],
    noControl: [] as string[],
  };
  const seen = new Set<string>();

  for (const pg of snap.pages) {
    await openVault(page, "?config=1");
    errors.length = 0;
    await page
      .getByLabel("Vault file navigator")
      .getByRole("button", { name: "Settings" })
      .click();
    const dlg = page.locator('[aria-labelledby="settings-title"]');
    await expect(dlg).toBeVisible();
    const tab = dlg.getByRole("tab", { name: pg.label, exact: true });
    if (!(await tab.count())) {
      problems.push(`page "${pg.label}" has no tab in Settings`);
      continue;
    }
    await tab.click();
    for (const r of snap.settings.filter((x) => x.page === pg.id)) {
      if (SKIP.some((s) => s.match.test(r.id))) {
        stats.skipped++;
        seen.add(r.id);
        continue;
      }
      if (
        process.env.TN2_ONLY &&
        !process.env.TN2_ONLY.split(",").includes(r.id)
      ) {
        seen.add(r.id);
        continue;
      }
      const row = dlg.locator(`[data-setting-id="${r.id}"]`).first();
      if (!(await row.count())) {
        stats.notShown.push(r.id);
        continue;
      }
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      const before = await overrides(page);
      const errBefore = errors.length;
      const kind = await change(row, page);
      if (!kind) {
        stats.noControl.push(r.id);
        continue;
      }
      seen.add(r.id);
      stats.changed++;
      await page.waitForTimeout(200);
      // A row can ask a question first (for example "Turn on AI?"): answer it by closing it.
      const other = page.locator(
        '[role="dialog"]:not([aria-labelledby="settings-title"])',
      );
      if (await other.count()) {
        const yes = other.getByRole("button", { name: /^Turn on$/ });
        if (await yes.count()) {
          await yes.click();
        } else {
          await page.keyboard.press("Escape");
        }
        await page.waitForTimeout(150);
      }
      const add = (m: string) =>
        problems.push(`${r.id} (${pg.label} > ${r.label}): ${m}`);
      if (process.env.TN2_ONLY) {
        // eslint-disable-next-line no-console
        console.log(
          `PROBE ${r.id} ${kind} before=${before} after=${await overrides(
            page,
          )}`,
        );
      }
      if (!(await answers(page))) {
        add("the window stopped answering");
      }
      for (let i = 0; i < 8 && (await overrides(page)) === before; i++) {
        await page.waitForTimeout(150);
      }
      if (r.configKey && (await overrides(page)) === before) {
        add(
          `changed (${kind}) but the config layer has no new value for ${r.configKey}`,
        );
      }
      for (const e of errors.slice(errBefore)) {
        add(`error: ${e.slice(0, 160)}`);
      }
      const reset = row.getByRole("button", { name: /^Reset / });
      if (r.configKey && (await reset.count())) {
        await reset.first().click();
        await page.waitForTimeout(200);
        const after = await overrides(page);
        if (after !== before) {
          add("Reset did not put the config layer back");
        }
      }
      // A question that opens later than the 200 ms above (slow machine): answer it now.
      if (!(await dlg.isVisible()) && (await other.count())) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      if (!(await reset.count()) && kind === "switch") {
        // No Reset on this row: flip it back so the next row starts from the default (a
        // master switch like Offline mode otherwise disables the rows below it).
        await row
          .locator('input[role="switch"]')
          .first()
          .click({ force: true });
        await page.waitForTimeout(200);
      }
      if (!(await dlg.isVisible())) {
        add("the Settings window closed by itself");
        break;
      }
    }
  }

  const unaccounted = snap.settings.filter(
    (r) => !seen.has(r.id) && !stats.notShown.includes(r.id),
  );
  // eslint-disable-next-line no-console
  console.log(
    `SETTINGS total ${snap.settings.length}, changed ${
      stats.changed
    }, skipped with reason ${stats.skipped}, not shown in this state ${
      stats.notShown.length
    } (${stats.notShown.join(" ")}), no simple control ${
      stats.noControl.length
    } (${stats.noControl.join(" ")})`,
  );
  const failures: string[] = [];
  const hit = new Set<number>();
  for (const p of problems) {
    const k = KNOWN.findIndex(
      (x) => x.id.test(p.split(" ")[0]) && x.match.test(p),
    );
    if (k >= 0) {
      hit.add(k);
    } else {
      failures.push(p);
    }
  }
  KNOWN.forEach((k, i) => {
    // An UNVERIFIED entry is a guess about the e2e config fake, not a seen bug; off macOS the guess
    // does not reproduce (TRIAGE.md, linux-ci-triage), so only macOS insists it still shows.
    const guess = k.bug.includes("UNVERIFIED") && process.platform !== "darwin";
    if (!hit.has(i) && !guess) {
      failures.push(`known problem no longer shows, remove it: ${k.bug}`);
    }
  });
  for (const r of unaccounted) {
    failures.push(
      `${r.id}: not shown in the default state (needs a state in this spec or a SKIP reason)`,
    );
  }
  for (const id of stats.noControl) {
    failures.push(
      `${id}: no simple control found (needs a test row or a SKIP reason)`,
    );
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
