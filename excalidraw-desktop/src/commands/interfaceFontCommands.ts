/**
 * Interface font size commands (`interface.font_size`): bigger, smaller and
 * reset. Rebindable, no default keys (Cmd+Shift +/-/0 already zoom the whole
 * window).
 */
import { runUiFontCommand } from "../theme/useInterfaceFont";

import type { UiFontCommand } from "../theme/interfaceFont";
import type { CommandDefinition, CommandHandlers } from "./types";

export const uiFontCommandId = (command: UiFontCommand) =>
  `view.interfaceFont.${command}`;

const TITLES: Record<UiFontCommand, string> = {
  bigger: "Interface font: Bigger",
  smaller: "Interface font: Smaller",
  reset: "Interface font: Reset size",
};

const ACTIONS = Object.keys(TITLES) as UiFontCommand[];

export const INTERFACE_FONT_COMMANDS: CommandDefinition[] = ACTIONS.map(
  (command) => ({
    id: uiFontCommandId(command),
    title: TITLES[command],
    category: "View",
    keys: { default: [] },
    ...(command === "reset" ? {} : { repeat: true }),
  }),
);

export const INTERFACE_FONT_COMMAND_HANDLERS: CommandHandlers =
  Object.fromEntries(
    ACTIONS.map((command) => [
      uiFontCommandId(command),
      () => runUiFontCommand(command),
    ]),
  );
