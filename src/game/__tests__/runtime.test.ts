import { beforeAll, describe, expect, it } from "vite-plus/test";

import { PLAYER_HEIGHT } from "../entities/player";
import { createSceneRuntime } from "../runtime/runtime";
import type { RuntimeStats } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { InputAction, RapierModule } from "../types";
import { testYard } from "./fixtures/test-yard.expanded";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

function runtime() {
  return createSceneRuntime({ rapier, view: null });
}

function scene(entities: RuntimeEntity[], spawn: ExpandedScene["spawn"] = []): ExpandedScene {
  return { name: "t", bounds: [-1000, -1000, 1000, 1000], spawn, entities };
}

const floor: RuntimeEntity = {
  id: "floor",
  b: "solid",
  shape: { type: "box", cx: 0, cy: 20, hw: 500, hh: 20, rotDeg: 0 },
};

const EMPTY: RuntimeStats = {
  bodies: 0,
  colliders: 0,
  tags: 0,
  fields: 0,
  entities: 0,
  perBehavior: {},
};

function press(action: string, tick = 0): InputAction {
  return { action, pressed: true, tick, timestamp: 0 };
}

describe("SceneRuntime load and unload", () => {
  it("loads test-yard with every behavior counted", () => {
    const rt = runtime();
    const report = rt.load(testYard());
    expect(report).toEqual({
      ok: true,
      counts: { solid: 17, cloud: 3, sensor: 3, prop: 2, mover: 3, anchor: 4 },
      ms: 0,
    });
    // 28 bodies with one collider each, plus the player
    expect(rt.stats()).toEqual({
      bodies: 29,
      colliders: 29,
      tags: 29,
      fields: 0,
      entities: 32,
      perBehavior: { solid: 17, cloud: 3, sensor: 3, prop: 2, mover: 3, anchor: 4 },
    });
    expect(rt.get("elevator")?.b).toBe("mover");
    expect(rt.get("~solid:ice:0")).toMatchObject({ material: "ice" });
    rt.destroy();
  });

  it("unload empties every table, and the scene loads again", () => {
    const rt = runtime();
    rt.load(testYard());
    const loaded = rt.stats();
    for (let i = 0; i < 30; i++) rt.step(DT, i === 0 ? [press("move_right")] : []);

    rt.unload();
    expect(rt.stats()).toEqual(EMPTY);
    expect(rt.get("elevator")).toBeUndefined();
    expect(rt.step(DT, []).events).toEqual([]);

    expect(rt.load(testYard()).ok).toBe(true);
    expect(rt.stats()).toEqual(loaded);
    rt.destroy();
  });

  it("rejects duplicate ids before touching the current scene", () => {
    const rt = runtime();
    rt.load(testYard());
    const before = rt.stats();
    const report = rt.load(scene([floor, { ...floor }]));
    expect(report).toEqual({ ok: false, error: 'duplicate entity id "floor"', entityId: "floor" });
    expect(rt.stats()).toEqual(before);
    rt.destroy();
  });

  it("reports the entity that failed to spawn and leaves the runtime empty", () => {
    const rt = runtime();
    const report = rt.load(
      scene([
        floor,
        {
          id: "stuck",
          b: "mover",
          shape: { type: "box", cx: 0, cy: 0, hw: 10, hh: 5, rotDeg: 0 },
          path: { pts: [[0, 0]], mode: "loop", speed: 10 },
        },
      ]),
    );
    expect(report).toMatchObject({ ok: false, entityId: "stuck" });
    expect(rt.stats()).toEqual(EMPTY);
    rt.destroy();
  });

  it("two runtimes alive at once share no state", () => {
    const a = runtime();
    const b = runtime();
    a.load(testYard());
    b.load(scene([floor], [[0, 0]]));
    expect(a.stats().tags).toBe(29);
    expect(b.stats().tags).toBe(2);

    a.unload();
    expect(a.stats()).toEqual(EMPTY);
    expect(b.stats()).toMatchObject({ bodies: 2, tags: 2, entities: 1 });
    expect(b.step(DT, []).player.groundId).toBe("floor");
    a.destroy();
    b.destroy();
  });

  it("an empty scene has no player", () => {
    const rt = runtime();
    rt.load(scene([floor]));
    const result = rt.step(DT, []);
    expect(result.player.grounded).toBe(false);
    expect(result.events).toEqual([]);
    rt.destroy();
  });
});

describe("SceneRuntime step", () => {
  it("puts the player's feet on the spawn point and lands on tick 0", () => {
    const rt = runtime();
    rt.load(testYard());
    const first = rt.step(DT, []);
    expect(first.tick).toBe(0);
    expect(first.player.grounded).toBe(true);
    expect(first.player.position.y).toBeCloseTo(1020 - PLAYER_HEIGHT / 2, 0);
    expect(first.events).toEqual([
      { tick: 0, type: "landed", entityId: "~solid:0", at: first.player.position },
    ]);
    expect(rt.step(DT, []).tick).toBe(1);
    rt.destroy();
  });

  it("names sensors by entity id when the player enters them", () => {
    const rt = runtime();
    rt.load(
      scene(
        [
          floor,
          {
            id: "goal",
            b: "sensor",
            kind: "goal",
            shape: { type: "circle", cx: 0, cy: -30, r: 12 },
          },
        ],
        [[0, 0]],
      ),
    );
    const events = [rt.step(DT, []), rt.step(DT, []), rt.step(DT, [])].flatMap((r) => r.events);
    expect(events.filter((e) => e.type === "cheese")).toEqual([
      expect.objectContaining({ entityId: "goal" }),
    ]);
    rt.destroy();
  });

  it("lets the player fall through sensors onto the ground below", () => {
    const rt = runtime();
    rt.load(
      scene(
        [
          floor,
          {
            id: "lava",
            b: "sensor",
            kind: "hazard",
            shape: { type: "box", cx: 0, cy: -100, hw: 50, hh: 8, rotDeg: 0 },
          },
        ],
        [[0, -200]],
      ),
    );
    const results = Array.from({ length: 120 }, () => rt.step(DT, []));
    const events = results.flatMap((r) => r.events);
    expect(events.filter((e) => e.type === "lava")).toEqual([
      expect.objectContaining({ entityId: "lava" }),
    ]);
    const last = results.at(-1)!.player;
    expect(last.grounded).toBe(true);
    expect(last.groundId).toBe("floor");
    rt.destroy();
  });

  it.each([
    ["counter-clockwise", false],
    ["clockwise", true],
  ])("stands on a poly listed %s on screen", (_, reversed) => {
    const pts: [number, number][] = [
      [-500, 0],
      [-500, 40],
      [500, 40],
      [500, 0],
    ];
    const rt = runtime();
    rt.load(
      scene(
        [{ id: "floor", b: "solid", shape: { type: "poly", pts: reversed ? pts.reverse() : pts } }],
        [[0, -50]],
      ),
    );
    const results = Array.from({ length: 120 }, () => rt.step(DT, []));
    const last = results.at(-1)!.player;
    expect(last.grounded).toBe(true);
    expect(last.groundId).toBe("floor");
    expect(last.position.y).toBeCloseTo(-PLAYER_HEIGHT / 2, 0);
    rt.destroy();
  });

  it("reports left-ground with the surface the player jumped from", () => {
    const rt = runtime();
    rt.load(scene([floor], [[0, 0]]));
    rt.step(DT, []);
    const events = [rt.step(DT, [press("jump", 1)])].concat(
      Array.from({ length: 5 }, () => rt.step(DT, [])),
    );
    expect(events.flatMap((r) => r.events).map((e) => [e.type, e.entityId])).toContainEqual([
      "left-ground",
      "floor",
    ]);
    rt.destroy();
  });

  it("leaves props at their authored pose after load and simulates them", () => {
    const rt = runtime();
    rt.load(testYard());
    const ball = () =>
      rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("ball")[0])!.parent()!.translation();
    expect(ball()).toEqual({ x: 780, y: 900 });
    for (let i = 0; i < 30; i++) rt.step(DT, []);
    // The ball rests on the stair it slightly overlaps
    expect(Number.isFinite(ball().y)).toBe(true);
    expect(ball().y).not.toBe(900);
    expect(Math.abs(ball().y - 900)).toBeLessThan(20);
    rt.destroy();
  });

  it("moves movers along their path while stepping", () => {
    const rt = runtime();
    rt.load(
      scene([
        {
          id: "lift",
          b: "mover",
          shape: { type: "box", cx: 0, cy: 0, hw: 20, hh: 5, rotDeg: 0 },
          path: {
            pts: [
              [0, 0],
              [0, -300],
            ],
            mode: "ping_pong",
            speed: 60,
          },
        },
      ]),
    );
    for (let i = 0; i < 60; i++) rt.step(DT, []);
    const body = rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("lift")[0])!.parent()!;
    expect(body.translation().y).toBeCloseTo(-60, 0);
    rt.destroy();
  });
});

describe("constructs and anchors", () => {
  it("pre-placed constructs register fields, impulses and anchors", () => {
    const rt = runtime();
    rt.load(
      scene([
        { id: "gust", b: "construct", type: "wind_zone", at: [0, -200], rot: 0 },
        { id: "pad", b: "construct", type: "bounce_pad", at: [100, 0], rot: 0 },
        { id: "hook", b: "construct", type: "grapple_anchor", at: [0, -400], rot: 0 },
        { id: "~anchor:0", b: "anchor", at: [50, -400] },
      ]),
    );
    expect(rt.stats()).toMatchObject({ fields: 1, perBehavior: { construct: 3, anchor: 2 } });
    const [pad] = rt.ctx.tags.handlesOf("pad");
    expect(rt.ctx.tags.get(pad)?.impulse).toEqual({ y: -650 });
    expect(rt.ctx.fields.sample({ x: 0, y: -200 })).toEqual({ x: 0, y: -800 });
    expect(rt.anchors.getAnchors().map((a) => [a.id, a.source])).toEqual([
      ["~anchor:0", "scene"],
      ["hook", "scene"],
    ]);
    rt.destroy();
  });

  it("clearing runtime placements keeps the scene's own", () => {
    const rt = runtime();
    rt.load(scene([{ id: "~anchor:0", b: "anchor", at: [0, 0] }]));
    const placed = rt.constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    rt.constructs.place("grapple_anchor", { x: 10, y: 0 }, 0);
    rt.anchors.add("dropped", { x: 20, y: 0 }, "runtime");
    expect(rt.constructs.get(placed)?.source).toBe("runtime");
    expect(rt.anchors.size()).toBe(3);

    rt.constructs.clearRuntime();
    rt.anchors.clearRuntime();
    expect(rt.anchors.getAnchors().map((a) => a.id)).toEqual(["~anchor:0"]);
    expect(rt.stats()).toMatchObject({ bodies: 0, fields: 0, tags: 0 });
    rt.destroy();
  });

  it("removes one wind zone without disturbing another at the same spot", () => {
    const rt = runtime();
    rt.load(scene([]));
    const a = rt.constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    rt.constructs.place("wind_zone", { x: 0, y: 0 }, 0);
    rt.constructs.despawn(a);
    expect(rt.ctx.fields.size).toBe(1);
    rt.destroy();
  });
});
