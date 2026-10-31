/** Install, update and remove themes through an InstallBackend (pure logic, no UI). */

import { parseThemeFile } from "../normalize";

import { themeNameProblem } from "./themeName";
import { InstallError } from "./types";

import type {
  Fetched,
  InstallBackend,
  InstalledTheme,
  RepoTheme,
  Resolved,
  ThemeSource,
  UpdateFetch,
} from "./types";

/** A downloaded theme file and where it came from. */
export interface Candidate {
  json: string;
  source: ThemeSource;
  /** Used when the file has no `name`. */
  fallbackName: string;
}

export const kibToBytes = (kb: number) => Math.max(1, Math.min(256, kb)) * 1024;

const bad = (message: string) => new InstallError("INVALID_THEME", message);

/**
 * What is wrong with a theme file, in words a user can act on (the parser's own messages name theme
 * keys and format hints, which are for theme authors). Null when the shape is fine.
 */
const plainProblem = (parsed: unknown): string | null => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "That file is not a theme file";
  }
  const file = parsed as Record<string, unknown>;
  if (
    file.name !== undefined &&
    (typeof file.name !== "string" || !file.name.trim())
  ) {
    return "The theme's name has to be text";
  }
  if (file.author !== undefined && typeof file.author !== "string") {
    return "The theme's author has to be text";
  }
  if (file.dark === undefined && file.light === undefined) {
    return "That theme has no colours for a dark or a light look";
  }
  return null;
};

/** Checks the file is a valid theme; returns the name it installs under. Throws InstallError. */
export const validateCandidate = (
  json: string,
  fallbackName: string,
): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw bad("The file is not valid JSON");
  }
  const problem = plainProblem(parsed);
  if (problem) {
    throw bad(problem);
  }
  let name: string;
  try {
    name = parseThemeFile(parsed, fallbackName).name;
  } catch {
    throw bad(
      "That theme's colours are incomplete or are not written as hex colours such as #1e1e1e",
    );
  }
  // The name becomes a file name: refuse one the install would refuse here, not after the user
  // pressed Install (same rules as the native install, one case table pins both).
  const nameProblem = themeNameProblem(name);
  if (nameProblem) {
    throw bad(`That theme's name cannot be used: ${nameProblem}`);
  }
  return name;
};

/** The candidate for a theme file found at one address. */
export const fileCandidate = (
  resolved: Extract<Resolved, { kind: "file" }>,
): Candidate => ({
  json: resolved.json,
  fallbackName: resolved.name,
  source: { url: resolved.url, sha256: resolved.sha256 },
});

/** The candidate for one theme of a repository, after its file was downloaded. */
export const repoCandidate = (
  repo: Extract<Resolved, { kind: "repo" }>,
  theme: RepoTheme,
  got: Fetched,
): Candidate => ({
  json: got.json,
  fallbackName: theme.name,
  source: {
    repo: `${repo.owner}/${repo.repo}`,
    path: theme.path,
    commit: repo.commit,
    ref: repo.ref,
    sha256: got.sha256,
    url: got.url,
  },
});

/** Downloads one theme of a repository. */
export const fetchRepoCandidate = async (
  backend: InstallBackend,
  repo: Extract<Resolved, { kind: "repo" }>,
  theme: RepoTheme,
  maxBytes: number,
): Promise<Candidate> =>
  repoCandidate(
    repo,
    theme,
    await backend.fetch(
      {
        kind: "repo",
        owner: repo.owner,
        repo: repo.repo,
        commit: repo.commit,
        path: theme.path,
      },
      maxBytes,
    ),
  );

/**
 * Installs the theme at `input` (a file address or a repository) the way the install dialog does:
 * the same lookup, the same checks, the same write. A repository with several themes needs `theme`
 * (a name or a path in it). Throws InstallError.
 */
export const installFromInput = async (
  backend: InstallBackend,
  input: string,
  options: { theme?: string; replace?: boolean; maxBytes: number },
): Promise<string> => {
  const resolved = await backend.resolve(input.trim(), options.maxBytes);
  if (resolved.kind === "file") {
    return installCandidate(backend, fileCandidate(resolved), options);
  }
  const wanted = options.theme?.toLowerCase();
  const names = resolved.themes.map((t) => t.name).join(", ");
  const match = wanted
    ? resolved.themes.find(
        (t) =>
          t.name.toLowerCase() === wanted || t.path.toLowerCase() === wanted,
      )
    : resolved.themes.length === 1
    ? resolved.themes[0]
    : undefined;
  if (!match) {
    throw new InstallError(
      "THEME_NOT_CHOSEN",
      wanted
        ? `No theme called ${options.theme} in that repository. It has: ${names}`
        : `That repository has several themes (${names}). Say which one to install`,
    );
  }
  const cand = await fetchRepoCandidate(
    backend,
    resolved,
    match,
    options.maxBytes,
  );
  return installCandidate(backend, cand, options);
};

/** The file's JSON with its `name` set, so a renamed copy shows under its new name. */
const withName = (json: string, name: string): string =>
  JSON.stringify({ ...JSON.parse(json), name }, null, 2);

/** Validates, then writes. `asName` installs under another name (clash resolution). */
export const installCandidate = async (
  backend: InstallBackend,
  candidate: Candidate,
  options: { replace?: boolean; asName?: string } = {},
): Promise<string> => {
  const name = validateCandidate(candidate.json, candidate.fallbackName);
  const written = await backend.write({
    name: options.asName ?? name,
    json: options.asName
      ? withName(candidate.json, options.asName)
      : candidate.json,
    source: candidate.source,
    replace: options.replace ?? false,
  });
  return written.name;
};

/** "Name 2", "Name 3", ... the first not in `taken` (case-insensitive). */
export const freeName = (name: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let i = 2; ; i++) {
    const next = `${name} ${i}`;
    if (!used.has(next.toLowerCase())) {
      return next;
    }
  }
};

export type UpdateStatus =
  | { name: string; state: "current" }
  | { name: string; state: "newer"; fetched: UpdateFetch }
  | { name: string; state: "failed"; message: string };

/** Checks every installed theme for a newer file. Nothing is written. */
export const checkUpdates = async (
  backend: InstallBackend,
  installed: InstalledTheme[],
  maxBytes: number,
): Promise<UpdateStatus[]> => {
  const results: UpdateStatus[] = [];
  for (const { name } of installed) {
    try {
      const fetched = await backend.updateFetch(name, maxBytes);
      results.push(
        fetched.changed && fetched.json
          ? { name, state: "newer", fetched }
          : { name, state: "current" },
      );
    } catch (err) {
      results.push({
        name,
        state: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
};

/** Writes a fetched update over the installed theme (validated first). */
export const applyUpdate = async (
  backend: InstallBackend,
  theme: InstalledTheme,
  fetched: UpdateFetch,
): Promise<void> => {
  if (!fetched.json) {
    return;
  }
  validateCandidate(fetched.json, theme.name);
  await backend.write({
    name: theme.name,
    json: fetched.json,
    source: {
      ...theme.source,
      sha256: fetched.sha256,
      commit: fetched.commit ?? theme.source.commit,
    },
    replace: true,
  });
};
