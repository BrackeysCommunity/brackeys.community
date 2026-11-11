// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { createKindRegistry, parseAssetDoc, validateAssetDoc, type KindEnv } from "../kinds";
import { SCENE_LIST_KIND, sceneListKind, type SceneListFile } from "../kinds/scene-list";
import type { AssetEntry, ProjectState } from "../types";
import { projectView } from "../view";

const registry = createRegistry();
const kinds = createKindRegistry(null);

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 1, by: "seed" },
});

const viewOf = (assets: AssetEntry[]) => {
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(assets.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  return projectView(state, kinds);
};

const codes = (value: SceneListFile) =>
  validateAssetDoc(sceneListKind, value, { registry, project: null }).map((i) => [
    i.code,
    i.severity,
  ]);

describe("a new scene list", () => {
  it("lists every live scene by path, the first as start, and parses clean", () => {
    const view = viewOf([
      entry("yard", "scene", "scenes/yard.json"),
      entry("attic", "scene", "a/attic.json"),
      entry("gate", "prefab", "prefabs/gate.json"),
      entry("cellar", "scene", "scenes/cellar.json"),
    ]);
    const env: KindEnv = { registry, project: view };
    const made = sceneListKind.empty(env);
    expect(made).toEqual({
      kind: SCENE_LIST_KIND,
      v: 1,
      start: "attic",
      scenes: [{ scene: "attic" }, { scene: "cellar" }, { scene: "yard" }],
    });
    const read = parseAssetDoc(sceneListKind, made, env);
    expect(read.ok && read.issues).toEqual([]);
  });

  it("starts nowhere in a project without scenes, a warning since nothing is listed", () => {
    const env: KindEnv = { registry, project: viewOf([]) };
    const made = sceneListKind.empty(env);
    expect(made).toEqual({ kind: SCENE_LIST_KIND, v: 1, start: null, scenes: [] });
    expect(codes(made)).toEqual([["start-scene-missing", "warn"]]);
  });

  it("refuses a null start once a scene is listed", () => {
    const listed: SceneListFile = {
      kind: SCENE_LIST_KIND,
      v: 1,
      start: null,
      scenes: [{ scene: "yard" }],
    };
    expect(codes(listed)).toEqual([["start-scene-missing", "error"]]);
    expect(parseAssetDoc(sceneListKind, listed, { registry, project: null }).ok).toBe(false);
  });
});
