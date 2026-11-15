import os from "node:os";

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
 * Temporary diagnostic, always passing: prints, per form, where an orbit
 * tick goes (runtime phases and the behavior's own lap, on an injected
 * clock), plus Node, V8, arch and CPU, so a CI log shows why the function
 * form costs more there than locally. Variants split the function form's
 * differences from the class form: state in a closure `let` versus on an
 * object, and hooks as per-entity closures versus shared methods.
 *
 * Mirror of scripts-budget's setup. What a script costs against the same work written as one system: 2,000
 * entities each circling its start, once as a behavior system over a map,
 * once as a script class and once as a function script. The runs step in
 * turn, tick by tick, in a rotating order, so whatever else loads the
 * machine falls on all of them alike. What is compared is each run's fast
 * tick, the 10th percentile: the work is the same every tick, so a slower
 * tick is time another process took, and the median of a busy CI runner
 * carries that into the ratio. The ratios are printed with the medians';
 * only past 2× is it a failure.
 */

const COUNT = 2000;
const WARM_TICKS = 30;
const MEASURED_TICKS = 300;
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

const asFunctionBoxed = defineScript({
  name: NAME,
  description: "Circles the entity round where it started.",
  fields,
  create(self) {
    const box: { o: Orbit | undefined } = { o: undefined };
    return {
      awake() {
        box.o = startOf(self.ctx, self.entity.id);
      },
      step(dtMs: number) {
        orbit(self.ctx, self.entity.id, box.o!, self.fields.radius, self.fields.turn, dtMs);
      },
    };
  },
});

type Shared = {
  self: { ctx: EngineContext; entity: { id: string }; fields: Record<string, number> };
  o?: Orbit;
};
const sharedHooks = {
  awake(this: Shared) {
    this.o = startOf(this.self.ctx, this.self.entity.id);
  },
  step(this: Shared, dtMs: number) {
    const s = this.self;
    orbit(s.ctx, s.entity.id, this.o!, s.fields.radius!, s.fields.turn!, dtMs);
  },
};
const asFunctionShared = defineScript({
  name: NAME,
  description: "Circles the entity round where it started.",
  fields,
  create(self) {
    const h = Object.create(sharedHooks) as Shared & typeof sharedHooks;
    h.self = self as unknown as Shared["self"];
    h.o = undefined;
    return h;
  },
});

const entities: EntityDef[] = Array.from({ length: COUNT }, (_, n) => ({
  id: `orbiter-${n}`,
  type: "marker",
  at: [(n % 50) * 2, Math.floor(n / 50) * 2],
  behaviors: { [NAME]: {} },
}));

function open(behavior: BehaviorDef | typeof AsClass, timed: boolean): SceneRuntimeHandle {
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
  return createHeadlessRuntime({
    rapier: null,
    game,
    registry,
    scene,
    ...(timed ? { timings: { clock: () => performance.now(), window: 100 } } : {}),
  });
}

/** The value `p` of the way up `xs` sorted, interpolated between neighbours. */
const quantile = (xs: readonly number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  return sorted[lo]! + (sorted[Math.ceil(at)]! - sorted[lo]!) * (at - lo);
};

const FORMS = {
  system: asSystem,
  class: AsClass,
  function: asFunction,
  "function, boxed state": asFunctionBoxed,
  "function, shared methods": asFunctionShared,
} as const;

describe("scripts breakdown (diagnostic)", () => {
  it("prints where each form's tick goes", () => {
    const names = Object.keys(FORMS) as (keyof typeof FORMS)[];
    const lines = [
      `node ${process.version} v8 ${process.versions.v8} ${process.platform}/${process.arch} cpu ${os.cpus()[0]?.model ?? "?"} x${os.cpus().length}`,
    ];
    for (const timed of [false, true]) {
      const runs = names.map((n) => open(FORMS[n], timed));
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
      const base = quantile(ticks[0]!, 0.1);
      names.forEach((name, n) => {
        const p10 = quantile(ticks[n]!, 0.1);
        let line = `[${timed ? "timed" : "untimed"}] ${name}: p10 ${p10.toFixed(3)} ms, median ${quantile(ticks[n]!, 0.5).toFixed(3)} ms, ratio ${(p10 / base).toFixed(3)}`;
        const t = runs[n]!.timings();
        if (t) {
          const phases = Object.entries(t.phases)
            .filter(([, s]) => s.mean > 0.001)
            .map(([p, s]) => `${p} ${s.mean.toFixed(3)}`)
            .join(", ");
          const behaviors = Object.entries(t.behaviors)
            .map(([b, s]) => `${b} ${s.mean.toFixed(3)}`)
            .join(", ");
          line += ` | phases: ${phases} | behaviors: ${behaviors}`;
        }
        lines.push(line);
      });
      for (const rt of runs) rt.destroy();
    }
    console.info(`scripts breakdown\n${lines.join("\n")}`);
    expect(lines.length).toBeGreaterThan(1);
  }, 120_000);
});
