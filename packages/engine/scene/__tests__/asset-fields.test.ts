import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { buildHashes } from "../../collab/project-session";
import { createRegistry, defineGame, withProject } from "../../game/define";
import { assetField, pointField } from "../../game/fields";
import type { FieldEnv } from "../../game/types";
import { createKindRegistry, docKindJsonSchema, type DocKindDef } from "../../project/kinds";
import type { AssetEntry, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import { sceneJsonSchema, toJsonSchema } from "../json-schema";
import type { SceneDefinition } from "../types";
import { validateScene } from "../validate";

const fieldEnv: FieldEnv = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };

const art = defineGame({
  id: "art",
  types: [
    {
      type: "sign",
      description: "A sign with a picture.",
      base: "marker",
      fields: (env) => ({
        at: pointField("Where it stands."),
        skin: assetField(env, "texture", "Its picture.").optional(),
        cue: assetField(env, ["audio"], "What it plays.").optional(),
      }),
    },
  ],
  settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
  tables: {
    card: { description: "Cards.", row: { art: assetField(fieldEnv, "texture", "Its art.") } },
  },
  projectSettings: { icon: assetField(fieldEnv, "texture", "The game's icon.").optional() },
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(art);
const kinds = createKindRegistry(art);

const blob = { sha256: "0".repeat(64), bytes: 1 };
const entry = (id: string, kind: string, path: string, extra: Partial<AssetEntry> = {}) =>
  ({ key: id, id, kind, path, created: { at: 0, by: "seed" }, ...extra }) satisfies AssetEntry;

function stateOf(entries: AssetEntry[]): ProjectState {
  return {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
}

const base = [
  entry("yard", "scene", "levels/yard.json"),
  entry("tiles", "texture", "art/tiles.png", blob),
  entry("bricks", "texture", "art/bricks.png", blob),
  entry("boom", "audio", "sfx/boom.wav", blob),
];
const view = projectView(stateOf(base), kinds);

type Node = Record<string, unknown>;
const at = (schema: unknown, ...path: string[]): Node =>
  path.reduce<Node>((node, key) => node[key] as Node, schema as Node);
const docSchema = (kind: string, project: typeof view | null) =>
  docKindJsonSchema(kinds.get(kind) as DocKindDef, { registry, project });
const signOf = (schema: unknown): Node => {
  const entities = at(schema, "$defs", "Entity", "oneOf") as unknown as Node[];
  return entities.find((e) => at(e, "properties", "type").const === "sign")!;
};

describe("asset field enums", () => {
  it("lists the project's live ids of the field's kinds, and nothing without a project", () => {
    const withProject = docSchema("scene", view);
    expect(at(signOf(withProject), "properties", "skin").enum).toEqual(["bricks", "tiles"]);
    expect(at(signOf(withProject), "properties", "cue").enum).toEqual(["boom"]);
    expect(at(withProject, "properties", "settings", "properties", "backdrop").enum).toEqual([
      "bricks",
      "tiles",
    ]);
    const settings = docSchema("game-settings", view);
    expect(at(settings, "properties", "game", "properties", "icon").enum).toEqual([
      "bricks",
      "tiles",
    ]);

    const bare = docSchema("scene", null);
    expect(at(signOf(bare), "properties", "skin")).not.toHaveProperty("enum");
    expect(at(signOf(bare), "properties", "skin")["x-asset-kind"]).toEqual(["texture"]);
    expect(JSON.stringify(sceneJsonSchema(registry))).not.toContain('"enum":["bricks"');
  });

  it("leaves out an enum when no asset of the kinds is live", () => {
    const empty = projectView(stateOf([entry("yard", "scene", "levels/yard.json")]), kinds);
    expect(at(signOf(docSchema("scene", empty)), "properties", "skin")).not.toHaveProperty("enum");
  });

  it("keeps the ids an asset field's builder was given, dropping an empty list", () => {
    const given = z.object({
      a: z.string().meta({ "x-asset-kind": ["texture"], enum: ["tiles"] }),
      b: z.string().meta({ "x-asset-kind": ["texture"], enum: [] }),
    });
    const props = at(toJsonSchema(given), "properties");
    expect(at(props, "a").enum).toEqual(["tiles"]);
    expect(at(props, "b")).not.toHaveProperty("enum");
    const overridden = at(toJsonSchema(given, { assets: () => [] }), "properties");
    expect(at(overridden, "a")).not.toHaveProperty("enum");
  });
});

describe("asset ids under validation", () => {
  const yard: SceneDefinition = {
    v: 2,
    game: "art",
    name: "yard",
    bounds: [0, 0, 100, 100],
    settings: { backdrop: "tile" },
    assets: ["boom", "gone"],
    entities: [{ id: "s1", type: "sign", at: [1, 1], skin: "boom", cue: "boom" }],
  };
  const codes = (issues: ReturnType<typeof validateScene>) =>
    issues
      .filter((i) => i.code === "asset-missing" || i.code === "asset-kind")
      .map((i) => [i.code, i.path, i.got])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  it("reports dangling ids as asset-missing with a did-you-mean, and wrong kinds as asset-kind", () => {
    const issues = validateScene(yard, registry, { project: view });
    expect(codes(issues)).toEqual([
      ["asset-missing", "/assets/1", "gone"],
      ["asset-kind", "/entities/0/skin", "audio"],
      ["asset-missing", "/settings/backdrop", "tile"],
    ]);
    const backdrop = issues.find((i) => i.path === "/settings/backdrop")!;
    expect(backdrop.message).toContain('did you mean "tiles"?');
    expect(backdrop.expected).toBe("texture");
  });

  it("checks no asset id without a project", () => {
    expect(codes(validateScene(yard, registry))).toEqual([]);
  });
});

describe("code-skew hashes", () => {
  it("don't move when an asset is imported", async () => {
    const before = await buildHashes(kinds, withProject(registry, view, new Map()));
    const imported = projectView(
      stateOf([...base, entry("grass", "texture", "art/grass.png", blob)]),
      kinds,
    );
    const live = withProject(registry, imported, new Map());
    expect(await buildHashes(kinds, live)).toEqual(before);
    expect(await kinds.schemaHashes({ registry: live, project: imported })).toEqual(
      await kinds.schemaHashes({ registry, project: null }),
    );
  });
});
