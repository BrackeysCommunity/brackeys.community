import type { Extension } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";

import { canvases } from "../../../src/db/schema.ts";
import { CANVAS_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { parseDocumentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import type { CanvasTokenClaims } from "../../../src/lib/canvas/token.ts";
import { applyStoredState } from "./apply.ts";
import type { ServiceDb } from "./db.ts";
import { SyncRefusal } from "./limits.ts";

export type DocumentKindName = "canvas" | "scene";

export interface KindLimits {
  /** Encoded state of one live doc. */
  maxStateBytes: number;
  /** One message after a connection's first sync step 2. */
  maxMessageBytes: number;
}

/** What a kind decides about one connect, past the token. */
export interface KindGrant {
  /** Connect read-only although the token may write. */
  readOnly?: boolean;
  /** A stateless message sent to the client once it is connected. */
  notice?: string;
}

/**
 * One kind of document the service hosts, by name prefix: its own access
 * check, load, store, migration and limits. Its hooks only ever see its own
 * documents.
 */
export interface DocumentKind {
  name: DocumentKindName;
  /** What close reasons call a doc of this kind: "canvas too large". */
  noun: string;
  limits: KindLimits;
  /** What a revoke covering this document is remembered under. */
  subject(id: string): string;
  /** Checks a connect whose token names this document; throws a `SyncRefusal` to refuse. */
  admit(id: string, claims: CanvasTokenClaims): Promise<KindGrant>;
  /** Load, store and migrate, as Hocuspocus hooks. */
  persistence: Extension;
  /** Loads what's stored into the live doc after a write from outside the service; false when it isn't open here. */
  apply?(id: string): Promise<boolean>;
  /** Releases what the kind holds (a worker, a pool) once the server has stopped. */
  close?(): Promise<void>;
}

/** The document hooks a kind's persistence may use. */
const ROUTED_HOOKS = [
  "onLoadDocument",
  "afterLoadDocument",
  "onChange",
  "onStoreDocument",
  "afterStoreDocument",
  "beforeUnloadDocument",
  "afterUnloadDocument",
] as const;

type Hook = (payload: { documentName: string }) => Promise<unknown>;

export class DocumentKinds {
  private readonly byName = new Map<DocumentKindName, DocumentKind>();

  constructor(kinds: DocumentKind[]) {
    for (const kind of kinds) this.byName.set(kind.name, kind);
  }

  async close(): Promise<void> {
    for (const kind of this.byName.values()) await kind.close?.();
  }

  get(name: DocumentKindName): DocumentKind | undefined {
    return this.byName.get(name);
  }

  /** The kind hosting a document and the id after its prefix; null for anything this service doesn't host. */
  resolve(documentName: string): { kind: DocumentKind; id: string } | null {
    const parsed = parseDocumentName(documentName);
    const kind = parsed ? this.byName.get(parsed.kind as DocumentKindName) : undefined;
    return kind && parsed ? { kind, id: parsed.id } : null;
  }

  /** One extension that hands each document hook to the kind of its document. */
  extension(): Extension {
    const router: Record<string, unknown> = { extensionName: "document-kinds" };
    for (const hook of ROUTED_HOOKS) {
      router[hook] = async (payload: { documentName: string }) => {
        const target = this.resolve(payload.documentName);
        if (!target) {
          if (hook === "onLoadDocument") {
            throw new SyncRefusal(SYNC_CLOSE.revoked, "unsupported document", "auth");
          }
          return;
        }
        const handler = (target.kind.persistence as Record<string, unknown>)[hook];
        return typeof handler === "function"
          ? (handler as Hook).call(target.kind.persistence, payload)
          : undefined;
      };
    }
    return router as Extension;
  }
}

/** Canvases, as the service has always hosted them. */
export function canvasKind(options: {
  db: ServiceDb;
  persistence: Extension;
  documents: () => ReadonlyMap<string, Y.Doc>;
}): DocumentKind {
  return {
    name: "canvas",
    noun: "canvas",
    limits: CANVAS_LIMITS,
    subject: (id) => id,
    async admit(id) {
      const [canvas] = await options.db
        .select({ deletedAt: canvases.deletedAt })
        .from(canvases)
        .where(eq(canvases.id, id));
      if (!canvas || canvas.deletedAt) {
        throw new SyncRefusal(SYNC_CLOSE.revoked, "canvas deleted", "auth");
      }
      return {};
    },
    persistence: options.persistence,
    apply: (id) => applyStoredState(options.documents(), options.db, id),
  };
}
