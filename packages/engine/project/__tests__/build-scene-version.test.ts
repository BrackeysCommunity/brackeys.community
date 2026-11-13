import { beforeAll, describe, expect, it } from "vite-plus/test";
// @vitest-environment node
import * as Y from "yjs";

import { heldInput, png, type HeldFiles } from "../../__tests__/fixtures/held-project";
import { testGame } from "../../__tests__/fixtures/test-game";
import { pair } from "../../collab/__tests__/helpers";
import { docToScene } from "../../collab/convert";
import { docToPrefab, prefabToDoc } from "../../collab/prefab-doc";
import { planContent } from "../../export/content";
import { finishExport, type BuiltCode, type ExportInput } from "../../export/plan";
import { formatPrefab, formatScene } from "../../scene/format";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { ENGINE_VERSION } from "../../version";
import { ENGINE_FORMATS, releaseId, type ReleaseManifest } from "../release";
import {
  buildSceneVersion,
  checkSceneVersion,
  formatSceneVersion,
  parseSceneVersion,
  readSceneVersion,
  sceneVersionId,
  type BuildSceneVersionOptions,
} from "../scene-version";
import type { AssetId } from "../types";
import { ENGINE_DIR, ENGINE_PROJECT, readHeld } from "./fixtures/scene-version/held-files";

const SINK = "kitchen-sink";
const SINK_PATH = "kitchen-sink.json";

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

const optionsOf = (input: ExportInput, scene: AssetId = SINK): BuildSceneVersionOptions => ({
  view: input.view,
  texts: input.texts,
  build: input.snapshot.build,
  game: input.game,
  registry: input.registry,
  scene,
});

/** The engine project with `edit` applied to the kitchen sink's definition, written back canonically. */
function editedSink(held: HeldFiles, edit: (def: SceneDefinition) => void): HeldFiles {
  const def = JSON.parse(held.texts.get(SINK_PATH)!) as SceneDefinition;
  edit(def);
  const text = formatScene(def).text;
  const texts = new Map(held.texts);
  texts.set(SINK_PATH, text);
  return {
    texts,
    files: held.files.map((f) => (f.path === SINK_PATH ? { path: f.path, json: def } : f)),
  };
}

async function built(opts: BuildSceneVersionOptions) {
  const result = await buildSceneVersion(opts);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result;
}

describe("buildSceneVersion over the engine project", () => {
  let held: HeldFiles;
  let input: ExportInput;
  let release: ReleaseManifest;

  beforeAll(async () => {
    held = readHeld(ENGINE_DIR);
    input = await heldInput(ENGINE_PROJECT, held, testGame);
    const plan = await planContent(input);
    release = (await finishExport(plan, builtCode, input)).manifest;
  });

  it("gives each listed scene the entry the content plan lists for it", async () => {
    const plan = await planContent(input);
    for (const entry of plan.scenes) {
      const { version } = await built(optionsOf(input, entry.id));
      expect(version.entry, entry.id).toEqual(entry);
    }
    const annex = await built(optionsOf(input, "grid-annex"));
    expect(annex.version.entry).toMatchObject({ sublevel: true, title: "Grid annex" });
  });

  it("stamps this code's compatibility, and carries the scene, its prefabs and its bundle under live/", async () => {
    const { version, texts } = await built(optionsOf(input));
    expect(version).toMatchObject({
      kind: "scene-version",
      v: 1,
      project: "engine",
      scene: SINK,
      engine: ENGINE_VERSION,
      base: null,
      compat: {
        formats: { scene: ENGINE_FORMATS.scene, prefab: ENGINE_FORMATS.prefab },
        build: input.snapshot.build,
        game: { id: testGame.id, configHash: testGame.configHash ?? null },
      },
    });
    expect(version.entry.physics).toBe("rapier");
    expect(version.entry.prefabs).toEqual(expect.arrayContaining(["gate", "post"]));
    for (const id of [SINK, ...version.entry.prefabs, ...version.entry.bundle.entries])
      expect(version.assets[id], id).toBeDefined();
    expect(Object.keys(version.assets)).toEqual(Object.keys(version.assets).sort());
    for (const [id, a] of Object.entries(version.assets)) {
      if (a.storage === "doc") {
        expect(a.file, id).toBe(`live/${a.sha256}.json`);
        expect(texts.get(a.sha256), id).toBe(input.texts.get(id));
      } else expect(a.file, id).toMatch(new RegExp(`^live/${a.sha256}\\.(png|json)$`));
    }
    expect(
      Object.values(version.assets).some((a) => a.kind === "scene" && a.path !== SINK_PATH),
    ).toBe(false);
    expect(parseSceneVersion(formatSceneVersion(version))).toEqual({ ok: true, version });
  });

  it("carries an atlas's texture with the atlas", async () => {
    const { version } = await built(optionsOf(input));
    expect(version.assets.crates?.kind).toBe("atlas");
    expect(version.assets["crates-texture"]).toMatchObject({ kind: "texture", storage: "blob" });
    expect(version.entry.bundle.entries).toContain("crates-texture");
  });

  it("reads back for play from the texts it returns", async () => {
    const { version, texts } = await built(optionsOf(input));
    const read = readSceneVersion(version, texts, input.registry, input.game, {
      engine: input.engine,
    });
    expect(read.ok, JSON.stringify(!read.ok && read.issues)).toBe(true);
  });

  it("checks against a release it fits with no issue, and names it as the base", async () => {
    const result = await built({ ...optionsOf(input), release });
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.version.base).toBe(await releaseId(release));
    for (const [id, a] of Object.entries(result.version.assets))
      expect(a.sha256, id).toBe(release.assets[id]?.sha256);
    expect(checkSceneVersion(release, result.version, result.texts)).toEqual([]);
  });

  it("carries a new image, and keeps the release's hash for an unchanged one", async () => {
    const fresh = editedSink(held, (def) => {
      def.assets = [...(def.assets ?? []), "fresh"];
    });
    fresh.files.push({ path: "art/fresh.png", sidecar: png("fresh", "9".repeat(64), 64, 8) });
    const changed = await heldInput(ENGINE_PROJECT, fresh, testGame);
    const result = await built({ ...optionsOf(changed), release });
    expect(release.assets.fresh).toBeUndefined();
    expect(result.version.assets.fresh).toMatchObject({
      sha256: "9".repeat(64),
      file: `live/${"9".repeat(64)}.png`,
    });
    expect(result.version.entry.bundle.entries).toContain("fresh");
    expect(result.version.assets["crates-texture"]?.sha256).toBe(
      release.assets["crates-texture"]?.sha256,
    );
    expect(result.version.assets[SINK]?.sha256).not.toBe(release.assets[SINK]?.sha256);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("refuses a changed shared image against the release with live-asset-conflict", async () => {
    const files = held.files.map((f) =>
      f.path === "art/crates.png" && f.sidecar
        ? { ...f, sidecar: { ...f.sidecar, sha256: "7".repeat(64) } }
        : f,
    );
    const changed = await heldInput(ENGINE_PROJECT, { files, texts: held.texts }, testGame);
    const result = await built({ ...optionsOf(changed), release });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "live-asset-conflict",
        severity: "error",
        entityIds: [SINK, "crates-texture"],
        expected: release.assets["crates-texture"]?.sha256,
        got: "7".repeat(64),
      }),
    ]);
  });

  it("stops at a validation error", async () => {
    const broken = editedSink(held, (def) => {
      def.entities = [...(def.entities ?? []), { ...def.entities![0]! }];
    });
    const result = await buildSceneVersion(
      optionsOf(await heldInput(ENGINE_PROJECT, broken, testGame)),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("refuses a scene the project doesn't have, and one with no text", async () => {
    const none = await buildSceneVersion(optionsOf(input, "no-such-level"));
    expect(none).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "asset-missing", got: "no-such-level" })],
    });
    const texts = new Map(input.texts);
    texts.delete(SINK);
    const textless = await buildSceneVersion({ ...optionsOf(input), texts });
    expect(textless.ok).toBe(false);
    expect(textless.issues[0]).toMatchObject({ code: "asset-missing", got: SINK });
  });

  it("refuses a reached prefab with no text", async () => {
    const texts = new Map(input.texts);
    texts.delete("gate");
    const result = await buildSceneVersion({ ...optionsOf(input), texts });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "asset-missing", got: "gate" }),
    );
  });

  describe("identity", () => {
    it("gives one id on a second run", async () => {
      const first = await built(optionsOf(input));
      const again = await built(
        optionsOf(await heldInput(ENGINE_PROJECT, readHeld(ENGINE_DIR), testGame)),
      );
      expect(again.id).toBe(first.id);
      expect(first.id).toBe(await sceneVersionId(first.version));
    });

    it("gives the files' id from co-edited docs' canonical texts", async () => {
      const fromFiles = await built(optionsOf(input));
      const texts = new Map(input.texts);
      const [, remote] = pair(JSON.parse(input.texts.get(SINK)!) as SceneDefinition);
      texts.set(SINK, formatScene(docToScene(remote)).text);
      for (const id of fromFiles.version.entry.prefabs) {
        const doc = prefabToDoc(JSON.parse(input.texts.get(id)!) as Prefab);
        const wire = new Y.Doc();
        Y.applyUpdate(wire, Y.encodeStateAsUpdate(doc));
        texts.set(id, formatPrefab(docToPrefab(wire)));
      }
      const fromDocs = await built({ ...optionsOf(input), texts });
      expect(fromDocs.id).toBe(fromFiles.id);
    });

    it("gives a new id for one changed character", async () => {
      const first = await built(optionsOf(input));
      const edited = editedSink(held, (def) => {
        const note = def.entities!.find((e) => e.id === "about-sprites") as unknown as {
          text: string;
        };
        note.text = `${note.text}!`;
      });
      const next = await built(optionsOf(await heldInput(ENGINE_PROJECT, edited, testGame)));
      expect(next.id).not.toBe(first.id);
      expect(next.version.sceneHash).not.toBe(first.version.sceneHash);
    });
  });
});
