import { eq } from "drizzle-orm";

import { sceneDocs } from "../../../../src/db/schema.ts";
import type { ServiceDb } from "../db.ts";
import { postgresDocStore, type DocTableSpec } from "../engine/doc-store.ts";
import { SCENE_KIND, type SceneRefusal, type SceneStore } from "./store.ts";

export const SCENE_DOCS: DocTableSpec<typeof sceneDocs> = {
  table: sceneDocs,
  where: (sceneId) => eq(sceneDocs.sceneId, sceneId),
  kind: SCENE_KIND,
  hash: (sceneHash) => ({ sceneHash }),
};

/** `canvas.scene_docs`. Rows are created by the web app; the service only reads and merges. */
export const postgresSceneStore = (db: ServiceDb): SceneStore =>
  postgresDocStore<typeof sceneDocs, SceneRefusal>(db, SCENE_DOCS);
