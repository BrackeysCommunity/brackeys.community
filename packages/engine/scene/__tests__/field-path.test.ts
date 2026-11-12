// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { BEHAVIOR_NAME_PATTERN } from "../../game/behaviors";
import {
  INSTANCE_OVERRIDE_FIELDS,
  isInstanceOverrideField,
  splitChildRef,
  splitFieldPath,
  splitOverridePath,
} from "../field-path";

/** A small seeded generator so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("splitFieldPath", () => {
  it("splits names and indices", () => {
    expect(splitFieldPath("at")).toEqual(["at"]);
    expect(splitFieldPath("shape.hw")).toEqual(["shape", "hw"]);
    expect(splitFieldPath("path.points.0.1")).toEqual(["path", "points", "0", "1"]);
    expect(splitFieldPath("$x._y.Z9")).toEqual(["$x", "_y", "Z9"]);
    expect(splitFieldPath("items.10")).toEqual(["items", "10"]);
  });

  it("takes a behavior name, slash and all, right after behaviors", () => {
    expect(splitFieldPath("behaviors.sprite.frame")).toEqual(["behaviors", "sprite", "frame"]);
    expect(splitFieldPath("behaviors.tactics/selectable.team")).toEqual([
      "behaviors",
      "tactics/selectable",
      "team",
    ]);
    expect(splitFieldPath("behaviors.my-thing")).toEqual(["behaviors", "my-thing"]);
    expect(splitFieldPath("behaviors.tactics/selectable")).toEqual([
      "behaviors",
      "tactics/selectable",
    ]);
  });

  it("refuses a behavior name anywhere else", () => {
    expect(splitFieldPath("tactics/selectable.team")).toBeNull();
    expect(splitFieldPath("behaviors.tactics/selectable.team/x")).toBeNull();
    expect(splitFieldPath("other.tactics/selectable")).toBeNull();
    expect(splitFieldPath("my-thing")).toBeNull();
  });

  it("refuses what isn't in the grammar", () => {
    for (const bad of [
      "",
      ".",
      "a.",
      ".a",
      "a..b",
      "01",
      "a.01",
      "-1",
      "a b",
      "@x",
      "a.@x",
      "behaviors.Tactics/x",
      "behaviors.a/b/c",
      "behaviors./a",
      "behaviors.a/",
      "1a",
    ])
      expect(splitFieldPath(bad), bad).toBeNull();
  });

  it("round-trips any generated path, and refuses one with a bad segment", () => {
    const next = rng(54);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    const names = ["at", "shape", "hw", "$a", "_b", "behaviors", "Z", "team", "x9"];
    const behaviors = ["sprite", "tactics/selectable", "a-b/c-d", "glow"];
    const indices = ["0", "1", "7", "10", "123"];
    const bad = ["", "01", "a-b", "x/y", "@k", "a b", "-", "9a", "x/y/z"];
    for (let n = 0; n < 500; n++) {
      const segs: string[] = [];
      const len = 1 + Math.floor(next() * 5);
      for (let i = 0; i < len; i++) {
        const prev = segs[i - 1];
        const r = next();
        segs.push(
          prev === "behaviors" && r < 0.6
            ? pick(behaviors)
            : r < 0.75
              ? pick(names)
              : pick(indices),
        );
      }
      const path = segs.join(".");
      expect(splitFieldPath(path), path).toEqual(segs);

      const at = Math.floor(next() * segs.length);
      const broken = [...segs];
      broken[at] = pick(bad);
      const behaviorName =
        at > 0 && broken[at - 1] === "behaviors" && BEHAVIOR_NAME_PATTERN.test(broken[at]!);
      if (!behaviorName) expect(splitFieldPath(broken.join(".")), broken.join(".")).toBeNull();
    }
  });
});

describe("splitOverridePath", () => {
  it("splits at the first dot into a child and its field path", () => {
    expect(splitOverridePath("door.at")).toEqual({ child: "door", field: "at" });
    expect(splitOverridePath("door.shape.hw")).toEqual({ child: "door", field: "shape.hw" });
    expect(splitOverridePath("door-1/panel.behaviors.sprite.tint")).toEqual({
      child: "door-1/panel",
      field: "behaviors.sprite.tint",
    });
    expect(splitOverridePath("door.behaviors.tactics/selectable.team")).toEqual({
      child: "door",
      field: "behaviors.tactics/selectable.team",
    });
  });

  it("takes bulk refs as the child", () => {
    expect(splitOverridePath("~solid:0.shape")).toEqual({ child: "~solid:0", field: "shape" });
    expect(splitOverridePath("~solid:ice:12.at.0")).toEqual({
      child: "~solid:ice:12",
      field: "at.0",
    });
    expect(splitOverridePath("gate/~solid:3.at")).toEqual({ child: "gate/~solid:3", field: "at" });
  });

  it("refuses a path without both halves", () => {
    for (const bad of ["", "door", ".at", "door."]) expect(splitOverridePath(bad), bad).toBeNull();
  });

  it("takes nested child refs and nested-instance keys", () => {
    expect(splitOverridePath("door-1/panel.path.speed")).toEqual({
      child: "door-1/panel",
      field: "path.speed",
    });
    expect(splitOverridePath("room-1/door-1/~solid:0.shape")).toEqual({
      child: "room-1/door-1/~solid:0",
      field: "shape",
    });
    for (const field of [...INSTANCE_OVERRIDE_FIELDS, "params.speed"])
      expect(splitOverridePath(`door-1.${field}`)).toEqual({ child: "door-1", field });
    expect(splitOverridePath("room-1/door-1.params.tint")).toEqual({
      child: "room-1/door-1",
      field: "params.tint",
    });
  });

  it("refuses a child or field part outside the grammar", () => {
    for (const bad of [
      "door//panel.at",
      "/door.at",
      "door/.at",
      "~solid:0/door.at",
      "Door.at",
      "door.01",
      "door.a..b",
      "door.tactics/selectable",
      "door 1.at",
    ])
      expect(splitOverridePath(bad), bad).toBeNull();
  });

  it("splits fuzzed child refs and field paths back apart", () => {
    const next = rng(7);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    const children = ["door", "gate-3/door", "a/b/c", "~solid:0", "gate/~solid:ice:4", "~spike:12"];
    const fields = [
      "at",
      "shape.hw",
      "behaviors.sprite.frame",
      "behaviors.t/s.team",
      "path.points.2",
    ];
    for (let n = 0; n < 200; n++) {
      const child = pick(children);
      const field = pick(fields);
      expect(splitOverridePath(`${child}.${field}`)).toEqual({ child, field });
      expect(splitFieldPath(field)).not.toBeNull();
    }
  });
});

describe("splitChildRef", () => {
  it("splits a nested child ref into its instances and the child", () => {
    expect(splitChildRef("door")).toEqual(["door"]);
    expect(splitChildRef("door-1/panel")).toEqual(["door-1", "panel"]);
    expect(splitChildRef("a/b/c")).toEqual(["a", "b", "c"]);
    expect(splitChildRef("door-1/latch/~solid:ice:3")).toEqual(["door-1", "latch", "~solid:ice:3"]);
    expect(splitChildRef("~solid:0")).toEqual(["~solid:0"]);
  });

  it("refuses an empty segment, a bulk ref before the end, and a bad id", () => {
    for (const bad of ["", "/", "a/", "/a", "a//b", "~solid:0/a", "A/b", "a/~solid", "a/~solid:01"])
      expect(splitChildRef(bad), bad).toBeNull();
  });
});

describe("isInstanceOverrideField", () => {
  it("takes a nested instance's own fields and its params", () => {
    for (const field of ["at", "rot", "flip", "z", "off", "layer", "params.speed", "params.$x"])
      expect(isInstanceOverrideField(field), field).toBe(true);
  });

  it("refuses child fields and partial instance fields", () => {
    for (const field of [
      "shape",
      "at.0",
      "params",
      "params.a.b",
      "params.0",
      "overrides",
      "prefab",
    ])
      expect(isInstanceOverrideField(field), field).toBe(false);
  });
});
