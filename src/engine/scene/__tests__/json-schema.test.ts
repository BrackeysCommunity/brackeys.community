import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import {
  fragmentJsonSchema,
  prefabJsonSchema,
  SCHEMA_ID_BASE,
  sceneJsonSchema,
  toJsonSchema,
  undescribedProperties,
  untitledEntityFields,
} from "../json-schema";
import { opsJsonSchema } from "../ops-schema";
import { sceneSchemaFor } from "../schema";
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
    expect(schema.$id).toBe(`${SCHEMA_ID_BASE}scene:v3`);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)/);
    expect(sceneJsonSchema(fake).$id).toBe(`${SCHEMA_ID_BASE}scene:fake:v3`);
  });

  it("lists registered types and bulk keys only", () => {
    const schema = sceneJsonSchema(engine) as Schema;
    expect(Object.keys(schema.properties)).toEqual([
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

describe("layer enums", () => {
  const layerEnums = (schema: unknown): unknown[] => {
    const out: unknown[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.title === "Layer" && n.group === "identity") out.push(n.enum);
      Object.values(n).forEach(walk);
    };
    walk(schema);
    return out;
  };

  it("lists the registry's layers on every layer field", () => {
    const layered = createRegistry(
      defineGame({
        id: "layered",
        types: [],
        layers: [
          { name: "back", description: "Behind.", draw: 0 },
          { name: "front", description: "In front.", draw: 10 },
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    for (const schema of [
      sceneJsonSchema(layered),
      prefabJsonSchema(layered),
      fragmentJsonSchema(layered),
    ]) {
      const enums = layerEnums(schema);
      expect(enums.length).toBeGreaterThan(1);
      expect(new Set(enums.map((e) => JSON.stringify(e)))).toEqual(
        new Set([JSON.stringify(["back", "front"])]),
      );
    }
    expect(new Set(layerEnums(sceneJsonSchema(engine)).map((e) => JSON.stringify(e)))).toEqual(
      new Set([JSON.stringify(["terrain", "decor", "gameplay", "editor"])]),
    );
  });

  it("leaves layers any id without the option", () => {
    const enums = layerEnums(toJsonSchema(sceneSchemaFor(engine)));
    expect(enums.length).toBeGreaterThan(0);
    expect(enums.every((e) => e === undefined)).toBe(true);
  });
});

describe("behaviors", () => {
  const tint = defineBehavior({
    name: "bh/tint",
    description: "A tint.",
    fields: {
      color: z.string().describe("The tint's color."),
      alpha: z.number().default(1).describe("Opacity; default 1."),
      note: z.string().optional().describe("Why."),
    },
    inspector: { label: "Tint" },
  });
  const tag = defineBehavior({
    name: "bh/tag",
    description: "A label.",
    fields: { label: z.string().describe("The label.") },
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
        marker("token", { defaults: { [tag.name]: { label: "?" } } }),
        marker("bare", { forbidden: "all" }),
      ],
      behaviors: [tint, tag],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  type Node = {
    properties?: Record<string, Node>;
    required?: string[];
    additionalProperties?: unknown;
    title?: string;
    description?: string;
  };
  const entities = (sceneJsonSchema(reg) as { $defs: { Entity: { oneOf: Node[] } } }).$defs.Entity
    .oneOf;
  const entity = (type: string) =>
    entities.find((e) => (e.properties!.type as { const?: string }).const === type)!;
  const slot = (type: string) => entity(type).properties!.behaviors!;

  it("lists a type's allowed behaviors, closed to any other name", () => {
    expect(Object.keys(slot("token").properties!)).toEqual([tint.name, tag.name]);
    expect(slot("token").additionalProperties).toBe(false);
    expect(slot("token")).toMatchObject({ type: "object", title: "Behaviors" });
    expect(slot("bare").properties).toEqual({});
    expect(slot("bare").additionalProperties).toBe(false);
    const block = slot("token").properties![tint.name]!;
    expect(block).toMatchObject({ title: "Tint", description: "A tint." });
    expect(block.additionalProperties).toBe(false);
    expect(slot("token").properties![tag.name]!.title).toBe(tag.name);
  });

  it("requires a block field only when neither the behavior nor the type defaults it", () => {
    expect(slot("token").properties![tint.name]!.required).toEqual(["color"]);
    expect(slot("chip").properties![tint.name]!.required).toBeUndefined();
    expect(slot("token").properties![tag.name]!.required).toBeUndefined();
    expect(slot("badge").properties![tag.name]!.required).toEqual(["label"]);
  });

  it("requires a required block, and behaviors, only when it has a field nothing defaults", () => {
    expect(entity("badge").required).toContain("behaviors");
    expect(slot("badge").required).toEqual([tint.name]);
    expect(entity("chip").required).not.toContain("behaviors");
    expect(slot("chip").required).toBeUndefined();
    expect(entity("token").required).not.toContain("behaviors");
  });

  it("gives types that don't load no behaviors", () => {
    expect(entity("note").properties).not.toHaveProperty("behaviors");
    expect(JSON.stringify(sceneJsonSchema(reg))).not.toContain("x-behaviors");
    expect(undescribedProperties(sceneJsonSchema(reg))).toEqual([]);
    expect(untitledEntityFields(sceneJsonSchema(reg))).toEqual([]);
  });

  it("carries the slot into prefab and fragment schemas", () => {
    for (const schema of [prefabJsonSchema(reg), fragmentJsonSchema(reg)]) {
      const text = JSON.stringify(schema);
      expect(text).toContain(`"${tint.name}"`);
      expect(text).toContain('"title":"Behaviors"');
    }
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
