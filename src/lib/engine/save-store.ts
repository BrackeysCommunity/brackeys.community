// The browser's side of the save API: the play page's host serves a
// signed-in player's saves through `siteSaveStore`, and Settings → Game
// saves lists, reads and deletes through the account helpers.

import type { SaveLimits, SaveStore, SaveSummary } from "@jams/engine";
import { ISSUE_CODES, makeIssue, type IssueCode, type SceneIssue } from "@jams/engine/scene";

import { SITE } from "@/lib/legal-meta";

import { SITE_SAVE_LIMITS } from "./limits";
import { SIGNED_IN_SAVES_DESCRIBE } from "./local-saves";
import { ReleaseError, type ReleaseApiError } from "./release-errors";
import { engineProjectSavesPath, engineSavePath, ENGINE_SAVES_PATH } from "./route-paths";
import type { AccountSaves, SaveList } from "./save-api";

export type SaveFetchOptions = {
  /** Default the page's `fetch`, same-origin with the session cookie. */
  fetch?: typeof fetch;
};

export type SiteSaveStoreOptions = SaveFetchOptions & {
  /** The save menu's sentence until the list answers with the site's own. */
  describe?: string;
};

/** The site store, with the caps the game's last list answered. */
export type SiteSaveStore = SaveStore & {
  readonly limits: SaveLimits;
  /**
   * The game's list as `list` reads it, but a failure throws (the API's
   * refusal as a `ReleaseError`) instead of reading as an empty account.
   */
  load(): Promise<SaveList>;
};

/** A save that never reached the site: the request itself failed. */
export const SAVE_UNREACHABLE_MESSAGE = `This save couldn't reach ${SITE.name}. Check your connection and save again.`;
/** A refusal whose body wasn't the API's error. */
export const SAVE_FAILED_MESSAGE = `${SITE.name} couldn't keep this save. Try again in a few minutes.`;

const request = (opts: SaveFetchOptions | undefined, path: string, init: RequestInit = {}) =>
  (opts?.fetch ?? globalThis.fetch)(path, { credentials: "same-origin", ...init });

function isApiError(value: unknown): value is ReleaseApiError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.message === "string";
}

/** The API's error body of a refused response, or a generic one when it has none. */
async function refusalOf(response: Response): Promise<ReleaseApiError> {
  try {
    const body: unknown = await response.json();
    if (isApiError(body)) return body;
  } catch {
    // Not JSON: a proxy's page or a dropped body.
  }
  return { code: "save-store-failed", message: SAVE_FAILED_MESSAGE };
}

/** A refusal as the issue the game's `save:failed` reads, its message unchanged. */
function issueOf(body: ReleaseApiError): SceneIssue {
  const code: IssueCode = body.code in ISSUE_CODES ? (body.code as IssueCode) : "save-store-failed";
  const detail: Record<string, unknown> = {};
  if (body.limit !== undefined) detail.limit = body.limit;
  if (body.used !== undefined) detail.used = body.used;
  if (body.max !== undefined) detail.max = body.max;
  return makeIssue(code, {
    message: body.message,
    ...(body.hint !== undefined ? { hint: body.hint } : {}),
    ...(Object.keys(detail).length > 0 ? { detail } : {}),
  });
}

/** Throws the API's refusal as a `ReleaseError` unless the response is ok. */
async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw new ReleaseError(await refusalOf(response), response.status);
  return response;
}

/**
 * A `SaveStore` of kind `host` over the save routes for one project. Every
 * `SaveStore` call is caught: a list or read that fails is empty, a write that fails is
 * the API's refusal as an issue, its message unchanged, and one that never
 * reached the site is `save-store-failed`. Saves are kept by project, whatever
 * game id a call names; the API checks it against the production release.
 */
export function siteSaveStore(projectId: string, opts?: SiteSaveStoreOptions): SiteSaveStore {
  let describe = opts?.describe ?? SIGNED_IN_SAVES_DESCRIBE;
  let limits: SaveLimits = { ...SITE_SAVE_LIMITS };

  const load = async (): Promise<SaveList> => {
    const response = await ensureOk(await request(opts, engineProjectSavesPath(projectId)));
    const body = (await response.json()) as SaveList;
    describe = body.describe;
    limits = { maxBytes: body.limits.maxBytes, maxSlots: body.limits.maxSlots };
    return body;
  };

  return {
    kind: "host",
    get describe() {
      return describe;
    },
    get limits() {
      return limits;
    },
    load,
    async list(): Promise<readonly SaveSummary[]> {
      try {
        return (await load()).saves;
      } catch {
        return [];
      }
    },
    async read(_gameId, slot) {
      try {
        const response = await request(opts, engineSavePath(projectId, slot));
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    },
    async write(_gameId, slot, text) {
      let response: Response;
      try {
        response = await request(opts, engineSavePath(projectId, slot), {
          method: "PUT",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: text,
        });
      } catch {
        return {
          ok: false,
          issue: makeIssue("save-store-failed", { message: SAVE_UNREACHABLE_MESSAGE }),
        };
      }
      if (!response.ok) return { ok: false, issue: issueOf(await refusalOf(response)) };
      try {
        const body = (await response.json()) as { bytes: number };
        return { ok: true, bytes: body.bytes };
      } catch {
        return { ok: true, bytes: new TextEncoder().encode(text).length };
      }
    },
    async remove(_gameId, slot) {
      try {
        await request(opts, engineSavePath(projectId, slot), { method: "DELETE" });
      } catch {
        // A save that can't be removed stays listed; the game keeps running.
      }
    },
  };
}

/** Every game's saves on the signed-in account; throws the API's refusal as a `ReleaseError`. */
export async function fetchAccountSaves(opts?: SaveFetchOptions): Promise<AccountSaves> {
  const response = await ensureOk(await request(opts, ENGINE_SAVES_PATH));
  return (await response.json()) as AccountSaves;
}

/** One save's text, or null when the slot is empty; throws any other refusal. */
export async function fetchSaveText(
  projectId: string,
  slot: string,
  opts?: SaveFetchOptions,
): Promise<string | null> {
  const response = await request(opts, engineSavePath(projectId, slot));
  if (response.status === 404) return null;
  return (await ensureOk(response)).text();
}

/** Deletes one save from the account; throws the API's refusal as a `ReleaseError`. */
export async function deleteAccountSave(
  projectId: string,
  slot: string,
  opts?: SaveFetchOptions,
): Promise<void> {
  await ensureOk(await request(opts, engineSavePath(projectId, slot), { method: "DELETE" }));
}
