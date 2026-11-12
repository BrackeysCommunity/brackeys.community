import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseJamLinks,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  itchJams,
} from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const hex = (c: string) => c.repeat(64);
const PROJECT = "kitchen";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, "staff");
});

beforeEach(async () => {
  await db.delete(engineProjects);
  await db.delete(itchJams);
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
});

const release = (
  id: string,
  version: number,
  over: Partial<typeof engineReleases.$inferInsert> = {},
) => ({
  id,
  projectId: PROJECT,
  version,
  manifest: "{}",
  manifestBytes: 2,
  totalBytes: 10,
  fileCount: 1,
  engineVersion: "0.14.1",
  gameId: "tactics",
  snapshot: hex("a"),
  buildHash: hex("b"),
  target: "web",
  createdById: "staff",
  ...over,
});

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

describe("engine_projects' publishing columns", () => {
  it("default to private, saving to the site, offline, no origins", async () => {
    const [row] = await db
      .select()
      .from(engineProjects)
      .where(eq(engineProjects.projectId, PROJECT));
    expect(row).toMatchObject({
      visibility: "private",
      saveMode: "site",
      online: false,
      connectOrigins: [],
      showcaseProjectId: null,
      hiddenAt: null,
    });
  });

  it("refuse a visibility or save mode outside their lists", async () => {
    expect(
      await refusal(() =>
        db
          .update(engineProjects)
          .set({ visibility: "friends" })
          .where(eq(engineProjects.projectId, PROJECT)),
      ),
    ).toContain("engine_projects_visibility");
    expect(
      await refusal(() =>
        db
          .update(engineProjects)
          .set({ saveMode: "elsewhere" })
          .where(eq(engineProjects.projectId, PROJECT)),
      ),
    ).toContain("engine_projects_save_mode");
  });
});

describe("engine_releases", () => {
  it("numbers versions once per project", async () => {
    await db.insert(engineReleases).values(release(hex("1"), 1));
    expect(await refusal(() => db.insert(engineReleases).values(release(hex("2"), 1)))).toContain(
      "engine_releases_project_version_uq",
    );
    await db.insert(engineReleases).values(release(hex("2"), 2));
  });

  it("holds 64-hex ids and hashes, web or itch, versions from 1", async () => {
    expect(await refusal(() => db.insert(engineReleases).values(release("abc", 1)))).toContain(
      "engine_releases_id",
    );
    expect(
      await refusal(() =>
        db.insert(engineReleases).values(release(hex("1"), 1, { snapshot: "x" })),
      ),
    ).toContain("engine_releases_snapshot");
    expect(
      await refusal(() =>
        db.insert(engineReleases).values(release(hex("1"), 1, { target: "desktop" })),
      ),
    ).toContain("engine_releases_target");
    expect(await refusal(() => db.insert(engineReleases).values(release(hex("1"), 0)))).toContain(
      "engine_releases_version",
    );
  });
});

describe("engine_release_channels", () => {
  beforeEach(async () => {
    await db.insert(engineReleases).values(release(hex("1"), 1));
  });

  it("names preview or production only", async () => {
    expect(
      await refusal(() =>
        db
          .insert(engineReleaseChannels)
          .values({ projectId: PROJECT, channel: "beta", releaseId: hex("1") }),
      ),
    ).toContain("engine_release_channels_channel");
  });

  it("keeps a release it names from being deleted", async () => {
    await db
      .insert(engineReleaseChannels)
      .values({ projectId: PROJECT, channel: "production", releaseId: hex("1") });
    expect(
      await refusal(() => db.delete(engineReleases).where(eq(engineReleases.id, hex("1")))),
    ).toContain("engine_release_channels_release_id");
  });

  it("keeps a jam-pinned release from being deleted", async () => {
    await db.insert(itchJams).values({ jamId: 7, slug: "jam-7", title: "Jam 7", status: "over" });
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 7, releaseId: hex("1") });
    expect(
      await refusal(() => db.delete(engineReleases).where(eq(engineReleases.id, hex("1")))),
    ).toContain("engine_release_jam_links_release_id");
  });
});

describe("a project's delete", () => {
  it("cascades through its releases, files, objects, channels, pins, uploads and audit", async () => {
    await db.insert(engineReleases).values(release(hex("1"), 1));
    await db.insert(engineReleaseObjects).values({
      projectId: PROJECT,
      sha256: hex("c"),
      bytes: 4,
      contentType: "application/json",
      storageKey: `engine-releases/${PROJECT}/${hex("c")}`,
    });
    await db.insert(engineReleaseFiles).values({
      releaseId: hex("1"),
      projectId: PROJECT,
      path: `data/${hex("c")}.json`,
      sha256: hex("c"),
      bytes: 4,
      role: "data",
      source: "release",
    });
    await db
      .insert(engineReleaseChannels)
      .values({ projectId: PROJECT, channel: "preview", releaseId: hex("1") });
    await db.insert(itchJams).values({ jamId: 7, slug: "jam-7", title: "Jam 7", status: "over" });
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 7, releaseId: hex("1") });
    await db.insert(engineReleaseUploads).values({
      projectId: PROJECT,
      manifest: "{}",
      releaseId: hex("1"),
      actorKind: "user",
      actorId: "staff",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(engineReleaseAudit).values({
      projectId: PROJECT,
      actorKind: "user",
      actorId: "staff",
      action: "create",
      releaseId: hex("1"),
    });

    await db.delete(engineProjects).where(eq(engineProjects.projectId, PROJECT));

    for (const table of [
      engineReleases,
      engineReleaseObjects,
      engineReleaseFiles,
      engineReleaseChannels,
      engineReleaseJamLinks,
      engineReleaseUploads,
      engineReleaseAudit,
    ])
      expect(await db.select().from(table)).toEqual([]);
  });
});

describe("engine_release_audit", () => {
  it("outlives the collection of the release it names", async () => {
    await db.insert(engineReleases).values(release(hex("1"), 1));
    await db.insert(engineReleaseFiles).values({
      releaseId: hex("1"),
      projectId: PROJECT,
      path: "index.html",
      sha256: hex("d"),
      bytes: 4,
      role: "shell",
      source: "release",
    });
    await db.insert(engineReleaseAudit).values({
      projectId: PROJECT,
      actorKind: "user",
      actorId: "staff",
      action: "create",
      releaseId: hex("1"),
    });
    // Collecting drops the manifest and the file rows and keeps the record.
    await db
      .update(engineReleases)
      .set({ collectedAt: new Date(), manifest: null })
      .where(eq(engineReleases.id, hex("1")));
    await db.delete(engineReleaseFiles).where(eq(engineReleaseFiles.releaseId, hex("1")));
    await db.insert(engineReleaseAudit).values({
      projectId: PROJECT,
      actorKind: "system",
      action: "collect",
      releaseId: hex("1"),
    });
    // With nothing pinning it the record itself can go, and the history still names it.
    await db.delete(engineReleases).where(eq(engineReleases.id, hex("1")));
    const rows = await db.select().from(engineReleaseAudit);
    expect(rows.map((r) => [r.action, r.releaseId])).toEqual([
      ["create", hex("1")],
      ["collect", hex("1")],
    ]);
  });

  it("refuses an action, actor kind or channel outside its lists", async () => {
    const row = { projectId: PROJECT, actorKind: "user", action: "create" };
    expect(
      await refusal(() => db.insert(engineReleaseAudit).values({ ...row, action: "delete" })),
    ).toContain("engine_release_audit_action");
    expect(
      await refusal(() => db.insert(engineReleaseAudit).values({ ...row, actorKind: "robot" })),
    ).toContain("engine_release_audit_actor_kind");
    expect(
      await refusal(() => db.insert(engineReleaseAudit).values({ ...row, channel: "beta" })),
    ).toContain("engine_release_audit_channel");
  });
});

describe("engine_release_uploads", () => {
  it("moves preview or nothing, for a 64-hex release", async () => {
    const row = {
      projectId: PROJECT,
      manifest: "{}",
      releaseId: hex("1"),
      actorKind: "agent",
      expiresAt: new Date(),
    };
    expect(
      await refusal(() =>
        db.insert(engineReleaseUploads).values({ ...row, channel: "production" }),
      ),
    ).toContain("engine_release_uploads_channel");
    expect(
      await refusal(() => db.insert(engineReleaseUploads).values({ ...row, releaseId: "nope" })),
    ).toContain("engine_release_uploads_release_id");
    const [made] = await db.insert(engineReleaseUploads).values(row).returning();
    expect(made).toMatchObject({ channel: "preview", missing: [], committedAt: null });
  });
});
