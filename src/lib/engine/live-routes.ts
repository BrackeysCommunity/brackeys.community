import { DEFAULT_SWAP_TIMING, swapTimingSchema } from "@jams/engine/game";
import { ID_PATTERN } from "@jams/engine/scene";
import * as z from "zod";

import { LIVE_LIMITS } from "./limits";
import { beginSceneVersion, commitSceneVersion } from "./live-upload";
import {
  clearScene,
  listSceneVersions,
  liveBase,
  promoteScene,
  rollbackScene,
} from "./live-versions";
import { versionNumberInput } from "./projects";
import { releaseChannel } from "./release-access";
import { engineRoutes, type ReleaseRouteDeps } from "./release-routes";
import {
  answer,
  badBody,
  decodeSegment,
  gateResponse,
  jsonBody,
  methodNotAllowed,
  NO_STORE,
  notFound,
  SMALL_BODY_MAX_BYTES,
} from "./route-gate";
import {
  LIVE_BASE_PATH,
  LIVE_COMMIT_PATH,
  LIVE_MOVE_PATH,
  LIVE_PATH,
  LIVE_PROMOTE_PATH,
} from "./route-paths";

export type LiveRouteDeps = ReleaseRouteDeps;

/** Room for a full version escaped inside a JSON string, and the rest of the body. */
const BEGIN_BODY_MAX_BYTES = 4 * LIVE_LIMITS.versionDataBytes;

/**
 * `begin`'s input after the project, read the same way by the procedure and
 * the route. The strings are bounded only by the body cap: the upload checks
 * the version's bytes and the note's characters, with the quota and note
 * refusals.
 */
export const liveBeginInput = z.object({
  /** The canonical `scene-version.json`. */
  version: z.string().max(BEGIN_BODY_MAX_BYTES),
  channel: z.enum(["preview", "none"]).default("preview"),
  /** The preview move's timing; the upload defaults it to `next-load`. */
  timing: swapTimingSchema.optional(),
  note: z.string().trim().max(BEGIN_BODY_MAX_BYTES).optional(),
});

/** A move's body after the project, scene and number, read the same way by the procedure and the route. */
export const livePromoteInput = z.object({
  channel: releaseChannel,
  timing: swapTimingSchema.default(DEFAULT_SWAP_TIMING),
});
export const liveRollbackInput = z.object({
  channel: releaseChannel,
  to: versionNumberInput.optional(),
  /** Ignored when the rollback goes back to the release's scene: players go back at the pointer's timing. */
  timing: swapTimingSchema.optional(),
});
export const liveClearInput = z.object({
  channel: releaseChannel,
  /** Ignored: players go back at the pointer's timing. */
  timing: swapTimingSchema.optional(),
});

/**
 * The live scene routes under `/api/engine/projects/<id>/live` for the
 * scene CLI's agent tokens and staff sessions: begin, commit and the list,
 * a scene's base, promote, rollback and clear, behind
 * `engine-games-enabled` and the production guard. Reads need read access
 * and moves write access; each is a transport over the same lib call as
 * `engine-live`'s procedure, which owns the rules (an agent token moving
 * production is refused there). Refusals are the release API's JSON
 * error. The texts go up through the release file route. Null for any
 * other path.
 */
export function createLiveRoutes(
  deps: LiveRouteDeps,
): (request: Request) => Promise<Response | null> {
  const { gate, releaseDeps, commit: commitWith } = engineRoutes(deps);
  const commit = commitWith(commitSceneVersion, "scene");

  async function begin(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const body = await jsonBody(
      request,
      BEGIN_BODY_MAX_BYTES,
      liveBeginInput,
      '{ version, channel?: "preview" | "none", timing?, note? }',
    );
    if (!body.ok) return body.response;
    return answer(async () =>
      Response.json(
        await beginSceneVersion(releaseDeps(), { projectId, ...body.body, actor: gated.actor }),
        { headers: NO_STORE },
      ),
    );
  }

  async function list(request: Request, projectId: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if (!gated.ok) return gateResponse(gated);
    const scene = new URL(request.url).searchParams.get("scene");
    if (scene !== null && !ID_PATTERN.test(scene)) return badQuery("?scene=<scene id>");
    return answer(async () =>
      Response.json(
        {
          versions: await listSceneVersions(
            { projectId, ...(scene !== null ? { scene } : {}), actor: gated.actor },
            releaseDeps(),
          ),
        },
        { headers: NO_STORE },
      ),
    );
  }

  async function base(request: Request, projectId: string, scene: string): Promise<Response> {
    const gated = await gate(request, projectId, "read");
    if (!gated.ok) return gateResponse(gated);
    const channel = releaseChannel.safeParse(new URL(request.url).searchParams.get("channel"));
    if (!channel.success) return badQuery('?channel="preview" | "production"');
    return answer(async () =>
      Response.json(
        await liveBase(
          { projectId, scene, channel: channel.data, actor: gated.actor },
          releaseDeps(),
        ),
        { headers: NO_STORE },
      ),
    );
  }

  async function promote(
    request: Request,
    projectId: string,
    scene: string,
    number: number,
  ): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const body = await jsonBody(
      request,
      SMALL_BODY_MAX_BYTES,
      livePromoteInput,
      '{ channel: "preview" | "production", timing? }',
    );
    if (!body.ok) return body.response;
    return answer(async () =>
      Response.json(
        await promoteScene(releaseDeps(), {
          projectId,
          scene,
          number,
          ...body.body,
          actor: gated.actor,
        }),
      ),
    );
  }

  async function move(
    request: Request,
    projectId: string,
    scene: string,
    kind: "rollback" | "clear",
  ): Promise<Response> {
    const gated = await gate(request, projectId, "write");
    if (!gated.ok) return gateResponse(gated);
    const { actor } = gated;
    if (kind === "clear") {
      const body = await jsonBody(
        request,
        SMALL_BODY_MAX_BYTES,
        liveClearInput,
        '{ channel: "preview" | "production", timing? }',
      );
      if (!body.ok) return body.response;
      return answer(async () =>
        Response.json(await clearScene(releaseDeps(), { projectId, scene, ...body.body, actor })),
      );
    }
    const body = await jsonBody(
      request,
      SMALL_BODY_MAX_BYTES,
      liveRollbackInput,
      '{ channel: "preview" | "production", to?, timing? }',
    );
    if (!body.ok) return body.response;
    return answer(async () =>
      Response.json(await rollbackScene(releaseDeps(), { projectId, scene, ...body.body, actor })),
    );
  }

  return async function handleLiveRoute(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    const { method } = request;

    const versions = LIVE_PATH.exec(pathname);
    if (versions) {
      const projectId = decodeSegment(versions[1] ?? "");
      if (projectId === null) return notFound();
      if (method === "POST") return begin(request, projectId);
      if (method === "GET") return list(request, projectId);
      return methodNotAllowed("GET, POST");
    }
    const committing = LIVE_COMMIT_PATH.exec(pathname);
    if (committing) {
      const projectId = decodeSegment(committing[1] ?? "");
      if (projectId === null) return notFound();
      if (method !== "POST") return methodNotAllowed("POST");
      return commit(request, projectId);
    }
    const based = LIVE_BASE_PATH.exec(pathname);
    if (based) {
      const target = sceneTarget(based);
      if (!target) return notFound();
      if (method !== "GET") return methodNotAllowed("GET");
      return base(request, target.projectId, target.scene);
    }
    const promoting = LIVE_PROMOTE_PATH.exec(pathname);
    if (promoting) {
      const target = sceneTarget(promoting);
      const number = Number(promoting[3]);
      if (!target || !Number.isSafeInteger(number) || number < 1) {
        return notFound();
      }
      if (method !== "POST") return methodNotAllowed("POST");
      return promote(request, target.projectId, target.scene, number);
    }
    const moving = LIVE_MOVE_PATH.exec(pathname);
    if (moving) {
      const target = sceneTarget(moving);
      if (!target) return notFound();
      if (method !== "POST") return methodNotAllowed("POST");
      return move(
        request,
        target.projectId,
        target.scene,
        moving[3] === "clear" ? "clear" : "rollback",
      );
    }
    return null;
  };
}

/** The project and scene a live scene path names, or null when either doesn't read as one. */
function sceneTarget(match: RegExpExecArray): { projectId: string; scene: string } | null {
  const projectId = decodeSegment(match[1] ?? "");
  const scene = decodeSegment(match[2] ?? "");
  if (projectId === null || scene === null || !ID_PATTERN.test(scene)) return null;
  return { projectId, scene };
}

const badQuery = (shape: string) => badBody(`Send ${shape} in the query.`);
