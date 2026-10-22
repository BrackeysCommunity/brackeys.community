import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import {
  documentName,
  REVOKE_CLOCK_SKEW_MS,
  type RevokeMessage,
  SYNC_CLOSE,
  syncClose,
} from "../../../src/lib/canvas/sync-channels.ts";

interface RevocableConnection {
  context: unknown;
  close(event?: { code: number; reason: string }): void;
}

interface RevocableDocument {
  getConnections(): RevocableConnection[];
}

function userIdOf(connection: RevocableConnection): string | undefined {
  const context = connection.context as { userId?: unknown } | null;
  return typeof context?.userId === "string" ? context.userId : undefined;
}

/**
 * The connections a revoke closes: one person's on one canvas, everyone's
 * on a canvas, or one person's everywhere.
 */
export function connectionsToRevoke(
  documents: ReadonlyMap<string, RevocableDocument>,
  message: RevokeMessage,
): RevocableConnection[] {
  const scope = message.canvasId
    ? [documents.get(documentName("canvas", message.canvasId))].filter((d) => d !== undefined)
    : [...documents.values()];
  return scope.flatMap((document) =>
    document
      .getConnections()
      .filter((connection) => !message.userId || userIdOf(connection) === message.userId),
  );
}

/** Closes what `connectionsToRevoke` finds with 4403; returns how many. */
export function revoke(
  documents: ReadonlyMap<string, RevocableDocument>,
  message: RevokeMessage,
): number {
  const connections = connectionsToRevoke(documents, message);
  for (const connection of connections) connection.close(syncClose(SYNC_CLOSE.revoked));
  return connections.length;
}

/** Revokes stored outside this process, read when a connection authenticates. */
export interface RevocationTombstones {
  /** The latest revoke covering this user on this canvas, in ms; null for none or on any error. */
  latest(canvasId: string, userId: string): Promise<number | null>;
  close(): Promise<void>;
}

export const noTombstones: RevocationTombstones = {
  latest: async () => null,
  close: async () => {},
};

/** Whether a token minted at `mintedAt` predates a revoke at `revokedAt`. */
export function predates(mintedAt: number, revokedAt: number, skewMs = REVOKE_CLOCK_SKEW_MS) {
  return mintedAt <= revokedAt + skewMs;
}

/**
 * Recent revokes, so a token minted before one can't open a new connection
 * after it: closing sockets alone would let a removed member reconnect with
 * the token they already hold. Kept as long as such a token could be valid.
 */
export class RevocationList {
  private readonly revokedAt = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = SYNC_LIMITS.tokenTtlMs + REVOKE_CLOCK_SKEW_MS,
    private readonly skewMs: number = REVOKE_CLOCK_SKEW_MS,
  ) {}

  private static key(canvasId: string | undefined, userId: string | undefined): string {
    return `${canvasId ?? ""}\u0000${userId ?? ""}`;
  }

  private sweep(now: number): void {
    for (const [key, at] of this.revokedAt) if (now - at > this.ttlMs) this.revokedAt.delete(key);
  }

  record(message: RevokeMessage, now: number): void {
    this.sweep(now);
    this.revokedAt.set(RevocationList.key(message.canvasId, message.userId), now);
  }

  /** Whether a token for this user and canvas, minted at `mintedAt`, predates a revoke covering it. */
  covers(canvasId: string, userId: string, mintedAt: number, now: number): boolean {
    this.sweep(now);
    for (const key of [
      RevocationList.key(canvasId, userId),
      RevocationList.key(canvasId, undefined),
      RevocationList.key(undefined, userId),
    ]) {
      const at = this.revokedAt.get(key);
      if (at !== undefined && predates(mintedAt, at, this.skewMs)) return true;
    }
    return false;
  }

  get size(): number {
    return this.revokedAt.size;
  }
}
