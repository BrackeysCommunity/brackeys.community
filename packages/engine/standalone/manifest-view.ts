import { createRegistry } from "../game/define";
import type { GameDefinition } from "../game/types";
import { byCodeUnit } from "../project/kinds/define";
import type { ReleaseManifest } from "../project/release";
import { assetEntryOf } from "../project/release-assets";
import { runtimeView, type ProjectRuntimeView } from "../project/runtime-view";
import { jsonValues } from "../project/snapshot";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  BuildStamp,
  ProjectView,
} from "../project/types";
import { projectView } from "../project/view";

/**
 * A ProjectView over the manifest's assets (entries get `created: { at: 0, by: "release" }`).
 * Blobs carry their hash, size, import settings and meta, as a snapshot's view does;
 * docs carry none, so readers tell them apart the same way.
 */
export function manifestView(m: ReleaseManifest): ProjectView {
  const assets: Record<AssetKey, AssetEntry> = {};
  for (const id of Object.keys(m.assets).sort(byCodeUnit)) {
    const a = m.assets[id]!;
    assets[a.key] = assetEntryOf(id, a, { at: 0, by: "release" });
  }
  const build: Record<AssetKindName, BuildStamp> = {};
  for (const kind of Object.keys(m.project.build).sort(byCodeUnit))
    build[kind] = { hash: m.project.build[kind]!, buildAt: 0, engine: m.project.snapshotEngine };
  return projectView({
    meta: { projectId: m.project.id, layout: 1, name: m.project.name },
    assets,
    history: {},
    code: {},
    build,
  });
}

/** The ProjectRuntimeView (settings, tables, input map, flow, runtime docs) from the shipped doc texts. */
export function manifestRuntimeView(
  m: ReleaseManifest,
  texts: ReadonlyMap<AssetId, string>,
  game: GameDefinition,
): ProjectRuntimeView {
  return runtimeView(manifestView(m), jsonValues(texts), createRegistry(game));
}
