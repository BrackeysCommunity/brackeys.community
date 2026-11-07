/** Where hosted scene docs live: Postgres in production, memory in tests. */

export interface StoredScene {
  /** Null until the first store; the server then seeds from `seed`. */
  state: Uint8Array | null;
  /** The JSON the web app created the scene from; null for an empty scene. */
  seed: string | null;
  schemaVersion: number | null;
}

export interface SceneSnapshotWrite {
  /** `formatScene` text. */
  text: string;
  hash: string;
}

export interface SceneWrite {
  state: Uint8Array;
  schemaVersion: number;
  /** Absent: keep the stored snapshot. */
  snapshot?: SceneSnapshotWrite;
}

export type SceneRefusal = {
  refused: "too-large" | "too-many-entities";
  bytes: number;
  entities: number;
};

/** Given what is stored, what to write instead. */
export type SceneMerge = (stored: Uint8Array | null) => Promise<SceneWrite | SceneRefusal>;

export type SceneWriteOutcome =
  | { kind: "gone" }
  | { kind: "unchanged" }
  | { kind: "stored"; bytes: number }
  | ({ kind: "refused" } & SceneRefusal);

export interface SceneStore {
  /** Null when there is no such scene. */
  load(sceneId: string): Promise<StoredScene | null>;
  /** Whether the scene exists, and the format version stored; cheaper than `load`. */
  head(sceneId: string): Promise<{ schemaVersion: number | null } | null>;
  /**
   * Holds the scene's row for the length of `merge`, so two instances
   * storing one scene take turns and the second merges into the first's
   * write, then writes what `merge` returns.
   */
  write(
    sceneId: string,
    merge: SceneMerge,
    edit: { editorId: string | null; now: Date },
  ): Promise<SceneWriteOutcome>;
}

export const isRefusal = (value: SceneWrite | SceneRefusal): value is SceneRefusal =>
  "refused" in value;

export function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface MemorySceneRow extends StoredScene {
  snapshot: string | null;
  sceneHash: string | null;
  byteSize: number;
  lastEditedById: string | null;
  lastEditedAt: Date | null;
}

/** A `SceneStore` in memory, shareable between server instances in one process. */
export class MemorySceneStore implements SceneStore {
  readonly rows = new Map<string, MemorySceneRow>();
  private readonly locks = new Map<string, Promise<unknown>>();
  writes = 0;

  /** What the web app does when a hosted scene is created. */
  create(sceneId: string, seed: string | null = null): void {
    this.rows.set(sceneId, {
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

  delete(sceneId: string): void {
    this.rows.delete(sceneId);
  }

  async load(sceneId: string): Promise<StoredScene | null> {
    const row = this.rows.get(sceneId);
    return row ? { state: row.state, seed: row.seed, schemaVersion: row.schemaVersion } : null;
  }

  async head(sceneId: string): Promise<{ schemaVersion: number | null } | null> {
    const row = this.rows.get(sceneId);
    return row ? { schemaVersion: row.schemaVersion } : null;
  }

  async write(
    sceneId: string,
    merge: SceneMerge,
    edit: { editorId: string | null; now: Date },
  ): Promise<SceneWriteOutcome> {
    const previous = this.locks.get(sceneId) ?? Promise.resolve();
    const run = previous.then(async (): Promise<SceneWriteOutcome> => {
      const row = this.rows.get(sceneId);
      if (!row) return { kind: "gone" };
      const next = await merge(row.state);
      if (isRefusal(next)) return { kind: "refused", ...next };
      if (sameBytes(row.state, next.state) && !next.snapshot) return { kind: "unchanged" };
      this.writes++;
      row.state = next.state;
      row.byteSize = next.state.byteLength;
      row.schemaVersion = next.schemaVersion;
      if (next.snapshot) {
        row.snapshot = next.snapshot.text;
        row.sceneHash = next.snapshot.hash;
      }
      if (edit.editorId) {
        row.lastEditedById = edit.editorId;
        row.lastEditedAt = edit.now;
      }
      return { kind: "stored", bytes: next.state.byteLength };
    });
    const settled = run.catch(() => {});
    this.locks.set(sceneId, settled);
    void settled.then(() => {
      if (this.locks.get(sceneId) === settled) this.locks.delete(sceneId);
    });
    return run;
  }
}
