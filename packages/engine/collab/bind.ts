import type * as Y from "yjs";

import type { Registry } from "../game/types";
import { bulkKeysOf, expandScene } from "../scene/expand";
import { diffEntities, headerChanged } from "../scene/expanded-diff";
import { resolveScene } from "../scene/resolve";
import {
  RESERVED_SCENE_KEYS,
  type Bounds,
  type ExpandedScene,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
} from "../scene/types";
import { contentMaps, prefabsReachedBy, readDoc, touchesMaps } from "./convert";
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

const NO_BOUNDS: Bounds = [0, 0, 0, 0];

const hasBounds = (def: SceneDefinition) => Array.isArray(def.bounds) && def.bounds.length === 4;

/**
 * `def` with a missing name or bounds taken from `last`: an undo of the
 * `createAsset` that made a scene doc clears its header, and the doc is
 * read a while longer before it closes.
 */
function withHeader(
  def: SceneDefinition,
  last: Pick<ExpandedScene, "name" | "bounds">,
): SceneDefinition {
  if (typeof def.name === "string" && hasBounds(def)) return def;
  return {
    ...def,
    name: typeof def.name === "string" ? def.name : last.name,
    bounds: hasBounds(def) ? def.bounds : last.bounds,
  };
}

/**
 * Expands a scene that two clients' edits may have merged into a state
 * neither wrote: an entry that can't be expanded, or a second entity with
 * an id already used, is left out rather than failing the whole scene. A
 * scene with no header expands empty-named, with zero bounds.
 */
export function expandLenient(
  given: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): { scene: ExpandedScene; errors: string[] } {
  const source = withHeader(given, { name: "", bounds: NO_BOUNDS });
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

type EntityChanges = { added: RuntimeEntity[]; removed: string[]; changed: RuntimeEntity[] };

function runChanges(runtime: BindableRuntime, { added, removed, changed }: EntityChanges): boolean {
  if (removed.length > 0) runtime.remove(removed);
  const okAdd = added.length === 0 || runtime.add(added).ok;
  const okUpdate = changed.length === 0 || runtime.update(changed).ok;
  return okAdd && okUpdate;
}

/**
 * Moves `runtime` from holding `before` to holding `after`: removes the
 * entities `after` lacks, adds the new ones and updates those whose value
 * changed. False when an add or update failed, so the caller reloads.
 */
export function applyEntityDiff(
  runtime: BindableRuntime,
  before: readonly RuntimeEntity[],
  after: readonly RuntimeEntity[],
): boolean {
  return runChanges(runtime, diffEntities(before, after));
}

/**
 * Keeps an edit-mode runtime in step with a doc: after each transaction
 * that changed the scene (local or remote), the touched entities are
 * removed, added and updated, each at most once per transaction. A change
 * to settings or the header reloads the runtime. A transaction in a
 * prefab the doc reaches (`prefabsReachedBy`: nested ones and a variant's
 * base included) re-expands it, once per transaction.
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
    readDoc(doc, {
      registry,
      prefabs: prefabs.library(),
      ...(opts.parentBounds ? { parentBounds: opts.parentBounds } : {}),
    });
  let paused = false;
  let current = expand(read().def, null);
  runtime.load(current);

  /** A doc whose header is gone keeps the last name and bounds, so the world isn't rebuilt around nothing. */
  function expand(def: SceneDefinition, last: ExpandedScene | null): ExpandedScene {
    const library: PrefabLibrary = prefabs.library();
    const kept = last ? withHeader(def, last) : def;
    const { scene, errors } = expandLenient(kept, registry, library);
    if (errors.length > 0) opts.onSkipped?.(errors);
    return scene;
  }

  function apply(next: ExpandedScene): void {
    if (headerChanged(current, next)) runtime.load(next);
    else if (!runChanges(runtime, diffEntities(current.entities, next.entities)))
      runtime.load(next);
    current = next;
  }

  const onTransaction = (tr: Y.Transaction) => {
    if (!touchesMaps(tr, tracked)) return;
    const def = read().def;
    if (!paused) apply(expand(def, current));
    opts.onChange?.(def, tr);
  };
  doc.on("afterTransaction", onTransaction);
  const unsubscribe = prefabs.subscribe((changed) => {
    const view = read();
    const reached = prefabsReachedBy(view, prefabs.library());
    if (!changed.some((id) => reached.has(id))) return;
    if (!paused) apply(expand(view.def, current));
  });

  return {
    scene: () => current,
    setPaused(next) {
      if (paused === next) return;
      paused = next;
      if (!paused) {
        current = expand(read().def, current);
        runtime.load(current);
      }
    },
    reload() {
      current = expand(read().def, current);
      runtime.load(current);
    },
    destroy() {
      doc.off("afterTransaction", onTransaction);
      unsubscribe();
    },
  };
}
