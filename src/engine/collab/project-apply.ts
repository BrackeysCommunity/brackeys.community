import * as Y from "yjs";

import { stableJson } from "../project/canonical";
import type { ContentStore } from "../project/content-store";
import { docNameOf } from "../project/doc-names";
import { inspectEntry } from "../project/inspect/entry";
import type { BlobKindDef, KindRegistry } from "../project/kinds";
import { isPlainObject } from "../project/kinds/define";
import type { BlobInspect } from "../project/ops";
import {
  checkProjectBatch,
  SCENE_KIND_NAME,
  writesPrefabs,
  type EditSceneOp,
  type ProjectApplyResult,
  type ProjectBatchCheck,
  type ProjectBatchEnv,
  type ProjectOpBatch,
  type ProjectOpName,
} from "../project/ops";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  ProjectState,
  ProjectView,
  Sha256,
} from "../project/types";
import { projectView } from "../project/view";
import { makeIssue } from "../scene/issues";
import type { EntryTags } from "../scene/ops";
import { PREFAB_KIND, type Prefab, type SceneDefinition, type SceneIssue } from "../scene/types";
import { applyOpsToDoc, writeScene } from "./apply";
import {
  docMeta,
  docToScene,
  isPrefabDoc,
  prefabHeaderMap,
  readDoc,
  sceneMap,
  sceneToDoc,
  settingsMap,
} from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { layoutFromDoc, layoutPatch } from "./layout";
import { appendLog, fingerprint, LOG_CAP, logArray, readLog, sameValue } from "./log";
import { docToPrefab, PREFAB_HEADER_KEY } from "./prefab-doc";
import { projectAssetsMap, readProject, writeEntry, writeProjectState } from "./project-doc";
import { appendProjectLog } from "./project-log";
import type { PrefabPlan, ProjectSession, SessionDoc } from "./project-session";
import { contentLogKey } from "./revert";
import {
  INSTANCE_KEY_PREFIX,
  SCENE_KEY,
  SETTINGS_KEY,
  type DocOrigin,
  type LogEntry,
  type ProjectLogEntry,
} from "./types";
import type { StepSelection } from "./undo-coordinator";

export type RegistryApplyOptions = Pick<ProjectBatchEnv, "registry" | "kinds" | "inspect"> &
  Partial<Pick<ProjectBatchEnv, "now" | "by" | "newKey">> & {
    /** Current values of the doc assets the batch names, by id. */
    docs?: ReadonlyMap<AssetId, unknown>;
    /** The history label; default the batch's own, else one made from its ops. */
    label?: string;
    /** The other docs this batch wrote, each with its own log entry id, listed after the project doc. */
    alsoWrote?: readonly { doc: string; entry: string }[];
  };

export type RegistryApplyResult =
  | (Extract<ProjectApplyResult, { ok: true }> & {
      /** What the check left: the doc values and keys a caller writing the asset docs needs. */
      check: Extract<ProjectBatchCheck, { ok: true }>;
    })
  | Extract<ProjectApplyResult, { ok: false }>;

/** Who a `created` or `deleted` stamp names. */
export function actorId(origin: DocOrigin): string {
  switch (origin.kind) {
    case "user":
      return origin.userId;
    case "agent":
      return origin.agentId;
    default:
      return origin.kind;
  }
}

/** Ops that write docs other than the project doc. */
const DOC_OPS: readonly ProjectOpName[] = ["changeAssetId", "editAsset", "editScene"];

function batchLabel(batch: ProjectOpBatch): string {
  if (batch.label) return batch.label;
  const names = [...new Set(batch.ops.map((op) => op.op))];
  return names.length === 1 ? names[0]! : `${batch.ops.length} project ops`;
}

/** Appends a project log entry that lists the project doc itself (by the entry's own id) first. */
function logBatch(
  doc: Y.Doc,
  state: ProjectState,
  input: { actor: DocOrigin; label: string; at: number },
  alsoWrote: readonly { doc: string; entry: string }[] = [],
): ProjectLogEntry {
  const id = randomKey();
  const self = docNameOf({ kind: "project", project: state.meta.projectId });
  return appendProjectLog(doc, { id, ...input, docs: [{ doc: self, entry: id }, ...alsoWrote] });
}

/**
 * `writeProjectState`, with a blob's content written as one unit: where the
 * hash changed, its size and meta are set beside it even when they didn't
 * change (an absent meta as null), so of two concurrent replaces one
 * writer's hash, size and meta win together, never a mix. Call inside the
 * batch's transaction.
 */
function writeState(doc: Y.Doc, prev: ProjectState, next: ProjectState): void {
  writeProjectState(doc, prev, next);
  const assets = projectAssetsMap(doc);
  for (const [key, entry] of Object.entries(next.assets)) {
    const before = prev.assets[key];
    const map = assets.get(key);
    if (!before || before.sha256 === entry.sha256 || !(map instanceof Y.Map)) continue;
    if (entry.bytes !== undefined && before.bytes === entry.bytes) map.set("bytes", entry.bytes);
    if (entry.meta === undefined) map.set("meta", null);
    else if (sameValue(before.meta, entry.meta)) map.set("meta", structuredClone(entry.meta));
  }
}

/**
 * Applies a batch of registry ops to a project doc: the whole batch is
 * checked against the doc's plain-JSON state first, then written in one
 * transaction with `origin`, together with one project log entry. A batch
 * that changes nothing writes nothing. The ops that edit other docs are
 * refused here; `applyProjectBatch` applies those.
 */
export function applyRegistryBatch(
  doc: Y.Doc,
  batch: ProjectOpBatch,
  origin: DocOrigin,
  opts: RegistryApplyOptions,
): RegistryApplyResult {
  const elsewhere = (Array.isArray(batch.ops) ? batch.ops : []).findIndex(
    (op) => isPlainObject(op) && DOC_OPS.includes(op.op as ProjectOpName),
  );
  if (elsewhere >= 0) {
    const op = (batch.ops[elsewhere] as { op: string }).op;
    return {
      ok: false,
      opIndex: elsewhere,
      issue: makeIssue("op-invalid", {
        message: `${op} edits other docs, so it needs the live project session or the project's files, not the registry alone`,
        path: `/ops/${elsewhere}/op`,
      }),
    };
  }
  const state = readProject(doc);
  const now = opts.now ?? Date.now();
  const check = checkProjectBatch(state, opts.docs ?? new Map(), batch, {
    registry: opts.registry,
    kinds: opts.kinds,
    now,
    by: opts.by ?? actorId(origin),
    newKey: opts.newKey ?? randomKey,
    inspect: opts.inspect,
  });
  if (!check.ok) return check;
  if (!check.registry) return { ok: true, docs: [], created: [], issues: check.issues, check };
  let entry: ProjectLogEntry | undefined;
  doc.transact(() => {
    writeState(doc, state, check.state);
    entry = logBatch(
      doc,
      state,
      { actor: origin, label: opts.label ?? batchLabel(batch), at: now },
      opts.alsoWrote,
    );
  }, origin);
  return {
    ok: true,
    docs: [entry!.docs[0]!.doc],
    created: check.created,
    issues: check.issues,
    entry,
    check,
  };
}

export type RepairResult = {
  /** Whether anything was written. */
  wrote: boolean;
  /** The fixes written: key → the new id and/or path. */
  repaired: ReadonlyMap<AssetKey, { id?: AssetId; path?: AssetPath }>;
  /** The trashed keys brought back. */
  restored: AssetKey[];
  entry?: ProjectLogEntry;
};

/**
 * What the project's one writer runs on store: restores the given trashed
 * keys, then writes `projectView`'s repairs (later duplicates of an id or
 * path get a `-2`, `-3` suffix), in one transaction with a `repair` origin.
 * The repairs are a function of the state alone, so concurrent writers
 * write the same values, and a second call writes nothing.
 */
export function applyRepairs(
  doc: Y.Doc,
  opts: {
    restore?: readonly AssetKey[];
    origin?: Extract<DocOrigin, { kind: "repair" }>;
    now?: number;
  } = {},
): RepairResult {
  const state = readProject(doc);
  const assets: Record<AssetKey, AssetEntry> = { ...state.assets };
  const restored: AssetKey[] = [];
  for (const key of opts.restore ?? []) {
    const entry = assets[key];
    if (!entry?.deleted) continue;
    const { deleted: _deleted, ...rest } = entry;
    assets[key] = rest;
    restored.push(key);
  }
  const { repairs } = projectView({ ...state, assets });
  for (const [key, fix] of repairs) assets[key] = { ...assets[key]!, ...fix };
  if (restored.length === 0 && repairs.size === 0)
    return { wrote: false, repaired: repairs, restored };

  const origin = opts.origin ?? { kind: "repair", reason: "registry" };
  const parts = [
    restored.length > 0 && `Restore ${restored.map((k) => assets[k]!.id).join(", ")}`,
    repairs.size > 0 &&
      `repair ${repairs.size} duplicate id${repairs.size === 1 ? "" : "s"} or path${repairs.size === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const label = parts.join("; ");
  let entry: ProjectLogEntry | undefined;
  doc.transact(() => {
    writeProjectState(doc, state, { ...state, assets });
    entry = logBatch(doc, state, { actor: origin, label, at: opts.now ?? Date.now() });
  }, origin);
  return { wrote: true, repaired: repairs, restored, entry };
}

export type ReinspectResult = {
  wrote: boolean;
  /** The keys whose meta or filled settings were rewritten. */
  reinspected: AssetKey[];
  entry?: ProjectLogEntry;
};

const contentBasis = (e: AssetEntry) =>
  stableJson([e.path, e.sha256 ?? null, e.import ?? {}, e.meta ?? null]);

/**
 * What the project's one writer runs on store, beside `applyRepairs`: every
 * live binary whose bytes `store` holds gets the meta (and filled settings)
 * its bytes and current settings give, in one transaction with a `repair`
 * origin and a project log entry. Settings merge per field, so after two
 * concurrent `setImport`s the meta either client wrote may lag the merged
 * settings; this puts it back, as it does after a move for meta that names
 * paths. Inspection is a pure function, so concurrent
 * writers write the same values, and a second call writes nothing. Bytes the
 * store lacks and inspections that fail are left alone. Pass one `checked`
 * map per doc to skip entries unchanged since the last call.
 */
export async function reinspectBlobs(
  doc: Y.Doc,
  opts: {
    kinds: KindRegistry;
    store: ContentStore;
    origin?: Extract<DocOrigin, { kind: "repair" }>;
    now?: number;
    checked?: Map<AssetKey, string>;
  },
): Promise<ReinspectResult> {
  const checked = opts.checked ?? new Map<AssetKey, string>();
  const view = projectView(readProject(doc), opts.kinds);
  const idAt = (path: AssetPath) => view.byPath.get(path)?.id;
  const fixes = new Map<AssetKey, { basis: string; meta: unknown; import?: unknown }>();
  for (const entry of view.byKey.values()) {
    const def = opts.kinds.get(entry.kind);
    if (def?.storage !== "blob" || entry.deleted || entry.sha256 === undefined) continue;
    const basis = contentBasis(entry);
    if (checked.get(entry.key) === basis) continue;
    const bytes = await opts.store.get(entry.sha256);
    if (!bytes) continue;
    const result = inspectEntry(def as BlobKindDef, entry, bytes, idAt);
    const same =
      !result.ok ||
      (sameValue(entry.meta ?? null, result.meta) &&
        sameValue(entry.import ?? {}, result.import ?? {}));
    if (same) checked.set(entry.key, basis);
    else fixes.set(entry.key, { basis, meta: result.meta, import: result.import });
  }

  // Reading bytes awaited: write only what is still on the content and settings it was inspected for.
  const state = readProject(doc);
  const writes: AssetEntry[] = [];
  for (const [key, fix] of fixes) {
    const current = state.assets[key];
    if (!current || current.deleted || contentBasis(current) !== fix.basis) continue;
    const next: AssetEntry = { ...current, meta: fix.meta as Record<string, unknown> };
    if (fix.import !== undefined) next.import = fix.import as Record<string, unknown>;
    writes.push(next);
  }
  if (writes.length === 0) return { wrote: false, reinspected: [] };
  const origin = opts.origin ?? { kind: "repair", reason: "reinspect" };
  let entry: ProjectLogEntry | undefined;
  doc.transact(() => {
    for (const next of writes) writeEntry(doc, next);
    entry = logBatch(doc, state, {
      actor: origin,
      label: `Re-inspect ${writes.map((e) => e.id).join(", ")}`,
      at: opts.now ?? Date.now(),
    });
  }, origin);
  for (const next of writes) checked.set(next.key, contentBasis(next));
  return { wrote: true, reinspected: writes.map((e) => e.key), entry };
}

// ─── Cross-doc batches ───────────────────────────────────

export type ProjectApplyOptions = {
  /** The history label; default the batch's own, else one made from its ops. */
  label?: string;
  /** The selection around the step, restored when it is undone or redone. */
  selection?: StepSelection;
};

type DocWrite = { doc: string; entry: string };

const failAt = (
  opIndex: number,
  issue: SceneIssue,
): Extract<ProjectApplyResult, { ok: false }> => ({
  ok: false,
  opIndex,
  issue: { ...issue, severity: "error", path: issue.path ?? `/ops/${opIndex}` },
});

/**
 * The plain JSON an open doc holds, the way `checkProjectBatch` and a kind's
 * `refs` read it; undefined for kinds neither reads and for a scene doc not
 * yet seeded.
 */
export function docValue(handle: SessionDoc): unknown {
  if (handle.layout) return layoutFromDoc(handle.doc, handle.layout);
  if (handle.kind === SCENE_KIND_NAME)
    return docMeta(handle.doc) ? docToScene(handle.doc) : undefined;
  if (handle.kind === PREFAB_KIND && isPrefabDoc(handle.doc)) return docToPrefab(handle.doc);
  return undefined;
}

/** A doc's change as its log entry records it. */
type LogParts = Pick<LogEntry, "keys"> & Required<Pick<LogEntry, "before" | "after">>;

/** A declarative doc's change as log parts: one `@content:` key per top-level field that differs. */
function contentDiff(prev: Record<string, unknown>, next: Record<string, unknown>): LogParts {
  const keys: string[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, string | null> = {};
  for (const field of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[field];
    const b = next[field];
    if (sameValue(a ?? null, b ?? null)) continue;
    const key = contentLogKey(field);
    keys.push(key);
    before[key] = a === undefined ? null : structuredClone(a);
    after[key] = b === undefined ? null : fingerprint(b);
  }
  return { keys, before, after };
}

/** Pushes a doc's own log entry under an id chosen before the project entry was written. */
function pushLog(doc: Y.Doc, entry: LogEntry): void {
  const log = logArray(doc);
  log.push([entry]);
  if (log.length > LOG_CAP) log.delete(0, log.length - LOG_CAP);
}

/** Every key a freshly seeded scene doc holds, as a creation's log parts. */
function sceneCreation(doc: Y.Doc): LogParts {
  const view = readDoc(doc);
  const keys: string[] = [...view.records.keys()];
  const after: Record<string, string | null> = {};
  for (const [k, rec] of view.records) after[k] = fingerprint(rec);
  for (const [k, rec] of view.instanceRecords) {
    keys.push(`${INSTANCE_KEY_PREFIX}${k}`);
    after[`${INSTANCE_KEY_PREFIX}${k}`] = fingerprint(rec);
  }
  for (const [k, value] of [
    [SETTINGS_KEY, settingsMap(doc).toJSON()],
    [SCENE_KEY, sceneMap(doc).toJSON()],
  ] as const) {
    keys.push(k);
    after[k] = fingerprint(value);
  }
  return { keys, before: Object.fromEntries(keys.map((k) => [k, null])), after };
}

/**
 * A new scene's content, written into its doc: seeded into an empty one, or
 * over the empty scene a host seeds a doc with when it creates its row.
 */
function writeNewScene(doc: Y.Doc, def: SceneDefinition, key: KeyGen, origin: DocOrigin): LogParts {
  if (!docMeta(doc)) {
    sceneToDoc(def, { doc, key, origin });
    return sceneCreation(doc);
  }
  const { keys, before, after } = writeScene(doc, readDoc(doc), def, NO_TAGS, key);
  return { keys, before, after };
}

const NO_TAGS: EntryTags = { entities: [], buckets: new Map(), instances: [] };

/** A detached copy of a doc's state, to try a write on. */
function copyOf(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

/** Reads the bytes blob ops name, so their inspection runs on what the store holds. */
async function blobBytes(
  session: ProjectSession,
  batch: ProjectOpBatch,
  view: ProjectView,
): Promise<Map<Sha256, Uint8Array>> {
  const out = new Map<Sha256, Uint8Array>();
  const store = session.store;
  if (!store || !Array.isArray(batch.ops)) return out;
  const hashes = new Set<Sha256>();
  for (const op of batch.ops) {
    if (!isPlainObject(op)) continue;
    if ((op.op === "importAsset" || op.op === "replaceContent") && typeof op.sha256 === "string")
      hashes.add(op.sha256);
    if (op.op === "setImport" && typeof op.id === "string") {
      const hash = view.byId.get(op.id)?.sha256;
      if (hash) hashes.add(hash);
    }
  }
  for (const hash of hashes) {
    const bytes = await store.get(hash);
    if (bytes) out.set(hash, bytes);
  }
  return out;
}

function storeInspect(bytes: ReadonlyMap<Sha256, Uint8Array>, view: ProjectView): BlobInspect {
  return (def, entry) => {
    const held = entry.sha256 === undefined ? undefined : bytes.get(entry.sha256);
    if (!held)
      return {
        ok: false,
        issue: makeIssue("hash-mismatch", {
          message: `the content store holds no bytes with sha256 ${entry.sha256 ?? "(none)"}; upload them first`,
          ...(entry.sha256 ? { got: entry.sha256 } : {}),
        }),
      };
    return inspectEntry(def, entry, held, (path) => view.byPath.get(path)?.id);
  };
}

/** A request for a prefab write the batch's check asked about, keyed by where it came from. */
type PrefabRequest = { index: number; op: EditSceneOp; entry: AssetEntry };

const planKey = (index: number, op: EditSceneOp) => `${index}:${stableJson(op)}`;

/** Ops whose check reads every doc that can name another asset: those that rename or trash one. */
const readsReferrers = (op: Record<string, unknown>) =>
  op.op === "changeAssetId" ||
  op.op === "deleteAsset" ||
  (op.op === "editScene" &&
    Array.isArray(op.ops) &&
    op.ops.some((o) => isPlainObject(o) && o.op === "definePrefab" && o.prefab === null));

/**
 * Applies a project batch across docs. Every doc the batch touches is
 * opened first (for `changeAssetId` and `deleteAsset`, every doc that
 * can hold a reference), and the whole batch is checked with
 * `checkProjectBatch` against their plain JSON; a failing op, or a doc it
 * writes that this build may only read (`code-skew`), writes nothing
 * anywhere. Then each doc gets exactly one transaction with `origin` and
 * its own log entry: `editAsset` through `layoutPatch`, `editScene`
 * through `applyOpsToDoc` (ops that write prefabs through
 * `session.prefabWriter`), new assets' content as the first edit of their
 * docs. `changeAssetId` writes the entry, the prefab header of a prefab,
 * and every referrer the same way. A batch that wrote two or more docs
 * also appends one project log entry naming each doc's entry. When
 * `origin` is the session's, the batch is one undo step.
 */
export async function applyProjectBatch(
  session: ProjectSession,
  batch: ProjectOpBatch,
  origin: DocOrigin,
  opts: ProjectApplyOptions = {},
): Promise<ProjectApplyResult> {
  const ops: unknown[] = isPlainObject(batch) && Array.isArray(batch.ops) ? batch.ops : [];
  const first = session.view();
  /** Docs the ops name, by asset id; a code-skewed one refuses the batch before it is checked. */
  const reads = new Map<AssetId, { index: number; name: string; kind: AssetKindName }>();
  /** Docs read only to find references; one refuses the batch only when the batch writes it. */
  const scans = new Map<AssetId, { name: string; kind: AssetKindName }>();
  const prefabOps: PrefabRequest[] = [];
  let renames = false;
  let scanAll = false;
  for (const [index, op] of ops.entries()) {
    if (!isPlainObject(op)) continue;
    if (op.op === "createAsset" && typeof op.kind === "string") {
      const skew = session.skewFor(op.kind);
      if (skew) return failAt(index, { ...skew, path: `/ops/${index}/kind` });
      const def = session.kinds.get(op.kind);
      if (def?.storage === "doc" && def.layout === "custom" && def.kind !== SCENE_KIND_NAME)
        return failAt(
          index,
          makeIssue("op-invalid", {
            message: `creating a ${def.kind} writes its doc through the project's prefab writer, which needs the project`,
            path: `/ops/${index}/kind`,
          }),
        );
    }
    if (readsReferrers(op)) scanAll = true;
    if (op.op === "changeAssetId" && typeof op.id === "string") {
      renames = true;
      const entry = first.byId.get(op.id);
      const name = entry && session.docNameFor(entry);
      if (entry && name) scans.set(entry.id, { name, kind: entry.kind });
    }
    if ((op.op !== "editAsset" && op.op !== "editScene") || typeof op.id !== "string") continue;
    const entry = first.byId.get(op.id);
    if (!entry) continue;
    if (op.op === "editScene" && writesPrefabs(op as EditSceneOp, entry.kind)) {
      prefabOps.push({ index, op: op as EditSceneOp, entry });
      continue;
    }
    const name = session.docNameFor(entry);
    if (name && !reads.has(op.id)) reads.set(op.id, { index, name, kind: entry.kind });
  }
  if (scanAll)
    for (const entry of first.byId.values()) {
      const def = session.kinds.get(entry.kind);
      const name = def?.storage === "doc" && def.refs ? session.docNameFor(entry) : null;
      if (name) scans.set(entry.id, { name, kind: entry.kind });
    }
  for (const id of reads.keys()) scans.delete(id);
  const held: string[] = [];
  const plans = new Map<string, { index: number; plan: PrefabPlan }>();
  try {
    for (const { name } of [...reads.values(), ...scans.values()]) {
      await session.open(name);
      held.push(name);
    }
    const plan = async (r: PrefabRequest) =>
      plans.set(planKey(r.index, r.op), {
        index: r.index,
        plan: await session.prefabWriter.plan({ session, ...r }),
      });
    for (const p of prefabOps) await plan(p);
    const bytes = await blobBytes(session, batch, first);

    const checkWith = (
      prefabEdit: NonNullable<ProjectBatchEnv["prefabEdit"]>,
      newKey: ProjectBatchEnv["newKey"],
      now: number,
    ) => {
      const docs = new Map<AssetId, unknown>();
      for (const [id, { name }] of [...reads, ...scans]) {
        const value = docValue(session.get(name)!);
        if (value !== undefined) docs.set(id, value);
      }
      const state = session.state();
      const check = checkProjectBatch(state, docs, batch, {
        registry: session.registry,
        kinds: session.kinds,
        now,
        by: actorId(origin),
        newKey,
        ...(session.store
          ? { inspect: storeInspect(bytes, projectView(state, session.kinds)) }
          : {}),
        prefabsFor: () => session.prefabLibrary(),
        prefabEdit,
      });
      return { state, check };
    };

    // A changeAssetId asks the prefab writer about each prefab that names the asset: plan those
    // the way the batch's own prefab ops were planned, then check again.
    if (renames)
      for (let round = 0; round < 4; round++) {
        const wanted: PrefabRequest[] = [];
        let n = 0;
        const { check } = checkWith(
          (op, ctx) => {
            const known = plans.get(planKey(ctx.index, op))?.plan;
            if (known) return known.ok ? null : known.issue;
            if (first.byId.has(ctx.entry.id)) wanted.push({ op, ...ctx });
            return null;
          },
          () => `planning-${n++}`,
          session.now(),
        );
        if (!check.ok || wanted.length === 0) break;
        for (const w of wanted) await plan(w);
      }

    // Nothing awaits from here to the last existing doc's write, so no update lands in between.
    for (const { index, name } of reads.values()) {
      const issue = session.get(name)?.issue;
      if (issue) return failAt(index, issue);
    }
    for (const { index, plan: p } of plans.values())
      if (p.ok)
        for (const name of p.docs) {
          const issue = session.get(name)?.issue;
          if (issue) return failAt(index, issue);
        }
    const now = session.now();
    const accepted: PrefabPlan[] = [];
    const { state, check } = checkWith(
      (op, { index, entry }) => {
        const known = plans.get(planKey(index, op))?.plan;
        if (!known)
          return makeIssue("op-invalid", {
            message: first.byId.has(entry.id)
              ? `"${entry.id}" changed while the batch was being planned; apply it again`
              : `"${op.id}" is new in this batch; prefab writes need it to exist first`,
            entityIds: [entry.id],
          });
        if (!known.ok) return known.issue;
        accepted.push(known);
        return null;
      },
      session.key,
      now,
    );
    if (!check.ok) return check;
    for (const key of check.written) {
      if (!state.assets[key]) continue;
      const name = session.docNameFor(check.state.assets[key]!);
      const issue = name ? session.get(name)?.issue : undefined;
      if (issue) return failAt(check.writtenBy.get(key) ?? 0, issue);
    }

    const label = opts.label ?? batchLabel(batch);
    const created: { name: string; key: AssetKey; id: string }[] = [];
    const sole = check.written.length === 1 && accepted.length === 0 && !check.registry;

    // Every existing doc's write is worked out before the first one lands, so a doc that refuses
    // its part fails the batch with nothing written anywhere.
    const writes: (() => DocWrite | null)[] = [];
    for (const key of check.written) {
      const entry = check.state.assets[key]!;
      const name = session.docNameFor(entry)!;
      if (!state.assets[key]) {
        created.push({ name, key, id: randomKey() });
        continue;
      }
      const open = session.get(name);
      if (!open) throw new Error(`applyProjectBatch: "${name}" was written but never opened`);
      const next = check.values.get(key);
      if (open.layout) {
        const layout = open.layout;
        const change = contentDiff(
          layoutFromDoc(open.doc, layout),
          next as Record<string, unknown>,
        );
        if (change.keys.length === 0) continue;
        writes.push(() => {
          let logged: LogEntry | undefined;
          open.doc.transact(() => {
            layoutPatch(open.doc, layout, next, origin, { key: session.key });
            logged = appendLog(open.doc, { actor: origin, label, at: now, ...change });
          }, origin);
          return { doc: name, entry: logged!.id };
        });
        continue;
      }
      if (entry.kind === PREFAB_KIND) {
        writes.push(() => {
          const logged = writePrefabId(open.doc, (next as Prefab).id, origin, label, now);
          return logged ? { doc: name, entry: logged.id } : null;
        });
        continue;
      }
      const scene = check.scenes.get(key);
      if (!scene) throw new Error(`applyProjectBatch: "${name}" was written with no scene ops`);
      const run = (doc: Y.Doc, extra: { key: KeyGen; noLog?: true }) =>
        applyOpsToDoc(doc, { ops: scene.ops, label }, origin, scene.registry, {
          label,
          ...(scene.prefabs ? { prefabs: scene.prefabs } : {}),
          ...extra,
        });
      const at = check.writtenBy.get(key) ?? 0;
      if (sole) {
        const result = run(open.doc, { key: session.key });
        if (!result.ok) return failAt(at, result.issue);
        if (result.keys.length > 0)
          writes.push(() => ({ doc: name, entry: readLog(open.doc).at(-1)!.id }));
        continue;
      }
      const copy = copyOf(open.doc);
      const trial = run(copy, { key: randomKey, noLog: true });
      copy.destroy();
      if (!trial.ok) return failAt(at, trial.issue);
      if (trial.keys.length === 0) continue;
      writes.push(() => {
        const result = run(open.doc, { key: session.key });
        if (!result.ok)
          throw new Error(
            `applyProjectBatch: "${name}" refused ops its copy accepted: ${result.issue.message}`,
          );
        return result.keys.length > 0 ? { doc: name, entry: readLog(open.doc).at(-1)!.id } : null;
      });
    }

    const written: DocWrite[] = [];
    for (const write of writes) {
      const w = write();
      if (w) written.push(w);
    }
    for (const p of accepted) if (p.ok) written.push(...p.write(origin));

    const writesProject = check.registry;
    const total = written.length + created.length + (writesProject ? 1 : 0);
    let entry: ProjectLogEntry | undefined;
    if (writesProject || total > 1) {
      const id = randomKey();
      const self = writesProject ? [{ doc: session.name, entry: id }] : [];
      const later = created.map((c) => ({ doc: c.name, entry: c.id }));
      session.projectDoc.transact(() => {
        if (writesProject) writeState(session.projectDoc, state, check.state);
        entry = appendProjectLog(session.projectDoc, {
          id,
          actor: origin,
          label,
          at: now,
          docs: [...written, ...self, ...later],
        });
      }, origin);
      if (writesProject) written.push({ doc: session.name, entry: id });
    }

    const commit = () => {
      if (origin === session.origin)
        session.commit({
          docs: written.map((w) => w.doc),
          label,
          ...(opts.selection ? { selection: opts.selection } : {}),
        });
    };
    // A new doc opens once the registry names it (a host may admit it only then). One that
    // can't open leaves what was written as one undo step.
    try {
      for (const c of created) {
        const open = await session.open(c.name);
        held.push(c.name);
        const value = check.values.get(c.key);
        open.doc.transact(() => {
          let change: LogParts;
          if (open.layout) {
            layoutPatch(open.doc, open.layout, value, origin, { key: session.key });
            change = contentDiff({}, value as Record<string, unknown>);
          } else change = writeNewScene(open.doc, value as SceneDefinition, session.key, origin);
          pushLog(open.doc, { id: c.id, actor: origin, label, at: now, ...change });
        }, origin);
        written.push({ doc: c.name, entry: c.id });
      }
    } catch (error) {
      commit();
      throw error;
    }

    commit();
    return {
      ok: true,
      docs: written.map((w) => w.doc),
      created: check.created,
      issues: check.issues,
      ...(entry ? { entry } : {}),
    };
  } finally {
    for (const name of held) session.release(name);
    for (const { plan } of plans.values()) if (plan.ok) plan.release?.();
  }
}

/** Sets a prefab doc's header id, in one transaction with its log entry; null when it already has it. */
function writePrefabId(
  doc: Y.Doc,
  id: string,
  origin: DocOrigin,
  label: string,
  at: number,
): LogEntry | null {
  const header = prefabHeaderMap(doc);
  const prev = header.get("id") ?? "";
  if (prev === id) return null;
  const contract = header.get("contract");
  const withContract = (of: unknown) => ({
    id: of,
    ...(contract !== undefined ? { contract: structuredClone(contract) } : {}),
  });
  let logged: LogEntry | undefined;
  doc.transact(() => {
    header.set("id", id);
    logged = appendLog(doc, {
      actor: origin,
      label,
      at,
      keys: [PREFAB_HEADER_KEY],
      before: { [PREFAB_HEADER_KEY]: withContract(prev) },
      after: { [PREFAB_HEADER_KEY]: fingerprint(withContract(id)) },
    });
  }, origin);
  return logged!;
}
