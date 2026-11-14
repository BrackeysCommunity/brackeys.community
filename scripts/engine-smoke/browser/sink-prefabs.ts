/**
 * The sink project's prefabs and scene, for the page and the tests alike.
 * Each prefab is parsed with the lookup itself, and the scene is parsed with
 * it too, so a file in an older format migrates the fields its instances
 * override through the prefabs they name (nested ones included).
 */
import type { Registry } from "@jams/engine/game";
import { cameraRegionsOf } from "@jams/engine/headless";
import type { ProjectView } from "@jams/engine/project";
import {
  expandScene,
  parsePrefab,
  parseSceneOrThrow,
  type Prefab,
  type SceneDefinition,
} from "@jams/engine/scene";

const declaredId = (value: unknown): string | undefined => {
  const doc = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const id = doc && typeof doc === "object" ? (doc as { id?: unknown }).id : undefined;
  return typeof id === "string" ? id : undefined;
};

/** Every prefab asset of `view`, by the id it declares; throws on one that doesn't parse. */
export function sinkPrefabs(
  view: ProjectView,
  values: ReadonlyMap<string, unknown>,
  registry: Registry,
): Map<string, Prefab> {
  const raw = new Map<string, unknown>();
  for (const entry of view.byId.values()) {
    if (entry.kind !== "prefab") continue;
    const value = values.get(entry.id);
    raw.set(declaredId(value) ?? entry.id, value);
  }
  const parsed = new Map<string, Prefab>();
  const reading = new Set<string>();
  const lookup = (id: string): Prefab | undefined => {
    const done = parsed.get(id);
    if (done || reading.has(id) || !raw.has(id)) return done;
    reading.add(id);
    const read = parsePrefab(raw.get(id), registry, { prefab: lookup });
    reading.delete(id);
    if (!read.ok) throw new Error(`prefab ${id} doesn't parse: ${read.issues[0]?.message}`);
    parsed.set(id, read.prefab);
    return read.prefab;
  };
  for (const id of raw.keys()) lookup(id);
  return parsed;
}

/** `value` parsed as a scene with `prefabs` at hand for its migration. */
export const parseSinkScene = (
  value: unknown,
  registry: Registry,
  prefabs: ReadonlyMap<string, Prefab>,
): SceneDefinition => parseSceneOrThrow(value, registry, { prefab: (id) => prefabs.get(id) });

/**
 * `scene` with nothing that places Play's camera on its own: no camera
 * settings and no camera regions, either of which puts a rig on the camera
 * that places it every rendered frame, so a run can frame the camera itself.
 */
export function withoutCameraRig(
  scene: SceneDefinition,
  registry: Registry,
  prefabs: ReadonlyMap<string, Prefab>,
): SceneDefinition {
  const expanded = expandScene(scene, registry, { prefabs });
  const regions = new Set(cameraRegionsOf(expanded.entities, registry).map((r) => r.id));
  const settings = { ...scene.settings };
  delete settings.camera;
  const entities = (scene.entities ?? []).filter((e) => !regions.has(e.id));
  return { ...scene, settings, entities };
}
