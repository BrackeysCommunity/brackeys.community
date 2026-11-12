// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { expandScene } from "../expand";
import { opBatchSchemaFor } from "../ops-schema";
import { parsePrefab, prefabLibrary } from "../prefab";
import { applyHeaderOp, headerOf } from "../prefab-header";
import { paramMapProblem, paramTargetValues } from "../prefab-params";
import { localChildren, paramOverrides } from "../resolve";
import type { InstanceDef, Prefab, PrefabParam, SceneDefinition } from "../types";
import { engine } from "./fixtures/random-ops";

const style: PrefabParam = {
  description: "How the gate's bar behaves.",
  targets: ["bar.oneWay", "flag.tags"],
  map: { "bar.oneWay": { ledge: true, wall: false } },
};

const gate = (param: PrefabParam = style): Prefab => ({
  kind: "prefab",
  v: 4,
  id: "gate",
  params: { style: param },
  entities: [
    { id: "bar", type: "solid", shape: ["box", 0, 0, 1, 0.1] },
    { id: "flag", type: "marker", at: [0, -1] },
  ],
});

const childOf = (inst: Partial<InstanceDef>, ref: string, prefab = gate()) => {
  const lib = prefabLibrary([prefab]);
  const kids = localChildren(prefab, { id: "g", prefab: "gate", at: [0, 0], ...inst }, engine, lib);
  const c = kids.find((k) => k.child === ref);
  return c?.kind === "entity" ? c.def : undefined;
};

describe("prefab params: value maps", () => {
  it("gives a mapped target the mapped value and the rest the value as it is", () => {
    expect(paramTargetValues(style, "ledge")).toEqual([
      ["bar.oneWay", true],
      ["flag.tags", "ledge"],
    ]);
  });

  it("leaves a mapped target alone for a value the map lacks or a non-string value", () => {
    expect(paramTargetValues(style, "gap")).toEqual([["flag.tags", "gap"]]);
    expect(paramTargetValues(style, 1)).toEqual([["flag.tags", 1]]);
    expect(paramTargetValues(style, "toString")).toEqual([["flag.tags", "toString"]]);
  });

  it("maps the default when an instance sets none", () => {
    const param = { ...style, targets: ["bar.oneWay"], default: "ledge" };
    expect(paramOverrides({ style: param }, undefined)).toEqual([["bar.oneWay", true]]);
  });

  it("reaches an instance's children, an override still winning", () => {
    expect(childOf({ params: { style: "ledge" } }, "bar")?.oneWay).toBe(true);
    expect(childOf({ params: { style: "gap" } }, "bar")?.oneWay).toBeUndefined();
    expect(
      childOf({ params: { style: "ledge" }, overrides: { "bar.oneWay": false } }, "bar")?.oneWay,
    ).toBe(false);
  });

  it("reaches the expanded scene", () => {
    const def: SceneDefinition = {
      v: 4,
      name: "maps",
      bounds: [-5, -5, 5, 5],
      instances: [{ id: "g", prefab: "gate", at: [0, 0], params: { style: "ledge" } }],
    };
    const bar = expandScene(def, engine, { prefabs: prefabLibrary([gate()]) }).entities.find(
      (e) => e.id === "g/bar",
    );
    expect(bar?.oneWay).toBe(true);
  });
});

describe("prefab params: the value map rule", () => {
  it("accepts a map of some of the targets", () => {
    expect(paramMapProblem(style)).toBeNull();
    expect(paramMapProblem({ ...style, default: "wall" })).toBeNull();
  });

  it("refuses a map of a path that isn't a target", () => {
    expect(paramMapProblem({ ...style, map: { "bar.friction": { ledge: 0 } } })).toMatchObject({
      path: ["map", "bar.friction"],
    });
  });

  it("refuses an empty map and a non-string default", () => {
    expect(paramMapProblem({ ...style, map: { "bar.oneWay": {} } })?.path).toEqual([
      "map",
      "bar.oneWay",
    ]);
    expect(paramMapProblem({ ...style, default: 2 })?.path).toEqual(["default"]);
  });

  it("is judged when a prefab file parses", () => {
    expect(parsePrefab(gate(), engine)).toMatchObject({ ok: true, prefab: { params: { style } } });
    const bad = parsePrefab(gate({ ...style, map: { "bar.friction": { ledge: 0 } } }), engine);
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]).toMatchObject({
      code: "schema",
      path: "/params/style/map/bar.friction",
    });
  });

  it("keeps the map through a prefab file's schema and an exposeParam op", () => {
    const op = { op: "exposeParam", name: "style", param: style };
    expect(opBatchSchemaFor(engine).safeParse({ ops: [op] }).success).toBe(true);
    const ok = applyHeaderOp(headerOf(gate()), { ...op, op: "exposeParam" }, "gate", new Map());
    expect(ok.ok && ok.header.params.style).toEqual(style);
  });

  it("refuses an exposeParam whose map breaks the rule", () => {
    const out = applyHeaderOp(
      headerOf(gate()),
      { op: "exposeParam", name: "style", param: { ...style, default: false } },
      "gate",
      new Map(),
    );
    expect(out).toMatchObject({
      ok: false,
      issue: { code: "op-invalid", path: "/param/default" },
    });
  });
});
