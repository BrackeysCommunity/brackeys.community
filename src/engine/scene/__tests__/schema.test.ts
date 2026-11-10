import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import {
  angleField,
  assetField,
  mirrorField,
  pointField,
  sideField,
  vectorField,
} from "../../game/fields";
import { PRIMITIVE_TYPES } from "../../game/types";
import {
  ID_PATTERN,
  entitySchemaFor,
  fieldKind,
  geometryFields,
  sceneGameOf,
  sceneRegistry,
  sceneSchemaFor,
} from "../schema";
import { SCENE_FORMAT_VERSION } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const noAssets = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };
const yard = JSON.parse(engineYardText);
const minimal = { v: SCENE_FORMAT_VERSION, name: "s", bounds: [0, 0, 100, 100] };
const game = { ...minimal, game: "fake" };

describe("sceneSchemaFor", () => {
  it("accepts engine-yard against the engine registry", () => {
    expect(sceneSchemaFor(engine).safeParse(yard).success).toBe(true);
  });

  it("takes only the current format version, v3; a v2 document migrates first", () => {
    expect(SCENE_FORMAT_VERSION).toBe(3);
    const schema = sceneSchemaFor(engine);
    expect(schema.safeParse({ ...minimal, v: 3 }).success).toBe(true);
    expect(schema.safeParse({ ...minimal, v: 2 }).success).toBe(false);
  });

  it("has bulk keys from registered types only", () => {
    const keys = Object.keys(sceneSchemaFor(engine).shape);
    expect(keys).toEqual([
      "$schema",
      "v",
      "name",
      "bounds",
      "settings",
      "assets",
      "groups",
      "instances",
      "solid",
      "entities",
    ]);
    expect(Object.keys(sceneSchemaFor(fake).shape)).toEqual([
      "$schema",
      "v",
      "game",
      "name",
      "bounds",
      "settings",
      "assets",
      "groups",
      "instances",
      "flag",
      "pad",
      "pad:mud",
      "solid",
      "solid:mud",
      "entities",
    ]);
    expect(sceneSchemaFor(engine).safeParse({ ...minimal, cloud: [] }).success).toBe(false);
  });

  it("requires the game's id in a game's schema", () => {
    const schema = sceneSchemaFor(fake);
    expect(schema.safeParse(game).success).toBe(true);
    expect(schema.safeParse(minimal).success).toBe(false);
    expect(schema.safeParse({ ...game, game: "other" }).success).toBe(false);
  });

  it("checks a bulk entry against its type's field", () => {
    const schema = sceneSchemaFor(fake);
    expect(schema.safeParse({ ...game, pad: [["box", 0, 0, 5, 5]] }).success).toBe(true);
    expect(schema.safeParse({ ...game, pad: [["circle", 0, 0, 5]] }).success).toBe(false);
    expect(schema.safeParse({ ...game, flag: [[1, 2]] }).success).toBe(true);
    expect(schema.safeParse({ ...game, solid: [["chain", 0, 0, 5, 0]] }).success).toBe(true);
  });

  it("has a settings block of the engine's and the game's fields", () => {
    expect(
      sceneSchemaFor(engine).safeParse({ ...minimal, settings: { gravity: [0, 10] } }).success,
    ).toBe(true);
    expect(sceneSchemaFor(engine).safeParse({ ...minimal, settings: { lives: 3 } }).success).toBe(
      false,
    );
    expect(sceneSchemaFor(fake).safeParse({ ...game, settings: { lives: 3 } }).success).toBe(true);
  });

  it("is strict and checks bounds order", () => {
    const schema = sceneSchemaFor(engine);
    expect(schema.safeParse({ ...minimal, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...minimal, bounds: [100, 0, 0, 100] }).success).toBe(false);
    expect(schema.safeParse({ ...minimal, bounds: [0, 0, 100.5, 100] }).success).toBe(false);
  });

  it("allows duplicate ids (validateScene reports dup-id)", () => {
    const e = { id: "a", type: "marker", at: [0, 0] };
    expect(sceneSchemaFor(engine).safeParse({ ...minimal, entities: [e, e] }).success).toBe(true);
  });
});

describe("entitySchemaFor", () => {
  it("has a strict schema for every registered type, discriminated by type", () => {
    for (const t of fake.typeNames) {
      const schema = entitySchemaFor(fake, t)!;
      expect(Object.keys(schema.shape).slice(0, 2)).toEqual(["id", "type"]);
    }
    expect(entitySchemaFor(engine, "pad")).toBeUndefined();
    const solid = entitySchemaFor(engine, "solid")!;
    expect(
      solid.safeParse({ id: "s", type: "solid", shape: ["box", 0, 0, 5, 5], oneWay: true }).success,
    ).toBe(true);
    expect(
      solid.safeParse({ id: "s", type: "solid", shape: ["box", 0, 0, 5, 5], b: "solid" }).success,
    ).toBe(false);
  });

  it("rejects chain on body shapes but allows it on solid and sensor", () => {
    const chain = ["chain", 0, 0, 5, 0];
    const path = {
      pts: [
        [0, 0],
        [10, 0],
      ],
      mode: "loop",
      speed: 10,
    };
    expect(
      entitySchemaFor(engine, "follower")!.safeParse({
        id: "m",
        type: "follower",
        shape: chain,
        path,
      }).success,
    ).toBe(false);
    expect(
      entitySchemaFor(engine, "solid")!.safeParse({ id: "s", type: "solid", shape: chain }).success,
    ).toBe(true);
    expect(
      entitySchemaFor(engine, "sensor")!.safeParse({ id: "z", type: "sensor", shape: chain })
        .success,
    ).toBe(true);
  });

  it("has material enums from the registry", () => {
    const shape = ["box", 0, 0, 5, 5];
    expect(
      entitySchemaFor(fake, "solid")!.safeParse({ id: "s", type: "solid", shape, material: "mud" })
        .success,
    ).toBe(true);
    expect(
      entitySchemaFor(engine, "solid")!.safeParse({
        id: "s",
        type: "solid",
        shape,
        material: "mud",
      }).success,
    ).toBe(false);
  });
});

describe("field kinds", () => {
  it("knows shape, point and path fields through describe, meta and optional", () => {
    expect(geometryFields(engine.types.get("follower")!)).toEqual([
      { field: "shape", kind: "shape" },
      { field: "path", kind: "path" },
    ]);
    expect(geometryFields(engine.types.get("marker")!)).toEqual([{ field: "at", kind: "point" }]);
    expect(geometryFields(fake.types.get("door")!)).toEqual([{ field: "shape", kind: "shape" }]);
    expect(fieldKind(engine.types.get("prop")!.shape.density!)).toBe("value");
  });

  it("knows vector, angle, mirror, side and grid fields by their meta kind", () => {
    expect(fieldKind(vectorField("Aim.").optional())).toBe("vector");
    expect(fieldKind(angleField("Facing.", "deg").default(0))).toBe("angle");
    expect(fieldKind(mirrorField("x", "Faces left.").optional().describe("Faces left."))).toBe(
      "mirror",
    );
    expect(fieldKind(sideField("Lands on.").optional())).toBe("side");
    expect(fieldKind(engine.types.get("solid")!.shape.oneWay!)).toBe("side");
    expect(fieldKind(z.array(z.string()).meta({ kind: "grid" }).optional())).toBe("grid");
    expect(fieldKind(z.number().meta({ kind: "other" }))).toBe("value");
    expect(fieldKind(assetField(noAssets, "texture", "Pic."))).toBe("value");
  });
});

describe("one-way sides", () => {
  const solid = entitySchemaFor(engine, "solid")!;
  const base = { id: "p", type: "solid", shape: ["box", 0, 0, 10, 2] };

  it("takes true or a side for oneWay, and nothing else", () => {
    for (const oneWay of [true, "up", "down", "left", "right"])
      expect(solid.safeParse({ ...base, oneWay }).success).toBe(true);
    expect(solid.safeParse(base).success).toBe(true);
    for (const oneWay of [false, "north", 1, null])
      expect(solid.safeParse({ ...base, oneWay }).success).toBe(false);
  });

  it("keeps true as written", () => {
    expect(solid.parse({ ...base, oneWay: true }).oneWay).toBe(true);
  });
});

describe("v3 keys", () => {
  const schema = sceneSchemaFor(engine);
  const parses = (scene: object) => schema.safeParse({ ...minimal, ...scene }).success;
  const inst = { id: "g", prefab: "gate", at: [10, 20] };

  it("parses instance rot, flip, z and params", () => {
    expect(
      parses({ instances: [{ ...inst, rot: 1, flip: true, z: 5, params: { speed: 120 } }] }),
    ).toBe(true);
    for (const rot of [2, 3]) expect(parses({ instances: [{ ...inst, rot }] })).toBe(true);
    for (const rot of [0, 4, 1.5, "1"])
      expect(parses({ instances: [{ ...inst, rot }] })).toBe(false);
    expect(parses({ instances: [{ ...inst, flip: false }] })).toBe(false);
    expect(parses({ instances: [{ ...inst, params: [1] }] })).toBe(false);
    expect(parses({ instances: [{ ...inst, spin: 1 }] })).toBe(false);
  });

  it("parses group rot and flip", () => {
    expect(parses({ groups: { w: { at: [0, 0], rot: 2, flip: true, name: "Wing" } } })).toBe(true);
    expect(parses({ groups: { w: { at: [0, 0], rot: 0 } } })).toBe(false);
    expect(parses({ groups: { w: { at: [0, 0], flip: false } } })).toBe(false);
    expect(parses({ groups: { w: { at: [0, 0], z: 1 } } })).toBe(false);
  });

  it("parses an assets header of ids, dangling or not", () => {
    expect(parses({ assets: ["boom", "hud-font"] })).toBe(true);
    expect(parses({ assets: ["b", "a", "a"] })).toBe(true);
    expect(parses({ assets: ["Not An Id"] })).toBe(false);
    expect(parses({ assets: "boom" })).toBe(false);
  });

  it("takes any id as a layer on entities and instances", () => {
    const e = { id: "m", type: "marker", at: [0, 0] };
    expect(parses({ entities: [{ ...e, layer: "parallax-far" }] })).toBe(true);
    expect(parses({ instances: [{ ...inst, layer: "parallax-far" }] })).toBe(true);
    expect(parses({ entities: [{ ...e, layer: "Bad Layer" }] })).toBe(false);
  });

  it("limits z to integers in [-10000, 10000] on entities and instances", () => {
    const e = { id: "m", type: "marker", at: [0, 0] };
    for (const z of [-10000, 0, 10000]) {
      expect(parses({ entities: [{ ...e, z }] })).toBe(true);
      expect(parses({ instances: [{ ...inst, z }] })).toBe(true);
    }
    for (const z of [-10001, 10001, 0.5]) {
      expect(parses({ entities: [{ ...e, z }] })).toBe(false);
      expect(parses({ instances: [{ ...inst, z }] })).toBe(false);
    }
  });
});

describe("behaviors", () => {
  const tint = defineBehavior({
    name: "bh/tint",
    description: "A tint.",
    fields: {
      color: z.string().describe("The tint's color."),
      alpha: z.number().min(0).max(1).default(1).describe("Opacity; default 1."),
    },
  });
  const tag = defineBehavior({
    name: "bh/tag",
    description: "A label.",
    fields: { label: z.string().optional().describe("The label.") },
  });
  const marker = (type: string, behaviors: object) =>
    defineEntityType({
      type,
      description: `A ${type}.`,
      base: "marker",
      fields: { at: pointField("Where.") },
      behaviors,
    });
  const reg = createRegistry(
    defineGame({
      id: "bh",
      types: [
        marker("badge", { required: { [tint.name]: {} } }),
        marker("chip", { required: { [tint.name]: { color: "red" } } }),
        marker("token", { forbidden: [tag.name] }),
      ],
      behaviors: [tint, tag],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const parses = (entity: object) =>
    sceneSchemaFor(reg).safeParse({ ...minimal, game: "bh", entities: [entity] }).success;
  const token = { id: "t", type: "token", at: [0, 0] };

  it("checks a known block's fields by the behavior's schema", () => {
    expect(parses({ ...token, behaviors: { [tint.name]: { color: "red" } } })).toBe(true);
    expect(parses({ ...token, behaviors: { [tint.name]: { color: "red", alpha: 0.5 } } })).toBe(
      true,
    );
    expect(parses({ ...token, behaviors: { [tint.name]: {} } })).toBe(false);
    expect(parses({ ...token, behaviors: { [tint.name]: { color: 3 } } })).toBe(false);
    expect(parses({ ...token, behaviors: { [tint.name]: { color: "red", alpha: 2 } } })).toBe(
      false,
    );
    expect(parses({ ...token, behaviors: { [tint.name]: { color: "red", glow: 1 } } })).toBe(false);
    expect(parses({ ...token, behaviors: [] })).toBe(false);
  });

  it("lets unknown and forbidden names through for validation to name", () => {
    expect(parses({ ...token, behaviors: { "bh/nope": { x: 1 } } })).toBe(true);
    expect(parses({ ...token, behaviors: { [tag.name]: { label: 3 } } })).toBe(true);
    expect(parses({ id: "n", type: "note", at: [0, 0], text: "hi", behaviors: { x: {} } })).toBe(
      true,
    );
  });

  it("requires a required block only when a field has no default", () => {
    const at = [0, 0];
    expect(parses({ id: "b", type: "badge", at })).toBe(false);
    expect(parses({ id: "b", type: "badge", at, behaviors: { [tint.name]: { color: "x" } } })).toBe(
      true,
    );
    expect(parses({ id: "c", type: "chip", at })).toBe(true);
    expect(parses({ id: "c", type: "chip", at, behaviors: { [tint.name]: {} } })).toBe(true);
  });

  it("puts behaviors last in every type's schema", () => {
    for (const t of reg.typeNames)
      expect(Object.keys(entitySchemaFor(reg, t)!.shape).at(-1)).toBe("behaviors");
  });
});

describe("scene registry", () => {
  it("peeks at game without validating", () => {
    expect(sceneGameOf({ game: "fake" })).toBe("fake");
    expect(sceneGameOf({ game: 3 })).toBeUndefined();
    expect(sceneGameOf("nope")).toBeUndefined();
    expect(sceneGameOf(yard)).toBeUndefined();
  });

  it("judges a gameless scene by the engine's primitives, whatever the registry", () => {
    expect(sceneRegistry(undefined, engine)).toBe(engine);
    expect(sceneRegistry(undefined, fake)?.typeNames).toEqual([...PRIMITIVE_TYPES]);
    expect(sceneRegistry("fake", fake)).toBe(fake);
    expect(sceneRegistry("fake", engine)).toBeNull();
    expect(sceneRegistry("engine", engine)).toBeNull();
  });

  it("has an id pattern that never matches a bulk ref", () => {
    expect(ID_PATTERN.test("pit-shuttle")).toBe(true);
    expect(ID_PATTERN.test("~solid:0")).toBe(false);
    expect(ID_PATTERN.test("-x")).toBe(false);
    expect(ID_PATTERN.test("a".repeat(49))).toBe(false);
  });
});
