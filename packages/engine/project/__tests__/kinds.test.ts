import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { CARD_TABLE, testGame } from "../../__tests__/fixtures/test-game";
import { layoutFromDoc, layoutPatch, layoutToDoc } from "../../collab/layout";
import { createRegistry, defineGame } from "../../game/define";
import { assetField, materialField, pointField, shapeField } from "../../game/fields";
import { formatSaveFile, type SaveFile } from "../../game/save-file";
import type { FieldEnv, GameDefinition, Registry } from "../../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { parseRecording } from "../../scene/recording-schema";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  createKindRegistry,
  defineAssetKind,
  docKindJsonSchema,
  formatAssetDoc,
  parseAssetDoc,
  type DocKindDef,
  type KindEnv,
} from "../kinds";
import { animationKind } from "../kinds/animation";
import { checksKind } from "../kinds/checks";
import { dataTableIssues, dataTableKind } from "../kinds/data-table";
import { isPerProject, type DocLayout } from "../kinds/define";
import { engineResolution, gameSettingsIssues, gameSettingsKind } from "../kinds/game-settings";
import { ENGINE_ASSET_KINDS, inputMapIssues } from "../kinds/index";
import { INPUT_MAP_SCHEMA_ID, inputMapKind, inputMapProblems } from "../kinds/input-map";
import { inputScriptKind } from "../kinds/input-script";
import { materialKind, projectMaterialOf } from "../kinds/material";
import { prefabKind } from "../kinds/prefab";
import { recordingKind, recordingMetaSchema } from "../kinds/recording";
import { saveKind } from "../kinds/save";
import { sceneKind } from "../kinds/scene";
import { sceneListKind } from "../kinds/scene-list";
import type { AssetEntry, ProjectView } from "../types";
import { projectUsage } from "../usage";
import { engineHomeRegistry } from "./fixtures/engine-home";

const engineEnv: KindEnv = { registry: createRegistry(), project: null };
const gameEnv: KindEnv = { registry: createRegistry(testGame), project: null };

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const FIXTURES = {
  material: lines(
    "{",
    '  "$schema": "../material.schema.json",',
    '  "kind": "material",',
    '  "v": 2,',
    '  "description": "Bouncy rubber.",',
    '  "physics": { "friction": 0.4, "impulse": { "x": 0, "y": -7 }, "restitution": 0.9 },',
    '  "render": { "style": { "alpha": 0.5, "fill": "#e05a5a" } }',
    "}",
  ),
  "game-settings": lines(
    "{",
    '  "kind": "game-settings",',
    '  "v": 2,',
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
    '  "v": 2,',
    '  "table": "card",',
    '  "rows": [',
    '    { "id": "fireball", "cost": 3, "damage": 5 },',
    '    { "id": "heal", "cost": 2 }',
    "  ]",
    "}",
  ),
  "input-script": lines(
    "{",
    '  "v": 2,',
    '  "scene": "kitchen-sink",',
    '  "at": [1, 2],',
    '  "maxTicks": 600,',
    '  "steps": [',
    '    { "for": 30, "hold": ["right"] },',
    '    { "press": "push" },',
    '    { "hold": [], "until": { "tick": 120 } },',
    '    { "wait": 10 }',
    "  ]",
    "}",
  ),
  "input-map": lines(
    "{",
    '  "kind": "input-map",',
    '  "v": 1,',
    '  "players": {',
    '    "join": "press",',
    '    "max": 2',
    "  },",
    '  "actions": [',
    '    { "action": "push", "bindings": [{ "code": "Space", "device": "key" }, { "button": "south", "device": "pad" }, { "control": "jump", "device": "touch" }] },',
    '    { "action": "left", "bindings": [{ "code": "KeyA", "device": "key", "player": 1 }], "kind": "button" }',
    "  ],",
    '  "touch": [',
    '    { "id": "jump", "action": "push", "at": [0.85, 0.8], "kind": "button", "label": "Push", "radius": 0.08 }',
    "  ],",
    '  "deadzone": 0.2',
    "}",
  ),
  "scene-list": lines(
    "{",
    '  "kind": "scene-list",',
    '  "v": 1,',
    '  "start": "engine-yard",',
    '  "scenes": [',
    '    { "scene": "engine-yard", "title": "Engine yard" },',
    '    { "scene": "kitchen-sink" }',
    "  ]",
    "}",
  ),
  animation: lines(
    "{",
    '  "kind": "animation",',
    '  "v": 1,',
    '  "atlas": "hero",',
    '  "clips": [',
    '    { "name": "idle", "loop": "pingpong", "tag": "idle" },',
    '    { "name": "jab", "frames": [{ "frame": "hero-0", "ms": 50 }, { "events": ["swing"], "frame": "hero-1", "shapes": { "hit": [["box", 0.2, 0, 0.1, 0.05]] } }], "loop": "once", "next": "idle" }',
    "  ]",
    "}",
  ),
  checks: lines(
    "{",
    '  "v": 3,',
    '  "checks": [',
    '    { "id": "valid", "kind": "valid", "physical": true },',
    '    { "id": "settles", "kind": "reaches", "result": "script-end", "script": { "scene": "kitchen-sink", "steps": [{ "wait": 60 }], "v": 2 } }',
    "  ]",
    "}",
  ),
} as const;

const DECLARATIVE: DocKindDef[] = [
  materialKind,
  gameSettingsKind,
  dataTableKind,
  inputScriptKind,
  inputMapKind,
  sceneListKind,
  checksKind,
  animationKind,
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
  it("marks game-settings, input-map and scene-list, and no other kind, one per project", () => {
    expect(ENGINE_ASSET_KINDS.filter(isPerProject).map((k) => k.kind)).toEqual([
      "game-settings",
      "input-map",
      "scene-list",
    ]);
  });

  it("lists the engine's kinds and code, in order, as the default kind registry", () => {
    const names = ENGINE_ASSET_KINDS.map((k) => k.kind);
    expect(names).toEqual([
      "scene",
      "prefab",
      "material",
      "game-settings",
      "data-table",
      "input-script",
      "input-map",
      "scene-list",
      "checks",
      "texture",
      "atlas",
      "font",
      "audio",
      "recording",
      "save",
      "code",
      "animation",
      "emitter",
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
    expect(kindOf("input-map.json", { kind: "input-map", v: 1 })).toBe("input-map");
    expect(kindOf("scene-list.json", { kind: "scene-list", v: 1 })).toBe("scene-list");
    expect(kindOf("art/hero.anim.json", { kind: "animation", v: 1 })).toBe("animation");
    expect(kindOf("fx/sparks.json", { kind: "emitter", v: 1 })).toBe("emitter");
    expect(kindOf("notes.json", { title: "no v" })).toBeNull();
    expect(kindOf("module.ts")).toBeNull();
  });

  it("schema-hashes every doc kind for a game", async () => {
    const hashes = await createKindRegistry(testGame).schemaHashes(gameEnv);
    expect(Object.keys(hashes).sort()).toEqual(
      DECLARATIVE.map((k) => k.kind)
        .concat(
          "scene",
          "prefab",
          "texture",
          "atlas",
          "font",
          "audio",
          "recording",
          "save",
          "emitter",
        )
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
    expect(refused(materialKind, { ...value("material"), v: 3 })).toEqual([
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
    expect(parsed(materialKind, { kind: "material", v: 2, description: "Paint." })).toEqual({
      kind: "material",
      v: 2,
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
      physics: { friction: 0.4, restitution: 0.9, impulse: { x: 0, y: -7 } },
      style: { fill: 0xe05a5a, alpha: 0.5 },
    });
    expect(projectMaterialOf({ kind: "material", v: 2, description: "Ink." })).toEqual({
      description: "Ink.",
    });
    expect(
      projectMaterialOf({
        kind: "material",
        v: 2,
        description: "Ink.",
        render: { style: { stroke: "#0f8" } },
      }),
    ).toEqual({ description: "Ink.", style: { stroke: 0x00ff88 } });
    expect(projectMaterialOf({ kind: "material", v: 2 })).toBeNull();
  });

  it("material: render tint and blend parse, and tint converts to a number", () => {
    const paint = {
      kind: "material",
      v: 2,
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
      '  "v": 2,',
      '  "description": "Glow.",',
      '  "render": { "blend": "screen", "style": { "fill": "#fff" }, "tint": "#f80" }',
      "}",
    );
    expect(formatAssetDoc(materialKind, parsed(materialKind, text))).toBe(text);
    const empty = lines(
      "{",
      '  "kind": "material",',
      '  "v": 2,',
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
      '  "v": 2,',
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
      v: 2,
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

  it("input-script: v2 takes tracks, and a tracks script formats one step per line", () => {
    const tracks = lines(
      "{",
      '  "v": 2,',
      '  "scene": "kitchen-sink",',
      '  "players": 1,',
      '  "tracks": [',
      '    { "player": 0, "steps": [',
      '      { "pointer": { "at": [1.5, 2], "press": "primary" } },',
      '      { "for": 4, "pointer": { "at": [1.5, 2], "drag": [3, 2], "release": "primary" } },',
      '      { "join": "pad:0" },',
      '      { "leave": "pad:0" }',
      "    ] }",
      "  ]",
      "}",
    );
    expect(formatAssetDoc(inputScriptKind, parsed(inputScriptKind, tracks))).toBe(tracks);
    expect(refused(inputScriptKind, { v: 2, tracks: [] })).toEqual([
      { code: "schema", path: "/tracks" },
    ]);
    const both = { v: 2, steps: [{ wait: 1 }], tracks: [{ player: 0, steps: [{ wait: 1 }] }] };
    expect(refused(inputScriptKind, both)).toEqual([{ code: "schema", path: "/tracks" }]);
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
    expect(refsOf(inputScriptKind as DocKindDef, { v: 2, steps: [{ wait: 1 }] }, env)).toEqual([]);
    const checks = JSON.parse(FIXTURES.checks) as { checks: unknown[] };
    checks.checks.push({ id: "by-path", kind: "reaches", script: "a.script.json", result: "won" });
    expect(refsOf(checksKind as DocKindDef, checks, env)).toEqual([
      { pointer: "/checks/@settles/script/scene", id: "kitchen-sink", kinds: ["scene"] },
    ]);
  });

  it("scene-list: its start and every listed scene, entries by index", () => {
    expect(refsOf(sceneListKind as DocKindDef, JSON.parse(FIXTURES["scene-list"]), env)).toEqual([
      { pointer: "/start", id: "engine-yard", kinds: ["scene"] },
      { pointer: "/scenes/0/scene", id: "engine-yard", kinds: ["scene"] },
      { pointer: "/scenes/1/scene", id: "kitchen-sink", kinds: ["scene"] },
    ]);
  });

  it("animation: its atlas; a new one names the project's first atlas by path", () => {
    expect(refsOf(animationKind as DocKindDef, JSON.parse(FIXTURES.animation), env)).toEqual([
      { pointer: "/atlas", id: "hero", kinds: ["atlas"] },
    ]);
    const project = viewOf([
      entry("zed", "atlas", "art/z.atlas.json"),
      entry("ann", "atlas", "art/a.atlas.json"),
    ]);
    expect(animationKind.empty({ ...gameEnv, project }, { id: "walk" }).atlas).toBe("ann");
    expect(animationKind.empty(gameEnv, { id: "walk" }).atlas).toBe("walk");
  });

  it("a material names no other asset; empty game-settings, data-table and scene-list name none", () => {
    expect(
      refsOf(
        materialKind as DocKindDef,
        (materialKind as DocKindDef).empty(gameEnv, { id: "x" }),
        gameEnv,
      ),
    ).toBeUndefined();
    for (const kind of [gameSettingsKind, dataTableKind, sceneListKind] as DocKindDef[])
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
          v: 2,
          table: "card",
          rows: [{ id: "fireball", art: "flame" }, { id: "heal" }],
        },
        env,
      ),
    ).toEqual([{ pointer: "/rows/@fireball/art", id: "flame", kinds: ["texture"] }]);
    expect(
      refsOf(
        dataTableKind as DocKindDef,
        { kind: "data-table", v: 2, table: "nope", rows: [{ id: "a", art: "flame" }] },
        env,
      ),
      "a table the game doesn't declare has no fields",
    ).toEqual([]);
    expect(
      refsOf(
        gameSettingsKind as DocKindDef,
        { kind: "game-settings", v: 2, engine: {}, game: { icon: "logo", title: "x" } },
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
    v: 2,
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
    a.getMap("content").set("v", 2);
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
  const base = { kind: "game-settings", v: 2, engine: { gravity: [0, 1] }, game: {} };

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

describe("v1 → v2: the kinds' lengths in metres", () => {
  /** A game at 32 px per metre with a length in a table row, a project setting and a check's arg. */
  const measured = createRegistry(
    defineGame({
      id: "measured",
      types: [],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
      world: { lengthUnit: 32 },
      tables: {
        tower: {
          description: "Towers.",
          row: {
            range: z.number().describe("How far it shoots, m.").meta({ unit: "m" }),
            cost: z.number().int().describe("What it costs."),
          },
        },
      },
      projectSettings: {
        runSpeed: z.number().optional().describe("Run speed, m/s.").meta({ unit: "m/s" }),
        lives: z.number().int().optional().describe("Lives."),
      },
      checks: {
        "measured/near": {
          description: "Something is within reach.",
          arg: z.strictObject({ reach: z.number().describe("How far, m.").meta({ unit: "m" }) }),
          run: () => ({ pass: true, message: "ok" }),
        },
      },
    }),
  );
  const measuredEnv: KindEnv = { registry: measured, project: null };

  /** Files written by 0.10.0, in px; never edited. */
  const FROZEN_V1 = {
    material: lines(
      "{",
      '  "kind": "material",',
      '  "v": 1,',
      '  "description": "Bouncy rubber.",',
      '  "physics": { "friction": 0.4, "impulse": { "x": 50, "y": -700 }, "restitution": 0.9 },',
      '  "render": { "style": { "fill": "#e05a5a", "strokeWidth": 3 } }',
      "}",
    ),
    "game-settings": lines(
      "{",
      '  "kind": "game-settings",',
      '  "v": 1,',
      '  "engine": {',
      '    "gravity": [0, 1200],',
      '    "resolution": { "virtual": { "height": 360, "width": 640 } }',
      "  },",
      '  "game": {',
      '    "lives": 3,',
      '    "runSpeed": 320',
      "  }",
      "}",
    ),
    "data-table": lines(
      "{",
      '  "kind": "data-table",',
      '  "v": 1,',
      '  "table": "tower",',
      '  "rows": [',
      '    { "id": "arrow", "cost": 3, "range": 160 },',
      '    { "id": "cannon", "cost": 5, "range": 100 }',
      "  ]",
      "}",
    ),
    checks: lines(
      "{",
      '  "v": 1,',
      '  "checks": [',
      '    { "id": "ok", "kind": "valid" },',
      '    { "id": "win", "kind": "reaches", "at": [300, 912], "result": "script-end", "script": "win.script.json" },',
      '    { "id": "near", "kind": "measured/near", "reach": 64 }',
      "  ]",
      "}",
    ),
    "input-script": lines(
      "{",
      '  "v": 1,',
      '  "scene": "yard",',
      '  "at": [320, 912],',
      '  "steps": [',
      '    { "for": 30, "hold": [] },',
      '    { "hold": [], "max": 60, "until": { "tick": 90 } }',
      "  ]",
      "}",
    ),
    "inline-checks": lines(
      "{",
      '  "v": 2,',
      '  "checks": [',
      '    { "id": "win", "kind": "reaches", "at": [1, 2], "result": "script-end", "script": { "at": [320, 912], "steps": [{ "wait": 60 }], "v": 1 } },',
      '    { "id": "file", "kind": "reaches", "result": "script-end", "script": "win.script.json" }',
      "  ]",
      "}",
    ),
  } as const;

  /** What each frozen file is at v2: every length ÷ px per metre, at 100 and at 32. */
  const AT_100 = {
    material: lines(
      "{",
      '  "kind": "material",',
      '  "v": 2,',
      '  "description": "Bouncy rubber.",',
      '  "physics": { "friction": 0.4, "impulse": { "x": 0.5, "y": -7 }, "restitution": 0.9 },',
      '  "render": { "style": { "fill": "#e05a5a", "strokeWidth": 3 } }',
      "}",
    ),
    "game-settings": lines(
      "{",
      '  "kind": "game-settings",',
      '  "v": 2,',
      '  "engine": {',
      '    "gravity": [0, 12],',
      '    "resolution": { "virtual": { "height": 360, "width": 640 } }',
      "  },",
      '  "game": {',
      '    "avatarSpeed": 2.4,',
      '    "title": "Deck"',
      "  }",
      "}",
    ),
  } as const;
  const AT_32 = {
    material: AT_100.material.replace('"x": 0.5, "y": -7', '"x": 1.5625, "y": -21.875'),
    "game-settings": lines(
      "{",
      '  "kind": "game-settings",',
      '  "v": 2,',
      '  "engine": {',
      '    "gravity": [0, 37.5],',
      '    "resolution": { "virtual": { "height": 360, "width": 640 } }',
      "  },",
      '  "game": {',
      '    "lives": 3,',
      '    "runSpeed": 10',
      "  }",
      "}",
    ),
    "data-table": lines(
      "{",
      '  "kind": "data-table",',
      '  "v": 2,',
      '  "table": "tower",',
      '  "rows": [',
      '    { "id": "arrow", "cost": 3, "range": 5 },',
      '    { "id": "cannon", "cost": 5, "range": 3.125 }',
      "  ]",
      "}",
    ),
    checks: lines(
      "{",
      '  "v": 3,',
      '  "checks": [',
      '    { "id": "ok", "kind": "valid" },',
      '    { "id": "win", "kind": "reaches", "at": [9.375, 28.5], "result": "script-end", "script": "win.script.json" },',
      '    { "id": "near", "kind": "measured/near", "reach": 2 }',
      "  ]",
      "}",
    ),
  } as const;

  const migrated = (kind: DocKindDef, text: string, env: KindEnv) => {
    const result = parseAssetDoc(kind, text, env);
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.migratedFrom).toBe(1);
    return formatAssetDoc(kind, result.value);
  };

  it("each kind is v2, checks v3 and input scripts v2", () => {
    const kinds = [materialKind, gameSettingsKind, dataTableKind, checksKind, inputScriptKind];
    expect(kinds.map((k) => k.version)).toEqual([2, 2, 2, 3, 2]);
    expect(kinds.map((k) => k.schemaId)).toEqual([
      "urn:jams-engine:material:v2",
      "urn:jams-engine:game-settings:v2",
      "urn:jams-engine:data-table:v2",
      "urn:jams-engine:checks:v3",
      "urn:jams-engine:input-script:v2",
    ]);
  });

  it("material: the launch velocity in m/s; strokeWidth stays px", () => {
    expect(migrated(materialKind, FROZEN_V1.material, gameEnv)).toBe(AT_100.material);
    expect(migrated(materialKind, FROZEN_V1.material, measuredEnv)).toBe(AT_32.material);
  });

  it("game-settings: engine.gravity in m/s² and the game's length settings by unit; virtual px stay px", () => {
    const v1 = FROZEN_V1["game-settings"].replace(
      '"lives": 3,\n    "runSpeed": 320',
      '"avatarSpeed": 240,\n    "title": "Deck"',
    );
    expect(migrated(gameSettingsKind, v1, gameEnv)).toBe(AT_100["game-settings"]);
    expect(migrated(gameSettingsKind, FROZEN_V1["game-settings"], measuredEnv)).toBe(
      AT_32["game-settings"],
    );
  });

  it("data-table: rows by their row schema's units", () => {
    expect(migrated(dataTableKind, FROZEN_V1["data-table"], measuredEnv)).toBe(AT_32["data-table"]);
    const cards = FIXTURES["data-table"].replace('"v": 2', '"v": 1');
    expect(migrated(dataTableKind, cards, gameEnv)).toBe(FIXTURES["data-table"]);
  });

  it("checks: a reaches check's at and a game check's lengths", () => {
    expect(migrated(checksKind, FROZEN_V1.checks, measuredEnv)).toBe(AT_32.checks);
  });

  it("input-script: v 2, with its at and predicates in metres", () => {
    const at32 = lines(
      "{",
      '  "v": 2,',
      '  "scene": "yard",',
      '  "at": [10, 28.5],',
      '  "steps": [',
      '    { "for": 30, "hold": [] },',
      '    { "hold": [], "max": 60, "until": { "tick": 90 } }',
      "  ]",
      "}",
    );
    expect(migrated(inputScriptKind, FROZEN_V1["input-script"], measuredEnv)).toBe(at32);
    const at100 = at32.replace('"at": [10, 28.5]', '"at": [3.2, 9.12]');
    expect(migrated(inputScriptKind, FROZEN_V1["input-script"], gameEnv)).toBe(at100);
  });

  it("checks v2 → v3: inline scripts move to input-script v2; scripts by path stay paths", () => {
    const result = parseAssetDoc(checksKind, FROZEN_V1["inline-checks"], gameEnv);
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.migratedFrom).toBe(2);
    expect(formatAssetDoc(checksKind, result.value)).toBe(
      lines(
        "{",
        '  "v": 3,',
        '  "checks": [',
        '    { "id": "win", "kind": "reaches", "at": [1, 2], "result": "script-end", "script": { "at": [3.2, 9.12], "steps": [{ "wait": 60 }], "v": 2 } },',
        '    { "id": "file", "kind": "reaches", "result": "script-end", "script": "win.script.json" }',
        "  ]",
        "}",
      ),
    );
  });

  it("refuses a v1 file of each kind without a registry, rather than guess its units", () => {
    for (const [kind, text, from] of [
      [materialKind, FROZEN_V1.material, 1],
      [gameSettingsKind, FROZEN_V1["game-settings"], 1],
      [dataTableKind, FROZEN_V1["data-table"], 1],
      [checksKind, FROZEN_V1.checks, 1],
      [checksKind, FROZEN_V1["inline-checks"], 2],
      [inputScriptKind, FROZEN_V1["input-script"], 1],
    ] as const) {
      const lift = (kind as DocKindDef).migrations?.[from];
      const out = lift?.(JSON.parse(text), {}) as { refused?: { code: string } } | undefined;
      expect(out?.refused?.code).toBe("migration-unresolved");
    }
  });
});

describe("input-map", () => {
  const map = (over: Record<string, unknown> = {}) => ({ kind: "input-map", v: 1, ...over });
  const issuesOf = (value: unknown, env: KindEnv = gameEnv) =>
    parseAssetDoc(inputMapKind, value, env).issues.map((i) => ({
      code: i.code,
      path: i.path,
      message: i.message,
      ...(i.hint === undefined ? {} : { hint: i.hint }),
    }));
  const schemaFile = new URL("../input-map.schema.json", import.meta.url);

  it("is a doc kind with §7's layout and a 256 KiB cap, at the root of a project", () => {
    expect(inputMapKind.storage).toBe("doc");
    expect(inputMapKind.schemaId).toBe(INPUT_MAP_SCHEMA_ID);
    expect(INPUT_MAP_SCHEMA_ID).toBe("urn:jams-engine:input-map:v1");
    expect(inputMapKind.limits).toEqual({ maxStateBytes: 262_144 });
    expect(inputMapKind.defaultFolder?.()).toBe("");
    expect(inputMapKind.layout).toEqual({
      as: "map",
      fields: {
        players: { as: "map", rest: { as: "atomic" } },
        actions: {
          as: "keyed",
          id: "action",
          item: {
            as: "map",
            fields: { bindings: { as: "list", item: { as: "atomic" } } },
            rest: { as: "atomic" },
          },
        },
        touch: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
      },
      rest: { as: "atomic" },
    });
  });

  it("schema: refuses an unknown key, a deadzone past 1 and a binding with no device", () => {
    expect(refused(inputMapKind, map({ extra: 1 }))).toEqual([
      { code: "unknown-key", path: "/extra" },
    ]);
    expect(refused(inputMapKind, map({ deadzone: 1.5 }))).toEqual([
      { code: "schema", path: "/deadzone" },
    ]);
    expect(
      refused(inputMapKind, map({ actions: [{ action: "push", bindings: [{ code: "Space" }] }] })),
    ).toEqual([{ code: "schema", path: "/actions/0/bindings/0/device" }]);
  });

  it("schema: publishes its URN and the agent surface, every property described (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = docKindJsonSchema(inputMapKind as DocKindDef, engineEnv);
    expect(schema.$id).toBe(INPUT_MAP_SCHEMA_ID);
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(schemaFile, "utf8"))).toEqual(schema);
  });

  it("the kitchen sink's project holds one, of seats and deadzone only, clean under the engine and the test game", () => {
    const text = read("../../scenes/input-map.json");
    const value = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["$schema", "deadzone", "kind", "players", "v"]);
    for (const env of [engineEnv, gameEnv]) expect(issuesOf(text, env)).toEqual([]);
    expect(formatAssetDoc(inputMapKind, parsed(inputMapKind, text, engineEnv))).toBe(text);
  });

  it("an action the game doesn't declare is binding-unknown; the engine registry declares none", () => {
    expect(issuesOf(map({ actions: [{ action: "jump", bindings: [] }] }))).toMatchObject([
      { code: "binding-unknown", path: "/actions/0/action", message: /left, right, push/ },
    ]);
    expect(issuesOf(map({ actions: [{ action: "push", bindings: [] }] }), engineEnv)).toMatchObject(
      [{ code: "binding-unknown", path: "/actions/0/action", message: /declares no actions/ }],
    );
  });

  it("binding-unknown with did-you-mean over the code tables, the shape that misfits and the controls", () => {
    const value = map({
      actions: [
        {
          action: "push",
          kind: "button",
          bindings: [
            { device: "key", code: "Spase" },
            { device: "pad", button: "souh" },
            { device: "pointer", button: "primery" },
            { device: "key", code: "KeyW", axis: "y", value: -1 },
            { device: "pad", stick: "left" },
            { device: "touch", control: "jmp" },
          ],
        },
        { action: "left", kind: "vector", bindings: [] },
      ],
      touch: [
        { id: "jump", kind: "button", action: "push", at: [0.85, 0.8], radius: 0.08 },
        { id: "fire", kind: "button", action: "fire", at: [0.5, 0.8], radius: 0.08 },
      ],
    });
    const issues = issuesOf(value);
    expect(new Set(issues.map((i) => i.code))).toEqual(new Set(["binding-unknown"]));
    expect(issues.map((i) => i.path)).toEqual([
      "/actions/0/bindings/0/code",
      "/actions/0/bindings/1/button",
      "/actions/0/bindings/2/button",
      "/actions/0/bindings/3/axis",
      "/actions/0/bindings/3/value",
      "/actions/0/bindings/4/stick",
      "/actions/0/bindings/5/control",
      "/actions/1/kind",
      "/touch/1/action",
    ]);
    const at = (path: string) => issues.find((i) => i.path === path)!;
    expect(at("/actions/0/bindings/0/code").message).toMatch(/did you mean "Space"\?/);
    expect(at("/actions/0/bindings/1/button").message).toMatch(/did you mean "south"\?/);
    expect(at("/actions/0/bindings/2/button").message).toMatch(/did you mean "primary"\?/);
    expect(at("/actions/0/bindings/5/control").message).toMatch(/did you mean "jump"\?/);
    expect(at("/actions/1/kind").message).toMatch(/a button action in the game, not a vector/);
  });

  it("player-unknown for seats past 8 and a key binding's seat past the map's, else the game's", () => {
    expect(issuesOf(map({ players: { max: 9, join: "auto" } }))).toMatchObject([
      { code: "player-unknown", path: "/players/max" },
    ]);
    const seat1 = { action: "left", bindings: [{ device: "key", code: "KeyA", player: 1 }] };
    expect(issuesOf(map({ actions: [seat1] }))).toMatchObject([
      { code: "player-unknown", path: "/actions/0/bindings/0/player" },
    ]);
    expect(issuesOf(map({ players: { max: 2, join: "press" }, actions: [seat1] }))).toEqual([]);
  });

  it("judges through the one binding check, its problems carrying their place in the file", () => {
    const problems = inputMapProblems(
      {
        kind: "input-map",
        v: 1,
        actions: [{ action: "push", bindings: [{ device: "key", code: "Spase" }] }],
      },
      gameEnv.registry,
    );
    expect(problems).toMatchObject([
      { code: "binding-unknown", at: ["actions", 0, "bindings", 0, "code"], hint: /"Space"/ },
    ]);
  });

  it("a second one in a project is asset-kind", () => {
    const view = viewOf([
      entry("input-map", "input-map", "input-map.json"),
      entry("more", "input-map", "z/more.json"),
      entry("settings", "game-settings", "settings.json"),
    ]);
    const issues = inputMapIssues(view);
    expect(issues.map((i) => [i.code, i.entityIds])).toEqual([["asset-kind", ["more"]]]);
    expect(issues[0]!.message).toBe(
      `"more" is a second input map; "input-map" (input-map.json) is the project's`,
    );
    expect(issues[0]!.hint).toBe(`Move its bindings into "input-map" and delete it.`);
    expect(inputMapIssues(viewOf([entry("input-map", "input-map", "input-map.json")]))).toEqual([]);
  });

  it("merges per action and binding: two clients adding bindings to one action both survive", () => {
    const layout = inputMapKind.layout as DocLayout;
    const base = map({
      actions: [{ action: "push", bindings: [{ device: "key", code: "Space" }] }],
    });
    const a = new Y.Doc();
    const b = new Y.Doc();
    layoutToDoc(a, layout, base);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const withBinding = (binding: object) =>
      map({
        actions: [{ action: "push", bindings: [{ device: "key", code: "Space" }, binding] }],
      });
    layoutPatch(a, layout, withBinding({ device: "key", code: "KeyW" }));
    layoutPatch(b, layout, { ...withBinding({ device: "pad", button: "south" }), deadzone: 0.3 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const merged = layoutFromDoc(a, layout) as {
      deadzone: number;
      actions: { bindings: object[] }[];
    };
    expect(layoutFromDoc(b, layout)).toEqual(merged);
    expect(merged.deadzone).toBe(0.3);
    expect(merged.actions[0]!.bindings).toHaveLength(3);
    expect(merged.actions[0]!.bindings).toEqual(
      expect.arrayContaining([
        { device: "key", code: "Space" },
        { device: "key", code: "KeyW" },
        { device: "pad", button: "south" },
      ]),
    );
    expect(parseAssetDoc(inputMapKind, merged, gameEnv).ok).toBe(true);
  });

  it("is counted by projectUsage as a doc, with no blob", () => {
    const view = viewOf([entry("input-map", "input-map", "input-map.json")]);
    expect(projectUsage(view, new Map([["input-map", 512]]))).toMatchObject({
      docs: 1,
      docBytes: 512,
      blobs: 0,
      blobBytes: 0,
    });
  });
});

describe("recording", () => {
  const env = { path: "runs/a.recording.json", idAt: () => undefined };
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const runV1 = (): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL("./fixtures/run.recording.json", import.meta.url), "utf8"));
  const parsedRecording = (value: unknown) => {
    const parsed = parseRecording(value);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return parsed.recording;
  };

  it("still imports the v1 run.recording.json, its meta saying v1 and one seat", () => {
    expect(recordingKind.inspect(bytes(runV1()), {}, env)).toEqual({
      ok: true,
      meta: { scene: "kitchen-sink", ticks: 120, sceneHash: "3f1c9a2b", v: 1, players: 1 },
    });
  });

  it("imports a v2 file, counting its seats", () => {
    const v2 = parsedRecording(runV1());
    v2.players = [
      { index: 0, devices: ["keyboard"] },
      { index: 1, devices: ["pad:0"] },
    ];
    v2.inputs.push([[3, "b", 1, 1]]);
    expect(recordingKind.inspect(bytes(v2), {}, env)).toEqual({
      ok: true,
      meta: { scene: "kitchen-sink", ticks: 120, sceneHash: "3f1c9a2b", v: 2, players: 2 },
    });
  });

  it("refuses another format version, saying where", () => {
    const result = recordingKind.inspect(bytes({ ...runV1(), v: 3 }), {}, env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("import-failed");
    expect(result.issue.message).toMatch(/recording:v1 or v2 file \(\/v: /);
  });

  it("refuses a v2 file whose stream indexes past its tables", () => {
    const v2 = parsedRecording(runV1());
    v2.inputs[0]!.push([200, "b", 9, 1]);
    const result = recordingKind.inspect(bytes(v2), {}, env);
    expect(result.ok || result.issue.message).toMatch(/action index 9 is outside/);
  });

  it("describes both formats", () => {
    expect(recordingKind.description).toMatch(/recording:v2, or v1 migrated on read/);
    expect(recordingMetaSchema.safeParse({ scene: "s", ticks: 1, sceneHash: "h" }).success).toBe(
      false,
    );
  });
});

describe("save", () => {
  const env = { path: "fixtures/level-2.save.json", idAt: () => undefined };
  const bytes = (text: string) => new TextEncoder().encode(text);
  const progress = (over: Partial<SaveFile> = {}): SaveFile => ({
    kind: "save",
    v: 1,
    game: "tactics",
    gameVersion: 3,
    engine: "0.13.0",
    release: null,
    project: null,
    slot: "fixture",
    meta: { scene: "level-2", savedAt: 0, playTicks: 600 },
    depth: "progress",
    persist: { cleared: ["level-1"] },
    scene: { id: "level-2", runHash: "a90e44d1c2b3f507", sublevels: [] },
    data: { turn: 1 },
    ...over,
  });

  it("reads the game, its save version, the depth and the scene from the envelope", () => {
    expect(saveKind.inspect(bytes(formatSaveFile(progress())), {}, env)).toEqual({
      ok: true,
      meta: { game: "tactics", gameVersion: 3, depth: "progress", scene: "level-2" },
    });
  });

  it("keeps the version it was written at, running no game's migrations", () => {
    const result = saveKind.inspect(bytes(formatSaveFile(progress({ gameVersion: 99 }))), {}, env);
    expect(result.ok && result.meta.gameVersion).toBe(99);
  });

  it("refuses a file that isn't save:v1, saying where", () => {
    const result = saveKind.inspect(bytes(JSON.stringify({ ...progress(), v: 2 })), {}, env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("import-failed");
    expect(result.issue.message).toMatch(/save:v1 file \(\/v: /);
  });
});
