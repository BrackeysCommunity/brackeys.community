import { describe, expect, it } from "vite-plus/test";

import { materialField } from "../fields";
import type { FieldEnv } from "../types";

const envOf = (materials: string[]): FieldEnv => ({
  materials,
  materialDefs: new Map(),
  types: [],
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
