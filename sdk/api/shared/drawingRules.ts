/**
 * `DrawingSettings` rules, shared by the app's host and the mock: which fields and values a
 * plugin may set on a drawing (`scene.batch(ops, { drawing })`).
 */
import { PAGE_SIZES } from "./pages";
import { PluginApiError } from "./rules";

import type { DrawingSettings, PaperStyle } from "@vaultdraw/api";

export const PAPER_STYLES: readonly PaperStyle[] = [
  "plain",
  "lines",
  "grid",
  "dots",
  "graph",
  "isometric",
];
const PAPER_THEMES = ["normal", "oldSchool", "match"] as const;
const ORIENTATIONS = ["portrait", "landscape"] as const;
const LAYOUTS = ["separate", "continuous"] as const;
const COLOR = /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i;

const bad = (message: string) =>
  new PluginApiError("INVALID_ARGUMENT", `scene.batch drawing: ${message}`);

const oneOf = (key: string, v: unknown, allowed: readonly string[]) => {
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw bad(`${key} must be one of ${allowed.join(", ")}`);
  }
};

/** A copy of `input` with only the known fields, or throws `INVALID_ARGUMENT`. */
export function checkDrawingSettings(input: unknown): DrawingSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw bad("must be an object");
  }
  const s = input as Record<string, unknown>;
  const known = [
    "pageMode",
    "paper",
    "paperTheme",
    "pageSize",
    "orientation",
    "layout",
    "background",
  ];
  const extra = Object.keys(s).find((k) => !known.includes(k));
  if (extra !== undefined) {
    throw bad(`unknown field "${extra}"`);
  }
  const out: DrawingSettings = {};
  if (s.pageMode !== undefined) {
    if (typeof s.pageMode !== "boolean") {
      throw bad("pageMode must be true or false");
    }
    out.pageMode = s.pageMode;
  }
  if (s.paper !== undefined) {
    oneOf("paper", s.paper, PAPER_STYLES);
    out.paper = s.paper as PaperStyle;
  }
  if (s.paperTheme !== undefined) {
    oneOf("paperTheme", s.paperTheme, PAPER_THEMES);
    out.paperTheme = s.paperTheme as DrawingSettings["paperTheme"];
  }
  if (s.pageSize !== undefined) {
    oneOf("pageSize", s.pageSize, Object.keys(PAGE_SIZES));
    out.pageSize = s.pageSize as DrawingSettings["pageSize"];
  }
  if (s.orientation !== undefined) {
    oneOf("orientation", s.orientation, ORIENTATIONS);
    out.orientation = s.orientation as DrawingSettings["orientation"];
  }
  if (s.layout !== undefined) {
    oneOf("layout", s.layout, LAYOUTS);
    out.layout = s.layout as DrawingSettings["layout"];
  }
  if (s.background !== undefined) {
    if (typeof s.background !== "string" || !COLOR.test(s.background)) {
      throw bad("background must be #rgb, #rrggbb, #rrggbbaa or transparent");
    }
    out.background = s.background;
  }
  return out;
}
