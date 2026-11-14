import type * as Y from "yjs";

import type { ProjectSession } from "../../collab/index";
import { createRegistry, type defineGame } from "../../game/index";
import type { ReleaseManifest } from "../../project/index";
import { ENGINE_FORMATS } from "../../project/release";
import { AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { ENGINE_VERSION } from "../../version";
import { buildOpenSceneVersion } from "../session/open-scene-version";

/**
 * A preview release of project `p` holding only `hall` as `doc` holds it
 * now, with `edit` applied to its manifest, and the scene version's texts.
 */
export async function releaseOf(
  project: ProjectSession,
  doc: Y.Doc,
  game: ReturnType<typeof defineGame>,
  edit: (m: ReleaseManifest) => void = () => {},
): Promise<{ manifest: ReleaseManifest; texts: Record<string, string> }> {
  const made = await buildOpenSceneVersion(project, "hall", doc, createRegistry(game), game);
  if (!made.ok) throw new Error(JSON.stringify(made.issues));
  const scene = made.version.assets.hall!;
  const manifest: ReleaseManifest = {
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { ...ENGINE_FORMATS },
    },
    game: { id: game.id, configHash: game.configHash ?? null, saveVersion: null },
    project: {
      id: "p",
      name: "P",
      snapshot: "0".repeat(64),
      snapshotEngine: ENGINE_VERSION,
      build: project.hashes,
    },
    build: { hash: "1".repeat(64), target: "web", rapier: null, entry: "code/main.js", files: [] },
    time: { kind: "fixed", rate: 60, catchUp: null, wakeOnPointerMove: false },
    replay: { acrossPlatforms: true },
    flow: { start: "hall", scenes: [made.version.entry] },
    projectBundle: { entries: [], bytes: 0 },
    assets: { hall: { ...scene, file: `data/${scene.sha256}.json` } },
    credits: { assets: [], missing: [], code: [] },
    budget: {
      limits: { codeBytes: 1, firstLoadBytes: 1, totalBytes: 1, fileBytes: 1 },
      measured: {
        codeBytes: 0,
        wasmBytes: 0,
        firstLoadBytes: 0,
        assetBytes: 0,
        dataBytes: 0,
        totalBytes: 0,
        largestFile: { path: "", bytes: 0 },
      },
      over: [],
    },
    pwa: null,
  };
  edit(manifest);
  return { manifest, texts: Object.fromEntries(made.texts) };
}
