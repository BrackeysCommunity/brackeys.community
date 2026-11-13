import { call } from "@orpc/server";
import { asc } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleaseAudit, engineReleaseUploads } from "@/db/schema";
import { LIVE_LIMITS } from "@/lib/engine/limits";
import { createLiveRoutes } from "@/lib/engine/live-routes";
import { engineLivePath } from "@/lib/engine/route-paths";
import { beginSceneVersion, commitSceneVersion } from "@/orpc/router/engine-live";
import { beginRelease, commitRelease } from "@/orpc/router/engine-release";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import { editedVersion } from "../../../lib/engine/__tests__/fixtures/live/scene-versions";
import { plannedRelease } from "../../../lib/engine/__tests__/release-fixture";
import {
  putMissingFiles,
  putSceneTexts,
  refusal,
  uploadDeps,
} from "../../../lib/engine/__tests__/upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
const shared = vi.hoisted(() => ({
  store: null as null | import("@/lib/engine/release-storage").ReleaseObjectStore,
}));
vi.mock("@/lib/engine/release-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/release-storage")>();
  shared.store = actual.memoryReleaseStore();
  return { ...actual, minioReleaseStore: shared.store };
});

const games = vi.hoisted(() => ({
  env: "staging" as "production" | "staging" | "development",
  flag: true,
}));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.env,
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag !== "engine-games-enabled" || games.flag,
}));

/** A fixed-window limiter in memory, counting as Redis would. */
const hits = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string, key: string, limit: number) => {
    const count = (hits.get(`${bucket}:${key}`) ?? 0) + 1;
    hits.set(`${bucket}:${key}`, count);
    return count <= limit;
  },
}));

const db = mockedDb as unknown as TestDb;
const PROJECT = "fixture";

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "member");
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Fixture" });
});

beforeEach(() => {
  games.env = "staging";
  games.flag = true;
  hits.clear();
});

const begin = (user: string, version = "{}") =>
  call(beginSceneVersion, { projectId: PROJECT, version }, asUser(user));

describe("the live upload procedures", () => {
  it("let staff begin and commit a version to preview, audited as staff", async () => {
    const release = await plannedRelease({ projectId: PROJECT });
    const staff = { kind: "staff", userId: "staff" } as const;
    const deps = uploadDeps(shared.store!);
    const shipped = await call(
      beginRelease,
      { projectId: PROJECT, manifest: release.text, channel: "preview" },
      asUser("staff"),
    );
    await putMissingFiles(deps, shipped, release, staff);
    await call(commitRelease, { uploadId: shipped.uploadId }, asUser("staff"));

    const hall = await editedVersion(release, "hall", 2, 2);
    const begun = await call(
      beginSceneVersion,
      { projectId: PROJECT, version: hall.text, note: "  Moved the start  " },
      asUser("staff"),
    );
    expect(begun).toMatchObject({ versionId: hall.id, number: null });
    await putSceneTexts(deps, hall, begun, staff);
    const committed = await call(commitSceneVersion, { uploadId: begun.uploadId }, asUser("staff"));
    expect(committed).toEqual({
      versionId: hall.id,
      scene: "hall",
      number: 1,
      created: true,
      liveOn: "preview",
    });

    const audit = await db
      .select({ action: engineReleaseAudit.action, actorKind: engineReleaseAudit.actorKind })
      .from(engineReleaseAudit)
      .orderBy(asc(engineReleaseAudit.id));
    expect(audit.map((a) => a.action)).toEqual([
      "create",
      "promote",
      "scene-create",
      "scene-promote",
    ]);
    expect(audit.every((a) => a.actorKind === "staff")).toBe(true);
  });

  it("read as not found on production, before any lookup", async () => {
    const uploads = (await db.select().from(engineReleaseUploads)).length;
    games.env = "production";
    expect(await refusal(() => begin("staff"))).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await refusal(() => call(commitSceneVersion, { uploadId: "nope" }, asUser("staff"))),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(engineReleaseUploads)).toHaveLength(uploads);
  });

  it("read as not found while engine-games-enabled is off", async () => {
    games.flag = false;
    expect(await refusal(() => begin("staff"))).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await refusal(() => call(commitSceneVersion, { uploadId: "nope" }, asUser("staff"))),
    ).toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuse a caller who isn't staff, and a signed-out one", async () => {
    expect(await refusal(() => begin("member"))).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await refusal(() => call(commitSceneVersion, { uploadId: "nope" }, asUser("member"))),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await refusal(() =>
        call(beginSceneVersion, { projectId: PROJECT, version: "{}" }, asUser(null)),
      ),
    ).toMatchObject({ code: "UNAUTHORIZED" });
    expect(hits.size).toBe(0);
  });

  it("answer a note longer than the limit with the upload's note refusal", async () => {
    const note = "n".repeat(LIVE_LIMITS.noteChars + 1);
    const refused = await refusal(() =>
      call(beginSceneVersion, { projectId: PROJECT, version: "{}", note }, asUser("staff")),
    );
    expect(refused).toMatchObject({ code: "schema", status: 400 });
    expect(refused.message).toContain(`${LIVE_LIMITS.noteChars + 1} characters`);
  });

  it("count a note's characters, not its UTF-16 units", async () => {
    const note = "\u{1F3AE}".repeat(150);
    expect(note.length).toBeGreaterThan(LIVE_LIMITS.noteChars);
    const refused = await refusal(() =>
      call(beginSceneVersion, { projectId: PROJECT, version: "{}", note }, asUser("staff")),
    );
    expect(refused.message).not.toContain("note");
  });

  it("answer a version over the data cap with the quota refusal", async () => {
    const used = LIVE_LIMITS.versionDataBytes + 1;
    expect(
      await refusal(() =>
        call(beginSceneVersion, { projectId: PROJECT, version: "x".repeat(used) }, asUser("staff")),
      ),
    ).toMatchObject({
      code: "quota-exceeded",
      limit: "liveVersionBytes",
      used,
      max: LIVE_LIMITS.versionDataBytes,
    });
  });

  it("refuse the begin past the hour's limit as rate limited", async () => {
    for (let i = 0; i < LIVE_LIMITS.beginsPerHour; i++) {
      const refused = await refusal(() => begin("staff"));
      expect(refused.code, `begin ${i + 1}`).not.toBe("release-rate-limited");
    }
    expect(await refusal(() => begin("staff"))).toMatchObject({
      code: "release-rate-limited",
      status: 429,
    });
  });
});

describe("the live begin route", () => {
  it("answers a version over the data cap with the quota refusal", async () => {
    const routes = createLiveRoutes({
      readSession: async () => ({ user: { id: "staff" } }),
      release: { store: shared.store! },
    });
    const used = LIVE_LIMITS.versionDataBytes + 1;
    const response = await routes(
      new Request(`https://site.test${engineLivePath(PROJECT)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "x".repeat(used) }),
      }),
    );
    expect(response?.status).toBe(413);
    expect(await response?.json()).toMatchObject({
      code: "quota-exceeded",
      limit: "liveVersionBytes",
      used,
    });
  });
});
