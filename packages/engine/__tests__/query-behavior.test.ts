// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import {
  defineBehavior,
  handleType,
  type BehaviorDef,
  type BehaviorSystem,
} from "../game/behaviors";
import { createRegistry, defineGame } from "../game/define";
import type { Entity } from "../game/entity";
import { Script } from "../game/script";
import type { EngineContext } from "../game/types";
import type { BehaviorHost } from "../runtime/behaviors";
import type { EntityHandles } from "../runtime/entities";
import { createLookups } from "../runtime/lookups";
import { createPoseIndex } from "../runtime/poses";
import { createQueryIndex } from "../runtime/query-index";
import { createSceneRuntime } from "../runtime/runtime";
import { spawnPose } from "../runtime/spawn-pose";
import type { RuntimeEntity, ShapeObj } from "../scene/types";

const DT = 1000 / 60;

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

/** A behavior whose system hands out `{ ping }` handles. */
function pinging(name: string) {
  return defineBehavior({
    name,
    description: "Answers pings.",
    fields: { speed: z.number().default(1) },
    handle: handleType<{ ping(): string }>(),
    system: (): BehaviorSystem => {
      const attached = new Set<string>();
      return {
        attach: (id) => void attached.add(id),
        detach: (id) => void attached.delete(id),
        clear: () => attached.clear(),
        size: () => attached.size,
        handle: (id) => ({ ping: () => `${name}:${id}` }),
      };
    },
  });
}

const DATA = defineBehavior({
  name: "probe/data",
  description: "Data only.",
  fields: { label: z.string().default("x") },
});

/** A query index over a pose index of its own, posing what it adds at its spawn pose. */
function bareIndex() {
  const registry = createRegistry();
  const poses = createPoseIndex(() => 0);
  const ctx = { registry, poses } as unknown as EngineContext;
  const index = createQueryIndex(ctx);
  const records = new Map<string, RuntimeEntity>();
  const add = (e: RuntimeEntity) => {
    const p = spawnPose(e, registry);
    if (!poses.has(e.id)) poses.set(e.id, p.x, p.y, p.rot, { snap: true });
    records.set(e.id, e);
    index.added(e);
    return e;
  };
  const remove = (id: string) => {
    records.delete(id);
    index.removed(id);
  };
  return { index, add, remove, records, ctx };
}

function filled() {
  const q = bareIndex();
  q.add({ id: "ground", type: "solid", shape: box(0, 100, 200, 10) });
  q.add({
    id: "pad",
    type: "sensor",
    shape: box(50, 50, 10, 10),
    tags: ["goal"],
    behaviors: { "probe/a": { speed: 1 } },
  });
  q.add({
    id: "flag",
    type: "marker",
    at: [60, 80],
    tags: ["goal"],
    behaviors: { "probe/a": { speed: 2 }, "probe/data": { label: "f" } },
  });
  q.add({
    id: "wall",
    type: "solid",
    shape: box(150, 50, 10, 40),
    behaviors: { "probe/data": { label: "w" } },
  });
  return q;
}

describe("the query index by behavior", () => {
  it("selects and counts by behavior, with type and tag, in spawn order", () => {
    const { index } = filled();
    expect(index.select({ behavior: "probe/a" })).toEqual(["pad", "flag"]);
    expect(index.select({ behavior: "probe/data" })).toEqual(["flag", "wall"]);
    expect(index.select({ behavior: "probe/none" })).toEqual([]);
    expect(index.select({ behavior: "probe/a", type: "marker" })).toEqual(["flag"]);
    expect(index.select({ behavior: "probe/data", type: ["solid", "sensor"] })).toEqual(["wall"]);
    expect(index.select({ behavior: "probe/data", tag: "goal" })).toEqual(["flag"]);
    expect(index.count({ behavior: "probe/a" })).toBe(2);
    expect(index.count({ behavior: "probe/a", tag: "nope" })).toBe(0);
  });

  it("answers area, point and nearest queries by behavior", () => {
    const { index } = filled();
    const everywhere = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
    expect(index.inArea(everywhere, { behavior: "probe/data" })).toEqual(["flag", "wall"]);
    expect(index.inArea(box(50, 50, 20, 40), { behavior: "probe/a" })).toEqual(["pad", "flag"]);
    expect(index.at({ x: 50, y: 50 }, { behavior: "probe/a" })).toEqual(["pad"]);
    expect(index.at({ x: 50, y: 50 }, { behavior: "probe/data" })).toEqual([]);
    expect(index.nearest({ x: 0, y: 95 }, { behavior: "probe/data" })).toBe("flag");
    expect(index.nearest({ x: 0, y: 95 }, { behavior: "probe/a", maxDist: 10 })).toBeUndefined();
    expect(index.nearest({ x: 0, y: 95 })).toBe("ground");
  });

  it("follows an edit that adds or drops a block, a removal and a clear", () => {
    const { index, add, remove } = filled();
    add({ id: "ground", type: "solid", shape: box(0, 100, 200, 10), behaviors: { "probe/a": {} } });
    expect(index.select({ behavior: "probe/a" })).toEqual(["ground", "pad", "flag"]);
    add({ id: "flag", type: "marker", at: [60, 80], tags: ["goal"] });
    expect(index.select({ behavior: "probe/a" })).toEqual(["ground", "pad"]);
    expect(index.select({ behavior: "probe/data" })).toEqual(["wall"]);
    remove("pad");
    expect(index.select({ behavior: "probe/a" })).toEqual(["ground"]);
    remove("ground");
    expect(index.select({ behavior: "probe/a" })).toEqual([]);
    index.clear();
    expect(index.select({ behavior: "probe/data" })).toEqual([]);
  });

  it("skips disabled carriers unless asked with enabled: false", () => {
    const { index } = filled();
    index.enabledChanged("pad", false);
    expect(index.select({ behavior: "probe/a" })).toEqual(["flag"]);
    expect(index.select({ behavior: "probe/a", enabled: false })).toEqual(["pad", "flag"]);
    index.enabledChanged("pad", true);
    expect(index.count({ behavior: "probe/a" })).toBe(2);
  });
});

describe("lookups over the index", () => {
  /** Lookups over a filled index and stand-in handles: by default `{ id, fields }` of each record's block. */
  function lookups(handleOf?: (id: string, name: string) => object | undefined) {
    const q = filled();
    const blockHandle = (id: string, name: string) => {
      const block = q.records.get(id)?.behaviors?.[name];
      return block ? { id, fields: block } : undefined;
    };
    const handles: EntityHandles = {
      entity(id) {
        if (!q.records.has(id)) return undefined;
        const getBehavior = (name: string) => (handleOf ?? blockHandle)(id, name);
        return { id, getBehavior } as unknown as Entity;
      },
      clear() {},
    };
    const found = createLookups({
      ctx: q.ctx,
      behaviors: {} as BehaviorHost,
      query: q.index,
      handles,
    });
    return { ...q, found };
  }

  it("gives handles in spawn order for a selector, every entity without one", () => {
    const { found } = lookups();
    expect(found.entities().map((e) => e.id)).toEqual(["ground", "pad", "flag", "wall"]);
    expect(found.entities({ behavior: "probe/data" }).map((e) => e.id)).toEqual(["flag", "wall"]);
    expect(found.entities({ tag: "goal" }).map((e) => e.id)).toEqual(["pad", "flag"]);
  });

  it("finds the first and every enabled carrier, by name, definition or script class", () => {
    const { found, index } = lookups();
    const A = pinging("probe/a");
    class Mover extends Script({ name: "probe/a", description: "A script.", fields: {} }) {}

    for (const key of ["probe/a", A, Mover] as const) {
      expect(found.findBehavior(key as typeof A)).toMatchObject({ id: "pad" });
      expect(found.findBehaviors(key as typeof A).map((h) => (h as { id?: string }).id)).toEqual([
        "pad",
        "flag",
      ]);
    }
    expect(found.findBehavior("probe/none")).toBeUndefined();
    expect(found.findBehaviors("probe/none")).toEqual([]);

    index.enabledChanged("pad", false);
    expect(found.findBehavior("probe/a")).toMatchObject({ id: "flag" });
    expect(found.findBehaviors("probe/a")).toHaveLength(1);
  });

  it("skips a carrier whose block has no handle now", () => {
    const { found } = lookups((id, name) =>
      id === "pad" ? undefined : name === "probe/a" ? { id } : undefined,
    );
    expect(found.findBehavior("probe/a")).toEqual({ id: "flag" });
    expect(found.findBehaviors("probe/a")).toEqual([{ id: "flag" }]);
  });
});

const node = (id: string, at: [number, number], behaviors?: RuntimeEntity["behaviors"]) => ({
  id,
  type: "node",
  at,
  ...(behaviors ? { behaviors } : {}),
});

function world(entities: RuntimeEntity[], behaviors: BehaviorDef[]) {
  const game = defineGame({
    id: "probe",
    types: [],
    actions: [],
    behaviors,
    createRuntime: () => ({ snapshot: () => null }),
  });
  const rt = createSceneRuntime({ rapier: undefined, view: null, game });
  const report = rt.load({
    name: "lookups",
    bounds: [-50, -50, 50, 50],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  });
  if (!report.ok) throw new Error(report.error);
  return rt;
}

describe("lookups in a runtime", () => {
  const A = pinging("probe/a");
  const B = pinging("probe/b");
  const load = () =>
    world(
      [
        node("one", [0, 0], { "probe/a": { speed: 1 } }),
        node("two", [1, 0], { "probe/b": { speed: 1 } }),
        node("three", [2, 0], { "probe/a": { speed: 2 }, "probe/data": { label: "t" } }),
      ],
      [A, B, DATA],
    );

  it("follows spawn, destroy and a live swap that adds or drops a block", () => {
    const rt = load();
    const carrying = (name: string) => rt.ctx.query.select({ behavior: name });
    expect(carrying("probe/a")).toEqual(["one", "three"]);

    const spawned = rt.ctx.spawn({ type: "node", at: [3, 0], behaviors: { "probe/a": {} } });
    rt.step(DT, []);
    expect(carrying("probe/a")).toEqual(["one", "three", spawned.id]);

    rt.ctx.destroy("one");
    rt.step(DT, []);
    expect(carrying("probe/a")).toEqual(["three", spawned.id]);

    expect(rt.update([node("two", [1, 0], { "probe/a": {}, "probe/b": {} })])).toEqual({
      ok: true,
    });
    expect(carrying("probe/a")).toEqual(["two", "three", spawned.id]);
    expect(rt.update([node("three", [2, 0], { "probe/data": { label: "t" } })])).toEqual({
      ok: true,
    });
    expect(carrying("probe/a")).toEqual(["two", spawned.id]);
    expect(carrying("probe/data")).toEqual(["three"]);
  });

  it("answers ctx.entities, findBehavior and findBehaviors as handles", () => {
    const rt = load();
    expect(rt.ctx.entities().map((e) => e.id)).toEqual(["one", "two", "three"]);
    const carriers = rt.ctx.entities({ behavior: "probe/a" });
    expect(carriers.map((e) => e.id)).toEqual(["one", "three"]);
    expect(carriers[0]).toBe(rt.ctx.entity("one"));

    expect(rt.ctx.findBehavior(A)?.ping()).toBe("probe/a:one");
    expect(rt.ctx.findBehaviors(A).map((h) => h.ping())).toEqual(["probe/a:one", "probe/a:three"]);
    expect(rt.ctx.findBehavior("probe/data")?.fields).toEqual({ label: "t" });
    expect(rt.ctx.findBehavior(B)?.fields).toEqual({ speed: 1 });

    rt.ctx.setEnabled("one", false);
    expect(rt.ctx.findBehavior(A)?.ping()).toBe("probe/a:three");
    expect(rt.ctx.findBehaviors(A)).toHaveLength(1);
    expect(rt.ctx.entities({ behavior: "probe/a", enabled: false }).map((e) => e.id)).toEqual([
      "one",
      "three",
    ]);
  });

  it("finds a script by its class", () => {
    class Spinner extends Script({
      name: "probe/spinner",
      description: "Spins.",
      fields: { rate: z.number().default(1) },
    }) {}
    const rt = world(
      [
        node("plain", [0, 0]),
        node("spun", [1, 0], { "probe/spinner": { rate: 2 } }),
        node("also", [2, 0], { "probe/spinner": { rate: 3 } }),
      ],
      [Spinner.behavior],
    );
    expect(rt.ctx.findBehavior(Spinner)).toBeInstanceOf(Spinner);
    expect(rt.ctx.findBehavior(Spinner)?.fields.rate).toBe(2);
    expect(rt.ctx.findBehaviors(Spinner).map((s) => s.fields.rate)).toEqual([2, 3]);
    expect(rt.ctx.findBehaviors("probe/spinner")).toHaveLength(2);
  });
});
