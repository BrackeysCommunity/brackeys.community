import { z } from "zod";

import { defineEntityType, defineGame } from "../../game/define";
import { bodyShapeField, PathSchema, pointField } from "../../game/fields";
import { runtimeId } from "../../game/runtime-ids";
import type { EngineContext } from "../../game/types";
import type { EmitterFile } from "../../project/kinds/emitter";
import { CONTACT_START, ENTITY_DESTROYED, type StepEvent } from "../../runtime/types";
import { DEFAULT_LAYERS, type SceneLayerDef } from "../../scene/layers";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "shooter";
const TURRET = "turret";
const BULLET = "bullet";
const RUNNER = "runner";
const GROUND = "ground";
const BARRIER = "barrier";
const DECOR = "decor";

/** Bullets the turret fires in a run; it fires one a tick while `fire` is held. */
export const SHOTS = 1000;
/** m/s along the bullet's path: 0.1 m a tick at 60 Hz, under the walls' 0.16 m thickness. */
const SPEED = 6;
/** Metres, well past the walls, so a bullet always meets one before its path turns back. */
const RANGE = 20;
/** Long enough to cross the arena; a bullet that outlives it missed every wall. */
const LIFETIME_MS = 1500;
/** The bullet's radius, m. */
const RADIUS = 0.03;
/** The emitter preset each bullet trails. */
export const TRAIL = "trail";
/** Shake trauma a bullet's hit adds; the rig caps the sum at 1. */
const HIT_TRAUMA = 0.15;
/** Shake trauma a barrier's fall adds. */
const BREAK_TRAUMA = 0.6;

/** A short spray of sparks behind a bullet. */
export const TRAIL_PRESET: EmitterFile = {
  kind: "emitter",
  v: 1,
  rate: 40,
  lifeMs: [120, 240],
  speed: [0.2, 0.6],
  angle: [0, 360],
  damping: 2,
  alpha: [
    [0, 1],
    [1, 0],
  ],
  scale: [
    [0, 1],
    [1, 0.3],
  ],
  shape: { kind: "circle", r: 0.02 },
  max: 64,
};

// The runner course, metres. It lies under the arena, so the two never meet.
/** Each chunk's width; chunk k spans x from k·CHUNK to (k+1)·CHUNK. */
const CHUNK = 3.2;
/** The runner's centre line. */
const LANE_Y = 8.4;
/** Where the runner starts along the lane. */
const START_X = 0.8;
/** m/s: 0.05 m a tick at 60 Hz. */
const RUN_SPEED = 3;
/** How far ahead of the runner the course is kept built. */
const AHEAD = 6.4;
/** How far behind the runner a chunk's right edge goes before the chunk is destroyed. */
const BEHIND = 3.2;
/** The most chunks ever alive at once: those within `AHEAD + BEHIND` of the runner, plus the one being entered. */
const LIVE_MAX = Math.ceil((AHEAD + BEHIND) / CHUNK) + 1;
/** Chunks the runner must pass to win. */
const GOAL = 12;
/** Ticks between the runner's shots while `fire` is held. */
const FIRE_EVERY = 10;
/** Hits that bring a barrier down. */
const BARRIER_HITS = 3;
const RUNNER_RADIUS = 0.2;
/** Far and near backdrops: each scrolls by its factor of the camera's movement. */
const FAR = "far";
const NEAR = "near";

const LAYERS: readonly SceneLayerDef[] = [
  { name: FAR, description: "The farthest backdrop.", draw: -20, scroll: [0.25, 0.25] },
  { name: NEAR, description: "A nearer backdrop.", draw: -10, scroll: [0.6, 0.6] },
  ...DEFAULT_LAYERS,
];

const AIM: Readonly<Record<string, Pt>> = {
  "aim-left": [-1, 0],
  "aim-right": [1, 0],
  "aim-up": [0, -1],
  "aim-down": [0, 1],
};

/** The runner course's state: only in a run whose `settings.course` is `runner`. */
export type CourseSnapshot = {
  /** Chunks built so far; the next one built is chunk `built`. */
  built: number;
  /** Chunks destroyed behind the runner; the next one destroyed is chunk `dropped`. */
  dropped: number;
  /** The most chunks alive at once. */
  peak: number;
  /** Chunks the runner has passed the start of, beyond the first. */
  passed: number;
  /** Barriers brought down. */
  cleared: number;
  /** Hits on each standing barrier, by id. */
  struck: Record<string, number>;
  /** Ticks until the runner may fire again. */
  reload: number;
  /** The standing barrier the runner ran into, if any. */
  crashed: string | null;
  /** An FNV-1a hash of each dropped chunk's ground id, in order. */
  ids: number;
};

export type ShooterSnapshot = {
  fired: number;
  /** Bullets destroyed by a wall contact. */
  hit: number;
  /** Bullets their lifetime destroyed instead. */
  expired: number;
  live: number;
  /**
   * An FNV-1a hash of the destroyed ids in order. The report caps its events,
   * so this is what puts all thousand ids into the recording's end digest.
   */
  ids: number;
  /** The first spawn whose id wasn't the next `<type>#<n>`, if any. */
  misnamed: string | null;
  course?: CourseSnapshot;
};

/** A copy in the field order `freshCourse` writes, which a save's sorted keys don't keep. */
function copyCourse(c: CourseSnapshot): CourseSnapshot {
  return {
    built: c.built,
    dropped: c.dropped,
    peak: c.peak,
    passed: c.passed,
    cleared: c.cleared,
    struck: { ...c.struck },
    reload: c.reload,
    crashed: c.crashed,
    ids: c.ids,
  };
}

function fnv(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The ids chunk `k` is built from, in build order; chunk 0, where the runner starts, has no barrier. */
function chunkIds(k: number): string[] {
  return [
    runtimeId(GROUND, k + 1),
    runtimeId(DECOR, 2 * k + 1),
    runtimeId(DECOR, 2 * k + 2),
    ...(k > 0 ? [runtimeId(BARRIER, k)] : []),
  ];
}

const turret = defineEntityType({
  type: TURRET,
  description: "Where bullets are fired from.",
  base: "marker",
  fields: { at: pointField("The muzzle, in world metres.") },
  ascii: "T",
});

const bullet = defineEntityType({
  type: BULLET,
  description: "A projectile riding a straight path away from its turret.",
  base: "follower",
  spawnOnly: true,
  fields: {
    shape: bodyShapeField("The bullet's collider, centred on its path point."),
    path: PathSchema,
  },
});

const runner = defineEntityType({
  type: RUNNER,
  description: "Runs along the course at a steady speed, firing ahead.",
  base: "follower",
  spawnOnly: true,
  fields: {
    shape: bodyShapeField("The runner's collider, centred on its path point."),
    path: PathSchema,
  },
});

const ground = defineEntityType({
  type: GROUND,
  description: "A chunk's floor, built ahead of the runner and destroyed behind it.",
  base: "solid",
  spawnOnly: true,
  fields: { shape: bodyShapeField("The floor's collider.") },
});

const barrier = defineEntityType({
  type: BARRIER,
  description: "Stands across the lane until enough bullets bring it down.",
  base: "solid",
  spawnOnly: true,
  fields: { shape: bodyShapeField("The barrier's collider.") },
});

/**
 * `arena` (default) is a twin-stick turret in a walled room. `runner` is an
 * endless runner on the same input: a runner crosses a course built a chunk
 * at a time ahead of it and torn down behind it, over two parallax
 * backdrops, firing ahead at the barriers.
 */
const game = defineGame<ShooterSnapshot>({
  id: ID,
  types: [turret, bullet, runner, ground, barrier],
  layers: LAYERS,
  settings: {
    course: z
      .enum(["arena", "runner"])
      .optional()
      .describe("arena (default): a turret in a walled room; runner: an endless runner."),
  },
  actions: [
    { action: "fire", keys: [" "], description: "Fire one bullet a tick." },
    ...Object.keys(AIM).map((action) => ({
      action,
      keys: [`Arrow${action.charAt(4).toUpperCase()}${action.slice(5)}`],
      description: `Aim ${action.slice(4)}.`,
    })),
  ],
  time: { kind: "fixed" },
  play: {
    results: ["won", "lost"],
    outcome({ snapshot: s }) {
      if (s.misnamed) return { result: "lost", cause: "an entity got an unexpected id" };
      const c = s.course;
      if (c) {
        if (c.crashed) return { result: "lost", cause: "the runner met a standing barrier" };
        if (c.peak > LIVE_MAX) return { result: "lost", cause: "the course piled up" };
        if (c.passed >= GOAL) return { result: "won", cause: "the runner crossed the course" };
        return null;
      }
      if (s.expired > 0) return { result: "lost", cause: "a bullet missed every wall" };
      if (s.fired === SHOTS && s.live === 0 && s.hit === SHOTS) {
        return { result: "won", cause: "every bullet met a wall" };
      }
      return null;
    },
  },
  createRuntime(ctx: EngineContext) {
    const live = new Set<string>();
    const hits = new Set<string>();
    let muzzle: Pt | null = null;
    let racer: string | null = null;
    let snap: ShooterSnapshot = fresh();

    function fresh(): ShooterSnapshot {
      return { fired: 0, hit: 0, expired: 0, live: 0, ids: 0x811c9dc5, misnamed: null };
    }

    function freshCourse(): CourseSnapshot {
      return {
        built: 0,
        dropped: 0,
        peak: 0,
        passed: 0,
        cleared: 0,
        struck: {},
        reload: 0,
        crashed: null,
        ids: 0x811c9dc5,
      };
    }

    function spawned(type: string, n: number, input: Record<string, unknown>): string {
      const { id } = ctx.spawn({ type, ...input });
      if (id !== runtimeId(type, n)) snap.misnamed ??= id;
      return id;
    }

    function shoot(from: Pt, dx: number, dy: number) {
      const [x, y] = from;
      const n = snap.fired + 1;
      const id = spawned(BULLET, n, {
        shape: ["circle", 0, 0, RADIUS],
        path: {
          pts: [
            [x, y],
            [x + dx * RANGE, y + dy * RANGE],
          ],
          mode: "ping_pong",
          speed: SPEED,
        },
        behaviors: { lifetime: { ms: LIFETIME_MS }, emitter: { preset: TRAIL } },
      });
      snap.fired = n;
      live.add(id);
    }

    function fire() {
      if (!muzzle || snap.fired >= SHOTS) return;
      let dx = 0;
      let dy = 0;
      for (const [action, d] of Object.entries(AIM)) {
        if (!ctx.input.held(action)) continue;
        dx += d[0];
        dy += d[1];
      }
      if (dx === 0 && dy === 0) return;
      shoot(muzzle, dx, dy);
    }

    function build(c: CourseSnapshot, k: number) {
      const x0 = k * CHUNK;
      const mid = x0 + CHUNK / 2;
      spawned(GROUND, k + 1, {
        shape: ["box", mid, LANE_Y + RUNNER_RADIUS + 0.2, CHUNK / 2, 0.08],
      });
      spawned(DECOR, 2 * k + 1, { at: [mid, LANE_Y - 1.6], layer: FAR });
      spawned(DECOR, 2 * k + 2, { at: [x0 + CHUNK / 4, LANE_Y - 0.8], layer: NEAR });
      if (k > 0) spawned(BARRIER, k, { shape: ["box", mid, LANE_Y, 0.08, 0.32] });
      c.built = k + 1;
    }

    function drop(c: CourseSnapshot, k: number) {
      for (const id of chunkIds(k)) if (ctx.exists(id)) ctx.destroy(id);
      c.ids = fnv(c.ids, runtimeId(GROUND, k + 1));
      c.dropped = k + 1;
    }

    /** Builds the course ahead of the runner, tears it down behind, and fires ahead. */
    function run(c: CourseSnapshot) {
      if (racer === null) {
        racer = spawned(RUNNER, 1, {
          shape: ["circle", 0, 0, RUNNER_RADIUS],
          path: {
            pts: [
              [START_X, LANE_Y],
              [START_X + GOAL * CHUNK * 4, LANE_Y],
            ],
            mode: "ping_pong",
            speed: RUN_SPEED,
          },
        });
      }
      const pose = ctx.poses.get(racer);
      if (!pose) return;
      while (c.built * CHUNK < pose.x + AHEAD) build(c, c.built);
      while ((c.dropped + 1) * CHUNK < pose.x - BEHIND) drop(c, c.dropped);
      c.peak = Math.max(c.peak, c.built - c.dropped);
      c.passed = Math.floor(pose.x / CHUNK);
      if (c.reload > 0) c.reload--;
      if (ctx.input.held("fire") && c.reload === 0) {
        shoot([pose.x + RUNNER_RADIUS + 0.1, pose.y], 1, 0);
        c.reload = FIRE_EVERY;
      }
    }

    function strike(c: CourseSnapshot, id: string) {
      const n = (c.struck[id] ?? 0) + 1;
      c.struck[id] = n;
      if (n !== BARRIER_HITS) return;
      c.cleared++;
      ctx.destroy(id);
      ctx.present.camera.shake(BREAK_TRAUMA);
    }

    return {
      onLoad(scene) {
        live.clear();
        hits.clear();
        racer = null;
        snap = fresh();
        if (scene.settings.course === "runner") snap.course = freshCourse();
        const at = scene.entities.find((e) => e.type === TURRET)?.at as Pt | undefined;
        muzzle = at ?? null;
        for (const solid of ["solid", GROUND, BARRIER])
          ctx.contacts.watch({ type: BULLET }, { type: solid });
        ctx.contacts.watch({ type: RUNNER }, { type: BARRIER });
        ctx.events.on(CONTACT_START, (e: StepEvent) => {
          const id = e.entityId;
          if (!id) return;
          if (id === racer) {
            if (snap.course && e.other) snap.course.crashed ??= e.other;
            return;
          }
          if (hits.has(id)) return;
          hits.add(id);
          ctx.destroy(id);
          ctx.present.camera.shake(HIT_TRAUMA);
          if (snap.course && e.other && ctx.get(e.other)?.type === BARRIER)
            strike(snap.course, e.other);
        });
        ctx.events.on(ENTITY_DESTROYED, (e: StepEvent) => {
          const id = e.entityId;
          if (!id) return;
          if (snap.course && id in snap.course.struck) delete snap.course.struck[id];
          if (!live.delete(id)) return;
          if (hits.delete(id)) snap.hit++;
          else snap.expired++;
          snap.ids = fnv(snap.ids, id);
        });
      },
      onUnload() {
        muzzle = null;
        racer = null;
        live.clear();
        hits.clear();
      },
      beforeStep() {
        if (snap.course) run(snap.course);
        else if (ctx.input.held("fire")) fire();
      },
      cameraTarget() {
        const pose = racer === null ? undefined : ctx.poses.get(racer);
        return pose ? { x: pose.x, y: pose.y } : null;
      },
      snapshot() {
        const out: ShooterSnapshot = { ...snap, live: live.size };
        if (snap.course) out.course = copyCourse(snap.course);
        return out;
      },
      // The bullets, the runner and the course come back with the world save; between ticks none is hit and not yet destroyed.
      restore(s) {
        snap = { ...fresh(), fired: s.fired, hit: s.hit, expired: s.expired, ids: s.ids };
        snap.misnamed = s.misnamed;
        if (s.course) snap.course = copyCourse(s.course);
        live.clear();
        for (const id of ctx.query.byType(BULLET)) live.add(id);
        hits.clear();
        racer = ctx.query.byType(RUNNER)[0] ?? null;
      },
    };
  },
});

const wall = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
});

/**
 * A closed 6.4 m arena with 0.16 m walls, a pillar in the north-east
 * quarter that the diagonal stream meets first, and the turret off-centre
 * so each side's bullets travel a different distance. The bounds run on
 * east and south over the runner's course, which is built at runtime.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "shooter-probe",
  bounds: [0, 0, (GOAL + 4) * CHUNK, LANE_Y + 1.2],
  settings: { gravity: [0, 0], physics: "rapier" },
  assets: [TRAIL],
  entities: [
    wall("north", 3.2, 0.08, 3.2, 0.08),
    wall("south", 3.2, 6.32, 3.2, 0.08),
    wall("west", 0.08, 3.2, 0.08, 3.04),
    wall("east", 6.32, 3.2, 0.08, 3.04),
    wall("pillar", 4.8, 1.4, 0.24, 0.24),
    { id: "muzzle", type: TURRET, at: [2.8, 3] },
  ],
};

const RUNNER_COURSE = { course: "runner" } as const;
const RUNNER_PHYSICS_NONE = { ...RUNNER_COURSE, physics: "none" } as const;

/**
 * Zero gravity, twin-stick aim: a turret fires a thousand bullets in five
 * streams, each one spawned at runtime with a lifetime and a particle trail
 * and destroyed by its first wall contact, each hit shaking the camera. It
 * wins only when the ids spawned were exactly `bullet#1` to `bullet#1000`
 * and each was destroyed by a wall; the destroyed ids' hash is in the
 * snapshot, so the replay check proves both runs name the same ids in the
 * same order. The trails and the shake are presentation, so the run's
 * digest is the same with or without a view.
 *
 * The `runner` variants play the same input as an endless runner: chunks
 * built ahead and destroyed behind, never more than `LIVE_MAX` alive, the
 * runner firing ahead every `FIRE_EVERY` ticks while `fire` is held and
 * winning once `GOAL` chunks are behind it with every barrier brought down
 * before it arrived.
 */
export const shooterProbe: GenreProbe<ShooterSnapshot> = {
  id: ID,
  rows: ["twin-stick", "endless-runner", "tower-defense"],
  game,
  scene,
  project: { files: [{ path: `fx/${TRAIL}.json`, json: TRAIL_PRESET }] },
  recordPresentation: true,
  view: true,
  script: {
    v: 1,
    scene: scene.name,
    maxTicks: 1300,
    steps: [
      { hold: ["fire", "aim-right"], for: 200 },
      { hold: ["fire", "aim-down"], for: 200 },
      { hold: ["fire", "aim-left"], for: 200 },
      { hold: ["fire", "aim-up"], for: 200 },
      { hold: ["fire", "aim-up", "aim-right"], for: 200 },
      { hold: [], until: { count: { type: BULLET, max: 0 } }, max: 200 },
    ],
  },
  expect: { result: "won", maxTicks: 1300 },
  variants: [
    { name: "physics-none", settings: { physics: "none" } },
    // Mid-stream, bullets in flight; a world save needs the geometry backend.
    { name: "saved-physics-none", settings: { physics: "none" }, saveAt: 300 },
    { name: "runner", settings: RUNNER_COURSE },
    { name: "runner-physics-none", settings: RUNNER_PHYSICS_NONE },
    // Mid-course: chunks built ahead and dropped behind, bullets in flight.
    { name: "saved-runner-physics-none", settings: RUNNER_PHYSICS_NONE, saveAt: 400 },
  ],
  timeoutMs: 30_000,
};
