/**
 * Where an image exported into a chosen folder lands: the browser fake's twin
 * of `write_into` in src-tauri/src/export_folder.rs. Both answer the case
 * table vaultdraw-core/src/contract/export_folder_cases.json.
 */
import type { ExportExistingMode } from "../../components/tree/treeSettings";

export type ExportWrite = { status: "written" | "skipped"; path: string };

/** A relative path inside the chosen folder: no `..`, `.`, empty parts, backslashes or leading slash. */
export function isValidExportPath(rel: string): boolean {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    rel.includes("\\") ||
    rel.includes("\0")
  ) {
    return false;
  }
  return rel.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/** The path a write ends at, given which paths already exist. */
export function exportTarget(
  exists: (rel: string) => boolean,
  rel: string,
  existing: ExportExistingMode,
): ExportWrite {
  if (!isValidExportPath(rel)) {
    throw new Error("INVALID_PATH");
  }
  if (!exists(rel)) {
    return { status: "written", path: rel };
  }
  if (existing === "skip") {
    return { status: "skipped", path: rel };
  }
  if (existing === "replace") {
    return { status: "written", path: rel };
  }
  const slash = rel.lastIndexOf("/");
  const dir = rel.slice(0, slash + 1);
  const name = rel.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const [stem, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${dir}${stem} ${n}${ext}`;
    if (!exists(candidate)) {
      return { status: "written", path: candidate };
    }
  }
  throw new Error("NAME_COLLISION");
}
