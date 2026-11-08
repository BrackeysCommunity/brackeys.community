import { ENGINE_ASSET_KINDS, sha256, textureKind, type BlobKindDef } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineBlobs } from "@/db/schema";
import type { TestDb } from "@/test/db";

import { ENGINE_BLOB_KINDS, ENGINE_BLOB_UPLOADS_PER_DAY } from "../limits";
import { ENGINE_BLOB_CACHE_CONTROL } from "../routes";
import { fakeMinio } from "./fake-minio";
import { engineRoutes, PNG, PROJECT, read, seedEngine, upload } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("./fake-minio");
  return { getMinioClient: () => null, isMissingObject: isMissingObjectError };
});
const scans = vi.hoisted(() => ({ requested: [] as { key: string; uploader: string }[] }));
vi.mock("@/lib/media-scan", () => ({
  requestUploadScan: async (key: string, uploader: string) => {
    scans.requested.push({ key, uploader });
  },
}));
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-projects" && flags.enabled,
}));
const limiter = vi.hoisted(() => ({ hits: new Map<string, number>() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string, id: string, limit: number) => {
    const key = `${bucket}:${id}`;
    const count = (limiter.hits.get(key) ?? 0) + 1;
    limiter.hits.set(key, count);
    return count <= limit;
  },
}));

let db: TestDb;
let minio: ReturnType<typeof fakeMinio>;
let routes: ReturnType<typeof engineRoutes>;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await seedEngine(db);
  scans.requested.length = 0;
  flags.enabled = true;
  limiter.hits.clear();
  minio = fakeMinio();
  routes = engineRoutes(minio);
});

const bytes = (text: string) => new TextEncoder().encode(text);
const send = async (request: Request) => (await routes(request))!;

/** An upload whose body never ends, counting the chunks the route pulls. */
function endless(headers: Record<string, string> = {}) {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(16));
    },
  });
  const request = new Request(`https://site.test/api/engine/projects/${PROJECT}/blobs`, {
    method: "POST",
    headers: { "x-test-user": "staff", "x-asset-kind": "audio", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, pulls: () => pulls };
}

describe("blob upload: the hash", () => {
  it("hashes on the server and answers the hash and size", async () => {
    const response = await send(upload(PNG));
    expect(response.status).toBe(201);
    const hash = await sha256(PNG);
    expect(await response.json()).toEqual({ sha256: hash, bytes: PNG.byteLength });
    expect(minio.objects.has(`b/engine-assets/${PROJECT}/${hash}`)).toBe(true);
    const [row] = await db.select().from(engineBlobs).where(eq(engineBlobs.sha256, hash));
    expect(row).toMatchObject({
      projectId: PROJECT,
      byteSize: PNG.byteLength,
      contentType: "image/png",
      storageKey: `engine-assets/${PROJECT}/${hash}`,
      createdById: "staff",
    });
  });

  it("refuses bytes that don't match x-expect-sha256 with hash-mismatch, storing nothing", async () => {
    const claimed = await sha256("the bytes the client meant to send");
    const response = await send(upload(PNG, { expect: claimed }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "hash-mismatch",
      issue: { code: "hash-mismatch", expected: claimed, got: await sha256(PNG) },
    });
    expect(minio.objects.size).toBe(0);
    expect(await db.select().from(engineBlobs)).toHaveLength(0);
    expect(scans.requested).toHaveLength(0);
  });

  it("refuses a claim that isn't a hash at all", async () => {
    const response = await send(upload(PNG, { expect: "crate.png" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "hash-mismatch" });
  });

  it("accepts a matching claim", async () => {
    const response = await send(upload(PNG, { expect: await sha256(PNG) }));
    expect(response.status).toBe(201);
  });

  it("answers the same hash for bytes it already holds, without a second row", async () => {
    expect((await send(upload(PNG))).status).toBe(201);
    const again = await send(upload(PNG));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ sha256: await sha256(PNG), bytes: PNG.byteLength });
    expect(await db.select().from(engineBlobs)).toHaveLength(1);
  });
});

describe("blob upload: per-kind caps", () => {
  it("refuses bytes over the kind's maxBytes with asset-too-large", async () => {
    const big = new Uint8Array(65).fill(7);
    const response = await send(upload(big, { kind: "texture" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "asset-too-large",
      issue: { code: "asset-too-large", expected: "≤ 64" },
    });
    expect(minio.objects.size).toBe(0);
  });

  it("takes the cap from the lookup: the same bytes fit a kind that allows them", async () => {
    const big = new Uint8Array(65).fill(7);
    const response = await send(upload(big, { kind: "audio", type: "audio/ogg" }));
    expect(response.status).toBe(201);
  });

  it("refuses a kind the lookup doesn't know, and a missing kind", async () => {
    const unknown = await send(upload(PNG, { kind: "scene" }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: "asset-kind" });
    const missing = await send(upload(PNG, { kind: "" }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "asset-kind" });
  });

  it("refuses every kind a lookup refuses", async () => {
    routes = engineRoutes(minio, { kinds: () => undefined });
    expect((await send(upload(PNG))).status).toBe(400);
  });

  it("binds the site's lookup to the engine's blob kinds and their maxBytes", async () => {
    const blobKinds = ENGINE_ASSET_KINDS.filter(
      (def): def is BlobKindDef => def.storage === "blob",
    );
    expect(blobKinds.map((def) => def.kind).sort()).toEqual(
      ["atlas", "audio", "font", "recording", "texture"].sort(),
    );
    for (const def of blobKinds) {
      expect(ENGINE_BLOB_KINDS(def.kind), def.kind).toMatchObject({
        maxBytes: def.maxBytes,
        contentTypes: def.contentTypes,
      });
    }
    for (const def of ENGINE_ASSET_KINDS.filter((d) => d.storage !== "blob")) {
      expect(ENGINE_BLOB_KINDS(def.kind), def.kind).toBeUndefined();
    }

    routes = engineRoutes(minio, { kinds: ENGINE_BLOB_KINDS });
    expect((await send(upload(PNG))).status).toBe(201);
    const overCap = new Uint8Array(textureKind.maxBytes + 1);
    overCap.set(PNG);
    const refused = await send(upload(overCap));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ code: "asset-too-large" });
  });

  it("refuses an empty body", async () => {
    expect((await send(upload(new Uint8Array(0)))).status).toBe(400);
  });

  it("stores a type the kind names, and the kind's own type otherwise", async () => {
    await send(upload(bytes("webp-ish"), { type: "image/webp; charset=binary" }));
    await send(upload(bytes("not a page"), { type: "text/html" }));
    const types = (await db.select().from(engineBlobs)).map((r) => r.contentType).sort();
    expect(types).toEqual(["image/png", "image/webp"]);
  });
});

describe("blob upload: the rate limit", () => {
  it("allows a day's uploads, then answers 429", async () => {
    limiter.hits.set("engine-blob:staff", ENGINE_BLOB_UPLOADS_PER_DAY - 1);
    expect((await send(upload(PNG))).status).toBe(201);
    const over = await send(upload(bytes("one more")));
    expect(over.status).toBe(429);
    expect(minio.objects.size).toBe(1);
  });

  it("charges every upload it reads, refusals included", async () => {
    expect((await send(upload(PNG))).status).toBe(201);
    expect((await send(upload(PNG))).status).toBe(200);
    expect((await send(upload(new Uint8Array(0)))).status).toBe(400);
    const claimed = await sha256("the bytes the client meant to send");
    expect((await send(upload(bytes("other"), { expect: claimed }))).status).toBe(422);
    routes = engineRoutes(minio, {
      quota: { check: () => ({ ok: false, limit: "blobs", used: 2, max: 1, message: "Full." }) },
    });
    expect((await send(upload(bytes("no room")))).status).toBe(403);
    expect(limiter.hits.get("engine-blob:staff")).toBe(5);
  });

  it("doesn't charge a refusal it makes from the headers alone", async () => {
    expect((await send(upload(PNG, { kind: "scene" }))).status).toBe(400);
    const declared = upload(new Uint8Array(65).fill(7), { kind: "texture" });
    declared.headers.set("content-length", "65");
    expect((await send(declared)).status).toBe(413);
    expect(limiter.hits.get("engine-blob:staff")).toBeUndefined();
  });

  it("answers a re-upload of a held blob unread and uncharged, even when the day's uploads are spent", async () => {
    expect((await send(upload(PNG))).status).toBe(201);
    limiter.hits.set("engine-blob:staff", ENGINE_BLOB_UPLOADS_PER_DAY);
    const hash = await sha256(PNG);
    const again = endless({ "x-expect-sha256": hash });
    const response = await send(again.request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sha256: hash, bytes: PNG.byteLength });
    expect(again.pulls()).toBeLessThanOrEqual(1);
    expect(limiter.hits.get("engine-blob:staff")).toBe(ENGINE_BLOB_UPLOADS_PER_DAY);
    expect((await send(upload(PNG))).status).toBe(429);
    expect((await send(upload(bytes("new bytes")))).status).toBe(429);
  });

  it("refuses a spent member before reading the body", async () => {
    limiter.hits.set("engine-blob:staff", ENGINE_BLOB_UPLOADS_PER_DAY);
    const spent = endless();
    expect((await send(spent.request)).status).toBe(429);
    expect(spent.pulls()).toBeLessThanOrEqual(1);
  });

  it("reads a body whose length differs from the held blob's, and charges it", async () => {
    expect((await send(upload(PNG))).status).toBe(201);
    const hash = await sha256(PNG);
    const other = upload(bytes("not the png"), { expect: hash });
    other.headers.set("content-length", String("not the png".length));
    const response = await send(other);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "hash-mismatch" });
    expect(limiter.hits.get("engine-blob:staff")).toBe(2);
  });

  it("counts per member", async () => {
    limiter.hits.set("engine-blob:someone-else", ENGINE_BLOB_UPLOADS_PER_DAY);
    expect((await send(upload(PNG))).status).toBe(201);
  });
});

describe("blob upload: scanning", () => {
  it("requests a scan for an image, keyed by its object", async () => {
    await send(upload(PNG));
    expect(scans.requested).toEqual([
      { key: `engine-assets/${PROJECT}/${await sha256(PNG)}`, uploader: "staff" },
    ]);
  });

  it("scans image bytes stored under another type", async () => {
    await send(upload(PNG, { kind: "audio", type: "audio/ogg" }));
    expect(scans.requested).toHaveLength(1);
  });

  it("leaves other kinds unscanned", async () => {
    await send(upload(bytes("OggS…"), { kind: "audio", type: "audio/ogg" }));
    expect(scans.requested).toHaveLength(0);
  });
});

describe("blob upload: the gate", () => {
  it("refuses the signed-out, members, a missing project and the flag off", async () => {
    expect((await send(upload(PNG, { user: null }))).status).toBe(401);
    expect((await send(upload(PNG, { user: "member" }))).status).toBe(403);
    expect((await send(upload(PNG, { project: "nope" }))).status).toBe(404);
    flags.enabled = false;
    expect((await send(upload(PNG))).status).toBe(404);
    expect(minio.objects.size).toBe(0);
  });

  it("answers only POST on the collection", async () => {
    const response = await send(
      new Request(`https://site.test/api/engine/projects/${PROJECT}/blobs`, {
        headers: { "x-test-user": "staff" },
      }),
    );
    expect(response.status).toBe(405);
  });

  it("leaves other paths to the API", async () => {
    expect(await routes(new Request("https://site.test/api/engine/elsewhere"))).toBeNull();
  });
});

describe("blob read", () => {
  it("serves the bytes, immutable and private, never sniffed", async () => {
    await send(upload(PNG));
    const response = await send(read(await sha256(PNG)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(ENGINE_BLOB_CACHE_CONTROL);
    expect(ENGINE_BLOB_CACHE_CONTROL).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("checks access before anything else", async () => {
    await send(upload(PNG));
    const hash = await sha256(PNG);
    expect((await send(read(hash, { user: null }))).status).toBe(401);
    expect((await send(read(hash, { user: "member" }))).status).toBe(403);
    flags.enabled = false;
    expect((await send(read(hash))).status).toBe(404);
  });

  it("answers 404 for a hash the project doesn't hold", async () => {
    await send(upload(PNG));
    expect((await send(read(await sha256("absent")))).status).toBe(404);
    expect((await send(read("not-a-hash"))).status).toBe(404);
  });
});
