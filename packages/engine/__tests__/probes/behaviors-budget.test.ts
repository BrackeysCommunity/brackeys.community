// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { NAV_AGENT, type NavAgentSystem } from "../../game/behaviors/nav-agent";
import { createRegistry, defineGame } from "../../game/define";
import type { EngineContext, GameDefinition } from "../../game/types";
import { createHeadlessRuntime } from "../../headless/headless";
import { createRunTiming, type RunTiming } from "../../runtime/timing";
import { NAV_ARRIVED, NAV_BLOCKED, type SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";

/**
 * Wall-clock budgets for the standard behaviors, measured against what
 * they replace. Each comparison steps its two runtimes in turn, tick by
 * tick, and compares the medians of their tick times: whatever else loads
 * the machine falls on both alike.
 */

const CROWD = 2000;
const CRATES = 500;
const MEASURED_TICKS = 300;
/** The crowd's ticks are each ~2000 agents' work in both runs, so it samples fewer to stay inside its timeout on a loaded runner. */
const CROWD_MEASURED_TICKS = 60;
/** The most a behavior's part may take per tick, on average, in a scene that carries none. */
const IDLE_LAP_MS = 0.01;

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const median = (xs: readonly number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const round = (ms: number) => Math.round(ms * 1000) / 1000;

type Timed = { rt: SceneRuntimeHandle; timing: RunTiming };

/** One tick of `run`: its wall time, and each part's. */
function timedTick(run: Timed): { tick: number; parts: Record<string, number> } {
  run.timing.reset();
  run.rt.step(run.rt.ctx.time.tickMs, []);
  const { tick } = run.timing.report();
  return {
    tick: tick.totalMs,
    parts: Object.fromEntries(Object.entries(tick.parts).map(([k, v]) => [k, v.totalMs])),
  };
}

type Measured = { ticks: number[]; parts: Record<string, number[]> };

/** Steps both runs `warm` ticks, then times `measured` ticks of each, alternating. */
function race(a: Timed, b: Timed, warm: number, measured = MEASURED_TICKS): [Measured, Measured] {
  for (let i = 0; i < warm; i++) {
    a.rt.step(a.rt.ctx.time.tickMs, []);
    b.rt.step(b.rt.ctx.time.tickMs, []);
  }
  const out: [Measured, Measured] = [
    { ticks: [], parts: {} },
    { ticks: [], parts: {} },
  ];
  for (let i = 0; i < measured; i++) {
    for (const [n, run] of [a, b].entries()) {
      const sample = timedTick(run);
      const into = out[n]!;
      into.ticks.push(sample.tick);
      for (const [part, ms] of Object.entries(sample.parts)) (into.parts[part] ??= []).push(ms);
    }
  }
  return out;
}

function timed(open: (timing: RunTiming) => SceneRuntimeHandle): Timed {
  const timing = createRunTiming(() => performance.now());
  return { rt: open(timing), timing };
}

const repoFile = (path: string) => new URL(`../../../../${path}`, import.meta.url);

// ─── The crowd ───────────────────────────────────────────

/** The stress game's walk areas and pillars, from its crowd scene. */
const crowdScene = JSON.parse(
  readFileSync(repoFile("src/games/stress/scenes/crowd.json"), "utf8"),
) as SceneDefinition;

/** How the stress game's crowd roams: a new point within this far, every this many ticks. */
const ROAM = 8;
const REPATH_TICKS = 180;

/**
 * Walks `CROWD` nav-agents over the crowd scene's walk areas the way the
 * stress game walks its own crowd: each spawned at a random walkable point,
 * sent first on a tick staggered by its place, then to a new point within
 * `ROAM` m every `REPATH_TICKS` ticks or once it arrives.
 */
function navCrowdGame(): GameDefinition {
  return defineGame({
    id: "nav-crowd",
    types: [],
    actions: [],
    world: { physics: "rapier", gravity: [0, 12], lengthUnit: 100 },
    time: { kind: "fixed", rate: 60 },
    createRuntime(ctx: EngineContext) {
      const agents: { id: string; due: number }[] = [];
      const index = new Map<string, number>();
      const wander = ctx.random.fork("wander");
      const nav = () => ctx.behavior<NavAgentSystem>(NAV_AGENT.name)!;

      const walkable = (cx: number, cy: number, rx: number, ry: number) => {
        const [x0, y0, x1, y1] = ctx.bounds;
        const [px, py] = [Math.round(rx * 100), Math.round(ry * 100)];
        for (let tries = 0; tries < 8; tries++) {
          const p = {
            x: Math.min(x1, Math.max(x0, cx + wander.range(-px, px) / 100)),
            y: Math.min(y1, Math.max(y0, cy + wander.range(-py, py) / 100)),
          };
          if (ctx.nav!.contains(p)) return p;
        }
        return null;
      };

      return {
        onLoad() {
          const [x0, y0, x1, y1] = ctx.bounds;
          const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
          for (let n = 0; n < CROWD; n++) {
            const at =
              walkable(mid.x, mid.y, (x1 - x0) / 2, (y1 - y0) / 2) ?? ctx.nav!.nearest(mid);
            const { id } = ctx.spawn({
              type: "marker",
              at: [at.x, at.y],
              behaviors: { "nav-agent": {} },
            });
            index.set(id, agents.length);
            agents.push({ id, due: n % REPATH_TICKS });
          }
        },
        beforeStep() {
          for (const a of agents) {
            if (ctx.tick < a.due) continue;
            const p = ctx.poses.get(a.id)!;
            const to = walkable(p.x, p.y, ROAM, ROAM);
            if (to) nav().setDestination(a.id, to);
            a.due = ctx.tick + REPATH_TICKS;
          }
        },
        afterStep(_dt, events) {
          for (const e of events) {
            if (e.type !== NAV_ARRIVED && e.type !== NAV_BLOCKED) continue;
            const n = index.get(e.entityId ?? "");
            if (n !== undefined) agents[n]!.due = ctx.tick + 1;
          }
        },
        snapshot: () => null,
        restore() {},
      };
    },
  });
}

const walkAreas = (): EntityDef[] => (crowdScene.entities ?? []).filter((e) => e.type === "nav");

// ─── The crates ──────────────────────────────────────────

const CRATE_HW = 0.14;
const CRATE_HH = 0.12;

function bodiesGame(): GameDefinition {
  return defineGame({
    id: "crates",
    types: [],
    actions: [],
    world: { physics: "rapier", gravity: [0, 12], lengthUnit: 100 },
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null, restore() {} }),
  });
}

/** 500 crates in a 25 × 20 stack over a walled floor, as `prop`s or as markers with a dynamic `body`. */
function cratesScene(as: "prop" | "body"): SceneDefinition {
  const crates: EntityDef[] = [];
  for (let i = 0; i < CRATES; i++) {
    const x = 1 + (i % 25) * 0.4 + (Math.floor(i / 25) % 2) * 0.1;
    const y = 9 - Math.floor(i / 25) * 0.3;
    const id = `crate-${i}`;
    crates.push(
      as === "prop"
        ? ({
            id,
            type: "prop",
            shape: ["box", x, y, CRATE_HW, CRATE_HH],
            density: 2,
            restitution: 0,
          } as EntityDef)
        : ({
            id,
            type: "marker",
            at: [x, y],
            behaviors: {
              collider: { shape: ["box", 0, 0, CRATE_HW, CRATE_HH], density: 2, restitution: 0 },
              body: { kind: "dynamic" },
            },
          } as EntityDef),
    );
  }
  return {
    v: 4,
    game: "crates",
    name: `crates-${as}`,
    bounds: [0, 0, 12, 12],
    entities: [
      { id: "floor", type: "solid", shape: ["box", 6, 10, 6, 0.2] },
      { id: "west", type: "solid", shape: ["box", 0.2, 5, 0.2, 5] },
      { id: "east", type: "solid", shape: ["box", 11.8, 5, 0.2, 5] },
      ...crates,
    ],
  };
}

describe("standard behavior budgets", () => {
  it(`walks ${CROWD} nav-agents within the stress game's own crowd tick time plus 20%`, async () => {
    // The stress game is the yardstick, loaded by path so the engine's typecheck stays off it.
    const stressPath = repoFile("src/games/stress/index.ts").href;
    const { stressGame } = (await import(/* @vite-ignore */ stressPath)) as {
      stressGame: GameDefinition;
    };
    const stressRegistry = createRegistry(stressGame);
    const stress = timed((timing) =>
      createHeadlessRuntime({
        rapier,
        game: stressGame,
        registry: stressRegistry,
        scene: expandScene(
          { ...crowdScene, settings: { ...crowdScene.settings, crowd: CROWD } },
          stressRegistry,
        ),
        timing,
      }),
    );
    const game = navCrowdGame();
    const registry = createRegistry(game);
    const agents = timed((timing) =>
      createHeadlessRuntime({
        rapier,
        game,
        registry,
        scene: expandScene(
          {
            v: 4,
            game: game.id,
            name: "nav-crowd",
            bounds: crowdScene.bounds,
            settings: { gravity: [0, 12] },
            entities: walkAreas(),
          },
          registry,
        ),
        timing,
      }),
    );
    expect((stress.rt.snapshot() as { agents: number }).agents).toBe(CROWD);
    expect(agents.rt.ctx.behavior<NavAgentSystem>(NAV_AGENT.name)!.size()).toBe(CROWD);

    // Every agent has had its first route by the end of the warm-up.
    const [own, behaviors] = race(stress, agents, REPATH_TICKS + 10, CROWD_MEASURED_TICKS);
    const ownMs = median(own.ticks);
    const behaviorMs = median(behaviors.ticks);
    const navMs = median(behaviors.parts[`behavior.${NAV_AGENT.name}.beforeStep`] ?? [0]);
    console.info(
      `crowd of ${CROWD}: stress game ${round(ownMs)} ms/tick (median), nav-agents ${round(behaviorMs)} ms/tick (nav-agent ${round(navMs)}), ratio ${(behaviorMs / ownMs).toFixed(3)}`,
    );
    expect(behaviorMs).toBeLessThanOrEqual(ownMs * 1.2);
    stress.rt.destroy();
    agents.rt.destroy();
  }, 180_000);

  it(`costs ${CRATES} dynamic body crates within 10% of ${CRATES} props`, () => {
    const game = bodiesGame();
    const registry = createRegistry(game);
    const open = (as: "prop" | "body") =>
      timed((timing) =>
        createHeadlessRuntime({
          rapier,
          game,
          registry,
          scene: expandScene(cratesScene(as), registry),
          timing,
        }),
      );
    const [props, bodies] = [open("prop"), open("body")];
    expect(bodies.rt.ctx.physics?.world.bodies.len()).toBe(
      props.rt.ctx.physics?.world.bodies.len(),
    );

    // Measured while the stack falls and settles, before the pile sleeps.
    const [p, b] = race(props, bodies, 20);
    const propMs = median(p.ticks);
    const bodyMs = median(b.ticks);
    console.info(
      `${CRATES} crates: props ${round(propMs)} ms/tick (median), body behavior ${round(bodyMs)} ms/tick, ratio ${(bodyMs / propMs).toFixed(3)}`,
    );
    expect(bodyMs).toBeLessThanOrEqual(propMs * 1.1);
    // Both piles fell the same way, so each run did the same physics work.
    for (const id of ["crate-0", `crate-${CRATES - 1}`])
      expect(bodies.rt.ctx.poses.get(id), id).toStrictEqual(props.rt.ctx.poses.get(id));

    // The props scene carries no behavior: what each behavior's hooks cost it, per tick.
    const idle = Object.entries(p.parts).filter(([part]) => part.startsWith("behavior."));
    expect(idle.length).toBeGreaterThan(0);
    const laps = idle.map(([part, ms]) => {
      const mean = ms.reduce((s, x) => s + x, 0) / MEASURED_TICKS;
      return { part, mean, max: Math.max(...ms) };
    });
    console.info(
      `idle behavior laps (mean / max ms per tick): ${laps.map((l) => `${l.part} ${round(l.mean)} / ${round(l.max)}`).join(", ")}`,
    );
    for (const lap of laps) expect(lap.mean, lap.part).toBeLessThanOrEqual(IDLE_LAP_MS);
    props.rt.destroy();
    bodies.rt.destroy();
  }, 120_000);
});
