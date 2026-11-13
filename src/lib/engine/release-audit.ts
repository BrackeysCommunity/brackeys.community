import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import { engineReleaseAudit } from "../../db/schema.ts";

/** The database or a transaction on it, whichever driver (the app's node-postgres, the tests' pglite). */
export type ReleaseDb = Pick<PgAsyncDatabase<any, any>, "select" | "insert" | "update" | "delete">;

/** Who acts on a release: a person, an agent token on behalf of its creator, or staff. */
export type Actor = { kind: "user" | "agent" | "staff"; userId: string; agentTokenId?: string };

/** Who an audit row names: a person, an agent token on behalf of its creator, staff, or the site itself. */
export type AuditActor = Actor | { kind: "system" };

export type AuditAction =
  | "create"
  | "promote"
  | "rollback"
  | "visibility"
  | "jam-link"
  | "jam-unlink"
  | "hide"
  | "unhide"
  | "collect"
  | "approve-public"
  | "settings"
  | "report-resolved"
  | "scene-create"
  | "scene-promote"
  | "scene-rollback"
  | "scene-clear"
  | "scene-block"
  | "scene-unblock"
  | "scene-hide"
  | "scene-unhide"
  | "scene-collect";

export type AuditRow = {
  projectId: string;
  actor: AuditActor;
  action: AuditAction;
  releaseId?: string | null;
  channel?: "preview" | "production" | null;
  fromRelease?: string | null;
  toRelease?: string | null;
  /** The scene a `scene-*` row is about, and its version. */
  sceneId?: string | null;
  sceneVersionId?: string | null;
  detail?: Record<string, unknown>;
  /** Default now. */
  at?: Date;
};

/**
 * The one writer of `engine_release_audit`: every pointer move, link,
 * setting, hide and collection calls it. Answers the row's id, which a
 * channel's move stores as its `live_rev`.
 */
export async function writeAudit(tx: ReleaseDb, row: AuditRow): Promise<number> {
  const { actor } = row;
  const [inserted] = await tx
    .insert(engineReleaseAudit)
    .values({
      projectId: row.projectId,
      actorKind: actor.kind,
      actorId: actor.kind === "system" ? null : actor.userId,
      agentTokenId: actor.kind === "agent" ? (actor.agentTokenId ?? null) : null,
      action: row.action,
      releaseId: row.releaseId ?? null,
      channel: row.channel ?? null,
      fromRelease: row.fromRelease ?? null,
      toRelease: row.toRelease ?? null,
      sceneId: row.sceneId ?? null,
      sceneVersionId: row.sceneVersionId ?? null,
      detail: row.detail ?? {},
      ...(row.at ? { at: row.at } : {}),
    })
    .returning({ id: engineReleaseAudit.id });
  if (!inserted) throw new Error("engine_release_audit: the insert returned no row");
  return inserted.id;
}
