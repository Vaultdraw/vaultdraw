/**
 * A drawing's own settings (`DrawingSettings`): read them from the editor state, and turn a change
 * into one appState patch, so it lands in the same undo step as a batch of ops.
 */
import { createBackgroundPattern } from "@excalidraw/excalidraw/data/backgroundPattern";
import {
  isPageModeOn,
  PAGE_SIZE_PRESET_IDS,
  type PageSetup,
} from "@excalidraw/excalidraw/data/pageSetup";

import type { AppState } from "@excalidraw/excalidraw/types";

import { getPageSetupPatch } from "../page/pageSetupChange";
import { getDefaultPageSetup } from "../vault/pageDefaults";

import type { DrawingSettings } from "../../../sdk/api/src/index";

type State = Pick<
  AppState,
  "pageSetup" | "viewBackgroundColor" | "viewBackgroundPattern"
>;

export type DrawingPatch = Partial<
  Pick<
    AppState,
    "pageSetup" | "viewBackgroundColor" | "viewBackgroundPattern"
  >
>;

/** The settings as they are now, every field filled (no `pageSize` for a custom size). */
export function readDrawingSettings(state: State): DrawingSettings {
  const page = state.pageSetup;
  const size = page?.size;
  return {
    pageMode: isPageModeOn(page),
    paper: state.viewBackgroundPattern?.type ?? "plain",
    paperTheme: page?.paperTheme ?? "normal",
    ...(size && (PAGE_SIZE_PRESET_IDS as readonly string[]).includes(size)
      ? { pageSize: size as DrawingSettings["pageSize"] }
      : {}),
    orientation: page?.orientation ?? "portrait",
    layout: page?.layout ?? "separate",
    background: state.viewBackgroundColor,
  };
}

/** The appState patch for `settings` (already checked); empty when nothing would change. */
export function drawingPatch(
  state: State,
  settings: DrawingSettings,
  win: Window | null = typeof window === "undefined" ? null : window,
): DrawingPatch {
  const changes: Partial<PageSetup> = {};
  if (settings.pageMode !== undefined) {
    changes.enabled = settings.pageMode;
  }
  if (settings.paperTheme !== undefined) {
    changes.paperTheme = settings.paperTheme;
  }
  if (settings.pageSize !== undefined) {
    changes.size = settings.pageSize;
  }
  if (settings.orientation !== undefined) {
    changes.orientation = settings.orientation;
  }
  if (settings.layout !== undefined) {
    changes.layout = settings.layout;
  }
  let patch: DrawingPatch = {};
  let now: State = state;
  if (Object.keys(changes).length > 0) {
    // a drawing without a page setup starts from the app default, page mode off unless asked
    const full = state.pageSetup
      ? changes
      : { ...getDefaultPageSetup(win), enabled: false, ...changes };
    patch = getPageSetupPatch(state, full);
    now = { ...state, ...patch };
  }
  if (settings.paper !== undefined) {
    const current = now.viewBackgroundPattern ?? null;
    if (settings.paper === "plain") {
      patch = { ...patch, viewBackgroundPattern: null };
    } else if (current?.type !== settings.paper) {
      // the pattern colour (an old-school paper's blue) carries over to the new style
      patch = {
        ...patch,
        viewBackgroundPattern: createBackgroundPattern(settings.paper, {
          color: current?.color ?? null,
        }),
      };
    }
  }
  if (settings.background !== undefined) {
    patch = { ...patch, viewBackgroundColor: settings.background };
  }
  return patch;
}
