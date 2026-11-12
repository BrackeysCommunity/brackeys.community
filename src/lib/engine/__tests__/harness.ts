import {
  developerProfiles,
  engineAgentTokens,
  engineBlobs,
  engineProjects,
  user,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { minioContentStore } from "../content-store";
import { createEngineRoutes, type EngineRouteDeps } from "../routes";
import { blobKindLookup, type BlobKindLimits } from "../upload-limits";
import type { fakeMinio } from "./fake-minio";

export const PROJECT = "kitchen";

/** Two blob kinds with small caps, standing in for the engine's. */
export const TEST_KINDS: readonly (BlobKindLimits & { storage: "blob" })[] = [
  { kind: "texture", storage: "blob", maxBytes: 64, contentTypes: ["image/png", "image/webp"] },
  { kind: "audio", storage: "blob", maxBytes: 256, contentTypes: ["audio/ogg"] },
];

/** A member, a staff user and a live project; every earlier row gone. */
export async function seedEngine(db: TestDb): Promise<void> {
  await db.delete(engineAgentTokens);
  await db.delete(engineBlobs);
  await db.delete(engineProjects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "member");
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
}

/** The engine routes over a fake bucket, signed in by the `x-test-user` header. */
export function engineRoutes(
  minio: ReturnType<typeof fakeMinio>,
  overrides: Partial<EngineRouteDeps> = {},
) {
  return createEngineRoutes({
    readSession: async (request) => {
      const id = request.headers.get("x-test-user");
      return id ? { user: { id } } : null;
    },
    kinds: blobKindLookup(TEST_KINDS),
    store: (projectId) => minioContentStore(projectId, { client: minio.client, bucket: "b" }),
    serve: async (objectKey, _request, { cacheControl }) => {
      const object = minio.objects.get(`b/${objectKey}`);
      if (!object) return new Response("Not Found", { status: 404 });
      return new Response(new Uint8Array(object.body), {
        headers: {
          "cache-control": cacheControl,
          "content-type": object.meta["Content-Type"] ?? "",
        },
      });
    },
    ...overrides,
  });
}

export function upload(
  bytes: Uint8Array,
  opts: {
    user?: string | null;
    kind?: string;
    expect?: string;
    type?: string;
    project?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (opts.user !== null) headers.set("x-test-user", opts.user ?? "staff");
  if (opts.kind !== "") headers.set("x-asset-kind", opts.kind ?? "texture");
  if (opts.expect) headers.set("x-expect-sha256", opts.expect);
  headers.set("content-type", opts.type ?? "image/png");
  return new Request(`https://site.test/api/engine/projects/${opts.project ?? PROJECT}/blobs`, {
    method: "POST",
    headers,
    body: new Uint8Array(bytes),
  });
}

export function read(hash: string, opts: { user?: string | null; project?: string } = {}): Request {
  const headers = new Headers();
  if (opts.user !== null) headers.set("x-test-user", opts.user ?? "staff");
  return new Request(
    `https://site.test/api/engine/projects/${opts.project ?? PROJECT}/blobs/${hash}`,
    { headers },
  );
}

/** A 1×1 PNG's signature and IHDR: enough for the header readers. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
