import { beforeAll, describe, expect, it } from "vite-plus/test";

import { recordingView } from "../../__tests__/fixtures/recording-view";
import { GOAL_EVENT, testGame, type TestGameSnapshot } from "../../__tests__/fixtures/test-game";
import type { SceneView } from "../../context";
import { defineBehavior, type BehaviorSystem } from "../../game/behaviors";
import { defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { inputAction } from "../../runtime/recorder";
import { createSceneRuntime } from "../../runtime/runtime";
import { hashText } from "../../scene/hash";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../../scene/types";
import type { RapierModule } from "../../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const TICKS = 240;
const LAMPS = 100;
const DECOR = 40;
const HALO = "test-game/halo";

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

/** A visual-only behavior: draws a halo per entity and follows its pose through the view each tick. */
const halo = defineBehavior({
  name: HALO,
  description: "A halo drawn around the entity.",
  fields: {},
  visualOnly: true,
  system: (ctx) => {
    const view = ctx.view!;
    const live = new Set<string>();
    const id = (entityId: string) => `${entityId}#halo`;
    const system: BehaviorSystem = {
      attach(entityId) {
        live.add(entityId);
        view.draw(id(entityId), box(0, 0, 4, 4), { fill: 0xffcc00 }, "overlay");
      },
      detach(entityId) {
        if (live.delete(entityId)) view.remove(id(entityId));
      },
      step() {
        for (const entityId of live) {
          const pose = ctx.poses.get(entityId);
          if (pose) view.pose(id(entityId), pose.x, pose.y, pose.rot);
        }
      },
      render(alpha) {
        for (const entityId of live) {
          const prev = ctx.poses.prev(entityId);
          const pose = ctx.poses.get(entityId);
          if (prev && pose) {
            view.pose(id(entityId), prev.x + (pose.x - prev.x) * alpha, prev.y, pose.rot);
          }
        }
      },
      clear() {
        for (const entityId of live) view.remove(id(entityId));
        live.clear();
      },
      size: () => live.size,
    };
    return system;
  },
});

const game: GameDefinition<TestGameSnapshot> = defineGame<TestGameSnapshot>({
  ...(testGame as GameDefinition<TestGameSnapshot>),
  behaviors: [...(testGame.behaviors ?? []), halo],
});

function scene(): ExpandedScene {
  const lamps: RuntimeEntity[] = Array.from({ length: LAMPS }, (_, i) => ({
    id: `lamp-${i}`,
    type: "lamp",
    at: [i * 12, 900 - (i % 7) * 10],
    behaviors: { [HALO]: {} },
  }));
  return {
    name: "halos",
    bounds: [-1000, -1000, 2000, 2000],
    settings: {
      gravity: [0, 1200],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities: [
      { id: "floor", type: "solid", shape: box(500, 1000, 1000, 20) },
      {
        id: "avatar",
        type: "prop",
        shape: box(0, 960, 10, 10),
        density: 1,
        restitution: 0,
        behaviors: { [HALO]: {} },
      },
      { id: "goal", type: "sensor", shape: box(600, 960, 20, 40), tags: ["goal"] },
      ...lamps,
      ...Array.from(
        { length: DECOR },
        (_, i): RuntimeEntity => ({
          id: `decor-${i}`,
          type: "decor",
          at: [i * 25, 940],
          ...(i % 3 === 0 ? { z: i - 20 } : {}),
          behaviors: { sprite: { size: [16, 16] } },
        }),
      ),
    ],
  };
}

/** One run's digest: every step's tick, events and game snapshot, then the bodies' end state. */
function runDigest(view: SceneView | null): {
  digest: string;
  halos: number;
  won: boolean;
  decor: number;
} {
  const rt = createSceneRuntime({ rapier, view, game });
  expect(rt.load(scene(), {}).ok).toBe(true);
  const halos = rt.stats().behaviors[HALO] ?? 0;
  const decor = rt.stats().perType.decor ?? 0;
  const steps: unknown[] = [];
  let won = false;
  for (let t = 0; t < TICKS; t++) {
    const actions = t === 0 ? [inputAction("right", true, 0)] : [];
    const result = rt.step(DT, actions);
    if (result.events.some((e) => e.type === GOAL_EVENT)) won = true;
    steps.push(result);
    rt.render(0.5);
  }
  const bodies: unknown[] = [];
  rt.ctx.physics!.world.bodies.forEach((b) => {
    bodies.push([b.translation(), b.linvel(), b.rotation()]);
  });
  const digest = hashText(JSON.stringify({ steps, bodies, stats: rt.stats().bodies }));
  rt.destroy();
  return { digest, halos, won, decor };
}

describe("visual-only behaviors leave the simulation alone", () => {
  it("a run with a recording view and a headless run give the same digest, decor and its sprites included", () => {
    const recording = recordingView({ sprites: true });
    const viewed = runDigest(recording.view);
    const headless = runDigest(null);

    expect(viewed.halos).toBe(LAMPS + 1);
    expect(headless.halos).toBe(0);
    expect(recording.calls.filter((c) => c.op === "pose" && c.id.endsWith("#halo")).length).toBe(
      (LAMPS + 1) * TICKS * 2,
    );
    expect(viewed.won).toBe(true);
    expect([viewed.decor, headless.decor]).toEqual([DECOR, DECOR]);
    expect(recording.calls.filter((c) => c.op === "sprite").length).toBe(DECOR);
    expect(viewed.digest).toBe(headless.digest);
  });
});
