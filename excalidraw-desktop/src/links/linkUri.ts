/** `vaultdraw://open?file=<target>`: encodeURIComponent, but `/` stays readable. */
export const VAULT_URL_PREFIX = "vaultdraw://open";

export function encodeVaultUrl(target: string, anchor?: string | null): string {
  const url = `${VAULT_URL_PREFIX}?file=${encodeURIComponent(target).replace(
    /%2F/gi,
    "/",
  )}`;
  return anchor ? `${url}&anchor=${encodeURIComponent(`^${anchor}`)}` : url;
}

/** The element id of a vaultdraw URL's `anchor=^id` parameter, or null. */
export function decodeVaultUrlAnchor(url: string): string | null {
  const q = url.indexOf("?");
  if (!url.startsWith(VAULT_URL_PREFIX) || q < 0) {
    return null;
  }
  const hash = url.indexOf("#", q);
  for (const pair of url.slice(q + 1, hash < 0 ? undefined : hash).split("&")) {
    if (pair.startsWith("anchor=")) {
      try {
        const v = decodeURIComponent(pair.slice(7));
        return v.startsWith("^") && ANCHOR_RE.test(v.slice(1))
          ? v.slice(1)
          : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const ANCHOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The target of a vaultdraw URL (`file=` or the older `path=`), or null. */
export function decodeVaultUrl(url: string): string | null {
  if (!url.startsWith(VAULT_URL_PREFIX)) {
    return null;
  }
  const rest = url.slice(VAULT_URL_PREFIX.length);
  if (!rest.startsWith("?")) {
    return null;
  }
  const hash = rest.indexOf("#");
  const query = rest.slice(1, hash < 0 ? undefined : hash);
  let found: string | null = null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if ((key === "file" || key === "path") && eq >= 0 && found === null) {
      try {
        found = decodeURIComponent(pair.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return found ? found : null;
}
