import { isSha256 } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { engineReleases, engineReleaseUploads } from "@/db/schema";
import { siteUrl } from "@/env";
import type { SyncAccess } from "@/lib/canvas/token";

import { PROJECT_QUOTA, RELEASE_MANIFEST_MAX_BYTES } from "./limits";
import { quotaWords } from "./quota";
import { canDo, type GameAction } from "./release-access";
import { listReleases, promote, rollback, type ReleaseChannel } from "./release-channels";
import {
  apiErrorResponse,
  releaseForbidden,
  ReleaseError,
  type ReleaseApiError,
} from "./release-errors";
import { minioReleaseStore } from "./release-storage";
import { beginRelease, commitRelease, putReleaseFile, type ReleaseDeps } from "./release-upload";
import { releaseZipResponse } from "./release-zip";
import {
  decodeSegment,
  gateEngineRequest,
  methodNotAllowed,
  parseJson,
  readBody,
  type Gated,
  type ReadSession,
} from "./route-gate";
import {
  RELEASE_COMMIT_PATH,
  RELEASE_FILE_PATH,
  RELEASE_MOVE_PATH,
  RELEASE_ROLLBACK_PATH,
  RELEASE_ZIP_PATH,
  RELEASES_PATH,
} from "./route-paths";

export type ReleaseRouteDeps = {
  readSession: ReadSession;
  /** The upload protocol's store, clock and scan; default the site's bucket and queue. */
  release?: Partial<ReleaseDeps>;
};

/** Room for a 1 MiB manifest escaped inside a JSON string, and the rest of the body. */
const BEGIN_BODY_MAX_BYTES = 4 * RELEASE_MANIFEST_MAX_BYTES;
const SMALL_BODY_MAX_BYTES = 4_096;

const beginBody = z.object({
  manifest: z.string().max(RELEASE_MANIFEST_MAX_BYTES),
  channel: z.enum(["preview", "none"]).default("preview"),
});
const commitBody = z.object({ uploadId: z.string().min(1).max(64) });
const moveBody = z.object({ channel: z.enum(["preview", "production"]) });

const NOT_FOUND: ReleaseApiError = { code: "not-found", message: "Not found." };

const badBody = (message: string, status = 400) =>
  apiErrorResponse({ code: "schema", message }, status);

/** The gate's refusal as the release API's error body: `not-found` for a 404, else `release-forbidden`. */
function gateResponse(gated: Extract<Gated, { ok: false }>): Response {
  const { status, message, headers } = gated.refusal;
  const code = status === 404 ? "not-found" : "release-forbidden";
  const response = apiErrorResponse({ code, message }, status);
  for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
  return response;
}

/** Runs one lib call, its refusals answered as their JSON body and status. */
async function answer(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReleaseError) return apiErrorResponse(error);
    throw error;
  }
}

/**
 * The release routes under `/api/engine/`: begin, the file `PUT`, commit,
 * the list, promote and rollback, and the zip, for a staff session or an
 * agent token of the project, both behind `engine-games-enabled` and the
 * production guard as well as `engine-projects`. Each is a transport over
 * one lib call, which owns the rules; refusals are the release API's JSON
 * error. Null for any other path.
 */
export function createReleaseRoutes(
  deps: ReleaseRouteDeps,
): (request: Request) => Promise<Response | null> {
  const releaseDeps = (): ReleaseDeps => ({
    ...deps.release,
    store: deps.release?.store ?? minioReleaseStore,
  });

  const gate = (request: Request, projectId: string, need: SyncAccess) =>
    gateEngineRequest(request, projectId, need, { readSession: deps.readSession, games: true });

  async function jsonBody<T>(
    request: Request,
    max: number,
    schema: z.ZodType<T>,
    shape: string,
  ): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
    const raw = await readBody(request, max);
    if (raw === "too-large") return { ok: false, response: badBody(`Send ${shape} as JSON.`, 413) };
    const parsed = schema.safeParse(parseJson(raw));
    if (!parsed.success) return { ok: false, response: badBody(`Send ${shape} as JSON.`) };
    return { ok: true, body: parsed.data };
  }

  async function begin(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const body = await jsonBody(
      request,
      BEGIN_BODY_MAX_BYTES,
      beginBody,
      '{ manifest, channel?: "preview" | "none" }',
    );
    if (!body.ok) return body.response;
    return answer(async () =>
      Response.json(
        await beginRelease(releaseDeps(), { projectId, ...body.body, actor: gated.actor }),
        { headers: { "cache-control": "no-store" } },
      ),
    );
  }

  async function list(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if (!gated.ok) return gateResponse(gated);
    return answer(async () =>
      Response.json(
        { releases: await listReleases({ projectId, actor: gated.actor }) },
        { headers: { "cache-control": "no-store" } },
      ),
    );
  }

  /** The upload's project and missing files, for the gate and the byte cap; null for an unknown id. */
  async function uploadOf(uploadId: string) {
    const [row] = await db
      .select({ projectId: engineReleaseUploads.projectId, missing: engineReleaseUploads.missing })
      .from(engineReleaseUploads)
      .where(eq(engineReleaseUploads.id, uploadId));
    return row ?? null;
  }

  const unknownUpload = () =>
    apiErrorResponse({ code: "not-found", message: "There is no upload with this id." }, 404);

  async function commit(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const body = await jsonBody(request, SMALL_BODY_MAX_BYTES, commitBody, "{ uploadId }");
    if (!body.ok) return body.response;
    const upload = await uploadOf(body.body.uploadId);
    if (upload?.projectId !== projectId) return unknownUpload();
    return answer(async () => {
      const result = await commitRelease(releaseDeps(), {
        uploadId: body.body.uploadId,
        actor: gated.actor,
      });
      return Response.json(result, { status: result.created ? 201 : 200 });
    });
  }

  async function putFile(request: Request, uploadId: string, hash: string): Promise<Response> {
    const upload = await uploadOf(uploadId);
    if (!upload) return unknownUpload();
    const gated = await gate(request, upload.projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    if (!isSha256(hash)) return apiErrorResponse(NOT_FOUND, 404);

    const max = PROJECT_QUOTA.releaseFileBytes;
    const path = upload.missing.find((file) => file.sha256 === hash)?.path ?? hash;
    const declared = Number(request.headers.get("content-length"));
    const tooLarge = (used: number) =>
      apiErrorResponse(
        {
          code: "quota-exceeded",
          limit: "releaseFileBytes",
          used,
          max,
          ...quotaWords({ limit: "releaseFileBytes", used, max, path }),
        },
        413,
      );
    if (Number.isFinite(declared) && declared > max) return tooLarge(declared);
    const body = await readBody(request, max);
    if (body === "too-large") return tooLarge(max + 1);

    return answer(async () => {
      await putReleaseFile(releaseDeps(), { uploadId, sha256: hash, body, actor: gated.actor });
      return new Response(null, { status: 204 });
    });
  }

  async function move(
    request: Request,
    projectId: string,
    kind: "promote" | "rollback",
    version: number | null,
  ): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const body = await jsonBody(
      request,
      SMALL_BODY_MAX_BYTES,
      moveBody,
      '{ channel: "preview" | "production" }',
    );
    if (!body.ok) return body.response;
    const channel: ReleaseChannel = body.body.channel;
    const action: GameAction = `${kind}-${channel}`;
    if (gated.actor.kind === "agent" && !canDo("agent", action)) {
      return apiErrorResponse(
        releaseForbidden("agent-production", siteUrl(`/games/${encodeURIComponent(projectId)}`)),
      );
    }
    const { actor } = gated;
    return answer(async () => {
      if (kind === "promote") {
        if (version === null) return apiErrorResponse(NOT_FOUND, 404);
        return Response.json(await promote({ projectId, version, channel, actor }));
      }
      return Response.json(
        await rollback({ projectId, channel, actor, ...(version !== null ? { to: version } : {}) }),
      );
    });
  }

  async function zip(request: Request, releaseId: string): Promise<Response> {
    if (!isSha256(releaseId)) return apiErrorResponse(NOT_FOUND, 404);
    const [release] = await db
      .select({ projectId: engineReleases.projectId })
      .from(engineReleases)
      .where(eq(engineReleases.id, releaseId));
    if (!release) return apiErrorResponse(NOT_FOUND, 404);
    const gated = await gate(request, release.projectId, "read");
    if (!gated.ok) return gateResponse(gated);
    if (gated.actor.kind === "agent" && !canDo("agent", "download-zip")) {
      return apiErrorResponse(releaseForbidden("role"));
    }
    const { actor } = gated;
    return releaseZipResponse(request, releaseId, { actor, store: releaseDeps().store });
  }

  const projectOf = (match: RegExpExecArray) => decodeSegment(match[1] ?? "");

  return async function handleReleaseRoute(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    const { method } = request;

    const releases = RELEASES_PATH.exec(pathname);
    if (releases) {
      const projectId = projectOf(releases);
      if (projectId === null) return apiErrorResponse(NOT_FOUND, 404);
      if (method === "POST") return begin(request, projectId);
      if (method === "GET") return list(request, projectId);
      return methodNotAllowed("GET, POST");
    }
    const committing = RELEASE_COMMIT_PATH.exec(pathname);
    if (committing) {
      const projectId = projectOf(committing);
      if (projectId === null) return apiErrorResponse(NOT_FOUND, 404);
      if (method !== "POST") return methodNotAllowed("POST");
      return commit(request, projectId);
    }
    const moving = RELEASE_MOVE_PATH.exec(pathname);
    if (moving) {
      const projectId = projectOf(moving);
      const version = Number(moving[2]);
      if (projectId === null || !Number.isSafeInteger(version) || version < 1) {
        return apiErrorResponse(NOT_FOUND, 404);
      }
      if (method !== "POST") return methodNotAllowed("POST");
      return move(request, projectId, moving[3] === "rollback" ? "rollback" : "promote", version);
    }
    const rollingBack = RELEASE_ROLLBACK_PATH.exec(pathname);
    if (rollingBack) {
      const projectId = projectOf(rollingBack);
      if (projectId === null) return apiErrorResponse(NOT_FOUND, 404);
      if (method !== "POST") return methodNotAllowed("POST");
      return move(request, projectId, "rollback", null);
    }
    const file = RELEASE_FILE_PATH.exec(pathname);
    if (file) {
      const uploadId = decodeSegment(file[1] ?? "");
      if (uploadId === null) return apiErrorResponse(NOT_FOUND, 404);
      if (method !== "PUT") return methodNotAllowed("PUT");
      return putFile(request, uploadId, file[2] ?? "");
    }
    const zipped = RELEASE_ZIP_PATH.exec(pathname);
    if (zipped) {
      if (method !== "GET") return methodNotAllowed("GET");
      return zip(request, zipped[1] ?? "");
    }
    return null;
  };
}
