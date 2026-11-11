import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import { PhysicsRequiredError } from "../game/physics-of";
import { validatePhysical } from "../headless/validate-physical";
import { ALL_GROUPS, castSpawn } from "../runtime/cast";
import { createSceneRuntime } from "../runtime/runtime";
import { SENSOR_ENTER } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { parseScene } from "../scene/parse";
import { prefabLibrary } from "../scene/prefab";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { SolidSystem } from "../systems/bodies";
import { carrierDelta, type FollowerSystem } from "../systems/path-follower";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const registry = createRegistry();
/** Props set off sensors here; with the primitives alone nothing does. */
const sensing = createRegistry(
  defineGame({
    id: "sensing",
    types: [],
    actions: [],
    collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);
const DT = 1000 / 60;

/** A lift on a loop with a plank and a trigger attached, a prop riding the plank. */
function yard(more: SceneDefinition["entities"] = []): SceneDefinition {
  return {
    v: 4,
    name: "attached",
    bounds: [-500, -500, 2000, 1500],
    solid: [["box", 500, 1000, 1000, 20]],
    entities: [
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 40, 8],
        path: {
          pts: [
            [400, 600],
            [800, 300],
            [1200, 600],
          ],
          mode: "loop",
          speed: 120,
        },
      },
      { id: "plank", type: "solid", attach: "lift", shape: ["box", 500, 590, 60, 4] },
      { id: "gate", type: "sensor", attach: "lift", shape: ["box", 330, 560, 10, 30] },
      ...more,
    ],
  };
}

function loaded(def: SceneDefinition, reg = registry) {
  const rt = createSceneRuntime({ rapier, view: null, registry: reg });
  const r = rt.load(expandScene({ ...def, ...(reg === registry ? {} : { game: reg.id }) }, reg));
  expect(r.ok).toBe(true);
  return rt;
}

const colliderOf = (rt: ReturnType<typeof loaded>, id: string) =>
  rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!;

describe("attachment to a path follower", () => {
  it("puts the child's collider on the follower's body at its offset from the first path point", () => {
    const rt = loaded(yard());
    const lift = colliderOf(rt, "lift");
    const plank = colliderOf(rt, "plank");
    expect(plank.parent()!.handle).toBe(lift.parent()!.handle);
    expect(rt.ctx.tags.get(plank.handle)).toMatchObject({
      entityId: "plank",
      type: "solid",
      carrier: { entityId: "lift", type: "follower" },
    });
    expect(plank.translation()).toEqual({ x: 500, y: 590 });
    rt.destroy();
  });

  it("moves with its follower for 600 ticks with no drift", () => {
    const rt = loaded(yard());
    const lift = colliderOf(rt, "lift");
    for (let i = 0; i < 600; i++) {
      rt.step(DT, []);
      const at = lift.parent()!.translation();
      const plank = colliderOf(rt, "plank").translation();
      const gate = colliderOf(rt, "gate").translation();
      // Within f32 rounding of the positions, and it never grows.
      expect(plank.x - at.x).toBeCloseTo(100, 3);
      expect(plank.y - at.y).toBeCloseTo(-10, 3);
      expect(gate.x - at.x).toBeCloseTo(-70, 3);
      expect(gate.y - at.y).toBeCloseTo(-40, 3);
    }
    rt.destroy();
  });

  it("carries riders by the follower's one frame delta", () => {
    const rt = loaded(yard());
    const followers = rt.ctx.system<FollowerSystem>("follower")!;
    for (let i = 0; i < 30; i++) {
      rt.step(DT, []);
      expect(carrierDelta(rt.ctx, colliderOf(rt, "plank").handle)).toEqual(
        followers.frameDelta("lift"),
      );
    }
    expect(carrierDelta(rt.ctx, colliderOf(rt, "lift").handle)).toEqual(
      followers.frameDelta("lift"),
    );
    rt.destroy();
  });

  it("waits for a follower that spawns later and comes back with it", () => {
    const rt = loaded(yard());
    const followers = rt.ctx.system<FollowerSystem>("follower")!;
    const lift = rt.scene()!.entities.find((e) => e.id === "lift")!;
    followers.despawn("lift");
    expect(rt.ctx.tags.handlesOf("plank")).toEqual([]);
    followers.spawn(lift as never);
    const plank = colliderOf(rt, "plank");
    expect(plank.parent()!.handle).toBe(colliderOf(rt, "lift").parent()!.handle);
    rt.ctx.system<SolidSystem>("solid")!.despawn("plank");
    expect(rt.ctx.tags.handlesOf("plank")).toEqual([]);
    expect(rt.ctx.physics!.world.getCollider(colliderOf(rt, "lift").handle)).toBeDefined();
    rt.destroy();
  });

  it("gates an attached one-way solid with collision groups, which queries see through filterGroups", () => {
    const def = yard();
    (def.entities![1] as Record<string, unknown>).oneWay = true;
    const rt = loaded(def);
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    const plank = colliderOf(rt, "plank");
    const groups = plank.collisionGroups();
    solids.gateOneWay(700, false);
    expect(solids.isHidden("plank")).toBe(true);
    expect(plank.collisionGroups()).toBe(0);
    expect(colliderOf(rt, "lift").parent()!.translation()).toEqual({ x: 400, y: 600 });
    rt.ctx.physics!.refreshQueries();
    const shape = new rapier.Cuboid(4, 4);
    expect(
      rt.ctx.physics!.world.intersectionWithShape(
        { x: 500, y: 590 },
        0,
        shape,
        undefined,
        ALL_GROUPS,
      ),
    ).toBeNull();
    const cast = castSpawn(rt.ctx, { x: 500, y: 500 }, { type: "box", hw: 4, hh: 4 });
    expect(cast.ok && cast.at.y).toBeGreaterThan(900);
    solids.gateOneWay(500, false);
    expect(solids.isHidden("plank")).toBe(false);
    expect(plank.collisionGroups()).toBe(groups);
    solids.gateOneWay(500, true);
    expect(solids.isHidden("plank")).toBe(true);
    solids.reset!();
    expect(plank.collisionGroups()).toBe(groups);
    rt.destroy();
  });

  it("raises sensor events from an attached sensor as it sweeps", () => {
    const def = yard([
      { id: "shelf", type: "solid", shape: ["box", 430, 520, 20, 4] },
      { id: "crate", type: "prop", shape: ["box", 430, 512, 4, 4], density: 1, restitution: 0 },
    ]);
    const rt = loaded(def, sensing);
    const events = Array.from({ length: 240 }, () => rt.step(DT, []).events).flat();
    expect(
      events.some((e) => e.type === SENSOR_ENTER && e.entityId === "gate" && e.other === "crate"),
    ).toBe(true);
    rt.destroy();
  });

  it("refuses an attach on props and markers, and one that names no follower", () => {
    const bad = parseScene(
      {
        v: 4,
        name: "bad",
        bounds: [0, 0, 100, 100],
        entities: [
          {
            id: "p",
            type: "prop",
            shape: ["box", 0, 0, 4, 4],
            density: 1,
            restitution: 0,
            attach: "lift",
          },
        ],
      },
      registry,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]!.code).toBe("unknown-key");
    const def = yard();
    (def.entities![1] as Record<string, unknown>).attach = "gate";
    const issues = validateScene(def, registry);
    expect(issues.find((i) => i.entityIds.includes("plank"))?.code).toBe("ref-type");
    expect(validateScene(yard(), registry).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("leaves attached colliders out of the physical checks' statics", () => {
    const issues = validatePhysical({ rapier, scene: yard(), registry });
    expect(issues.filter((i) => i.code === "solid-overlap")).toEqual([]);
  });

  it("sweeps attached solids along their follower's path, but not attached sensors", () => {
    // Only the attached sensor `gate` passes through this post.
    const post = { id: "post", type: "solid", shape: ["box", 530, 410, 4, 4] };
    const clear = validatePhysical({ rapier, scene: yard([post]), registry });
    expect(clear.filter((i) => i.code === "follower-hits-solid")).toEqual([]);
    // Past the lift's own reach (x 1240), in the way of the plank it carries 100px to its right.
    const wall = { id: "wall", type: "solid", shape: ["box", 1260, 560, 4, 30] };
    const hits = validatePhysical({ rapier, scene: yard([wall]), registry }).filter(
      (i) => i.code === "follower-hits-solid",
    );
    expect(hits.map((i) => [i.entityIds, i.path])).toEqual([
      [["lift", "plank", "wall"], "/entities/0/path/pts/1"],
      [["lift", "plank", "wall"], "/entities/0/path/pts/2"],
    ]);
    expect(hits[0]!.message).toMatch(/^plank, riding lift, runs into wall on lift's segment 1/);
  });
});

describe("attachment without physics", () => {
  it("throws PhysicsRequiredError from the hub, and fails the load on the rider", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, registry });
    const report = rt.load(expandScene({ ...yard(), settings: { physics: "none" } }, registry));
    expect(report).toMatchObject({ ok: false, reason: "physics-required", entityId: "plank" });
    let thrown: unknown;
    try {
      rt.ctx.attachments.attach("plank", "lift", () => {
        throw new Error("never made");
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PhysicsRequiredError);
    expect(thrown).toMatchObject({ code: "physics-required", what: "attach", entityId: "plank" });
    rt.destroy();
  });
});

describe("attachment to a follower inside an instance", () => {
  const game = createRegistry(testGame);
  const GATE: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    game: testGame.id,
    id: "gate",
    entities: [
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 40, 8],
        path: {
          pts: [
            [0, 0],
            [400, -300],
          ],
          mode: "ping_pong",
          speed: 120,
        },
      },
    ],
  };
  const prefabs = prefabLibrary([GATE]);
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: testGame.id,
    name: "gated",
    bounds: [-500, -500, 2000, 1500],
    instances: [{ id: "gate-2", prefab: "gate", at: [400, 600] }],
    entities: [
      { id: "plank", type: "solid", attach: "gate-2/lift", shape: ["box", 500, 590, 60, 4] },
    ],
  };

  it("validates a ref to gate-2/lift and rides that child's body", () => {
    expect(parseScene(scene, game).ok).toBe(true);
    expect(validateScene(scene, game, { prefabs }).filter((i) => i.severity === "error")).toEqual(
      [],
    );
    const rt = createSceneRuntime({ rapier, view: null, registry: game });
    expect(rt.load(expandScene(scene, game, { prefabs })).ok).toBe(true);
    const lift = colliderOf(rt, "gate-2/lift");
    const plank = colliderOf(rt, "plank");
    expect(plank.parent()!.handle).toBe(lift.parent()!.handle);
    expect(rt.ctx.tags.get(plank.handle)).toMatchObject({
      entityId: "plank",
      carrier: { entityId: "gate-2/lift", type: "follower" },
    });
    for (let i = 0; i < 240; i++) {
      rt.step(DT, []);
      const at = lift.parent()!.translation();
      const p = colliderOf(rt, "plank").translation();
      expect(p.x - at.x).toBeCloseTo(100, 3);
      expect(p.y - at.y).toBeCloseTo(-10, 3);
    }
    expect(lift.parent()!.translation()).not.toEqual({ x: 400, y: 600 });
    rt.destroy();
  });

  it("reports a ref to an instance that doesn't exist as dangling", () => {
    const lost = { ...scene, entities: [{ ...scene.entities![0]!, attach: "gate-9/lift" }] };
    const issues = validateScene(lost, game, { prefabs });
    expect(issues.find((i) => i.entityIds.includes("plank"))?.code).toBe("dangling-ref");
  });
});

describe("a follower's seek", () => {
  const paced = (rate: number) =>
    createRegistry(
      defineGame({
        id: `paced-${rate}`,
        types: [],
        actions: [],
        time: { kind: "fixed", rate },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
  // Bodiless, so positions are the follower's own f64s; ticks of 1/60 s and 1/30 s
  // land a hair short of the waypoint, so one short last step shows.
  const shuttle = (reg: ReturnType<typeof paced>): SceneDefinition => ({
    v: 4,
    name: "shuttle",
    game: reg.id,
    bounds: [-10, -10, 20, 20],
    settings: { physics: "none" },
    entities: [
      {
        id: "car",
        type: "follower",
        shape: ["box", 0, 0, 0.4, 0.2],
        path: {
          pts: [
            [0, 0],
            [2, 0],
          ],
          mode: "loop",
          speed: 2,
        },
      },
    ],
  });

  for (const [rate, ms, ticks] of [
    [60, 500, 30],
    [60, 1000, 60],
    [30, 1000, 30],
    [30, 2000, 60],
  ] as const) {
    it(`lands where ${ticks} steps do for ${ms} ms at ${rate} Hz`, () => {
      const reg = paced(rate);
      const stepped = createSceneRuntime({ rapier, view: null, registry: reg });
      expect(stepped.load(expandScene(shuttle(reg), reg))).toMatchObject({ ok: true });
      for (let i = 0; i < ticks; i++) stepped.step(stepped.ctx.time.tickMs, []);
      const seeked = createSceneRuntime({ rapier, view: null, registry: reg });
      expect(seeked.load(expandScene(shuttle(reg), reg), { timeOffsetMs: ms }).ok).toBe(true);
      const at = (rt: typeof stepped) => rt.ctx.system<FollowerSystem>("follower")!.position("car");
      expect(at(seeked)).toEqual(at(stepped));
      seeked.destroy();
      stepped.destroy();
    });
  }
});
