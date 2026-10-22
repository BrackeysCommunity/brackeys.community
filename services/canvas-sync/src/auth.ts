import type { onAuthenticatePayload } from "@hocuspocus/server";
import { eq } from "drizzle-orm";

import { canvases } from "../../../src/db/schema.ts";
import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { parseDocumentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { type SyncAccess, verifyCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "./db.ts";
import { type ConnectionCaps, SyncRefusal } from "./limits.ts";
import {
  noTombstones,
  predates,
  type RevocationList,
  type RevocationTombstones,
} from "./revoke.ts";

export interface SyncContext {
  userId: string;
  access: SyncAccess;
  canvasId: string;
  /** When the token was minted, so a revoke that lands mid-connect still catches it. */
  mintedAt: number;
  /** This connection's seat in the caps, from admission until it is established. */
  seat: string;
}

/**
 * Who is connecting comes only from the token the web app minted after
 * checking access. The token must name this exact document, the canvas
 * must still exist, and the caps must have room. A read token connects
 * read-only, so nothing it sends is applied or relayed.
 */
export function createAuthenticate(options: {
  secret: string;
  db: ServiceDb;
  caps: ConnectionCaps;
  revocations: RevocationList;
  tombstones?: RevocationTombstones;
  now: () => number;
}) {
  const tombstones = options.tombstones ?? noTombstones;
  return async ({
    token,
    documentName,
    connectionConfig,
    request,
  }: onAuthenticatePayload): Promise<SyncContext> => {
    const claims = await verifyCanvasToken(token, options.secret, options.now());
    if (!claims) throw new SyncRefusal(SYNC_CLOSE.unauthorized, "invalid token", "auth");
    if (claims.c !== documentName) {
      throw new SyncRefusal(SYNC_CLOSE.unauthorized, "token is for another document", "auth");
    }
    const parsed = parseDocumentName(documentName);
    // Notes have names already, and a service that serves them later; not yet.
    if (parsed?.kind !== "canvas") {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "unsupported document", "auth");
    }

    const mintedAt = claims.e - SYNC_LIMITS.tokenTtlMs;
    if (options.revocations.covers(parsed.id, claims.u, mintedAt, options.now())) {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "access revoked", "auth");
    }

    // The tombstone covers a revoke published before this instance was up.
    const [[canvas], revokedAt] = await Promise.all([
      options.db
        .select({ deletedAt: canvases.deletedAt })
        .from(canvases)
        .where(eq(canvases.id, parsed.id)),
      tombstones.latest(parsed.id, claims.u),
    ]);
    if (revokedAt !== null && predates(mintedAt, revokedAt)) {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "access revoked", "auth");
    }
    if (!canvas || canvas.deletedAt) {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "canvas deleted", "auth");
    }

    const seat = crypto.randomUUID();
    await options.caps.admit(seat, documentName, claims.u, request);
    connectionConfig.readOnly = claims.a === "read";
    return { userId: claims.u, access: claims.a, canvasId: parsed.id, mintedAt, seat };
  };
}
