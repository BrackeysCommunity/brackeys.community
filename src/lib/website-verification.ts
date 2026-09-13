/**
 * Domain-control proof for a profile's PORTFOLIO row — the parts both sides
 * of the wire need.
 *
 * A `PORTFOLIO` row reading `booth.dev` looks identical whether it is the
 * member's site or someone borrowing it. This is the mechanism Bluesky's
 * handle verification and Discord's developer-portal domain check both use:
 * a token the site hands you, placed somewhere only the host's owner can
 * put it, checked on demand. Two placements, because they suit different
 * people — a DNS `TXT` record for whoever owns the domain, a static file
 * for whoever can only push to a web root (a GitHub Pages or itch site).
 *
 * It proves domain control and nothing else. The badge says VERIFIED, never
 * a blue checkmark, which on every other platform means identity.
 *
 * No node built-ins here: the profile page imports `stampCoversUrl` to
 * decide whether a stamp still belongs to the URL beside it. The checking
 * half — DNS, the fetch, and the address guard around it — is
 * `website-verification-check.ts`.
 */

export const VERIFY_TXT_PREFIX = "brackeys-verify=";
export const VERIFY_WELL_KNOWN_PATH = "/.well-known/brackeys-verify.txt";

/** How the proof was found, for the stamp's copy. */
export type VerificationMethod = "dns" | "file";

export type VerificationResult =
  | { verified: true; method: VerificationMethod }
  | { verified: false; reason: string };

export function verificationTxtRecord(token: string): string {
  return `${VERIFY_TXT_PREFIX}${token}`;
}

/**
 * The host a URL's proof covers. `www.booth.dev` and `booth.dev` are two
 * different checks — an apex TXT record verifying every subdomain would
 * also verify `anyone.github.io`, which the apex owner does not control.
 */
export function verificationHost(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.hostname.toLowerCase() || null;
}

/**
 * The host a check may run against, or why it may not. `https:` only: the
 * well-known file is fetched over TLS or not at all, and a member pointing
 * at an http-only host is told so rather than watching a check fail.
 */
export function verifiableHost(
  url: string | null | undefined,
): { host: string } | { error: string } {
  const trimmed = url?.trim();
  if (!trimmed) return { error: "Add a portfolio URL first." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "That portfolio URL can't be read." };
  }
  if (parsed.protocol !== "https:") return { error: "Verification needs an https:// URL." };
  const host = parsed.hostname.toLowerCase();
  if (!host) return { error: "That portfolio URL has no host." };
  return { host };
}

/**
 * The record's NAME as a DNS panel wants it: relative to the zone, with
 * `@` for the zone itself. Pasting a fully-qualified name into GoDaddy or
 * Namecheap creates `booth.dev.booth.dev` — Cloudflare normalises it, most
 * panels do not, and the member has no way to tell which they're in.
 *
 * With no known zone there is nothing to be relative to, so the FQDN is
 * returned unchanged: a name that needs trimming beats a wrong `@`.
 */
export function relativeRecordName(host: string, zone: string | null | undefined): string {
  if (!zone) return host;
  const h = host.toLowerCase();
  const z = zone.toLowerCase();
  if (h === z) return "@";
  if (h.endsWith(`.${z}`)) return h.slice(0, -(z.length + 1));
  return host;
}

/**
 * Whether a stamp still belongs to a URL. A path change on the same host
 * keeps it; a different host is a different claim and drops it.
 */
export function stampCoversUrl(
  verifiedHost: string | null | undefined,
  url: string | null | undefined,
): boolean {
  if (!verifiedHost) return false;
  return verificationHost(url) === verifiedHost;
}

function ipv4IsPrivate(address: string): boolean {
  const octets = address.split(".").map(Number);
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Link-local, and the cloud metadata endpoint that lives inside it.
  if (a === 169 && b === 254) return true;
  // Carrier-grade NAT and the benchmarking range: not the public internet.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6IsPrivate(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped (`::ffff:10.0.0.1`) is the same address by another spelling.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return ipv4IsPrivate(mapped[1]);
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  return false;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Every range a member-supplied host must not resolve into. */
export function isPrivateAddress(address: string): boolean {
  return IPV4.test(address) ? ipv4IsPrivate(address) : ipv6IsPrivate(address);
}
