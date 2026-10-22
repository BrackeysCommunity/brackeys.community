/**
 * What the web app and `canvas-sync` agree on: document names, the Redis
 * channels the web app publishes revokes and server-side writes on, and the
 * close codes a client acts on. Shared with services, so no `@/` imports.
 */

export type SyncDocumentKind = "canvas" | "note";

const KINDS: readonly SyncDocumentKind[] = ["canvas", "note"];
const MAX_ID_LENGTH = 100;

export function documentName(kind: SyncDocumentKind, id: string): string {
  return `${kind}:${id}`;
}

/** `canvas:<id>` or `note:<id>`; null for anything else, ids with a colon included. */
export function parseDocumentName(name: string): { kind: SyncDocumentKind; id: string } | null {
  const colon = name.indexOf(":");
  if (colon < 0) return null;
  const kind = name.slice(0, colon) as SyncDocumentKind;
  const id = name.slice(colon + 1);
  if (!KINDS.includes(kind)) return null;
  if (!id || id.length > MAX_ID_LENGTH || id.includes(":") || id.trim() !== id) return null;
  return { kind, id };
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
 * as such a token could be valid. Ids never contain a colon.
 */
export const revokeTombstoneKey = (
  prefix: string,
  canvasId: string | undefined,
  userId: string | undefined,
) => `${prefix}:revoked:${canvasId ?? ""}:${userId ?? ""}`;

/** The tombstones that cover one person's connection to one canvas. */
export const revokeTombstoneKeys = (prefix: string, canvasId: string, userId: string) => [
  revokeTombstoneKey(prefix, canvasId, userId),
  revokeTombstoneKey(prefix, canvasId, undefined),
  revokeTombstoneKey(prefix, undefined, userId),
];

/**
 * Close live connections after an access change. `{ canvasId, userId }`
 * closes one person's sockets on one canvas, `{ canvasId }` everyone's on it,
 * and `{ userId }` that person's sockets everywhere (a ban).
 */
export type RevokeMessage =
  | { canvasId: string; userId?: string }
  | { canvasId?: string; userId: string };

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
    revokeTombstoneKey(prefix, message.canvasId, message.userId),
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
    const canvasId = optionalId((value as Record<string, unknown>).canvasId);
    const userId = optionalId((value as Record<string, unknown>).userId);
    if (canvasId === null || userId === null) return null;
    if (canvasId) return userId ? { canvasId, userId } : { canvasId };
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
