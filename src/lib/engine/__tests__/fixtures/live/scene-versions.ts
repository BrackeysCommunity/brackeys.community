import { createRegistry, defineGame, withProject } from "@jams/engine/game";
import {
  buildSceneVersion,
  formatSceneVersion,
  heldProject,
  sceneVersionId,
  type AssetSidecar,
  type HeldFile,
  type ReleaseAsset,
  type SceneVersion,
  type Sha256,
} from "@jams/engine/project";

import type { PlannedRelease } from "../../release-fixture";

export type FixtureVersion = {
  version: SceneVersion;
  id: Sha256;
  /** `scene-version.json` as `begin` takes it. */
  text: string;
  /** The doc texts it carries, by hash, as `PUT` sends them. */
  texts: ReadonlyMap<Sha256, string>;
};

export type FixtureVersionOptions = {
  scene: string;
  /** Changes the scene's JSON before the build, e.g. moves a marker. */
  edit?: (scene: Record<string, unknown>) => void;
  /** Blobs the project gains before the build; the scene names them through `edit`. */
  blobs?: { id: string; path: string; sha256: Sha256; bytes: number }[];
};

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * A version of one of `release`'s scenes, built by the engine's own
 * `buildSceneVersion` from the project the release shipped: its docs read
 * back from the release's `data/` files, its blobs from their entries.
 */
export async function fixtureVersion(
  release: PlannedRelease,
  opts: FixtureVersionOptions,
): Promise<FixtureVersion> {
  const { manifest } = release;
  const files: HeldFile[] = [];
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.storage === "doc") {
      const bytes = release.files.get(asset.file);
      if (!bytes) throw new Error(`the release ships no "${asset.file}" for "${id}"`);
      const json = JSON.parse(decode(bytes)) as Record<string, unknown>;
      if (id === opts.scene) opts.edit?.(json);
      files.push({ path: asset.path, json });
    } else {
      files.push({ path: asset.path, sidecar: sidecarOf(id, asset) });
    }
  }
  for (const blob of opts.blobs ?? [])
    files.push({
      path: blob.path,
      sidecar: sidecarOf(blob.id, {
        key: `key-${blob.id}`,
        sha256: blob.sha256,
        bytes: blob.bytes,
        meta: { format: "png", width: 1, height: 1 },
      }),
    });

  const game = defineGame({
    id: manifest.game.id,
    types: [],
    actions: [],
    time: { kind: "turns", rate: 30 },
    world: { physics: "none" },
    createRuntime: () => ({ snapshot: () => null }),
  });
  const { view } = heldProject(files, createRegistry(game), {
    projectId: manifest.project.id,
    name: manifest.project.id,
  });
  const texts = new Map<string, string>();
  for (const file of files)
    if (file.json !== undefined) {
      const entry = [...view.byId.values()].find((e) => e.path === file.path);
      if (entry) texts.set(entry.id, `${JSON.stringify(file.json, null, 2)}\n`);
    }
  const values = new Map([...texts].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  const built = await buildSceneVersion({
    view,
    texts,
    build: manifest.project.build,
    game,
    registry: withProject(createRegistry(game), view, values),
    scene: opts.scene,
    release: manifest,
  });
  if (!built.ok)
    throw new Error(
      `the fixture version doesn't build: ${built.issues.map((i) => i.message).join("; ")}`,
    );
  return withVersion(built.version, built.texts);
}

/** `version` as `begin` takes it, after a change a builder wouldn't make: a test's tampered copy. */
export async function withVersion(
  version: SceneVersion,
  texts: ReadonlyMap<Sha256, string> = new Map(),
): Promise<FixtureVersion> {
  return { version, id: await sceneVersionId(version), text: formatSceneVersion(version), texts };
}

function sidecarOf(
  id: string,
  asset: Pick<ReleaseAsset, "key" | "sha256" | "bytes" | "meta" | "licence">,
): AssetSidecar {
  return {
    kind: "asset-sidecar",
    v: 1,
    key: asset.key,
    id,
    sha256: asset.sha256,
    bytes: asset.bytes,
    ...(asset.meta ? { meta: asset.meta } : {}),
    ...(asset.licence ? { licence: asset.licence } : {}),
  };
}
