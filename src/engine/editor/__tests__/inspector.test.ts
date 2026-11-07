import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { SceneDefinition } from "../../scene/types";
import { fieldOp, inspectorFields, withShapeSlot, type InspectorField } from "../inspector";
import { lookupRef } from "../refs";

const registry = createRegistry(
  defineGame({
    id: "levers",
    types: [
      defineEntityType({
        type: "lever",
        description: "Starts a follower.",
        base: "marker",
        fields: {
          at: pointField("Lever position."),
          force: z.number().positive().describe("Push, px/s.").meta({ title: "Force" }),
          turns: z.number().int().min(0).optional().describe("Turns before it sticks."),
        },
        inspector: { order: ["force"] },
      }),
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const def: SceneDefinition = {
  v: 1,
  game: "levers",
  name: "i",
  bounds: [0, 0, 100, 100],
  solid: [["box", 5, 5, 2, 2]],
  entities: [
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 40, 6],
      path: {
        pts: [
          [10, 10],
          [10, 50],
        ],
        mode: "ping_pong",
        speed: 80,
      },
    },
    { id: "pull", type: "lever", at: [3, 4], force: 2 },
    { id: "wall", type: "solid", shape: ["poly", 0, 0, 4, 0, 2, 3] },
  ],
};

const fields = (ref: string) => inspectorFields(registry, lookupRef(def, ref)!);
const byPath = (list: InspectorField[], path: string) => list.find((f) => f.path === path)!;

describe("inspectorFields", () => {
  it("lists a type's own fields from its schema, with titles and descriptions", () => {
    const lift = fields("lift");
    expect(lift.map((f) => [f.path, f.kind])).toEqual([
      ["shape", "shape"],
      ["path", "object"],
      ["material", "value"],
    ]);
    expect(byPath(lift, "shape")).toMatchObject({
      slots: [
        { name: "cx", index: 1, value: 0, size: false },
        { name: "cy", index: 2, value: 0, size: false },
        { name: "hw", index: 3, value: 40, size: true },
        { name: "hh", index: 4, value: 6, size: true },
        { name: "rotDeg", index: 5, value: 0, size: false },
      ],
    });
    expect(byPath(lift, "material").title).toBe("Material");
    expect(byPath(lift, "shape").description).toContain("LOCAL");
  });

  it("walks nested objects: numbers with their bounds, point lists and values", () => {
    const path = byPath(fields("lift"), "path");
    if (path.kind !== "object") throw new Error("path is an object");
    expect(path.fields.map((f) => [f.path, f.kind, f.title])).toEqual([
      ["path.pts", "points", "Waypoints"],
      ["path.mode", "value", "Mode"],
      ["path.speed", "number", "Speed"],
      ["path.pauseMs", "number", "Pause"],
    ]);
    expect(byPath(path.fields, "path.pauseMs")).toMatchObject({ value: undefined, min: 0 });
    expect(byPath(path.fields, "path.pts")).toMatchObject({
      value: [
        [10, 10],
        [10, 50],
      ],
    });
  });

  it("follows the type's inspector order and reads number bounds", () => {
    const pull = fields("pull");
    expect(pull.map((f) => f.path)).toEqual(["force", "at", "turns"]);
    expect(byPath(pull, "force")).toMatchObject({
      kind: "number",
      title: "Force",
      value: 2,
      min: 0,
      exclusive: true,
      integer: false,
    });
    expect(byPath(pull, "turns")).toMatchObject({ integer: true, min: 0, value: undefined });
    expect(byPath(pull, "at")).toMatchObject({ kind: "point", value: [3, 4], title: "Position" });
  });

  it("shows a bulk entry's bulk field only, and a polygon without slots", () => {
    expect(fields("~solid:0").map((f) => f.path)).toEqual(["shape"]);
    expect(byPath(fields("wall"), "shape")).toMatchObject({ kind: "shape", slots: null });
  });

  it("builds the update op for a field", () => {
    expect(fieldOp("lift", "shape", withShapeSlot(["box", 0, 0, 40, 6], 3, 50))).toEqual({
      op: "update",
      ref: "lift",
      set: { shape: ["box", 0, 0, 50, 6] },
    });
  });
});
