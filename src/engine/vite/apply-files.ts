import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as Y from "yjs";

import { holdReferrers, sessionPrefabSource, trashedInUse } from "../collab/prefab-source";
import { applyProjectBatch } from "../collab/project-apply";
import { buildHashes, createProjectSession, type OpenDoc } from "../collab/project-session";
import type { AwarenessLike, DocOrigin } from "../collab/types";
import type { ContentStore } from "../project/content-store";
import { docNameOf } from "../project/doc-names";
import { formatAssetDoc, parseAssetDoc, type KindEnv } from "../project/kinds";
import type { ProjectApplyResult, ProjectOpBatch } from "../project/ops";
import { snapshotProject, type ProjectSnapshot } from "../project/snapshot";
import type { AssetEntry, AssetId, BuildStamp, ProjectView } from "../project/types";
import { projectView } from "../project/view";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { ENGINE_VERSION } from "../version";
import { fileContentStore } from "./content-store";
import { createProjectFileAdapter, DISK_ORIGIN, type FileProject } from "./project-files";

export type FileApplyOptions = {
  /** Who the batch's history entries and stamps name; default the `disk` origin. */
  origin?: DocOrigin;
  /** Check and apply in memory, writing nothing. */
  dryRun?: boolean;
  /**
   * Where blob bytes are read from to inspect them; default the project's dev
   * cache, which a write copies binaries from. A dry run can hold bytes it
   * mustn't store here.
   */
  store?: ContentStore;
  /** When this build was made, for the project's build stamps; default now. */
  buildAt?: number;
  now?: () => number;
};

/** An awareness nobody else sees: file batches have no peers. */
function localAwareness(doc: Y.Doc): AwarenessLike {
  const states = new Map<number, Record<string, unknown>>();
  return {
    clientID: doc.clientID,
    getLocalState: () => states.get(doc.clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(doc.clientID, { ...states.get(doc.clientID), [field]: value });
    },
    getStates: () => states,
    on() {},
    off() {},
  };
}

/** The op that created or moved the blocked asset: the one naming its id, else the first scene edit. */
function blockedAt(batch: ProjectOpBatch, issue: SceneIssue): number {
  const id = issue.entityIds[0];
  const named = batch.ops.findIndex(
    (op) =>
      ("id" in op && op.id === id) || ("ids" in op && id !== undefined && op.ids.includes(id)),
  );
  if (named >= 0) return named;
  return Math.max(
    0,
    batch.ops.findIndex((op) => op.op === "editScene"),
  );
}

/** The `editScene` op that removes prefab `id`, else the first scene edit. */
function removedAt(batch: ProjectOpBatch, id: AssetId): number {
  const at = batch.ops.findIndex(
    (op) =>
      op.op === "editScene" &&
      op.ops.some((o) => o.op === "definePrefab" && o.id === id && o.prefab === null),
  );
  return at >= 0
    ? at
    : Math.max(
        0,
        batch.ops.findIndex((op) => op.op === "editScene"),
      );
}

/**
 * Assets the batch trashed other than through `deleteAsset` (a prefab an
 * `editScene` removed) whose id no live asset holds now.
 */
function trashedByEdits(
  before: ProjectView,
  after: ProjectView,
  batch: ProjectOpBatch,
): AssetEntry[] {
  const deleted = new Set(batch.ops.flatMap((op) => (op.op === "deleteAsset" ? [op.id] : [])));
  return [...before.byId.values()].filter(
    (e) =>
      !deleted.has(e.id) && !after.byId.has(e.id) && after.deleted.some((d) => d.key === e.key),
  );
}

/**
 * The project as its files are now, pinned by content: each live doc
 * asset by the hash of its canonical text (its raw text when it doesn't
 * parse), each binary by its bytes, and this code's schema hashes as the
 * build. What a file batch's `base` names.
 */
export async function snapshotFiles(project: FileProject): Promise<ProjectSnapshot> {
  const { state } = await createProjectFileAdapter(project).scan();
  const view = projectView(state, project.kinds);
  const env: KindEnv = { registry: project.registry, project: null };
  const texts = new Map<AssetId, string>();
  for (const entry of view.byId.values()) {
    const def = project.kinds.get(entry.kind);
    if (def?.storage !== "doc") continue;
    const text = await readFile(join(project.dir, ...entry.path.split("/")), "utf8");
    const parsed = parseAssetDoc(def, text, env);
    texts.set(entry.id, parsed.ok ? formatAssetDoc(def, parsed.value) : text);
  }
  const hashes = await buildHashes(project.kinds, project.registry);
  const build: Record<string, BuildStamp> = {};
  for (const [kind, hash] of Object.entries(hashes))
    build[kind] = { hash, buildAt: 0, engine: ENGINE_VERSION };
  return snapshotProject(view, texts, build);
}

/**
 * Applies a project batch to the project's files the way the dev server
 * applies one live: the docs it touches are loaded through the file
 * adapter into an in-memory session, `applyProjectBatch` checks and writes
 * them, and the adapter stores what changed (files, sidecars, moves, the
 * trash and the dev cache). A failing batch writes nothing, and neither does
 * one that would put an asset where something on disk the registry doesn't
 * list already sits (`path-taken`), dry run or not. A batch whose
 * `base` isn't the files' snapshot hash (`snapshotFiles`) fails with
 * `stale-base` before anything is read.
 */
export async function applyProjectBatchToFiles(
  project: FileProject,
  batch: ProjectOpBatch,
  opts: FileApplyOptions = {},
): Promise<ProjectApplyResult> {
  if (batch.base !== undefined) {
    const { hash } = await snapshotFiles(project);
    if (hash !== batch.base)
      return {
        ok: false,
        opIndex: 0,
        issue: makeIssue("stale-base", {
          message: `The batch was written against project snapshot ${batch.base}, but the files are now ${hash}.`,
          path: "/base",
          expected: batch.base,
          got: hash,
          hint: "Re-read the project and rebuild the batch against the current snapshot hash.",
        }),
      };
  }

  const origin = opts.origin ?? DISK_ORIGIN;
  const adapter = createProjectFileAdapter(project, opts.now ? { now: opts.now } : {});
  const projectName = docNameOf({ kind: "project", project: project.file.id });
  const projectDoc = new Y.Doc();
  await adapter.loadProject(projectDoc);
  const docs = new Map<string, Y.Doc>();
  const openDoc: OpenDoc = async (name) => {
    if (name === projectName)
      return { doc: projectDoc, awareness: localAwareness(projectDoc), close() {} };
    let doc = docs.get(name);
    if (!doc) {
      doc = new Y.Doc();
      await adapter.loadDoc(name, doc);
      docs.set(name, doc);
    }
    return { doc, awareness: localAwareness(doc), close() {} };
  };

  const session = await createProjectSession({
    project: project.file.id,
    openDoc,
    origin,
    registry: project.registry,
    kinds: project.kinds,
    store: opts.store ?? fileContentStore(project.cacheDir),
    buildAt: opts.buildAt ?? Date.now(),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const prefabs = sessionPrefabSource(session);
  try {
    await prefabs.ready();
    const before = session.view();
    const result = await applyProjectBatch(session, batch, origin);
    if (!result.ok) return result;
    // The batch's own edits to other scenes land before its prefab removals, so a reference one of
    // them added is only seen here, before anything is stored.
    const trashed = trashedByEdits(before, session.view(), batch);
    if (trashed.length > 0) {
      const release = await holdReferrers(session);
      try {
        const inUse = trashedInUse(session, trashed);
        if (inUse)
          return { ok: false, opIndex: removedAt(batch, inUse.entityIds[0] ?? ""), issue: inUse };
      } finally {
        release();
      }
    }
    const blocked = await adapter.blockedWrite(projectDoc);
    if (blocked) return { ok: false, opIndex: blockedAt(batch, blocked), issue: blocked };
    if (!opts.dryRun) {
      await adapter.storeProject(projectDoc);
      for (const [name, doc] of docs) await adapter.storeDoc(name, doc);
    }
    return result;
  } finally {
    prefabs.destroy();
    session.destroy();
  }
}
