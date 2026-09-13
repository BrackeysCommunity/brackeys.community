/**
 * The checking half of the PORTFOLIO row's domain proof: DNS first, then
 * the well-known file, with an address guard around both.
 *
 * The fetch is an SSRF surface and is built as one — the server is about to
 * request a member-supplied host from inside Railway. Every address the
 * host resolves to is checked against the private, loopback, link-local and
 * metadata ranges before anything is requested; `https:` only (the caller
 * gets the host from `verifiableHost`); a redirect is a failed check rather
 * than something to follow; five seconds; a few hundred bytes.
 *
 * Import-graph-neutral (relative imports, node built-ins only) — the
 * monthly re-check runs inside the notifications worker.
 */
import { randomBytes } from "node:crypto";
import { lookup, resolveTxt } from "node:dns/promises";

import {
  isPrivateAddress,
  verificationTxtRecord,
  VERIFY_WELL_KNOWN_PATH,
  type VerificationResult,
} from "./website-verification";

const FETCH_TIMEOUT_MS = 5_000;
/** A token is 64 hex characters; anything longer is not the file we asked for. */
const MAX_BODY_BYTES = 512;

/** Stable per profile: the instructions must not change under someone mid-check. */
export function mintVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

/** Names that never reach the public internet, refused before any DNS is asked. */
function isLocalHostname(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

/**
 * Every address a host resolves to must be public. Resolution happens here
 * and the request is still made by hostname, so a rebinding answer could in
 * principle differ between the two — what the request then reads is a few
 * hundred bytes compared against a token we already hold, and nothing is
 * returned to the caller but pass/fail, so the residual is not a data path.
 */
export async function assertPublicHost(host: string): Promise<void> {
  if (isLocalHostname(host)) throw new Error(`${host} is not a public host.`);

  const addresses = await lookup(host, { all: true }).catch(() => {
    throw new Error(`${host} does not resolve.`);
  });
  if (addresses.length === 0) throw new Error(`${host} does not resolve.`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error(`${host} resolves to a private address.`);
  }
}

/** Reads at most `MAX_BODY_BYTES`, then drops the rest of the stream. */
async function readCappedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

async function checkDnsRecord(host: string, token: string): Promise<boolean> {
  const records = await resolveTxt(host).catch(() => null);
  if (!records) return false;
  const wanted = verificationTxtRecord(token);
  // A long TXT value arrives split into 255-byte strings.
  return records.some((parts) => parts.join("").trim() === wanted);
}

async function checkWellKnownFile(
  host: string,
  token: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${host}${VERIFY_WELL_KNOWN_PATH}`, {
      // Following a redirect would let the host point this request anywhere,
      // and the file has to be on the host being claimed.
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/plain" },
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: `${VERIFY_WELL_KNOWN_PATH} redirected` };
    }
    if (!response.ok) {
      return { ok: false, reason: `${VERIFY_WELL_KNOWN_PATH} returned ${response.status}` };
    }
    const body = await readCappedText(response);
    if (body.trim() !== token) {
      return { ok: false, reason: `${VERIFY_WELL_KNOWN_PATH} did not contain the token` };
    }
    return { ok: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? `${VERIFY_WELL_KNOWN_PATH} timed out`
        : `${VERIFY_WELL_KNOWN_PATH} could not be fetched`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DNS first, then the well-known file. A failure names both halves: "it
 * didn't work" on a two-placement check tells the member nothing about
 * which one they got wrong.
 */
export async function checkWebsiteVerification(
  host: string,
  token: string,
): Promise<VerificationResult> {
  try {
    await assertPublicHost(host);
  } catch (err) {
    return { verified: false, reason: err instanceof Error ? err.message : String(err) };
  }

  if (await checkDnsRecord(host, token)) return { verified: true, method: "dns" };

  const file = await checkWellKnownFile(host, token);
  if (file.ok) return { verified: true, method: "file" };

  return { verified: false, reason: `No TXT record found on ${host}, and ${file.reason}.` };
}
