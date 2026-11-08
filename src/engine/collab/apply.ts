import * as Y from "yjs";

import type { Registry } from "../game/types";
import { byCodeUnit } from "../project/kinds/define";
import {
  applyHeaderOps,
  headerOpAt,
  headerOpOnScene,
  PREFAB_SCENE_OPS,
  remapBodyFailure,
  splitHeaderOps,
} from "../project/ops";
import { bulkKeysOf } from "../scene/expand";
import { sortedAssets } from "../scene/format";
import { sceneHash } from "../scene/hash";
import { makeIssue } from "../scene/issues";
import { applyOpsTracked, type EntryTags } from "../scene/ops";
import { usesBulkRefs } from "../scene/ops-schema";
import { PREFAB_KIND } from "../scene/prefab";
import {
  RESERVED_SCENE_KEYS,
  type ApplyOptions,
  type ApplyResult,
  type Bounds,
  type BulkKey,
  type GroupDef,
  type OpBatch,
  type OverridePath,
  type PrefabLibrary,
  type PrefabParam,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
} from "../scene/types";
import {
  bucketOf,
  bulkRecord,
  ENTITIES_BUCKET,
  entitiesMap,
  entityRecord,
  groupMap,
  groupsMap,
  instanceRecord,
  instancesMap,
  paramsMap,
  patchMap,
  patchRecord,
  prefabHeaderMap,
  prefabOverridesMap,
  readDoc,
  recordMap,
  sceneMap,
  settingsMap,
  writeAssets,
  type DocView,
  type PrefabDocHeader,
} from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { appendLog, fingerprint, sameValue as same, type LogInput } from "./log";
import { assignZ } from "./order";
import {
  ASSETS_KEY,
  GROUP_KEY_PREFIX,
  INSTANCE_KEY_PREFIX,
  PARAM_KEY_PREFIX,
  SCENE_KEY,
  SETTINGS_KEY,
  VARIANT_KEY,
  Z_FIELD,
  type DocOrigin,
  type EntityRecord,
  type LogEntry,
  type SceneOrigin,
} from "./types";

/** One doc a batch wrote besides its own, with that doc's log entry id. */
export type PrefabDocWrite = { doc: string; entry: string };

/** The prefab library a batch read, the one it leaves, and the ids that differ. */
export type PrefabChange = {
  prev: PrefabLibrary;
  next: PrefabLibrary;
  changed: readonly string[];
};

export type PrefabDocPlan =
  | {
      ok: true;
      /** Writes each changed prefab's doc (and the registry, for a new or removed prefab), one transaction each. */
      write(origin: DocOrigin, ctx: { label: string; scene: LogEntry | null }): PrefabDocWrite[];
    }
  | { ok: false; issue: SceneIssue };

/**
 * Writes the prefab docs a scene batch changes (`definePrefab`,
 * `createPrefab`, `applyToPrefab`): what a project's prefab source
 * supplies. `plan` checks everything before the scene is written.
 */
export type PrefabDocWriter = {
  plan(change: PrefabChange): PrefabDocPlan;
};

export type DocApplyOptions = ApplyOptions & {
  key?: KeyGen;
  /** The history label; defaults to the batch's own. */
  label?: string;
  /** Leave the batch out of the doc's `log`. */
  noLog?: boolean;
  /** Writes prefab docs; without one, the ops that read or write prefabs are refused. */
  prefabWriter?: PrefabDocWriter;
  /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
  parentBounds?: Bounds;
};

/** What a batch did to the doc, in keys as well as refs. */
export type DocApplyResult =
  | (Extract<ApplyResult, { ok: true }> & {
      /** Keys of every entry the batch added, changed or removed. */
      keys: string[];
      /** The key behind each ref of the new document the batch touched or created. */
      refKeys: Record<Ref, string>;
      /** The prefab docs the batch wrote through `prefabWriter`, in write order. */
      docs: PrefabDocWrite[];
    })
  | Extract<ApplyResult, { ok: false }>;

/**
 * Ops that only mean something in a scene, so a prefab doc refuses them.
 * Instances nest, so a prefab doc takes the instance ops; defining or
 * creating prefabs stays with scenes.
 */
export const SCENE_ONLY_OPS: readonly SceneOp["op"][] = [
  "setScene",
  "setSettings",
  "setGroup",
  "definePrefab",
  "createPrefab",
];

/** The ref each entry of a view goes by, by key; instances by their id. */
export function refsOfView(view: DocView): Map<string, Ref> {
  const out = new Map<string, Ref>();
  view.entityKeys.forEach((key, i) => out.set(key, view.def.entities![i]!.id));
  for (const [bulk, keys] of view.bulkKeys) keys.forEach((key, i) => out.set(key, `~${bulk}:${i}`));
  view.instanceKeys.forEach((key, i) => out.set(key, view.def.instances![i]!.id));
  return out;
}

function tagsOf(view: DocView): EntryTags {
  return {
    entities: [...view.entityKeys],
    buckets: new Map(view.bulkKeys),
    instances: [...view.instanceKeys],
  };
}

/**
 * Applies a batch to the live doc. The batch is checked exactly as
 * `applyOps` checks it, against the doc as it is now, so a `~` bulk ref
 * means the entry at that index now and a live batch needs no `base` (one
 * it brings is still checked). A failed batch writes nothing; a good one is
 * one `doc.transact(fn, origin)` that writes only the fields that changed,
 * plus its `log` entry. Instances resolve against `opts.prefabs`; the ops
 * that read or write prefabs go through `opts.prefabWriter` (one more
 * transaction per prefab doc) and are refused without one. On a prefab doc
 * the scene-only ops, grouped children, a write to the prefab itself and
 * an instance that makes the prefab contain itself are refused.
 */
export function applyOpsToDoc(
  doc: Y.Doc,
  batch: OpBatch,
  origin: SceneOrigin,
  registry: Registry,
  opts: DocApplyOptions = {},
): DocApplyResult {
  const view = readDoc(doc, {
    registry,
    ...(opts.parentBounds ? { parentBounds: opts.parentBounds } : {}),
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
  });
  const refuse = (at: number, message: string, hint?: string): DocApplyResult => ({
    ok: false,
    hash: sceneHash(view.def),
    failedAt: at,
    issue: makeIssue("op-invalid", {
      message,
      path: `/ops/${at}`,
      ...(hint ? { hint } : {}),
    }),
  });
  const ops: readonly SceneOp[] = Array.isArray(batch.ops) ? batch.ops : [];
  if (view.kind === "prefab") {
    const at = ops.findIndex((op) => SCENE_ONLY_OPS.includes(op?.op));
    if (at >= 0) return refuse(at, `${ops[at]!.op} only works in a scene, not inside a prefab.`);
  } else {
    const at = headerOpAt(ops);
    if (at >= 0)
      return {
        ok: false,
        hash: sceneHash(view.def),
        failedAt: at,
        issue: headerOpOnScene(ops[at]!, at, view.def.name),
      };
  }
  if (!opts.prefabWriter) {
    const at = ops.findIndex((op) => PREFAB_SCENE_OPS.includes(op?.op));
    if (at >= 0)
      return refuse(
        at,
        `${ops[at]!.op} reads or writes prefab docs, which needs the project`,
        "Edit through the project session, whose prefab source writes the prefab docs.",
      );
  }
  const prefabs = opts.prefabs ?? new Map();
  const split = splitHeaderOps(ops);
  const body: OpBatch = split.header.length > 0 ? { ...batch, ops: split.body } : batch;
  const sent: OpBatch =
    body.base === undefined && usesBulkRefs(body) ? { ...body, base: sceneHash(view.def) } : body;
  let tracked: ReturnType<typeof applyOpsTracked>;
  try {
    tracked = applyOpsTracked(
      view.def,
      sent,
      registry,
      { ...opts, prefabs, ...(view.prefab ? { prefab: view.prefab.id } : {}) },
      tagsOf(view),
    );
  } catch (err) {
    // A merged doc can hold an entity no single client wrote (a field
    // missing while another client's update is still in flight); a batch
    // that can't run against it fails like any other.
    return {
      ok: false,
      hash: sceneHash(view.def),
      failedAt: 0,
      issue: makeIssue("op-invalid", {
        message: `The batch can't apply to the scene as merged: ${err instanceof Error ? err.message : String(err)}`,
        path: "/ops/0",
        hint: "Re-read the scene and try again; validate it if this persists.",
      }),
    };
  }
  const { tags } = tracked;
  const result = tracked.result.ok ? tracked.result : remapBodyFailure(tracked.result, split.at);
  if (!result.ok) return result;
  let header: VariantAndParams | null = null;
  if (view.kind === "prefab" && split.header.length > 0) {
    const own = view.prefab ?? { id: "" };
    const headed = applyHeaderOps(
      {
        kind: PREFAB_KIND,
        v: view.def.v,
        ...own,
        entities: [],
        ...(result.def.instances?.length ? { instances: result.def.instances } : {}),
      },
      split.header,
      prefabs,
      registry,
    );
    if (!headed.ok)
      return {
        ok: false,
        hash: sceneHash(view.def),
        failedAt: headed.failedAt,
        issue: headed.issue,
      };
    header = { ...headed.header, ...(own.overrides ? { overrides: own.overrides } : {}) };
  }
  if (view.kind === "prefab") {
    const grouped = [...(result.def.entities ?? []), ...(result.def.instances ?? [])].some(
      (e) => e.group !== undefined,
    );
    if (grouped)
      return refuse(0, "A prefab's children can't join a group; an instance takes its group.");
    const id = view.prefab?.id ?? "";
    if (result.prefabsChanged?.includes(id))
      return refuse(
        Math.max(
          0,
          ops.findIndex((op) => PREFAB_SCENE_OPS.includes(op?.op)),
        ),
        `The batch writes prefab "${id}", the prefab it edits; edit its children directly.`,
      );
  }

  let plan: Extract<PrefabDocPlan, { ok: true }> | null = null;
  if (result.prefabsChanged && result.prefabs && opts.prefabWriter) {
    const planned = opts.prefabWriter.plan({
      prev: prefabs,
      next: result.prefabs,
      changed: result.prefabsChanged,
    });
    if (!planned.ok) {
      const at = Math.max(
        0,
        ops.findIndex((op) => PREFAB_SCENE_OPS.includes(op?.op)),
      );
      return {
        ok: false,
        hash: sceneHash(view.def),
        failedAt: at,
        issue: { ...planned.issue, path: planned.issue.path ?? `/ops/${at}` },
      };
    }
    plan = planned;
  }

  const label = opts.label ?? batch.label ?? defaultLabel(batch);
  let keys: string[] = [];
  let refKeys: Record<Ref, string> = {};
  let logged: LogEntry | null = null;
  doc.transact(() => {
    const written = writeScene(doc, view, result.def, tags!, opts.key ?? randomKey);
    if (header) writeVariantAndParams(doc, view.prefab, header, written);
    keys = written.keys;
    const refs = refsOfView({ ...written.view });
    const touched = new Set([...result.touched, ...result.created]);
    for (const [key, ref] of refs) if (touched.has(ref)) refKeys[ref] = key;
    if (!opts.noLog && keys.length > 0) {
      const entry: LogInput = {
        actor: origin,
        label,
        keys,
        before: written.before,
        after: written.after,
        ops: batch.ops.map((o) => o.op),
      };
      logged = appendLog(doc, entry);
    }
  }, origin);
  const docs = plan ? plan.write(origin, { label, scene: logged }) : [];
  return { ...result, keys, refKeys, docs };
}

/** The header values the `scene` map holds: everything but `meta`'s, settings, assets and the entry arrays. */
export function headerOf(def: SceneDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) {
    if (v === undefined || k === "settings" || k === "entities") continue;
    if (k === "groups" || k === "instances" || k === "assets") continue;
    if (!RESERVED_SCENE_KEYS.includes(k) && Array.isArray(v)) continue;
    if (k === "$schema" || k === "v" || k === "game") continue;
    out[k] = v;
  }
  return out;
}

function defaultLabel(batch: OpBatch): string {
  return batch.ops.length === 1 ? batch.ops[0]!.op : `${batch.ops.length} edits`;
}

/** A record's fractional order key, or undefined when it has none. */
const zOf = (rec: EntityRecord | undefined): string | undefined => {
  const z = rec?.[Z_FIELD];
  return typeof z === "string" ? z : undefined;
};

type Written = {
  keys: string[];
  before: Record<string, unknown>;
  after: Record<string, string | null>;
  view: DocView;
};

/**
 * Writes `next` over the doc that `view` was read from. `tags` names the
 * key behind each entry of `next` that already existed; others get new
 * keys. Every map is written key by key: the assets set one id at a time,
 * a group's `at`, `rot`, `flip` and `name` each on their own, and records
 * through `patchRecord`, so a paint writes only the grid rows it changed.
 * A prefab doc gets its entities, instances and assets. Call inside a
 * transaction.
 */
export function writeScene(
  doc: Y.Doc,
  view: DocView,
  next: SceneDefinition,
  tags: EntryTags,
  key: KeyGen,
): Written {
  const entities = entitiesMap(doc);
  const before: Record<string, unknown> = {};
  const after: Record<string, string | null> = {};
  const keys: string[] = [];

  type Planned = { key: string; rec: (z: string) => EntityRecord };
  const plannedBuckets = new Map<string, Planned[]>();
  const nextEntities = next.entities ?? [];
  plannedBuckets.set(
    ENTITIES_BUCKET,
    nextEntities.map((e, i) => ({
      key: tags.entities[i] ?? key(),
      rec: (z) => entityRecord(e, z),
    })),
  );
  const bulkNames = new Set<BulkKey>([...view.bulkKeys.keys(), ...tags.buckets.keys()]);
  for (const k of bulkKeysOf(next)) bulkNames.add(k);
  for (const bulk of bulkNames) {
    const values = Array.isArray(next[bulk]) ? (next[bulk] as unknown[]) : [];
    const bulkTags = tags.buckets.get(bulk) ?? [];
    plannedBuckets.set(
      bulk,
      values.map((value, i) => ({
        key: bulkTags[i] ?? key(),
        rec: (z) => bulkRecord(bulk, value as never, z),
      })),
    );
  }

  const live = new Set<string>();
  const nextView: DocView = {
    kind: view.kind,
    def: next,
    entityKeys: [],
    bulkKeys: new Map(),
    records: new Map(),
    instanceKeys: [],
    instanceRecords: new Map(),
    ...(view.prefab ? { prefab: view.prefab } : {}),
  };
  for (const [bucket, planned] of plannedBuckets) {
    const zs = assignZ(
      planned.map(({ key: k }) => {
        const prev = view.records.get(k);
        return prev && bucketOf(prev) === bucket ? zOf(prev) : undefined;
      }),
    );
    planned.forEach(({ key: k, rec }, i) => {
      live.add(k);
      const nextRec = rec(zs[i]!);
      // A merge still waiting on another client's update can leave a field
      // missing for a moment; never write an entry that has lost its geometry.
      if (bucket !== ENTITIES_BUCKET && !Array.isArray(nextRec.shape ?? nextRec.at)) return;
      nextView.records.set(k, nextRec);
      const prev = view.records.get(k);
      const map = entities.get(k);
      if (!prev || !map) {
        entities.set(k, recordMap(nextRec));
        before[k] = null;
        after[k] = fingerprint(nextRec);
        keys.push(k);
      } else if (!same(prev, nextRec)) {
        patchRecord(map, prev, nextRec);
        before[k] = prev;
        after[k] = fingerprint(nextRec);
        keys.push(k);
      }
    });
    const ordered = planned.map((p) => p.key);
    if (bucket === ENTITIES_BUCKET) nextView.entityKeys = ordered;
    else if (ordered.length > 0) nextView.bulkKeys.set(bucket, ordered);
  }
  const visible = new Set([...view.entityKeys, ...[...view.bulkKeys.values()].flat()]);
  for (const [k, prev] of view.records) {
    // A record the view skipped (no id or no geometry) is left alone.
    if (live.has(k) || !visible.has(k)) continue;
    entities.delete(k);
    before[k] = prev;
    after[k] = null;
    keys.push(k);
  }
  const log: LogParts = { before, after, keys };
  if (view.kind === "prefab") {
    nextView.instanceKeys = writeInstances(doc, view, next, tags, key, log);
    writeAssetSet(doc, view.def, next, log);
    return { keys, before, after, view: nextView };
  }

  const settings = settingsMap(doc);
  const prevSettings = view.def.settings ?? {};
  const nextSettings = next.settings ?? {};
  if (!same(prevSettings, nextSettings)) {
    for (const k of Object.keys(prevSettings)) if (!(k in nextSettings)) settings.delete(k);
    for (const [k, v] of Object.entries(nextSettings))
      if (!same(prevSettings[k], v)) settings.set(k, structuredClone(v));
    before[SETTINGS_KEY] = prevSettings;
    after[SETTINGS_KEY] = fingerprint(nextSettings);
    keys.push(SETTINGS_KEY);
  }

  nextView.instanceKeys = writeInstances(doc, view, next, tags, key, log);
  writeGroups(doc, view.def, next, log);
  writeAssetSet(doc, view.def, next, log);

  const scene = sceneMap(doc);
  const prevHeader = headerOf(view.def);
  const nextHeader = headerOf(next);
  if (!same(prevHeader, nextHeader)) {
    for (const k of Object.keys(prevHeader)) if (!(k in nextHeader)) scene.delete(k);
    for (const [k, v] of Object.entries(nextHeader))
      if (!same(prevHeader[k], v)) scene.set(k, structuredClone(v));
    before[SCENE_KEY] = prevHeader;
    after[SCENE_KEY] = fingerprint(nextHeader);
    keys.push(SCENE_KEY);
  }
  return { keys, before, after, view: nextView };
}

type LogParts = {
  before: Record<string, unknown>;
  after: Record<string, string | null>;
  keys: string[];
};

/** Instances by key, the way entities are written: new ones get keys, order by `z`. Returns each one's key. */
function writeInstances(
  doc: Y.Doc,
  view: DocView,
  next: SceneDefinition,
  tags: EntryTags,
  key: KeyGen,
  log: LogParts,
): string[] {
  const map = instancesMap(doc);
  const list = next.instances ?? [];
  const keys = list.map((_, i) => tags.instances?.[i] ?? key());
  const zs = assignZ(keys.map((k) => zOf(view.instanceRecords.get(k))));
  const live = new Set<string>();
  list.forEach((inst, i) => {
    const k = keys[i]!;
    live.add(k);
    const rec = instanceRecord(inst, zs[i]!);
    const prev = view.instanceRecords.get(k);
    const ymap = map.get(k);
    const logKey = `${INSTANCE_KEY_PREFIX}${k}`;
    if (!prev || !ymap) {
      map.set(k, recordMap(rec));
      log.before[logKey] = null;
    } else if (!same(prev, rec)) {
      patchRecord(ymap, prev, rec);
      log.before[logKey] = prev;
    } else return;
    log.after[logKey] = fingerprint(rec);
    log.keys.push(logKey);
  });
  const visible = new Set(view.instanceKeys);
  for (const [k, prev] of view.instanceRecords) {
    if (live.has(k) || !visible.has(k)) continue;
    map.delete(k);
    const logKey = `${INSTANCE_KEY_PREFIX}${k}`;
    log.before[logKey] = prev;
    log.after[logKey] = null;
    log.keys.push(logKey);
  }
  return keys;
}

/** The keys a group's `Y.Map` holds besides `at`, each written on its own. */
const GROUP_KEYS = ["rot", "flip", "name"] as const;

/**
 * Brings a group's `Y.Map` from `prev` to `next` key by key, so concurrent
 * edits of its `at`, turn, mirror and name merge. `prev` undefined writes
 * every key.
 */
export function patchGroup(ymap: Y.Map<unknown>, prev: GroupDef | undefined, next: GroupDef): void {
  if (!same(prev?.at, next.at)) ymap.set("at", structuredClone(next.at));
  for (const k of GROUP_KEYS) {
    const value = next[k];
    if (value === undefined) {
      if (ymap.has(k)) ymap.delete(k);
    } else if (!same(ymap.get(k), value)) ymap.set(k, value);
  }
}

/** Groups by id, each key of a group its own entry, so concurrent edits of its parts merge. */
function writeGroups(
  doc: Y.Doc,
  prev: SceneDefinition,
  next: SceneDefinition,
  log: LogParts,
): void {
  const map = groupsMap(doc);
  const was = prev.groups ?? {};
  const now = next.groups ?? {};
  for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const a = was[id];
    const b = now[id];
    if (same(a, b)) continue;
    const logKey = `${GROUP_KEY_PREFIX}${id}`;
    const ymap = map.get(id);
    if (!b) map.delete(id);
    else if (!ymap || !(ymap instanceof Y.Map)) map.set(id, groupMap(b));
    else patchGroup(ymap, a, b);
    log.before[logKey] = a ?? null;
    log.after[logKey] = b ? fingerprint(b) : null;
    log.keys.push(logKey);
  }
}

/** The `assets` header, one key per id, so two clients adding different ids merge; logged as its sorted ids, null when empty. */
function writeAssetSet(
  doc: Y.Doc,
  prev: SceneDefinition,
  next: SceneDefinition,
  log: LogParts,
): void {
  const was = sortedAssets(prev.assets ?? []);
  const now = sortedAssets(next.assets ?? []);
  if (same(was, now)) return;
  writeAssets(doc, now);
  log.before[ASSETS_KEY] = was.length > 0 ? was : null;
  log.after[ASSETS_KEY] = now.length > 0 ? fingerprint(now) : null;
  log.keys.push(ASSETS_KEY);
}

/** A prefab doc's variant base, variant overrides and parameters, each absent when unset. */
export type VariantAndParams = {
  base?: string;
  overrides?: Record<OverridePath, unknown>;
  params?: Record<string, PrefabParam>;
};

const variantOf = (p: VariantAndParams): VariantAndParams => ({
  ...(p.base !== undefined ? { base: p.base } : {}),
  ...(p.overrides && Object.keys(p.overrides).length > 0 ? { overrides: p.overrides } : {}),
});

/**
 * Brings a prefab doc's base, overrides and parameters from `prev` to
 * `next`, writing only what changed: the base on its own, overrides per
 * path and parameters per name, so concurrent edits of different keys
 * merge. Base and overrides are logged together under `VARIANT_KEY`, each
 * parameter under `PARAM_KEY_PREFIX` and its name. Call inside a
 * transaction.
 */
export function writeVariantAndParams(
  doc: Y.Doc,
  prev: Partial<PrefabDocHeader> | undefined,
  next: VariantAndParams,
  log: LogParts,
): void {
  const header = prefabHeaderMap(doc);
  const prevVariant = variantOf(prev ?? {});
  const nextVariant = variantOf(next);
  if (!same(prevVariant, nextVariant)) {
    if (nextVariant.base === undefined) header.delete("base");
    else if (header.get("base") !== nextVariant.base) header.set("base", nextVariant.base);
    patchMap(prefabOverridesMap(doc), nextVariant.overrides ?? {});
    log.keys.push(VARIANT_KEY);
    log.before[VARIANT_KEY] = structuredClone(prevVariant);
    log.after[VARIANT_KEY] = fingerprint(nextVariant);
  }
  const params = paramsMap(doc);
  const was: Record<string, unknown> = prev?.params ?? {};
  const now: Record<string, unknown> = next.params ?? {};
  for (const name of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort(byCodeUnit)) {
    const a = was[name];
    const b = now[name];
    if (same(a ?? null, b ?? null)) continue;
    if (b === undefined) params.delete(name);
    else params.set(name, structuredClone(b));
    const logKey = `${PARAM_KEY_PREFIX}${name}`;
    log.keys.push(logKey);
    log.before[logKey] = a === undefined ? null : structuredClone(a);
    log.after[logKey] = b === undefined ? null : fingerprint(b);
  }
}
