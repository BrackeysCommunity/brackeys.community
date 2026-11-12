import { createRegistry } from "../game/define";
import type { GameDefinition } from "../game/types";
import { byCodeUnit } from "../project/kinds/define";
import type { ReleaseManifest } from "../project/release";
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

/** Every entry was created by the release, at its snapshot's time. */
const created = () => ({ at: 0, by: "release" });

/**
 * A ProjectView over the manifest's assets (entries get `created: { at: 0, by: "release" }`).
 * Blobs carry their hash, size, import settings and meta, as a snapshot's view does;
 * docs carry none, so readers tell them apart the same way.
 */
export function manifestView(m: ReleaseManifest): ProjectView {
  const assets: Record<AssetKey, AssetEntry> = {};
  for (const id of Object.keys(m.assets).sort(byCodeUnit)) {
    const a = m.assets[id]!;
    const blob = a.storage === "blob";
    assets[a.key] = {
      key: a.key,
      id,
      kind: a.kind,
      path: a.path,
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(blob ? { sha256: a.sha256, bytes: a.bytes } : {}),
      ...(blob && a.import ? { import: structuredClone(a.import) } : {}),
      ...(blob && a.meta ? { meta: structuredClone(a.meta) } : {}),
      ...(a.licence ? { licence: { ...a.licence } } : {}),
      created: created(),
    };
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

/** The ProjectRuntimeView (settings, tables, input map, flow) from the shipped doc texts. */
export function manifestRuntimeView(
  m: ReleaseManifest,
  texts: ReadonlyMap<AssetId, string>,
  game: GameDefinition,
): ProjectRuntimeView {
  return runtimeView(manifestView(m), jsonValues(texts), createRegistry(game));
}
