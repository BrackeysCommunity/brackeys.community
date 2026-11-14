import { beforeAll, describe, expect, it } from "vite-plus/test";

import { defineBehavior, type BehaviorBlock, type BehaviorSystem } from "../game/behaviors";
import { DEFAULT_ACTIONS } from "../game/defaults";
import { createRegistry, defineGame } from "../game/define";
import { composePose, createPoseIndex } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import { createSceneTree } from "../runtime/tree";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { expectPoseClose, stepEvents, withParents } from "./fixtures/tree-rig";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A behavior that says it moves its entity itself, as a body or a character would. */
const DRIFT = defineBehavior({
  name: "trees/drift",
  description: "Moves its entity in world space.",
  fields: {},
  system: (): BehaviorSystem => {
    const attached = new Set<string>();
    return {
      attach: (id) => void attached.add(id),
      detach: (id) => void attached.delete(id),
      clear: () => attached.clear(),
      size: () => attached.size,
      selfMoving: (id) => attached.has(id),
    };
  },
});

const game = defineGame({
  id: "trees",
  types: [],
  behaviors: [DRIFT],
  actions: [...DEFAULT_ACTIONS],
  input: { players: { max: 1, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

const BACKENDS = ["none", "rapier"] as const;
type Physics = (typeof BACKENDS)[number];
const BOX = ["box", 0, 0, 0.25, 0.25];

const marker = (id: string, at: [number, number], behaviors: Record<string, BehaviorBlock> = {}) =>
  ({ id, type: "marker", at, behaviors }) as EntityDef;

/**
 * A node `hub` at the origin with a lamp (carrying a bulb), a post with a
 * fixed collider and a drifter that moves itself.
 */
const ENTITIES: EntityDef[] = [
  { id: "hub", type: "node", at: [0, 0] } as EntityDef,
  marker("lamp", [1, 0]),
  marker("bulb", [1, 1]),
  marker("post", [0, 2], { collider: { shape: BOX } }),
  marker("drifter", [-1, 0], { "trees/drift": {} }),
];
const PARENTS: Record<string, string> = { lamp: "hub", bulb: "lamp", post: "hub", drifter: "hub" };

function load(physics: Physics) {
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "trees",
    name: "trees",
    bounds: [-60, -60, 60, 60],
    settings: { physics, gravity: [0, 0] },
    entities: ENTITIES,
  };
  const expanded = expandScene(scene, registry);
  withParents(expanded, PARENTS);
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(expanded);
  if (!report.ok) throw new Error(report.error);
  const steps = (n: number) => void stepEvents(rt, n);
  return { rt, steps };
}

for (const physics of BACKENDS) {
  describe(`following a parent on physics: ${physics}`, () => {
    it("moves every enabled, driven child with its parent, and leaves a self-moving one", () => {
      const { rt, steps } = load(physics);
      steps(1);
      rt.ctx.setPose("hub", 5, 0, Math.PI / 2);
      const hub = { x: 5, y: 0, rot: Math.PI / 2 };
      expectPoseClose(
        rt.ctx.poses.get("lamp"),
        composePose(5, 0, Math.PI / 2, { x: 1, y: 0, rot: 0 }),
        "lamp",
      );
      const lamp = rt.ctx.poses.get("lamp")!;
      expectPoseClose(
        rt.ctx.poses.get("bulb"),
        composePose(lamp.x, lamp.y, lamp.rot, { x: 0, y: 1, rot: 0 }),
        "bulb",
      );
      expectPoseClose(
        rt.ctx.poses.get("post"),
        composePose(hub.x, hub.y, hub.rot, { x: 0, y: 2, rot: 0 }),
        "post",
      );
      expect(rt.ctx.poses.get("drifter")).toEqual({ x: -1, y: 0, rot: 0 });
      // The post's collider went with it.
      steps(2);
      const post = rt.ctx.poses.get("post")!;
      const at = (x: number, y: number) =>
        rt.ctx.space
          .overlaps({ type: "circle", cx: x, cy: y, r: 0.05 }, { group: "dynamic" })
          .map((h) => h.tag.entityId);
      expect(at(post.x, post.y)).toContain("post");
      expect(at(0, 2)).not.toContain("post");
      expectPoseClose(
        rt.ctx.poses.get("post"),
        composePose(hub.x, hub.y, hub.rot, { x: 0, y: 2, rot: 0 }),
        "post",
      );
      rt.destroy();
    });

    it("a child's own move changes its place in the parent's frame", () => {
      const { rt } = load(physics);
      rt.ctx.setPose("lamp", 3, 0);
      rt.ctx.setPose("hub", 0, 10);
      expect(rt.ctx.poses.get("lamp")).toMatchObject({ x: 3, y: 10 });
      expect(rt.ctx.poses.get("bulb")).toMatchObject({ x: 3, y: 11 });
      rt.destroy();
    });

    it("carries `snap` down the tree", () => {
      const { rt, steps } = load(physics);
      steps(1);
      rt.ctx.setPose("hub", 2, 0);
      expect(rt.ctx.poses.prev("bulb")).toMatchObject({ x: 1, y: 1 });
      expect(rt.ctx.poses.get("bulb")).toMatchObject({ x: 3, y: 1 });
      rt.ctx.setPose("hub", 4, 0, undefined, { snap: true });
      expect(rt.ctx.poses.prev("bulb")).toMatchObject({ x: 5, y: 1 });
      expect(rt.ctx.poses.prev("lamp")).toMatchObject({ x: 5, y: 0 });
      rt.destroy();
    });

    it("skips a disabled child and what is under it", () => {
      const { rt } = load(physics);
      rt.ctx.setEnabled("lamp", false);
      rt.ctx.setPose("hub", 0, 5);
      expect(rt.ctx.poses.get("lamp")).toMatchObject({ x: 1, y: 0 });
      expect(rt.ctx.poses.get("bulb")).toMatchObject({ x: 1, y: 1 });
      expect(rt.ctx.poses.get("post")).toMatchObject({ x: 0, y: 7 });
      rt.destroy();
    });
  });
}

describe("the write guard", () => {
  it("tells the tree's own writes from the entity's: a system that adjusts a pose doesn't move the local one", () => {
    const poses = createPoseIndex(() => 0);
    const live = new Set(["hub", "kid"]);
    /** A system that rounds every pose it is given to whole units. */
    const setPose = (id: string, x: number, y: number, rot = 0) =>
      poses.set(id, Math.round(x), Math.round(y), rot);
    const tree = createSceneTree({
      poses,
      setPose,
      exists: (id) => live.has(id),
      enabled: (id) => live.has(id),
      selfMoving: () => false,
      follows: (id) => (live.has(id) ? "pose" : "still"),
      carries: () => false,
      ride: () => {},
      scopeOf: () => null,
      reparented: () => {},
      stepping: () => false,
      tick: () => 0,
    });
    poses.set("hub", 0, 0, 0);
    poses.set("kid", 0.4, 0, 0);
    tree.link([
      { id: "hub", type: "node", at: [0, 0] },
      { id: "kid", type: "marker", at: [0.4, 0], parent: "hub" },
    ]);
    poses.set("hub", 1, 0, 0);
    // The tree asked for 1.4; the system put it at 1. The local pose stays the one the kid had.
    expect(poses.get("kid")).toMatchObject({ x: 1, y: 0 });
    expect(tree.local("kid")).toEqual({ x: 0.4, y: 0, rot: 0 });
    poses.set("hub", 2.2, 0, 0);
    expect(poses.get("kid")).toMatchObject({ x: 3 });
    // A write that isn't the tree's moves the local pose.
    poses.set("kid", 5, 0, 0);
    expect(tree.local("kid")).toMatchObject({ x: 5 - 2.2 });
  });

  it("derives a self-moving child's local pose when read", () => {
    const poses = createPoseIndex(() => 0);
    const live = new Set(["hub", "kid"]);
    const tree = createSceneTree({
      poses,
      setPose: (id, x, y, rot) => poses.set(id, x, y, rot),
      exists: (id) => live.has(id),
      enabled: (id) => live.has(id),
      selfMoving: (id) => id === "kid",
      follows: (id) => (live.has(id) && id !== "kid" ? "pose" : "still"),
      carries: () => false,
      ride: () => {},
      scopeOf: () => null,
      reparented: () => {},
      stepping: () => false,
      tick: () => 0,
    });
    poses.set("hub", 0, 0, 0);
    poses.set("kid", 1, 0, 0);
    tree.link([
      { id: "hub", type: "node", at: [0, 0] },
      { id: "kid", type: "marker", at: [1, 0], parent: "hub" },
    ]);
    poses.set("hub", 4, 0, 0);
    expect(poses.get("kid")).toMatchObject({ x: 1 });
    expect(tree.local("kid")).toEqual({ x: -3, y: 0, rot: 0 });
  });
});
