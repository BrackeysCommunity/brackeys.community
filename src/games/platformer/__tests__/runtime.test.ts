import type { InputAction, RapierModule } from "@jams/engine";
import {
  createRegistry,
  type FollowerSystem,
  type SceneRuntimeHandle,
  type SolidSystem,
} from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import type { ExpandedScene, Pt, RuntimeEntity } from "@jams/engine/scene";
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

const floor: RuntimeEntity = { id: "floor", type: "solid", shape: box(0, 20, 500, 20) };
const spawnAt = (at: Pt): RuntimeEntity => ({ id: "~spawn:0", type: TYPE.spawn, at });

function scene(entities: RuntimeEntity[], gravity: Pt = [0, 1200]): ExpandedScene {
  return {
    name: "t",
    game: "platformer",
    bounds: [-1000, -1000, 1000, 1000],
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
    const rt = runtime(scene([floor, spawnAt([0, 0]), { ...spawnAt([300, 0]), id: "~spawn:1" }]));
    const first = rt.step(DT, []);
    const snap = first.game as PlayerSnapshot;
    expect(snap.grounded).toBe(true);
    expect(snap.groundId).toBe("floor");
    expect(snap.position.x).toBe(0);
    expect(snap.position.y).toBeCloseTo(-PLAYER_HEIGHT / 2, 0);
    expect(first.events).toEqual([
      { tick: 0, type: "landed", entityId: "floor", at: snap.position },
    ]);
    rt.destroy();
  });

  it("falls by the scene's gravity", () => {
    const fall = (gravity: Pt) => {
      const rt = runtime(scene([spawnAt([0, -500])], gravity));
      rt.step(DT, []);
      const vy = player(rt).velocity.y;
      rt.destroy();
      return vy;
    };
    expect(fall([0, 1200])).toBeCloseTo(1200 / 60, 6);
    expect(fall([0, 600])).toBeCloseTo(600 / 60, 6);
  });

  it("reports left-ground with the surface it jumped from", () => {
    const rt = runtime(scene([floor, spawnAt([0, 0])]));
    rt.step(DT, []);
    const events = steps(rt, 6, [press("jump")]).flatMap((r) => r.events);
    expect(events.map((e) => [e.type, e.entityId])).toContainEqual(["left-ground", "floor"]);
    rt.destroy();
  });

  it("enters sensors by id and falls through them onto the ground", () => {
    const lava: RuntimeEntity = { id: "lava", type: TYPE.hazard, shape: box(0, -100, 50, 8) };
    const rt = runtime(scene([floor, lava, spawnAt([0, -200])]));
    const results = steps(rt, 120);
    const entered = results.flatMap((r) => r.events).filter((e) => e.type === "sensor:enter");
    expect(entered).toEqual([expect.objectContaining({ entityId: "lava", other: "player" })]);
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

describe("clouds", () => {
  const cloud: RuntimeEntity = { id: "puff", type: TYPE.cloud, shape: box(0, -100, 60, 6) };

  it("hold the player on top and let it drop through on move_down", () => {
    const rt = runtime(scene([floor, cloud, spawnAt([0, -106])]));
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
    shape: box(0, 0, 40, 6),
    path: {
      pts: [
        [0, -100],
        [0, -300],
      ],
      mode: "ping_pong",
      speed: 60,
    },
  };

  it("move along their path and report the frame's delta", () => {
    const rt = runtime(scene([lift]));
    steps(rt, 60);
    const movers = rt.ctx.system<FollowerSystem>(TYPE.mover)!;
    expect(movers.position("lift")?.y).toBeCloseTo(-160, 0);
    expect(movers.frameDelta("lift")?.y).toBeCloseTo(-1, 6);
    rt.destroy();
  });

  it("carry a rider", () => {
    const rt = runtime(scene([lift, spawnAt([0, -106])]));
    steps(rt, 120);
    const top = rt.ctx.system<FollowerSystem>(TYPE.mover)!.position("lift")!.y - 6;
    expect(top).toBeLessThan(-200);
    expect(player(rt)).toMatchObject({ grounded: true, groundId: "lift" });
    // One frame behind the lift on its way up
    expect(Math.abs(player(rt).position.y - (top - PLAYER_HEIGHT / 2))).toBeLessThanOrEqual(1.5);
    rt.destroy();
  });
});

describe("constructs and anchors", () => {
  it("pre-placed constructs register wind, impulses and anchors", () => {
    const rt = runtime(
      scene([
        { id: "~anchor:0", type: TYPE.anchor, at: [50, -400] },
        { id: "gust", type: TYPE.construct, construct: "wind_zone", at: [0, -200] },
        { id: "pad", type: TYPE.construct, construct: "bounce_pad", at: [100, 0], rot: 0 },
        { id: "hook", type: TYPE.construct, construct: "grapple_anchor", at: [0, -400] },
      ]),
    );
    const constructs = rt.ctx.system<ConstructSystem>(TYPE.construct)!;
    const anchors = rt.ctx.system<GrappleAnchorSystem>(TYPE.anchor)!;
    expect(rt.stats().perType).toMatchObject({ construct: 3, anchor: 2 });
    const [pad] = rt.ctx.tags.handlesOf("pad");
    expect(rt.ctx.tags.get(pad)).toEqual({
      entityId: "pad",
      type: "construct",
      impulse: { x: 0, y: -650 },
    });
    expect(constructs.forces.sample({ x: 0, y: -200 })).toEqual({ x: 0, y: -800 });
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
    constructs.place("grapple_anchor", { x: 10, y: 0 }, 0);
    anchors.add("dropped", { x: 20, y: 0 }, "runtime");
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
    const calm = runtime(scene([spawnAt([0, -100])]));
    const windy = runtime(
      scene([
        spawnAt([0, -100]),
        { id: "gust", type: TYPE.construct, construct: "wind_zone", at: [0, -130] },
      ]),
    );
    calm.step(DT, []);
    windy.step(DT, []);
    expect(player(windy).velocity.y).toBeCloseTo(player(calm).velocity.y - 800 / 60, 6);
    calm.destroy();
    windy.destroy();
  });
});
