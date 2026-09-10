/**
 * One gate for every link a member types into the app.
 *
 * `z.url()` only asserts that a string parses as a URL — it says nothing
 * about the scheme, so `javascript:`, `data:`, `vbscript:` and `file:` all
 * pass it. Every member-supplied link column was guarded by exactly that
 * and nothing else, which made any project, team, profile or collab post a
 * place to park a payload behind a label the reader trusts.
 *
 * `http:` is allowed alongside `https:`: an http link to a hostile host is
 * no more dangerous than an https one, and rejecting it would fail members
 * whose existing personal domain has never had a certificate.
 *
 * The display half lives here too. `externalUrlHost` is what lets a link
 * show where it actually goes, and `isHostOrSubdomainOf` is how a CTA that
 * names a site (PLAY ON ITCH.IO) checks that claim before making it.
 */
import { z } from "zod";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Matches the `varchar(500)` these columns are declared as. */
export const EXTERNAL_URL_MAX_LENGTH = 500;

/** Parsed form of a member-supplied link, or null if it isn't one we'd render. */
export function parseExternalUrl(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > EXTERNAL_URL_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // `https://user:pw@evil.example/x` renders as "evil.example" in most
  // status bars but reads as a trusted name to anyone skimming the string.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url;
}

/** Whether a string is a link this app is willing to store and render. */
export function isExternalUrl(value: string | null | undefined): boolean {
  return parseExternalUrl(value) !== null;
}

/**
 * The hostname a link actually goes to, `www.` dropped, for showing the
 * viewer their destination before they click it. Null when the URL is not
 * one we'd render at all.
 */
export function externalUrlHost(value: string | null | undefined): string | null {
  const url = parseExternalUrl(value);
  if (!url) return null;
  return url.hostname.replace(/^www\./, "");
}

/**
 * Whether a link's host is `host` or a subdomain of it — the check any CTA
 * that names a destination has to pass before naming it. Sub-domains count
 * because that is how itch actually serves member pages
 * (`someone.itch.io`).
 */
export function isHostOrSubdomainOf(value: string | null | undefined, host: string): boolean {
  const url = parseExternalUrl(value);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  const target = host.toLowerCase();
  return hostname === target || hostname.endsWith(`.${target}`);
}

/** A member-supplied link. Required. */
export const externalUrlSchema = z
  .string()
  .trim()
  .max(EXTERNAL_URL_MAX_LENGTH)
  .refine(isExternalUrl, { message: "Must be an http(s) link." });

/** A member-supplied link that may be left blank. */
export const optionalExternalUrlSchema = externalUrlSchema.optional().or(z.literal(""));

/**
 * The same gate for fields whose inputs have always accepted a bare host —
 * the profile's GITHUB / TWITTER / PORTFOLIO rows, which were plain
 * `z.string()` and so took `javascript:` as readily as anything else.
 * A scheme-less value is read as https rather than refused, so tightening
 * these doesn't lock anyone out of saving a profile they already have.
 */
export const normalizingExternalUrlSchema = z
  .string()
  .trim()
  .max(EXTERNAL_URL_MAX_LENGTH)
  .transform((value) => (value && !/^[a-z][a-z0-9+.-]*:/i.test(value) ? `https://${value}` : value))
  .refine(isExternalUrl, { message: "Must be an http(s) link." });
