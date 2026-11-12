// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { locatePointer } from "../../scene/parse";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  createKindRegistry,
  docKindJsonSchema,
  formatAssetDoc,
  parseAssetDoc,
  validateAssetDoc,
  type KindEnv,
} from "../kinds";
import {
  SCENE_LIST_KIND,
  SCENE_LIST_SCHEMA_ID,
  sceneListFlow,
  sceneListIssues,
  sceneListKind,
  type SceneListFile,
} from "../kinds/scene-list";
import { checkProjectBatch, type ProjectBatchCheck, type ProjectOp } from "../ops";
import { buildRefIndex } from "../refs";
import { runtimeView } from "../runtime-view";
import type { AssetEntry, AssetId, ProjectState } from "../types";
import { projectView } from "../view";

const registry = createRegistry();
const kinds = createKindRegistry(null);
const env: KindEnv = { registry, project: null };

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const TEXT = lines(
  "{",
  '  "kind": "scene-list",',
  '  "v": 1,',
  '  "start": "menu",',
  '  "scenes": [',
  '    { "scene": "menu", "title": "Title" },',
  '    { "scene": "ford", "title": "Ford" },',
  '    { "scene": "result" },',
  '    { "scene": "cellar", "sublevel": true }',
  "  ]",
  "}",
);
const LIST = JSON.parse(TEXT) as SceneListFile;

const list = (over: Partial<SceneListFile> = {}): SceneListFile => ({
  ...structuredClone(LIST),
  ...over,
});

const codes = (value: unknown) =>
  validateAssetDoc(sceneListKind, value, env).map((i) => [i.code, i.severity, i.path]);

const entry = (key: string, kind: string, path: string, id = key): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 1, by: "seed" },
});

const scene = (name: string) => ({
  v: SCENE_FORMAT_VERSION,
  name,
  bounds: [0, 0, 10, 10],
  entities: [],
});

const state = (extra: AssetEntry[] = [], without?: string): ProjectState => ({
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: Object.fromEntries(
    [
      entry("menu", "scene", "levels/menu.json"),
      entry("ford", "scene", "levels/ford.json"),
      entry("result", "scene", "levels/result.json"),
      entry("cellar", "scene", "levels/cellar.json"),
      entry("flow", SCENE_LIST_KIND, "scene-list.json"),
      ...extra,
    ]
      .filter((e) => e.key !== without)
      .map((e) => [e.key, e]),
  ),
  history: {},
  code: {},
  build: {},
});

const docs = (value: unknown = LIST) =>
  new Map<string, unknown>([
    ["menu", scene("menu")],
    ["ford", scene("ford")],
    ["result", scene("result")],
    ["cellar", scene("cellar")],
    ["flow", structuredClone(value)],
  ]);

function batch(ops: ProjectOp[], s = state(), d = docs()): ProjectBatchCheck {
  let n = 0;
  return checkProjectBatch(
    s,
    d,
    { v: 1, ops },
    {
      registry,
      kinds,
      now: 100,
      by: "ada",
      newKey: () => `new${n++}`,
    },
  );
}

describe("the scene-list kind", () => {
  it("is registered as one per project, detected by its JSON kind", () => {
    expect(kinds.get(SCENE_LIST_KIND)).toBe(sceneListKind);
    expect(sceneListKind.perProject).toBe(1);
    expect(kinds.detect("scene-list.json", LIST)?.kind).toBe(SCENE_LIST_KIND);
    expect(sceneListKind.defaultFolder?.()).toBe("");
  });

  it("formats canonically: byte-identical on its file, the same text for a reordered value", () => {
    const read = parseAssetDoc(sceneListKind, TEXT, env);
    expect(read.ok && read.issues).toEqual([]);
    if (!read.ok) return;
    expect(formatAssetDoc(sceneListKind, read.value)).toBe(TEXT);
    const reversed = Object.fromEntries(Object.entries(LIST).reverse()) as SceneListFile;
    expect(formatAssetDoc(sceneListKind, reversed)).toBe(TEXT);
  });

  it("is empty as { start: null, scenes: [] }, which reads with a warning and formats back", () => {
    const empty = sceneListKind.empty();
    expect(empty).toEqual({ kind: SCENE_LIST_KIND, v: 1, start: null, scenes: [] });
    const text = formatAssetDoc(sceneListKind, empty);
    const read = parseAssetDoc(sceneListKind, text, env);
    expect(read.ok).toBe(true);
    expect(read.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["start-scene-missing", "warn", "/start"],
    ]);
    expect(read.ok && formatAssetDoc(sceneListKind, read.value)).toBe(text);
    expect(sceneListFlow(empty)).toEqual({ start: null, scenes: [] });
  });

  it("refuses a list whose start isn't listed or is a sublevel with start-scene-missing", () => {
    expect(codes(LIST)).toEqual([]);
    expect(codes(list({ start: "vault" }))).toEqual([["start-scene-missing", "error", "/start"]]);
    expect(codes(list({ start: "cellar" }))).toEqual([["start-scene-missing", "error", "/start"]]);
    const refused = parseAssetDoc(
      sceneListKind,
      formatAssetDoc(sceneListKind, list({ start: "vault" })),
      env,
    );
    expect(refused.ok).toBe(false);
    expect(refused.issues[0]).toMatchObject({ code: "start-scene-missing", line: 4 });
  });

  it("reports a scene listed twice as dup-id", () => {
    const twice = list({ scenes: [...LIST.scenes, { scene: "ford", title: "Again" }] });
    expect(codes(twice)).toEqual([["dup-id", "error", "/scenes/4/scene"]]);
  });

  it("refuses unknown keys and a non-literal sublevel", () => {
    expect(codes({ ...LIST, extra: 1 }).map(([code]) => code)).toContain("unknown-key");
    expect(
      codes(list({ scenes: [{ scene: "menu", sublevel: false as unknown as true }] })).map(
        ([code]) => code,
      ),
    ).toContain("schema");
  });

  it("writes its JSON Schema (UPDATE_SCHEMAS=1 regenerates; the first run writes it)", () => {
    const file = new URL("../scene-list.schema.json", import.meta.url);
    const schema = docKindJsonSchema(sceneListKind, env);
    if (process.env.UPDATE_SCHEMAS || !existsSync(file))
      writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
    expect(schema.$id).toBe(SCENE_LIST_SCHEMA_ID);
    expect(SCENE_LIST_SCHEMA_ID).toBe("urn:jams-engine:scene-list:v1");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });
});

describe("scene-list references", () => {
  it("names the start and every listed scene as scenes", () => {
    expect(sceneListKind.refs!(LIST)).toEqual([
      { pointer: "/start", id: "menu", kinds: ["scene"] },
      { pointer: "/scenes/0/scene", id: "menu", kinds: ["scene"] },
      { pointer: "/scenes/1/scene", id: "ford", kinds: ["scene"] },
      { pointer: "/scenes/2/scene", id: "result", kinds: ["scene"] },
      { pointer: "/scenes/3/scene", id: "cellar", kinds: ["scene"] },
    ]);
    expect(sceneListKind.refs!(sceneListKind.empty())).toEqual([]);
  });

  it("reports an entry naming no scene as asset-missing", () => {
    const view = projectView(state(), kinds);
    const values = new Map<AssetId, unknown>([
      ["flow", list({ scenes: [...LIST.scenes, { scene: "vault" }] })],
    ]);
    const dangling = buildRefIndex(view, values, kinds, { registry, project: view }).dangling();
    expect(dangling.map((i) => [i.code, i.path, i.got])).toEqual([
      ["asset-missing", "/scenes/4/scene", "vault"],
    ]);
  });

  it("changeAssetId of the start scene rewrites start and its entry in one write", () => {
    const r = batch([{ op: "changeAssetId", id: "menu", to: "title" }]);
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.written).toContain("flow");
    const value = r.values.get("flow") as SceneListFile;
    expect(value.start).toBe("title");
    expect(value.scenes[0]).toEqual({ scene: "title", title: "Title" });
    expect(value.scenes.slice(1)).toEqual(LIST.scenes.slice(1));
  });

  it("changeAssetId of a listed scene rewrites its entry and leaves start", () => {
    const r = batch([{ op: "changeAssetId", id: "cellar", to: "crypt" }]);
    if (!r.ok) throw new Error(r.issue.message);
    const value = r.values.get("flow") as SceneListFile;
    expect(value.start).toBe("menu");
    expect(value.scenes[3]).toEqual({ scene: "crypt", sublevel: true });
  });

  it("renaming or moving a listed scene's file keeps the list naming it", () => {
    const r = batch([
      { op: "renameAsset", id: "ford", file: "river.json" },
      { op: "moveAsset", ids: ["result"], to: "end/" },
    ]);
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.written).not.toContain("flow");
    const view = projectView(r.state, kinds);
    const values = new Map<AssetId, unknown>([["flow", LIST]]);
    expect(buildRefIndex(view, values, kinds, { registry, project: view }).dangling()).toEqual([]);
  });

  it("refuses deleting a listed scene with asset-in-use naming the list", () => {
    const r = batch([{ op: "deleteAsset", id: "ford" }]);
    if (r.ok) throw new Error("expected asset-in-use");
    expect(r.issue.code).toBe("asset-in-use");
    expect(r.issue.detail?.referrers).toEqual([{ id: "flow", pointer: "/scenes/1/scene" }]);
  });

  it("refuses an edit that points start at an unlisted scene, and a second list", () => {
    const edit = batch([
      { op: "editAsset", id: "flow", edits: [{ set: "/start", value: "vault" }] },
    ]);
    expect(!edit.ok && edit.issue.code).toBe("start-scene-missing");
    const second = batch([
      { op: "createAsset", kind: SCENE_LIST_KIND, path: "more/scene-list.json" },
    ]);
    expect(!second.ok && second.issue.code).toBe("asset-kind");
  });

  it("creates its empty value and takes an inserted entry", () => {
    const s = state([], "flow");
    const created = batch(
      [{ op: "createAsset", kind: SCENE_LIST_KIND, path: "scene-list.json" }],
      s,
    );
    if (!created.ok) throw new Error(created.issue.message);
    expect(created.state.assets.new0).toMatchObject({ id: "scene-list", path: "scene-list.json" });
    const insert: ProjectOp[] = [
      { op: "editAsset", id: "flow", edits: [{ insert: "/scenes/-", value: { scene: "result" } }] },
    ];
    const without = list({ scenes: LIST.scenes.filter((e) => e.scene !== "result") });
    const filled = batch(insert, state(), docs(without));
    if (!filled.ok) throw new Error(filled.issue.message);
    expect((filled.values.get("flow") as SceneListFile).scenes.at(-1)).toEqual({ scene: "result" });
    const again = batch(insert);
    expect(again.ok).toBe(false);
  });

  it("a second list is asset-kind in the project view", () => {
    const view = projectView(state([entry("more", SCENE_LIST_KIND, "z/scene-list.json")]), kinds);
    expect(view.issues.map((i) => [i.code, i.entityIds])).toEqual([["asset-kind", ["more"]]]);
  });
});

describe("scene-unlisted", () => {
  const checks = {
    v: 3,
    checks: [
      { id: "valid", kind: "valid" },
      {
        id: "wins",
        kind: "reaches",
        result: "won",
        expect: { scene: "vault" },
        script: {
          v: 2,
          scene: "ford",
          steps: [
            { wait: 10 },
            { hold: [], until: { scene: "result" } },
            { hold: [], until: { scene: "attic" } },
            { hold: [], until: { scene: "cellar" } },
          ],
        },
      },
      { id: "walks", kind: "reaches", result: "script-end", script: "walk.script.json" },
      { id: "joined", kind: "connected", from: [0, 0], to: [[1, 1]] },
    ],
  };
  const walk = {
    v: 2,
    scene: "ford",
    tracks: [{ player: 0, steps: [{ hold: [], until: { scene: "lair" } }] }],
  };
  const files = [
    entry("ford-checks", "checks", "levels/ford.checks.json"),
    entry("walk", "input-script", "levels/walk.script.json"),
  ];
  const values = () =>
    new Map<AssetId, unknown>([
      ["flow", LIST],
      ["ford-checks", checks],
      ["walk", walk],
    ]);

  it("warns for each scene a listed scene's reaches checks name that the list doesn't hold", () => {
    const view = projectView(state(files), kinds);
    const issues = sceneListIssues(view, values());
    expect(issues.map((i) => [i.code, i.severity, i.entityIds, i.path])).toEqual([
      ["scene-unlisted", "warn", ["ford-checks", "vault"], "/checks/1/expect/scene"],
      ["scene-unlisted", "warn", ["ford-checks", "attic"], "/checks/1/script/steps/2/until/scene"],
      ["scene-unlisted", "warn", ["ford-checks", "cellar"], "/checks/1/script/steps/3/until/scene"],
      ["scene-unlisted", "warn", ["walk", "lair"], "/tracks/0/steps/0/until/scene"],
    ]);
    expect(issues[0]?.detail).toEqual({ scene: "ford", check: "wins", list: "flow" });
    expect(issues[0]?.message).toBe(
      `"vault" isn't in the scene list, so flow can't load it: the "wins" check of listed scene "ford" names it (levels/ford.checks.json at /checks/1/expect/scene)`,
    );
    expect(issues[2]?.message).toMatch(/"cellar" is listed as a sublevel/);
  });

  it("gives each issue its line in the file that names the scene", () => {
    const view = projectView(state(files), kinds);
    const text = JSON.stringify(checks, null, 2);
    const [first] = sceneListIssues(view, values(), {
      lineOf: (id, pointer) => (id === "ford-checks" ? locatePointer(text, pointer) : undefined),
    });
    expect(first?.line).toBe(locatePointer(text, "/checks/1/expect/scene"));
    expect(first?.line).toBeGreaterThan(1);
  });

  it("judges nothing without a list, and only listed scenes' checks", () => {
    const view = projectView(state(files), kinds);
    const unread = values();
    unread.delete("flow");
    expect(sceneListIssues(view, unread)).toEqual([]);
    const s = state(files, "flow");
    expect(sceneListIssues(projectView(s, kinds), values())).toEqual([]);
    const unlistedFord = new Map(values());
    unlistedFord.set("flow", list({ scenes: LIST.scenes.filter((e) => e.scene !== "ford") }));
    expect(sceneListIssues(view, unlistedFord)).toEqual([]);
  });
});

describe("ProjectRuntimeView.flow over a project", () => {
  it("gives the list's start and scenes", () => {
    const view = projectView(state(), kinds);
    const { flow } = runtimeView(view, docs(), registry);
    expect(flow).toEqual({ start: "menu", scenes: LIST.scenes });
  });
});
