import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { CARD_TABLE, testGame } from "../../__tests__/fixtures/test-game";
import { layoutFromDoc, layoutPatch, layoutToDoc } from "../../collab/layout";
import { createRegistry, defineGame } from "../../game/define";
import { assetField, materialField, pointField, shapeField } from "../../game/fields";
import type { FieldEnv, GameDefinition, Registry } from "../../game/types";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
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
import type { DocLayout } from "../kinds/define";
import { engineResolution, gameSettingsIssues, gameSettingsKind } from "../kinds/game-settings";
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

  it("scene and prefab: a v2 file migrates to the current format", () => {
    const scene = parseAssetDoc(
      sceneKind,
      { v: 2, name: "old", bounds: [0, 0, 10, 10], entities: [] },
      engineEnv,
    );
    expect(scene).toMatchObject({ ok: true, migratedFrom: 2, value: { v: SCENE_FORMAT_VERSION } });
    const prefab = parseAssetDoc(
      prefabKind,
      { kind: "prefab", v: 2, id: "old", entities: [] },
      engineEnv,
    );
    expect(prefab).toMatchObject({ ok: true, migratedFrom: 2, value: { v: SCENE_FORMAT_VERSION } });
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

  it("material: render tint and blend parse, and tint converts to a number", () => {
    const paint = {
      kind: "material",
      v: 1,
      description: "Glow.",
      render: { tint: "#f80", blend: "add" },
    };
    expect(parsed(materialKind, paint)).toEqual(paint);
    expect(projectMaterialOf(paint)).toEqual({
      description: "Glow.",
      tint: 0xff8800,
      blend: "add",
    });
    expect(
      projectMaterialOf({ ...paint, render: { style: { fill: "#123456" }, tint: "#abcdef" } }),
    ).toEqual({ description: "Glow.", style: { fill: 0x123456 }, tint: 0xabcdef });
    expect(refused(materialKind, { ...paint, render: { tint: 0xff8800 } })).toEqual([
      { code: "schema", path: "/render/tint" },
    ]);
    expect(refused(materialKind, { ...paint, render: { blend: "overlay" } })).toEqual([
      { code: "schema", path: "/render/blend" },
    ]);
  });

  it("material: keeps render on one line in its file", () => {
    const text = lines(
      "{",
      '  "kind": "material",',
      '  "v": 1,',
      '  "description": "Glow.",',
      '  "render": { "blend": "screen", "style": { "fill": "#fff" }, "tint": "#f80" }',
      "}",
    );
    expect(formatAssetDoc(materialKind, parsed(materialKind, text))).toBe(text);
    const empty = lines(
      "{",
      '  "kind": "material",',
      '  "v": 1,',
      '  "description": "x",',
      '  "render": {}',
      "}",
    );
    expect(formatAssetDoc(materialKind, parsed(materialKind, empty))).toBe(empty);
    expect(read("../../scenes/materials/bouncy.json")).toBe(
      formatAssetDoc(
        materialKind,
        parsed(materialKind, read("../../scenes/materials/bouncy.json")),
      ),
    );
  });

  it("game-settings: `game` is the game's projectSettings, `engine` empty", () => {
    const base = value("game-settings");
    expect(refused(gameSettingsKind, { ...base, game: { avatarSpeed: -1 } })).toEqual([
      { code: "schema", path: "/game/avatarSpeed" },
    ]);
    expect(refused(gameSettingsKind, { ...base, game: { lives: 3 } })).toEqual([
      { code: "unknown-key", path: "/game/lives" },
    ]);
    expect(refused(gameSettingsKind, { ...base, engine: { fps: 60 } })).toEqual([
      { code: "unknown-key", path: "/engine/fps" },
    ]);
    expect(refused(gameSettingsKind, base, engineEnv)).toEqual([
      { code: "unknown-key", path: "/game/avatarSpeed" },
      { code: "unknown-key", path: "/game/title" },
    ]);
    expect(parsed(gameSettingsKind, { ...base, game: {} })).toEqual({ ...base, game: {} });
  });

  it("game-settings: `engine.resolution` is an all-optional resolution policy", () => {
    const base = value("game-settings");
    const resolution = {
      virtual: { width: 640, height: 360 },
      fit: "letterbox",
      integer: true,
      sampling: "nearest",
      antialias: false,
      pixelSnap: true,
      bars: 0x101010,
    };
    expect(parsed(gameSettingsKind, { ...base, engine: { resolution } })).toEqual({
      ...base,
      engine: { resolution },
    });
    expect(parsed(gameSettingsKind, { ...base, engine: { resolution: {} } })).toEqual({
      ...base,
      engine: { resolution: {} },
    });
    expect(
      parsed(gameSettingsKind, { ...base, engine: { resolution: { virtual: { height: 360 } } } }),
    ).toMatchObject({ engine: { resolution: { virtual: { height: 360 } } } });
    expect(
      refused(gameSettingsKind, { ...base, engine: { resolution: { fit: "stretch" } } }),
    ).toEqual([{ code: "schema", path: "/engine/resolution/fit" }]);
    expect(
      refused(gameSettingsKind, { ...base, engine: { resolution: { virtual: { depth: 3 } } } })
        .length,
    ).toBeGreaterThan(0);
    expect(refused(gameSettingsKind, { ...base, engine: { resolution: { scale: 2 } } })).toEqual([
      { code: "unknown-key", path: "/engine/resolution/scale" },
    ]);
  });

  it("game-settings: `engine` takes physics, gravity and tickRate beside resolution", () => {
    const base = value("game-settings");
    const engine = { physics: "none", gravity: [0, 0], tickRate: 30, resolution: { fit: "crop" } };
    expect(parsed(gameSettingsKind, { ...base, engine })).toEqual({ ...base, engine });
    expect(parsed(gameSettingsKind, { ...base, engine: { physics: "rapier" } })).toMatchObject({
      engine: { physics: "rapier" },
    });
    expect(refused(gameSettingsKind, { ...base, engine: { physics: "box2d" } })).toEqual([
      { code: "schema", path: "/engine/physics" },
    ]);
    expect(refused(gameSettingsKind, { ...base, engine: { gravity: [0] } })).toEqual([
      { code: "schema", path: "/engine/gravity/1" },
    ]);
    expect(refused(gameSettingsKind, { ...base, engine: { tickRate: "60" } })).toEqual([
      { code: "schema", path: "/engine/tickRate" },
    ]);
    for (const rate of [1, 60, 240])
      expect(
        parseAssetDoc(gameSettingsKind, { ...base, engine: { tickRate: rate } }, gameEnv).issues,
      ).toEqual([]);
  });

  it("game-settings: tick-rate-invalid for a rate the clock can't run", () => {
    const base = value("game-settings");
    for (const rate of [0, 241, 1.5]) {
      expect(refused(gameSettingsKind, { ...base, engine: { tickRate: rate } })).toEqual([
        { code: "tick-rate-invalid", path: "/engine/tickRate" },
      ]);
    }
    const text = lines(
      "{",
      '  "kind": "game-settings",',
      '  "v": 1,',
      '  "engine": {',
      '    "tickRate": 241',
      "  },",
      '  "game": {}',
      "}",
    );
    const result = parseAssetDoc(gameSettingsKind, text, gameEnv);
    expect(result.ok).toBe(false);
    const [issue] = result.issues;
    expect(issue).toMatchObject({ code: "tick-rate-invalid", severity: "error", line: 5 });
    expect(issue!.message).toMatch(/241/);
  });

  it("game-settings: engineResolution reads the block whole, else field by field", () => {
    expect(engineResolution({})).toBeUndefined();
    expect(engineResolution({ resolution: {} })).toBeUndefined();
    expect(engineResolution({ resolution: "big" })).toBeUndefined();
    expect(engineResolution({ resolution: { fit: "crop", integer: true } })).toEqual({
      fit: "crop",
      integer: true,
    });
    expect(
      engineResolution({ resolution: { fit: "stretch", integer: true, virtual: { height: 360 } } }),
    ).toEqual({ integer: true, virtual: { height: 360 } });
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
    behaviors: [],
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

  it("a material names no other asset; empty game-settings and data-table name none", () => {
    expect(
      refsOf(
        materialKind as DocKindDef,
        (materialKind as DocKindDef).empty(gameEnv, { id: "x" }),
        gameEnv,
      ),
    ).toBeUndefined();
    for (const kind of [gameSettingsKind, dataTableKind] as DocKindDef[])
      expect(refsOf(kind, kind.empty(gameEnv, { id: "x" }), gameEnv)).toEqual([]);
  });
});

describe("refs through asset fields", () => {
  const fieldEnv: FieldEnv = {
    materials: [],
    materialDefs: new Map(),
    types: [],
    assets: () => [],
  };
  const art = defineGame({
    ...(testGame as GameDefinition),
    id: "art",
    behaviors: [],
    types: [
      {
        type: "sign",
        description: "A sign with a picture.",
        base: "marker",
        fields: (env) => ({
          at: pointField("Where it stands."),
          skin: assetField(env, "texture", "Its picture.").optional(),
          frames: z
            .array(assetField(env, ["texture", "atlas"], "A frame."))
            .optional()
            .describe("Its frames."),
        }),
      },
    ],
    settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
    tables: {
      card: {
        description: "Cards.",
        row: { art: assetField(fieldEnv, "texture", "Its art.").optional() },
      },
    },
    projectSettings: { icon: assetField(fieldEnv, "texture", "The game's icon.").optional() },
  });
  const registry = createRegistry(art);
  const env: KindEnv = { registry, project: null };

  it("scene: the header, settings, type fields and asset overrides", () => {
    const sites = refsOf(
      sceneKind as DocKindDef,
      {
        v: 2,
        game: "art",
        name: "s",
        bounds: [0, 0, 10, 10],
        settings: { backdrop: "sky" },
        assets: ["boom", "hud-font"],
        instances: [
          {
            id: "i1",
            prefab: "post",
            at: [0, 0],
            overrides: { "board.skin": "wood", "board.at": [1, 1] },
          },
        ],
        entities: [
          { id: "s1", type: "sign", at: [1, 1], skin: "tiles", frames: ["a", "b"] },
          { id: "s2", type: "sign", at: [2, 2] },
        ],
      },
      env,
    );
    expect(sites).toEqual([
      { pointer: "/assets/0", id: "boom", kinds: [] },
      { pointer: "/assets/1", id: "hud-font", kinds: [] },
      { pointer: "/instances/@i1/prefab", id: "post", kinds: ["prefab"] },
      { pointer: "/instances/@i1/overrides/board.skin", id: "wood", kinds: ["texture"] },
      { pointer: "/entities/@s1/skin", id: "tiles", kinds: ["texture"] },
      { pointer: "/entities/@s1/frames/0", id: "a", kinds: ["texture", "atlas"] },
      { pointer: "/entities/@s1/frames/1", id: "b", kinds: ["texture", "atlas"] },
      { pointer: "/settings/backdrop", id: "sky", kinds: ["texture"] },
    ]);
  });

  it("scene: every behavior block an entity carries", () => {
    const glow = {
      name: "art/glow",
      description: "A glow.",
      fields: {},
      origin: "art",
      index: 0,
      shape: { halo: assetField(fieldEnv, "texture", "Its halo.").optional() },
    };
    const withBehaviors: Registry = { ...registry, behaviors: new Map([[glow.name, glow]]) };
    const sites = refsOf(
      sceneKind as DocKindDef,
      {
        v: 2,
        game: "art",
        name: "s",
        bounds: [0, 0, 10, 10],
        entities: [
          {
            id: "s1",
            type: "sign",
            at: [1, 1],
            behaviors: { "art/glow": { halo: "ring" }, "art/unknown": { halo: "x" } },
          },
        ],
      },
      { registry: withBehaviors, project: null },
    );
    expect(sites).toEqual([
      { pointer: "/entities/@s1/behaviors/art~1glow/halo", id: "ring", kinds: ["texture"] },
    ]);
  });

  it("prefab: its base, nested instances, header and children", () => {
    const sites = refsOf(
      prefabKind as DocKindDef,
      {
        kind: "prefab",
        v: 2,
        game: "art",
        id: "big-post",
        base: "post",
        assets: ["boom"],
        instances: [{ id: "inner", prefab: "lamp", at: [0, 0] }],
        entities: [{ id: "board", type: "sign", at: [0, 0], skin: "wood" }],
      },
      env,
    );
    expect(sites).toEqual([
      { pointer: "/base", id: "post", kinds: ["prefab"] },
      { pointer: "/assets/0", id: "boom", kinds: [] },
      { pointer: "/instances/@inner/prefab", id: "lamp", kinds: ["prefab"] },
      { pointer: "/entities/@board/skin", id: "wood", kinds: ["texture"] },
    ]);
  });

  it("a scene for another game names only its header and prefabs", () => {
    const sites = refsOf(
      sceneKind as DocKindDef,
      {
        v: 2,
        game: "elsewhere",
        name: "s",
        bounds: [0, 0, 10, 10],
        assets: ["boom"],
        settings: { backdrop: "sky" },
        entities: [{ id: "s1", type: "sign", at: [1, 1], skin: "tiles" }],
      },
      env,
    );
    expect(sites).toEqual([{ pointer: "/assets/0", id: "boom", kinds: [] }]);
  });

  it("data-table: each row by id; game-settings: the game block", () => {
    expect(
      refsOf(
        dataTableKind as DocKindDef,
        {
          kind: "data-table",
          v: 1,
          table: "card",
          rows: [{ id: "fireball", art: "flame" }, { id: "heal" }],
        },
        env,
      ),
    ).toEqual([{ pointer: "/rows/@fireball/art", id: "flame", kinds: ["texture"] }]);
    expect(
      refsOf(
        dataTableKind as DocKindDef,
        { kind: "data-table", v: 1, table: "nope", rows: [{ id: "a", art: "flame" }] },
        env,
      ),
      "a table the game doesn't declare has no fields",
    ).toEqual([]);
    expect(
      refsOf(
        gameSettingsKind as DocKindDef,
        { kind: "game-settings", v: 1, engine: {}, game: { icon: "logo", title: "x" } },
        env,
      ),
    ).toEqual([{ pointer: "/game/icon", id: "logo", kinds: ["texture"] }]);
  });
});

describe("material doc layout", () => {
  const layout = materialKind.layout as DocLayout;
  const pair = () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on("update", (u: Uint8Array) => Y.applyUpdate(b, u, "remote"));
    b.on("update", (u: Uint8Array) => Y.applyUpdate(a, u, "remote"));
    return { a, b };
  };
  const base = {
    kind: "material",
    v: 1,
    description: "Glow.",
    render: { style: { fill: "#fff" } },
  };

  it("holds render as a map, so concurrent tint and blend edits both survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    layoutToDoc(a, layout, base);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getMap("content").get("render")).toBeInstanceOf(Y.Map);

    layoutPatch(a, layout, { ...base, render: { ...base.render, tint: "#f80" } });
    layoutPatch(b, layout, { ...base, render: { ...base.render, blend: "add" } });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const merged = { ...base, render: { style: { fill: "#fff" }, tint: "#f80", blend: "add" } };
    expect(layoutFromDoc(a, layout)).toEqual(merged);
    expect(layoutFromDoc(b, layout)).toEqual(merged);
    expect(formatAssetDoc(materialKind, parsed(materialKind, layoutFromDoc(a, layout)))).toBe(
      formatAssetDoc(materialKind, parsed(materialKind, merged)),
    );
  });

  it("reads a render stored whole by an older client, and writes it as a map from then on", () => {
    const { a, b } = pair();
    a.getMap("content").set("kind", "material");
    a.getMap("content").set("v", 1);
    a.getMap("content").set("description", "Glow.");
    a.getMap("content").set("render", { style: { fill: "#fff" } });
    expect(layoutFromDoc(b, layout)).toEqual(base);

    layoutPatch(b, layout, { ...base, render: { ...base.render, tint: "#f80" } });
    expect(a.getMap("content").get("render")).toBeInstanceOf(Y.Map);
    expect(layoutFromDoc(a, layout)).toEqual({
      ...base,
      render: { style: { fill: "#fff" }, tint: "#f80" },
    });
  });

  it("an empty render reads back as the file's empty map", () => {
    const doc = new Y.Doc();
    layoutToDoc(doc, layout, { ...base, render: {} });
    expect(layoutFromDoc(doc, layout)).toEqual({ ...base, render: {} });
    layoutPatch(doc, layout, base);
    layoutPatch(doc, layout, { ...base, render: {} });
    expect(layoutFromDoc(doc, layout)).toEqual({ ...base, render: {} });
  });
});

describe("game-settings doc layout", () => {
  const layout = gameSettingsKind.layout as DocLayout;
  const base = { kind: "game-settings", v: 1, engine: { gravity: [0, 1] }, game: {} };

  it("holds engine as a map, so concurrent tickRate and physics edits both survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    layoutToDoc(a, layout, base);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    layoutPatch(a, layout, { ...base, engine: { ...base.engine, tickRate: 30 } });
    layoutPatch(b, layout, { ...base, engine: { ...base.engine, physics: "none" } });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const merged = { ...base, engine: { gravity: [0, 1], tickRate: 30, physics: "none" } };
    expect(layoutFromDoc(a, layout)).toEqual(merged);
    expect(layoutFromDoc(b, layout)).toEqual(merged);
    expect(parseAssetDoc(gameSettingsKind, merged, gameEnv).ok).toBe(true);
  });
});
