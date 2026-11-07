import { describe, expect, it } from "vite-plus/test";

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
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const yard = JSON.parse(engineYardText);
const minimal = { v: 2, name: "s", bounds: [0, 0, 100, 100] };
const game = { ...minimal, game: "fake" };

describe("sceneSchemaFor", () => {
  it("accepts engine-yard against the engine registry", () => {
    expect(sceneSchemaFor(engine).safeParse(yard).success).toBe(true);
  });

  it("has bulk keys from registered types only", () => {
    const keys = Object.keys(sceneSchemaFor(engine).shape);
    expect(keys).toEqual([
      "$schema",
      "v",
      "name",
      "bounds",
      "settings",
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
