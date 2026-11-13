import {
  developerProfiles,
  engineAgentTokens,
  engineBlobs,
  engineProjects,
  user,
} from "@/db/schema";
import type { DeployEnv } from "@/lib/deploy-env";
import { seedUser, type TestDb } from "@/test/db";

import { createAgentToken } from "../agent-token";
import { minioContentStore } from "../content-store";
import { createEngineRoutes, type EngineRouteDeps } from "../routes";
import { blobKindLookup, type BlobKindLimits } from "../upload-limits";
import type { fakeMinio } from "./fake-minio";

export const PROJECT = "kitchen";
export const ORIGIN = "https://site.test";

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

/** A session for the user the `x-test-user` header names, and none without it. */
export const testReadSession = async (request: Request) => {
  const id = request.headers.get("x-test-user");
  return id ? { user: { id } } : null;
};

/**
 * The games gate's inputs for a suite's `@/lib/deploy-env` and
 * `@/lib/posthog-server` mocks, open by default. Each suite hoists one with
 * `await vi.hoisted(async () => (await import("./harness")).gamesGate())`
 * after its other mocks and calls `reset()` before each test.
 */
export function gamesGate() {
  const gate = {
    env: "staging" as DeployEnv,
    flag: true,
    reset() {
      gate.env = "staging";
      gate.flag = true;
    },
    deployEnv: () => gate.env,
    isServerFlagEnabled: async (flag: string) =>
      flag === "engine-projects" || (flag === "engine-games-enabled" && gate.flag),
  };
  return gate;
}

/** The engine routes over a fake bucket, signed in by the `x-test-user` header. */
export function engineRoutes(
  minio: ReturnType<typeof fakeMinio>,
  overrides: Partial<EngineRouteDeps> = {},
) {
  return createEngineRoutes({
    readSession: testReadSession,
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
  return new Request(`${ORIGIN}/api/engine/projects/${opts.project ?? PROJECT}/blobs`, {
    method: "POST",
    headers,
    body: new Uint8Array(bytes),
  });
}

export function read(hash: string, opts: { user?: string | null; project?: string } = {}): Request {
  const headers = new Headers();
  if (opts.user !== null) headers.set("x-test-user", opts.user ?? "staff");
  return new Request(`${ORIGIN}/api/engine/projects/${opts.project ?? PROJECT}/blobs/${hash}`, {
    headers,
  });
}

/**
 * A request to `path` signed by an agent token's `secret` or as the `user`
 * session; `json` is sent as a JSON body, `body` as it is (a stream too).
 * Without a `method`, a body makes it a POST and none a GET.
 */
export function call(
  path: string,
  opts: { method?: string; secret?: string; user?: string; json?: unknown; body?: BodyInit } = {},
): Request {
  const headers = new Headers();
  if (opts.secret) headers.set("authorization", `Bearer ${opts.secret}`);
  if (opts.user) headers.set("x-test-user", opts.user);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.json);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    ...(body !== undefined ? { body, duplex: "half" } : {}),
  } as RequestInit);
}

/** A fresh agent token's secret for `projectId`, created by staff. */
export const secretFor = async (projectId: string, access: "read" | "write" = "write") =>
  (await createAgentToken({ projectId, createdById: "staff", access, label: "ci", ttlHours: 1 }))
    .secret;

type RouteHandler = (request: Request) => Promise<Response | null>;

/** Sends to the handler `routes()` returns now, failing when no route answers. */
export const sendTo =
  (routes: () => RouteHandler) =>
  async (request: Request): Promise<Response> => {
    const response = await routes()(request);
    if (!response) throw new Error(`no route answered ${request.method} ${request.url}`);
    return response;
  };

/** A 1×1 PNG's signature and IHDR: enough for the header readers. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);
