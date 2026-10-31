/** The text Vaultdraw writes for a link, per the user's link settings. */
import { stripExtension } from "./grammar";
import { encodeVaultUrl } from "./linkUri";
import { relativePath } from "./resolve";

import type { LinkResolver } from "./resolve";
import type { NewLinkFormat, ShapeLinkFormat } from "./types";

/** The target to put inside `[[...]]` for the drawing at `targetPath`. */
export function linkTargetFor(
  targetPath: string,
  fromPath: string | null,
  resolver: LinkResolver,
  format: NewLinkFormat,
): string {
  switch (format) {
    case "absolute":
      return stripExtension(targetPath);
    case "relative": {
      if (fromPath === null) {
        return stripExtension(targetPath);
      }
      const rel = stripExtension(relativePath(fromPath, targetPath));
      return rel.startsWith("../") ? rel : `./${rel}`;
    }
    default:
      return resolver.shortestTarget(targetPath);
  }
}

/** `[[target]]`, `[[target|label]]`, or with an element anchor `[[target#^id]]`. */
export const wikiLink = (
  target: string,
  label?: string | null,
  anchor?: string | null,
) => {
  const at = anchor ? `${target}#^${anchor}` : target;
  return label ? `[[${at}|${label}]]` : `[[${at}]]`;
};

/** The link a found `[[...]]` span stands for, anchor kept (what the openers are given). */
export const spanRaw = (span: { target: string; anchor: string | null }) =>
  wikiLink(span.target, null, span.anchor);

/** The value of an element's `link` field for `target`, optionally pointing at one element. */
export const shapeLinkValue = (
  target: string,
  format: ShapeLinkFormat,
  anchor?: string | null,
) =>
  format === "vaultdraw-url"
    ? encodeVaultUrl(target, anchor)
    : wikiLink(target, null, anchor);
