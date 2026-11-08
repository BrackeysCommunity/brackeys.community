import { and, eq, sql, type SQL } from "drizzle-orm";

import { engineAssetDocs, engineProjects, sceneDocs, user } from "../../../../src/db/schema.ts";
import type { ServiceDb } from "../db.ts";

/**
 * Where hosted engine docs live: Postgres in production, memory in tests.
 * One store per table; a doc id is `<project>.<key>`.
 */

export interface StoredDoc {
  /** Null until the first store; the server then seeds from `seed`. */
  state: Uint8Array | null;
  /** What the doc was created from; null for an empty doc. */
  seed: string | null;
  schemaVersion: number | null;
}

export interface DocHead {
  schemaVersion: number | null;
  /** The asset kind the row was created as (`scene` for scenes). */
  kind: string;
}

export interface DocSnapshotWrite {
  /** The doc's canonical text. */
  text: string;
  hash: string;
}

export interface DocWrite {
  state: Uint8Array;
  schemaVersion: number;
  /** Absent: keep the stored snapshot. */
  snapshot?: DocSnapshotWrite;
}

export interface DocRefusal {
  refused: string;
  bytes: number;
}

/** Given what is stored, what to write instead. */
export type DocMerge<Refusal extends DocRefusal = DocRefusal> = (
  stored: Uint8Array | null,
) => Promise<DocWrite | Refusal>;

export type DocWriteOutcome<Refusal extends DocRefusal = DocRefusal> =
  | { kind: "gone" }
  | { kind: "unchanged" }
  | { kind: "stored"; bytes: number }
  | ({ kind: "refused" } & Refusal);

export interface DocEdit {
  editorId: string | null;
  now: Date;
}

export interface EngineDocStore<Refusal extends DocRefusal = DocRefusal> {
  /** Null when there is no such doc, or its project is deleted. */
  load(docId: string): Promise<StoredDoc | null>;
  /** Whether the doc exists, its kind and the format version stored; cheaper than `load`. */
  head(docId: string): Promise<DocHead | null>;
  /**
   * Holds the doc's row for the length of `merge`, so two instances
   * storing one doc take turns and the second merges into the first's
   * write, then writes what `merge` returns.
   */
  write(docId: string, merge: DocMerge<Refusal>, edit: DocEdit): Promise<DocWriteOutcome<Refusal>>;
}

export const isRefusal = <Refusal extends DocRefusal>(
  value: DocWrite | Refusal,
): value is Refusal => "refused" in value;

export function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** `<project>.<key>` split at its first dot; null when either part is empty. */
export function splitDocId(docId: string): { projectId: string; key: string } | null {
  const dot = docId.indexOf(".");
  if (dot <= 0 || dot === docId.length - 1) return null;
  return { projectId: docId.slice(0, dot), key: docId.slice(dot + 1) };
}

export interface MemoryDocRow extends StoredDoc {
  kind: string;
  snapshot: string | null;
  byteSize: number;
  lastEditedById: string | null;
  lastEditedAt: Date | null;
}

/** An `EngineDocStore` in memory, shareable between server instances in one process. */
export class MemoryDocStore<
  Row extends MemoryDocRow,
  Refusal extends DocRefusal = DocRefusal,
> implements EngineDocStore<Refusal> {
  readonly rows = new Map<string, Row>();
  /** Soft-deleted projects: their docs read as gone. */
  readonly deletedProjects = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  writes = 0;

  /** `keepHash` records a snapshot's hash in the table's own column. */
  constructor(private readonly keepHash: (row: Row, hash: string) => void) {}

  delete(docId: string): void {
    this.rows.delete(docId);
  }

  deleteProject(projectId: string): void {
    this.deletedProjects.add(projectId);
  }

  private live(docId: string): Row | undefined {
    const project = splitDocId(docId)?.projectId;
    if (project !== undefined && this.deletedProjects.has(project)) return undefined;
    return this.rows.get(docId);
  }

  async load(docId: string): Promise<StoredDoc | null> {
    const row = this.live(docId);
    return row ? { state: row.state, seed: row.seed, schemaVersion: row.schemaVersion } : null;
  }

  async head(docId: string): Promise<DocHead | null> {
    const row = this.live(docId);
    return row ? { schemaVersion: row.schemaVersion, kind: row.kind } : null;
  }

  async write(
    docId: string,
    merge: DocMerge<Refusal>,
    edit: DocEdit,
  ): Promise<DocWriteOutcome<Refusal>> {
    const previous = this.locks.get(docId) ?? Promise.resolve();
    const run = previous.then(async (): Promise<DocWriteOutcome<Refusal>> => {
      const row = this.live(docId);
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
        this.keepHash(row, next.snapshot.hash);
      }
      if (edit.editorId) {
        row.lastEditedById = edit.editorId;
        row.lastEditedAt = edit.now;
      }
      return { kind: "stored", bytes: next.state.byteLength };
    });
    const settled = run.catch(() => {});
    this.locks.set(docId, settled);
    void settled.then(() => {
      if (this.locks.get(docId) === settled) this.locks.delete(docId);
    });
    return run;
  }
}

export interface MemoryAssetDocRow extends MemoryDocRow {
  contentSha256: string | null;
}

/** `engine_asset_docs` in memory. */
export class MemoryAssetDocStore extends MemoryDocStore<MemoryAssetDocRow> {
  constructor() {
    super((row, hash) => {
      row.contentSha256 = hash;
    });
  }

  /** What the service does when a registry gains a doc-kind entry. */
  create(docId: string, kind: string, seed: string | null = null): void {
    this.rows.set(docId, {
      kind,
      state: null,
      seed,
      schemaVersion: null,
      snapshot: null,
      contentSha256: null,
      byteSize: 0,
      lastEditedById: null,
      lastEditedAt: null,
    });
  }
}

type DocTable = typeof sceneDocs | typeof engineAssetDocs;

/** How one table holds engine docs. */
export interface DocTableSpec<Table extends DocTable> {
  table: Table;
  /** The row's condition; null when the id can't name a row here. */
  where(docId: string): SQL | null;
  /** The kind every row holds, or the column that holds it. */
  kind: string | typeof engineAssetDocs.kind;
  /** The column update that records a snapshot's hash. */
  hash(hash: string): Partial<Table["$inferInsert"]>;
}

const bytes = (value: Buffer | null): Uint8Array | null => (value ? new Uint8Array(value) : null);

/** Rows are created elsewhere (the web app, the project kind); a store only reads and merges. */
export function postgresDocStore<Table extends DocTable, Refusal extends DocRefusal = DocRefusal>(
  db: ServiceDb,
  spec: DocTableSpec<Table>,
): EngineDocStore<Refusal> {
  const table: DocTable = spec.table;
  // A soft-deleted project's docs read as gone; a scene from before projects has none.
  const live = sql`not exists (select 1 from ${engineProjects} where ${engineProjects.projectId} = ${table.projectId} and ${engineProjects.deletedAt} is not null)`;
  const rowOf = (docId: string) => {
    const where = spec.where(docId);
    return where ? and(where, live)! : null;
  };

  return {
    async load(docId) {
      const where = rowOf(docId);
      if (!where) return null;
      const [row] = await db
        .select({ state: table.state, seed: table.seed, schemaVersion: table.schemaVersion })
        .from(table)
        .where(where);
      return row
        ? { state: bytes(row.state), seed: row.seed, schemaVersion: row.schemaVersion }
        : null;
    },

    async head(docId) {
      const where = rowOf(docId);
      if (!where) return null;
      const [row] = await db
        .select({
          schemaVersion: table.schemaVersion,
          kind: typeof spec.kind === "string" ? sql<string>`${spec.kind}::text` : spec.kind,
        })
        .from(table)
        .where(where);
      return row ?? null;
    },

    async write(docId, merge, edit) {
      const row = spec.where(docId);
      if (!row) return { kind: "gone" };
      const where = and(row, live)!;
      return db.transaction(async (tx): Promise<DocWriteOutcome<Refusal>> => {
        const [locked] = await tx
          .select({ state: table.state })
          .from(table)
          .where(where)
          .for("update");
        if (!locked) return { kind: "gone" };
        const stored = bytes(locked.state);
        const next = await merge(stored);
        if (isRefusal(next)) return { kind: "refused", ...next };
        if (sameBytes(stored, next.state) && !next.snapshot) return { kind: "unchanged" };
        await tx
          .update(table)
          .set({
            state: Buffer.from(next.state),
            byteSize: next.state.byteLength,
            schemaVersion: next.schemaVersion,
            ...(next.snapshot
              ? { snapshot: next.snapshot.text, ...spec.hash(next.snapshot.hash) }
              : {}),
            // An account deleted mid-session leaves its edits but not its name.
            ...(edit.editorId
              ? {
                  lastEditedById: sql`coalesce((select ${user.id} from ${user} where ${user.id} = ${edit.editorId}), ${table.lastEditedById})`,
                  lastEditedAt: edit.now,
                }
              : {}),
            updatedAt: edit.now,
          })
          .where(row);
        return { kind: "stored", bytes: next.state.byteLength };
      });
    },
  };
}

export const ASSET_DOCS: DocTableSpec<typeof engineAssetDocs> = {
  table: engineAssetDocs,
  where(docId) {
    const id = splitDocId(docId);
    return id
      ? and(eq(engineAssetDocs.projectId, id.projectId), eq(engineAssetDocs.assetKey, id.key))!
      : null;
  },
  kind: engineAssetDocs.kind,
  hash: (contentSha256) => ({ contentSha256 }),
};

/** `canvas.engine_asset_docs`: every doc of a project that isn't a scene or the registry. */
export const postgresAssetDocStore = <Refusal extends DocRefusal = DocRefusal>(db: ServiceDb) =>
  postgresDocStore<typeof engineAssetDocs, Refusal>(db, ASSET_DOCS);
