import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseUploads,
  engineSceneChannels,
  engineSceneVersions,
} from "@/db/schema";
import type { TestDb } from "@/test/db";

import { createLiveRoutes } from "../live-routes";
import { createReleaseRoutes } from "../release-routes";
import { memoryReleaseStore, type ReleaseObjectStore } from "../release-storage";
import type { Actor } from "../release-upload";
import { engineLiveCommitPath, engineLivePath, engineReleaseFilePath } from "../route-paths";
import { fixtureVersion } from "./fixtures/live/scene-versions";
import { call, PROJECT, secretFor, seedEngine, sendTo, testReadSession } from "./harness";
import { plannedRelease, type PlannedRelease } from "./release-fixture";
import { uploadDeps, uploadRelease } from "./upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  getMinioClient: () => null,
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.deployEnv(),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: (flag: string) => games.isServerFlagEnabled(flag),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
const games = await vi.hoisted(async () => (await import("./harness")).gamesGate());

const OTHER = "pantry";

let db: TestDb;
let store: ReleaseObjectStore;
let routes: ReturnType<typeof createLiveRoutes>;
let fileRoutes: ReturnType<typeof createReleaseRoutes>;
let release: PlannedRelease;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await seedEngine(db);
  await db.insert(engineProjects).values({ projectId: OTHER, name: "Pantry" });
  games.reset();
  store = memoryReleaseStore();
  const deps = { readSession: testReadSession, release: { store } };
  routes = createLiveRoutes(deps);
  fileRoutes = createReleaseRoutes(deps);
  release ??= await plannedRelease({ projectId: PROJECT });
});

const send = sendTo(() => routes);
const sendToFiles = sendTo(() => fileRoutes);

/** `release` uploaded and committed by staff, which puts it on preview. */
async function releaseOnPreview() {
  const actor: Actor = { kind: "staff", userId: "staff" };
  await uploadRelease(uploadDeps(store), release, { actor });
}

/** A scene upload of `projectId` that no file has reached yet. */
async function openUpload(projectId: string) {
  const [row] = await db
    .insert(engineReleaseUploads)
    .values({
      projectId,
      kind: "scene",
      sceneId: "hall",
      manifest: "{}",
      releaseId: "ab".repeat(32),
      actorKind: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: engineReleaseUploads.id });
  return row!.id;
}

describe("live routes", () => {
  it("let a write token begin, send the texts through the file route and commit to preview", async () => {
    await releaseOnPreview();
    const hall = await fixtureVersion(release, {
      scene: "hall",
      edit: (scene) => {
        (scene.entities as { at: number[] }[])[0]!.at = [3, 2];
      },
    });
    const secret = await secretFor(PROJECT);

    const begun = await send(
      call(engineLivePath(PROJECT), {
        secret,
        json: { version: hall.text, timing: "boundary", note: "Moved the start" },
      }),
    );
    expect(begun.status).toBe(200);
    expect(begun.headers.get("cache-control")).toBe("no-store");
    const { uploadId, versionId, missing } = (await begun.json()) as {
      uploadId: string;
      versionId: string;
      missing: { sha256: string }[];
    };
    expect(versionId).toBe(hall.id);
    expect(missing.length).toBeGreaterThan(0);
    for (const file of missing) {
      const put = await sendToFiles(
        call(engineReleaseFilePath(uploadId, file.sha256), {
          method: "PUT",
          secret,
          body: hall.texts.get(file.sha256)!,
        }),
      );
      expect(put.status).toBe(204);
    }

    const committed = await send(
      call(engineLiveCommitPath(PROJECT), { secret, json: { uploadId } }),
    );
    expect(committed.status).toBe(201);
    expect(await committed.json()).toEqual({
      versionId: hall.id,
      scene: "hall",
      number: 1,
      created: true,
      liveOn: "preview",
    });
    const [version] = await db
      .select()
      .from(engineSceneVersions)
      .where(eq(engineSceneVersions.id, hall.id));
    expect(version).toMatchObject({ projectId: PROJECT, number: 1, note: "Moved the start" });
    const pointers = await db
      .select({
        channel: engineSceneChannels.channel,
        timing: engineSceneChannels.timing,
        versionId: engineSceneChannels.versionId,
      })
      .from(engineSceneChannels)
      .where(eq(engineSceneChannels.projectId, PROJECT));
    expect(pointers).toEqual([{ channel: "preview", timing: "boundary", versionId: hall.id }]);
  });

  it("refuse a read-only token's begin and commit, and a token for another project", async () => {
    const readOnly = await secretFor(PROJECT, "read");
    const begun = await send(
      call(engineLivePath(PROJECT), { secret: readOnly, json: { version: "{}" } }),
    );
    expect(begun.status).toBe(403);
    expect(await begun.json()).toEqual({
      code: "release-forbidden",
      message: "That agent token is read-only.",
    });
    const uploadId = await openUpload(PROJECT);
    const committed = await send(
      call(engineLiveCommitPath(PROJECT), { secret: readOnly, json: { uploadId } }),
    );
    expect(committed.status).toBe(403);

    const other = await send(
      call(engineLivePath(PROJECT), { secret: await secretFor(OTHER), json: { version: "{}" } }),
    );
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({
      code: "release-forbidden",
      message: "That agent token is for another project.",
    });
  });

  it("answer a commit of another project's upload, or of a release upload, as not found", async () => {
    const secret = await secretFor(OTHER);
    const theirs = await openUpload(PROJECT);
    const crossed = await send(
      call(engineLiveCommitPath(OTHER), { secret, json: { uploadId: theirs } }),
    );
    expect(crossed.status).toBe(404);
    expect(await crossed.json()).toMatchObject({ code: "not-found" });

    const [release] = await db
      .insert(engineReleaseUploads)
      .values({
        projectId: OTHER,
        manifest: "{}",
        releaseId: "cd".repeat(32),
        actorKind: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: engineReleaseUploads.id });
    const releaseUpload = await send(
      call(engineLiveCommitPath(OTHER), { secret, json: { uploadId: release!.id } }),
    );
    expect(releaseUpload.status).toBe(404);
  });

  it("read as not found on production and while engine-games-enabled is off", async () => {
    const secret = await secretFor(PROJECT);
    const uploadId = await openUpload(PROJECT);
    for (const setting of [{ env: "production" as const }, { flag: false }]) {
      games.reset();
      Object.assign(games, setting);
      for (const request of [
        call(engineLivePath(PROJECT), { secret, json: { version: "{}" } }),
        call(engineLivePath(PROJECT), { user: "staff", json: { version: "{}" } }),
        call(engineLiveCommitPath(PROJECT), { secret, json: { uploadId } }),
      ]) {
        const response = await send(request);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ code: "not-found", message: "Not found." });
      }
    }
  });

  it("answer a malformed body as the schema error and a long note before the upload runs", async () => {
    const secret = await secretFor(PROJECT);
    const malformed = await send(call(engineLivePath(PROJECT), { secret, json: { version: 7 } }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "schema" });
    const longNote = await send(
      call(engineLivePath(PROJECT), {
        secret,
        json: { version: "{}", note: "n".repeat(201) },
      }),
    );
    expect(longNote.status).toBe(400);
    expect(await longNote.json()).toMatchObject({ code: "schema" });
    expect(await db.select().from(engineReleaseUploads)).toEqual([]);
  });

  it("pass on paths they don't answer", async () => {
    expect(await routes(call(`/api/engine/projects/${PROJECT}/releases`))).toBeNull();
    expect(await routes(call(`/api/engine/projects/${PROJECT}/live/scenes/hall/1`))).toBeNull();
  });
});
