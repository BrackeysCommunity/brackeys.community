import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles } from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

vi.mock("@/lib/website-verification-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/website-verification-check")>();
  return { ...actual, checkWebsiteVerification: vi.fn() };
});

const { checkWebsiteVerification } = await import("@/lib/website-verification-check");
const { sweepWebsiteVerifications, VERIFICATION_RECHECK_DAYS } =
  await import("@/lib/website-verification-sweep");
const checkMock = vi.mocked(checkWebsiteVerification);

/**
 * A VERIFIED badge is a claim about the present: a sold domain must stop
 * carrying one. The stamp's own age selects the row, which is what makes
 * re-running the sweep harmless.
 */

let db: TestDb;
const NOW = new Date("2026-09-12T12:00:00Z");
const DAY = 86_400_000;
const stale = new Date(NOW.getTime() - (VERIFICATION_RECHECK_DAYS + 1) * DAY);
const fresh = new Date(NOW.getTime() - 2 * DAY);

beforeEach(async () => {
  db = await createTestDb();
  checkMock.mockReset();
});

async function seedStamped(
  id: string,
  overrides: {
    websiteUrl?: string | null;
    token?: string | null;
    verifiedAt?: Date | null;
    verifiedHost?: string | null;
  },
) {
  await seedUser(db, id, {
    websiteUrl: overrides.websiteUrl === undefined ? "https://booth.dev" : overrides.websiteUrl,
    websiteVerificationToken: overrides.token === undefined ? "tok" : overrides.token,
    websiteVerifiedAt: overrides.verifiedAt === undefined ? stale : overrides.verifiedAt,
    websiteVerifiedHost:
      overrides.verifiedHost === undefined ? "booth.dev" : overrides.verifiedHost,
  });
}

async function stamp(id: string) {
  const [row] = await db
    .select({
      verifiedAt: developerProfiles.websiteVerifiedAt,
      verifiedHost: developerProfiles.websiteVerifiedHost,
    })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, id));
  return row;
}

describe("sweepWebsiteVerifications", () => {
  it("leaves a stamp younger than the window alone", async () => {
    await seedStamped("u1", { verifiedAt: fresh });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 0, cleared: 0 });
    expect(checkMock).not.toHaveBeenCalled();
    expect((await stamp("u1")).verifiedAt).toEqual(fresh);
  });

  it("refreshes a stale stamp that still passes", async () => {
    await seedStamped("u1", {});
    checkMock.mockResolvedValue({ verified: true, method: "dns" });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 1, cleared: 0 });
    expect(checkMock).toHaveBeenCalledWith("booth.dev", "tok");
    expect((await stamp("u1")).verifiedAt).toEqual(NOW);
  });

  it("clears a stale stamp whose host stopped passing", async () => {
    await seedStamped("u1", {});
    checkMock.mockResolvedValue({ verified: false, reason: "gone" });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 1, cleared: 1 });
    expect(await stamp("u1")).toEqual({ verifiedAt: null, verifiedHost: null });
  });

  it("clears without a request when the URL has moved off the stamped host", async () => {
    await seedStamped("u1", { websiteUrl: "https://elsewhere.dev" });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 0, cleared: 1 });
    expect(checkMock).not.toHaveBeenCalled();
    expect(await stamp("u1")).toEqual({ verifiedAt: null, verifiedHost: null });
  });

  it("clears a stamp whose URL is gone, or whose token is", async () => {
    await seedStamped("u1", { websiteUrl: null });
    await seedStamped("u2", { token: null });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 0, cleared: 2 });
    expect(checkMock).not.toHaveBeenCalled();
    expect(await stamp("u1")).toEqual({ verifiedAt: null, verifiedHost: null });
    expect(await stamp("u2")).toEqual({ verifiedAt: null, verifiedHost: null });
  });

  it("ignores profiles that were never verified", async () => {
    await seedUser(db, "u1", { websiteUrl: "https://booth.dev" });

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 0, cleared: 0 });
  });

  it("is idempotent: a second pass over refreshed rows does nothing", async () => {
    await seedStamped("u1", {});
    checkMock.mockResolvedValue({ verified: true, method: "file" });
    await sweepWebsiteVerifications(db, NOW);

    expect(await sweepWebsiteVerifications(db, NOW)).toEqual({ checked: 0, cleared: 0 });
  });
});
