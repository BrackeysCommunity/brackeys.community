import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { SCHEMA_ID_BASE, sceneJsonSchema } from "../json-schema";

const FILE = new URL("../scene.schema.json", import.meta.url);

describe("scene.schema.json", () => {
  it("matches sceneJsonSchema() (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = sceneJsonSchema();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(fresh);
  });

  it("has a stable URN id and no domain", () => {
    const schema = sceneJsonSchema();
    expect(schema.$id).toBe(`${SCHEMA_ID_BASE}scene:v1`);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)/);
  });

  it("carries custom meta and describes every shape tuple form", () => {
    const schema = sceneJsonSchema() as {
      $defs: Record<
        string,
        { oneOf?: { title: string; prefixItems: unknown[] }[]; unit?: string; id?: unknown }
      >;
      properties: Record<string, { unit?: string; description?: string }>;
    };
    expect(schema.properties.bounds.unit).toBe("px");
    expect(schema.properties.bounds.description).toMatch(/y is down/);
    const shape = schema.$defs.ShapeTuple;
    expect(shape.oneOf?.map((o) => o.title)).toEqual(["box", "circle", "capsule", "poly", "chain"]);
    expect(shape.oneOf?.[0].prefixItems[0]).toEqual({ const: "box" });
    expect(shape.id).toBeUndefined();
    expect(schema.$defs.BoxShape.oneOf?.map((o) => o.title)).toEqual(["box"]);
    expect(schema.$defs.BodyShape.oneOf?.map((o) => o.title)).not.toContain("chain");
    expect(JSON.stringify(schema.$defs.Path)).toContain('"unit":"px/s"');
  });
});
