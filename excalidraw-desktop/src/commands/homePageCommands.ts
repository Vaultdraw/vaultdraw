/**
 * Start page commands: choose what the vault home pane shows when no drawing is
 * open (`interface.home_page`). Rebindable, no default keys.
 */
import { updatePreferences, type HomePage } from "../vault/preferences";

import type { CommandDefinition, CommandHandlers } from "./types";

export const homePageCommandId = (mode: HomePage) => `view.homePage.${mode}`;

const TITLES: Record<HomePage, string> = {
  full: "Start page: Actions and recent drawings",
  minimal: "Start page: Actions only",
  blank: "Start page: Blank",
};

const MODES = Object.keys(TITLES) as HomePage[];

export const HOME_PAGE_COMMANDS: CommandDefinition[] = MODES.map((mode) => ({
  id: homePageCommandId(mode),
  title: TITLES[mode],
  category: "View",
  keys: { default: [] },
}));

export const HOME_PAGE_COMMAND_HANDLERS: CommandHandlers = Object.fromEntries(
  MODES.map((mode) => [
    homePageCommandId(mode),
    () => {
      updatePreferences({ homePage: mode });
    },
  ]),
);
