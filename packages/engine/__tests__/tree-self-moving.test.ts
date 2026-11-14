import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { CharacterSystem } from "../game/behaviors/character-top-down";
import type { NavAgentSystem } from "../game/behaviors/nav-agent";
import { createRegistry, defineGame } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef } from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const game = defineGame({
  id: "movers",
  types: [],
  actions: [],
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

const BACKENDS = ["none", "rapier"] as const;
type Physics = (typeof BACKENDS)[number];

const body = { collider: { shape: ["box", 0, 0, 0.25, 0.25] } };

/** A node with a plain child and one child per self-moving behavior, spread along y. */
const ENTITIES: EntityDef[] = [
  { id: "rig", type: "node", at: [0, 0] },
  { id: "lamp", type: "marker", at: [0, 0] },
  { id: "walker", type: "marker", at: [0, 2], behaviors: { ...body, "character-top-down": {} } },
  { id: "jumper", type: "marker", at: [0, 4], behaviors: { ...body, "character-side-view": {} } },
  { id: "seeker", type: "marker", at: [0, 6], behaviors: { "nav-agent": {} } },
  {
    id: "floor",
    type: "nav",
    shape: {
      type: "poly",
      pts: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    },
  },
] as EntityDef[];
const CHILDREN = ["lamp", "walker", "jumper", "seeker"];

function load(physics: Physics): SceneRuntimeHandle {
  const scene = expandScene(
    {
      v: SCENE_FORMAT_VERSION,
      game: game.id,
      name: "self-moving",
      bounds: [-20, -20, 20, 20],
      settings: { physics, gravity: [0, 0] },
      entities: ENTITIES,
    },
    registry,
  );
  for (const e of scene.entities) if (CHILDREN.includes(e.id)) e.parent = "rig";
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(scene);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const steps = (rt: SceneRuntimeHandle, n: number) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};
const at = (rt: SceneRuntimeHandle, id: string) => {
  const p = rt.ctx.poses.get(id)!;
  return { x: p.x, y: p.y };
};

describe("self-moving children", () => {
  for (const physics of BACKENDS) {
    describe(`on physics: ${physics}`, () => {
      it("answer selfMoving for both characters and a nav-agent, not for a plain child", () => {
        const rt = load(physics);
        const tree = rt.ctx.tree;
        steps(rt, 1);
        rt.ctx.setPose("rig", 3, 1);
        steps(rt, 1);
        expect(at(rt, "lamp")).toEqual({ x: 3, y: 1 });
        expect(at(rt, "walker")).toEqual({ x: 0, y: 2 });
        expect(at(rt, "jumper")).toEqual({ x: 0, y: 4 });
        expect(at(rt, "seeker")).toEqual({ x: 0, y: 6 });
        expect(tree.local("lamp")).toEqual({ x: 0, y: 0, rot: 0 });
        expect(tree.local("walker")).toEqual({ x: -3, y: 1, rot: 0 });
        expect(tree.local("jumper")).toEqual({ x: -3, y: 3, rot: 0 });
        expect(tree.local("seeker")).toEqual({ x: -3, y: 5, rot: 0 });
        rt.destroy();
      });

      it("derive their local pose from where their own motion puts them", () => {
        const rt = load(physics);
        const tree = rt.ctx.tree;
        rt.ctx.behavior<CharacterSystem>("character-top-down")!.setIntent("walker", {
          move: { x: 1, y: 0 },
        });
        rt.ctx.behavior<CharacterSystem>("character-side-view")!.setIntent("jumper", {
          move: { x: -1, y: 0 },
        });
        rt.ctx.behavior<NavAgentSystem>("nav-agent")!.setDestination("seeker", { x: 4, y: 6 });
        for (let i = 0; i < 30; i++) {
          rt.ctx.setPose("rig", 0, -i * 0.1);
          steps(rt, 1);
        }
        const rig = at(rt, "rig");
        expect(at(rt, "lamp")).toEqual(rig);
        expect(at(rt, "walker").x).toBeGreaterThan(0.5);
        expect(at(rt, "jumper").x).toBeLessThan(-0.5);
        expect(at(rt, "seeker").x).toBeGreaterThan(0.5);
        expect(at(rt, "walker").y).toBeCloseTo(2, 6);
        expect(at(rt, "jumper").y).toBeCloseTo(4, 6);
        expect(at(rt, "seeker").y).toBeCloseTo(6, 6);
        for (const id of ["walker", "jumper", "seeker"]) {
          const p = at(rt, id);
          expect(tree.local(id)).toMatchObject({
            x: expect.closeTo(p.x - rig.x, 9),
            y: expect.closeTo(p.y - rig.y, 9),
          });
        }
        rt.destroy();
      });
    });
  }
});
