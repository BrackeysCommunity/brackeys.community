import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleaseAudit, teams } from "@/db/schema";
import { siteOrigin } from "@/env";
import { seedUser, type TestDb } from "@/test/db";

import {
  checkConnectOrigins,
  readGameSettings,
  setGameSettings,
  type GameSettingsDeps,
  type GameSettingsPatch,
} from "../game-settings";
import { CONNECT_ORIGINS_MAX } from "../limits";
import { approvePublic, moderationQueue } from "../release-moderation";
import type { Actor, ReleaseTxDb } from "../release-upload";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "settings-fixture";
const NOW = new Date("2026-11-12T15:00:00Z");
const SITE_ORIGINS = ["https://jams.test", "https://play.jams.test"];

const creator: Actor = { kind: "user", userId: "creator" };
const outsider: Actor = { kind: "user", userId: "outsider" };
const staffUser: Actor = { kind: "user", userId: "staff" };
const staffActor: Actor = { kind: "staff", userId: "staff" };
const agent: Actor = { kind: "agent", userId: "creator", agentTokenId: undefined };

const forgotten: string[] = [];

const deps: GameSettingsDeps = {
  db: db as unknown as ReleaseTxDb,
  now: () => NOW,
  siteOrigins: () => SITE_ORIGINS,
  forget: (projectId) => forgotten.push(projectId),
};

const set = (patch: GameSettingsPatch, actor: Actor = creator) =>
  setGameSettings({ projectId: PROJECT, patch, actor }, deps);

const row = async () => {
  const [project] = await db
    .select()
    .from(engineProjects)
    .where(eq(engineProjects.projectId, PROJECT));
  return project!;
};

const auditRows = () =>
  db
    .select({
      action: engineReleaseAudit.action,
      actorKind: engineReleaseAudit.actorKind,
      actorId: engineReleaseAudit.actorId,
      detail: engineReleaseAudit.detail,
    })
    .from(engineReleaseAudit)
    .where(eq(engineReleaseAudit.projectId, PROJECT))
    .orderBy(asc(engineReleaseAudit.id));

const reviewQueue = async () =>
  (await moderationQueue({ actor: staffActor }, { db: db as unknown as ReleaseTxDb })).reviews.map(
    (r) => r.projectId,
  );

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "creator");
  await seedUser(db, "outsider");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  forgotten.length = 0;
  await db.delete(engineProjects);
  await db.delete(teams);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Settings Fixture",
    game: "fixture-game",
    createdById: "creator",
  });
});

describe("setGameSettings: visibility", () => {
  it("keeps a first public unlisted and queues the staff review", async () => {
    expect(await set({ visibility: "public" })).toEqual({
      visibility: "unlisted",
      reviewPending: true,
      saveMode: "site",
      connectOrigins: [],
      online: false,
    });
    expect(await row()).toMatchObject({
      visibility: "unlisted",
      publicReviewRequestedAt: NOW,
      publicApprovedAt: null,
    });
    expect(await reviewQueue()).toEqual([PROJECT]);
    expect(forgotten).toEqual([PROJECT]);
  });

  it("asks once: asking again keeps the first request and writes no second row", async () => {
    await set({ visibility: "public" });
    const later = new Date(NOW.getTime() + 60_000);
    await setGameSettings(
      { projectId: PROJECT, patch: { visibility: "public" }, actor: creator },
      { ...deps, now: () => later },
    );
    expect((await row()).publicReviewRequestedAt).toEqual(NOW);
    expect((await auditRows()).filter((r) => r.action === "visibility")).toHaveLength(1);
  });

  it("goes public at once after the approval, and later releases need no review", async () => {
    await set({ visibility: "public" });
    await approvePublic(
      { projectId: PROJECT, actor: staffActor },
      { db: db as unknown as ReleaseTxDb, now: () => NOW, forget: { release() {}, project() {} } },
    );
    expect(await set({ visibility: "private" })).toMatchObject({
      visibility: "private",
      reviewPending: false,
    });
    expect(await set({ visibility: "public" })).toMatchObject({
      visibility: "public",
      reviewPending: false,
    });
    expect(await reviewQueue()).toEqual([]);
  });

  it("withdraws a waiting review when the publisher picks another visibility", async () => {
    await set({ visibility: "public" });
    expect(await set({ visibility: "private" })).toMatchObject({
      visibility: "private",
      reviewPending: false,
    });
    expect((await row()).publicReviewRequestedAt).toBeNull();
    expect(await reviewQueue()).toEqual([]);
  });

  it("refuses team-only for a personal project and takes it for a team's", async () => {
    await expect(set({ visibility: "team" })).rejects.toMatchObject({
      body: { code: "release-forbidden", message: "Only a team's game can be team-only." },
    });
    const [team] = await db
      .insert(teams)
      .values({ slug: "settings-team", name: "Team", createdBy: "creator" })
      .returning({ id: teams.id });
    await db.update(engineProjects).set({ teamId: team!.id });
    expect(await set({ visibility: "team" })).toMatchObject({ visibility: "team" });
  });

  it("is for publishers and staff only, never an agent token", async () => {
    for (const actor of [outsider, agent]) {
      await expect(set({ visibility: "unlisted" }, actor)).rejects.toMatchObject({
        body: { code: "release-forbidden" },
      });
      await expect(set({ online: true }, actor)).rejects.toMatchObject({
        body: { code: "release-forbidden" },
      });
      await expect(set({}, actor)).rejects.toMatchObject({ body: { code: "release-forbidden" } });
    }
    expect(await set({ visibility: "unlisted" }, staffUser)).toMatchObject({
      visibility: "unlisted",
    });
    expect(await set({ visibility: "private" }, staffActor)).toMatchObject({
      visibility: "private",
    });
    expect(await auditRows()).toHaveLength(2);
  });

  it("answers not-found for a project that doesn't exist", async () => {
    await expect(
      setGameSettings({ projectId: "no-such-game", patch: {}, actor: creator }, deps),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("setGameSettings: Connects to and saves", () => {
  it("takes up to four https or wss origins, normalised and deduplicated", async () => {
    expect(
      await set({
        connectOrigins: [
          "https://API.example.org/",
          "wss://live.example.org:8443",
          "https://api.example.org",
          "https://cdn.example.net",
          "wss://other.example.com",
        ],
      }),
    ).toMatchObject({
      connectOrigins: [
        "https://api.example.org",
        "wss://live.example.org:8443",
        "https://cdn.example.net",
        "wss://other.example.com",
      ],
    });
    expect(CONNECT_ORIGINS_MAX).toBe(4);
  });

  it("refuses a fifth origin", async () => {
    const five = ["a", "b", "c", "d", "e"].map((h) => `https://${h}.example.org`);
    await expect(set({ connectOrigins: five })).rejects.toMatchObject({
      status: 400,
      body: {
        code: "game-settings-invalid",
        message: "A game can connect to at most 4 origins; this lists 5.",
      },
    });
    expect((await row()).connectOrigins).toEqual([]);
  });

  it("refuses anything that isn't a bare https or wss origin", async () => {
    for (const value of [
      "http://api.example.org",
      "ws://api.example.org",
      "ftp://api.example.org",
      "https://api.example.org/saves",
      "https://api.example.org?x=1",
      "https://api.example.org#x",
      "https://user:pw@api.example.org",
      "api.example.org",
      "javascript:alert(1)",
      "https://a.example.org; script-src *",
    ]) {
      await expect(set({ connectOrigins: [value] }), value).rejects.toMatchObject({
        body: { code: "game-settings-invalid" },
      });
    }
  });

  it("never takes the site's own origins, on either scheme", async () => {
    for (const value of [
      "https://jams.test",
      "wss://jams.test",
      "https://play.jams.test",
      "wss://PLAY.jams.test/",
    ]) {
      await expect(set({ connectOrigins: [value] }), value).rejects.toMatchObject({
        body: { code: "game-settings-invalid", message: expect.stringContaining("itself") },
      });
    }
  });

  it("defaults to the site's and the play origin's own hosts", () => {
    const own = siteOrigin().replace(/^http:/, "https:");
    expect(() => checkConnectOrigins([own], [siteOrigin()])).toThrow(/itself/);
    expect(checkConnectOrigins(["https://api.example.org"], [siteOrigin()])).toEqual([
      "https://api.example.org",
    ]);
  });

  it("needs an origin for a game that saves on its own servers", async () => {
    await expect(set({ saveMode: "own" })).rejects.toMatchObject({
      body: { code: "game-settings-invalid", message: expect.stringContaining("own servers") },
    });
    expect(
      await set({ saveMode: "own", connectOrigins: ["https://saves.example.org"] }),
    ).toMatchObject({ saveMode: "own", connectOrigins: ["https://saves.example.org"] });
    await expect(set({ connectOrigins: [] })).rejects.toMatchObject({
      body: { code: "game-settings-invalid" },
    });
    expect(await set({ saveMode: "none", connectOrigins: [] })).toMatchObject({
      saveMode: "none",
      connectOrigins: [],
    });
  });
});

describe("setGameSettings: the audit", () => {
  it("writes a visibility row and a settings row, each with the before and after", async () => {
    await set({
      visibility: "public",
      saveMode: "own",
      connectOrigins: ["https://saves.example.org"],
      online: true,
    });
    expect(await auditRows()).toEqual([
      {
        action: "visibility",
        actorKind: "user",
        actorId: "creator",
        detail: {
          requested: "public",
          before: { visibility: "private", reviewPending: false },
          after: { visibility: "unlisted", reviewPending: true },
        },
      },
      {
        action: "settings",
        actorKind: "user",
        actorId: "creator",
        detail: {
          before: { saveMode: "site", connectOrigins: [], online: false },
          after: { saveMode: "own", connectOrigins: ["https://saves.example.org"], online: true },
        },
      },
    ]);
  });

  it("records only what changed, and nothing when nothing did", async () => {
    await set({ online: true });
    await set({ online: true, saveMode: "site", visibility: "private" });
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        action: "settings",
        detail: { before: { online: false }, after: { online: true } },
      }),
    ]);
    expect(forgotten).toEqual([PROJECT]);
  });

  it("rolls back the whole change when one part is refused", async () => {
    await expect(
      set({ visibility: "unlisted", connectOrigins: ["http://insecure.example.org"] }),
    ).rejects.toMatchObject({ body: { code: "game-settings-invalid" } });
    expect((await row()).visibility).toBe("private");
    expect(await auditRows()).toEqual([]);
  });
});

describe("readGameSettings", () => {
  const read = () =>
    readGameSettings({ projectId: PROJECT, actor: creator }, db as unknown as ReleaseTxDb);

  it("answers what setGameSettings wrote", async () => {
    const written = await set({ visibility: "public", online: true });
    expect(await read()).toEqual({ ...written, team: null });
  });

  it("names the team that owns the project, so the editor can offer Team", async () => {
    const [team] = await db
      .insert(teams)
      .values({ slug: "read-settings-team", name: "Night Owls", createdBy: "creator" })
      .returning({ id: teams.id });
    await db.update(engineProjects).set({ teamId: team!.id });
    expect(await read()).toMatchObject({ team: "Night Owls" });
  });
});
