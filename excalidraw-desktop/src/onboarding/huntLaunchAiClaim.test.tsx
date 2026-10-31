/**
 * Launch hunt 2026-10-31 (toimprove 326): "Run setup again" with the AI assistant on said it was off.
 * Family: setup text that states a setting must read the setting, so a re-run tells the truth.
 * Members: the Extras note and the Done summary row, each with AI on and off.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updatePreferences } from "../vault/preferences";

import SetupWizard from "./SetupWizard";
import { FORCE_SETUP_FLAG } from "./setupState";
import { closeSetup } from "./setupStore";

beforeEach(() => {
  window.localStorage.clear();
  (globalThis as Record<string, unknown>)[FORCE_SETUP_FLAG] = true;
});
afterEach(() => {
  cleanup();
  closeSetup();
  delete (globalThis as Record<string, unknown>)[FORCE_SETUP_FLAG];
});

const step = () => screen.getByTestId("setup").getAttribute("data-step");

const goTo = (target: string) => {
  let guard = 0;
  while (step() !== target && guard++ < 10) {
    fireEvent.click(
      screen.getByRole("button", { name: /^(Next|Get started)/ }),
    );
  }
  expect(step()).toBe(target);
};

const renderWizard = () =>
  render(
    <SetupWizard
      win={window}
      hasVault
      recentVaults={[]}
      lastVaultPath={null}
      onOpenVault={vi.fn()}
      onCreateVault={vi.fn()}
      onSelectRecent={vi.fn()}
      refreshAppearance={vi.fn()}
    />,
  );

describe("setup states the AI assistant as it is set", () => {
  for (const aiEnabled of [true, false]) {
    const word = aiEnabled ? "on" : "off";
    it(`AI ${word}: the Extras note and the summary say ${word}`, () => {
      updatePreferences({ aiEnabled }, window);
      renderWizard();
      goTo("extras");
      expect(screen.getByTestId("setup-ai-note").textContent).toMatch(
        new RegExp(`AI assistant: ${word}\\b`),
      );
      goTo("done");
      const extras = [
        ...screen.getByTestId("setup-summary").querySelectorAll("div"),
      ].find((row) => row.querySelector("dt")?.textContent === "Extras");
      expect(extras?.querySelector("dd")?.textContent).toMatch(
        new RegExp(`AI assistant ${word}$`),
      );
    });
  }
});
