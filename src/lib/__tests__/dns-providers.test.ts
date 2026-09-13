import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { dnsProviderForNameservers } from "@/lib/dns-providers";

vi.mock("node:dns/promises", () => ({ resolveNs: vi.fn() }));

const { resolveNs } = await import("node:dns/promises");
const { lookupDnsProvider } = await import("@/lib/dns-provider-lookup");
const resolveNsMock = vi.mocked(resolveNs);

/**
 * A hint, not a gate: saying nothing is always allowed, and saying the
 * wrong thing never is. The matcher is suffix-anchored for exactly that
 * reason — a nameserver is only its provider's if the name ends there.
 */

afterEach(() => {
  vi.clearAllMocks();
});

describe("dnsProviderForNameservers", () => {
  it("names the provider and links the zone where the panel URL is stable", () => {
    expect(dnsProviderForNameservers(["kim.ns.cloudflare.com."], "booth.dev")).toEqual({
      name: "Cloudflare",
      zone: "booth.dev",
      url: "https://dash.cloudflare.com/?to=/:account/booth.dev/dns",
    });
    expect(dnsProviderForNameservers(["ns01.domaincontrol.com"], "booth.dev")).toEqual({
      name: "GoDaddy",
      zone: "booth.dev",
      url: "https://dcc.godaddy.com/control/dnsmanagement?domainName=booth.dev",
    });
    expect(dnsProviderForNameservers(["dns1.registrar-servers.com"], "booth.dev")?.url).toBe(
      "https://ap.www.namecheap.com/domains/domaincontrolpanel/booth.dev/advancedns",
    );
  });

  it("matches Route 53's numbered nameservers across its four TLDs", () => {
    for (const ns of [
      "ns-1234.awsdns-56.org",
      "ns-2.awsdns-00.com",
      "ns-999.awsdns-12.co.uk",
      "ns-7.awsdns-01.net",
    ]) {
      expect(dnsProviderForNameservers([ns], "booth.dev")?.name, ns).toBe("Amazon Route 53");
    }
  });

  it("names a provider it cannot deep-link, rather than staying silent", () => {
    expect(dnsProviderForNameservers(["ns1.gandi.net"], "booth.dev")).toEqual({
      name: "Gandi",
      zone: "booth.dev",
      url: null,
    });
  });

  it("is suffix-anchored — a lookalike host is not the provider", () => {
    expect(dnsProviderForNameservers(["notcloudflare.com.evil.example"], "booth.dev")).toBeNull();
    expect(dnsProviderForNameservers(["ns1.cloudflare.com.attacker.test"], "booth.dev")).toBeNull();
  });

  it("ignores case, trailing dots and blanks", () => {
    expect(dnsProviderForNameservers(["", "  KIM.NS.CLOUDFLARE.COM.  "], "booth.dev")?.name).toBe(
      "Cloudflare",
    );
  });

  it("says nothing for a provider it doesn't know", () => {
    expect(dnsProviderForNameservers(["ns1.some-tiny-host.example"], "booth.dev")).toBeNull();
  });
});

describe("lookupDnsProvider", () => {
  it("reads the host's own zone when it has one", async () => {
    resolveNsMock.mockResolvedValue(["kim.ns.cloudflare.com"]);

    expect(await lookupDnsProvider("booth.dev")).toMatchObject({ name: "Cloudflare" });
    expect(resolveNsMock).toHaveBeenCalledWith("booth.dev");
  });

  it("walks up to the zone apex for a subdomain, and links that zone", async () => {
    resolveNsMock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveNsMock.mockResolvedValueOnce(["ns01.domaincontrol.com"]);

    const hint = await lookupDnsProvider("www.booth.dev");

    expect(resolveNsMock.mock.calls.map(([host]) => host)).toEqual(["www.booth.dev", "booth.dev"]);
    // The link names the zone the records live in, not the host asked about.
    expect(hint?.url).toContain("domainName=booth.dev");
  });

  it("stays silent on a platform zone the member only publishes under", async () => {
    // `github.io` answers for `someone.github.io`, and naming its provider
    // would point at a panel the member has no account on.
    resolveNsMock.mockRejectedValueOnce(new Error("ENODATA"));
    resolveNsMock.mockResolvedValue(["ns-1234.awsdns-56.org"]);

    expect(await lookupDnsProvider("someone.github.io")).toBeNull();
    expect(resolveNsMock.mock.calls.map(([host]) => host)).toEqual(["someone.github.io"]);
  });

  it("still reads a platform zone asked about directly", async () => {
    resolveNsMock.mockResolvedValue(["kim.ns.cloudflare.com"]);

    expect(await lookupDnsProvider("github.io")).toMatchObject({ name: "Cloudflare" });
  });

  it("gives up rather than walking to a registrable suffix", async () => {
    resolveNsMock.mockRejectedValue(new Error("ENODATA"));

    expect(await lookupDnsProvider("a.b.c.foo.example")).toBeNull();
    expect(resolveNsMock.mock.calls).toHaveLength(3);
  });

  it("answers nothing for a bare label or an empty host", async () => {
    expect(await lookupDnsProvider("localhost")).toBeNull();
    expect(await lookupDnsProvider("")).toBeNull();
    expect(resolveNsMock).not.toHaveBeenCalled();
  });

  it("answers nothing when the zone resolves to no nameservers at all", async () => {
    resolveNsMock.mockResolvedValue([]);

    expect(await lookupDnsProvider("booth.dev")).toBeNull();
  });
});
