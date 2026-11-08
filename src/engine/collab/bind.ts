import type * as Y from "yjs";

import type { Registry } from "../game/types";
import { bulkKeysOf, expandScene } from "../scene/expand";
import { resolveScene } from "../scene/resolve";
import {
  RESERVED_SCENE_KEYS,
  type Bounds,
  type ExpandedScene,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
} from "../scene/types";
import { contentMaps, readDoc, touchesMaps } from "./convert";
import { sameValue } from "./log";
import { EMPTY_PREFAB_SOURCE, type PrefabSource } from "./prefab-source";

/** The part of a `SceneRuntime` a binding drives. */
export type BindableRuntime = {
  load(scene: ExpandedScene): { ok: boolean };
  add(entities: RuntimeEntity[]): { ok: boolean };
  update(entities: RuntimeEntity[]): { ok: boolean };
  remove(ids: string[]): void;
};

export type SceneBinding = {
  /** The expansion the runtime holds now. */
  scene(): ExpandedScene;
  /**
   * While paused the runtime is left alone (Play runs on its own snapshot);
   * `onChange` still fires. Resuming reloads it from the doc as it is then.
   */
  setPaused(paused: boolean): void;
  /** Reloads the runtime from the doc. */
  reload(): void;
  destroy(): void;
};

export type BindOptions = {
  /** After every transaction that changed the scene, with the new definition. */
  onChange?: (def: SceneDefinition, tr: Y.Transaction) => void;
  /** When some entries couldn't be expanded and were left out. */
  onSkipped?: (errors: string[]) => void;
  /** Where instances' prefabs come from; default none. */
  prefabs?: PrefabSource;
  /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
  parentBounds?: Bounds;
};

/**
 * Expands a scene that two clients' edits may have merged into a state
 * neither wrote: an entry that can't be expanded, or a second entity with
 * an id already used, is left out rather than failing the whole scene.
 */
export function expandLenient(
  source: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): { scene: ExpandedScene; errors: string[] } {
  let def: SceneDefinition;
  try {
    def = resolveScene(source, registry, prefabs);
  } catch {
    def = { ...source };
    delete def.instances;
    delete def.groups;
  }
  const ids = (def.entities ?? []).map((e) => e.id);
  if (new Set(ids).size === ids.length) {
    try {
      return { scene: expandScene(def, registry), errors: [] };
    } catch {
      // Fall back to one entry at a time.
    }
  }
  const errors: string[] = [];
  const empty: SceneDefinition = { ...def };
  delete empty.entities;
  for (const k of bulkKeysOf(empty)) delete empty[k];
  const scene = expandScene(empty, registry);
  const seen = new Set<string>();
  const take = (part: Partial<SceneDefinition>, id?: (e: RuntimeEntity) => string) => {
    try {
      for (const e of expandScene({ ...empty, ...part }, registry).entities) {
        const entity = id ? { ...e, id: id(e) } : e;
        if (seen.has(entity.id)) errors.push(`duplicate id "${entity.id}"`);
        else {
          seen.add(entity.id);
          scene.entities.push(entity);
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  };
  for (const [k, rows] of Object.entries(def)) {
    if (k === "entities" || RESERVED_SCENE_KEYS.includes(k) || !Array.isArray(rows)) continue;
    // A bulk entry's id is its index, so expand one row alone and renumber it.
    rows.forEach((row, i) => take({ [k]: [row] }, (e) => e.id.replace(/:0$/, `:${i}`)));
  }
  for (const e of def.entities ?? []) take({ entities: [e] });
  return { scene, errors };
}

/**
 * Keeps an edit-mode runtime in step with a doc: after each transaction
 * that changed the scene (local or remote), the touched entities are
 * removed, added and updated, each at most once per transaction. A change
 * to settings or the header reloads the runtime. A transaction in a
 * prefab the scene's instances use re-expands them, once per transaction.
 */
export function bindSceneDoc(
  doc: Y.Doc,
  runtime: BindableRuntime,
  registry: Registry,
  opts: BindOptions = {},
): SceneBinding {
  const tracked = contentMaps(doc);
  const prefabs = opts.prefabs ?? EMPTY_PREFAB_SOURCE;
  const read = () =>
    readDoc(doc, { registry, ...(opts.parentBounds ? { parentBounds: opts.parentBounds } : {}) });
  let paused = false;
  let current = expand(read().def);
  runtime.load(current);

  function expand(def: SceneDefinition): ExpandedScene {
    const library: PrefabLibrary = prefabs.library();
    const { scene, errors } = expandLenient(def, registry, library);
    if (errors.length > 0) opts.onSkipped?.(errors);
    return scene;
  }

  const header = (s: ExpandedScene) => ({ name: s.name, bounds: s.bounds, settings: s.settings });

  function apply(next: ExpandedScene): void {
    if (!sameValue(header(current), header(next))) {
      runtime.load(next);
      current = next;
      return;
    }
    const before = new Map(current.entities.map((e) => [e.id, e]));
    const after = new Map(next.entities.map((e) => [e.id, e]));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    const added = next.entities.filter((e) => !before.has(e.id));
    const changed = next.entities.filter((e) => {
      const prev = before.get(e.id);
      return prev !== undefined && !sameValue(prev, e);
    });
    if (removed.length > 0) runtime.remove(removed);
    const okAdd = added.length === 0 || runtime.add(added).ok;
    const okUpdate = changed.length === 0 || runtime.update(changed).ok;
    if (!okAdd || !okUpdate) runtime.load(next);
    current = next;
  }

  const onTransaction = (tr: Y.Transaction) => {
    if (!touchesMaps(tr, tracked)) return;
    const def = read().def;
    if (!paused) apply(expand(def));
    opts.onChange?.(def, tr);
  };
  doc.on("afterTransaction", onTransaction);
  const unsubscribe = prefabs.subscribe((changed) => {
    const def = read().def;
    if (!(def.instances ?? []).some((i) => changed.includes(i.prefab))) return;
    if (!paused) apply(expand(def));
  });

  return {
    scene: () => current,
    setPaused(next) {
      if (paused === next) return;
      paused = next;
      if (!paused) {
        current = expand(read().def);
        runtime.load(current);
      }
    },
    reload() {
      current = expand(read().def);
      runtime.load(current);
    },
    destroy() {
      doc.off("afterTransaction", onTransaction);
      unsubscribe();
    },
  };
}
