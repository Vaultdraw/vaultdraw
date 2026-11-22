/** Helpers for tests that use the panel the way a user does. */
import { fireEvent, screen } from "@testing-library/react";

export const BOX = "Ask, explain, draw or change anything";

/** Types a message into the one box and sends it with Enter. */
export function ask(text: string) {
  const box = screen.getByLabelText(BOX);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
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
