import {
  ContentStoreError,
  hashForPut,
  isSha256,
  readGifSize,
  readJpegSize,
  readPngSize,
  readWebpSize,
  type QuotaPolicy,
} from "@jams/engine/project";
import { makeIssue, type SceneIssue } from "@jams/engine/scene";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { engineBlobs, engineProjects } from "@/db/schema";
import type { SyncAccess } from "@/lib/canvas/token";
import { isAllowedProfileProjectImageType } from "@/lib/image-upload-policy";
import { requestUploadScan } from "@/lib/media-scan";
import { bestEffort } from "@/lib/posthog-server";

import { exchangeAgentToken, type AgentExchangeRefusal } from "./agent-token";
import { minioContentStore, type SiteContentStore } from "./content-store";
import {
  createHostedProject,
  readHostedProjectWire,
  type CreateHostedProjectInput,
} from "./hosted";
import { checkQuota, ENGINE_QUOTA, quotaExceededResponse } from "./quota";
import {
  bearer,
  decodeSegment,
  gateEngineRequest,
  methodNotAllowed,
  parseJson,
  readBody,
  type GateRefusal,
  type ReadSession,
} from "./route-gate";
import { AGENT_SYNC_TOKEN_PATH, BLOBS_PATH, BUNDLE_PATH } from "./route-paths";
import {
  agentSyncTokenAllowed,
  ENGINE_BLOB_MAX_BYTES,
  ENGINE_BUNDLE_MAX_BYTES,
  engineBlobUploadAllowed,
  type BlobKindLookup,
} from "./upload-limits";
import { storedProjectUsage } from "./usage";

/** Blobs never change under their hash; only the project's members may cache them. */
export const ENGINE_BLOB_CACHE_CONTROL = "private, max-age=31536000, immutable";

export type EngineRouteDeps = {
  readSession: ReadSession;
  kinds: BlobKindLookup;
  quota?: QuotaPolicy;
  store?: (projectId: string) => SiteContentStore;
  /** Streams a stored object with the given cache-control (etag, 304 and HEAD included). */
  serve: (objectKey: string, request: Request, opts: { cacheControl: string }) => Promise<Response>;
};

const refuse = (status: number, message: string) => Response.json({ message }, { status });

const refuseIssue = (status: number, issue: SceneIssue) =>
  Response.json({ code: issue.code, message: issue.message, issue }, { status });

const NOT_FOUND = () => refuse(404, "Not found.");

/**
 * The engine's HTTP routes under `/api/engine/`: blob upload and read, and
 * bundle read and seed, for a hosted project; and the agent token exchange.
 * Each takes a staff session behind the `engine-projects` flag, as the
 * procedures do, or a bearer agent token for its own project, so the CLI
 * can push, pull and import. Null for any other path.
 */
export function createEngineRoutes(deps: EngineRouteDeps) {
  const store = deps.store ?? ((projectId: string) => minioContentStore(projectId));
  const quota = deps.quota ?? ENGINE_QUOTA;

  /** `gateEngineRequest`'s refusal answered as `{ message }`. */
  async function gate(
    request: Request,
    projectId: string,
    need: SyncAccess,
    live = true,
  ): Promise<{ refusal: Response } | { userId: string }> {
    const gated = await gateEngineRequest(request, projectId, need, {
      readSession: deps.readSession,
      live,
    });
    if (!gated.ok) return { refusal: gateRefusal(gated.refusal) };
    return { userId: gated.actor.userId };
  }

  async function uploadBlob(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if ("refusal" in gated) return gated.refusal;
    const { userId } = gated;

    const kindName = request.headers.get("x-asset-kind") ?? "";
    const kind = deps.kinds(kindName);
    if (!kind) {
      return refuseIssue(
        400,
        makeIssue("asset-kind", {
          message: kindName
            ? `"${kindName}" isn't a blob kind this site stores.`
            : "Name the blob's asset kind in the x-asset-kind header.",
          got: kindName,
        }),
      );
    }
    const maxBytes = Math.min(kind.maxBytes, ENGINE_BLOB_MAX_BYTES);
    const tooLarge = () =>
      refuseIssue(
        413,
        makeIssue("asset-too-large", {
          message: `A ${kind.kind} asset is at most ${maxBytes} bytes.`,
          expected: `≤ ${maxBytes}`,
        }),
      );
    const length = request.headers.get("content-length");
    const declared = Number(length);
    if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

    // Re-uploading a blob the project already holds isn't charged against the
    // day's uploads when its bytes hash to it; any other outcome of reading the
    // body is charged like any upload.
    const expect = request.headers.get("x-expect-sha256") ?? undefined;
    const heldRow =
      expect !== undefined && isSha256(expect) ? await blobRow(projectId, expect) : null;
    const spent = () => refuse(429, "Too many uploads today — try again tomorrow.");
    if (!heldRow && !(await engineBlobUploadAllowed(userId))) return spent();
    const chargeHeld = async (refusal: Response) =>
      heldRow && !(await engineBlobUploadAllowed(userId)) ? spent() : refusal;

    const bytes = await readBody(request, maxBytes);
    if (bytes === "too-large") return chargeHeld(tooLarge());
    if (bytes.byteLength === 0) return chargeHeld(refuse(400, "The upload is empty."));

    let hash: string;
    try {
      hash = await hashForPut(bytes, expect);
    } catch (error) {
      if (!(error instanceof ContentStoreError)) throw error;
      return chargeHeld(refuseIssue(422, error.issue));
    }

    const reply = (status: number) =>
      Response.json({ sha256: hash, bytes: bytes.byteLength }, { status });
    if ((heldRow ?? (await blobRow(projectId, hash))) && (await touchHeldBlob(projectId, hash)))
      return reply(200);

    const refusal = checkQuota(quota, await storedProjectUsage(projectId), {
      blobs: 1,
      blobBytes: bytes.byteLength,
    });
    if (refusal) return quotaExceededResponse(refusal);

    const contentType = storedContentType(request.headers.get("content-type"), kind.contentTypes);
    const projectStore = store(projectId);
    await projectStore.put(bytes, hash, { contentType });
    const storageKey = projectStore.keyOf(hash);
    await db
      .insert(engineBlobs)
      .values({
        projectId,
        sha256: hash,
        byteSize: bytes.byteLength,
        contentType,
        storageKey,
        createdById: userId,
      })
      .onConflictDoNothing();

    // The scan worker reads images only: other blob kinds are stored unscanned.
    if (isScannableImage(contentType, bytes)) {
      await bestEffort("media_scan.request", { object_key: storageKey }, () =>
        requestUploadScan(storageKey, userId),
      );
    }
    return reply(201);
  }

  async function readBlob(request: Request, projectId: string, hash: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if ("refusal" in gated) return gated.refusal;
    if (!isSha256(hash)) return NOT_FOUND();
    const row = await blobRow(projectId, hash);
    if (!row) return NOT_FOUND();
    const response = await deps.serve(row.storageKey, request, {
      cacheControl: ENGINE_BLOB_CACHE_CONTROL,
    });
    // Blobs are whatever a project imported: never sniffed or rendered as a page of this origin.
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("content-security-policy", "default-src 'none'; sandbox");
    return response;
  }

  async function agentSyncToken(request: Request): Promise<Response> {
    const secret = bearer(request);
    if (!secret) {
      return Response.json(
        { message: "Send the agent token as a bearer token." },
        { status: 401, headers: { "www-authenticate": "Bearer" } },
      );
    }
    const body = agentExchangeBody.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return refuse(400, "Send { formatVersion, layoutVersion } as JSON.");
    }
    const exchanged = await exchangeAgentToken(secret, body.data, {
      allowed: agentSyncTokenAllowed,
    });
    if (!exchanged.ok) return agentRefusal(exchanged);
    const { ok: _ok, ...grant } = exchanged;
    return Response.json(grant, { headers: { "cache-control": "no-store" } });
  }

  async function readBundle(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if ("refusal" in gated) return gated.refusal;
    const wire = await readHostedProjectWire(projectId);
    if (!wire) return NOT_FOUND();
    return Response.json(wire, { headers: { "cache-control": "no-store" } });
  }

  async function seedBundle(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "write", false);
    if ("refusal" in gated) return gated.refusal;
    const raw = await readBody(request, ENGINE_BUNDLE_MAX_BYTES);
    if (raw === "too-large") {
      return refuse(413, `A project bundle is at most ${ENGINE_BUNDLE_MAX_BYTES} bytes.`);
    }
    const body = seedBody.safeParse(parseJson(raw));
    if (!body.success) return refuse(400, "Send { bundle, game?, code? } as JSON.");
    if (bundleProjectId(body.data.bundle) !== projectId) {
      return refuse(400, `The bundle's project id isn't ${projectId}.`);
    }
    const result = await createHostedProject({
      bundle: body.data.bundle,
      game: body.data.game,
      code: body.data.code as CreateHostedProjectInput["code"],
      createdById: gated.userId,
      store,
      quota,
    });
    if (result.ok) {
      return Response.json(
        { projectId: result.projectId, docs: result.docs, warnings: result.warnings },
        { status: 201 },
      );
    }
    if (result.reason === "exists") return refuse(409, `Project ${projectId} already exists.`);
    if (result.reason === "quota-exceeded") return quotaExceededResponse(result.refusal);
    return Response.json(
      { message: "The bundle can't be hosted as it is.", problems: result.problems },
      { status: 400 },
    );
  }

  return async function handleEngineRoute(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (pathname === AGENT_SYNC_TOKEN_PATH) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return agentSyncToken(request);
    }
    const bundleMatch = BUNDLE_PATH.exec(pathname);
    if (bundleMatch) {
      const projectId = decodeSegment(bundleMatch[1] ?? "");
      if (projectId === null) return NOT_FOUND();
      if (request.method === "GET") return readBundle(request, projectId);
      if (request.method === "POST") return seedBundle(request, projectId);
      return methodNotAllowed("GET, POST");
    }
    const match = BLOBS_PATH.exec(pathname);
    if (!match) return null;
    const projectId = decodeSegment(match[1] ?? "");
    if (projectId === null) return NOT_FOUND();
    const hash = match[2];
    if (hash === undefined) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return uploadBlob(request, projectId);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
    return readBlob(request, projectId, hash);
  };
}

const agentExchangeBody = z.object({
  formatVersion: z.number().int().min(1),
  layoutVersion: z.number().int().min(1),
});

const seedBody = z.object({
  bundle: z.unknown(),
  game: z.string().nullable().optional(),
  code: z.record(z.string(), z.unknown()).optional(),
});

function bundleProjectId(bundle: unknown): unknown {
  const project = (bundle as { project?: unknown } | null)?.project;
  return (project as { id?: unknown } | null | undefined)?.id;
}

const gateRefusal = ({ status, message, headers }: GateRefusal) =>
  Response.json({ message }, { status, headers: headers ?? {} });

function agentRefusal(refusal: AgentExchangeRefusal): Response {
  return Response.json(
    { message: refusal.message },
    {
      status: refusal.status,
      headers: refusal.status === 401 ? { "www-authenticate": "Bearer" } : {},
    },
  );
}

/**
 * Restarts a held blob's grace, under the project's row lock, the one the
 * collector removes blobs under: an uploader who finds the blob held goes on
 * to reference it, so the collector must not take it once it has answered.
 * False when the collector removed it first, and the upload stores it again.
 */
async function touchHeldBlob(projectId: string, hash: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ projectId: engineProjects.projectId })
      .from(engineProjects)
      .where(eq(engineProjects.projectId, projectId))
      .for("update");
    const touched = await tx
      .update(engineBlobs)
      .set({ lastReferencedAt: new Date() })
      .where(and(eq(engineBlobs.projectId, projectId), eq(engineBlobs.sha256, hash)))
      .returning({ sha256: engineBlobs.sha256 });
    return touched.length > 0;
  });
}

async function blobRow(projectId: string, hash: string) {
  const [row] = await db
    .select({ storageKey: engineBlobs.storageKey, byteSize: engineBlobs.byteSize })
    .from(engineBlobs)
    .where(and(eq(engineBlobs.projectId, projectId), eq(engineBlobs.sha256, hash)));
  return row ?? null;
}

/** The request's type when the kind accepts it, else the kind's first: a blob is never stored as a type its kind doesn't name. */
function storedContentType(header: string | null, accepted: readonly string[]): string {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  if (type && accepted.includes(type)) return type;
  return accepted[0] ?? "application/octet-stream";
}

/** An image the scan worker can read, by its stored type or by its header bytes. */
function isScannableImage(contentType: string, bytes: Uint8Array): boolean {
  return (
    isAllowedProfileProjectImageType(contentType) ||
    readPngSize(bytes) !== null ||
    readJpegSize(bytes) !== null ||
    readWebpSize(bytes) !== null ||
    readGifSize(bytes) !== null
  );
}
