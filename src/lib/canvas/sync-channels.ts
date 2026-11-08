/**
 * What the web app and `canvas-sync` agree on: document names, the Redis
 * channels the web app publishes revokes and server-side writes on, and the
 * close codes a client acts on. Shared with services, so no `@/` imports.
 */

/**
 * The kinds of document `canvas-sync` can host, which are also the kinds a
 * sync token opens. Every other list of kinds derives from this one.
 */
export const SYNC_KINDS = ["canvas", "scene", "project", "asset"] as const;

export type SyncKind = (typeof SYNC_KINDS)[number];

/** Every kind a document name may carry: the hosted ones, and notes, which are named but not hosted. */
export type SyncDocumentKind = SyncKind | "note";

const DOCUMENT_KINDS: readonly SyncDocumentKind[] = [...SYNC_KINDS, "note"];

export const isSyncKind = (kind: unknown): kind is SyncKind =>
  (SYNC_KINDS as readonly unknown[]).includes(kind);

/**
 * The longest id after a name's prefix. A `<project>.<key>` id is at most
 * 48 + 1 + 48 = 97 characters; the slack is for canvas and note ids.
 */
export const MAX_ID_LENGTH = 100;

/** A project id or asset key: the engine's ID_PATTERN, mirrored here so the web client needn't load the engine. */
const ENGINE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** `<project>.<key>`, each part an engine id; null for anything else. */
export function parseProjectKey(id: string): { project: string; key: string } | null {
  const dot = id.indexOf(".");
  if (dot < 0) return null;
  const project = id.slice(0, dot);
  const key = id.slice(dot + 1);
  return ENGINE_ID.test(project) && ENGINE_ID.test(key) ? { project, key } : null;
}

/**
 * Whether `id` fits the kind: an engine id for `project`, `<project>.<key>`
 * for `scene` and `asset`, and any trimmed id without a colon for canvases
 * and notes.
 */
function fitsKind(kind: SyncDocumentKind, id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH || id.includes(":") || id.trim() !== id) return false;
  if (kind === "project") return ENGINE_ID.test(id);
  if (kind === "scene" || kind === "asset") return parseProjectKey(id) !== null;
  return true;
}

export function documentName(kind: SyncDocumentKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * `canvas:<id>`, `note:<id>`, `project:<project>`, `scene:<project>.<key>`
 * or `asset:<project>.<key>`; null for anything else.
 */
export function parseDocumentName(name: string): { kind: SyncDocumentKind; id: string } | null {
  const colon = name.indexOf(":");
  if (colon < 0) return null;
  const kind = name.slice(0, colon) as SyncDocumentKind;
  const id = name.slice(colon + 1);
  if (!DOCUMENT_KINDS.includes(kind) || !fitsKind(kind, id)) return null;
  return { kind, id };
}

/** The project a `project:`, `scene:` or `asset:` document belongs to; null for any other name. */
export function documentProject(name: string): string | null {
  const parsed = parseDocumentName(name);
  if (!parsed) return null;
  if (parsed.kind === "project") return parsed.id;
  if (parsed.kind === "scene" || parsed.kind === "asset") {
    return parseProjectKey(parsed.id)?.project ?? null;
  }
  return null;
}

/**
 * Keys and channels are prefixed by the Railway environment, so staging and
 * production can share a Redis without hearing each other.
 */
export function syncEnvPrefix(environmentName: string | undefined): string {
  return `${environmentName || "development"}:canvas-sync`;
}

export const revokeChannel = (prefix: string) => `${prefix}:revoke`;
export const applyChannel = (prefix: string) => `${prefix}:apply`;

/**
 * A token minted this long after a revoke may still predate it on the web
 * app's clock; refused all the same. A legitimate reconnect just retries.
 */
export const REVOKE_CLOCK_SKEW_MS = 2_000;

/**
 * Where a revoke is remembered (its time, in ms), so an instance that boots
 * after the publish still refuses tokens minted before it. Kept for as long
 * as such a token could be valid. The subject is a canvas id or a document
 * name (see `revokeSubject`); user ids never contain a colon.
 */
export const revokeTombstoneKey = (
  prefix: string,
  subject: string | undefined,
  userId: string | undefined,
) => `${prefix}:revoked:${subject ?? ""}:${userId ?? ""}`;

/**
 * The subjects whose revokes cover a document's subject: itself, and its
 * project's (`project:<id>`) when it is a project's document.
 */
export function revokeSubjectsCovering(subject: string): string[] {
  const project = documentProject(subject);
  if (project === null) return [subject];
  const projectSubject = documentName("project", project);
  return projectSubject === subject ? [subject] : [subject, projectSubject];
}

/** The tombstones that cover one person's connection to one document. */
export const revokeTombstoneKeys = (prefix: string, subject: string, userId: string) => [
  ...revokeSubjectsCovering(subject).flatMap((covering) => [
    revokeTombstoneKey(prefix, covering, userId),
    revokeTombstoneKey(prefix, covering, undefined),
  ]),
  revokeTombstoneKey(prefix, undefined, userId),
];

/**
 * Close live connections after an access change. `{ canvasId, userId }`
 * closes one person's sockets on one canvas, `{ canvasId }` everyone's on it,
 * and `{ userId }` that person's sockets everywhere (a ban). `sceneId` names
 * a scene the same way, and `projectId` every document of a project: its
 * registry, its scenes and its assets.
 */
export type RevokeMessage =
  | { canvasId: string; sceneId?: never; projectId?: never; userId?: string }
  | { sceneId: string; canvasId?: never; projectId?: never; userId?: string }
  | { projectId: string; canvasId?: never; sceneId?: never; userId?: string }
  | { canvasId?: never; sceneId?: never; projectId?: never; userId: string };

/**
 * What a revoke is remembered under: a canvas's id, `scene:<id>` or
 * `project:<id>` (canvas ids are UUIDs, so they never collide); undefined
 * for a revoke that covers a person everywhere.
 */
export function revokeSubject(message: {
  canvasId?: string;
  sceneId?: string;
  projectId?: string;
}): string | undefined {
  if (message.canvasId) return message.canvasId;
  if (message.sceneId) return documentName("scene", message.sceneId);
  return message.projectId ? documentName("project", message.projectId) : undefined;
}

/** Whether a revoke reaches the live document `name` (any user's connection to it). */
export function revokeReaches(message: RevokeMessage, name: string): boolean {
  if (message.canvasId) return name === documentName("canvas", message.canvasId);
  if (message.sceneId) return name === documentName("scene", message.sceneId);
  if (message.projectId) return documentProject(name) === message.projectId;
  return true;
}

/** The two Redis calls a revoke needs; an ioredis client fits. */
export interface RevokeSender {
  publish(channel: string, message: string): Promise<unknown>;
  set(key: string, value: string, mode: "PX", milliseconds: number): Promise<unknown>;
}

/**
 * Publishes a revoke, then remembers it until `ttlMs` (as long as a token
 * minted before it could still be presented), for instances booted later.
 */
export async function sendRevoke(
  client: RevokeSender,
  prefix: string,
  message: RevokeMessage,
  ttlMs: number,
): Promise<void> {
  const at = Date.now();
  await client.publish(revokeChannel(prefix), JSON.stringify(message));
  await client.set(
    revokeTombstoneKey(prefix, revokeSubject(message), message.userId),
    String(at),
    "PX",
    ttlMs,
  );
}

/**
 * Who is connected to each live document, for "Live now" and the team page.
 * Each instance keeps a key per document it holds (its connected user ids,
 * as JSON) and adds itself to the document's instance set; both expire
 * unless refreshed, so a crashed instance stops counting within the TTL.
 */
export const PRESENCE_TTL_SECONDS = 90;
export const PRESENCE_REFRESH_MS = 30_000;

export const presenceKey = (prefix: string, documentName: string, instanceId: string) =>
  `${prefix}:here:${documentName}:${instanceId}`;
export const presenceInstancesKey = (prefix: string, documentName: string) =>
  `${prefix}:here-instances:${documentName}`;

/**
 * Signed-out readers have no socket, so they don't reach the roster: each
 * tab's presence poll scores its own id into a sorted set instead, and a
 * viewer counts while it has polled within `VIEWER_TTL_MS`.
 */
export const VIEWER_TTL_MS = 45_000;
const MAX_VIEWERS = 500;

export const viewersKey = (prefix: string, documentName: string) =>
  `${prefix}:viewers:${documentName}`;

/** The sorted-set commands `touchViewers` needs; an ioredis client fits. */
export interface ViewerStore {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<unknown>;
  zremrangebyscore(key: string, min: string | number, max: string | number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

/** Records `viewerId` when given, and counts the other signed-out viewers still polling. */
export async function touchViewers(
  client: ViewerStore,
  prefix: string,
  documentName: string,
  viewerId: string | null,
  now: number = Date.now(),
): Promise<number> {
  const key = viewersKey(prefix, documentName);
  if (viewerId) {
    await client.zadd(key, now, viewerId);
    await client.zremrangebyrank(key, 0, -(MAX_VIEWERS + 1));
    await client.pexpire(key, VIEWER_TTL_MS * 2);
  }
  await client.zremrangebyscore(key, "-inf", now - VIEWER_TTL_MS);
  const count = await client.zcard(key);
  return Math.max(0, count - (viewerId ? 1 : 0));
}

/** The two Redis reads `readPresence` needs; an ioredis client fits. */
export interface PresenceReader {
  smembers(key: string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

/** Connected user ids per document, across every instance; documents with nobody are left out. */
export async function readPresence(
  client: PresenceReader,
  prefix: string,
  documentNames: readonly string[],
): Promise<Map<string, string[]>> {
  const instances = await Promise.all(
    documentNames.map((name) => client.smembers(presenceInstancesKey(prefix, name))),
  );
  const keys = documentNames.flatMap((name, i) =>
    instances[i]!.map((instance) => ({ name, key: presenceKey(prefix, name, instance) })),
  );
  const found = new Map<string, string[]>();
  if (keys.length === 0) return found;
  const values = await client.mget(...keys.map((k) => k.key));
  keys.forEach(({ name }, i) => {
    let ids: unknown;
    try {
      ids = JSON.parse(values[i] ?? "[]");
    } catch {
      return;
    }
    if (!Array.isArray(ids)) return;
    const here = new Set(found.get(name));
    for (const id of ids) if (typeof id === "string" && id) here.add(id);
    if (here.size) found.set(name, [...here]);
  });
  return found;
}

/** The stored state changed outside the service; load it into the live doc. */
export interface ApplyMessage {
  canvasId: string;
}

function optionalId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

export function parseRevokeMessage(raw: string): RevokeMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const fields = value as Record<string, unknown>;
    const canvasId = optionalId(fields.canvasId);
    const sceneId = optionalId(fields.sceneId);
    const projectId = optionalId(fields.projectId);
    const userId = optionalId(fields.userId);
    if (canvasId === null || sceneId === null || projectId === null || userId === null) {
      return null;
    }
    if ([canvasId, sceneId, projectId].filter((id) => id !== undefined).length > 1) return null;
    const user = userId ? { userId } : {};
    if (canvasId) return { canvasId, ...user };
    if (sceneId) return { sceneId, ...user };
    if (projectId) return { projectId, ...user };
    return userId ? { userId } : null;
  } catch {
    return null;
  }
}

export function parseApplyMessage(raw: string): ApplyMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const canvasId = optionalId((value as Record<string, unknown>).canvasId);
    return canvasId ? { canvasId } : null;
  } catch {
    return null;
  }
}

/**
 * Why the service ended a client's session on a document. Hocuspocus closes a
 * document with a message that carries only a reason string, so the code
 * rides at the front of the reason (`"4413 too-large"`) and `syncCloseCode`
 * reads it from either place.
 */
export const SYNC_CLOSE = {
  /** Bad, expired or wrong-document token. A fresh token may succeed. */
  unauthorized: 4401,
  /** Access was taken away, or the canvas is gone. Don't reconnect. */
  revoked: 4403,
  /** A message or the stored canvas is over its cap. Don't reconnect. */
  tooLarge: 4413,
  /** Too many messages or connections. Back off, then retry. */
  rateLimited: 4429,
} as const;

export type SyncCloseCode = (typeof SYNC_CLOSE)[keyof typeof SYNC_CLOSE];

const REASONS: Record<SyncCloseCode, string> = {
  4401: "unauthorized",
  4403: "revoked",
  4413: "too-large",
  4429: "rate-limited",
};

const CODES = new Set<number>(Object.values(SYNC_CLOSE));

/** A close event for Hocuspocus's `connection.close`, and a throwable refusal. */
export function syncClose(code: SyncCloseCode, detail?: string): { code: number; reason: string } {
  return {
    code,
    reason: detail ? `${code} ${REASONS[code]}: ${detail}` : `${code} ${REASONS[code]}`,
  };
}

/**
 * The sync code behind a close or a refused authentication, or null when
 * it's an ordinary disconnect. A websocket closed for an oversize frame
 * (1009) counts as too large, so a client never resends it in a loop.
 */
export function syncCloseCode(
  event: { code?: number; reason?: string } | undefined,
): SyncCloseCode | null {
  if (!event) return null;
  if (event.code !== undefined && CODES.has(event.code)) return event.code as SyncCloseCode;
  if (event.code === 1009) return SYNC_CLOSE.tooLarge;
  const match = /^(\d{4})\b/.exec(event.reason ?? "");
  const code = match ? Number(match[1]) : NaN;
  return CODES.has(code) ? (code as SyncCloseCode) : null;
}
