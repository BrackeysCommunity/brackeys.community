import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../game/behaviors";
import { defineEntityType, defineGame } from "../game/define";
import { assetField, pointField } from "../game/fields";
import type { EngineContext, FieldEnv, GameDefinition, SceneSystem } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { RapierModule } from "../types";
import { recordingView } from "./fixtures/recording-view";
import { GLOW, SPIN, testGame, type TestGameSnapshot } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const TICK = "test-game/tick";
const PLAIN = "test-game/plain";
const SHADE = "test-game/shade";
const BOOM = "test-game/boom";
const TICKED = "test-game/ticked";
const SKIN = "test-game/skin";
const DECAL = "test-game/decal";
const BRITTLE = "test-game/brittle";

/**
 * The test game plus logging behaviors and a logging `probe` type, all
 * writing to one log: a stepping behavior with every hook, one with no
 * `update`, a visual-only one, one that throws on attach when asked, and
 * one naming a texture that throws when `breaks` says so.
 */
function loggingGame() {
  const log: string[] = [];
  const breaks = { update: false, attach: false };

  const probe = defineEntityType({
    type: "probe",
    description: "A point that logs what its system does.",
    fields: { at: pointField("Where it stands.") },
    system: (): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void (log.push(`spawn ${e.id}`), live.add(e.id)),
        despawn: (id) => void (live.delete(id) && log.push(`despawn ${id}`)),
        update: (e) => void log.push(`type-update ${e.id}`),
        clear: () => live.clear(),
        size: () => live.size,
        beforeStep: () => void log.push("type:beforeStep"),
        afterStep: () => void log.push("type:afterStep"),
        seek: (ms) => void log.push(`type:seek ${ms}`),
      };
    },
  });

  const logging = (name: string, ctx: EngineContext, withUpdate: boolean): BehaviorSystem => {
    const short = name.slice("test-game/".length);
    const live = new Map<string, unknown>();
    const system: BehaviorSystem = {
      attach(id, block) {
        const pose = ctx.poses.get(id);
        log.push(`attach ${short} ${id} ${JSON.stringify(block)} pose=${pose?.x},${pose?.y}`);
        live.set(id, block);
      },
      detach(id) {
        if (live.delete(id)) log.push(`detach ${short} ${id}`);
      },
      clear: () => live.clear(),
      size: () => live.size,
    };
    if (withUpdate) {
      system.update = (id, block, prev) => {
        log.push(`update ${short} ${id} ${JSON.stringify(prev)}->${JSON.stringify(block)}`);
        live.set(id, block);
      };
      system.step = () => {
        log.push(`step ${short}`);
        ctx.emit({ type: TICKED, at: { x: 0, y: 0 } });
      };
      system.reset = () => void log.push(`reset ${short}`);
      system.seek = (ms) => void log.push(`seek ${short} ${ms}`);
    }
    return system;
  };

  const tick = defineBehavior({
    name: TICK,
    description: "Logs every hook.",
    fields: { n: z.number().default(0).describe("A number.") },
    system: (ctx) => logging(TICK, ctx, true),
  });
  const plain = defineBehavior({
    name: PLAIN,
    description: "Logs attach and detach; has no update.",
    fields: { n: z.number().default(0).describe("A number.") },
    system: (ctx) => logging(PLAIN, ctx, false),
  });
  const shade = defineBehavior({
    name: SHADE,
    description: "Draws a shade over the entity.",
    fields: {},
    visualOnly: true,
    system: (ctx) => ({
      ...logging(SHADE, ctx, false),
      render: (alpha) => void log.push(`render shade ${alpha}`),
    }),
  });
  const boom = defineBehavior({
    name: BOOM,
    description: "Throws on attach when `fail` is set.",
    fields: { fail: z.boolean().default(false).describe("Throw on attach.") },
    system: (ctx) => {
      const inner = logging(BOOM, ctx, false);
      return {
        ...inner,
        attach(id, block, e) {
          if (block.fail) throw new Error(`boom on ${id}`);
          inner.attach(id, block, e);
        },
      };
    },
  });

  const art = (env: FieldEnv) => ({
    art: assetField(env, "texture", "The texture it draws.").optional(),
    n: z.number().default(0).describe("A number."),
  });
  const skin = defineBehavior({
    name: SKIN,
    description: "Names a texture; has an update.",
    fields: art,
    system: (ctx) => ({
      ...logging(SKIN, ctx, false),
      update: (id, block, prev) =>
        void log.push(`update skin ${id} ${JSON.stringify(prev)}->${JSON.stringify(block)}`),
    }),
  });
  const decal = defineBehavior({
    name: DECAL,
    description: "Names a texture; has no update.",
    fields: art,
    system: (ctx) => logging(DECAL, ctx, false),
  });

  const brittle = defineBehavior({
    name: BRITTLE,
    description: "Names a texture; throws on update or attach as `breaks` says.",
    fields: art,
    system: (ctx) => {
      const inner = logging(BRITTLE, ctx, false);
      return {
        ...inner,
        attach(id, block, e) {
          if (breaks.attach) throw new Error(`attach broke on ${id}`);
          inner.attach(id, block, e);
        },
        update(id) {
          if (breaks.update) throw new Error(`update broke on ${id}`);
          log.push(`update brittle ${id}`);
        },
      };
    },
  });

  const game: GameDefinition<TestGameSnapshot> = defineGame<TestGameSnapshot>({
    ...(testGame as GameDefinition<TestGameSnapshot>),
    types: [...testGame.types, probe],
    behaviors: [GLOW, SPIN, tick, plain, shade, boom, skin, decal, brittle],
    createRuntime(ctx) {
      const inner = testGame.createRuntime(ctx);
      return {
        ...inner,
        beforeStep(dtMs, actions) {
          log.push("game:beforeStep");
          inner.beforeStep?.(dtMs, actions);
        },
        afterStep(dtMs, events) {
          log.push(`game:afterStep ${events.map((e) => e.type).join(",")}`);
          inner.afterStep?.(dtMs, events);
        },
      };
    },
  });
  return { game, log, breaks };
}

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "t",
    bounds: [-1000, -1000, 1000, 1000],
    settings: {
      gravity: [0, 0],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

const probe = (
  id: string,
  behaviors: Record<string, Record<string, unknown>>,
  at: [number, number] = [1, 2],
): RuntimeEntity => ({ id, type: "probe", at, behaviors });

function setup(withView = false) {
  const { game, log, breaks } = loggingGame();
  const view = withView ? recordingView().view : null;
  const rt = createSceneRuntime({ rapier, view, game });
  return { rt, log, breaks };
}

describe("behavior host", () => {
  it("attaches after the type spawn and its pose, in registration order", () => {
    const { rt, log } = setup();
    const report = rt.load(
      scene([probe("a", { [PLAIN]: { n: 1 }, [TICK]: { n: 2 } }), probe("b", { [TICK]: {} })]),
    );
    expect(report.ok).toBe(true);
    expect(log).toEqual([
      "spawn a",
      'attach tick a {"n":2} pose=1,2',
      'attach plain a {"n":1} pose=1,2',
      "spawn b",
      "attach tick b {} pose=1,2",
      "reset tick",
    ]);
    expect(rt.stats().behaviors).toEqual({ [TICK]: 2, [PLAIN]: 1 });
    rt.destroy();
  });

  it("steps after the type systems' afterStep and before the game's, which sees its events", () => {
    const { rt, log } = setup();
    rt.load(scene([probe("a", { [TICK]: {} })]));
    log.length = 0;
    const result = rt.step(DT, []);
    expect(log).toEqual([
      "type:beforeStep",
      "game:beforeStep",
      "type:afterStep",
      "step tick",
      `game:afterStep ${TICKED}`,
    ]);
    expect(result.events.map((e) => e.type)).toEqual([TICKED]);
    rt.destroy();
  });

  it("detaches in reverse order before the type despawns, on remove and unload", () => {
    const { rt, log } = setup();
    rt.load(
      scene([probe("a", { [TICK]: {}, [PLAIN]: {} }), probe("b", { [TICK]: {}, [PLAIN]: {} })]),
    );
    log.length = 0;
    rt.remove(["a"]);
    expect(log).toEqual(["detach plain a", "detach tick a", "despawn a"]);
    expect(rt.ctx.poses.has("a")).toBe(false);
    log.length = 0;
    rt.unload();
    expect(log).toEqual(["detach plain b", "detach tick b"]);
    expect(rt.stats().behaviors).toEqual({});
    rt.destroy();
  });

  it("updates, attaches and detaches each block as an update changes it", () => {
    const { rt, log } = setup();
    rt.load(scene([probe("a", { [TICK]: { n: 1 }, [PLAIN]: { n: 1 } }), probe("b", {})]));
    log.length = 0;

    expect(rt.update([probe("a", { [TICK]: { n: 2 }, [PLAIN]: { n: 2 } })])).toEqual({ ok: true });
    expect(log).toEqual([
      "type-update a",
      'update tick a {"n":1}->{"n":2}',
      "detach plain a",
      'attach plain a {"n":2} pose=1,2',
    ]);

    log.length = 0;
    expect(rt.update([probe("a", { [PLAIN]: { n: 2 } }), probe("b", { [TICK]: {} })])).toEqual({
      ok: true,
    });
    expect(log).toEqual([
      "type-update a",
      "detach tick a",
      "detach plain a",
      'attach plain a {"n":2} pose=1,2',
      "type-update b",
      "attach tick b {} pose=1,2",
    ]);
    expect(rt.stats().behaviors).toEqual({ [TICK]: 1, [PLAIN]: 1 });
    rt.destroy();
  });

  it("detaches before and attaches after a type change", () => {
    const { rt, log } = setup();
    rt.load(scene([probe("a", { [TICK]: {} })]));
    log.length = 0;
    const lamp: RuntimeEntity = { id: "a", type: "lamp", at: [5, 6], behaviors: { [TICK]: {} } };
    expect(rt.update([lamp])).toEqual({ ok: true });
    expect(log).toEqual(["detach tick a", "despawn a", "attach tick a {} pose=5,6"]);
    rt.destroy();
  });

  it("a throwing attach rolls load, add and update back", () => {
    const { rt, log } = setup();
    expect(
      rt.load(scene([probe("a", { [TICK]: {} }), probe("x", { [BOOM]: { fail: true } })])),
    ).toMatchObject({ ok: false, error: "boom on x", entityId: "x" });
    expect(log).toContain("detach tick a");
    expect(rt.stats()).toMatchObject({ entities: 0, perType: {}, behaviors: {} });
    expect(rt.ctx.poses.size).toBe(0);

    rt.load(scene([probe("a", { [TICK]: { n: 1 } })]));
    const before = rt.stats();
    log.length = 0;
    expect(
      rt.add([
        probe("b", { [TICK]: {}, [PLAIN]: {} }),
        probe("c", { [TICK]: {}, [BOOM]: { fail: true } }),
      ]),
    ).toMatchObject({ ok: false, entityId: "c" });
    expect(log).toEqual([
      "spawn b",
      "attach tick b {} pose=1,2",
      "attach plain b {} pose=1,2",
      "spawn c",
      "attach tick c {} pose=1,2",
      "detach tick c",
      "despawn c",
      "detach plain b",
      "detach tick b",
      "despawn b",
    ]);
    expect(rt.stats()).toEqual(before);
    expect(rt.ctx.poses.has("b")).toBe(false);

    log.length = 0;
    const failing = probe("a", { [TICK]: { n: 2 }, [BOOM]: { fail: true } }, [3, 4]);
    expect(rt.update([failing])).toMatchObject({ ok: false, entityId: "a" });
    expect(rt.stats()).toEqual(before);
    expect(rt.get("a")?.behaviors).toEqual({ [TICK]: { n: 1 } });
    expect(rt.ctx.behavior<BehaviorSystem>(TICK)?.size()).toBe(1);
    expect(log.at(-1)).toBe('attach tick a {"n":1} pose=1,2');
    expect(rt.ctx.poses.get("a")).toMatchObject({ x: 1, y: 2 });
    rt.destroy();
  });

  it("builds a visual-only behavior only with a view, and renders it", () => {
    const headless = setup();
    headless.rt.load(scene([probe("a", { [SHADE]: {} })]));
    expect(headless.rt.ctx.behavior(SHADE)).toBeUndefined();
    expect(headless.rt.stats().behaviors).toEqual({});
    headless.rt.render(0.5);
    expect(headless.log.some((l) => l.includes("shade"))).toBe(false);
    headless.rt.destroy();

    const viewed = setup(true);
    viewed.rt.load(scene([probe("a", { [SHADE]: {} })]));
    expect(viewed.rt.ctx.behavior(SHADE)).toBeDefined();
    expect(viewed.rt.stats().behaviors).toEqual({ [SHADE]: 1 });
    viewed.rt.render(0.25);
    expect(viewed.log.at(-1)).toBe("render shade 0.25");
    viewed.rt.destroy();
  });

  it("looks up built systems and builds nothing for a data-only behavior", () => {
    const { rt } = setup();
    expect(rt.ctx.behavior(GLOW.name)).toBeUndefined();
    expect(rt.ctx.behavior(TICK)).toBeDefined();
    expect(rt.ctx.behavior(TICK)).toBe(rt.ctx.behavior(TICK));
    rt.load(scene([probe("a", { [GLOW.name]: { intensity: 1 }, [SPIN.name]: { speed: 5 } })]));
    expect(rt.stats().behaviors).toEqual({ [SPIN.name]: 1 });
    rt.destroy();
  });

  it("seeks behaviors after the type systems on a timeOffsetMs load, after reset", () => {
    const { rt, log } = setup();
    expect(rt.load(scene([probe("a", { [TICK]: {} })]), { timeOffsetMs: 500 }).ok).toBe(true);
    expect(log).toEqual([
      "spawn a",
      "attach tick a {} pose=1,2",
      "reset tick",
      "type:seek 500",
      "seek tick 500",
    ]);
    log.length = 0;
    rt.load(scene([probe("a", { [TICK]: {} })]));
    expect(log).not.toContain("seek tick 0");
    expect(log.at(-1)).toBe("reset tick");
    rt.destroy();
  });

  it("reloads only the blocks whose asset fields name a changed id, keeping the runtime's tick", () => {
    const { rt, log } = setup();
    rt.load(
      scene([
        probe("a", { [SKIN]: { art: "crate" }, [TICK]: { n: 1 } }),
        probe("b", { [DECAL]: { art: "crate", n: 2 } }),
        probe("c", { [SKIN]: { art: "rock" } }),
        probe("d", { [TICK]: {} }),
      ]),
    );
    rt.step(DT, []);
    rt.update([probe("c", { [SKIN]: { art: "crate", n: 3 } }, [7, 8])]);
    const tick = rt.ctx.tick;
    log.length = 0;
    rt.reloadAssets(null, ["crate"]);
    expect(log).toEqual([
      'update skin a {"art":"crate"}->{"art":"crate"}',
      "detach decal b",
      'attach decal b {"art":"crate","n":2} pose=1,2',
      'update skin c {"art":"crate","n":3}->{"art":"crate","n":3}',
    ]);
    log.length = 0;
    rt.reloadAssets(null, ["moss"]);
    rt.reloadAssets(null, []);
    expect(log).toEqual([]);
    rt.remove(["a"]);
    log.length = 0;
    rt.reloadAssets(null, ["crate"]);
    expect(log.some((l) => l.includes(" a "))).toBe(false);
    expect(rt.ctx.tick).toBe(tick);
    rt.destroy();
  });

  it("keeps redrawing past an entity whose reload throws, reattaching it and reporting it", () => {
    const { rt, log, breaks } = setup();
    rt.load(
      scene([
        probe("a", { [SKIN]: { art: "crate" } }),
        probe("b", { [BRITTLE]: { art: "crate" }, [TICK]: { n: 1 } }),
        probe("c", { [DECAL]: { art: "crate" } }),
      ]),
    );
    log.length = 0;
    breaks.update = true;
    expect(rt.reloadAssets(null, ["crate"])).toEqual([
      { entityId: "b", error: "update broke on b", reattached: true },
    ]);
    expect(log).toEqual([
      'update skin a {"art":"crate"}->{"art":"crate"}',
      "detach brittle b",
      "detach tick b",
      'attach tick b {"n":1} pose=1,2',
      'attach brittle b {"art":"crate"} pose=1,2',
      "detach decal c",
      'attach decal c {"art":"crate"} pose=1,2',
    ]);
    expect(rt.stats().behaviors).toEqual({ [SKIN]: 1, [BRITTLE]: 1, [TICK]: 1, [DECAL]: 1 });

    breaks.attach = true;
    log.length = 0;
    expect(rt.reloadAssets(null, ["crate"])).toEqual([
      { entityId: "b", error: "update broke on b", reattached: false },
    ]);
    expect(log.at(-1)).toBe('attach decal c {"art":"crate"} pose=1,2');
    expect(rt.stats().behaviors).toEqual({ [SKIN]: 1, [DECAL]: 1 });
    expect(rt.get("b")).toBeDefined();

    breaks.update = false;
    breaks.attach = false;
    log.length = 0;
    expect(rt.reloadAssets(null, ["crate"])).toEqual([]);
    expect(log.some((l) => l.includes(" b"))).toBe(false);
    rt.destroy();
  });
});

describe("sprites and the game's afterStep", () => {
  it("poses a sprite the game moved in afterStep in that same tick, before the commit", () => {
    const { game: base } = loggingGame();
    const order: string[] = [];
    const game: GameDefinition<TestGameSnapshot> = {
      ...base,
      createRuntime(ctx) {
        const inner = base.createRuntime(ctx);
        return {
          ...inner,
          afterStep(dtMs, events) {
            inner.afterStep?.(dtMs, events);
            const pose = ctx.poses.get("a")!;
            ctx.poses.set("a", pose.x + 5, pose.y, pose.rot);
            order.push(`game moved a to ${pose.x + 5}`);
          },
        };
      },
    };
    const { view, callsFor } = recordingView({ sprites: true });
    view.commit = (tick) => void order.push(`commit ${tick}`);
    const rt = createSceneRuntime({ rapier, view, game });
    expect(rt.load(scene([probe("a", { sprite: {} }, [10, 0])])).ok).toBe(true);
    const sid = "a#sprite";
    view.pose = ((pose) => (id, x, y, rot, snap) => {
      if (id === sid) order.push(`pose ${x}`);
      pose(id, x, y, rot, snap);
    })(view.pose.bind(view));

    rt.step(DT, []);
    rt.step(DT, []);
    rt.step(DT, []);
    expect(order).toEqual([
      "game moved a to 15",
      "pose 15",
      "commit 0",
      "game moved a to 20",
      "pose 20",
      "commit 1",
      "game moved a to 25",
      "pose 25",
      "commit 2",
    ]);
    expect(callsFor(sid, "pose").map((c) => (c.op === "pose" ? c.snap : null))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    rt.destroy();
  });
});
