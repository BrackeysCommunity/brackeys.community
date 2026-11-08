import type { ProjectUsage, QuotaPolicy } from "@jams/engine/project";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineAssetDocs, engineBlobs, sceneDocs } from "@/db/schema";
import type { TestDb } from "@/test/db";

import { checkQuota, storedProjectUsage, UNLIMITED_QUOTA } from "../quota";
import { fakeMinio } from "./fake-minio";
import { engineRoutes, PNG, PROJECT, seedEngine, upload } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("./fake-minio");
  return { getMinioClient: () => null, isMissingObject: isMissingObjectError };
});
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(sceneDocs);
  await db.delete(engineAssetDocs);
  await seedEngine(db);
});

/** At most `max` blob bytes per project. */
const blobBytesAtMost = (max: number) => {
  const seen: { usage: ProjectUsage; add: Partial<ProjectUsage> }[] = [];
  const policy: QuotaPolicy = {
    check(usage, add) {
      seen.push({ usage, add });
      const used = usage.blobBytes + (add.blobBytes ?? 0);
      return used <= max
        ? { ok: true }
        : {
            ok: false,
            limit: "blobBytes",
            used,
            max,
            message: `The project's files would take ${used} bytes; it has room for ${max}.`,
          };
    },
  };
  return { policy, seen };
};

describe("quota at blob upload", () => {
  it("reaches the client as quota-exceeded with the limit, used and max", async () => {
    const { policy } = blobBytesAtMost(PNG.byteLength + 3);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    expect((await routes(upload(PNG)))!.status).toBe(201);

    const response = (await routes(upload(new Uint8Array([1, 2, 3, 4]), { kind: "audio" })))!;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "quota-exceeded",
      limit: "blobBytes",
      used: PNG.byteLength + 4,
      max: PNG.byteLength + 3,
      issue: { code: "quota-exceeded", severity: "error" },
    });
    expect(body.message).toContain(String(PNG.byteLength + 3));
    expect(await db.select().from(engineBlobs)).toHaveLength(1);
  });

  it("asks the policy with what the project stores and what the upload adds", async () => {
    const { policy, seen } = blobBytesAtMost(1_000);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    await routes(upload(PNG));
    await routes(upload(new Uint8Array([9, 9]), { kind: "audio" }));
    expect(seen[1]).toEqual({
      usage: { docs: 0, docBytes: 0, blobs: 1, blobBytes: PNG.byteLength, trashBytes: 0 },
      add: { blobs: 1, blobBytes: 2 },
    });
  });

  it("isn't consulted for bytes the project already holds", async () => {
    const { policy, seen } = blobBytesAtMost(PNG.byteLength);
    const routes = engineRoutes(fakeMinio(), { quota: policy });
    await routes(upload(PNG));
    expect((await routes(upload(PNG)))!.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("is unlimited by default", async () => {
    const routes = engineRoutes(fakeMinio());
    expect((await routes(upload(PNG)))!.status).toBe(201);
    expect(UNLIMITED_QUOTA.check(await storedProjectUsage(PROJECT), { blobBytes: 1e12 })).toEqual({
      ok: true,
    });
  });
});

describe("storedProjectUsage", () => {
  it("counts the project's scene and asset docs and its blobs, and nobody else's", async () => {
    await db.insert(sceneDocs).values([
      { sceneId: `${PROJECT}.level-1`, projectId: PROJECT, byteSize: 100 },
      { sceneId: "other.level-1", byteSize: 999 },
    ]);
    await db.insert(engineAssetDocs).values({
      projectId: PROJECT,
      assetKey: "steel",
      kind: "material",
      byteSize: 20,
    });
    await db.insert(engineBlobs).values({
      projectId: PROJECT,
      sha256: "a".repeat(64),
      byteSize: 7,
      contentType: "image/png",
      storageKey: `engine-assets/${PROJECT}/${"a".repeat(64)}`,
    });
    expect(await storedProjectUsage(PROJECT)).toEqual({
      docs: 2,
      docBytes: 120,
      blobs: 1,
      blobBytes: 7,
      trashBytes: 0,
    });
  });
});

describe("checkQuota", () => {
  it("is null when the policy allows", () => {
    expect(checkQuota(UNLIMITED_QUOTA, emptyUsage, { blobs: 1 })).toBeNull();
  });

  it("carries the verdict's numbers and an issue", () => {
    const refusal = checkQuota(blobBytesAtMost(0).policy, emptyUsage, { blobBytes: 5 });
    expect(refusal).toMatchObject({
      code: "quota-exceeded",
      limit: "blobBytes",
      used: 5,
      max: 0,
      issue: { code: "quota-exceeded", got: "5" },
    });
  });
});

const emptyUsage: ProjectUsage = { docs: 0, docBytes: 0, blobs: 0, blobBytes: 0, trashBytes: 0 };
