import { sha256 } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleases,
  engineReleaseUploads,
} from "@/db/schema";
import { PROJECT_QUOTA } from "@/lib/engine/limits";
import type { TestDb } from "@/test/db";

import { createReleaseRoutes } from "../release-routes";
import { memoryReleaseStore } from "../release-storage";
import {
  engineReleaseCommitPath,
  engineReleaseFilePath,
  engineReleaseMovePath,
  engineReleasesPath,
} from "../route-paths";
import { call, ORIGIN, PROJECT, secretFor, seedEngine, sendTo, testReadSession } from "./harness";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

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
let routes: ReturnType<typeof createReleaseRoutes>;
let release: PlannedRelease;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await seedEngine(db);
  await db.insert(engineProjects).values({ projectId: OTHER, name: "Pantry" });
  games.reset();
  routes = createReleaseRoutes({
    readSession: testReadSession,
    release: { store: memoryReleaseStore() },
  });
  release ??= await plannedRelease({ projectId: PROJECT, engineVersion: "0.14.1" });
});

const send = sendTo(() => routes);

type Missing = { path: string; sha256: string; bytes: number };

async function upload(secret: string) {
  const begun = await send(
    call(engineReleasesPath(PROJECT), { secret, json: { manifest: release.text } }),
  );
  expect(begun.status).toBe(200);
  const { uploadId, missing } = (await begun.json()) as { uploadId: string; missing: Missing[] };
  for (const file of missing) {
    const put = await send(
      call(engineReleaseFilePath(uploadId, file.sha256), {
        method: "PUT",
        secret,
        body: new Uint8Array(release.files.get(file.path)!),
      }),
    );
    expect(put.status).toBe(204);
  }
  return { uploadId, missing };
}

describe("release routes with an agent token", () => {
  it("upload through begin, every file's PUT and commit, which moves preview", async () => {
    const secret = await secretFor(PROJECT);
    const { uploadId, missing } = await upload(secret);
    expect(missing.length).toBe(release.manifest.build.files.length);

    const committed = await send(
      call(engineReleaseCommitPath(PROJECT), { secret, json: { uploadId } }),
    );
    expect(committed.status).toBe(201);
    expect(await committed.json()).toMatchObject({
      releaseId: release.releaseId,
      version: 1,
      created: true,
    });

    const [row] = await db
      .select()
      .from(engineReleases)
      .where(eq(engineReleases.id, release.releaseId));
    expect(row).toMatchObject({ projectId: PROJECT, version: 1, createdById: "staff" });
    expect(row?.agentTokenId).not.toBeNull();
    const [preview] = await db
      .select()
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.projectId, PROJECT));
    expect(preview).toMatchObject({ channel: "preview", releaseId: release.releaseId });

    const again = await send(
      call(engineReleasesPath(PROJECT), { secret, json: { manifest: release.text } }),
    );
    expect(await again.json()).toMatchObject({ version: 1, missing: [] });
  });

  it("refuse a read-only token's begin and a token for another project", async () => {
    const begin = (secret: string) =>
      send(call(engineReleasesPath(PROJECT), { secret, json: { manifest: release.text } }));

    const readOnly = await begin(await secretFor(PROJECT, "read"));
    expect(readOnly.status).toBe(403);
    expect(await readOnly.json()).toEqual({
      code: "release-forbidden",
      message: "That agent token is read-only.",
    });

    const other = await begin(await secretFor(OTHER));
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({
      code: "release-forbidden",
      message: "That agent token is for another project.",
    });

    const unknown = await begin("jat_nope");
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toBe("Bearer");
    expect((await unknown.json()) as { code: string }).toMatchObject({ code: "release-forbidden" });
    expect(await db.select().from(engineReleaseUploads)).toEqual([]);
  });

  it("refuse a token for another project on an upload's files and commit", async () => {
    const [row] = await db
      .insert(engineReleaseUploads)
      .values({
        projectId: PROJECT,
        manifest: release.text,
        releaseId: release.releaseId,
        missing: [],
        actorKind: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: engineReleaseUploads.id });
    const other = await secretFor(OTHER);
    const put = await send(
      call(engineReleaseFilePath(row!.id, "ab".repeat(32)), {
        method: "PUT",
        secret: other,
        body: new Uint8Array([1]),
      }),
    );
    expect(put.status).toBe(403);
    const commit = await send(
      call(engineReleaseCommitPath(OTHER), { secret: other, json: { uploadId: row!.id } }),
    );
    expect(commit.status).toBe(404);
    expect(await commit.json()).toMatchObject({ code: "not-found" });
  });

  it("refuse a production move with the game page as the hint, before any lookup", async () => {
    const secret = await secretFor(PROJECT);
    const moved = await send(
      call(engineReleaseMovePath(PROJECT, 1, "promote"), {
        secret,
        json: { channel: "production" },
      }),
    );
    expect(moved.status).toBe(403);
    const body = (await moved.json()) as { code: string; hint: string };
    expect(body.code).toBe("release-forbidden");
    expect(body.hint).toMatch(new RegExp(`/games/${PROJECT}$`));
  });
});

describe("release routes", () => {
  it("answer every refusal as the release API's JSON body", async () => {
    const signedOut = await send(call(engineReleasesPath(PROJECT)));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({
      code: "release-forbidden",
      message: "Authentication required.",
    });

    const member = await send(call(engineReleasesPath(PROJECT), { user: "member" }));
    expect(member.status).toBe(403);
    expect(await member.json()).toMatchObject({ code: "release-forbidden" });

    const malformed = await send(
      call(engineReleasesPath(PROJECT), { user: "staff", json: { manifest: 7 } }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "schema" });

    const noChannel = await send(
      call(engineReleaseMovePath(PROJECT, 1, "promote"), { user: "staff", json: {} }),
    );
    expect(noChannel.status).toBe(400);
    expect(noChannel.headers.get("content-type")).toMatch(/json/);
  });

  it("read as not found on production and while engine-games-enabled is off, for a session and a token", async () => {
    const secret = await secretFor(PROJECT);
    for (const setting of [{ env: "production" as const }, { flag: false }]) {
      games.reset();
      Object.assign(games, setting);
      for (const request of [
        call(engineReleasesPath(PROJECT), { user: "staff" }),
        call(engineReleasesPath(PROJECT), { secret, json: { manifest: release.text } }),
      ]) {
        const response = await send(request);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ code: "not-found", message: "Not found." });
      }
    }
  });

  it("cap the file PUT's bytes without reading past the cap", async () => {
    const [row] = await db
      .insert(engineReleaseUploads)
      .values({
        projectId: PROJECT,
        manifest: release.text,
        releaseId: release.releaseId,
        missing: [{ path: "assets/big.ogg", sha256: "cd".repeat(32), bytes: 10 }],
        actorKind: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: engineReleaseUploads.id });
    const secret = await secretFor(PROJECT);
    const max = PROJECT_QUOTA.releaseFileBytes;

    let pulled = 0;
    const chunk = new Uint8Array(1_048_576);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const capped = await send(
      call(engineReleaseFilePath(row!.id, "cd".repeat(32)), {
        method: "PUT",
        secret,
        body: endless,
      }),
    );
    expect(capped.status).toBe(413);
    expect(await capped.json()).toMatchObject({
      code: "quota-exceeded",
      limit: "releaseFileBytes",
      max,
      message: expect.stringContaining("assets/big.ogg"),
    });
    expect(pulled).toBeLessThanOrEqual(max / chunk.byteLength + 2);

    const declared = new Headers({
      authorization: `Bearer ${secret}`,
      "content-length": String(max + 1),
    });
    const early = await send(
      new Request(`${ORIGIN}${engineReleaseFilePath(row!.id, "cd".repeat(32))}`, {
        method: "PUT",
        headers: declared,
        body: new Uint8Array(1),
      }),
    );
    expect(early.status).toBe(413);
  });

  it("pass on paths they don't answer", async () => {
    expect(await routes(call(`/api/engine/projects/${PROJECT}/blobs`))).toBeNull();
    const hash = await sha256(new Uint8Array([1]));
    expect(await routes(call(`/api/engine/projects/${PROJECT}/blobs/${hash}`))).toBeNull();
  });
});
