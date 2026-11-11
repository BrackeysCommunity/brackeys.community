import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { primitiveFields } from "../game/primitives";
import type { GameDefinition, SceneSystem } from "../game/types";
import { navPolygonsOf } from "../runtime/nav";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import { isNavType } from "../scene/nav-type";
import type { EntityDef, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import { createNavSystem } from "../systems/nav";

/** A game type based on `nav`, spawned by the engine's nav system. */
const ward = defineEntityType({
  type: "ward",
  description: "A named walk area.",
  base: "nav",
  fields: (env) => primitiveFields("nav", env),
});

const game: GameDefinition = defineGame({
  id: "navtest",
  types: [ward],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

const poly = (...pts: number[]) => ["poly", ...pts];

/** An L-shaped room: a wide top arm and a tall left one, meeting at (200, 200). */
const ELL = poly(0, 0, 400, 0, 400, 200, 200, 200, 200, 500, 0, 500);

function scene(entities: EntityDef[]): SceneDefinition {
  return {
    v: 4,
    game: "navtest",
    name: "nav",
    bounds: [0, 0, 1000, 600],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
}

function loaded(def: SceneDefinition) {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  expect(rt.load(expandScene(def, registry))).toMatchObject({ ok: true });
  return rt;
}

const runtimeEntity = (def: SceneDefinition, id: string) =>
  expandScene(def, registry).entities.find((e) => e.id === id)!;

describe("ctx.nav", () => {
  it("is null in a scene without walk areas", () => {
    const rt = loaded(scene([{ id: "spot", type: "marker", at: [10, 10] }]));
    expect(rt.ctx.nav).toBeNull();
    rt.destroy();
  });

  it("is null with only holes, and before anything loads", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    expect(rt.ctx.nav).toBeNull();
    rt.load(
      expandScene(
        scene([{ id: "hole", type: "nav", mode: "block", shape: poly(10, 10, 20, 10, 20, 20) }]),
        registry,
      ),
    );
    expect(rt.ctx.nav).toBeNull();
    rt.destroy();
  });

  it("paths across a concave walk area through its inner corner, with no physics", () => {
    const rt = loaded(scene([{ id: "room", type: "nav", shape: ELL }]));
    const nav = rt.ctx.nav!;
    expect(nav).not.toBeNull();
    expect(rt.ctx.physics).toBeNull();
    expect(nav.mesh.areaOf.every((id) => id === "room")).toBe(true);
    expect(nav.contains({ x: 100, y: 400 })).toBe(true);
    expect(nav.contains({ x: 300, y: 400 })).toBe(false);
    expect(nav.path({ x: 350, y: 100 }, { x: 100, y: 450 })).toEqual([
      { x: 350, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 450 },
    ]);
    const near = nav.nearest({ x: 300, y: 400 });
    expect(near).toEqual({ x: 200, y: 400 });
    expect(rt.stats().perType.nav).toBe(1);
    rt.destroy();
  });

  it("goes around a hole, hugging its corners", () => {
    const rt = loaded(
      scene([
        { id: "hall", type: "nav", shape: poly(0, 0, 600, 0, 600, 300, 0, 300) },
        {
          id: "pillar",
          type: "nav",
          mode: "block",
          shape: poly(250, 100, 350, 100, 350, 200, 250, 200),
        },
      ]),
    );
    const nav = rt.ctx.nav!;
    expect(nav.contains({ x: 300, y: 150 })).toBe(false);
    const path = nav.path({ x: 100, y: 150 }, { x: 500, y: 150 })!;
    expect(path).toHaveLength(4);
    const corners = path.slice(1, 3).map((p) => [p.x, p.y]);
    expect([
      [
        [250, 100],
        [350, 100],
      ],
      [
        [250, 200],
        [350, 200],
      ],
    ]).toContainEqual(corners);
    rt.destroy();
  });

  it("stitches walk areas of every nav-based type where they share an edge", () => {
    const rt = loaded(
      scene([
        { id: "west", type: "nav", shape: poly(0, 0, 200, 0, 200, 200, 0, 200) },
        { id: "east", type: "ward", shape: poly(200, 0, 400, 0, 400, 200, 200, 200) },
        { id: "island", type: "ward", shape: poly(600, 0, 700, 0, 700, 100, 600, 100) },
      ]),
    );
    const nav = rt.ctx.nav!;
    expect(new Set(nav.mesh.areaOf)).toEqual(new Set(["west", "east", "island"]));
    expect(nav.path({ x: 50, y: 100 }, { x: 350, y: 100 })).toEqual([
      { x: 50, y: 100 },
      { x: 350, y: 100 },
    ]);
    expect(nav.path({ x: 50, y: 100 }, { x: 650, y: 50 })).toBeNull();
    rt.destroy();
  });

  it("keeps one mesh until an area changes, then rebuilds it on the next read", () => {
    const def = scene([{ id: "room", type: "nav", shape: ELL }]);
    const rt = loaded(def);
    const first = rt.ctx.nav!;
    rt.step(1000 / 60, []);
    expect(rt.ctx.nav).toBe(first);

    const wider = scene([{ id: "room", type: "nav", shape: poly(0, 0, 400, 0, 400, 500, 0, 500) }]);
    expect(rt.update([runtimeEntity(wider, "room")])).toMatchObject({ ok: true });
    const second = rt.ctx.nav!;
    expect(second).not.toBe(first);
    expect(second.contains({ x: 300, y: 400 })).toBe(true);
    expect(rt.ctx.nav).toBe(second);

    rt.remove(["room"]);
    expect(rt.ctx.nav).toBeNull();
    rt.add([runtimeEntity(def, "room")]);
    expect(rt.ctx.nav?.contains({ x: 300, y: 400 })).toBe(false);
    rt.unload();
    expect(rt.ctx.nav).toBeNull();
    rt.destroy();
  });
});

describe("the nav-type rule", () => {
  const inert = (): SceneSystem => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 });
  /** Based on `nav`, but spawned by a system of its own. */
  const fence = defineEntityType({
    type: "fence",
    description: "A nav-shaped type its own system spawns.",
    base: "nav",
    fields: (env) => primitiveFields("nav", env),
    system: inert,
  });
  /** No base, spawned by the engine's nav system. */
  const lane = defineEntityType({
    type: "lane",
    description: "A walk area named by its system.",
    fields: (env) => primitiveFields("nav", env),
    system: createNavSystem,
  });
  /** Based on `nav`, kept on disk only. */
  const sketch = defineEntityType({
    type: "sketch",
    description: "An editor-only walk area.",
    base: "nav",
    fields: (env) => primitiveFields("nav", env),
    loads: false,
  });
  const rules = createRegistry(
    defineGame({
      id: "navrules",
      types: [ward, fence, lane, sketch],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const type = (name: string) => rules.types.get(name);

  it("names the nav primitive, nav-based types and types the nav system spawns", () => {
    for (const name of ["nav", "ward", "lane"]) expect(isNavType(type(name))).toBe(true);
    for (const name of ["fence", "sketch", "solid", "missing"])
      expect(isNavType(type(name))).toBe(false);
  });

  it("gives the validator and the runtime's polygons the same types", () => {
    const bowtie = poly(100, 100, 300, 300, 300, 100, 100, 300);
    const def: SceneDefinition = {
      ...scene([
        { id: "w", type: "ward", shape: bowtie },
        { id: "f", type: "fence", shape: bowtie },
        { id: "l", type: "lane", shape: poly(400, 100, 600, 300, 600, 100, 400, 300) },
      ]),
      game: "navrules",
    };
    const flagged = validateScene(def, rules)
      .filter((i) => i.code === "nav-invalid")
      .flatMap((i) => i.entityIds ?? []);
    expect(flagged).toEqual(["w", "l"]);
    const { areas } = navPolygonsOf(expandScene(def, rules).entities, rules);
    expect(areas.map((a) => a.id)).toEqual(["w", "l"]);
  });
});
