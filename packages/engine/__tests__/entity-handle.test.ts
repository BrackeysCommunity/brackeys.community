import { describe, expect, it } from "vite-plus/test";

import { BODY } from "../game/behaviors/body";
import { LIFETIME } from "../game/behaviors/lifetime";
import { SPRITE } from "../game/behaviors/sprite";
import type { Entity } from "../game/entity";
import { EngineError } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DISABLED, type StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import { testGame } from "./fixtures/test-game";

const marker = (id: string, extra: Partial<RuntimeEntity> = {}): RuntimeEntity => ({
  id,
  type: "marker",
  at: [1, 2],
  ...extra,
});

const ENTITIES = (): RuntimeEntity[] => [
  marker("a", { tags: ["spawn", "red"], behaviors: { lifetime: { ticks: 600 } } }),
  marker("b"),
];

function scene(entities: RuntimeEntity[] = ENTITIES()): ExpandedScene {
  return {
    name: "handles",
    bounds: [-20, -20, 20, 20],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

function setup(entities?: RuntimeEntity[]) {
  const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
  expect(rt.load(scene(entities))).toMatchObject({ ok: true });
  const step = (n = 1) => {
    const events: StepEvent[] = [];
    for (let i = 0; i < n; i++) events.push(...rt.step(rt.ctx.time.tickMs, []).events);
    return events;
  };
  return { rt, ctx: rt.ctx, step };
}

const gone = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("entity-gone");
    return;
  }
  throw new Error("expected entity-gone");
};

/** Every member but `id` and `alive`, each read or called once. */
const MEMBERS: Readonly<Record<string, (e: Entity) => unknown>> = {
  type: (e) => e.type,
  record: (e) => e.record,
  pose: (e) => e.pose,
  setPose: (e) => e.setPose(0, 0),
  hasTag: (e) => e.hasTag("spawn"),
  enabled: (e) => e.enabled,
  enabledSelf: (e) => e.enabledSelf,
  setEnabled: (e) => e.setEnabled(true),
  destroy: (e) => e.destroy(),
  getBehavior: (e) => e.getBehavior(LIFETIME),
  behaviors: (e) => e.behaviors(),
  on: (e) => e.on(ENTITY_DISABLED, () => {}),
  parent: (e) => e.parent,
  children: (e) => e.children,
  root: (e) => e.root,
  localPose: (e) => e.localPose,
  setLocalPose: (e) => e.setLocalPose(0, 0),
  setParent: (e) => e.setParent(null),
  find: (e) => e.find("x"),
  getBehaviorInChildren: (e) => e.getBehaviorInChildren(LIFETIME),
  getBehaviorsInChildren: (e) => e.getBehaviorsInChildren(LIFETIME),
  getBehaviorInParent: (e) => e.getBehaviorInParent(LIFETIME),
};

describe("entity handles", () => {
  it("gives one handle per live entity, the same object every time", () => {
    const { ctx } = setup();
    const a = ctx.entity("a");
    expect(a).toBeDefined();
    expect(ctx.entity("a")).toBe(a);
    expect(ctx.entity("b") === a).toBe(false);
    expect(ctx.entity("nobody")).toBeUndefined();
  });

  it("reads the runtime's tables: type, record, pose, tags, behaviors", () => {
    const { ctx } = setup();
    const a = ctx.entity("a")!;
    expect(a.id).toBe("a");
    expect(a.alive).toBe(true);
    expect(a.type).toBe("marker");
    expect(a.record).toBe(ctx.get("a"));
    expect(a.pose).toEqual({ x: 1, y: 2, rot: 0 });
    expect(a.hasTag("spawn")).toBe(true);
    expect(a.hasTag("blue")).toBe(false);
    expect(a.behaviors()).toEqual(["lifetime"]);
    expect(ctx.entity("b")!.behaviors()).toEqual([]);
    expect(a.getBehavior(LIFETIME)?.fields).toEqual(ctx.get("a")!.behaviors!.lifetime);
    expect(a.getBehavior("lifetime")).toBe(a.getBehavior(LIFETIME));
  });

  it("getBehavior is undefined for a behavior it doesn't carry, or one whose system a headless run doesn't build", () => {
    const { ctx, rt } = setup([
      marker("a", { behaviors: { sprite: { size: [1, 1] } } }),
      marker("b", { behaviors: { lifetime: { ticks: 5 } } }),
    ]);
    expect(rt.get("a")?.behaviors?.sprite).toBeDefined();
    expect(ctx.entity("a")!.getBehavior(SPRITE)).toBeUndefined();
    expect(ctx.entity("a")!.getBehavior(BODY)).toBeUndefined();
    expect(ctx.entity("b")!.getBehavior(LIFETIME)).toBeDefined();
  });

  it("moves the entity through ctx.setPose", () => {
    const { ctx, step } = setup();
    const b = ctx.entity("b")!;
    b.setPose(4, 5, 0.5, { snap: true });
    expect(b.pose).toEqual({ x: 4, y: 5, rot: 0.5 });
    expect(ctx.poses.prev("b")).toEqual({ x: 4, y: 5, rot: 0.5 });
    step(3);
    expect(b.pose).toEqual({ x: 4, y: 5, rot: 0.5 });
  });

  it("after a destroy, alive is false, id still answers and every other member throws entity-gone", () => {
    const { ctx } = setup();
    for (const [member, use] of Object.entries(MEMBERS)) {
      const id = `marker#${member.toLowerCase()}`;
      ctx.spawn({ type: "marker", id, at: [0, 0], tags: ["spawn"] });
      const e = ctx.entity(id)!;
      e.destroy();
      expect(e.alive, member).toBe(false);
      expect(e.id).toBe(id);
      gone(() => use(e));
    }
    expect(ctx.entity("marker#type")).toBeUndefined();
  });

  it("stays alive until the end of the tick when destroyed inside one", () => {
    const { ctx, rt } = setup();
    const a = ctx.entity("a")!;
    const seen: boolean[] = [];
    ctx.timers.after(1, () => {
      a.destroy();
      seen.push(a.alive);
    });
    rt.step(rt.ctx.time.tickMs, []);
    rt.step(rt.ctx.time.tickMs, []);
    expect(seen).toEqual([true]);
    expect(a.alive).toBe(false);
  });

  it("a new entity with a reused id gets a new handle; the old one stays gone", () => {
    const { ctx } = setup();
    ctx.spawn({ type: "marker", id: "marker#again", at: [0, 0] });
    const first = ctx.entity("marker#again")!;
    ctx.destroy("marker#again");
    ctx.spawn({ type: "marker", id: "marker#again", at: [3, 3] });
    const second = ctx.entity("marker#again")!;
    expect(second === first).toBe(false);
    expect(first.alive).toBe(false);
    expect(second.alive).toBe(true);
    gone(() => first.pose);
    expect(second.pose).toEqual({ x: 3, y: 3, rot: 0 });
  });

  it("a disabled entity keeps its handle", () => {
    const { ctx, step } = setup();
    const a = ctx.entity("a")!;
    a.setEnabled(false);
    expect(ctx.entity("a")).toBe(a);
    expect(a.alive).toBe(true);
    expect(a.enabled).toBe(false);
    step(2);
    expect(ctx.entity("a")).toBe(a);
    a.setEnabled(true);
    expect(a.enabled).toBe(true);
  });

  it("an edit that replaces the record keeps the handle; removing the entity drops it", () => {
    const { ctx, rt } = setup();
    const b = ctx.entity("b")!;
    expect(rt.update([marker("b", { at: [6, 6] })])).toMatchObject({ ok: true });
    expect(ctx.entity("b")).toBe(b);
    expect(b.record).toBe(rt.get("b"));
    rt.remove(["b"]);
    expect(b.alive).toBe(false);
    expect(ctx.entity("b")).toBeUndefined();
  });

  it("drops every handle at unload; a load gives new ones", () => {
    const { ctx, rt } = setup();
    const a = ctx.entity("a")!;
    rt.unload();
    expect(a.alive).toBe(false);
    gone(() => a.type);
    expect(rt.load(scene())).toMatchObject({ ok: true });
    expect(a.alive).toBe(false);
    const again = ctx.entity("a")!;
    expect(again === a).toBe(false);
    expect(again.alive).toBe(true);
  });

  it("on subscribes to step events about this entity, ending with it", () => {
    const { ctx, rt, step } = setup();
    const a = ctx.entity("a")!;
    const got: (string | undefined)[] = [];
    a.on(ENTITY_DISABLED, (e) => got.push(e.entityId));
    ctx.timers.after(1, () => {
      ctx.setEnabled("b", false);
      ctx.setEnabled("a", false);
    });
    step(2);
    expect(got).toEqual(["a"]);
    ctx.setEnabled("a", true);
    a.destroy();
    expect(rt.add([marker("a")])).toMatchObject({ ok: true });
    ctx.timers.after(1, () => ctx.setEnabled("a", false));
    step(2);
    expect(got).toEqual(["a"]);
  });
});
