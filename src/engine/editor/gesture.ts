import { sameValue } from "../collab/log";
import type { Registry } from "../game/types";
import { bulkId, bulkKeysOf, expandScene, parseBulkId } from "../scene/expand";
import { sceneHash } from "../scene/hash";
import { applyOps } from "../scene/ops";
import { usesBulkRefs } from "../scene/ops-schema";
import type { OpBatch, Ref, RuntimeEntity, SceneDefinition } from "../scene/types";

/** The part of the edit world's runtime a preview drives; `add` and `remove` only for batches that add or delete. */
export type PreviewRuntime = {
  update(entities: RuntimeEntity[]): unknown;
  add?(entities: RuntimeEntity[]): unknown;
  remove?(ids: string[]): void;
};

export type GesturePreviewOptions = {
  registry: Registry;
  /** The committed document, which the runtime mirrors when nothing is previewed. */
  getDoc: () => SceneDefinition;
  runtime?: PreviewRuntime | null;
};

export type GesturePreview = {
  /**
   * Shows `batch` applied to the current document in the runtime, touching
   * only what it changes; `null` puts back whatever the last preview changed,
   * as the document is now. False when the batch doesn't apply (the runtime
   * is put back).
   */
  preview(batch: OpBatch | null): boolean;
  /** The document as previewed; `null` with nothing previewed. */
  def(): SceneDefinition | null;
  /** Something is previewed. */
  active(): boolean;
};

/**
 * The expansion of just `refs` in `def`: entities by id, and each bulk entry
 * expanded alone and given back its own index. What doesn't expand (an
 * `off` entity, a half-typed field) is missing from the result.
 */
export function expandRefs(
  def: SceneDefinition,
  registry: Registry,
  refs: Iterable<Ref>,
): Map<string, RuntimeEntity> {
  const ids = new Set<string>();
  const rows = new Map<string, number[]>();
  for (const ref of refs) {
    const bulk = parseBulkId(ref);
    if (!bulk) ids.add(ref);
    else rows.set(bulk.key, [...(rows.get(bulk.key) ?? []), bulk.index]);
  }
  const header: SceneDefinition = { ...def };
  delete header.entities;
  for (const k of bulkKeysOf(header)) delete header[k];

  const out = new Map<string, RuntimeEntity>();
  const take = (part: Partial<SceneDefinition>, rename?: (e: RuntimeEntity) => string | null) => {
    try {
      for (const e of expandScene({ ...header, ...part }, registry).entities) {
        const id = rename ? rename(e) : e.id;
        if (id !== null && !out.has(id)) out.set(id, id === e.id ? e : { ...e, id });
      }
    } catch {
      // Half-typed or merged state: the entry is left as the runtime holds it.
    }
  };
  for (const [key, indices] of rows) {
    const all = Array.isArray(def[key]) ? (def[key] as unknown[]) : [];
    const present = indices.filter((i) => i < all.length);
    take({ [key]: present.map((i) => all[i]) }, (e) => {
      const p = parseBulkId(e.id);
      const index = p && p.key === key ? present[p.index] : undefined;
      return index === undefined ? null : bulkId(key, index);
    });
  }
  if (ids.size > 0) {
    const seen = new Set<string>();
    const entities = (def.entities ?? []).filter((e) => {
      if (!ids.has(e.id) || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    take({ entities });
  }
  return out;
}

/**
 * Live feedback for a drag: a batch applied to the document with the pure
 * `applyOps` and pushed to the runtime through `update` (its fast path, not
 * a respawn), never written to the document. Each preview replaces the
 * last; ids the new one no longer changes go back to the document's state.
 */
export function createGesturePreview({
  registry,
  getDoc,
  runtime,
}: GesturePreviewOptions): GesturePreview {
  /** Ids the runtime holds differently from the document: what it holds, or `null` when removed. */
  let held = new Map<string, RuntimeEntity | null>();
  let previewed: SceneDefinition | null = null;

  function push(target: SceneDefinition | null, affected: Set<Ref>): void {
    const doc = getDoc();
    const all = new Set<string>([...affected, ...held.keys()]);
    const base = expandRefs(doc, registry, all);
    const next = target ? expandRefs(target, registry, affected) : new Map<string, RuntimeEntity>();
    const add: RuntimeEntity[] = [];
    const update: RuntimeEntity[] = [];
    const remove: string[] = [];
    const nextHeld = new Map<string, RuntimeEntity | null>();
    for (const id of all) {
      const now = held.has(id) ? (held.get(id) ?? null) : (base.get(id) ?? null);
      const want = affected.has(id) ? (next.get(id) ?? null) : (base.get(id) ?? null);
      if (now && want) {
        if (!sameValue(now, want)) update.push(want);
      } else if (want) add.push(want);
      else if (now) remove.push(id);
      const docState = base.get(id) ?? null;
      if (!sameValue(want, docState)) nextHeld.set(id, want);
    }
    held = nextHeld;
    if (!runtime) return;
    if (remove.length > 0) runtime.remove?.(remove);
    if (add.length > 0) runtime.add?.(add);
    if (update.length > 0) runtime.update(update);
  }

  return {
    preview(batch) {
      if (!batch) {
        previewed = null;
        if (held.size > 0) push(null, new Set());
        return true;
      }
      const doc = getDoc();
      const sent =
        batch.base === undefined && usesBulkRefs(batch)
          ? { ...batch, base: sceneHash(doc) }
          : batch;
      const result = applyOps(doc, sent, registry, { validate: "none" });
      if (!result.ok) {
        previewed = null;
        if (held.size > 0) push(null, new Set());
        return false;
      }
      const affected = new Set<Ref>([...result.touched, ...result.created]);
      for (const [from, to] of Object.entries(result.remap)) {
        affected.add(from);
        if (to !== null) affected.add(to);
      }
      previewed = result.def;
      push(result.def, affected);
      return true;
    },
    def: () => previewed,
    active: () => previewed !== null,
  };
}
