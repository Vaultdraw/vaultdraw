/**
 * `theme.install`: the CLI's way into the app's theme installer. It runs the same code as the
 * install dialog (lookup, checks, write), so there is one owner of the rules: the web address and
 * size limits, Offline mode and the "theme downloads" switch all apply here too.
 */
import { boolParam, optionalStringParam, stringParam } from "./params";

import type { InstallBackend } from "../theme/install/types";

export interface ThemeDeps {
  backend: () => Promise<InstallBackend>;
  /** The largest theme file to download, in KiB (the setting). */
  maxKb: () => number;
  /** Tells the app a theme was added (the same refresh the dialog does). */
  reload: () => Promise<unknown>;
}

export function createThemeMethods(
  deps: ThemeDeps,
): Record<string, (params: unknown) => Promise<unknown>> {
  return {
    "theme.install": async (params) => {
      const url = stringParam(params, "url");
      const theme = optionalStringParam(params, "theme");
      const replace = boolParam(params, "replace", false);
      // Loaded on first use: nothing of the installer costs anything until a theme is installed.
      const { installFromInput, kibToBytes } = await import(
        "../theme/install/installer"
      );
      const name = await installFromInput(await deps.backend(), url, {
        theme,
        replace,
        maxBytes: kibToBytes(deps.maxKb()),
      });
      await deps.reload();
      return { name };
    },
  };
}
