import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { docToPrefab, prefabToDoc } from "../../collab/prefab-doc";
import { createRegistry, defineGame } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import { formatPrefab } from "../format";
import {
  fragmentJsonSchema,
  prefabJsonSchema,
  SCHEMA_ID_BASE,
  undescribedProperties,
} from "../json-schema";
import {
  parsePrefab,
  prefabBody,
  prefabOf,
  prefabScene,
  prefabSchemaFor,
  sceneBody,
} from "../prefab";
import { engine, fake } from "./fixtures/fake-game";

const FRAGMENT_FILE = new URL("../fragment.schema.json", import.meta.url);
const PREFAB_FILE = new URL("../prefab.schema.json", import.meta.url);

const contracted = createRegistry(
  defineGame({
    id: "chunks",
    types: [],
    actions: [],
    prefabContract: {
      exits: z
        .array(z.enum(["left", "right"]))
        .describe("Which sides a run can leave by.")
        .meta({ title: "Exits" }),
    },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

describe("fragment.schema.json and prefab.schema.json", () => {
  for (const [file, make, name] of [
    [FRAGMENT_FILE, fragmentJsonSchema, "fragment"],
    [PREFAB_FILE, prefabJsonSchema, "prefab"],
  ] as const) {
    it(`${name}: matches the engine-only registry's schema (UPDATE_SCHEMAS=1 regenerates)`, () => {
      const fresh = make(engine);
      if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(fresh);
    });

    it(`${name}: has a URN id per game, the agent surface version, and describes every field`, () => {
      const schema = make(engine);
      expect(schema.$id).toBe(`${SCHEMA_ID_BASE}${name}:v5`);
      expect(make(fake).$id).toBe(`${SCHEMA_ID_BASE}${name}:fake:v5`);
      expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
      expect(undescribedProperties(schema)).toEqual([]);
    });
  }
});

describe("the prefab contract slot", () => {
  const prefab = { kind: "prefab", v: 4, id: "chunk", entities: [] };

  it("refuses a contract when the game declares none", () => {
    const r = parsePrefab({ ...prefab, contract: { exits: ["left"] } }, engine);
    expect(r.ok).toBe(false);
    expect(parsePrefab(prefab, engine).ok).toBe(true);
  });

  it("checks a contract against the game's fields", () => {
    const game = { ...prefab, game: "chunks" };
    const good = parsePrefab({ ...game, contract: { exits: ["left", "right"] } }, contracted);
    expect(good.ok && good.prefab.contract).toEqual({ exits: ["left", "right"] });
    const bad = parsePrefab({ ...game, contract: { exits: ["up"] } }, contracted);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]!.path).toBe("/contract/exits/0");
    const extra = parsePrefab({ ...game, contract: { exits: [], margin: 4 } }, contracted);
    expect(!extra.ok && extra.issues[0]!.code).toBe("unknown-key");
  });

  it("puts the game's contract fields in the prefab schema", () => {
    const schema = prefabJsonSchema(contracted) as {
      properties: { contract: { properties?: Record<string, unknown> } };
    };
    expect(Object.keys(schema.properties.contract.properties ?? {})).toEqual(["exits"]);
  });
});

const fixtureText = (name: string) =>
  readFileSync(new URL(`./fixtures/prefabs/${name}.json`, import.meta.url), "utf8");

describe("nested instances in a prefab", () => {
  const room = fixtureText("room");
  const parsed = parsePrefab(room, engine);
  if (!parsed.ok) throw new Error(parsed.issues[0]!.message);
  const prefab = parsed.prefab;

  it("parses instances with the scene's instance schema", () => {
    expect(prefab.instances?.map((i) => [i.id, i.prefab])).toEqual([
      ["gate-1", "gate"],
      ["gate-2", "gate"],
      ["door-1", "door"],
    ]);
    expect(prefab.instances?.[2]?.overrides).toEqual({
      "latch/door.path.speed": 30,
      "panel.path.speed": 50,
    });
    expect(Object.keys(prefab)).toEqual(["kind", "v", "id", "bulk", "instances", "entities"]);
    const door = parsePrefab(fixtureText("door"), engine);
    expect(door.ok && door.prefab.instances).toEqual([
      { id: "latch", prefab: "gate", at: [40, 0] },
    ]);
  });

  it("reports a bad instance at its pointer, as a scene's would be", () => {
    const raw = JSON.parse(room) as { instances: Record<string, unknown>[] };
    raw.instances[1]!.rot = 400;
    const bad = parsePrefab(raw, engine);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]!.path).toBe("/instances/1/rot");
    raw.instances[1]!.rot = 180;
    raw.instances[0]!.spin = 1;
    const extra = parsePrefab(raw, engine);
    expect(!extra.ok && [extra.issues[0]!.code, extra.issues[0]!.path]).toEqual([
      "unknown-key",
      "/instances/0/spin",
    ]);
    const key = parsePrefab(
      { ...raw, instances: [{ id: "x", prefab: "gate", at: [0, 0], overrides: { nope: 1 } }] },
      engine,
    );
    expect(key.ok).toBe(false);
  });

  it("leaves an empty instance list out", () => {
    const r = parsePrefab(
      { kind: "prefab", v: 4, id: "bare", instances: [], entities: [] },
      engine,
    );
    expect(r.ok && "instances" in r.prefab).toBe(false);
  });

  it("puts instances in the schema, between bulk and entities", () => {
    expect(Object.keys(prefabSchemaFor(engine).shape)).toEqual([
      "$schema",
      "kind",
      "v",
      "id",
      "base",
      "contract",
      "params",
      "assets",
      "overrides",
      "bulk",
      "instances",
      "entities",
    ]);
    const schema = prefabJsonSchema(engine) as { properties: Record<string, unknown> };
    expect(schema.properties.instances).toBeDefined();
  });

  it("carries instances through bodies and the prefab's own scene", () => {
    const body = prefabBody(prefab);
    expect(body.instances).toEqual(prefab.instances);
    expect(prefabOf("room", body).instances).toEqual(prefab.instances);
    const scene = prefabScene(prefab, [-500, -500, 1000, 1000]);
    expect(scene.instances).toEqual(prefab.instances);
    expect(sceneBody(scene, engine).instances).toEqual(prefab.instances);
    expect("instances" in prefabOf("bare", { entities: [], instances: [] })).toBe(false);
  });
});

describe("a prefab as a scene of its own", () => {
  it("carries its assets header there and back", () => {
    const prefab = prefabOf("lamp", {
      entities: [{ id: "bulb", type: "marker", at: [0, 0] }],
      assets: ["glow", "hum"],
    });
    const scene = prefabScene(prefab, [-500, -500, 1000, 1000]);
    expect(scene.assets).toEqual(["glow", "hum"]);
    expect(scene.assets).not.toBe(prefab.assets);
    expect(sceneBody(scene, engine).assets).toEqual(["glow", "hum"]);
    const none = prefabScene(prefabOf("bare", { entities: [] }), [0, 0, 1, 1]);
    expect("assets" in none).toBe(false);
    expect("assets" in sceneBody(none, engine)).toBe(false);
  });
});

describe("variants and exposed parameters in a prefab", () => {
  const text = fixtureText("red-gate");
  const parsed = parsePrefab(text, engine);
  if (!parsed.ok) throw new Error(parsed.issues[0]!.message);
  const red = parsed.prefab;
  const bare = { kind: "prefab", v: 4, id: "red-door", entities: [] };

  it("parses base, params and overrides in file order", () => {
    expect(Object.keys(red)).toEqual([
      "kind",
      "v",
      "id",
      "base",
      "params",
      "overrides",
      "entities",
    ]);
    expect(red.base).toBe("gate");
    expect(red.overrides).toEqual({ "door.z": 1, "trigger.tags": ["gate", "red"] });
    expect(red.params).toEqual({
      speed: {
        description: "How fast the door opens, in px per second.",
        targets: ["door.path.speed"],
        default: 90,
      },
    });
  });

  it("takes a variant with no entities of its own, and the file format still requires the key", () => {
    const r = parsePrefab({ ...bare, base: "door", overrides: { "panel.path.speed": 9 } }, engine);
    expect(r.ok && r.prefab).toMatchObject({ base: "door", entities: [] });
    const schema = prefabJsonSchema(engine) as { required: string[] };
    expect(schema.required).toContain("entities");
    expect(r.ok && formatPrefab(r.prefab)).toContain('"entities": []');
  });

  it("leaves out a param's absent default and empty params, overrides and assets", () => {
    const r = parsePrefab(
      {
        ...bare,
        params: { speed: { description: "Speed.", targets: ["panel.path.speed"] } },
        overrides: {},
        assets: [],
      },
      engine,
    );
    expect(r.ok && r.prefab.params?.speed && "default" in r.prefab.params.speed).toBe(false);
    expect(r.ok && Object.keys(r.prefab)).toEqual(["kind", "v", "id", "params", "entities"]);
    const empty = parsePrefab({ ...bare, params: {} }, engine);
    expect(empty.ok && "params" in empty.prefab).toBe(false);
  });

  it("reads back from its doc as the prefab parsed from a file written with empty maps", () => {
    const r = parsePrefab(
      {
        ...bare,
        base: "gate",
        params: {},
        assets: [],
        overrides: {},
        instances: [{ id: "latch", prefab: "gate", at: [40, 0], params: {}, overrides: {} }],
        entities: [{ id: "lamp", type: "marker", at: [20, -90], behaviors: {} }],
      },
      engine,
    );
    if (!r.ok) throw new Error(r.issues[0]!.message);
    expect(Object.keys(r.prefab)).toEqual(["kind", "v", "id", "base", "instances", "entities"]);
    expect(r.prefab.instances).toEqual([{ id: "latch", prefab: "gate", at: [40, 0] }]);
    expect(r.prefab.entities).toEqual([{ id: "lamp", type: "marker", at: [20, -90] }]);
    const back = docToPrefab(prefabToDoc(r.prefab));
    expect(back).toEqual(r.prefab);
    expect(formatPrefab(back)).toBe(formatPrefab(r.prefab));
  });

  it("parses the assets header", () => {
    const r = parsePrefab({ ...bare, assets: ["boom", "zap"] }, engine);
    expect(r.ok && r.prefab.assets).toEqual(["boom", "zap"]);
    const bad = parsePrefab({ ...bare, assets: ["Boom"] }, engine);
    expect(!bad.ok && bad.issues[0]!.path).toBe("/assets/0");
  });

  it("reports a bad header value at its pointer", () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ base: "Gate" }, "schema", "/base"],
      [{ overrides: { nope: 1 } }, "schema", "/overrides/nope"],
      [
        { params: { speed: { description: "", targets: ["door.z"] } } },
        "schema",
        "/params/speed/description",
      ],
      [
        { params: { speed: { description: "Speed.", targets: [] } } },
        "schema",
        "/params/speed/targets",
      ],
      [
        { params: { speed: { description: "Speed.", targets: ["door"] } } },
        "schema",
        "/params/speed/targets/0",
      ],
      [
        { params: { speed: { description: "Speed.", targets: ["door.z"], step: 1 } } },
        "unknown-key",
        "/params/speed",
      ],
      [
        { params: { "9lives": { description: "Lives.", targets: ["door.z"] } } },
        "schema",
        "/params/9lives",
      ],
    ];
    for (const [extra, code, path] of cases) {
      const r = parsePrefab({ ...bare, ...extra }, engine);
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      if (!r.ok) expect([r.issues[0]!.code, r.issues[0]!.path]).toEqual([code, path]);
    }
  });

  it("puts base, params and overrides in the JSON Schema", () => {
    const schema = prefabJsonSchema(engine) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    for (const key of ["base", "params", "assets", "overrides"])
      expect(schema.properties[key], key).toBeDefined();
    expect(schema.required).toContain("entities");
    expect(schema.required).not.toContain("base");
  });

  it("carries the variant header through bodies and back", () => {
    const body = prefabBody(red);
    expect(body).toMatchObject({ base: "gate", params: red.params, overrides: red.overrides });
    expect(prefabOf("red-gate", body)).toEqual(red);
    const withAssets = prefabBody({ ...red, assets: ["boom"] });
    expect(prefabOf("red-gate", withAssets).assets).toEqual(["boom"]);
    expect(
      Object.keys(prefabOf("x", { entities: [], params: {}, overrides: {}, assets: [] })),
    ).toEqual(["kind", "v", "id", "entities"]);
  });
});
