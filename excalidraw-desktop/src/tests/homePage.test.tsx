import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VaultHome } from "../components/VaultHome";
import { getCommand } from "../commands/commands";
import {
  HOME_PAGE_COMMAND_HANDLERS,
  homePageCommandId,
} from "../commands/homePageCommands";
import {
  getPreferences,
  HOME_PAGES,
  normalizePreferences,
  updatePreferences,
} from "../vault/preferences";

const recent = [{ path: "a/One.excalidraw", name: "One", folder: "a" }];

const mount = (mode?: typeof HOME_PAGES[number]) =>
  render(
    <VaultHome
      readOnly={false}
      recent={recent}
      onRun={vi.fn()}
      onOpenDrawing={vi.fn()}
      ownerWindow={window}
      mode={mode}
    />,
  );

afterEach(() => {
  cleanup();
  updatePreferences({ homePage: "full" }, window);
  localStorage.clear();
});

describe("start page (interface.home_page)", () => {
  it("full (the default) shows the actions and the recent drawings", () => {
    expect(getPreferences(window).homePage).toBe("full");
    mount();
    expect(screen.getByText(/New drawing/)).toBeInTheDocument();
    expect(screen.getByLabelText("Recent drawings")).toBeInTheDocument();
  });

  it("minimal shows the actions but no recent drawings", () => {
    mount("minimal");
    expect(screen.getByText(/New drawing/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Recent drawings")).toBeNull();
    expect(screen.queryByText("One")).toBeNull();
  });

  it("blank shows nothing at all", () => {
    const { container } = mount("blank");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("a value other than full, minimal or blank falls back to full", () => {
    expect(normalizePreferences({ homePage: "minimal" }).homePage).toBe(
      "minimal",
    );
    expect(normalizePreferences({ homePage: "huge" }).homePage).toBe("full");
    expect(normalizePreferences({ homePage: true }).homePage).toBe("full");
  });

  it("each mode has a palette command that sets it", () => {
    for (const mode of HOME_PAGES) {
      const id = homePageCommandId(mode);
      expect(getCommand(id), id).toBeDefined();
      void HOME_PAGE_COMMAND_HANDLERS[id]!();
      expect(getPreferences(window).homePage).toBe(mode);
    }
  });
});
