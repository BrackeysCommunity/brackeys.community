// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { BASE_FIELDS, Z_LIMIT } from "../../game/fields";
import { FIELD_NAME_PATTERN, isInstanceOverrideField } from "../field-path";
import { instanceOverrideEntries } from "../resolve";
import { OVERRIDE_PATH } from "../schema";

describe("field names", () => {
  it("one pattern rules field names, override segments and param fields", () => {
    for (const name of ["at", "$x", "_y", "Z9"]) {
      expect(FIELD_NAME_PATTERN.test(name)).toBe(true);
      expect(OVERRIDE_PATH.test(`door.${name}`)).toBe(true);
      expect(isInstanceOverrideField(`params.${name}`)).toBe(true);
    }
    for (const name of ["@at", "9a", "a-b", ""]) {
      expect(FIELD_NAME_PATTERN.test(name)).toBe(false);
      expect(OVERRIDE_PATH.test(`door.${name}`)).toBe(false);
      expect(isInstanceOverrideField(`params.${name}`)).toBe(false);
    }
  });
});

describe("z range", () => {
  it("the base z field takes exactly [-Z_LIMIT, Z_LIMIT]", () => {
    for (const z of [-Z_LIMIT, 0, Z_LIMIT]) expect(BASE_FIELDS.z.safeParse(z).success).toBe(true);
    for (const z of [-Z_LIMIT - 1, Z_LIMIT + 1])
      expect(BASE_FIELDS.z.safeParse(z).success).toBe(false);
  });
});

describe("instanceOverrideEntries", () => {
  const params = {
    speed: { description: "speed", targets: ["door.path.speed", "lift.path.speed"], default: 1 },
    tint: { description: "tint", targets: ["door.tint"] },
  };

  it("lays params (defaults included) ahead of the instance's own overrides", () => {
    expect(
      instanceOverrideEntries(params, {
        params: { tint: "red" },
        overrides: { "door.path.speed": 5 },
      }),
    ).toEqual([
      ["door.path.speed", 1],
      ["lift.path.speed", 1],
      ["door.tint", "red"],
      ["door.path.speed", 5],
    ]);
  });

  it("leaves out a param with no value and no default", () => {
    expect(instanceOverrideEntries(params, {})).toEqual([
      ["door.path.speed", 1],
      ["lift.path.speed", 1],
    ]);
  });
});
