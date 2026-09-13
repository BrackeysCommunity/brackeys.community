/**
 * The DNS half of `dns-providers.ts`: find the zone a host belongs to and
 * read its nameservers.
 *
 * NS records live at a zone's apex, so `www.booth.dev` has none — the walk
 * strips one label at a time until a zone answers. Two labels is the cap:
 * `foo.github.io` would otherwise walk up to `github.io` and report
 * GitHub's DNS provider for a zone the member cannot touch. Stopping early
 * means we sometimes say nothing, which is the right failure for a hint.
 *
 * Server-only, and deliberately not part of `website-verification-check.ts`:
 * that module is COPY'd into the notifications worker's image, and this is
 * only ever wanted by the dialog.
 */
import { resolveNs } from "node:dns/promises";

import { dnsProviderForNameservers, isPlatformZone, type DnsProviderHint } from "./dns-providers";

/** How many labels to strip before giving up. */
const MAX_ASCENT = 2;

export async function lookupDnsProvider(host: string): Promise<DnsProviderHint | null> {
  const normalizedHost = host.trim().toLowerCase().replace(/\.$/, "");
  let candidate = normalizedHost;
  if (!candidate || !candidate.includes(".")) return null;

  for (let ascent = 0; ascent <= MAX_ASCENT; ascent++) {
    // A zone needs at least two labels; never ask the root or a TLD.
    if (candidate.split(".").length < 2) return null;

    // A zone the member publishes under but does not run: `github.io`
    // answers for `someone.github.io`, and its DNS panel is not theirs.
    if (candidate !== normalizedHost && isPlatformZone(candidate)) return null;

    const nameservers = await resolveNs(candidate).catch(() => null);
    if (nameservers && nameservers.length > 0) {
      return dnsProviderForNameservers(nameservers, candidate);
    }

    const next = candidate.slice(candidate.indexOf(".") + 1);
    if (next === candidate) return null;
    candidate = next;
  }
  return null;
}
