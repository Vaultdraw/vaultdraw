/**
 * Picture commands: pure data, always loaded. The viewer binds the handlers while a picture tab
 * is shown, and `picture.active` is true only then, so none of these is offered (or bound to a
 * key) anywhere else. `files.toggleAssets` works everywhere a vault is open.
 */
import type { CommandDefinition, WhenClause } from "../commands/types";

export const PICTURE_COMMAND_IDS = {
  zoomIn: "picture.zoomIn",
  zoomOut: "picture.zoomOut",
  fit: "picture.fit",
  actualSize: "picture.actualSize",
  reload: "picture.reload",
} as const;

export const ASSET_COMMAND_IDS = {
  toggleAssets: "files.toggleAssets",
} as const;

/** Context key true while a picture tab is shown (commands/contextKeys.ts). */
export const PICTURE_ACTIVE_KEY = "picture.active";

// `!drawingOpen`: a picture tab and the editor never show together, so Mod+0 here never
// clashes with the canvas's Reset zoom.
const WHEN: WhenClause[] = [
  "vaultOpen",
  "!drawingOpen",
  PICTURE_ACTIVE_KEY,
  "!modalOpen",
];

const picture = (
  id: string,
  title: string,
  keys: string[] = [],
): CommandDefinition => ({
  id,
  title: `Picture: ${title}`,
  category: "View",
  keys: { default: keys },
  when: WHEN,
});

export const ASSET_COMMANDS: readonly CommandDefinition[] = [
  picture(PICTURE_COMMAND_IDS.zoomIn, "Zoom in", ["Mod+="]),
  picture(PICTURE_COMMAND_IDS.zoomOut, "Zoom out", ["Mod+-"]),
  picture(PICTURE_COMMAND_IDS.fit, "Fit to window", ["Mod+0"]),
  picture(PICTURE_COMMAND_IDS.actualSize, "Actual size"),
  picture(PICTURE_COMMAND_IDS.reload, "Reload from disk"),
  {
    id: ASSET_COMMAND_IDS.toggleAssets,
    title: "Files: Show or hide pictures and PDFs in the tree",
    category: "Navigator",
    keys: { default: [] },
    when: ["vaultOpen"],
  },
];
