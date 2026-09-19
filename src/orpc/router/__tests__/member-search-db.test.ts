import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { profileUrlStubs } from "@/db/schema";
import { listMembers } from "@/orpc/router/member";
import { searchProfiles } from "@/orpc/router/team";
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

/**
 * Directory search across every name a member answers to (BC-211).
 *
 * The case that motivated this: `discord_username` holds Discord's display
 * name, so a member shown as "DNOS MB É ?'" at `/hjonkwegoos` was findable
 * by "dno" and unfindable by "hjonk" — the one string they would actually
 * type. The handle now has its own column, and the vanity stub is matched
 * too, since it is the only copy of the handle older rows carry.
 */
let db: TestDb;

async function seedStub(profileId: string, stub: string, source = "discord") {
  await db.insert(profileUrlStubs).values({ profileId, stub, source });
}

async function search(q: string) {
  const { members } = await call(listMembers, { search: q, limit: 50, offset: 0 }, asUser(null));
  return members.map((m) => m.id).sort();
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
});

describe("listMembers search", () => {
  it("finds a member by handle when the display name shares no prefix", async () => {
    await seedUser(db, "hjonk-user", {
      discordUsername: "DNOS MB É ?'",
      guildNickname: "DNOS MB É ?'",
      discordHandle: "hjonkwegoos",
    });
    await seedStub("hjonk-user", "hjonkwegoos");

    expect(await search("dno")).toEqual(["hjonk-user"]);
    // The regression: this was 0 matches.
    expect(await search("hjonk")).toEqual(["hjonk-user"]);
  });

  it("falls back to the vanity stub for rows predating the handle column", async () => {
    await seedUser(db, "legacy-user", {
      discordUsername: "Legacy Display",
      guildNickname: null,
      discordHandle: null,
    });
    await seedStub("legacy-user", "oldhandle");

    expect(await search("oldhandle")).toEqual(["legacy-user"]);
  });

  it("matches a claimed vanity stub that no Discord name contains", async () => {
    await seedUser(db, "vanity-user", {
      discordUsername: "Someone Else",
      guildNickname: null,
      discordHandle: "realhandle",
    });
    await seedStub("vanity-user", "chosen-name", "user");

    expect(await search("chosen-name")).toEqual(["vanity-user"]);
    expect(await search("realhandle")).toEqual(["vanity-user"]);
  });

  it("does not match every row — the stub subquery stays correlated", async () => {
    await seedUser(db, "a-user", {
      discordUsername: "Alpha",
      guildNickname: null,
      discordHandle: "alpha",
    });
    await seedStub("a-user", "alpha");
    await seedUser(db, "b-user", {
      discordUsername: "Beta",
      guildNickname: null,
      discordHandle: "beta",
    });
    await seedStub("b-user", "beta");

    expect(await search("alpha")).toEqual(["a-user"]);
    expect(await search("nobodyhasthis")).toEqual([]);
  });

  it("treats an underscore as a literal, not a wildcard", async () => {
    await seedUser(db, "literal-user", {
      discordUsername: "Literal",
      guildNickname: null,
      discordHandle: "ab_cd",
    });
    await seedStub("literal-user", "ab_cd");
    await seedUser(db, "decoy-user", {
      discordUsername: "Decoy",
      guildNickname: null,
      discordHandle: "abXcd",
    });
    await seedStub("decoy-user", "abxcd");

    expect(await search("ab_cd")).toEqual(["literal-user"]);
  });
});

/**
 * The invite picker and the ban screen both show a "handle" to tell two
 * identically-nicknamed members apart. It used to be the display name, so
 * on those screens it repeated the nickname it was meant to disambiguate.
 */
describe("searchProfiles handle", () => {
  async function findHandle(callerId: string, term: string) {
    const rows = await call(searchProfiles, { search: term }, asUser(callerId));
    return rows.map((r) => ({ displayName: r.displayName, handle: r.handle }));
  }

  it("prefers the real handle over the display name", async () => {
    await seedUser(db, "caller-a");
    await seedUser(db, "handled", {
      discordUsername: "QUACK MB É ?'",
      guildNickname: "QUACK MB É ?'",
      discordHandle: "quacksalot",
    });
    await seedStub("handled", "quacksalot");

    expect(await findHandle("caller-a", "quacksal")).toEqual([
      { displayName: "QUACK MB É ?'", handle: "quacksalot" },
    ]);
  });

  it("falls back to the vanity stub, then to null — never to the display name", async () => {
    await seedUser(db, "caller-b");
    await seedUser(db, "stubbed", {
      discordUsername: "Stub Only",
      guildNickname: null,
      discordHandle: null,
    });
    await seedStub("stubbed", "stubonly");
    await seedUser(db, "bare", {
      discordUsername: "Bare Person",
      guildNickname: null,
      discordHandle: null,
    });

    expect(await findHandle("caller-b", "stubonly")).toEqual([
      { displayName: "Stub Only", handle: "stubonly" },
    ]);
    // The regression guard: a null handle, not an echo of "Bare Person".
    expect(await findHandle("caller-b", "Bare Person")).toEqual([
      { displayName: "Bare Person", handle: null },
    ]);
  });
});
