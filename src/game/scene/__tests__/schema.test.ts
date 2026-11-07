import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { EntityDefSchema, ID_PATTERN, SceneV1, entitySchemaFor } from "../schema";
import { BEHAVIORS } from "../types";

const yard = JSON.parse(
  readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
);
const minimal = { v: 1, name: "s", bounds: [0, 0, 100, 100], spawn: [[50, 50]] };

describe("SceneV1", () => {
  it("accepts test-yard", () => {
    expect(SceneV1.safeParse(yard).success).toBe(true);
  });

  it("rejects a cloud with a circle", () => {
    const r = EntityDefSchema.safeParse({ id: "c", b: "cloud", shape: ["circle", 0, 0, 5] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain("must be box");
    expect(SceneV1.safeParse({ ...minimal, cloud: [["circle", 0, 0, 5]] }).success).toBe(false);
  });

  it("rejects chain on a mover but allows it on solid and sensor", () => {
    const path = {
      pts: [
        [0, 0],
        [10, 0],
      ],
      mode: "loop",
      speed: 10,
    };
    expect(
      EntityDefSchema.safeParse({ id: "m", b: "mover", shape: ["chain", 0, 0, 5, 0], path })
        .success,
    ).toBe(false);
    expect(
      EntityDefSchema.safeParse({ id: "s", b: "solid", shape: ["chain", 0, 0, 5, 0] }).success,
    ).toBe(true);
    expect(
      EntityDefSchema.safeParse({
        id: "z",
        b: "sensor",
        kind: "hazard",
        shape: ["chain", 0, 0, 5, 0],
      }).success,
    ).toBe(true);
    expect(SceneV1.safeParse({ ...minimal, solid: [["chain", 0, 0, 5, 0]] }).success).toBe(true);
  });

  it("is strict, checks bounds order and integer construct rotation", () => {
    expect(SceneV1.safeParse({ ...minimal, extra: 1 }).success).toBe(false);
    expect(SceneV1.safeParse({ ...minimal, bounds: [100, 0, 0, 100] }).success).toBe(false);
    expect(SceneV1.safeParse({ ...minimal, bounds: [0, 0, 100.5, 100] }).success).toBe(false);
    expect(
      EntityDefSchema.safeParse({
        id: "w",
        b: "construct",
        type: "wind_zone",
        at: [0, 0],
        rot: 12.5,
      }).success,
    ).toBe(false);
    expect(
      EntityDefSchema.safeParse({ id: "w", b: "construct", type: "wind_zone", at: [0, 0], rot: 90 })
        .success,
    ).toBe(true);
  });

  it("allows duplicate ids (validateScene reports dup-id) and an empty spawn list", () => {
    const e = { id: "a", b: "anchor", at: [0, 0] };
    expect(SceneV1.safeParse({ ...minimal, spawn: [], entities: [e, e] }).success).toBe(true);
  });

  it("has a schema for every behavior and an id pattern that never matches a bulk ref", () => {
    for (const b of BEHAVIORS) expect(entitySchemaFor(b).shape.b.value).toBe(b);
    expect(ID_PATTERN.test("pit-shuttle")).toBe(true);
    expect(ID_PATTERN.test("~solid:0")).toBe(false);
    expect(ID_PATTERN.test("-x")).toBe(false);
    expect(ID_PATTERN.test("a".repeat(49))).toBe(false);
  });
});
