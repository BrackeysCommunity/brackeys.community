import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import {
  SCHEMA_ID_BASE,
  sceneJsonSchema,
  undescribedProperties,
  untitledEntityFields,
} from "../json-schema";
import { opsJsonSchema } from "../ops-schema";
import { engine, fake } from "./fixtures/fake-game";

const FILE = new URL("../scene.schema.json", import.meta.url);

type SchemaDef = {
  oneOf?: { title: string; prefixItems: unknown[] }[];
  unit?: string;
  id?: unknown;
};
type SchemaProperty = { unit?: string; description?: string; const?: unknown };

type Schema = {
  $defs: Record<string, SchemaDef> & Record<"ShapeTuple" | "BodyShape" | "PadShape", SchemaDef>;
  properties: Record<string, SchemaProperty> & Record<"bounds" | "game", SchemaProperty>;
  required?: string[];
};

describe("scene.schema.json", () => {
  it("matches sceneJsonSchema for the engine-only registry (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = sceneJsonSchema(engine);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(fresh);
  });

  it("has the registry's URN id and no domain", () => {
    const schema = sceneJsonSchema(engine);
    expect(schema.$id).toBe(`${SCHEMA_ID_BASE}scene:v2`);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)/);
    expect(sceneJsonSchema(fake).$id).toBe(`${SCHEMA_ID_BASE}scene:fake:v2`);
  });

  it("lists registered types and bulk keys only", () => {
    const schema = sceneJsonSchema(engine) as Schema;
    expect(Object.keys(schema.properties)).toEqual([
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
    const text = JSON.stringify(schema);
    for (const gone of ["cloud", "mover", "anchor", "construct", "spawn"])
      expect(text).not.toContain(`"${gone}"`);
    const game = sceneJsonSchema(fake) as Schema;
    expect(game.properties.game.const).toBe("fake");
    expect(game.required).toContain("game");
    expect(Object.keys(game.properties)).toContain("pad:mud");
  });

  it("carries custom meta and describes every shape tuple form", () => {
    const schema = sceneJsonSchema(engine) as Schema;
    expect(schema.properties.bounds.unit).toBe("px");
    expect(schema.properties.bounds.description).toMatch(/y is down/);
    const shape = schema.$defs.ShapeTuple;
    expect(shape.oneOf?.map((o) => o.title)).toEqual(["box", "circle", "capsule", "poly", "chain"]);
    expect(shape.oneOf?.[0]?.prefixItems[0]).toEqual({ const: "box" });
    expect(shape.id).toBeUndefined();
    expect(schema.$defs.BodyShape.oneOf?.map((o) => o.title)).not.toContain("chain");
    expect(JSON.stringify(schema.$defs.Path)).toContain('"unit":"px/s"');
    expect((sceneJsonSchema(fake) as Schema).$defs.PadShape.oneOf?.map((o) => o.title)).toEqual([
      "box",
    ]);
  });
});

describe("schemas as documentation", () => {
  for (const [name, registry] of [
    ["engine", engine],
    ["fake game", fake],
  ] as const) {
    it(`describes every property of ${name}'s scene and ops schemas`, () => {
      expect(undescribedProperties(sceneJsonSchema(registry))).toEqual([]);
      expect(undescribedProperties(opsJsonSchema(registry))).toEqual([]);
    });

    it(`titles every entity field of ${name} for the inspector`, () => {
      expect(untitledEntityFields(sceneJsonSchema(registry))).toEqual([]);
    });
  }

  it("finds undescribed properties and tuple items", () => {
    expect(
      undescribedProperties({
        properties: {
          a: { type: "number" },
          b: { description: "B." },
          c: { $ref: "#/$defs/C" },
          d: { prefixItems: [{ const: "x" }, { type: "number" }] },
        },
        $defs: { C: { description: "C." } },
      }).sort(),
    ).toEqual(["/properties/a", "/properties/d", "/properties/d/prefixItems/1"]);
  });

  it("carries the agent surface version", () => {
    expect(sceneJsonSchema(engine)[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(opsJsonSchema(fake)[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
  });
});
