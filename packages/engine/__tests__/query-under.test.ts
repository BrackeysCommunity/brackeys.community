// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior } from "../game/behaviors";
import { defineGame } from "../game/define";
import type { EntitySelector } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { RuntimeEntity, ShapeObj } from "../scene/types";

const MARK = defineBehavior({
  name: "probe/mark",
  description: "Data only.",
  fields: { label: z.string().default("x") },
});

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

const marker = (id: string, at: [number, number], extra: Partial<RuntimeEntity> = {}) =>
  ({ id, type: "marker", at, tags: ["gem"], ...extra }) as RuntimeEntity;

/**
 * `yard` holds `a` (which holds `a1`) and the solid `b`; `other` holds `c`;
 * `d` is a root beside them.
 */
const ENTITIES: RuntimeEntity[] = [
  { id: "yard", type: "node", at: [0, 0] } as RuntimeEntity,
  { id: "other", type: "node", at: [20, 0] } as RuntimeEntity,
  marker("a", [1, 0], { parent: "yard", behaviors: { "probe/mark": { label: "a" } } }),
  marker("a1", [2, 0], { parent: "a", tags: [] }),
  { id: "b", type: "solid", shape: box(4.5, 0, 1, 1), parent: "yard" } as RuntimeEntity,
  marker("c", [21, 0], { parent: "other", behaviors: { "probe/mark": { label: "c" } } }),
  marker("d", [3, 0]),
];

function world() {
  const game = defineGame({
    id: "probe",
    types: [],
    actions: [],
    behaviors: [MARK],
    createRuntime: () => ({ snapshot: () => null }),
  });
  const rt = createSceneRuntime({ rapier: undefined, view: null, game });
  const report = rt.load({
    name: "under",
    bounds: [-50, -50, 50, 50],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities: ENTITIES,
  });
  if (!report.ok) throw new Error(report.error);
  const q = rt.ctx.query;
  /** `ids` in spawn order, as the index lists them. */
  const inOrder = (...ids: string[]) =>
    q.select({ enabled: false }).filter((id) => ids.includes(id));
  return { rt, q, inOrder };
}

const AREA = box(2.5, 0, 3, 1);

describe("selecting under an entity", () => {
  it("answers its descendants alone, in spawn order", () => {
    const { rt, q, inOrder } = world();
    expect(q.select({ under: "yard" })).toEqual(inOrder("a", "a1", "b"));
    expect(q.select({ under: "a" })).toEqual(["a1"]);
    expect(q.select({ under: "a1" })).toEqual([]);
    expect(q.select({ under: "nowhere" })).toEqual([]);
    expect(q.count({ under: "yard" })).toBe(3);
    expect(q.count({ under: "other" })).toBe(1);
    expect(rt.ctx.entities({ under: "yard" }).map((e) => e.id)).toEqual(inOrder("a", "a1", "b"));
    rt.destroy();
  });

  it("combines with type, tag and behavior", () => {
    const { rt, q, inOrder } = world();
    const cases: [EntitySelector, string[]][] = [
      [{ under: "yard", type: "marker" }, inOrder("a", "a1")],
      [{ under: "yard", type: ["solid", "node"] }, ["b"]],
      [{ under: "yard", tag: "gem" }, ["a"]],
      [{ under: "yard", behavior: "probe/mark" }, ["a"]],
      [{ under: "other", behavior: "probe/mark" }, ["c"]],
      [{ under: "a", tag: "gem" }, []],
      [{ under: "yard", type: "marker", tag: "gem", behavior: "probe/mark" }, ["a"]],
    ];
    for (const [sel, want] of cases) {
      expect(q.select(sel), JSON.stringify(sel)).toEqual(want);
      expect(q.count(sel), JSON.stringify(sel)).toBe(want.length);
    }
    rt.destroy();
  });

  it("follows reparenting and skips what is off unless asked", () => {
    const { rt, q, inOrder } = world();
    rt.ctx.tree.setParent("d", "yard");
    rt.ctx.tree.setParent("a", "other");
    expect(q.select({ under: "yard" })).toEqual(inOrder("b", "d"));
    expect(q.select({ under: "other" })).toEqual(inOrder("a", "a1", "c"));
    rt.ctx.setEnabled("a", false);
    expect(q.select({ under: "other" })).toEqual(["c"]);
    expect(q.select({ under: "other", enabled: false })).toEqual(inOrder("a", "a1", "c"));
    rt.destroy();
  });
});

describe("spatial queries under an entity", () => {
  it("inArea keeps the descendants that overlap", () => {
    const { rt, q, inOrder } = world();
    expect(q.inArea(AREA, { type: ["marker", "solid"] })).toEqual(inOrder("a", "a1", "b", "d"));
    expect(q.inArea(AREA, { under: "yard" })).toEqual(inOrder("a", "a1", "b"));
    expect(q.inArea(AREA, { under: "yard", type: "marker" })).toEqual(inOrder("a", "a1"));
    expect(q.inArea(AREA, { under: "yard", tag: "gem" })).toEqual(["a"]);
    expect(q.inArea(AREA, { under: "yard", behavior: "probe/mark" })).toEqual(["a"]);
    expect(q.inArea(AREA, { under: "other" })).toEqual([]);
    rt.destroy();
  });

  it("at keeps the descendants at the point", () => {
    const { rt, q } = world();
    expect(q.at({ x: 5, y: 0 })).toEqual(["b"]);
    expect(q.at({ x: 5, y: 0 }, { under: "yard" })).toEqual(["b"]);
    expect(q.at({ x: 5, y: 0 }, { under: "yard", type: "marker" })).toEqual([]);
    expect(q.at({ x: 2, y: 0 }, { under: "a" })).toEqual(["a1"]);
    expect(q.at({ x: 2, y: 0 }, { under: "a", tag: "gem" })).toEqual([]);
    expect(q.at({ x: 1, y: 0 }, { under: "yard", behavior: "probe/mark" })).toEqual(["a"]);
    expect(q.at({ x: 2, y: 0 }, { under: "other" })).toEqual([]);
    rt.destroy();
  });

  it("nearest picks among the descendants, with and without a distance cap", () => {
    const { rt, q } = world();
    const p = { x: 3, y: 0 };
    expect(q.nearest(p)).toBe("d");
    expect(q.nearest(p, { under: "yard" })).toBe("b");
    expect(q.nearest(p, { under: "yard", type: "marker" })).toBe("a1");
    expect(q.nearest(p, { under: "yard", tag: "gem" })).toBe("a");
    expect(q.nearest(p, { under: "yard", behavior: "probe/mark" })).toBe("a");
    expect(q.nearest(p, { under: "yard", type: "marker", maxDist: 1.5 })).toBe("a1");
    expect(q.nearest(p, { under: "yard", tag: "gem", maxDist: 1.5 })).toBeUndefined();
    expect(q.nearest(p, { under: "other" })).toBe("c");
    expect(q.nearest(p, { under: "other", maxDist: 5 })).toBeUndefined();
    rt.destroy();
  });

  it("answers where the descendants are now, after their parent moved", () => {
    const { rt, q } = world();
    rt.ctx.setPose("yard", 10, 0);
    expect(q.at({ x: 12, y: 0 }, { under: "yard" })).toEqual(["a1"]);
    expect(q.inArea(AREA, { under: "yard" })).toEqual([]);
    expect(q.nearest({ x: 3, y: 0 }, { under: "yard" })).toBe("a");
    rt.destroy();
  });
});
