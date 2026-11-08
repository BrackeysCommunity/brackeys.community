import type { onAuthenticatePayload } from "@hocuspocus/server";

import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import {
  type SyncAccess,
  tokenAdmits,
  tokenKind,
  verifyCanvasToken,
} from "../../../src/lib/canvas/token.ts";
import type { DocumentKindName, DocumentKinds, KindGrant } from "./kinds.ts";
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
  kind: DocumentKindName;
  /** The document's id after its prefix. */
  docId: string;
  /** What revokes covering this document are remembered under. */
  subject: string;
  /** Nothing this connection sends is applied: a read token, or the kind said so. */
  readOnly: boolean;
  /** Sent to the client once connected, when its kind has something to tell it. */
  notice?: string;
  /** When the token was minted, so a revoke that lands mid-connect still catches it. */
  mintedAt: number;
  /** This connection's seat in the caps, from admission until it is established. */
  seat: string;
  /** The face peers see, from the token; absent on a token minted before it carried one. */
  name?: string;
  avatarUrl?: string | null;
}

/**
 * Who is connecting comes only from the token the web app minted after
 * checking access. The token must name this exact document and its kind,
 * or be project-scoped to the document's project; the kind must still admit
 * it, and the caps must have room. A read token connects read-only, so
 * nothing it sends is applied or relayed.
 */
export function createAuthenticate(options: {
  secret: string;
  kinds: DocumentKinds;
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
    if (!tokenAdmits(claims, documentName)) {
      throw new SyncRefusal(SYNC_CLOSE.unauthorized, "token is for another document", "auth");
    }
    // Notes have names already, and a service that serves them later; not yet.
    const target = options.kinds.resolve(documentName);
    if (!target) throw new SyncRefusal(SYNC_CLOSE.revoked, "unsupported document", "auth");
    const { kind, id } = target;
    // A project-scoped token is a project token that opens any kind of its project's documents.
    if (claims.c === documentName && tokenKind(claims) !== kind.name) {
      throw new SyncRefusal(SYNC_CLOSE.unauthorized, "token is for another kind", "auth");
    }

    const subject = kind.subject(id);
    const mintedAt = claims.e - SYNC_LIMITS.tokenTtlMs;
    if (options.revocations.covers(subject, claims.u, mintedAt, options.now())) {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "access revoked", "auth");
    }

    // The tombstone covers a revoke published before this instance was up.
    const [admitted, revokedAt] = await Promise.all([
      kind.admit(id, claims).then(
        (grant): { grant: KindGrant } => ({ grant }),
        (error: unknown) => ({ error }),
      ),
      tombstones.latest(subject, claims.u),
    ]);
    if (revokedAt !== null && predates(mintedAt, revokedAt)) {
      throw new SyncRefusal(SYNC_CLOSE.revoked, "access revoked", "auth");
    }
    if ("error" in admitted) throw admitted.error;
    const { grant } = admitted;

    const seat = crypto.randomUUID();
    await options.caps.admit(seat, documentName, claims.u, request);
    const readOnly = claims.a === "read" || grant.readOnly === true;
    connectionConfig.readOnly = readOnly;
    return {
      userId: claims.u,
      access: claims.a,
      kind: kind.name,
      docId: id,
      subject,
      readOnly,
      mintedAt,
      seat,
      ...(grant.notice !== undefined ? { notice: grant.notice } : {}),
      ...(claims.n !== undefined ? { name: claims.n, avatarUrl: claims.p ?? null } : {}),
    };
  };
}
