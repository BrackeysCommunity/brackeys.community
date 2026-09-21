import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles } from "@/db/schema";
import { bylineGuildRoles } from "@/orpc/profile-projection";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  // `seedUser` writes `discord-<id>` as the discord id.
  vi.stubEnv("ADMIN_DISCORD_IDS", "discord-owner");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The projection under test, read back in a stable order. */
async function roles() {
  const rows = await db
    .select({ id: developerProfiles.id, guildRoles: bylineGuildRoles() })
    .from(developerProfiles)
    .orderBy(asc(developerProfiles.id));
  return Object.fromEntries(rows.map((r) => [r.id, r.guildRoles]));
}

describe("bylineGuildRoles", () => {
  it("folds the override names into an override holder's roles", async () => {
    await seedUser(db, "owner", { guildRoles: ["BIP"] });
    await seedUser(db, "member", { guildRoles: ["BIP"] });

    const byId = await roles();
    expect(byId.owner).toEqual(["BIP", "Admin", "Dev"]);
    // Everyone else reads the Discord mirror untouched.
    expect(byId.member).toEqual(["BIP"]);
  });

  it("still grants them to a holder with no synced roles at all", async () => {
    // `null || array` is null in Postgres, so a missing mirror has to be
    // coalesced or the chip silently disappears for the one person it is for.
    await seedUser(db, "owner", { guildRoles: null });

    expect((await roles()).owner).toEqual(["Admin", "Dev"]);
  });

  it("leaves a null mirror null for everyone else", async () => {
    await seedUser(db, "member", { guildRoles: null });

    expect((await roles()).member).toBeNull();
  });

  it("falls back to the plain column when no ids are configured", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "");
    await seedUser(db, "owner", { guildRoles: ["BIP"] });

    expect((await roles()).owner).toEqual(["BIP"]);
  });

  it("reads every id in the list, not just the first", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "discord-first, discord-second");
    await seedUser(db, "first", { guildRoles: ["Guru"] });
    await seedUser(db, "second", { guildRoles: null });
    await seedUser(db, "third", { guildRoles: ["Guru"] });

    const byId = await roles();
    expect(byId.first).toEqual(["Guru", "Admin", "Dev"]);
    expect(byId.second).toEqual(["Admin", "Dev"]);
    expect(byId.third).toEqual(["Guru"]);
  });
});
