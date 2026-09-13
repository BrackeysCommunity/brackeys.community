import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isPrivateAddress,
  relativeRecordName,
  stampCoversUrl,
  verifiableHost,
  verificationHost,
  verificationTxtRecord,
} from "@/lib/website-verification";
import { assertPublicHost, checkWebsiteVerification } from "@/lib/website-verification-check";

/**
 * The check makes the server request a member-supplied host from inside
 * Railway, so the address guard is the part that has to be exhaustive — a
 * host resolving to `169.254.169.254` is the whole reason this file is
 * longer than the feature.
 */

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
  resolveTxt: vi.fn(),
}));

const dns = await import("node:dns/promises");
const lookup = vi.mocked(dns.lookup);
const resolveTxt = vi.mocked(dns.resolveTxt);

function resolvesTo(...addresses: string[]) {
  lookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })) as never,
  );
}

function mockFetch(response: {
  status?: number;
  body?: string;
  reject?: Error;
}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => {
    if (response.reject) throw response.reject;
    const body = response.body ?? "";
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      body: {
        getReader() {
          let sent = false;
          return {
            read: async () =>
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
            cancel: async () => {},
          };
        },
      },
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the address guard", () => {
  it("refuses every private, loopback, link-local and metadata range", () => {
    for (const address of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.1",
      "192.168.1.1",
      "127.0.0.1",
      "0.0.0.0",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "239.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:192.168.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("refuses a host that resolves to anything private, even alongside a public one", async () => {
    resolvesTo("93.184.216.34", "169.254.169.254");
    await expect(assertPublicHost("evil.example")).rejects.toThrow(/private address/i);
  });

  it("refuses local names before asking DNS at all", async () => {
    await expect(assertPublicHost("localhost")).rejects.toThrow(/not a public host/i);
    await expect(assertPublicHost("router.local")).rejects.toThrow(/not a public host/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHost("nope.example")).rejects.toThrow(/does not resolve/i);
  });
});

describe("which URLs a check may run against", () => {
  it("refuses http, a non-URL, and an empty value before any request", () => {
    expect(verifiableHost("http://booth.dev")).toEqual({
      error: "Verification needs an https:// URL.",
    });
    expect(verifiableHost("not a url")).toEqual({ error: "That portfolio URL can't be read." });
    expect(verifiableHost(null)).toEqual({ error: "Add a portfolio URL first." });
    expect(verifiableHost("https://booth.dev/portfolio")).toEqual({ host: "booth.dev" });
  });

  it("treats a subdomain as its own claim", () => {
    expect(verificationHost("https://www.booth.dev")).toBe("www.booth.dev");
    expect(stampCoversUrl("booth.dev", "https://www.booth.dev")).toBe(false);
  });

  it("keeps a stamp across a path change and drops it across a host change", () => {
    expect(stampCoversUrl("booth.dev", "https://booth.dev/new/page")).toBe(true);
    expect(stampCoversUrl("booth.dev", "https://elsewhere.dev")).toBe(false);
    expect(stampCoversUrl(null, "https://booth.dev")).toBe(false);
  });
});

/**
 * Panels take the NAME field relative to the zone. Pasting a fully-qualified
 * name into GoDaddy or Namecheap creates `booth.dev.booth.dev`, and the
 * member has no way to tell that from a propagation delay.
 */
describe("the record's name", () => {
  it("is @ for the zone itself", () => {
    expect(relativeRecordName("booth.dev", "booth.dev")).toBe("@");
    expect(relativeRecordName("BOOTH.dev", "booth.DEV")).toBe("@");
  });

  it("is the label for a subdomain of the zone", () => {
    expect(relativeRecordName("www.booth.dev", "booth.dev")).toBe("www");
    expect(relativeRecordName("a.b.booth.dev", "booth.dev")).toBe("a.b");
  });

  it("stays fully qualified when the zone is unknown or unrelated", () => {
    expect(relativeRecordName("booth.dev", null)).toBe("booth.dev");
    expect(relativeRecordName("booth.dev", "elsewhere.dev")).toBe("booth.dev");
    // A suffix that isn't a label boundary is not the zone.
    expect(relativeRecordName("notbooth.dev", "booth.dev")).toBe("notbooth.dev");
  });
});

describe("the check itself", () => {
  const token = "a".repeat(64);

  it("passes on a matching TXT record without fetching anything", async () => {
    resolvesTo("93.184.216.34");
    resolveTxt.mockResolvedValue([["unrelated"], [verificationTxtRecord(token)]]);
    const fetchMock = mockFetch({ body: "" });

    expect(await checkWebsiteVerification("booth.dev", token)).toEqual({
      verified: true,
      method: "dns",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("joins a TXT value the resolver split into chunks", async () => {
    resolvesTo("93.184.216.34");
    const record = verificationTxtRecord(token);
    resolveTxt.mockResolvedValue([[record.slice(0, 20), record.slice(20)]]);

    expect(await checkWebsiteVerification("booth.dev", token)).toMatchObject({ verified: true });
  });

  it("falls through to the well-known file, without following redirects", async () => {
    resolvesTo("93.184.216.34");
    resolveTxt.mockResolvedValue([]);
    const fetchMock = mockFetch({ body: `${token}\n` });

    expect(await checkWebsiteVerification("booth.dev", token)).toEqual({
      verified: true,
      method: "file",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://booth.dev/.well-known/brackeys-verify.txt");
    expect(init.redirect).toBe("manual");
  });

  it("fails a redirect, and says so", async () => {
    resolvesTo("93.184.216.34");
    resolveTxt.mockResolvedValue([]);
    mockFetch({ status: 302 });

    const result = await checkWebsiteVerification("booth.dev", token);
    expect(result).toMatchObject({ verified: false });
    expect("reason" in result && result.reason).toMatch(/redirected/i);
  });

  it("fails a body that is only the token's prefix", async () => {
    resolvesTo("93.184.216.34");
    resolveTxt.mockResolvedValue([]);
    mockFetch({ body: `${token}-and-more` });

    const result = await checkWebsiteVerification("booth.dev", token);
    expect(result).toMatchObject({ verified: false });
    expect("reason" in result && result.reason).toMatch(/did not contain the token/i);
  });

  it("names both halves when neither placement is there", async () => {
    resolvesTo("93.184.216.34");
    resolveTxt.mockResolvedValue([]);
    mockFetch({ status: 404 });

    const result = await checkWebsiteVerification("booth.dev", token);
    expect("reason" in result && result.reason).toBe(
      "No TXT record found on booth.dev, and /.well-known/brackeys-verify.txt returned 404.",
    );
  });

  it("never requests a host that resolves privately", async () => {
    resolvesTo("127.0.0.1");
    const fetchMock = mockFetch({ body: token });

    const result = await checkWebsiteVerification("evil.example", token);
    expect(result).toMatchObject({ verified: false });
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
