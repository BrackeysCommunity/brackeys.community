import type { SyncAccess } from "@/lib/canvas/token";

import { authorizeAgentToken } from "./agent-token";
import { engineGamesOpen } from "./guard-server";
import { engineProjectsEnabled, isEngineStaff, liveEngineProject } from "./projects";
import type { Actor } from "./release-upload";

/** The caller's session, a banned one already treated as signed out. */
export type ReadSession = (request: Request) => Promise<{ user: { id: string } } | null>;

export type GateDeps = {
  readSession: ReadSession;
  /** False lets a session through for a project id that isn't live yet (seeding a new project). */
  live?: boolean;
  /** Also require `engine-games-enabled` and the production guard, for the session's user or the token's creator. */
  games?: boolean;
};

/** Why the gate refused: the status, a sentence and any header the answer needs. */
export type GateRefusal = { status: number; message: string; headers?: Record<string, string> };

export type Gated = { ok: true; actor: Actor } | { ok: false; refusal: GateRefusal };

const NOT_FOUND: GateRefusal = { status: 404, message: "Not found." };

/**
 * Who may call an engine HTTP route for `projectId`: a bearer agent token
 * for this project (with write access when `need` is write), acting for
 * its creator; or a signed-in staff session with the `engine-projects`
 * flag on and the project live. With `games`, both also need
 * `engineGamesOpen`.
 */
export async function gateEngineRequest(
  request: Request,
  projectId: string,
  need: SyncAccess,
  deps: GateDeps,
): Promise<Gated> {
  const refuse = (refusal: GateRefusal): Gated => ({ ok: false, refusal });
  const secret = bearer(request);
  if (secret) {
    const authorized = await authorizeAgentToken(secret);
    if (!authorized.ok) {
      return refuse({
        status: authorized.status,
        message: authorized.message,
        ...(authorized.status === 401 ? { headers: { "www-authenticate": "Bearer" } } : {}),
      });
    }
    const { token } = authorized;
    if (token.projectId !== projectId) {
      return refuse({ status: 403, message: "That agent token is for another project." });
    }
    if (need === "write" && token.access !== "write") {
      return refuse({ status: 403, message: "That agent token is read-only." });
    }
    if (deps.games && !(await engineGamesOpen(token.createdById))) return refuse(NOT_FOUND);
    return {
      ok: true,
      actor: { kind: "agent", userId: token.createdById, agentTokenId: token.id },
    };
  }
  const session = await deps.readSession(request);
  if (!session) return refuse({ status: 401, message: "Authentication required." });
  const userId = session.user.id;
  if (!(await isEngineStaff(userId)))
    return refuse({ status: 403, message: "Staff access required." });
  if (!(await engineProjectsEnabled(userId))) return refuse(NOT_FOUND);
  if (deps.games && !(await engineGamesOpen(userId))) return refuse(NOT_FOUND);
  if (deps.live !== false && !(await liveEngineProject(projectId))) return refuse(NOT_FOUND);
  return { ok: true, actor: { kind: "user", userId } };
}

/** The bearer secret of the authorization header, or null. */
export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/** A path segment decoded, or null when its percent-escapes are malformed. */
export function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export const methodNotAllowed = (allow: string) =>
  new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } });

/** The body, or "too-large" as soon as it passes `max` bytes, without reading the rest. */
export async function readBody(request: Request, max: number): Promise<Uint8Array | "too-large"> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** JSON from the bytes, or null when they aren't JSON. */
export function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
