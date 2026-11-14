// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior, type BehaviorDef } from "../../game/behaviors";
import { createRegistry, defineGame } from "../../game/define";
import { defineScript, Script } from "../../game/script";
import type { EngineContext } from "../../game/types";
import { createHeadlessRuntime } from "../../headless/headless";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef } from "../../scene/types";

/**
 * What a script costs against the same work written as one system: 2,000
 * entities each circling its start, once as a behavior system over a map,
 * once as a script class and once as a function script. The runs step in
 * turn, tick by tick, in a rotating order, and their median tick times are
 * compared, so whatever else loads the machine falls on all of them alike. The ratio is
 * printed; only past 2× is it a failure.
 */

const COUNT = 2000;
const WARM_TICKS = 30;
const MEASURED_TICKS = 300;
const BUDGET = 2;
const NAME = "budget/orbit";

const fields = {
  radius: z.number().positive().default(0.5).describe("Circle radius, m; default 0.5."),
  turn: z.number().default(2).describe("Angular speed, rad/s; default 2."),
};

type Orbit = { cx: number; cy: number; angle: number };

/** One orbit tick: the angle on, the pose round. The one piece of work every form does. */
function orbit(
  ctx: EngineContext,
  id: string,
  o: Orbit,
  radius: number,
  turn: number,
  dtMs: number,
) {
  o.angle += (turn * dtMs) / 1000;
  ctx.poses.set(id, o.cx + radius * Math.cos(o.angle), o.cy + radius * Math.sin(o.angle), 0);
}

function startOf(ctx: EngineContext, id: string): Orbit {
  const p = ctx.poses.get(id)!;
  return { cx: p.x, cy: p.y, angle: 0 };
}

const asSystem = defineBehavior({
  name: NAME,
  description: "Circles the entity round where it started.",
  fields,
  system(ctx) {
    const orbits = new Map<string, Orbit & { radius: number; turn: number }>();
    return {
      attach(id, block) {
        orbits.set(id, {
          ...startOf(ctx, id),
          radius: Number(block.radius),
          turn: Number(block.turn),
        });
      },
      detach: (id) => void orbits.delete(id),
      step(dtMs) {
        for (const [id, o] of orbits) orbit(ctx, id, o, o.radius, o.turn, dtMs);
      },
      clear: () => orbits.clear(),
      size: () => orbits.size,
    };
  },
});

class AsClass extends Script({
  name: NAME,
  description: "Circles the entity round where it started.",
  fields,
}) {
  private o: Orbit | undefined;

  awake() {
    this.o = startOf(this.ctx, this.entity.id);
  }

  step(dtMs: number) {
    orbit(this.ctx, this.entity.id, this.o!, this.fields.radius, this.fields.turn, dtMs);
  }
}

const asFunction = defineScript({
  name: NAME,
  description: "Circles the entity round where it started.",
  fields,
  create(self) {
    let o: Orbit;
    return {
      awake() {
        o = startOf(self.ctx, self.entity.id);
      },
      step(dtMs: number) {
        orbit(self.ctx, self.entity.id, o, self.fields.radius, self.fields.turn, dtMs);
      },
    };
  },
});

const entities: EntityDef[] = Array.from({ length: COUNT }, (_, n) => ({
  id: `orbiter-${n}`,
  type: "marker",
  at: [(n % 50) * 2, Math.floor(n / 50) * 2],
  behaviors: { [NAME]: {} },
}));

function open(behavior: BehaviorDef | typeof AsClass): SceneRuntimeHandle {
  const game = defineGame({
    id: "budget",
    types: [],
    actions: [],
    behaviors: [behavior],
    world: { gravity: [0, 0] },
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(game);
  const scene = expandScene(
    {
      v: SCENE_FORMAT_VERSION,
      game: game.id,
      name: "orbits",
      bounds: [-2, -2, 102, 82],
      settings: { physics: "none", gravity: [0, 0] },
      entities,
    },
    registry,
  );
  return createHeadlessRuntime({ rapier: null, game, registry, scene });
}

const median = (xs: readonly number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

describe(`${COUNT} script instances against one system doing the same work`, () => {
  it(`stays within ${BUDGET}× the system's tick time, as a class and as a function`, () => {
    const runs = [open(asSystem), open(AsClass), open(asFunction)];
    const ticks: number[][] = runs.map(() => []);
    for (let i = 0; i < WARM_TICKS + MEASURED_TICKS; i++) {
      for (let k = 0; k < runs.length; k++) {
        const n = (i + k) % runs.length;
        const rt = runs[n]!;
        const t0 = performance.now();
        rt.step(rt.ctx.time.tickMs, []);
        if (i >= WARM_TICKS) ticks[n]!.push(performance.now() - t0);
      }
    }
    // The same work: every orbiter ends where the system put it.
    const [system, ...scripts] = runs;
    for (const id of ["orbiter-0", `orbiter-${COUNT - 1}`]) {
      const want = system!.ctx.poses.get(id);
      expect(want).toBeDefined();
      for (const rt of scripts) expect(rt.ctx.poses.get(id), id).toStrictEqual(want);
    }
    const [systemMs, classMs, functionMs] = ticks.map(median) as [number, number, number];
    const ms = (x: number) => x.toFixed(3);
    console.info(
      `${COUNT} orbiters: one system ${ms(systemMs)} ms/tick (median), script class ${ms(classMs)} (ratio ${(classMs / systemMs).toFixed(3)}), function script ${ms(functionMs)} (ratio ${(functionMs / systemMs).toFixed(3)})`,
    );
    expect(classMs).toBeLessThanOrEqual(systemMs * BUDGET);
    expect(functionMs).toBeLessThanOrEqual(systemMs * BUDGET);
    for (const rt of runs) rt.destroy();
  }, 120_000);
});
