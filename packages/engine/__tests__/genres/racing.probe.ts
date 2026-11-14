import { defineGame } from "../../game/define";
import type { EngineContext, PlayState } from "../../game/types";
import type { InputScriptStep } from "../../headless/playtest-types";
import { createMotionBody, type MotionBody } from "../../motion/body";
import { SENSOR_ENTER } from "../../runtime/types";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "racing";
const CAR = "marker#car";
/** The marker the car is spawned at. */
const START = "start";
const GHOST = "ghost";
/** The gates in the order a lap passes them; the last is the finish line. */
const GATES = ["gate-1", "gate-2", "gate-3", "gate-0"] as const;
const LAPS = 3;
/** Raised when the car passes the next gate in order, at the gate; `data` is `{ lap }`, laps done. */
const GATE = `${ID}:gate`;
/** Raised when the car crosses the finish line after every other gate; `data` is `{ lap }`. */
const LAP = `${ID}:lap`;
/** Raised when the ghost stands anywhere but its recording's pose for the tick. */
const GHOST_OFF = `${ID}:ghost-off`;

/** N per axis held; with the car's damping its top speed is about 5 m/s. */
const THRUST = 1.6;
/** The car's radius, m. */
const RADIUS = 0.25;
/** The car's linear damping, /s, and its tyres' friction against the rails. */
const DAMPING = 1.2;
const CAR_FRICTION = 0.3;
/** Slows the spin the rails' friction gives the disc, /s. */
const SPIN_DAMPING = 4;
/** kg: the disc at the collider's default density of 1 kg/m². */
const CAR_MASS = Math.PI * RADIUS * RADIUS;

/** Ticks between two poses of the ghost's recording: a playtest trail's spacing. */
const GHOST_EVERY = 4;
/**
 * The ghost's lap: the playtest trail (`PlaytestReport.trail.pts`, every
 * fourth tick) of this probe's second lap with 1.9 N of thrust, pinned as
 * x, y pairs in metres. The ghost replays it on a loop, finish line to
 * finish line.
 */
const GHOST_TRAIL: readonly number[] = [
  6.08, 0.27, 6.44, 0.33, 6.81, 0.43, 7.2, 0.56, 7.6, 0.73, 8, 0.92, 8.42, 1.14, 8.85, 1.39, 9.29,
  1.65, 9.69, 1.78, 10.06, 1.76, 10.45, 1.78, 10.84, 1.85, 11.25, 1.94, 11.67, 2.08, 11.76, 2.19,
  11.76, 2.3, 11.75, 2.44, 11.75, 2.6, 11.75, 2.78, 11.75, 2.98, 11.75, 3.19, 11.75, 3.42, 11.75,
  3.66, 11.74, 3.92, 11.69, 4.2, 11.6, 4.5, 11.47, 4.82, 11.32, 5.15, 11.13, 5.5, 10.92, 5.87,
  10.68, 6.25, 10.42, 6.64, 10.13, 7.05, 9.83, 7.46, 9.54, 7.77, 9.31, 7.76, 9.07, 7.75, 8.81, 7.75,
  8.54, 7.75, 8.26, 7.75, 7.98, 7.75, 7.68, 7.75, 7.37, 7.75, 7.06, 7.75, 6.74, 7.75, 6.41, 7.75,
  6.08, 7.75, 5.73, 7.7, 5.36, 7.62, 4.98, 7.51, 4.59, 7.36, 4.19, 7.18, 3.77, 6.97, 3.35, 6.74,
  2.92, 6.48, 2.48, 6.21, 2.11, 6.23, 1.73, 6.23, 1.34, 6.19, 0.94, 6.11, 0.53, 5.99, 0.22, 5.86,
  0.24, 5.76, 0.24, 5.64, 0.25, 5.49, 0.25, 5.32, 0.25, 5.13, 0.25, 4.93, 0.25, 4.71, 0.25, 4.47,
  0.25, 4.23, 0.27, 3.96, 0.33, 3.68, 0.43, 3.37, 0.56, 3.05, 0.73, 2.71, 0.92, 2.35, 1.14, 1.98,
  1.39, 1.59, 1.65, 1.2, 1.94, 0.79, 2.25, 0.37, 2.51, 0.2, 2.74, 0.23, 2.98, 0.24, 3.24, 0.25,
  3.51, 0.25, 3.79, 0.25, 4.08, 0.25, 4.38, 0.25, 4.69, 0.25, 5, 0.25, 5.33, 0.25, 5.66, 0.25,
];
const GHOST_LAP: readonly Pt[] = Array.from({ length: GHOST_TRAIL.length / 2 }, (_, i) => [
  GHOST_TRAIL[2 * i]!,
  GHOST_TRAIL[2 * i + 1]!,
]);

export type RacingSnapshot = {
  /** Ticks simulated. */
  tick: number;
  car: Pt;
  velocity: Pt;
  /** Index into `GATES` of the gate the car must pass next. */
  next: number;
  laps: number;
  ghost: Pt;
};

const DIRECTIONS: Readonly<Record<string, Pt>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Where the ghost's recording has it after `tick`, and the ticks left to that pose. */
function ghostTarget(tick: number): { at: Pt; left: number } {
  const span = GHOST_LAP.length * GHOST_EVERY;
  const into = tick % span;
  const at = GHOST_LAP[(Math.floor(into / GHOST_EVERY) + 1) % GHOST_LAP.length]!;
  return { at, left: GHOST_EVERY - (into % GHOST_EVERY) };
}

const game = defineGame<RacingSnapshot>({
  id: ID,
  types: [],
  actions: Object.keys(DIRECTIONS).map((action) => ({
    action,
    keys: [`Arrow${action.charAt(0).toUpperCase()}${action.slice(1)}`],
    description: `Push the car ${action}.`,
  })),
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  materials: {
    rail: {
      friction: 0.2,
      restitution: 0,
      description: "The track's rails: slick enough to slide along.",
    },
  },
  time: { kind: "fixed", rate: 60 },
  camera: { lookAhead: 0.35, maxLead: 1.5, damping: 0.1, deadzone: [0.5, 0.5] },
  play: {
    focus: (snap) => ({ x: snap.car[0], y: snap.car[1] }),
    movementActions: Object.keys(DIRECTIONS),
    results: ["won", "ghost-off"],
    outcome({ events, snapshot }: PlayState<RacingSnapshot>) {
      const off = events.find((e) => e.type === GHOST_OFF);
      if (off) return { result: "ghost-off", cause: "the ghost left its recording" };
      if (snapshot.laps < LAPS) return null;
      return { result: "won", cause: `${LAPS} laps`, entityId: CAR };
    },
  },
  createRuntime(ctx: EngineContext) {
    let tick = 0;
    let next = 0;
    let laps = 0;
    /** Without physics, what moves the car; with Rapier its dynamic body does. */
    let swept: MotionBody | null = null;
    const pose = (id: string): Pt => {
      const p = ctx.poses.get(id);
      return p ? [p.x, p.y] : [0, 0];
    };

    return {
      onLoad(scene) {
        const start = scene.entities.find((e) => e.id === START);
        if (!start) return;
        const [x, y] = start.at as Pt;
        const rapier = ctx.space.backend === "rapier";
        ctx.spawn({
          type: "marker",
          id: CAR,
          at: [x, y],
          behaviors: rapier
            ? {
                collider: { shape: ["circle", 0, 0, RADIUS], friction: CAR_FRICTION },
                body: { kind: "dynamic", linearDamping: DAMPING, angularDamping: SPIN_DAMPING },
                "camera-target": {},
              }
            : { "camera-target": {} },
        });
        if (!rapier)
          swept = createMotionBody(
            ctx,
            { id: CAR, type: "marker" },
            { x, y },
            {
              shape: { type: "circle", cx: 0, cy: 0, r: RADIUS },
            },
          );
      },
      onUnload() {
        swept = null;
      },
      beforeStep(dtMs) {
        let fx = 0;
        let fy = 0;
        for (const [action, [dx, dy]] of Object.entries(DIRECTIONS)) {
          if (!ctx.input.held(action)) continue;
          fx += dx * THRUST;
          fy += dy * THRUST;
        }
        if (swept) {
          // Rapier's damping, integrated by hand: v ← (v + F/m·dt) / (1 + dt·damping).
          const dt = dtMs / 1000;
          const v = swept.velocity();
          const keep = 1 / (1 + dt * DAMPING);
          const vx = (v.x + (fx / CAR_MASS) * dt) * keep;
          const vy = (v.y + (fy / CAR_MASS) * dt) * keep;
          const { moved } = swept.move({ x: vx * dt, y: vy * dt });
          swept.setVelocity({ x: moved.x / dt, y: moved.y / dt });
        } else if (fx !== 0 || fy !== 0) ctx.bodies.applyForce(CAR, { x: fx, y: fy });
        const { at, left } = ghostTarget(tick);
        ctx.tweens.to(GHOST, { to: { x: at[0], y: at[1] }, duration: left, key: GHOST });
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type !== SENSOR_ENTER || e.other !== CAR || e.entityId !== GATES[next]) continue;
          ctx.emit({ type: GATE, entityId: e.entityId, at: e.at, data: { lap: laps } });
          next = (next + 1) % GATES.length;
          if (next === 0) {
            laps++;
            ctx.emit({ type: LAP, entityId: CAR, at: e.at, data: { lap: laps } });
          }
        }
        const { at, left } = ghostTarget(tick);
        const [x, y] = pose(GHOST);
        if (left === 1 && (x !== at[0] || y !== at[1]))
          ctx.emit({ type: GHOST_OFF, entityId: GHOST, at: { x, y }, data: { tick, to: at } });
        tick++;
      },
      snapshot() {
        const v = swept ? swept.velocity() : ctx.bodies.has(CAR) ? ctx.bodies.velocity(CAR) : null;
        return {
          tick,
          car: pose(CAR),
          velocity: v ? [v.x, v.y] : [0, 0],
          next,
          laps,
          ghost: pose(GHOST),
        };
      },
      // The car and its velocity, the ghost's pose and its tween come back with the world save.
      restore(s) {
        tick = s.tick;
        next = s.next;
        laps = s.laps;
      },
    };
  },
});

const wall = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
  material: "rail",
});

/** A gate across the track: a sensor two metres long, `across` the way the car drives through it. */
const gate = (id: string, cx: number, cy: number, across: "x" | "y"): EntityDef => ({
  id,
  type: "sensor",
  shape: ["box", cx, cy, across === "x" ? 0.1 : 1, across === "x" ? 1 : 0.1],
});

/**
 * A rectangular circuit 2 m wide round an 8 × 4 m infield, driven clockwise
 * from just past the finish line. The game spawns the car at `start`: on
 * Rapier a damped dynamic disc that rubs along the rails, so their friction
 * and its damping set its pace.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "racing-probe",
  bounds: [-0.2, -0.2, 12.2, 8.2],
  settings: { gravity: [0, 0], physics: "rapier" },
  entities: [
    wall("north", 6, -0.1, 6.2, 0.1),
    wall("south", 6, 8.1, 6.2, 0.1),
    wall("west", -0.1, 4, 0.1, 4.2),
    wall("east", 12.1, 4, 0.1, 4.2),
    wall("infield", 6, 4, 4, 2),
    gate("gate-0", 6, 1, "x"),
    gate("gate-1", 11, 4, "y"),
    gate("gate-2", 6, 7, "x"),
    gate("gate-3", 1, 4, "y"),
    { id: START, type: "marker", at: [7, 1] },
    {
      id: GHOST,
      type: "decor",
      at: GHOST_LAP[0]!,
      behaviors: { sprite: { size: [RADIUS * 2, RADIUS * 2], alpha: 0.4, tint: 0x88ccff } },
    } as EntityDef,
  ],
};

/** One lap's legs: each pushes along a straight and into the rail beside it until the next gate. */
const LEG_HOLDS: readonly (readonly string[])[] = [
  ["right", "down"],
  ["down", "left"],
  ["left", "up"],
  ["up", "right"],
];

const steps: InputScriptStep[] = [];
for (let lap = 0; lap < LAPS; lap++)
  for (const [i, hold] of LEG_HOLDS.entries())
    steps.push({
      hold: [...hold],
      until: { event: { type: SENSOR_ENTER, entityId: GATES[i]!, other: CAR } },
      max: 400,
    });

/**
 * Zero gravity and Rapier: the car is driven by forces, slowed by its
 * damping and the rails' friction, and must pass four gates in order for a
 * lap. A look-ahead camera follows it (the view run), and a ghost decor
 * replays a pinned recording one tween a tick. Three laps win.
 */
export const racingProbe: GenreProbe<RacingSnapshot> = {
  id: ID,
  rows: ["racing"],
  game,
  scene,
  script: { v: 1, scene: scene.name, maxTicks: 2000, steps },
  expect: { result: "won", maxTicks: 2000 },
  view: true,
  variants: [
    // The same laps without Rapier: a motion body slides the car along the rails, damped by hand.
    { name: "physics-none", settings: { physics: "none" } },
    // World saves need the geometry backend; mid-lap, with the ghost's tween running.
    { name: "saved-mid-lap", settings: { physics: "none" }, saveAt: 300 },
  ],
};
