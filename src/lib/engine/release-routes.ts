import { isSha256 } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { engineReleases, engineReleaseUploads } from "@/db/schema";
import type { SyncAccess } from "@/lib/canvas/token";

import { PROJECT_QUOTA, RELEASE_MANIFEST_MAX_BYTES } from "./limits";
import { quotaWords } from "./quota";
import { canDo, releaseChannel, type ReleaseChannel } from "./release-access";
import type { Actor } from "./release-audit";
import { listReleases, promote, rollback } from "./release-channels";
import { apiErrorResponse, releaseForbidden } from "./release-errors";
import { minioReleaseStore } from "./release-storage";
import { beginRelease, commitRelease, putReleaseFile, type ReleaseDeps } from "./release-upload";
import { releaseZipResponse } from "./release-zip";
import {
  answer,
  decodeSegment,
  gateEngineRequest,
  gateResponse,
  jsonBody,
  methodNotAllowed,
  NO_STORE,
  notFound,
  readBody,
  SMALL_BODY_MAX_BYTES,
  unknownUpload,
  uploadIdInput,
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
  /** The upload protocol's store, clock, limiter and scan; default the site's bucket and queue. */
  release?: Partial<ReleaseDeps>;
};

/** The upload's project, kind and missing files; null for an unknown id. */
async function uploadOf(uploadId: string) {
  const [row] = await db
    .select({
      projectId: engineReleaseUploads.projectId,
      kind: engineReleaseUploads.kind,
      missing: engineReleaseUploads.missing,
    })
    .from(engineReleaseUploads)
    .where(eq(engineReleaseUploads.id, uploadId));
  return row ?? null;
}

/** Finishes one upload through its lib call: a release's or a scene version's. */
type FinishUpload = (
  deps: ReleaseDeps,
  input: { uploadId: string; actor: Actor },
) => Promise<{ created: boolean }>;

/**
 * What the release and live routes share: the gate behind
 * `engine-games-enabled` and the production guard, the upload protocol's
 * deps, and the commit route.
 */
export function engineRoutes(deps: ReleaseRouteDeps) {
  const gate = (request: Request, projectId: string, need: SyncAccess) =>
    gateEngineRequest(request, projectId, need, { readSession: deps.readSession, games: true });
  const releaseDeps = (): ReleaseDeps => ({
    ...deps.release,
    store: deps.release?.store ?? minioReleaseStore,
  });

  /**
   * `POST …/commit` through `finish`, for an upload of `projectId` (and of
   * `kind`, when given) only, so a token reaches only its own project's.
   */
  const commit =
    (finish: FinishUpload, kind?: "scene") =>
    async (request: Request, projectId: string): Promise<Response> => {
      const gated = await gate(request, projectId, "write");
      if (!gated.ok) return gateResponse(gated);
      const body = await jsonBody(request, SMALL_BODY_MAX_BYTES, uploadIdInput, "{ uploadId }");
      if (!body.ok) return body.response;
      const upload = await uploadOf(body.body.uploadId);
      if (upload?.projectId !== projectId || (kind !== undefined && upload.kind !== kind))
        return unknownUpload();
      return answer(async () => {
        const result = await finish(releaseDeps(), {
          uploadId: body.body.uploadId,
          actor: gated.actor,
        });
        return Response.json(result, { status: result.created ? 201 : 200 });
      });
    };

  return { gate, releaseDeps, commit };
}

/** Room for a 1 MiB manifest escaped inside a JSON string, and the rest of the body. */
const BEGIN_BODY_MAX_BYTES = 4 * RELEASE_MANIFEST_MAX_BYTES;

const beginBody = z.object({
  manifest: z.string().max(RELEASE_MANIFEST_MAX_BYTES),
  channel: z.enum(["preview", "none"]).default("preview"),
});
const moveBody = z.object({ channel: releaseChannel });

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
  const { gate, releaseDeps, commit: commitWith } = engineRoutes(deps);
  const commit = commitWith(commitRelease);

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
        { headers: NO_STORE },
      ),
    );
  }

  async function list(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if (!gated.ok) return gateResponse(gated);
    return answer(async () =>
      Response.json(
        { releases: await listReleases({ projectId, actor: gated.actor }) },
        { headers: NO_STORE },
      ),
    );
  }

  async function putFile(request: Request, uploadId: string, hash: string): Promise<Response> {
    const upload = await uploadOf(uploadId);
    if (!upload) return unknownUpload();
    const gated = await gate(request, upload.projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    if (!isSha256(hash)) return notFound();

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
    const { actor } = gated;
    return answer(async () => {
      if (kind === "promote") {
        if (version === null) return notFound();
        return Response.json(await promote({ projectId, version, channel, actor }));
      }
      return Response.json(
        await rollback({ projectId, channel, actor, ...(version !== null ? { to: version } : {}) }),
      );
    });
  }

  async function zip(request: Request, releaseId: string): Promise<Response> {
    if (!isSha256(releaseId)) return notFound();
    const [release] = await db
      .select({ projectId: engineReleases.projectId })
      .from(engineReleases)
      .where(eq(engineReleases.id, releaseId));
    if (!release) return notFound();
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
      if (projectId === null) return notFound();
      if (method === "POST") return begin(request, projectId);
      if (method === "GET") return list(request, projectId);
      return methodNotAllowed("GET, POST");
    }
    const committing = RELEASE_COMMIT_PATH.exec(pathname);
    if (committing) {
      const projectId = projectOf(committing);
      if (projectId === null) return notFound();
      if (method !== "POST") return methodNotAllowed("POST");
      return commit(request, projectId);
    }
    const moving = RELEASE_MOVE_PATH.exec(pathname);
    if (moving) {
      const projectId = projectOf(moving);
      const version = Number(moving[2]);
      if (projectId === null || !Number.isSafeInteger(version) || version < 1) {
        return notFound();
      }
      if (method !== "POST") return methodNotAllowed("POST");
      return move(request, projectId, moving[3] === "rollback" ? "rollback" : "promote", version);
    }
    const rollingBack = RELEASE_ROLLBACK_PATH.exec(pathname);
    if (rollingBack) {
      const projectId = projectOf(rollingBack);
      if (projectId === null) return notFound();
      if (method !== "POST") return methodNotAllowed("POST");
      return move(request, projectId, "rollback", null);
    }
    const file = RELEASE_FILE_PATH.exec(pathname);
    if (file) {
      const uploadId = decodeSegment(file[1] ?? "");
      if (uploadId === null) return notFound();
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
