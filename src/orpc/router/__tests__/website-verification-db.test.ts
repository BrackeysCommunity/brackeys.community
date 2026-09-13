import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, user } from "@/db/schema";
import { updateProfile } from "@/orpc/router/profile";
import { getWebsiteVerification, verifyWebsite } from "@/orpc/router/website";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
vi.mock("@/lib/dns-provider-lookup", () => ({ lookupDnsProvider: vi.fn() }));
vi.mock("@/lib/website-verification-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/website-verification-check")>();
  return { ...actual, checkWebsiteVerification: vi.fn() };
});

const { checkWebsiteVerification } = await import("@/lib/website-verification-check");
const { lookupDnsProvider } = await import("@/lib/dns-provider-lookup");
const checkMock = vi.mocked(checkWebsiteVerification);
const dnsMock = vi.mocked(lookupDnsProvider);

/**
 * The badge is a claim about a host, so what these cover is the claim's
 * lifetime: it is stamped with the host that passed, it is dropped when the
 * URL leaves that host, and the token behind it never appears in a profile
 * payload.
 */

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(developerProfiles);
  await db.delete(user);
  checkMock.mockReset();
  dnsMock.mockReset();
  dnsMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function storedStamp(userId: string) {
  const [row] = await db
    .select({
      token: developerProfiles.websiteVerificationToken,
      verifiedAt: developerProfiles.websiteVerifiedAt,
      verifiedHost: developerProfiles.websiteVerifiedHost,
    })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId));
  return row;
}

describe("getWebsiteVerification", () => {
  it("mints one token and keeps it across calls", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });

    const first = await call(getWebsiteVerification, {}, asUser("u1"));
    const second = await call(getWebsiteVerification, {}, asUser("u1"));

    expect(first.token).toHaveLength(64);
    expect(second.token).toBe(first.token);
    expect(first.host).toBe("booth.dev");
    expect(first.txtRecord).toBe(`brackeys-verify=${first.token}`);
    expect(first.blockedReason).toBeNull();
  });

  it("names why no check can run on an http-only URL", async () => {
    await seedUser(db, "u1", { websiteUrl: "http://booth.dev" });

    const details = await call(getWebsiteVerification, {}, asUser("u1"));

    expect(details.host).toBeNull();
    expect(details.blockedReason).toMatch(/https/i);
  });

  it("carries the DNS provider behind the host, for the 'where do I add this' link", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });
    dnsMock.mockResolvedValue({
      name: "Cloudflare",
      zone: "booth.dev",
      url: "https://dash.cloudflare.com/?to=/:account/booth.dev/dns",
    });

    const details = await call(getWebsiteVerification, {}, asUser("u1"));

    expect(dnsMock).toHaveBeenCalledWith("booth.dev");
    expect(details.dnsProvider).toMatchObject({ name: "Cloudflare", zone: "booth.dev" });
  });

  it("gives the record name a panel wants — @ for the zone itself", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev/portfolio" });
    dnsMock.mockResolvedValue({ name: "Cloudflare", zone: "booth.dev", url: null });

    expect((await call(getWebsiteVerification, {}, asUser("u1"))).recordName).toBe("@");
  });

  it("gives the label alone for a subdomain", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://www.booth.dev" });
    dnsMock.mockResolvedValue({ name: "GoDaddy", zone: "booth.dev", url: null });

    expect((await call(getWebsiteVerification, {}, asUser("u1"))).recordName).toBe("www");
  });

  it("falls back to the full host when the zone is unknown", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });
    dnsMock.mockResolvedValue(null);

    expect((await call(getWebsiteVerification, {}, asUser("u1"))).recordName).toBe("booth.dev");
  });

  it("looks up nothing when no check could run anyway", async () => {
    await seedUser(db, "u1", { websiteUrl: "http://booth.dev" });

    const details = await call(getWebsiteVerification, {}, asUser("u1"));

    expect(details.dnsProvider).toBeNull();
    expect(dnsMock).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    await expect(call(getWebsiteVerification, {}, asUser(null))).rejects.toThrow();
  });
});

describe("verifyWebsite", () => {
  it("stamps the host that passed", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev/portfolio" });
    checkMock.mockResolvedValue({ verified: true, method: "dns" });

    const result = await call(verifyWebsite, {}, asUser("u1"));

    expect(result).toMatchObject({ verified: true, method: "dns", host: "booth.dev" });
    const stamp = await storedStamp("u1");
    expect(stamp.verifiedHost).toBe("booth.dev");
    expect(stamp.verifiedAt).toBeInstanceOf(Date);
    // The token the check ran against is the stored one.
    expect(checkMock).toHaveBeenCalledWith("booth.dev", stamp.token);
  });

  it("returns the two-part reason and stamps nothing on a failure", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });
    checkMock.mockResolvedValue({
      verified: false,
      reason:
        "No TXT record found on booth.dev, and /.well-known/brackeys-verify.txt returned 404.",
    });

    const result = await call(verifyWebsite, {}, asUser("u1"));

    expect(result).toMatchObject({ verified: false, verifiedAt: null });
    expect((await storedStamp("u1")).verifiedHost).toBeNull();
  });

  it("drops an existing stamp when the host stops passing", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });
    checkMock.mockResolvedValue({ verified: true, method: "file" });
    await call(verifyWebsite, {}, asUser("u1"));

    checkMock.mockResolvedValue({ verified: false, reason: "gone" });
    await call(verifyWebsite, {}, asUser("u1"));

    expect(await storedStamp("u1")).toMatchObject({ verifiedAt: null, verifiedHost: null });
  });

  it("refuses an http-only URL before running any check", async () => {
    await seedUser(db, "u1", { websiteUrl: "http://booth.dev" });

    await expect(call(verifyWebsite, {}, asUser("u1"))).rejects.toThrow(/https/i);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("refuses a profile with no portfolio URL", async () => {
    await seedUser(db, "u1");

    await expect(call(verifyWebsite, {}, asUser("u1"))).rejects.toThrow(/portfolio url/i);
    expect(checkMock).not.toHaveBeenCalled();
  });
});

describe("the stamp's lifetime against the URL", () => {
  async function verified(userId: string, url: string) {
    await seedUser(db, userId, { websiteUrl: url });
    checkMock.mockResolvedValue({ verified: true, method: "dns" });
    await call(verifyWebsite, {}, asUser(userId));
  }

  it("survives a path change on the same host", async () => {
    await verified("u1", "https://booth.dev");

    await call(updateProfile, { websiteUrl: "https://booth.dev/about" }, asUser("u1"));

    expect((await storedStamp("u1")).verifiedHost).toBe("booth.dev");
  });

  it("is dropped when the URL moves to another host", async () => {
    await verified("u1", "https://booth.dev");

    await call(updateProfile, { websiteUrl: "https://elsewhere.dev" }, asUser("u1"));

    expect(await storedStamp("u1")).toMatchObject({ verifiedAt: null, verifiedHost: null });
  });

  it("is dropped when the URL is cleared, and survives an unrelated save", async () => {
    await verified("u1", "https://booth.dev");
    await call(updateProfile, { tagline: "still here" }, asUser("u1"));
    expect((await storedStamp("u1")).verifiedHost).toBe("booth.dev");

    await call(updateProfile, { websiteUrl: "" }, asUser("u1"));
    expect(await storedStamp("u1")).toMatchObject({ verifiedAt: null, verifiedHost: null });
  });
});
