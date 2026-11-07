import { eq, sql } from "drizzle-orm";

import { sceneDocs, user } from "../../../../src/db/schema.ts";
import type { ServiceDb } from "../db.ts";
import {
  isRefusal,
  sameBytes,
  type SceneMerge,
  type SceneStore,
  type SceneWriteOutcome,
  type StoredScene,
} from "./store.ts";

const bytes = (value: Buffer | null): Uint8Array | null => (value ? new Uint8Array(value) : null);

/** `canvas.scene_docs`. Rows are created by the web app; the service only reads and merges. */
export function postgresSceneStore(db: ServiceDb): SceneStore {
  return {
    async load(sceneId): Promise<StoredScene | null> {
      const [row] = await db
        .select({
          state: sceneDocs.state,
          seed: sceneDocs.seed,
          schemaVersion: sceneDocs.schemaVersion,
        })
        .from(sceneDocs)
        .where(eq(sceneDocs.sceneId, sceneId));
      return row
        ? { state: bytes(row.state), seed: row.seed, schemaVersion: row.schemaVersion }
        : null;
    },

    async head(sceneId) {
      const [row] = await db
        .select({ schemaVersion: sceneDocs.schemaVersion })
        .from(sceneDocs)
        .where(eq(sceneDocs.sceneId, sceneId));
      return row ?? null;
    },

    async write(sceneId, merge: SceneMerge, edit): Promise<SceneWriteOutcome> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ state: sceneDocs.state })
          .from(sceneDocs)
          .where(eq(sceneDocs.sceneId, sceneId))
          .for("update");
        if (!row) return { kind: "gone" };
        const stored = bytes(row.state);
        const next = await merge(stored);
        if (isRefusal(next)) return { kind: "refused", ...next };
        if (sameBytes(stored, next.state) && !next.snapshot) return { kind: "unchanged" };
        await tx
          .update(sceneDocs)
          .set({
            state: Buffer.from(next.state),
            byteSize: next.state.byteLength,
            schemaVersion: next.schemaVersion,
            ...(next.snapshot
              ? { snapshot: next.snapshot.text, sceneHash: next.snapshot.hash }
              : {}),
            // An account deleted mid-session leaves its edits but not its name.
            ...(edit.editorId
              ? {
                  lastEditedById: sql`coalesce((select ${user.id} from ${user} where ${user.id} = ${edit.editorId}), ${sceneDocs.lastEditedById})`,
                  lastEditedAt: edit.now,
                }
              : {}),
            updatedAt: edit.now,
          })
          .where(eq(sceneDocs.sceneId, sceneId));
        return { kind: "stored", bytes: next.state.byteLength };
      });
    },
  };
}
