// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import {
  defineBehavior,
  handleType,
  type BehaviorDef,
  type BehaviorSystem,
  type BlockOf,
} from "../game/behaviors";
import { BODY, type BodyKind } from "../game/behaviors/body";
import { createRegistry, defineGame } from "../game/define";
import type { Entity, HandleOf } from "../game/entity";
import { BASE_REQUIRED_FIELDS } from "../game/primitives";
import { behaviorNameOf, defineScript, definitionOf, Script } from "../game/script";
import { PRIMITIVE_TYPES, type EngineContext } from "../game/types";
import { createBehaviorHost } from "../runtime/behaviors";
import { createEventBus } from "../runtime/events";
import { createPoseIndex } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import type { RuntimeEntity } from "../scene/types";
import type { Vec2 } from "../types";
import { engineErrorCode } from "./fixtures/tree-rig";

const DT = 1000 / 60;

/** A game behavior whose system records what the host asks of it. */
function probeBehavior(name: string, calls: string[], opts: { handle?: boolean } = {}) {
  return defineBehavior({
    name,
    description: "Records the host's calls.",
    fields: { speed: z.number().default(1) },
    handle: handleType<{ ping(): string }>(),
    system: (): BehaviorSystem => {
      const attached = new Set<string>();
      return {
        attach: (id) => void attached.add(id),
        detach: (id) => void attached.delete(id),
        clear: () => attached.clear(),
        size: () => attached.size,
        ...(opts.handle
          ? {
              handle(id: string) {
                calls.push(`${name}.handle:${id}`);
                return { ping: () => `${name}:${id}` };
              },
            }
          : {}),
        posed(id, pose, snap) {
          calls.push(`${name}.posed:${id}@${pose.x},${pose.y},${pose.rot}${snap ? ":snap" : ""}`);
        },
        selfMoving: (id) => id === "runner",
        ride(id, host) {
          calls.push(`${name}.ride:${id}>${host}`);
        },
      };
    },
  });
}

function world(entities: RuntimeEntity[], behaviors: BehaviorDef[] = []) {
  const game = defineGame({
    id: "probe",
    types: [],
    actions: [],
    behaviors,
    createRuntime: () => ({ snapshot: () => null }),
  });
  const rt = createSceneRuntime({ rapier: undefined, view: null, game });
  const report = rt.load({
    name: "contract",
    bounds: [-50, -50, 50, 50],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  });
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const node = (id: string, at: [number, number], rot?: number): RuntimeEntity => ({
  id,
  type: "node",
  at,
  ...(rot !== undefined ? { rot } : {}),
});

describe("the node primitive", () => {
  it("is registered first, spawns first and requires `at` of a type based on it", () => {
    expect(PRIMITIVE_TYPES[0]).toBe("node");
    const registry = createRegistry();
    expect(registry.spawnGroups[0]).toEqual(["node"]);
    expect(BASE_REQUIRED_FIELDS.node).toEqual(["at"]);
    expect(registry.types.get("node")?.physics).toBe("optional");
  });

  it("loads posed at its `at` and `rot`, and moves with ctx.setPose", () => {
    const rt = world([node("hub", [2, 3], 90), node("plain", [-1, 0])]);
    expect(rt.ctx.poses.get("hub")).toEqual({ x: 2, y: 3, rot: Math.PI / 2 });
    expect(rt.ctx.poses.get("plain")).toEqual({ x: -1, y: 0, rot: 0 });

    rt.step(DT, []);
    rt.ctx.setPose("hub", 5, -4, 0.25);
    expect(rt.ctx.poses.get("hub")).toEqual({ x: 5, y: -4, rot: 0.25 });
    expect(rt.ctx.poses.prev("hub")).toEqual({ x: 2, y: 3, rot: Math.PI / 2 });

    rt.ctx.setPose("hub", 6, -4, undefined, { snap: true });
    expect(rt.ctx.poses.get("hub")).toEqual({ x: 6, y: -4, rot: 0.25 });
    expect(rt.ctx.poses.prev("hub")).toEqual({ x: 6, y: -4, rot: 0.25 });
  });

  it("takes only the pose index write while disabled", () => {
    const calls: string[] = [];
    const rt = world(
      [{ ...node("hub", [0, 0]), behaviors: { "probe/a": { speed: 1 } } }],
      [probeBehavior("probe/a", calls)],
    );
    rt.ctx.setEnabled("hub", false);
    rt.ctx.setPose("hub", 1, 1);
    expect(rt.ctx.poses.get("hub")).toMatchObject({ x: 1, y: 1 });
    expect(calls).toEqual([]);
  });
});

describe("ctx.setPose", () => {
  it("refuses a type with no setPose, and an id that isn't live", () => {
    const rt = world([
      node("hub", [0, 0]),
      {
        id: "lift",
        type: "follower",
        shape: { type: "box", cx: 0, cy: 0, hw: 0.5, hh: 0.1, rotDeg: 0 },
        path: {
          pts: [
            [0, 0],
            [1, 0],
          ],
          speed: 1,
        },
      },
    ]);
    expect(engineErrorCode(() => rt.ctx.setPose("lift", 1, 1))).toBe("pose-not-settable");
    expect(engineErrorCode(() => rt.ctx.setPose("nobody", 1, 1))).toBe("entity-gone");
  });

  it("calls each attached block's posed in registration order, after the pose is written", () => {
    const calls: string[] = [];
    const rt = world(
      [
        { ...node("hub", [0, 0]), behaviors: { "probe/b": {}, "probe/a": {} } },
        { ...node("bare", [0, 0]), behaviors: { "probe/b": {} } },
      ],
      [probeBehavior("probe/a", calls), probeBehavior("probe/b", calls)],
    );
    rt.ctx.setPose("hub", 1, 2, 0);
    rt.ctx.setPose("bare", 3, 4, 0, { snap: true });
    expect(calls).toEqual([
      "probe/a.posed:hub@1,2,0",
      "probe/b.posed:hub@1,2,0",
      "probe/b.posed:bare@3,4,0:snap",
    ]);
  });
});

describe("the behavior host's handles", () => {
  it("asks a system once per attach, adds `fields`, and falls back to { fields }", () => {
    const calls: string[] = [];
    const data = defineBehavior({
      name: "probe/data",
      description: "Data only.",
      fields: { label: z.string().default("x") },
    });
    const hub = {
      ...node("hub", [0, 0]),
      behaviors: { "probe/a": { speed: 2 }, "probe/data": { label: "x" } },
    };
    const rt = world(
      [],
      [probeBehavior("probe/a", calls, { handle: true }), probeBehavior("probe/b", calls), data],
    );
    const host = createBehaviorHost(rt.ctx, rt.ctx.registry);
    expect(host.handle(hub, "probe/a")).toBeUndefined();
    host.attach(hub);

    const a = host.handle(hub, "probe/a") as { ping(): string; fields: { speed: number } };
    expect(a.ping()).toBe("probe/a:hub");
    expect(a.fields).toEqual({ speed: 2 });
    expect(host.handle(hub, "probe/a")).toBe(a);
    expect(host.handle(hub, "probe/data")).toEqual({ fields: { label: "x" } });
    expect(host.handle(hub, "probe/b")).toBeUndefined();

    const faster = { ...hub, behaviors: { ...hub.behaviors, "probe/a": { speed: 3 } } };
    host.update(faster, hub);
    const again = host.handle(faster, "probe/a") as { fields: { speed: number } };
    expect(again).not.toBe(a);
    expect(again.fields).toEqual({ speed: 3 });
    expect(calls).toEqual(["probe/a.handle:hub", "probe/a.handle:hub"]);

    host.detach(faster);
    expect(host.handle(faster, "probe/a")).toBeUndefined();
  });

  it("answers selfMoving and passes ride to the attached blocks", () => {
    const calls: string[] = [];
    const rt = world(
      [
        { ...node("runner", [0, 0]), behaviors: { "probe/a": {} } },
        { ...node("still", [0, 0]), behaviors: { "probe/a": {} } },
        node("bare", [0, 0]),
      ],
      [probeBehavior("probe/a", calls)],
    );
    const host = createBehaviorHost(rt.ctx, rt.ctx.registry);
    for (const id of ["runner", "still", "bare"]) host.attach(rt.ctx.get(id)!);
    expect(host.selfMoving(rt.ctx.get("runner")!)).toBe(true);
    expect(host.selfMoving(rt.ctx.get("still")!)).toBe(false);
    expect(host.selfMoving(rt.ctx.get("bare")!)).toBe(false);
    host.ride(rt.ctx.get("still")!, "runner");
    host.ride(rt.ctx.get("bare")!, "runner");
    expect(calls).toEqual(["probe/a.ride:still>runner"]);
  });
});

describe("what the context reaches", () => {
  it("reaches handles, behaviors and the tree from ctx", () => {
    const rt = world([node("hub", [1, 2])]);
    const { ctx } = rt;
    expect(ctx.entity("hub")).toBe(ctx.entity("hub"));
    expect(ctx.entity("hub")?.alive).toBe(true);
    expect(ctx.entities()).toEqual([ctx.entity("hub")]);
    expect(ctx.findBehavior(BODY)).toBeUndefined();
    expect(ctx.findBehaviors("body")).toEqual([]);
    expect(ctx.tree.parent("hub")).toBeNull();
    expect(ctx.tree.children("hub")).toEqual([]);
    expect(ctx.tree.subtree("hub")).toEqual(["hub"]);
    expect(ctx.tree.root("hub")).toBe("hub");
    expect(ctx.tree.isUnder("hub", "hub")).toBe(true);
    expect(ctx.tree.local("hub")).toEqual({ x: 1, y: 2, rot: 0 });
    ctx.tree.setLocal("hub", 3, 4);
    expect(ctx.poses.get("hub")).toMatchObject({ x: 3, y: 4 });
    expect(() => ctx.tree.setParent("hub", "hub")).toThrow(/can't be its own parent/);
    const kid = ctx.spawn({ type: "node", at: [0, 0], parent: "hub" });
    expect(ctx.tree.parent(kid.id)).toBe("hub");
  });

  it("registers a script class and a function script", () => {
    class Thruster extends Script({
      name: "probe/thruster",
      description: "Pushes.",
      fields: { force: z.number().default(2) },
    }) {
      push(): number {
        return this.fields.force;
      }
    }
    const hooks = defineScript({
      name: "probe/hooks",
      description: "Pushes too.",
      fields: { force: z.number().default(2) },
      create: (self) => ({ force: () => self.fields.force }),
    });
    expect(Thruster.behavior).toBe(Thruster.behavior);
    expect(definitionOf(Thruster).name).toBe("probe/thruster");
    expect(behaviorNameOf(Thruster)).toBe("probe/thruster");
    expect(behaviorNameOf(hooks)).toBe("probe/hooks");
    expect(behaviorNameOf("body")).toBe("body");
    const registry = createRegistry(
      defineGame({
        id: "probe",
        types: [],
        actions: [],
        behaviors: [Thruster, hooks],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    expect(registry.behaviorNames.slice(-2)).toEqual(["probe/thruster", "probe/hooks"]);
  });
});

describe("the bus and the pose index", () => {
  it("matches `{ entity }` subscriptions by the `under` it is given", () => {
    const seen: string[] = [];
    const bus = createEventBus({ under: (candidate, id) => candidate.endsWith(id) });
    bus.clear();
    bus.on("ping", (e) => seen.push(e.entityId!), { entity: "b" });
    bus.dispatch(
      [
        { type: "ping", tick: 0, entityId: "a/b", at: { x: 0, y: 0 } },
        { type: "ping", tick: 0, entityId: "b/a", at: { x: 0, y: 0 } },
      ],
      0,
    );
    expect(seen).toEqual(["a/b"]);
  });

  it("tells its watchers each write's snap flag", () => {
    const poses = createPoseIndex(() => 0);
    const writes: [string, boolean][] = [];
    poses.watch((id, snap) => writes.push([id, snap]));
    poses.set("a", 0, 0);
    poses.set("a", 1, 0, 0, { snap: true });
    poses.remove("a");
    expect(writes).toEqual([
      ["a", false],
      ["a", true],
      ["a", false],
    ]);
  });
});

/** Type-level checks: `tsc` fails on these lines if the contract's types drift. */
export function typeChecks(entity: Entity, ctx: EngineContext): void {
  const body = entity.getBehavior(BODY);
  if (body) {
    const kind: BodyKind = body.fields.kind;
    const v: Vec2 = body.velocity();
    body.applyForce({ x: kind === "dynamic" ? 1 : 0, y: v.y });
    // @ts-expect-error the handle binds the id: there is none to pass
    body.applyForce("crate", { x: 1, y: 0 });
  }
  const named = entity.getBehavior("body");
  // @ts-expect-error a name gives the untyped block alone
  named?.applyForce({ x: 1, y: 0 });
  const found = ctx.findBehavior(BODY);
  found?.wake();
  const block: BlockOf<typeof BODY> = BODY.handle ? ({} as BlockOf<typeof BODY>) : body!.fields;
  void block;

  class Health extends Script({
    name: "probe/health",
    description: "Hit points.",
    fields: { max: z.number().default(3) },
  }) {
    hp = 3;
    damage(n: number): void {
      this.hp = Math.min(this.fields.max, this.hp - n);
    }
  }
  entity.getBehavior(Health)?.damage(1);
  const health: HandleOf<typeof Health> | undefined = ctx.findBehavior(Health);
  void health;

  const hooks = defineScript({
    name: "probe/hooks",
    description: "Hooks.",
    fields: { force: z.number().default(2) },
    create: (self) => ({ force: (): number => self.fields.force }),
  });
  const h = entity.getBehavior(hooks);
  if (h) {
    const n: number = h.force() + h.fields.force;
    void n;
    void h.entity.id;
  }
}
