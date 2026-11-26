import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { account } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

const state = vi.hoisted(() => ({
  session: null as unknown,
  fail: false,
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (state.fail) throw new Error("auth is down");
        return state.session;
      },
    },
  },
}));

import { mapViewer } from "../viewer";

let db: TestDb;
let seq = 0;

async function link(userId: string, providerId: string, accountId: string) {
  const now = new Date();
  await db.insert(account).values({
    id: `acct-${++seq}`,
    accountId,
    providerId,
    userId,
    createdAt: now,
    updatedAt: now,
  });
}

const request = () => new Request("https://example.test/api/mmo/map/overlay");

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  state.session = null;
  state.fail = false;
});

describe("mapViewer", () => {
  it("gives a Discord-linked user their Discord account id", async () => {
    const id = await seedUser(db, `linked-${seq}`);
    await link(id, "github", "gh-1");
    await link(id, "discord", "111222333");
    state.session = { user: { id } };
    expect(await mapViewer(request())).toEqual({
      kind: "user",
      userId: id,
      discordId: "111222333",
    });
  });

  it("gives a user with no Discord link no Discord id", async () => {
    const id = await seedUser(db, `unlinked-${seq}`);
    await link(id, "github", "gh-2");
    state.session = { user: { id } };
    expect(await mapViewer(request())).toEqual({ kind: "user", userId: id });
  });

  it("never reads another user's Discord link", async () => {
    const other = await seedUser(db, `other-${seq}`);
    await link(other, "discord", "999");
    const id = await seedUser(db, `self-${seq}`);
    state.session = { user: { id } };
    expect(await mapViewer(request())).toEqual({ kind: "user", userId: id });
  });

  it("treats a banned user as anonymous", async () => {
    const id = await seedUser(db, `banned-${seq}`);
    await link(id, "discord", "444");
    state.session = { user: { id, bannedAt: new Date(Date.now() - 1000) } };
    expect(await mapViewer(request())).toEqual({ kind: "anonymous" });
  });

  it("lets a lifted ban see again", async () => {
    const id = await seedUser(db, `lifted-${seq}`);
    await link(id, "discord", "555");
    state.session = {
      user: { id, bannedAt: new Date(Date.now() - 2000), unbannedAt: new Date(Date.now() - 1000) },
    };
    expect(await mapViewer(request())).toMatchObject({ kind: "user", discordId: "555" });
  });

  it("is anonymous with no session or an unreadable one", async () => {
    expect(await mapViewer(request())).toEqual({ kind: "anonymous" });
    state.fail = true;
    expect(await mapViewer(request())).toEqual({ kind: "anonymous" });
  });
});
