/** Helpers for tests that use the panel the way a user does. */
import { fireEvent, screen } from "@testing-library/react";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens the mode list and picks a mode by its title (for example "Edit this drawing"). */
export function pickMode(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "Mode" }));
  fireEvent.click(
    screen.getByRole("option", { name: new RegExp(`^${escape(title)}`) }),
  );
}

/** Opens the panel's settings view with the gear. */
export function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
}

/** Types a key for a provider in the settings view and presses its Save. */
export function saveKey(provider: string, key: string) {
  fireEvent.change(screen.getByLabelText(`${provider} API key`), {
    target: { value: key },
  });
  fireEvent.click(screen.getByRole("button", { name: `Save ${provider} key` }));
}
