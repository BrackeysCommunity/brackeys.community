/**
 * Who runs a domain's DNS, read off its nameservers.
 *
 * The verify dialog's hardest step is not the record — it is "where do I
 * even add this". Naming the provider answers that for everyone, and a
 * deep link into the right zone's DNS page answers it in one click for the
 * handful whose panel URLs are stable enough to link.
 *
 * Deliberately not Domain Connect: that would add the record for the
 * member, and costs a template PR, a manual onboarding with each DNS
 * provider, and a private signing key we would then hold. This is the
 * afternoon-sized 80% of it.
 *
 * A missing entry is not a bug — an unrecognised nameserver just means the
 * dialog says nothing rather than something wrong.
 */

export interface DnsProviderHint {
  name: string;
  /** The zone the nameservers were read from — named in the copy, so a
   *  member whose host sits under someone else's zone can see that. */
  zone: string;
  /** Deep link to this domain's DNS page, or null when the provider has no
   *  stable per-zone URL. Every link here survives the provider's own login
   *  redirect with its path intact (checked 2026-09-13). */
  url: string | null;
}

interface ProviderEntry {
  name: string;
  /** Matched as the whole nameserver or its dot-delimited tail. Never a
   *  substring: `notcloudflare.com.evil.example` is not Cloudflare. */
  suffixes?: string[];
  /** For providers whose nameservers aren't a fixed suffix — Route 53's
   *  `ns-1234.awsdns-56.org` being the awkward one. */
  pattern?: RegExp;
  dnsUrl?: (domain: string) => string;
}

const PROVIDERS: ProviderEntry[] = [
  {
    name: "Cloudflare",
    suffixes: ["cloudflare.com", "ns.cloudflare.com"],
    // A dashboard URL is `/<accountId>/<zoneName>/dns`, and the zone half is
    // the domain itself — so only `:account` stays a placeholder. Leaving
    // `:zone` a placeholder too is what lands on the account-and-domain
    // picker instead of the member's own DNS page.
    dnsUrl: (domain) => `https://dash.cloudflare.com/?to=/:account/${domain}/dns`,
  },
  {
    name: "GoDaddy",
    suffixes: ["domaincontrol.com"],
    dnsUrl: (domain) =>
      `https://dcc.godaddy.com/control/dnsmanagement?domainName=${encodeURIComponent(domain)}`,
  },
  {
    name: "Namecheap",
    suffixes: ["registrar-servers.com"],
    dnsUrl: (domain) =>
      `https://ap.www.namecheap.com/domains/domaincontrolpanel/${encodeURIComponent(domain)}/advancedns`,
  },
  {
    name: "DigitalOcean",
    suffixes: ["digitalocean.com"],
    dnsUrl: (domain) =>
      `https://cloud.digitalocean.com/networking/domains/${encodeURIComponent(domain)}`,
  },
  {
    name: "Amazon Route 53",
    pattern: /\.awsdns-\d+\.(com|net|org|co\.uk)$/,
    dnsUrl: () => "https://console.aws.amazon.com/route53/v2/hostedzones",
  },
  {
    name: "Vercel",
    suffixes: ["vercel-dns.com"],
    dnsUrl: () => "https://vercel.com/dashboard/domains",
  },
  // Named but not linked: panel URLs that move, or that need an account or
  // project id we can't know from a nameserver.
  { name: "Squarespace", suffixes: ["squarespacedns.com"] },
  { name: "Wix", suffixes: ["wixdns.net"] },
  { name: "Google Cloud DNS", suffixes: ["googledomains.com"] },
  { name: "Azure DNS", suffixes: ["azure-dns.com", "azure-dns.net", "azure-dns.org"] },
  { name: "NS1", suffixes: ["nsone.net"] },
  { name: "Gandi", suffixes: ["gandi.net"] },
  { name: "OVH", suffixes: ["ovh.net"] },
  { name: "Hetzner", suffixes: ["hetzner.com", "hetzner.de"] },
  { name: "Linode", suffixes: ["linode.com"] },
  { name: "DNSimple", suffixes: ["dnsimple.com"] },
  { name: "Porkbun", suffixes: ["porkbun.com"] },
  { name: "Name.com", suffixes: ["name.com"] },
  { name: "Hover", suffixes: ["hover.com"] },
  { name: "Bunny", suffixes: ["bunny.net"] },
  { name: "deSEC", suffixes: ["desec.io"] },
];

function normalize(nameserver: string): string {
  return nameserver.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The provider behind a zone's nameservers, or null when none is
 * recognised. `domain` only shapes the link, so passing the zone the NS
 * records came from is what makes a per-zone URL correct.
 */
export function dnsProviderForNameservers(
  nameservers: string[],
  domain: string,
): DnsProviderHint | null {
  for (const raw of nameservers) {
    const ns = normalize(raw);
    if (!ns) continue;
    for (const provider of PROVIDERS) {
      const hit =
        provider.suffixes?.some((suffix) => ns === suffix || ns.endsWith(`.${suffix}`)) ||
        provider.pattern?.test(ns);
      if (!hit) continue;
      return { name: provider.name, zone: domain, url: provider.dnsUrl?.(domain) ?? null };
    }
  }
  return null;
}

/**
 * Zones that belong to a hosting platform rather than to whoever publishes
 * under them. A member on `someone.github.io` has no DNS panel for
 * `github.io`, so naming its provider would send them somewhere they
 * cannot act — the file placement is their path, and silence here is what
 * points at it.
 */
const PLATFORM_ZONES = new Set([
  "github.io",
  "gitlab.io",
  "itch.io",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "surge.sh",
  "neocities.org",
  "glitch.me",
  "notion.site",
  "wordpress.com",
  "tumblr.com",
  "bearblog.dev",
]);

export function isPlatformZone(zone: string): boolean {
  return PLATFORM_ZONES.has(zone.trim().toLowerCase().replace(/\.$/, ""));
}
