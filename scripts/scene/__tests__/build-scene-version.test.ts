// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { docToPrefab, docToScene, prefabToDoc, sceneToDoc } from "@jams/engine/collab";
import { finishExport, planContent, type BuiltCode, type ExportInput } from "@jams/engine/export";
import {
  buildSceneVersion,
  checkSceneVersion,
  readSceneVersion,
  type BuildSceneVersionOptions,
  type ReleaseManifest,
} from "@jams/engine/project";
import { formatPrefab, formatScene, type Prefab, type SceneDefinition } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { REPO_ROOT } from "../default-context";
import { DEFAULT_PROJECT_GLOBS, discoverProjects, projectById } from "../projects";
import { exportInputOf } from "../tools/game-build";

const GAMES = ["tactics", "platformer"] as const;

const RAPIER = {
  package: "@dimforge/rapier2d" as const,
  version: "0.19.3",
  file: "code/rapier-0a1b2c.wasm",
  bytes: 1_400_000,
};

const builtCode: BuiltCode = {
  files: [
    { path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" },
    { path: RAPIER.file, sha256: "f".repeat(64), bytes: RAPIER.bytes, role: "wasm" },
  ],
  entry: "code/main-abc123.js",
  rapier: RAPIER,
  thirdParty: [],
};

const optionsOf = (input: ExportInput, scene: string): BuildSceneVersionOptions => ({
  view: input.view,
  texts: input.texts,
  build: input.snapshot.build,
  game: input.game,
  registry: input.registry,
  scene,
});

/** A doc's canonical text after it crosses the wire, as the editor would build from it. */
function overTheWire(doc: Y.Doc): Y.Doc {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return remote;
}

let cache: string;
const inputs = new Map<string, ExportInput>();
const releases = new Map<string, ReleaseManifest>();

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), "build-scene-version-"));
  const projects = await discoverProjects(REPO_ROOT, DEFAULT_PROJECT_GLOBS, {
    cacheDirOf: (id) => join(cache, id),
  });
  for (const id of GAMES) {
    const project = projectById(projects, id);
    if (!project) throw new Error(`no ${id} project`);
    const input = await exportInputOf(project, "web");
    if (!("view" in input)) throw new Error(input.text);
    inputs.set(id, input);
    const plan = await planContent(input);
    releases.set(id, (await finishExport(plan, builtCode, input)).manifest);
  }
}, 120_000);

afterAll(async () => {
  await rm(cache, { recursive: true, force: true });
});

describe.each(GAMES)("buildSceneVersion over the %s project", (id) => {
  it("gives every listed scene the entry the content plan lists, and a version that fits the release", async () => {
    const input = inputs.get(id)!;
    const release = releases.get(id)!;
    const plan = await planContent(input);
    expect(plan.scenes.length).toBeGreaterThan(0);
    for (const entry of plan.scenes) {
      const result = await buildSceneVersion({ ...optionsOf(input, entry.id), release });
      if (!result.ok) throw new Error(`${entry.id}: ${JSON.stringify(result.issues, null, 2)}`);
      expect(result.version.entry, entry.id).toEqual(entry);
      expect(
        result.issues.filter((i) => i.severity === "error"),
        entry.id,
      ).toEqual([]);
      expect(checkSceneVersion(release, result.version, result.texts), entry.id).toEqual([]);
      for (const [asset, a] of Object.entries(result.version.assets))
        expect(a.sha256, `${entry.id} → ${asset}`).toBe(release.assets[asset]?.sha256);
      const read = readSceneVersion(result.version, result.texts, input.registry, input.game, {
        engine: input.engine,
      });
      expect(read.ok, entry.id).toBe(true);
    }
  });

  it("carries every atlas's texture with it", async () => {
    const input = inputs.get(id)!;
    const plan = await planContent(input);
    let atlases = 0;
    for (const entry of plan.scenes) {
      const result = await buildSceneVersion(optionsOf(input, entry.id));
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      for (const a of Object.values(result.version.assets)) {
        if (a.kind !== "atlas") continue;
        atlases++;
        const texture = a.import?.texture;
        expect(typeof texture).toBe("string");
        expect(result.version.assets[texture as string]?.kind).toBe("texture");
      }
    }
    if (id === "tactics") expect(atlases).toBeGreaterThan(0);
  });

  it("gives the files' id from co-edited docs, and again on a second run", async () => {
    const input = inputs.get(id)!;
    const [first] = (await planContent(input)).scenes;
    const scene = first!.id;
    const fromFiles = await buildSceneVersion(optionsOf(input, scene));
    if (!fromFiles.ok) throw new Error(JSON.stringify(fromFiles.issues));
    const again = await buildSceneVersion(optionsOf(input, scene));
    expect(again.ok && again.id).toBe(fromFiles.id);

    const texts = new Map(input.texts);
    const sceneDoc = sceneToDoc(JSON.parse(input.texts.get(scene)!) as SceneDefinition);
    texts.set(scene, formatScene(docToScene(overTheWire(sceneDoc))).text);
    for (const prefab of fromFiles.version.entry.prefabs) {
      const doc = prefabToDoc(JSON.parse(input.texts.get(prefab)!) as Prefab);
      texts.set(prefab, formatPrefab(docToPrefab(overTheWire(doc))));
    }
    const fromDocs = await buildSceneVersion({ ...optionsOf(input, scene), texts });
    expect(fromDocs.ok && fromDocs.id).toBe(fromFiles.id);
  });
});
