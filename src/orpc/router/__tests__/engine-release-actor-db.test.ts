import { call } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleaseAudit, engineReleaseUploads } from "@/db/schema";
import { putReleaseFile, type ReleaseTxDb } from "@/lib/engine/release-upload";
import { beginRelease, commitRelease, promoteRelease } from "@/orpc/router/engine-release";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import { plannedRelease } from "../../../lib/engine/__tests__/release-fixture";

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
vi.mock("@/lib/engine/guard-server", () => ({ assertEngineGames: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
const shared = vi.hoisted(() => ({
  store: null as null | import("@/lib/engine/release-storage").ReleaseObjectStore,
}));
vi.mock("@/lib/engine/release-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/release-storage")>();
  shared.store = actual.memoryReleaseStore();
  return { ...actual, minioReleaseStore: shared.store };
});

const db = mockedDb as unknown as TestDb;
const PROJECT = "fixture";

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Fixture", game: "g" });
});

describe("the release procedures name staff as staff", () => {
  it("audits a staff upload, its preview move and a promote as staff", async () => {
    const r = await plannedRelease({ projectId: PROJECT, gameId: "g", engineVersion: "0.14.1" });
    const begun = await call(
      beginRelease,
      { projectId: PROJECT, manifest: r.text, channel: "preview" },
      asUser("staff"),
    );
    for (const file of begun.missing)
      await putReleaseFile(
        { db: db as unknown as ReleaseTxDb, store: shared.store!, scan: async () => {} },
        {
          uploadId: begun.uploadId,
          sha256: file.sha256,
          body: r.files.get(file.path)!,
          actor: { kind: "staff", userId: "staff" },
        },
      );
    const committed = await call(commitRelease, { uploadId: begun.uploadId }, asUser("staff"));
    expect(committed).toMatchObject({ version: 1, created: true });
    await call(
      promoteRelease,
      { projectId: PROJECT, version: 1, channel: "production" },
      asUser("staff"),
    );

    const [upload] = await db
      .select({ actorKind: engineReleaseUploads.actorKind, actorId: engineReleaseUploads.actorId })
      .from(engineReleaseUploads)
      .where(eq(engineReleaseUploads.id, begun.uploadId));
    expect(upload).toEqual({ actorKind: "staff", actorId: "staff" });
    const audit = await db
      .select({
        action: engineReleaseAudit.action,
        actorKind: engineReleaseAudit.actorKind,
        actorId: engineReleaseAudit.actorId,
      })
      .from(engineReleaseAudit)
      .orderBy(asc(engineReleaseAudit.id));
    expect(audit.map((a) => a.action)).toEqual(["create", "promote", "promote"]);
    expect(audit.every((a) => a.actorKind === "staff" && a.actorId === "staff")).toBe(true);
  });
});
