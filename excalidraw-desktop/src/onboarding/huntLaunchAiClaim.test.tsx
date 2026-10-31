/** Launch hunt 2026-10-31: "Run setup again" with the AI assistant on still says it is off. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

it.fails("Extras and Done do not claim the AI assistant is off when it is on", () => {
  updatePreferences({ aiEnabled: true }, window);
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
  const step = () => screen.getByTestId("setup").getAttribute("data-step");
  let guard = 0;
  while (step() !== "extras" && guard++ < 10) {
    fireEvent.click(screen.getByRole("button", { name: /^(Next|Get started)/ }));
  }
  expect(screen.getByTestId("setup-ai-note").textContent).not.toMatch(
    /AI assistant: off/,
  );
});
