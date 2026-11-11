import type { Registry } from "../game/types";
import type { ContentStore } from "../project/content-store";
import { isSha256, sha256 } from "../project/hash";
import { byCodeUnit } from "../project/kinds/define";
import { snapshotRuntimeView, type ProjectRuntimeView } from "../project/runtime-view";
import { snapshotScene, type ProjectSnapshot } from "../project/snapshot";
import type { AssetId, Sha256 } from "../project/types";
import { parseScene, SceneParseError } from "../scene/parse";
import { parsePrefab, prefabsUsedBy, sceneHashWith } from "../scene/prefab";
import {
  PREFAB_KIND,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneHash,
} from "../scene/types";

type LoadCommon = {
  registry: Registry;
  /**
   * The project's data the game reads as `EngineContext.project`; null
   * without one. By snapshot it defaults to the snapshot's game-settings and
   * data tables; by files, to null.
   */
  project?: ProjectRuntimeView | null;
};

/** A scene pinned by a project snapshot, its texts read from `store`. */
export type SnapshotLoadInput = LoadCommon & {
  snapshot: ProjectSnapshot;
  store: ContentStore;
  /** The scene's asset id. */
  scene: AssetId;
};

/** A scene and its prefabs as files: text or parsed JSON each. */
export type FilesLoadInput = LoadCommon & {
  files: { scene: unknown; prefabs?: readonly unknown[] };
};

export type HeadlessLoadInput = SnapshotLoadInput | FilesLoadInput;

/** What `runPlaytest`, `replayRecording` and `runChecks` take, ready to spread into their options. */
export type HeadlessLoad = {
  scene: SceneDefinition;
  /** The prefabs the scene's instances name, by id: what `sceneHash` covers. */
  prefabs: PrefabLibrary;
  /** Every prefab given or pinned, by id: what the game's `ctx.instantiate` may place. */
  library: PrefabLibrary;
  /** By snapshot, the given registry's game with the snapshot's own materials in place of any overlay it had. */
  registry: Registry;
  project: ProjectRuntimeView | null;
  /** What a recording of this scene pins: the scene with the prefabs it uses. */
  sceneHash: SceneHash;
  /** The snapshot it was loaded from; null for files. */
  snapshot: Sha256 | null;
};

function fromFiles(files: FilesLoadInput["files"], registry: Registry) {
  const parsed = parseScene(files.scene, registry);
  if (!parsed.ok) throw new SceneParseError(parsed.issues);
  const all = new Map<string, Prefab>();
  for (const file of files.prefabs ?? []) {
    const read = parsePrefab(file, registry);
    if (!read.ok) throw new SceneParseError(read.issues);
    all.set(read.prefab.id, read.prefab);
  }
  const used = new Set(prefabsUsedBy(parsed.def, all));
  const prefabs = new Map([...all].filter(([id]) => used.has(id)));
  return { def: parsed.def, prefabs, library: all, registry };
}

/**
 * The snapshot's prefabs beside the ones the scene reaches, parsed by the
 * pinned registry. One whose text the store lacks, or that doesn't hash to
 * its pin or parse, is left out: the run only fails if the game places it.
 */
async function snapshotLibrary(
  snapshot: ProjectSnapshot,
  store: ContentStore,
  registry: Registry,
  reached: PrefabLibrary,
): Promise<PrefabLibrary> {
  const library = new Map(reached);
  for (const [id, asset] of Object.entries(snapshot.assets).sort(([a], [b]) => byCodeUnit(a, b))) {
    if (asset.kind !== PREFAB_KIND || library.has(id) || !isSha256(asset.sha256)) continue;
    const bytes = await store.get(asset.sha256);
    if (bytes === null || (await sha256(bytes)) !== asset.sha256) continue;
    const read = parsePrefab(new TextDecoder().decode(bytes), registry);
    if (read.ok) library.set(id, read.prefab);
  }
  return library;
}

async function fromSnapshot(input: SnapshotLoadInput) {
  const { def, prefabs, registry } = await snapshotScene(
    input.snapshot,
    input.scene,
    input.store,
    input.registry,
  );
  const library = await snapshotLibrary(input.snapshot, input.store, registry, prefabs);
  return { def, prefabs, library, registry };
}

/**
 * Loads a scene for a headless run by snapshot (`snapshotScene`, which
 * pins the snapshot's materials too) or by files. Neither fetches or decodes a blob: what a run needs of one is its
 * entry's meta. Throws a `SnapshotError` for a snapshot that can't give the
 * scene or its project data, and a `SceneParseError` for a file that
 * doesn't parse; validation is the run's, as Play does it.
 */
export async function loadHeadless(input: HeadlessLoadInput): Promise<HeadlessLoad> {
  const { def, prefabs, library, registry } =
    "files" in input ? fromFiles(input.files, input.registry) : await fromSnapshot(input);
  const project =
    input.project !== undefined
      ? input.project
      : "files" in input
        ? null
        : await snapshotRuntimeView(input.snapshot, input.store, registry);
  return {
    scene: def,
    prefabs,
    library,
    registry,
    project,
    sceneHash: sceneHashWith(def, prefabs),
    snapshot: "files" in input ? null : input.snapshot.hash,
  };
}
