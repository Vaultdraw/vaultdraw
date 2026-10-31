/**
 * Which IP literals the app never contacts: private, local, link-local, reserved, multicast, and
 * IPv6 forms that carry such an IPv4 address (mapped, IPv4-compatible, NAT64, 6to4). One
 * TypeScript copy of `src-tauri/src/network.rs is_blocked_address`, used by the fake `ctx.net`
 * and the webview download guard; both suites and Rust run the shared table
 * `vaultdraw-core/src/contract/private_host_cases.json` (toimprove 268, 274).
 */

const v4Blocked = ([a, b, c]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224;

const parseV4 = (h: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m ? m.slice(1).map(Number) : null;
};

/** The 8 groups of an IPv6 literal (as a URL's hostname writes it, without brackets), or null. */
const parseV6 = (h: string): number[] | null => {
  const halves = h.split("::");
  if (halves.length > 2) {
    return null;
  }
  const part = (t: string) => (t === "" ? [] : t.split(":"));
  const [head, tail] = [part(halves[0]), part(halves[1] ?? "")];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) {
    return null;
  }
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))
    ? groups.map((g) => parseInt(g, 16))
    : null;
};

const embeddedV4 = (hi: number, lo: number) => [
  hi >> 8,
  hi & 255,
  lo >> 8,
  lo & 255,
];

/** True for an IP literal (as a URL's hostname writes it) the app never contacts. Host names are not resolved. */
export const isBlockedIpLiteral = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  const v4 = parseV4(host);
  if (v4) {
    return v4Blocked(v4);
  }
  if (!host.startsWith("[")) {
    return false;
  }
  const g = parseV6(host.slice(1, -1));
  if (!g) {
    return false;
  }
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(5) && g[5] === 0xffff) {
    return v4Blocked(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  }
  if (zeros(6)) {
    return true; // ::, ::1 and every IPv4-compatible ::a.b.c.d (deprecated), as network.rs
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64: the well-known prefix carries an IPv4 address; the local-use one is private
    return g[2] === 1 || v4Blocked(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x2002) {
    return v4Blocked(embeddedV4(g[1], g[2])); // 6to4
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g[0] & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g[0] & 0xff00) === 0xff00 // multicast
  );
};
