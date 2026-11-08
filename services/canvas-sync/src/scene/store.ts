/** Hosted scene docs: one `EngineDocStore` over `scene_docs`. */
import {
  MemoryDocStore,
  type DocMerge,
  type DocSnapshotWrite,
  type DocWrite,
  type DocWriteOutcome,
  type EngineDocStore,
  type MemoryDocRow,
  type StoredDoc,
} from "../engine/doc-store.ts";

export { isRefusal, sameBytes } from "../engine/doc-store.ts";

export type StoredScene = StoredDoc;
export type SceneSnapshotWrite = DocSnapshotWrite;
export type SceneWrite = DocWrite;

export type SceneRefusal = {
  refused: "too-large" | "too-many-entities";
  bytes: number;
  entities: number;
};

export type SceneMerge = DocMerge<SceneRefusal>;
export type SceneWriteOutcome = DocWriteOutcome<SceneRefusal>;
export type SceneStore = EngineDocStore<SceneRefusal>;

export const SCENE_KIND = "scene";

export interface MemorySceneRow extends MemoryDocRow {
  sceneHash: string | null;
}

/** `scene_docs` in memory, shareable between server instances in one process. */
export class MemorySceneStore extends MemoryDocStore<MemorySceneRow, SceneRefusal> {
  constructor() {
    super((row, hash) => {
      row.sceneHash = hash;
    });
  }

  /** What the web app does when a hosted scene is created. */
  create(sceneId: string, seed: string | null = null): void {
    this.rows.set(sceneId, {
      kind: SCENE_KIND,
      state: null,
      seed,
      schemaVersion: null,
      snapshot: null,
      sceneHash: null,
      byteSize: 0,
      lastEditedById: null,
      lastEditedAt: null,
    });
  }
}
