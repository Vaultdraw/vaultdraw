import { describe, expect, it, vi } from "vitest";

import { createThemeMethods } from "../control/themeMethods";
import { installFromInput } from "../theme/install/installer";
import { InstallError } from "../theme/install/types";

import type {
  InstallBackend,
  Resolved,
  WriteRequest,
} from "../theme/install/types";

const THEME = (name: string) =>
  JSON.stringify({
    name,
    dark: { mSurface: "#101820", mOnSurface: "#e8e8e8", mPrimary: "#4aa3ff" },
  });

const backendFor = (resolved: Resolved | Error) => {
  const written: WriteRequest[] = [];
  const backend: InstallBackend = {
    resolve: async () => {
      if (resolved instanceof Error) {
        throw resolved;
      }
      return resolved;
    },
    fetch: async (ref) => ({
      json: THEME(ref.kind === "repo" ? ref.path.replace(/\.json$/, "") : "x"),
      sha256: "h",
      url: "https://raw/x",
    }),
    write: async (r) => {
      if (r.name === "Taken" && !r.replace) {
        throw new InstallError("THEME_EXISTS", "A theme named Taken exists");
      }
      written.push(r);
      return { name: r.name };
    },
    installed: async () => [],
    updateFetch: vi.fn(),
    uninstall: vi.fn(),
  };
  return { backend, written };
};

const repo = (names: string[]): Resolved => ({
  kind: "repo",
  owner: "o",
  repo: "r",
  commit: "c0ffee",
  ref: "HEAD",
  themes: names.map((n) => ({ name: n, path: `${n}.json` })),
});

describe("installFromInput (the CLI path through the dialog's installer)", () => {
  const opts = { maxBytes: 1024 };

  it("installs a theme file with its source recorded", async () => {
    const { backend, written } = backendFor({
      kind: "file",
      name: "x",
      json: THEME("Night Owl"),
      sha256: "abc",
      url: "https://e.com/n.json",
    });
    expect(
      await installFromInput(backend, " https://e.com/n.json ", opts),
    ).toBe("Night Owl");
    expect(written[0].source).toEqual({
      url: "https://e.com/n.json",
      sha256: "abc",
    });
    expect(written[0].replace).toBe(false);
  });

  it("takes the only theme of a repository, records repo, commit and ref", async () => {
    const { backend, written } = backendFor(repo(["Solo"]));
    expect(await installFromInput(backend, "o/r", opts)).toBe("Solo");
    expect(written[0].source).toMatchObject({
      repo: "o/r",
      path: "Solo.json",
      commit: "c0ffee",
      ref: "HEAD",
    });
  });

  it("asks which one when a repository has several, and lists them", async () => {
    const { backend, written } = backendFor(repo(["A", "B"]));
    await expect(installFromInput(backend, "o/r", opts)).rejects.toMatchObject({
      code: "THEME_NOT_CHOSEN",
      message: expect.stringContaining("A, B"),
    });
    expect(written).toEqual([]);
  });

  it("picks by name or path, any case; an unknown name installs nothing", async () => {
    const { backend, written } = backendFor(repo(["A", "B"]));
    expect(
      await installFromInput(backend, "o/r", { ...opts, theme: "b" }),
    ).toBe("B");
    expect(
      await installFromInput(backend, "o/r", { ...opts, theme: "A.JSON" }),
    ).toBe("A");
    await expect(
      installFromInput(backend, "o/r", { ...opts, theme: "Z" }),
    ).rejects.toMatchObject({ code: "THEME_NOT_CHOSEN" });
    expect(written).toHaveLength(2);
  });

  it("refuses a clash unless replace is set, passes backend refusals through", async () => {
    const taken = backendFor({
      kind: "file",
      name: "x",
      json: THEME("Taken"),
      sha256: "a",
      url: "u",
    });
    await expect(
      installFromInput(taken.backend, "u", opts),
    ).rejects.toMatchObject({ code: "THEME_EXISTS" });
    expect(
      await installFromInput(taken.backend, "u", { ...opts, replace: true }),
    ).toBe("Taken");
    const off = backendFor(
      new InstallError("NETWORK_NOT_ALLOWED", "Offline mode is on"),
    );
    await expect(
      installFromInput(off.backend, "u", opts),
    ).rejects.toMatchObject({ code: "NETWORK_NOT_ALLOWED" });
  });

  it("rejects a file that is not a theme before writing", async () => {
    const bad = backendFor({
      kind: "file",
      name: "x",
      json: "[]",
      sha256: "a",
      url: "u",
    });
    await expect(
      installFromInput(bad.backend, "u", opts),
    ).rejects.toMatchObject({ code: "INVALID_THEME" });
    expect(bad.written).toEqual([]);
  });
});

describe("theme.install window method", () => {
  const make = (resolved: Resolved) => {
    const { backend, written } = backendFor(resolved);
    const reload = vi.fn(async () => {});
    const methods = createThemeMethods({
      backend: async () => backend,
      maxKb: () => 64,
      reload,
    });
    return { methods, written, reload };
  };

  it("installs, reloads the themes, and returns the name", async () => {
    const { methods, reload } = make({
      kind: "file",
      name: "x",
      json: THEME("Dusk"),
      sha256: "a",
      url: "u",
    });
    expect(await methods["theme.install"]({ url: "u" })).toEqual({
      name: "Dusk",
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the install fails; bad params are refused", async () => {
    const { methods, reload } = make(repo(["A", "B"]));
    await expect(
      methods["theme.install"]({ url: "o/r" }),
    ).rejects.toMatchObject({ code: "THEME_NOT_CHOSEN" });
    await expect(methods["theme.install"]({})).rejects.toMatchObject({
      code: "INVALID_PARAMS",
    });
    await expect(
      methods["theme.install"]({ url: "u", replace: "yes" }),
    ).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(reload).not.toHaveBeenCalled();
  });
});
