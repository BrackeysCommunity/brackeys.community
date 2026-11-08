import { formatAssetDoc, materialKind, sha256, type ProjectBundle } from "@jams/engine/project";
import { createRegistry, createScene, formatScene } from "@jams/engine/scene";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineAssetDocs, engineBlobs, engineProjects, sceneDocs } from "@/db/schema";
import { base64ToBytes } from "@/lib/canvas/encoding";
import { readProjectState } from "@/lib/scene/project-bytes";
import type { TestDb } from "@/test/db";

import { createAgentToken } from "../agent-token";
import { reserveHostedProject } from "../bundle";
import type { HostedProjectWire } from "../hosted";
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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const FRESH = "crates";
const SCENE = formatScene(createScene("yard", createRegistry(null))).text;
const RUBBER = formatAssetDoc(materialKind, {
  kind: "material",
  v: 1,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
});

const bundleFor = (projectId: string, blobs: Record<string, string> = {}): ProjectBundle => ({
  project: { kind: "project", v: 1, id: projectId, name: "Crates", game: null, code: [] },
  texts: { "scenes/yard.json": SCENE, "materials/rubber.json": RUBBER },
  blobs,
  sidecars: {},
});

let db: TestDb;
let minio: ReturnType<typeof fakeMinio>;
let routes: ReturnType<typeof engineRoutes>;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(sceneDocs);
  await seedEngine(db);
  scans.requested.length = 0;
  flags.enabled = true;
  minio = fakeMinio();
  routes = engineRoutes(minio);
});

const send = async (request: Request) => (await routes(request))!;

const asAgent = (request: Request, secret: string) => {
  const headers = new Headers(request.headers);
  headers.delete("x-test-user");
  headers.set("authorization", `Bearer ${secret}`);
  return new Request(request, { headers });
};

const agentSecret = async (projectId: string, access: "read" | "write" = "write") =>
  (await createAgentToken({ projectId, createdById: "staff", access, label: "agent", ttlHours: 1 }))
    .secret;

const bundleUrl = (projectId: string) =>
  `https://site.test/api/engine/projects/${projectId}/bundle`;

const seedRequest = (projectId: string, body: unknown, user: string | null = "staff") => {
  const headers = new Headers({ "content-type": "application/json" });
  if (user) headers.set("x-test-user", user);
  return new Request(bundleUrl(projectId), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const bundleRequest = (projectId: string, user: string | null = "staff") =>
  new Request(bundleUrl(projectId), { headers: user ? { "x-test-user": user } : {} });

describe("blob routes with an agent token", () => {
  it("upload as the token's creator, and read back", async () => {
    const secret = await agentSecret(PROJECT);
    const uploaded = await send(asAgent(upload(PNG), secret));
    expect(uploaded.status).toBe(201);
    const { sha256: hash } = (await uploaded.json()) as { sha256: string };
    const [row] = await db.select().from(engineBlobs).where(eq(engineBlobs.sha256, hash));
    expect(row).toMatchObject({ projectId: PROJECT, createdById: "staff" });
    expect(scans.requested).toEqual([{ key: row!.storageKey, uploader: "staff" }]);

    const served = await send(asAgent(read(hash), secret));
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });

  it("refuse an upload on a read-only token, but serve reads", async () => {
    const hash = await sha256(PNG);
    expect((await send(upload(PNG))).status).toBe(201);
    const secret = await agentSecret(PROJECT, "read");
    expect((await send(asAgent(upload(PNG), secret))).status).toBe(403);
    expect((await send(asAgent(read(hash), secret))).status).toBe(200);
  });

  it("refuse another project's token, an unknown one and a deleted project's", async () => {
    await db.insert(engineProjects).values({ projectId: "other", name: "Other" });
    const other = await agentSecret("other");
    expect((await send(asAgent(upload(PNG), other))).status).toBe(403);
    const unknown = await send(asAgent(upload(PNG), "jat_nope"));
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toBe("Bearer");

    const secret = await agentSecret(PROJECT);
    await db.update(engineProjects).set({ deletedAt: new Date() });
    expect((await send(asAgent(upload(PNG), secret))).status).toBe(404);
  });

  it("refuse a token whose creator lost the flag", async () => {
    const secret = await agentSecret(PROJECT);
    flags.enabled = false;
    expect((await send(asAgent(upload(PNG), secret))).status).toBe(404);
  });
});

describe("bundle routes", () => {
  it("push: reserve, upload the blob, seed; then pull the docs and the hash", async () => {
    expect(await reserveHostedProject({ projectId: FRESH, name: "Crates" })).toEqual({ ok: true });
    const uploaded = await send(upload(PNG, { project: FRESH }));
    const { sha256: hash } = (await uploaded.json()) as { sha256: string };

    const seeded = await send(
      seedRequest(FRESH, { bundle: bundleFor(FRESH, { "art/crate.png": hash }) }),
    );
    expect(seeded.status).toBe(201);
    expect(await seeded.json()).toMatchObject({ projectId: FRESH, docs: 2, warnings: [] });

    const pulled = await send(bundleRequest(FRESH));
    expect(pulled.status).toBe(200);
    expect(pulled.headers.get("cache-control")).toBe("no-store");
    const wire = (await pulled.json()) as HostedProjectWire;
    expect(wire.docs.map((d) => [d.prefix, d.key, d.kind, d.state, d.seed])).toEqual([
      ["scene", "yard", "scene", null, SCENE],
      ["asset", "rubber", "material", null, RUBBER],
    ]);
    expect(wire.blobs).toEqual([{ sha256: hash, bytes: PNG.byteLength, contentType: "image/png" }]);
    const registry = readProjectState(base64ToBytes(wire.project));
    expect(registry.assets.crate).toMatchObject({ kind: "texture", sha256: hash });
  });

  it("seed through an agent token on a reserved project", async () => {
    expect(await reserveHostedProject({ projectId: FRESH, name: "Crates" })).toEqual({ ok: true });
    const secret = await agentSecret(FRESH);
    const seeded = await send(asAgent(seedRequest(FRESH, { bundle: bundleFor(FRESH) }), secret));
    expect(seeded.status).toBe(201);
    const [row] = await db.select().from(engineProjects).where(eq(engineProjects.projectId, FRESH));
    expect(row!.state).not.toBeNull();

    const pulled = await send(asAgent(bundleRequest(FRESH), await agentSecret(FRESH, "read")));
    expect(pulled.status).toBe(200);
    const readOnly = await agentSecret(FRESH, "read");
    expect(
      (await send(asAgent(seedRequest(FRESH, { bundle: bundleFor(FRESH) }), readOnly))).status,
    ).toBe(403);
  });

  it("refuse an existing project, a bundle for another id and a bad bundle", async () => {
    expect((await send(seedRequest(FRESH, { bundle: bundleFor(FRESH) }))).status).toBe(201);
    expect((await send(seedRequest(FRESH, { bundle: bundleFor(FRESH) }))).status).toBe(409);
    expect((await send(seedRequest("elsewhere", { bundle: bundleFor(FRESH) }))).status).toBe(400);

    const bad = await send(
      seedRequest("broken", {
        bundle: { ...bundleFor("broken"), texts: { "scenes/x.json": "{" } },
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      problems: [expect.objectContaining({ path: "scenes/x.json" })],
    });
    expect(
      await db.select().from(engineAssetDocs).where(eq(engineAssetDocs.projectId, "broken")),
    ).toEqual([]);
  });

  it("refuse a bundle whose blob isn't uploaded with hash-mismatch", async () => {
    await reserveHostedProject({ projectId: FRESH, name: "Crates" });
    const missing = await send(
      seedRequest(FRESH, { bundle: bundleFor(FRESH, { "art/crate.png": await sha256(PNG) }) }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      problems: [
        { path: "art/crate.png", issues: [expect.objectContaining({ code: "hash-mismatch" })] },
      ],
    });
  });

  it("are behind the same gate as the procedures", async () => {
    expect((await send(bundleRequest(PROJECT, null))).status).toBe(401);
    expect((await send(bundleRequest(PROJECT, "member"))).status).toBe(403);
    expect((await send(seedRequest(FRESH, { bundle: bundleFor(FRESH) }, "member"))).status).toBe(
      403,
    );
    expect((await send(bundleRequest("nope"))).status).toBe(404);
    flags.enabled = false;
    expect((await send(bundleRequest(PROJECT))).status).toBe(404);
    expect((await send(seedRequest(FRESH, { bundle: bundleFor(FRESH) }))).status).toBe(404);
    const put = new Request(bundleUrl(PROJECT), {
      method: "PUT",
      headers: { "x-test-user": "staff" },
    });
    expect((await send(put)).status).toBe(405);
  });

  it("answer 404 for a project id whose percent-escapes are malformed", async () => {
    const bad = "%E0%A4%A";
    expect((await send(bundleRequest(bad))).status).toBe(404);
    const blobs = `https://site.test/api/engine/projects/${bad}/blobs`;
    const post = new Request(blobs, {
      method: "POST",
      headers: { "x-test-user": "staff", "x-asset-kind": "texture" },
      body: PNG,
    });
    expect((await send(post)).status).toBe(404);
    expect((await send(new Request(`${blobs}/${"0".repeat(64)}`))).status).toBe(404);
  });
});
