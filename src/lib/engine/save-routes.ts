import { db as siteDb } from "@/db";
import { checkRateLimit } from "@/lib/rate-limit";

import { engineGamesAllowed } from "./guard";
import { engineGamesOpen } from "./guard-server";
import { SITE_SAVE_LIMITS } from "./limits";
import { apiErrorResponse, ReleaseError, type ReleaseApiError } from "./release-errors";
import { minioReleaseStore } from "./release-storage";
import type { ReleaseTxDb } from "./release-upload";
import { decodeSegment, methodNotAllowed, type ReadSession } from "./route-gate";
import { PROJECT_SAVES_PATH, SAVE_SLOT_PATH, SAVES_PATH } from "./route-paths";
import {
  listAccountSaves,
  listSaves,
  putSave,
  readSave,
  removeSave,
  saveAccess,
  type SaveApiDeps,
  type SaveViewer,
} from "./save-api";
import { viewerOf } from "./viewer";

export type SaveRouteDeps = {
  /** The caller's session; a banned one reads as signed out. */
  readSession: ReadSession;
  /** The save API's store, limiter and clock; default the site's bucket, Redis and clock. */
  saves?: Partial<SaveApiDeps>;
};

/**
 * One byte past the per-save cap: a body is read no further, so the save
 * API sees it's too large and refuses it with its own message.
 */
const PUT_READ_CAP = SITE_SAVE_LIMITS.maxBytes + 1;

const NOT_FOUND: ReleaseApiError = { code: "not-found", message: "Not found." };
const EMPTY_SLOT: ReleaseApiError = {
  code: "not-found",
  message: "There is no save in this slot.",
};
const NOT_TEXT: ReleaseApiError = {
  code: "schema",
  message: "A save file is JSON text in UTF-8.",
};

const SIGNED_OUT: SaveViewer = { userId: null, staff: false, teamRole: null, isCreator: false };

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

const refuse = (err: ReleaseError | ReleaseApiError, status?: number) =>
  noStore(apiErrorResponse(err, status));

/** Runs one save API call, its refusals answered as their JSON body and status. */
async function answer(run: () => Promise<Response>): Promise<Response> {
  try {
    return noStore(await run());
  } catch (error) {
    if (error instanceof ReleaseError) return refuse(error);
    throw error;
  }
}

/**
 * The body's first `cap` bytes; the rest is never read. A body longer
 * than the cap comes back exactly `cap` bytes long.
 */
async function readCapped(request: Request, cap: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(cap);
  let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) return bytes.subarray(0, size);
    const take = Math.min(value.byteLength, cap - size);
    bytes.set(value.subarray(0, take), size);
    size += take;
  }
  await reader.cancel().catch(() => {});
  return bytes;
}

/**
 * The save text: strict UTF-8 within the cap, or null when it isn't. A
 * body at the cap is decoded leniently (replacing a cut character never
 * shortens it), since the save API refuses it for its size either way.
 */
function decodeSave(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= PUT_READ_CAP) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

type Caller = { ok: true; userId: string } | { ok: false; response: Response };

/**
 * The player save routes under `/api/engine/saves`: a game's list, one
 * slot's read, write and delete, and the account's list for Settings. For a
 * signed-in session behind `engine-games-enabled` and the production guard,
 * never staff-only. Each is a transport over one `save-api.ts` call, which
 * owns the rules; refusals are the release API's JSON error. Null for any
 * other path.
 */
export function createSaveRoutes(
  deps: SaveRouteDeps,
): (request: Request) => Promise<Response | null> {
  const saveDeps = (): SaveApiDeps => ({
    db: deps.saves?.db ?? (siteDb as unknown as ReleaseTxDb),
    store: deps.saves?.store ?? minioReleaseStore,
    rateLimit: deps.saves?.rateLimit ?? checkRateLimit,
    now: deps.saves?.now ?? (() => new Date()),
  });

  /**
   * The signed-in caller with games open to them. A deployment without
   * games reads as one without these routes, before the sign-in refusal;
   * a signed-out caller gets the save API's own refusal for that.
   */
  async function caller(request: Request, projectId: string | null): Promise<Caller> {
    if (!engineGamesAllowed()) return { ok: false, response: refuse(NOT_FOUND, 404) };
    const session = await deps.readSession(request);
    if (!session) {
      const refusal = saveAccess(
        SIGNED_OUT,
        {
          projectId: projectId ?? "",
          visibility: "public",
          teamId: null,
          hiddenAt: null,
          saveMode: "site",
        },
        null,
      );
      return { ok: false, response: refuse(refusal ?? NOT_FOUND, refusal ? undefined : 404) };
    }
    if (!(await engineGamesOpen(session.user.id))) {
      return { ok: false, response: refuse(NOT_FOUND, 404) };
    }
    return { ok: true, userId: session.user.id };
  }

  const viewer = (userId: string, projectId: string) => viewerOf(userId, projectId, saveDeps().db);

  async function account(request: Request): Promise<Response> {
    const who = await caller(request, null);
    if (!who.ok) return who.response;
    return answer(async () =>
      Response.json(await listAccountSaves(saveDeps(), { userId: who.userId })),
    );
  }

  async function list(request: Request, projectId: string): Promise<Response> {
    const who = await caller(request, projectId);
    if (!who.ok) return who.response;
    return answer(async () =>
      Response.json(
        await listSaves(saveDeps(), { viewer: await viewer(who.userId, projectId), projectId }),
      ),
    );
  }

  async function read(request: Request, projectId: string, slot: string): Promise<Response> {
    const who = await caller(request, projectId);
    if (!who.ok) return who.response;
    return answer(async () => {
      const text = await readSave(saveDeps(), {
        viewer: await viewer(who.userId, projectId),
        projectId,
        slot,
      });
      if (text === null) return apiErrorResponse(EMPTY_SLOT, 404);
      return new Response(text, {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    });
  }

  async function write(request: Request, projectId: string, slot: string): Promise<Response> {
    const who = await caller(request, projectId);
    if (!who.ok) return who.response;
    const text = decodeSave(await readCapped(request, PUT_READ_CAP));
    if (text === null) return refuse(NOT_TEXT, 422);
    return answer(async () =>
      Response.json(
        await putSave(saveDeps(), {
          viewer: await viewer(who.userId, projectId),
          projectId,
          slot,
          text,
        }),
      ),
    );
  }

  async function remove(request: Request, projectId: string, slot: string): Promise<Response> {
    const who = await caller(request, projectId);
    if (!who.ok) return who.response;
    return answer(async () => {
      await removeSave(saveDeps(), {
        viewer: await viewer(who.userId, projectId),
        projectId,
        slot,
      });
      return new Response(null, { status: 204 });
    });
  }

  return async function handleSaveRoute(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    const { method } = request;

    if (SAVES_PATH.test(pathname)) {
      if (method !== "GET") return methodNotAllowed("GET");
      return account(request);
    }
    const project = PROJECT_SAVES_PATH.exec(pathname);
    if (project) {
      const projectId = decodeSegment(project[1] ?? "");
      if (projectId === null) return refuse(NOT_FOUND, 404);
      if (method !== "GET") return methodNotAllowed("GET");
      return list(request, projectId);
    }
    const slotted = SAVE_SLOT_PATH.exec(pathname);
    if (slotted) {
      const projectId = decodeSegment(slotted[1] ?? "");
      const slot = decodeSegment(slotted[2] ?? "");
      if (projectId === null || slot === null) return refuse(NOT_FOUND, 404);
      if (method === "GET") return read(request, projectId, slot);
      if (method === "PUT") return write(request, projectId, slot);
      if (method === "DELETE") return remove(request, projectId, slot);
      return methodNotAllowed("GET, PUT, DELETE");
    }
    return null;
  };
}
