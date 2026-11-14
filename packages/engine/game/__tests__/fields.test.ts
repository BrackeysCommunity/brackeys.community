import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { fieldKind } from "../../scene/schema";
import {
  angleField,
  AssetIdSchema,
  assetField,
  assetKindsOf,
  BASE_FIELDS,
  CHILD_REF_PATTERN,
  gridField,
  gridFieldInfo,
  ID_PATTERN,
  materialField,
  mirrorField,
  pointField,
  refField,
  RESERVED_FIELDS,
  tagsField,
  vectorField,
} from "../fields";
import type { FieldEnv } from "../types";

const envOf = (materials: string[]): FieldEnv => ({
  materials,
  materialDefs: new Map(),
  types: [],
  assets: () => [],
});

const messageOf = (env: FieldEnv, value: unknown) => {
  const parsed = materialField(env).safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("materialField", () => {
  it("names an unknown material, suggests a close one and lists the known ones", () => {
    const env = envOf(["ice", "bouncy"]);
    expect(materialField(env).parse("ice")).toBe("ice");
    expect(materialField(env).parse(undefined)).toBeUndefined();
    expect(messageOf(env, "bouncey")).toBe(
      'unknown material "bouncey"; did you mean "bouncy"? Known: ice, bouncy.',
    );
    expect(messageOf(env, "lava")).toBe('unknown material "lava". Known: ice, bouncy.');
  });

  it("says no materials are defined when there are none", () => {
    expect(messageOf(envOf([]), "bouncy")).toBe(
      'unknown material "bouncy": this project and game define no materials',
    );
  });
});

const metaOf = (schema: z.core.$ZodType) => z.globalRegistry.get(schema);

describe("transform-aware field builders", () => {
  it("builds a vector as a number pair with kind vector", () => {
    const v = vectorField("Launch direction.");
    expect(v.parse([3, -4])).toEqual([3, -4]);
    expect(v.safeParse([3]).success).toBe(false);
    expect(v.safeParse(["a", 1]).success).toBe(false);
    expect(metaOf(v)).toMatchObject({ kind: "vector", description: "Launch direction." });
    expect(metaOf(pointField("Spawn."))?.kind).toBeUndefined();
  });

  it("builds an angle as a number with kind angle and its unit", () => {
    const a = angleField("Facing.", "deg");
    expect(a.parse(90)).toBe(90);
    expect(a.safeParse("90").success).toBe(false);
    expect(metaOf(a)).toMatchObject({ kind: "angle", unit: "deg", description: "Facing." });
  });

  it("builds a mirror as a boolean with kind mirror and its axis", () => {
    const m = mirrorField("x", "Faces left.");
    expect(m.parse(true)).toBe(true);
    expect(m.safeParse(1).success).toBe(false);
    expect(metaOf(m)).toMatchObject({ kind: "mirror", axis: "x", description: "Faces left." });
  });
});

describe("asset fields", () => {
  const env = envOf([]);

  it("parses any id, so a dangling one still loads", () => {
    const f = assetField(env, "texture", "Its picture.");
    expect(f.parse("no-such-asset")).toBe("no-such-asset");
    expect(f.safeParse("Not An Id").success).toBe(false);
    expect(f.safeParse(undefined).success).toBe(false);
    expect(AssetIdSchema.safeParse("hud-font").success).toBe(true);
  });

  it("carries its kinds, title and group, and no enum", () => {
    const f = assetField(env, ["texture", "atlas"], "Its picture.");
    expect(metaOf(f)).toMatchObject({
      title: "Asset",
      group: "assets",
      "x-asset-kind": ["texture", "atlas"],
      description: "Its picture.",
    });
    expect(metaOf(f)?.enum).toBeUndefined();
    expect(z.toJSONSchema(f)).not.toHaveProperty("enum");
  });

  it("reads kinds through optional, nullable and default wrappers", () => {
    const f = assetField(env, "sound", "A cue.");
    expect(assetKindsOf(f)).toEqual(["sound"]);
    expect(assetKindsOf(f.optional())).toEqual(["sound"]);
    expect(assetKindsOf(f.nullable())).toEqual(["sound"]);
    expect(assetKindsOf(f.default("boom"))).toEqual(["sound"]);
    expect(assetKindsOf(f.optional().describe("Another cue."))).toEqual(["sound"]);
  });

  it("is null for any other schema", () => {
    expect(assetKindsOf(AssetIdSchema)).toBeNull();
    expect(assetKindsOf(z.string())).toBeNull();
    expect(assetKindsOf(BASE_FIELDS.layer)).toBeNull();
    expect(assetKindsOf(vectorField("v").optional())).toBeNull();
  });
});

describe("BASE_FIELDS", () => {
  it("takes any id as a layer, leaving unknown ones to validation", () => {
    expect(BASE_FIELDS.layer.parse("parallax-far")).toBe("parallax-far");
    expect(BASE_FIELDS.layer.parse(undefined)).toBeUndefined();
    expect(BASE_FIELDS.layer.safeParse("Not An Id").success).toBe(false);
    expect(BASE_FIELDS.layer.description).not.toMatch(/No runtime effect/);
  });

  it("has an integer z in [-10000, 10000]", () => {
    const zf = BASE_FIELDS.z;
    for (const ok of [-10000, -1, 0, 7, 10000, undefined])
      expect(zf.safeParse(ok).success).toBe(true);
    for (const bad of [-10001, 10001, 1.5, "1"]) expect(zf.safeParse(bad).success).toBe(false);
    expect(metaOf(zf)).toMatchObject({ title: "Z", group: "identity" });
  });

  it("reserves type, the base fields, behaviors and the instance maps", () => {
    expect(RESERVED_FIELDS).toEqual([
      "type",
      "id",
      "name",
      "layer",
      "parent",
      "off",
      "z",
      "behaviors",
      "params",
      "overrides",
    ]);
  });
});

describe("gridField", () => {
  it("is a grid kind with its values and largest value", () => {
    const named = gridField("Tiles.", { values: ["grass", "stone"] });
    expect(fieldKind(named)).toBe("grid");
    expect(fieldKind(named.optional())).toBe("grid");
    expect(metaOf(named)).toMatchObject({ kind: "grid", title: "Cells" });
    expect(named.description).toMatch(/^Tiles\. .*1: grass\. 2: stone\.$/);
    expect(gridFieldInfo(named)).toEqual({ values: ["grass", "stone"], max: 2 });
    expect(gridFieldInfo(gridField("Heights."))).toEqual({ values: [], max: 65535 });
    expect(gridFieldInfo(gridField("Ids.", { values: ["a"], max: 9 }))?.max).toBe(9);
    expect(gridFieldInfo(pointField("At."))).toBeNull();
    expect(() => gridField("Bad.", { max: 0 })).toThrow(RangeError);
    expect(() => gridField("Bad.", { max: 65536 })).toThrow(RangeError);
  });

  it("parses to the canonical grid", () => {
    const f = gridField("Tiles.", { max: 3 });
    expect(f.parse({ "1,0": ["1,1", ""], "-1,0": ["0*30,2,2"], "0,0": [""] })).toEqual({
      "-1,0": ["0*30,2*2"],
      "1,0": ["1*2"],
    });
    expect(f.parse({})).toEqual({});
  });

  it("refuses bad keys, rows, row counts and values past max", () => {
    const f = gridField("Tiles.", { max: 3 });
    for (const bad of [
      { "0,-0": ["1"] },
      { "0,0": ["1*33"] },
      { "0,0": ["1*20,1*20"] },
      { "0,0": [1] },
      { "0,0": Array(33).fill("1") },
      { "0,0": ["4"] },
      { "0,0": "1" },
    ])
      expect(f.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("documents its keys and rows in the JSON Schema", () => {
    const schema = z.toJSONSchema(gridField("Tiles.")) as Record<string, unknown>;
    expect(schema).toMatchObject({
      type: "object",
      propertyNames: { pattern: expect.any(String) },
      additionalProperties: { type: "array", maxItems: 32, items: { pattern: expect.any(String) } },
    });
  });
});

describe("child refs", () => {
  const nine = Array.from({ length: 9 }, (_, i) => `a${i}`).join("/");

  it("matches an id or an instance's child at any depth, up to nine segments", () => {
    for (const ok of ["door", "gate-2/door", "room-1/door-1/panel", nine])
      expect(CHILD_REF_PATTERN.test(ok), ok).toBe(true);
    for (const bad of [
      "",
      "/door",
      "gate-2/",
      "gate-2//door",
      "Gate/door",
      "gate-2/~solid:0",
      "gate-2.door",
      `${nine}/a9`,
      `gate/${"x".repeat(49)}`,
    ])
      expect(CHILD_REF_PATTERN.test(bad), bad).toBe(false);
  });

  it("builds a ref field that takes child refs and documents its pattern", () => {
    const f = refField("The door it opens.");
    expect(f.parse("gate-2/door")).toBe("gate-2/door");
    expect(f.parse("door")).toBe("door");
    expect(f.safeParse("gate-2/Door").success).toBe(false);
    expect(f.description).toBe("The door it opens.");
    expect(metaOf(f)?.title).toBe("Reference");
    expect((z.toJSONSchema(f) as { pattern?: string }).pattern).toBe(CHILD_REF_PATTERN.source);
  });

  it("lets parent name an entity inside an instance", () => {
    const f = BASE_FIELDS.parent;
    expect(f.parse("gate-2/lift")).toBe("gate-2/lift");
    expect(f.parse(undefined)).toBeUndefined();
    expect(f.safeParse("gate-2/lift/").success).toBe(false);
    expect("group" in BASE_FIELDS).toBe(false);
  });

  it("keeps every other id on ID_PATTERN", () => {
    for (const schema of [BASE_FIELDS.id, BASE_FIELDS.layer, AssetIdSchema])
      expect(schema.safeParse("gate-2/door").success).toBe(false);
    expect(tagsField("Tags.").safeParse(["gate-2/door"]).success).toBe(false);
    expect(ID_PATTERN.test("gate-2/door")).toBe(false);
  });
});
