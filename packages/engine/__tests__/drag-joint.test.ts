import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import { PhysicsRequiredError } from "../game/physics-of";
import type { GameDefinition } from "../game/types";
import { runPlaytest } from "../headless/playtest";
import type { InputScriptV2, PlaytestReport } from "../headless/playtest-types";
import { replayRecording } from "../headless/recording";
import { createDragJoint, type DragJoint, type DragJointOptions } from "../physics/drag";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const PROP = "crate";
const TARGET: Vec2 = { x: 3, y: 0 };

type Snap = { position: Vec2; peakAccel: number; mass: number; drags: number };

/** Drags whatever the pointer is over while "grab" (the primary button) is held. */
function dragGame(opts: DragJointOptions): GameDefinition<Snap> {
  return defineGame<Snap>({
    id: "drag-test",
    types: [],
    actions: [
      {
        action: "grab",
        description: "Hold to drag.",
        bindings: [{ device: "pointer", button: "primary" }],
      },
    ],
    play: { focus: (s) => (s ? s.position : null), results: [] },
    createRuntime(ctx) {
      let drag: DragJoint | null = null;
      let last: Vec2 | null = null;
      let peakAccel = 0;
      let drags = 0;
      return {
        onUnload() {
          drag?.release();
          drag = null;
        },
        beforeStep() {
          const p = ctx.input.pointer();
          if (ctx.input.pressed("grab") && p) {
            const hit = ctx.space.pointAt(p)[0];
            if (hit) {
              drag = createDragJoint(ctx, hit.tag.entityId, p, opts);
              drags++;
            }
          } else if (ctx.input.released("grab")) {
            drag?.release();
            drag?.release();
            drag = null;
          } else if (drag && p) drag.update(p);
        },
        afterStep(dtMs) {
          if (!ctx.bodies.has(PROP)) return;
          const v = ctx.bodies.velocity(PROP);
          if (last) {
            const a = Math.hypot(v.x - last.x, v.y - last.y) / (dtMs / 1000);
            peakAccel = Math.max(peakAccel, a);
          }
          last = { x: v.x, y: v.y };
        },
        snapshot() {
          const pose = ctx.poses.get(PROP);
          return {
            position: { x: pose?.x ?? 0, y: pose?.y ?? 0 },
            peakAccel,
            mass: ctx.bodies.has(PROP) ? ctx.bodies.mass(PROP) : 0,
            drags,
          };
        },
      };
    },
  });
}

const CRATE_COLLIDER = { shape: ["box", 0, 0, 0.25, 0.25] };

const crate: EntityDef = {
  id: PROP,
  type: "marker",
  at: [0, 0],
  behaviors: {
    collider: CRATE_COLLIDER,
    body: { kind: "dynamic", fixedRotation: true },
  },
};

function scene(physics: "rapier" | "none" = "rapier"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "drag-test",
    name: "drag",
    bounds: [-10, -10, 10, 10],
    settings: { physics, gravity: [0, 0] },
    entities: [
      physics === "rapier" ? crate : { ...crate, behaviors: { collider: CRATE_COLLIDER } },
    ],
  };
}

const script: InputScriptV2 = {
  v: 2,
  steps: [
    { pointer: { at: [0, 0], press: "primary" }, for: 1 },
    { pointer: { at: [0, 0], drag: [TARGET.x, TARGET.y] }, for: 30 },
    { pointer: { at: [TARGET.x, TARGET.y] }, for: 420 },
    { pointer: { at: [TARGET.x, TARGET.y], release: "primary" }, for: 2 },
    { wait: 10 },
  ],
};

function play(opts: DragJointOptions): PlaytestReport<Snap> {
  const run = runPlaytest<Snap>({ rapier, game: dragGame(opts), scene: scene(), script });
  if (run.blocked) throw new Error(JSON.stringify(run));
  return run;
}

describe("createDragJoint", () => {
  it("pulls a prop onto the pointer's target, its pull held within maxForce", () => {
    const maxForce = 2;
    const report = play({ maxForce });
    const final = report.final!;
    expect(final.drags).toBe(1);
    expect(Math.hypot(final.position.x - TARGET.x, final.position.y - TARGET.y)).toBeLessThan(0.1);

    // The cap holds the spring and its damping together, so the prop never
    // accelerates past maxForce / mass, where an uncapped drag does.
    expect(final.peakAccel).toBeLessThanOrEqual((maxForce / final.mass) * 1.1);
    const free = play({}).final!;
    expect(free.peakAccel).toBeGreaterThan((maxForce / free.mass) * 2);
  });

  it("replays its recording to the same digest", () => {
    const opts = { maxForce: 2 };
    const report = play(opts);
    const replay = replayRecording({
      rapier,
      game: dragGame(opts) as GameDefinition,
      scene: scene(),
      recording: report.recording,
    });
    if (replay.blocked) throw new Error("replay blocked");
    expect(replay.matches, replay.divergence ?? "").toBe(true);
  });

  function load(physics: "rapier" | "none" = "rapier"): SceneRuntimeHandle {
    const game = dragGame({});
    const rt = createSceneRuntime({
      rapier: physics === "rapier" ? rapier : null,
      view: null,
      game,
    });
    const report = rt.load(expandScene(scene(physics), createRegistry(game)));
    if (!report.ok) throw new Error(report.error);
    return rt;
  }

  it("removes its anchor and joint on release, twice harmlessly, leaving scene handles as loaded", () => {
    const rt = load();
    const world = rt.ctx.physics!.world;
    const handles = () => {
      const out: number[] = [];
      world.forEachRigidBody((b) => void out.push(b.handle));
      return out;
    };
    const before = handles();
    const drag = createDragJoint(rt.ctx, PROP, { x: 0.1, y: 0 });
    expect(world.impulseJoints.len()).toBe(1);
    expect(handles()).toHaveLength(before.length + 1);
    expect(rt.ctx.space.pointAt({ x: 0.1, y: 0 }).map((h) => h.tag.entityId)).toEqual([PROP]);
    drag.update({ x: 1, y: 0 });
    rt.step(rt.ctx.time.tickMs, []);
    drag.release();
    drag.release();
    drag.update({ x: 2, y: 0 });
    expect(world.impulseJoints.len()).toBe(0);
    expect(handles()).toEqual(before);
  });

  it("releases on the next update once its body is destroyed", () => {
    const rt = load();
    const world = rt.ctx.physics!.world;
    const drag = createDragJoint(rt.ctx, PROP, { x: 0, y: 0 });
    rt.ctx.destroy(PROP);
    rt.step(rt.ctx.time.tickMs, []);
    drag.update({ x: 1, y: 0 });
    expect(world.impulseJoints.len()).toBe(0);
    expect(world.bodies.len()).toBe(0);
    drag.release();
  });

  it("throws physics-required in a physics-free scene", () => {
    const rt = load("none");
    expect(() => createDragJoint(rt.ctx, PROP, { x: 0, y: 0 })).toThrow(PhysicsRequiredError);
    try {
      createDragJoint(rt.ctx, PROP, { x: 0, y: 0 });
    } catch (e) {
      expect((e as PhysicsRequiredError).code).toBe("physics-required");
    }
  });
});
