import type { InputAction, RapierModule } from "@jams/engine";
import {
  createRegistry,
  type FollowerSystem,
  type SceneRuntimeHandle,
  type SolidSystem,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import {
  isSpawnOnly,
  parseScene,
  placeableTypes,
  type ExpandedScene,
  type Pt,
  type RuntimeEntity,
} from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import { PLAYER_HEIGHT } from "../entities/player";
import type { ConstructSystem } from "../entities/shaper-constructs";
import { platformerGame, TYPE, type PlatformerStoreSlice, type PlayerSnapshot } from "../index";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

const box = (cx: number, cy: number, hw: number, hh: number) =>
  ({ type: "box", cx, cy, hw, hh, rotDeg: 0 }) as const;

const floor: RuntimeEntity = { id: "floor", type: "solid", shape: box(0, 0.2, 5, 0.2) };
const spawnAt = (at: Pt): RuntimeEntity => ({ id: "~spawn:0", type: TYPE.spawn, at });

function scene(entities: RuntimeEntity[], gravity: Pt = [0, 12]): ExpandedScene {
  return {
    name: "t",
    game: "platformer",
    bounds: [-10, -10, 10, 10],
    settings: { gravity, physics: "rapier", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

function runtime(next: ExpandedScene): SceneRuntimeHandle {
  return createHeadlessRuntime({ rapier, game: platformerGame, scene: next });
}

function press(action: string, pressed = true): InputAction {
  return { action, pressed, tick: 0, timestamp: 0 };
}

const player = (rt: SceneRuntimeHandle) => rt.snapshot() as PlayerSnapshot;
const steps = (rt: SceneRuntimeHandle, n: number, actions: InputAction[] = []) =>
  Array.from({ length: n }, (_, i) => rt.step(DT, i === 0 ? actions : []));

describe("platformerGame registry", () => {
  const registry = createRegistry(platformerGame);

  it("spawns in M1's order", () => {
    expect(registry.spawnGroups).toEqual([
      ["solid"],
      ["cloud"],
      ["sensor", "goal", "exit", "hazard"],
      ["prop"],
      ["mover", "follower"],
      ["anchor"],
      ["construct"],
      ["marker", "spawn"],
      ["player"],
      ["decor"],
      ["nav"],
    ]);
  });

  it("has bulk keys for solids by material, clouds, anchors and spawns", () => {
    expect(registry.bulkKeys.map((b) => b.key)).toEqual([
      "solid",
      "solid:ice",
      "solid:chocolate",
      "solid:trampoline",
      "cloud",
      "anchor",
      "spawn",
    ]);
  });

  const interacts = (a: string, b: string) => {
    const [ga, gb] = [registry.collisionGroups(a), registry.collisionGroups(b)];
    return ((ga >>> 16) & gb & 0xffff) !== 0 && ((gb >>> 16) & ga & 0xffff) !== 0;
  };

  it("lets the player touch ground, bodies and sensors but not another player", () => {
    for (const other of ["static", "dynamic", "sensor"])
      expect(interacts("player", other)).toBe(true);
    expect(interacts("player", "player")).toBe(false);
    expect(interacts("sensor", "dynamic")).toBe(false);
  });

  it("lets clouds touch the player only", () => {
    expect(interacts("cloud", "player")).toBe(true);
    for (const other of ["static", "dynamic", "sensor", "cloud"])
      expect(interacts("cloud", other)).toBe(false);
  });
});

describe("the player", () => {
  it("is absent without a spawn", () => {
    const rt = runtime(scene([floor]));
    const result = rt.step(DT, []);
    expect(result.game).toEqual({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      state: "idle",
      grounded: false,
    });
    expect(result.events).toEqual([]);
    expect(rt.game?.cameraTarget?.()).toBeNull();
    rt.destroy();
  });

  it("puts its feet on the first spawn and lands on tick 0", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0]), { ...spawnAt([3, 0]), id: "~spawn:1" }]));
    const first = rt.step(DT, []);
    const snap = first.game as PlayerSnapshot;
    expect(snap.grounded).toBe(true);
    expect(snap.groundId).toBe("floor");
    expect(snap.position.x).toBe(0);
    expect(snap.position.y).toBeCloseTo(-PLAYER_HEIGHT / 2, 2);
    expect(first.events).toEqual([
      { tick: 0, type: "landed", entityId: "floor", at: snap.position },
    ]);
    rt.destroy();
  });

  it("falls by the scene's gravity", () => {
    const fall = (gravity: Pt) => {
      const rt = runtime(scene([spawnAt([0, -5])], gravity));
      rt.step(DT, []);
      const vy = player(rt).velocity.y;
      rt.destroy();
      return vy;
    };
    expect(fall([0, 12])).toBeCloseTo(12 / 60, 9);
    expect(fall([0, 6])).toBeCloseTo(6 / 60, 9);
  });

  it("reports left-ground with the surface it jumped from", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    rt.step(DT, []);
    const events = steps(rt, 6, [press("jump")]).flatMap((r) => r.events);
    expect(events.map((e) => [e.type, e.entityId])).toContainEqual(["left-ground", "floor"]);
    rt.destroy();
  });

  it("enters sensors by id and falls through them onto the ground", () => {
    const lava: RuntimeEntity = { id: "lava", type: TYPE.hazard, shape: box(0, -1, 0.5, 0.08) };
    const rt = runtime(scene([floor, lava, spawnAt([0, -2])]));
    const results = steps(rt, 120);
    const entered = results.flatMap((r) => r.events).filter((e) => e.type === "sensor:enter");
    expect(entered).toEqual([expect.objectContaining({ entityId: "lava", other: "player#1" })]);
    expect(player(rt)).toMatchObject({ grounded: true, groundId: "floor" });
    rt.destroy();
  });

  it("hands the shell the last step's player, the same object while it holds still", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    const slice = () => rt.game?.storeSlice?.() as PlatformerStoreSlice;
    rt.step(DT, []);
    expect(slice().player).toEqual(player(rt));
    rt.load(scene([floor]));
    const empty = slice();
    steps(rt, 3);
    expect(slice()).toBe(empty);
    expect(empty.player).toBeNull();
    rt.destroy();
  });
});

describe("the player entity", () => {
  it("is player#1, spawned by the game in the entity table, stats, scene and queries", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    expect(rt.ctx.get("player#1")).toEqual({ id: "player#1", type: "player", at: [0, 0] });
    expect(rt.ctx.exists("player#1")).toBe(true);
    expect(rt.ctx.enabled("player#1")).toBe(true);
    expect(rt.stats()).toMatchObject({ entities: 3, perType: { player: 1, spawn: 1 } });
    expect(rt.scene()?.entities.map((e) => e.id)).toEqual(["floor", "~spawn:0", "player#1"]);
    expect(rt.ctx.query.byType("player")).toEqual(["player#1"]);
    const [handle] = rt.ctx.tags.handlesOf("player#1");
    expect(rt.ctx.tags.get(handle!)).toEqual({ entityId: "player#1", type: "player" });
    rt.destroy();
  });

  it("keeps its feet in the pose index as it moves", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    // Rapier holds the body's centre as a 32-bit float, so the feet come back within a micrometre.
    const start = rt.ctx.poses.get("player#1")!;
    expect([start.x, start.rot]).toEqual([0, 0]);
    expect(start.y).toBeCloseTo(0, 6);
    steps(rt, 20, [press("move_right")]);
    const { position } = player(rt);
    expect(position.x).toBeGreaterThan(0);
    expect(rt.ctx.poses.get("player#1")).toEqual({
      x: position.x,
      y: position.y + PLAYER_HEIGHT / 2,
      rot: 0,
    });
    rt.destroy();
  });

  it("spawns at Play's start, and again as player#1 after a reload", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    expect(rt.load(scene([floor, spawnAt([0, 0])]), { at: { x: 2, y: -1 } })).toMatchObject({
      ok: true,
    });
    const [x, y] = rt.ctx.get("player#1")!.at as Pt;
    expect(x).toBe(2);
    expect(y).toBeCloseTo(0, 6);
    expect(rt.stats().perType.player).toBe(1);
    rt.destroy();
  });

  it("stays one actor when its own runtime scene is loaded back", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    const fresh = rt.stats();
    expect(rt.load(rt.scene()!).ok).toBe(true);
    expect(rt.stats()).toEqual({ ...fresh, behaviors: rt.stats().behaviors });
    expect(rt.scene()?.entities.filter((e) => e.type === "player")).toHaveLength(1);
    rt.destroy();
  });

  it("is spawn-only: a scene can't place it", () => {
    const registry = createRegistry(platformerGame);
    expect(isSpawnOnly(registry, "player")).toBe(true);
    expect(placeableTypes(registry)).not.toContain("player");
    const placed = parseScene(
      JSON.stringify({
        v: 3,
        name: "t",
        game: "platformer",
        bounds: [0, 0, 100, 100],
        entities: [{ id: "p", type: "player", at: [0, 0] }],
      }),
      registry,
    );
    expect(placed.ok).toBe(false);
    if (!placed.ok)
      expect(placed.issues).toContainEqual(expect.objectContaining({ code: "unknown-type" }));
  });

  it("is gone from the table and the world once game code destroys it", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    rt.step(DT, []);
    const bodies = rt.stats().bodies;
    rt.ctx.destroy("player#1");
    expect(rt.ctx.exists("player#1")).toBe(false);
    expect(rt.stats()).toMatchObject({ bodies: bodies - 1, perType: { spawn: 1 } });
    expect(rt.stats().perType.player).toBeUndefined();
    expect(rt.step(DT, []).game).toMatchObject({ position: { x: 0, y: 0 }, grounded: false });
    expect(rt.game?.cameraTarget?.()).toBeNull();
    rt.destroy();
  });

  it("leaves nothing behind at unload", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    rt.step(DT, []);
    rt.unload();
    expect(rt.stats()).toMatchObject({ bodies: 0, colliders: 0, tags: 0, entities: 0 });
    expect(rt.stats().perType).toEqual({});
    rt.destroy();
  });
});

describe("clouds", () => {
  const cloud: RuntimeEntity = { id: "puff", type: TYPE.cloud, shape: box(0, -1, 0.6, 0.06) };

  it("hold the player on top and let it drop through on move_down", () => {
    const rt = runtime(scene([floor, cloud, spawnAt([0, -1.06])]));
    steps(rt, 10);
    expect(player(rt)).toMatchObject({ grounded: true, groundId: "puff" });
    steps(rt, 60, [press("move_down")]);
    expect(player(rt)).toMatchObject({ grounded: true, groundId: "floor" });
    rt.destroy();
  });

  it("pass the player up from below", () => {
    const rt = runtime(scene([floor, cloud, spawnAt([0, 0])]));
    rt.step(DT, []);
    expect(rt.ctx.system<SolidSystem>(TYPE.cloud)?.isHidden("puff")).toBe(true);
    rt.destroy();
  });
});

describe("movers", () => {
  const lift: RuntimeEntity = {
    id: "lift",
    type: TYPE.mover,
    shape: box(0, 0, 0.4, 0.06),
    path: {
      pts: [
        [0, -1],
        [0, -3],
      ],
      mode: "ping_pong",
      speed: 0.6,
    },
  };

  it("move along their path and report the frame's delta", () => {
    const rt = runtime(scene([lift]));
    steps(rt, 60);
    const movers = rt.ctx.system<FollowerSystem>(TYPE.mover)!;
    expect(movers.position("lift")?.y).toBeCloseTo(-1.6, 2);
    expect(movers.frameDelta("lift")?.y).toBeCloseTo(-0.01, 6);
    rt.destroy();
  });

  it("carry a rider", () => {
    const rt = runtime(scene([lift, spawnAt([0, -1.06])]));
    steps(rt, 120);
    const top = rt.ctx.system<FollowerSystem>(TYPE.mover)!.position("lift")!.y - 0.06;
    expect(top).toBeLessThan(-2);
    expect(player(rt)).toMatchObject({ grounded: true, groundId: "lift" });
    // One frame behind the lift on its way up
    expect(Math.abs(player(rt).position.y - (top - PLAYER_HEIGHT / 2))).toBeLessThanOrEqual(0.015);
    rt.destroy();
  });
});

describe("constructs and anchors", () => {
  it("pre-placed constructs register wind, impulses and anchors", () => {
    const rt = runtime(
      scene([
        { id: "~anchor:0", type: TYPE.anchor, at: [0.5, -4] },
        { id: "gust", type: TYPE.construct, construct: "wind_zone", at: [0, -2] },
        { id: "pad", type: TYPE.construct, construct: "bounce_pad", at: [1, 0], rot: 0 },
        { id: "hook", type: TYPE.construct, construct: "grapple_anchor", at: [0, -4] },
      ]),
    );
    const constructs = rt.ctx.system<ConstructSystem>(TYPE.construct)!;
    const anchors = rt.ctx.system<GrappleAnchorSystem>(TYPE.anchor)!;
    expect(rt.stats().perType).toMatchObject({ construct: 3, anchor: 2 });
    const [pad] = rt.ctx.tags.handlesOf("pad");
    expect(rt.ctx.tags.get(pad)).toEqual({
      entityId: "pad",
      type: "construct",
      impulse: { x: 0, y: -6.5 },
    });
    expect(constructs.forces.sample({ x: 0, y: -2 })).toEqual({ x: 0, y: -8 });
    expect(anchors.getAnchors().map((a) => [a.id, a.source])).toEqual([
      ["~anchor:0", "scene"],
      ["hook", "scene"],
    ]);
    rt.destroy();
  });

  it("clearing runtime placements keeps the scene's own", () => {
    const rt = runtime(scene([{ id: "~anchor:0", type: TYPE.anchor, at: [0, 0] }]));
    const constructs = rt.ctx.system<ConstructSystem>(TYPE.construct)!;
    const anchors = rt.ctx.system<GrappleAnchorSystem>(TYPE.anchor)!;
    const placed = constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    constructs.place("grapple_anchor", { x: 0.1, y: 0 }, 0);
    anchors.add("dropped", { x: 0.2, y: 0 }, "runtime");
    expect(constructs.get(placed)?.source).toBe("runtime");
    expect(anchors.size()).toBe(3);

    constructs.clearRuntime();
    anchors.clearRuntime();
    expect(anchors.getAnchors().map((a) => a.id)).toEqual(["~anchor:0"]);
    expect(constructs.forces.size).toBe(0);
    expect(rt.stats()).toMatchObject({ bodies: 0, tags: 0 });
    rt.destroy();
  });

  it("removes one wind zone without disturbing another at the same spot", () => {
    const rt = runtime(scene([]));
    const constructs = rt.ctx.system<ConstructSystem>(TYPE.construct)!;
    const a = constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    constructs.despawn(a);
    expect(constructs.forces.size).toBe(1);
    rt.destroy();
  });

  it("blow the player with wind", () => {
    const calm = runtime(scene([spawnAt([0, -1])]));
    const windy = runtime(
      scene([
        spawnAt([0, -1]),
        { id: "gust", type: TYPE.construct, construct: "wind_zone", at: [0, -1.3] },
      ]),
    );
    calm.step(DT, []);
    windy.step(DT, []);
    expect(player(windy).velocity.y).toBeCloseTo(player(calm).velocity.y - 8 / 60, 9);
    calm.destroy();
    windy.destroy();
  });
});
