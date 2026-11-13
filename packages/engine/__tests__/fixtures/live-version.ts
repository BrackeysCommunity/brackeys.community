import type { LibraryScene } from "../../game/flow";
import type { GameDefinition, Registry } from "../../game/types";
import { stableJson } from "../../project/canonical";
import { sha256 } from "../../project/hash";
import { ENGINE_FORMATS, type ReleaseAsset } from "../../project/release";
import { utf8Bytes } from "../../project/release-assets";
import { sceneVersionId, type SceneVersion } from "../../project/scene-version";
import type { PreparedVersion } from "../../runtime/live";
import { saveHostOf } from "../../runtime/runtime";
import type { SceneRuntimeHandle, StepResult, SwapReport } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { formatScene } from "../../scene/format";
import { hashText } from "../../scene/hash";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { SceneSource, StagedVersion } from "../../types";
import { ENGINE_VERSION } from "../../version";

/** A 10×10 scene of `marker` entities named by `markers`, in a row from (1, 1). */
export const markerScene = (
  name: string,
  markers: readonly string[],
  extra: Omit<Partial<SceneDefinition>, "v" | "name" | "entities"> = {},
): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  bounds: [0, 0, 10, 10],
  ...extra,
  entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
});

/**
 * A scene list of one `start` marker scene per entry, the first its start
 * scene; an entry given as `{ scene, sublevel: true }` is listed as a sublevel.
 */
export function markerSource(
  entries: readonly (string | { scene: string; sublevel: true })[],
): SceneSource {
  const list = entries.map((e) => (typeof e === "string" ? { scene: e } : e));
  const scenes = new Map<string, LibraryScene>(
    list.map(({ scene }) => [scene, { def: markerScene(scene, ["start"]), prefabs: new Map() }]),
  );
  return {
    list: () => list.map((e) => ({ ...e })),
    start: () => list[0]?.scene ?? null,
    scene: (id) => scenes.get(id) ?? null,
  };
}

export type OneSceneVersionOptions = {
  /** The scene asset it replaces; default the scene's name. */
  scene?: string;
  project?: string;
  /** The scene's path in the project; default `scenes/<scene>.json`. */
  path?: string;
  physics?: "none" | "rapier";
  /** Other assets it carries beside the scene, and its bundle. */
  assets?: Readonly<Record<string, ReleaseAsset>>;
  bundle?: { entries: string[]; bytes: number };
};

/**
 * A version carrying `def` and nothing it would need a project for, as a
 * host hands one to `stage` after fetching it: its canonical text,
 * hash-checked, by hash. The scene uses no prefabs, so its hash is its
 * text's.
 */
export async function oneSceneVersion(
  def: SceneDefinition,
  game: Pick<GameDefinition, "id" | "configHash">,
  opts: OneSceneVersionOptions = {},
): Promise<StagedVersion> {
  const scene = opts.scene ?? def.name;
  const text = formatScene(def).text;
  const sha = await sha256(text);
  const version: SceneVersion = {
    kind: "scene-version",
    v: 1,
    project: opts.project ?? "p",
    scene,
    compat: {
      formats: { scene: ENGINE_FORMATS.scene, prefab: ENGINE_FORMATS.prefab },
      build: {},
      game: { id: game.id, configHash: game.configHash ?? null },
    },
    engine: ENGINE_VERSION,
    base: null,
    entry: {
      id: scene,
      physics: opts.physics ?? "none",
      prefabs: [],
      bundle: opts.bundle ?? { entries: [], bytes: 0 },
    },
    sceneHash: hashText(text),
    assets: {
      [scene]: {
        key: `k-${scene}`,
        kind: "scene",
        path: opts.path ?? `scenes/${scene}.json`,
        sha256: sha,
        bytes: utf8Bytes(text),
        storage: "doc",
        file: `live/${sha}.json`,
      },
      ...opts.assets,
    },
  };
  return { id: await sceneVersionId(version), version, texts: new Map([[sha, text]]) };
}

/**
 * A version as the live layer keeps it, without reading one: `def`
 * expanded with no prefabs, its hash a stand-in made from `id`.
 */
export function preparedOf(
  id: string,
  def: SceneDefinition,
  registry: Registry,
  scene = "yard",
): PreparedVersion {
  const version = { scene, sceneHash: `hash-${id.slice(0, 4)}` } as SceneVersion;
  const prefabs = new Map();
  return { id, version, def, scene: expandScene(def, registry, { prefabs }), prefabs };
}

export const steps = (rt: SceneRuntimeHandle, n: number): StepResult[] =>
  Array.from({ length: n }, () => rt.step(rt.ctx.time.tickMs, []));

/**
 * Every live entity's pose, flag and saved state, the game's state,
 * `persist`, the counters, timers, the random stream and the tick; the
 * entities in `skip` left out.
 */
export function worldDigest(rt: SceneRuntimeHandle, skip: readonly string[] = []): string {
  const world = saveHostOf(rt.ctx)!.captureWorld();
  const ids = [...rt.ctx.poses.ids()].filter((id) => !skip.includes(id)).sort();
  return stableJson({
    entities: ids.map((id) => {
      const p = rt.ctx.poses.get(id)!;
      return [id, rt.ctx.enabled(id), p.x, p.y, p.rot, world.systems[id] ?? null];
    }),
    game: rt.snapshot(),
    persist: rt.ctx.persist.value,
    counters: world.counters,
    random: world.random,
    tick: world.tick,
    timers: world.timers,
    destroyed: world.destroyed.filter((id) => !skip.includes(id)).sort(),
    spawned: world.spawned,
  });
}

/** `n` more ticks: each tick's events, the game's snapshot and the world's digest, hashed. */
export function runDigest(rt: SceneRuntimeHandle, n: number, skip: readonly string[] = []): string {
  const frames = steps(rt, n).map((r) => [r.tick, r.events, r.game, worldDigest(rt, skip)]);
  return hashText(JSON.stringify(frames));
}

/** The applied swap, or the refusal's hint thrown. */
export function swapped(report: SwapReport): Extract<SwapReport, { ok: true }> {
  if (!report.ok) throw new Error(report.issue.hint ?? report.issue.message);
  return report;
}
