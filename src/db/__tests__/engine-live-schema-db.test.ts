import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineLiveReports,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleases,
  engineReleaseUploads,
  engineSceneChannels,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { writeAudit } from "@/lib/engine/release-audit";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const hex = (c: string) => c.repeat(64);
const PROJECT = "kitchen";
const SCENE = "level-1";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, "staff");
});

beforeEach(async () => {
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
});

const version = (
  id: string,
  number: number,
  over: Partial<typeof engineSceneVersions.$inferInsert> = {},
) => ({
  id,
  projectId: PROJECT,
  sceneId: SCENE,
  number,
  descriptor: "{}",
  compatKey: hex("c"),
  physics: "none",
  sceneHash: hex("d"),
  dataBytes: 120,
  createdById: "staff",
  ...over,
});

const pointer = (over: Partial<typeof engineSceneChannels.$inferInsert> = {}) => ({
  projectId: PROJECT,
  channel: "preview",
  sceneId: SCENE,
  versionId: hex("1"),
  timing: "next-load",
  ...over,
});

const release = {
  id: hex("e"),
  projectId: PROJECT,
  version: 1,
  manifest: "{}",
  manifestBytes: 2,
  totalBytes: 10,
  fileCount: 1,
  engineVersion: "0.14.4",
  gameId: "tactics",
  snapshot: hex("a"),
  buildHash: hex("b"),
  target: "web",
};

/** The database's own words for a refused statement: drizzle wraps them in `cause`. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${String(error)} ${cause instanceof Error ? cause.message : ""}`;
  }
  throw new Error("the statement went through");
}

describe("engine_scene_versions", () => {
  it("numbers a scene's versions once per project and scene", async () => {
    await db.insert(engineSceneVersions).values(version(hex("1"), 1));
    expect(
      await refusal(() => db.insert(engineSceneVersions).values(version(hex("2"), 1))),
    ).toContain("engine_scene_versions_scene_number_uq");
    await db.insert(engineSceneVersions).values(version(hex("2"), 2));
    await db.insert(engineSceneVersions).values(version(hex("3"), 1, { sceneId: "level-2" }));
  });

  it("holds 64-hex ids and hashes, numbers from 1, a known physics and a short note", async () => {
    const cases: [Partial<typeof engineSceneVersions.$inferInsert>, string][] = [
      [{ id: "abc" }, "engine_scene_versions_id"],
      [{ compatKey: "" }, "engine_scene_versions_compat_key"],
      [{ sceneHash: "x" }, "engine_scene_versions_scene_hash"],
      [{ baseReleaseId: "v7" }, "engine_scene_versions_base_release"],
      [{ number: 0 }, "engine_scene_versions_number"],
      [{ physics: "box2d" }, "engine_scene_versions_physics"],
      [{ note: "x".repeat(201) }, "engine_scene_versions_note"],
    ];
    for (const [over, check] of cases) {
      expect(
        await refusal(() =>
          db.insert(engineSceneVersions).values(version(hex("1"), over.number ?? 1, over)),
        ),
      ).toContain(check);
    }
    await db
      .insert(engineSceneVersions)
      .values(version(hex("1"), 1, { note: "x".repeat(200), baseReleaseId: hex("e") }));
  });

  it("is blocked by the system or a person, with a time, or not at all", async () => {
    expect(
      await refusal(() =>
        db
          .insert(engineSceneVersions)
          .values(version(hex("1"), 1, { blockedAt: new Date(), blockedBy: "breaker" })),
      ),
    ).toContain("engine_scene_versions_blocked_by");
    expect(
      await refusal(() =>
        db.insert(engineSceneVersions).values(version(hex("1"), 1, { blockedBy: "system" })),
      ),
    ).toContain("engine_scene_versions_blocked_by");
    const [made] = await db
      .insert(engineSceneVersions)
      .values(version(hex("1"), 1, { blockedAt: new Date(), blockedBy: "system" }))
      .returning();
    expect(made).toMatchObject({ reportsOk: 0, reportsFailed: 0, hiddenAt: null });
  });
});

describe("engine_scene_version_files", () => {
  beforeEach(async () => {
    await db.insert(engineSceneVersions).values(version(hex("1"), 1));
  });

  const file = (over: Partial<typeof engineSceneVersionFiles.$inferInsert> = {}) => ({
    versionId: hex("1"),
    sha256: hex("f"),
    bytes: 40,
    role: "scene",
    ext: ".json",
    source: "release",
    projectId: PROJECT,
    ...over,
  });

  it("refuses a hash, role, extension or source outside its lists", async () => {
    const cases: [Partial<typeof engineSceneVersionFiles.$inferInsert>, string][] = [
      [{ sha256: "f" }, "engine_scene_version_files_sha256"],
      [{ role: "code" }, "engine_scene_version_files_role"],
      [{ ext: "json" }, "engine_scene_version_files_ext"],
      [{ ext: "xjson" }, "engine_scene_version_files_ext"],
      [{ source: "cdn" }, "engine_scene_version_files_source"],
    ];
    for (const [over, check] of cases) {
      expect(await refusal(() => db.insert(engineSceneVersionFiles).values(file(over)))).toContain(
        check,
      );
    }
    await db
      .insert(engineSceneVersionFiles)
      .values([
        file(),
        file({ sha256: hex("9"), role: "blob", ext: ".png", source: "blob", bytes: 900 }),
        file({ sha256: hex("8"), role: "doc" }),
      ]);
  });
});

describe("engine_scene_channels", () => {
  beforeEach(async () => {
    await db.insert(engineSceneVersions).values(version(hex("1"), 1));
  });

  it("keeps a version a pointer names from being deleted", async () => {
    await db.insert(engineSceneChannels).values(pointer());
    expect(
      await refusal(() =>
        db.delete(engineSceneVersions).where(eq(engineSceneVersions.id, hex("1"))),
      ),
    ).toContain("engine_scene_channels_version_id");
    await db.delete(engineSceneChannels);
    await db.delete(engineSceneVersions).where(eq(engineSceneVersions.id, hex("1")));
  });

  it("refuses a timing or channel outside its lists", async () => {
    expect(
      await refusal(() => db.insert(engineSceneChannels).values(pointer({ timing: "later" }))),
    ).toContain("engine_scene_channels_timing");
    expect(
      await refusal(() => db.insert(engineSceneChannels).values(pointer({ channel: "beta" }))),
    ).toContain("engine_scene_channels_channel");
    const [made] = await db
      .insert(engineSceneChannels)
      .values(pointer({ timing: "now" }))
      .returning();
    expect(made).toMatchObject({ extraBytes: 0, timing: "now" });
  });

  it("holds one pointer per channel and scene", async () => {
    await db.insert(engineSceneChannels).values(pointer());
    expect(await refusal(() => db.insert(engineSceneChannels).values(pointer()))).toContain(
      "engine_scene_channels_pkey",
    );
    await db.insert(engineSceneChannels).values(pointer({ channel: "production" }));
  });
});

describe("engine_live_reports", () => {
  beforeEach(async () => {
    await db.insert(engineSceneVersions).values(version(hex("1"), 1));
  });

  it("refuses an outcome or channel outside its lists, and goes with its player", async () => {
    const row = { versionId: hex("1"), userId: "staff", channel: "production", outcome: "failed" };
    expect(
      await refusal(() =>
        db.insert(engineLiveReports).values({ ...row, outcome: "slow" as string }),
      ),
    ).toContain("engine_live_reports_outcome");
    expect(
      await refusal(() => db.insert(engineLiveReports).values({ ...row, channel: "beta" })),
    ).toContain("engine_live_reports_channel");
    await db.insert(engineLiveReports).values(row);
    await seedUser(db, "player");
    await db.insert(engineLiveReports).values({ ...row, userId: "player", outcome: "crashed" });
    expect(await db.select().from(engineLiveReports)).toHaveLength(2);
  });
});

describe("releases, channels, uploads and the audit, for live scenes", () => {
  it("default a release's compat key to empty, and refuse anything but empty or 64 hex", async () => {
    const [made] = await db.insert(engineReleases).values(release).returning();
    expect(made?.liveCompatKey).toBe("");
    expect(
      await refusal(() =>
        db
          .update(engineReleases)
          .set({ liveCompatKey: "abc" })
          .where(eq(engineReleases.id, hex("e"))),
      ),
    ).toContain("engine_releases_live_compat_key");
    await db
      .update(engineReleases)
      .set({ liveCompatKey: hex("c") })
      .where(eq(engineReleases.id, hex("e")));
  });

  it("start a channel's live rev at 0", async () => {
    await db.insert(engineReleases).values(release);
    const [made] = await db
      .insert(engineReleaseChannels)
      .values({ projectId: PROJECT, channel: "production", releaseId: hex("e") })
      .returning();
    expect(made?.liveRev).toBe(0);
  });

  it("take a scene upload only with its scene, a known timing and a short note", async () => {
    const row = {
      projectId: PROJECT,
      manifest: "{}",
      releaseId: hex("1"),
      actorKind: "user",
      actorId: "staff",
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    const [plain] = await db.insert(engineReleaseUploads).values(row).returning();
    expect(plain).toMatchObject({ kind: "release", sceneId: null, timing: null, note: null });
    expect(
      await refusal(() => db.insert(engineReleaseUploads).values({ ...row, kind: "scene" })),
    ).toContain("engine_release_uploads_scene");
    expect(
      await refusal(() => db.insert(engineReleaseUploads).values({ ...row, sceneId: SCENE })),
    ).toContain("engine_release_uploads_scene");
    expect(
      await refusal(() => db.insert(engineReleaseUploads).values({ ...row, kind: "level" })),
    ).toContain("engine_release_uploads_kind");
    const scene = { ...row, kind: "scene", sceneId: SCENE };
    expect(
      await refusal(() => db.insert(engineReleaseUploads).values({ ...scene, timing: "soon" })),
    ).toContain("engine_release_uploads_timing");
    expect(
      await refusal(() =>
        db.insert(engineReleaseUploads).values({ ...scene, note: "x".repeat(201) }),
      ),
    ).toContain("engine_release_uploads_note");
    await db
      .insert(engineReleaseUploads)
      .values({ ...scene, timing: "boundary", note: "Moved the ford" });
  });

  it("audit the nine scene actions with the scene and its version", async () => {
    const actions = [
      "scene-create",
      "scene-promote",
      "scene-rollback",
      "scene-clear",
      "scene-block",
      "scene-unblock",
      "scene-hide",
      "scene-unhide",
      "scene-collect",
    ];
    await db.insert(engineReleaseAudit).values(
      actions.map((action) => ({
        projectId: PROJECT,
        actorKind: "system",
        action,
        channel: "preview",
        sceneId: SCENE,
        sceneVersionId: hex("1"),
      })),
    );
    expect(
      await refusal(() =>
        db
          .insert(engineReleaseAudit)
          .values({ projectId: PROJECT, actorKind: "system", action: "scene-delete" }),
      ),
    ).toContain("engine_release_audit_action");
    const rows = await db.select().from(engineReleaseAudit);
    expect(rows.map((r) => r.action).sort()).toEqual([...actions].sort());
    expect(rows.every((r) => r.sceneId === SCENE && r.sceneVersionId === hex("1"))).toBe(true);
  });
});

describe("writeAudit", () => {
  it("answers each row's id, growing, with the scene and its version", async () => {
    const actor = { kind: "user", userId: "staff" } as const;
    const first = await writeAudit(db, {
      projectId: PROJECT,
      actor,
      action: "scene-create",
      sceneId: SCENE,
      sceneVersionId: hex("1"),
    });
    const second = await writeAudit(db, {
      projectId: PROJECT,
      actor,
      action: "scene-promote",
      channel: "production",
      sceneId: SCENE,
      sceneVersionId: hex("1"),
    });
    expect(second).toBeGreaterThan(first);
    const [row] = await db
      .select()
      .from(engineReleaseAudit)
      .where(eq(engineReleaseAudit.id, second));
    expect(row).toMatchObject({
      action: "scene-promote",
      sceneId: SCENE,
      sceneVersionId: hex("1"),
      releaseId: null,
    });
  });
});

describe("a project's delete", () => {
  it("cascades through its scene versions, their files, pointers and reports", async () => {
    await db.insert(engineSceneVersions).values([version(hex("1"), 1), version(hex("2"), 2)]);
    await db.insert(engineSceneVersionFiles).values({
      versionId: hex("1"),
      sha256: hex("f"),
      bytes: 40,
      role: "version",
      ext: ".json",
      source: "release",
      projectId: PROJECT,
    });
    await db
      .insert(engineSceneChannels)
      .values([pointer(), pointer({ channel: "production", versionId: hex("2") })]);
    await db
      .insert(engineLiveReports)
      .values({ versionId: hex("2"), userId: "staff", channel: "production", outcome: "applied" });

    await db.delete(engineProjects).where(eq(engineProjects.projectId, PROJECT));

    for (const table of [
      engineSceneVersions,
      engineSceneVersionFiles,
      engineSceneChannels,
      engineLiveReports,
    ])
      expect(await db.select().from(table)).toEqual([]);
  });
});
