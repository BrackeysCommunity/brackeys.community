import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { CARD_TABLE, testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { materialField, shapeField } from "../../game/fields";
import type { GameDefinition } from "../../game/types";
import {
  createKindRegistry,
  defineAssetKind,
  formatAssetDoc,
  parseAssetDoc,
  type DocKindDef,
  type KindEnv,
} from "../kinds";
import { checksKind } from "../kinds/checks";
import { dataTableIssues, dataTableKind } from "../kinds/data-table";
import { gameSettingsIssues, gameSettingsKind } from "../kinds/game-settings";
import { ENGINE_ASSET_KINDS } from "../kinds/index";
import { inputScriptKind } from "../kinds/input-script";
import { materialKind, projectMaterialOf } from "../kinds/material";
import { prefabKind } from "../kinds/prefab";
import { sceneKind } from "../kinds/scene";
import type { AssetEntry, ProjectView } from "../types";
import { engineHomeRegistry } from "./fixtures/engine-home";

const engineEnv: KindEnv = { registry: createRegistry(), project: null };
const gameEnv: KindEnv = { registry: createRegistry(testGame), project: null };

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const FIXTURES = {
  material: lines(
    "{",
    '  "$schema": "../material.schema.json",',
    '  "kind": "material",',
    '  "v": 1,',
    '  "description": "Bouncy rubber.",',
    '  "physics": { "friction": 0.4, "impulse": { "x": 0, "y": -700 }, "restitution": 0.9 },',
    '  "render": { "style": { "alpha": 0.5, "fill": "#e05a5a" } }',
    "}",
  ),
  "game-settings": lines(
    "{",
    '  "kind": "game-settings",',
    '  "v": 1,',
    '  "engine": {},',
    '  "game": {',
    '    "avatarSpeed": 240,',
    '    "title": "Deck"',
    "  }",
    "}",
  ),
  "data-table": lines(
    "{",
    '  "kind": "data-table",',
    '  "v": 1,',
    '  "table": "card",',
    '  "rows": [',
    '    { "id": "fireball", "cost": 3, "damage": 5 },',
    '    { "id": "heal", "cost": 2 }',
    "  ]",
    "}",
  ),
  "input-script": lines(
    "{",
    '  "v": 1,',
    '  "scene": "kitchen-sink",',
    '  "at": [100, 200],',
    '  "maxTicks": 600,',
    '  "steps": [',
    '    { "for": 30, "hold": ["right"] },',
    '    { "press": "push" },',
    '    { "hold": [], "until": { "tick": 120 } },',
    '    { "wait": 10 }',
    "  ]",
    "}",
  ),
  checks: lines(
    "{",
    '  "v": 1,',
    '  "checks": [',
    '    { "id": "valid", "kind": "valid", "physical": true },',
    '    { "id": "settles", "kind": "reaches", "result": "script-end", "script": { "scene": "kitchen-sink", "steps": [{ "wait": 60 }], "v": 1 } }',
    "  ]",
    "}",
  ),
} as const;

const DECLARATIVE: DocKindDef[] = [
  materialKind,
  gameSettingsKind,
  dataTableKind,
  inputScriptKind,
  checksKind,
];

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function parsed<J>(kind: DocKindDef<J>, text: unknown, env: KindEnv = gameEnv): J {
  const result = parseAssetDoc(kind, text, env);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.value;
}

function refused(kind: DocKindDef, value: unknown, env: KindEnv = gameEnv) {
  const result = parseAssetDoc(kind, value, env);
  expect(result.ok).toBe(false);
  return result.issues.map((i) => ({ code: i.code, path: i.path }));
}

const entry = (id: string, kind: string, path: string, key = id): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 0, by: "test" },
});

function viewOf(entries: AssetEntry[]): ProjectView {
  return {
    state: {
      meta: { projectId: "test", layout: 1, name: "Test" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    byId: new Map(entries.map((e) => [e.id, e])),
    byPath: new Map(entries.map((e) => [e.path, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
    deleted: [],
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };
}

describe("ENGINE_ASSET_KINDS", () => {
  it("lists the engine's kinds and code, in order, as the default kind registry", () => {
    const names = ENGINE_ASSET_KINDS.map((k) => k.kind);
    expect(names).toEqual([
      "scene",
      "prefab",
      "material",
      "game-settings",
      "data-table",
      "input-script",
      "checks",
      "texture",
      "atlas",
      "font",
      "audio",
      "recording",
      "code",
    ]);
    expect(
      createKindRegistry()
        .list()
        .map((k) => k.kind),
    ).toEqual(names);
  });

  it("detects each kind's files", () => {
    const kinds = createKindRegistry(testGame);
    const kindOf = (path: string, json?: unknown) => kinds.detect(path, json)?.kind ?? null;
    expect(kindOf("levels/a.json", { v: 2, name: "a", bounds: [0, 0, 1, 1] })).toBe("scene");
    expect(kindOf("prefabs/gate.json", { kind: "prefab", v: 2 })).toBe("prefab");
    expect(kindOf("materials/rubber.json", { kind: "material", v: 1 })).toBe("material");
    expect(kindOf("settings.json", { kind: "game-settings", v: 1 })).toBe("game-settings");
    expect(kindOf("data/deck.json", { kind: "data-table", v: 1 })).toBe("data-table");
    expect(kindOf("a.script.json", { v: 1, steps: [] })).toBe("input-script");
    expect(kindOf("a.checks.json", { v: 1, checks: [] })).toBe("checks");
    expect(kindOf("notes.json", { title: "no v" })).toBeNull();
    expect(kindOf("module.ts")).toBeNull();
  });

  it("schema-hashes every doc kind for a game", async () => {
    const hashes = await createKindRegistry(testGame).schemaHashes(gameEnv);
    expect(Object.keys(hashes).sort()).toEqual(
      DECLARATIVE.map((k) => k.kind)
        .concat("scene", "prefab", "texture", "atlas", "font", "audio", "recording")
        .sort(),
    );
    const engine = await createKindRegistry().schemaHashes(engineEnv);
    expect(engine["material"]).toBe(hashes["material"]);
    expect(engine["data-table"]).not.toBe(hashes["data-table"]);
    expect(engine["game-settings"]).not.toBe(hashes["game-settings"]);
  });
});

describe("parse → format", () => {
  for (const kind of DECLARATIVE) {
    const text = FIXTURES[kind.kind as keyof typeof FIXTURES];
    it(`${kind.kind}: is byte-identical on its fixture`, () => {
      expect(formatAssetDoc(kind, parsed(kind, text))).toBe(text);
    });

    it(`${kind.kind}: formats a reordered value to the same text`, () => {
      const value = JSON.parse(text) as Record<string, unknown>;
      const reversed = Object.fromEntries(Object.entries(value).reverse());
      expect(formatAssetDoc(kind, parsed(kind, reversed))).toBe(text);
    });

    it(`${kind.kind}: its empty value parses and formats back`, () => {
      const empty = kind.empty(gameEnv, { id: "fresh" });
      const out = formatAssetDoc(kind, empty);
      expect(formatAssetDoc(kind, parsed(kind, out))).toBe(out);
    });
  }

  const files = [
    ["scene", sceneKind, "../../scenes/kitchen-sink.json"],
    ["scene", sceneKind, "../../scenes/engine-yard.json"],
    ["prefab", prefabKind, "../../scenes/prefabs/gate.json"],
    ["prefab", prefabKind, "../../scenes/prefabs/post.json"],
  ] as const;
  for (const [name, kind, path] of files) {
    it(`${name}: wraps the scene format, byte-identical on ${path}`, () => {
      const text = read(path);
      const home: KindEnv = { registry: engineHomeRegistry(), project: null };
      expect(formatAssetDoc(kind as DocKindDef, parsed(kind as DocKindDef, text, home))).toBe(text);
    });
  }

  it("scene and prefab: their empty values parse and format back", () => {
    for (const kind of [sceneKind, prefabKind] as DocKindDef[]) {
      for (const env of [engineEnv, gameEnv]) {
        const out = formatAssetDoc(kind, kind.empty(env, { id: "fresh" }));
        expect(formatAssetDoc(kind, parsed(kind, out, env))).toBe(out);
      }
    }
  });

  it("scene: migrates a v1 file through the scene migrations", () => {
    const result = parseAssetDoc(
      sceneKind,
      { v: 1, name: "old", bounds: [0, 0, 10, 10], entities: [] },
      engineEnv,
    );
    expect(result.ok && result.migratedFrom).toBe(1);
  });

  it("a declarative kind migrates through its own migrations", () => {
    const deck = defineAssetKind({
      kind: "deck",
      title: "Deck",
      description: "A deck.",
      match: { jsonKind: "deck" },
      storage: "doc",
      version: 2,
      migrations: { 1: (raw) => ({ ...(raw as object), v: 2, size: 0 }) },
      schemaId: "urn:test:deck:v2",
      schema: () => z.strictObject({ kind: z.literal("deck"), v: z.literal(2), size: z.number() }),
      layout: { as: "map" },
      empty: () => ({ kind: "deck", v: 2, size: 0 }),
    });
    const result = parseAssetDoc(deck, '{ "kind": "deck", "v": 1 }', engineEnv);
    expect(result).toEqual({
      ok: true,
      value: { kind: "deck", v: 2, size: 0 },
      migratedFrom: 1,
      issues: [],
    });
    expect(refused(deck, { kind: "deck", v: 3 })).toEqual([{ code: "version-newer", path: "/v" }]);
    expect(refused({ ...deck, version: 3 }, { kind: "deck", v: 1 })).toEqual([
      { code: "schema", path: "/v" },
    ]);
  });
});

describe("schema refusals", () => {
  const value = (kind: keyof typeof FIXTURES) =>
    JSON.parse(FIXTURES[kind]) as Record<string, unknown>;

  it("refuses text that isn't JSON, a non-object, a wrong kind and a missing v", () => {
    expect(refused(materialKind, "{ nope")).toEqual([{ code: "schema", path: "" }]);
    expect(refused(materialKind, [1])).toEqual([{ code: "schema", path: "" }]);
    expect(refused(materialKind, { ...value("material"), kind: "texture" })).toEqual([
      { code: "schema", path: "/kind" },
    ]);
    const { v: _, ...noV } = value("material");
    expect(refused(materialKind, noV)).toEqual([{ code: "schema", path: "/v" }]);
    expect(refused(materialKind, { ...value("material"), v: 2 })).toEqual([
      { code: "version-newer", path: "/v" },
    ]);
  });

  it("gives issues read from text their line", () => {
    const text = FIXTURES.material.replace('"friction": 0.4', '"friction": -1');
    const result = parseAssetDoc(materialKind, text, gameEnv);
    expect(!result.ok && result.issues[0]).toMatchObject({ path: "/physics/friction", line: 6 });
  });

  it("material: description required, physics and render optional", () => {
    const { description: _, ...rest } = value("material");
    expect(refused(materialKind, rest)).toEqual([{ code: "schema", path: "/description" }]);
    expect(parsed(materialKind, { kind: "material", v: 1, description: "Paint." })).toEqual({
      kind: "material",
      v: 1,
      description: "Paint.",
    });
    expect(refused(materialKind, { ...value("material"), physics: { friction: 1 } })).toEqual([
      { code: "schema", path: "/physics/restitution" },
    ]);
    expect(
      refused(materialKind, { ...value("material"), render: { style: { fill: "red" } } }),
    ).toEqual([{ code: "schema", path: "/render/style/fill" }]);
    expect(refused(materialKind, { ...value("material"), hardness: 3 })).toEqual([
      { code: "unknown-key", path: "/hardness" },
    ]);
  });

  it("material: overlays the registry as physics and a numeric style", () => {
    expect(projectMaterialOf(value("material"))).toEqual({
      description: "Bouncy rubber.",
      physics: { friction: 0.4, restitution: 0.9, impulse: { x: 0, y: -700 } },
      style: { fill: 0xe05a5a, alpha: 0.5 },
    });
    expect(projectMaterialOf({ kind: "material", v: 1, description: "Ink." })).toEqual({
      description: "Ink.",
    });
    expect(
      projectMaterialOf({
        kind: "material",
        v: 1,
        description: "Ink.",
        render: { style: { stroke: "#0f8" } },
      }),
    ).toEqual({ description: "Ink.", style: { stroke: 0x00ff88 } });
    expect(projectMaterialOf({ kind: "material", v: 1 })).toBeNull();
  });

  it("game-settings: `game` is the game's projectSettings, `engine` empty", () => {
    const base = value("game-settings");
    expect(refused(gameSettingsKind, { ...base, game: { avatarSpeed: -1 } })).toEqual([
      { code: "schema", path: "/game/avatarSpeed" },
    ]);
    expect(refused(gameSettingsKind, { ...base, game: { lives: 3 } })).toEqual([
      { code: "unknown-key", path: "/game/lives" },
    ]);
    expect(refused(gameSettingsKind, { ...base, engine: { tickRate: 60 } })).toEqual([
      { code: "unknown-key", path: "/engine/tickRate" },
    ]);
    expect(refused(gameSettingsKind, base, engineEnv)).toEqual([
      { code: "unknown-key", path: "/game/avatarSpeed" },
      { code: "unknown-key", path: "/game/title" },
    ]);
    expect(parsed(gameSettingsKind, { ...base, game: {} })).toEqual({ ...base, game: {} });
  });

  it("game-settings: a second one in a project is asset-kind", () => {
    const view = viewOf([
      entry("settings", "game-settings", "settings.json"),
      entry("more", "game-settings", "z/more.json"),
      entry("deck", "data-table", "data/deck.json"),
    ]);
    const issues = gameSettingsIssues(view);
    expect(issues.map((i) => [i.code, i.entityIds])).toEqual([["asset-kind", ["more"]]]);
    expect(issues[0]!.message).toMatch(/"settings" \(settings\.json\) is the project's/);
    expect(gameSettingsIssues(viewOf([entry("settings", "game-settings", "s.json")]))).toEqual([]);
  });

  it("data-table: the table must be one the game declares, any without a game", () => {
    const base = value("data-table");
    const result = parseAssetDoc(dataTableKind, { ...base, table: "cards" }, gameEnv);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toEqual([
      expect.objectContaining({
        code: "asset-kind",
        path: "/table",
        got: "cards",
        expected: CARD_TABLE,
        message: expect.stringContaining('did you mean "card"?'),
      }),
    ]);
    expect(parseAssetDoc(dataTableKind, base, engineEnv).issues).toEqual([]);
  });

  it("data-table: rows are judged by the row schema plus id", () => {
    const base = value("data-table");
    const rows = (...r: unknown[]) => ({ ...base, rows: r });
    expect(refused(dataTableKind, rows({ id: "a" }))).toEqual([
      { code: "schema", path: "/rows/0/cost" },
    ]);
    expect(refused(dataTableKind, rows({ id: "a", cost: 1, mana: 2 }))).toEqual([
      { code: "unknown-key", path: "/rows/0/mana" },
    ]);
    expect(refused(dataTableKind, rows({ cost: 1 }))).toEqual([
      { code: "schema", path: "/rows/0/id" },
    ]);
    expect(refused(dataTableKind, rows({ id: "Bad Id", cost: 1 }))).toEqual([
      { code: "schema", path: "/rows/0/id" },
    ]);
    expect(refused(dataTableKind, rows({ id: "a", cost: 1 }, { id: "a", cost: 2 }))).toEqual([
      { code: "dup-id", path: "/rows/1/id" },
    ]);
  });

  it("data-table: a row id repeated across a table's assets is dup-id", () => {
    const deck = (table: string, ...ids: string[]) => ({
      kind: "data-table",
      v: 1,
      table,
      rows: ids.map((id) => ({ id, cost: 1 })),
    });
    const view = viewOf([
      entry("b", "data-table", "data/b.json"),
      entry("a", "data-table", "data/a.json"),
      entry("other", "data-table", "data/other.json"),
    ]);
    const values = new Map<string, unknown>([
      ["a", deck("card", "fireball", "heal")],
      ["b", deck("card", "heal", "bolt", "bolt")],
      ["other", deck("relic", "heal")],
    ]);
    const issues = dataTableIssues(view, values);
    expect(issues.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["dup-id", "/rows/0/id", ["b", "heal"]],
    ]);
    expect(issues[0]!.message).toMatch(/"a" \(data\/a\.json\) and "b" \(data\/b\.json\)/);
  });

  it("input-script and checks keep their schemas", () => {
    const script = value("input-script");
    expect(refused(inputScriptKind, { ...script, steps: [{ hold: ["fly"], for: 1 }] })).toEqual([
      expect.objectContaining({ code: "schema" }),
    ]);
    expect(refused(inputScriptKind, { ...script, steps: [] })).toEqual([
      { code: "schema", path: "/steps" },
    ]);
    const checks = value("checks");
    expect(
      refused(checksKind, { ...checks, checks: [{ id: "x", kind: "valid", physical: "yes" }] }),
    ).toEqual([expect.objectContaining({ code: "schema" })]);
    expect(
      refused(checksKind, {
        ...checks,
        checks: [
          { id: "x", kind: "valid" },
          { id: "x", kind: "valid" },
        ],
      }),
    ).toEqual([{ code: "dup-id", path: "/checks/1/id" }]);
  });

  it("scene and prefab report their parsers' issues", () => {
    const scene = { v: 2, name: "s", bounds: [0, 0, 10, 10], entities: [{ id: "a", type: "?" }] };
    expect(refused(sceneKind, scene, engineEnv)).toEqual([
      expect.objectContaining({ code: "unknown-type" }),
    ]);
    expect(
      refused(prefabKind, { kind: "prefab", v: 2, id: "Bad", entities: [] }, engineEnv),
    ).toEqual([{ code: "bad-id", path: "/id" }]);
  });
});

const refsOf = (kind: DocKindDef, value: unknown, env: KindEnv) => kind.refs?.(value, env);

describe("refs", () => {
  const surfaces = defineGame({
    ...(testGame as GameDefinition),
    id: "surfaces",
    materials: {
      ice: { friction: 0, restitution: 0, description: "Slippery." },
      rubber: { friction: 1, restitution: 0.9, description: "Bouncy." },
    },
    types: [
      {
        type: "pad",
        description: "A pad with a top and a side material.",
        base: "solid",
        fields: (env) => ({
          shape: shapeField("Its shape."),
          top: materialField(env, "Top surface."),
          side: materialField(env, "Side surface."),
          label: z.string().optional().describe("A name, not a material."),
        }),
      },
    ],
  });
  const env: KindEnv = { registry: createRegistry(surfaces), project: null };

  it("scene: instances' prefab and every material field, by id", () => {
    const sites = refsOf(
      sceneKind as DocKindDef,
      {
        v: 2,
        game: "surfaces",
        name: "s",
        bounds: [0, 0, 10, 10],
        instances: [{ id: "i1", prefab: "gate", at: [0, 0] }],
        entities: [
          { id: "floor", type: "solid", shape: ["box", 0, 0, 1, 1], material: "rubber" },
          { id: "plain", type: "solid", shape: ["box", 0, 0, 1, 1] },
          {
            id: "p",
            type: "pad",
            shape: ["box", 0, 0, 1, 1],
            top: "ice",
            side: "rubber",
            label: "rubber",
          },
        ],
      },
      env,
    );
    expect(sites).toEqual([
      { pointer: "/instances/@i1/prefab", id: "gate", kinds: ["prefab"] },
      { pointer: "/entities/@floor/material", id: "rubber", kinds: ["material"] },
      { pointer: "/entities/@p/top", id: "ice", kinds: ["material"] },
      { pointer: "/entities/@p/side", id: "rubber", kinds: ["material"] },
    ]);
  });

  it("scene: without materials there are no material sites", () => {
    const sites = refsOf(
      sceneKind as DocKindDef,
      {
        v: 2,
        name: "s",
        bounds: [0, 0, 10, 10],
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 1, 1] }],
      },
      engineEnv,
    );
    expect(sites).toEqual([]);
  });

  it("prefab: its children's material fields", () => {
    const sites = refsOf(
      prefabKind as DocKindDef,
      {
        kind: "prefab",
        v: 2,
        game: "surfaces",
        id: "ramp",
        entities: [{ id: "slope", type: "solid", shape: ["box", 0, 0, 1, 1], material: "ice" }],
      },
      env,
    );
    expect(sites).toEqual([
      { pointer: "/entities/@slope/material", id: "ice", kinds: ["material"] },
    ]);
  });

  it("input-script: its scene; checks: inline scripts' scene", () => {
    expect(
      refsOf(inputScriptKind as DocKindDef, JSON.parse(FIXTURES["input-script"]), env),
    ).toEqual([{ pointer: "/scene", id: "kitchen-sink", kinds: ["scene"] }]);
    expect(refsOf(inputScriptKind as DocKindDef, { v: 1, steps: [{ wait: 1 }] }, env)).toEqual([]);
    const checks = JSON.parse(FIXTURES.checks) as { checks: unknown[] };
    checks.checks.push({ id: "by-path", kind: "reaches", script: "a.script.json", result: "won" });
    expect(refsOf(checksKind as DocKindDef, checks, env)).toEqual([
      { pointer: "/checks/@settles/script/scene", id: "kitchen-sink", kinds: ["scene"] },
    ]);
  });

  it("material, game-settings and data-table name no other asset", () => {
    for (const kind of [materialKind, gameSettingsKind, dataTableKind] as DocKindDef[])
      expect(refsOf(kind, kind.empty(gameEnv, { id: "x" }), gameEnv)).toBeUndefined();
  });
});
