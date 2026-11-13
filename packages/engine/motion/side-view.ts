import { SIDE_VIEW_CONTROLLER } from "../game/defaults";
import { ticksFor } from "../game/time";
import type { EngineContext, JsonValue } from "../game/types";
import type { SpaceCastHit, SpaceFilter } from "../runtime/space";
import { translateShape } from "../scene/shape-geometry";
import { oneWayPasses } from "../systems/bodies";
import type { Vec2 } from "../types";
import { saveRegistryOf, type MotionBody, type MotionBodyOptions, type MotionResult } from "./body";

export type SideViewOptions = Pick<MotionBodyOptions, "shape" | "group"> & {
  /** m/s along the ground. */
  maxSpeed: number;
  /** m/s² toward the intended speed. */
  accel: number;
  /** m/s² back to rest when there is no intent. */
  decel: number;
  /** The share of `accel` and `decel` it has in the air, 0–1. */
  airControl: number;
  /** m: how high a full jump rises. */
  jumpHeight: number;
  /** Multiplies `ctx.gravity.y`; 0 floats. */
  gravityScale: number;
  /** m/s, > 0. */
  maxFallSpeed: number;
  /** How long after leaving the ground a jump still works, ms. */
  coyoteMs: number;
  /** How long a jump press is kept for the next time a jump is allowed, ms. */
  jumpBufferMs: number;
  /** The share of the upward speed kept when the jump is released early, 0–1. */
  jumpCut: number;
  /** The steepest slope it walks up, degrees; default `SIDE_VIEW_CONTROLLER`'s. */
  maxSlopeDeg?: number;
  /** The tallest step it climbs without jumping, m; 0 climbs none. Default `SIDE_VIEW_CONTROLLER`'s. */
  stepHeight?: number;
  /** How far down it sticks to the ground, m; 0 never snaps. Default `SIDE_VIEW_CONTROLLER`'s. */
  snapToGround?: number;
};

export type SideViewIntent = {
  /** −1 to 1; a larger one is clamped. */
  move: number;
  /** Pressed this tick. */
  jump: boolean;
  /** Held this tick; releasing it while rising cuts the jump. */
  jumpHeld: boolean;
};

export type SideViewEnv = {
  /** What it stands on moved by this much this tick, m. */
  carrier?: Vec2;
  /** An outside acceleration this tick (a force area's), m/s². */
  accel?: Vec2;
};

export type SideViewResult = MotionResult & {
  /** On walkable ground at the end of the tick. */
  grounded: boolean;
  /** Grounded now and not at the start of the tick. */
  landed: boolean;
  /** A jump started this tick. */
  jumped: boolean;
};

export interface SideViewController {
  velocity(): Vec2;
  grounded(): boolean;
  step(dtMs: number, intent: SideViewIntent, env?: SideViewEnv): SideViewResult;
  /** Sets the velocity and leaves the ground, as a jump would without spending one. */
  launch(v: Vec2): void;
  save(): JsonValue;
  restore(state: JsonValue): void;
  /** Drops it from world saves; the body is the caller's to destroy. */
  destroy(): void;
}

/** How far below its feet ground still counts as stood on, m. */
const GROUND_PROBE = 0.002;
/** The gap kept from what it touches, the motion body's. */
const SKIN = SIDE_VIEW_CONTROLLER.offset ?? 0.0001;
const UP: Vec2 = { x: SIDE_VIEW_CONTROLLER.up[0], y: SIDE_VIEW_CONTROLLER.up[1] };
const MIN_STEP_WIDTH = SIDE_VIEW_CONTROLLER.autostep?.minWidth ?? 0;
const MAX_SLIDES = 4;
/** Travel, m, below which a move counts as complete. */
const EPSILON = 1e-5;

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const length = (v: Vec2) => Math.sqrt(dot(v, v));
const zeroResult = (): MotionResult => ({ moved: { x: 0, y: 0 }, hits: [], blocked: false });

/** The ground's direction of travel for `side` (±1): along the surface, perpendicular to `n`. */
const along = (n: Vec2, side: number): Vec2 => ({ x: -n.y * side, y: n.x * side });

type Saved = {
  v: [number, number];
  /** Airborne ticks since the ground; null once a jump spent the coyote window. */
  air: number | null;
  /** Ticks since the buffered jump press; null when none is buffered. */
  press: number | null;
  /** Rising from a jump that can still be cut. */
  rising: boolean;
  /** The ground's normal while grounded. */
  n: [number, number] | null;
};

function readSaved(state: JsonValue): Saved | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const pair = (p: JsonValue | undefined): p is [number, number] =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((x) => typeof x === "number" && Number.isFinite(x));
  const count = (c: JsonValue | undefined): c is number | null =>
    c === null || (typeof c === "number" && Number.isInteger(c) && c >= 0);
  const { v, air, press, rising, n } = state;
  if (!pair(v) || !count(air) || !count(press) || typeof rising !== "boolean") return null;
  if (n !== null && !pair(n)) return null;
  return { v, air, press, rising, n };
}

function checkOptions(opts: SideViewOptions): void {
  const nonNegative = [
    "maxSpeed",
    "accel",
    "decel",
    "jumpHeight",
    "coyoteMs",
    "jumpBufferMs",
    "stepHeight",
    "snapToGround",
  ] as const;
  for (const key of nonNegative) {
    const v = opts[key];
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`side-view ${key} must be ≥ 0; got ${v}`);
    }
  }
  for (const key of ["airControl", "jumpCut"] as const) {
    const v = opts[key];
    if (!Number.isFinite(v) || v < 0 || v > 1)
      throw new Error(`side-view ${key} must be 0–1; got ${v}`);
  }
  if (!Number.isFinite(opts.gravityScale)) {
    throw new Error(`side-view gravityScale must be finite; got ${opts.gravityScale}`);
  }
  if (!(opts.maxFallSpeed > 0) || !Number.isFinite(opts.maxFallSpeed)) {
    throw new Error(`side-view maxFallSpeed must be > 0; got ${opts.maxFallSpeed}`);
  }
  const slope = opts.maxSlopeDeg;
  if (slope !== undefined && (!Number.isFinite(slope) || slope < 0 || slope > 90)) {
    throw new Error(`side-view maxSlopeDeg must be 0–90; got ${slope}`);
  }
}

/**
 * Run and jump under gravity, down being +y: the speed along the ground
 * turns toward `move × maxSpeed` at `accel` (or eases to rest at `decel`),
 * scaled by `airControl` off the ground; a jump rises `jumpHeight` under
 * `ctx.gravity.y × gravityScale`, falls no faster than `maxFallSpeed`, and
 * keeps `jumpCut` of its upward speed when released early. A jump works for
 * `coyoteMs` after leaving the ground, and a press is kept `jumpBufferMs`
 * for the landing. It walks up slopes to `maxSlopeDeg`, climbs steps to
 * `stepHeight` and sticks to ground within `snapToGround` below it.
 *
 * Both backends follow one rule: `ctx.space` sweeps of `shape` find how far
 * each move goes and what it meets, then the body moves that far, so
 * grounding is one downward sweep. The
 * velocity lives on the body; it and the timers are in `save`, and a world
 * save keeps them under the `side-view` owner.
 */
export function createSideViewController(
  ctx: EngineContext,
  body: MotionBody,
  opts: SideViewOptions,
): SideViewController {
  checkOptions(opts);
  const stepHeight = opts.stepHeight ?? SIDE_VIEW_CONTROLLER.autostep?.maxHeight ?? 0;
  const snap = opts.snapToGround ?? SIDE_VIEW_CONTROLLER.snapToGround ?? 0;
  const slopeDeg = opts.maxSlopeDeg ?? SIDE_VIEW_CONTROLLER.maxSlopeClimbDeg ?? 90;
  const minUp = Math.cos((slopeDeg * Math.PI) / 180) - 1e-9;
  const filter: SpaceFilter = {
    exclude: [body.entityId],
    group: opts.group ?? "dynamic",
    skip: oneWayPasses(ctx, body.entityId),
  };

  const walkable = (n: Vec2) => dot(n, UP) >= minUp && dot(n, UP) > 0;
  const windowTicks = (ms: number) => (ms > 0 ? ticksFor(ms, ctx.time) : 0);

  /**
   * The first thing `shape` at `from` meets moved by `by`. A face it only
   * touches, whose normal doesn't face the move, is stepped off by the skin
   * and the sweep tried again: Rapier reports touching at time 0 whatever
   * the direction.
   */
  function probe(from: Vec2, by: Vec2): SpaceCastHit | null {
    let start = from;
    for (let i = 0; i < MAX_SLIDES; i++) {
      const hit = ctx.space.sweep(translateShape(opts.shape, [start.x, start.y]), by, filter);
      if (!hit || dot(hit.normal, by) < 0) return hit;
      start = { x: start.x + hit.normal.x * SKIN, y: start.y + hit.normal.y * SKIN };
    }
    return null;
  }
  /** Free travel along `by` from `from`, m, keeping the skin. */
  function freeAlong(from: Vec2, by: Vec2): number {
    const len = length(by);
    const hit = probe(from, by);
    return hit ? Math.max(0, hit.toi * len - SKIN) : len;
  }

  let grounded = false;
  let groundNormal: Vec2 | null = null;
  let air: number | null = null;
  let press: number | null = null;
  let rising = false;

  {
    const hit = probe(body.position(), { x: 0, y: GROUND_PROBE });
    if (hit && walkable(hit.normal)) {
      grounded = true;
      groundNormal = hit.normal;
      air = 0;
    }
  }

  const unregister = saveRegistryOf(ctx)?.register(body.entityId, "side-view", {
    save: () => controller.save(),
    restore: (state) => controller.restore(state),
  });

  /** Accumulates a tick's moves. */
  type Tally = { moved: Vec2; hits: SpaceCastHit[]; blocked: boolean };

  /**
   * Moves the body by `delta`, which a probe found clear. Sliding lets
   * Rapier's controller pass along a face it only touches, where a move
   * with no slide stops at once whatever the direction.
   */
  function commit(t: Tally, delta: Vec2): void {
    if (delta.x === 0 && delta.y === 0) return;
    const r = body.move(delta);
    t.moved.x += r.moved.x;
    t.moved.y += r.moved.y;
  }

  /** As far along `delta` as is clear; what stopped it and the length left. */
  function moveOnce(t: Tally, delta: Vec2): { hit: SpaceCastHit | null; left: number } {
    const len = length(delta);
    if (len === 0) return { hit: null, left: 0 };
    const hit = probe(body.position(), delta);
    const travel = hit ? Math.max(0, Math.min(len, hit.toi * len - SKIN)) : len;
    commit(t, { x: (delta.x / len) * travel, y: (delta.y / len) * travel });
    if (!hit) return { hit: null, left: 0 };
    t.hits.push(hit);
    return { hit, left: len - travel };
  }

  /** Up and over what blocks a walk, when it is a step it may climb. */
  function tryStep(t: Tally, side: number, left: number): boolean {
    if (stepHeight <= 0) return false;
    const at = body.position();
    const rise = freeAlong(at, { x: 0, y: -(stepHeight + 2 * SKIN) });
    if (rise <= 2 * SKIN) return false;
    const top = { x: at.x, y: at.y - rise };
    const reach = Math.max(left, MIN_STEP_WIDTH);
    const free = freeAlong(top, { x: side * reach, y: 0 });
    if (free < Math.min(reach, MIN_STEP_WIDTH) || free <= EPSILON) return false;
    const advance = Math.min(free, left);
    const over = { x: top.x + side * advance, y: top.y };
    const drop = rise + GROUND_PROBE;
    const ground = probe(over, { x: 0, y: drop });
    if (!ground || !walkable(ground.normal)) return false;
    if (rise - ground.toi * drop <= EPSILON) return false;
    commit(t, { x: 0, y: -rise });
    commit(t, { x: side * advance, y: 0 });
    commit(t, { x: 0, y: Math.max(0, ground.toi * drop - SKIN) });
    groundNormal = ground.normal;
    return true;
  }

  /** Along the ground by `dx`, up walkable slopes and steps; returns whether a wall stopped it. */
  function walk(t: Tally, dx: number): boolean {
    const side = Math.sign(dx);
    let left = Math.abs(dx);
    for (let i = 0; i < MAX_SLIDES && left > EPSILON; i++) {
      const dir = along(groundNormal ?? UP, side);
      const r = moveOnce(t, { x: dir.x * left, y: dir.y * left });
      if (!r.hit) return false;
      left = r.left;
      if (walkable(r.hit.normal)) {
        groundNormal = r.hit.normal;
        continue;
      }
      return !tryStep(t, side, left);
    }
    return false;
  }

  /** Through the air by `delta`; `onHit` says whether to stop at what it meets or slide along it. */
  function fly(t: Tally, delta: Vec2, onHit: (n: Vec2) => "stop" | "slide"): void {
    let rest = delta;
    for (let i = 0; i < MAX_SLIDES && (rest.x !== 0 || rest.y !== 0); i++) {
      const r = moveOnce(t, rest);
      if (!r.hit) return;
      const n = r.hit.normal;
      if (onHit(n) === "stop") return;
      const len = length(rest);
      const remain = { x: (rest.x / len) * r.left, y: (rest.y / len) * r.left };
      const into = dot(remain, n);
      rest = into < 0 ? { x: remain.x - n.x * into, y: remain.y - n.y * into } : remain;
      if (length(rest) <= EPSILON) return;
    }
  }

  const controller: SideViewController = {
    velocity: () => body.velocity(),
    grounded: () => grounded,
    launch(v) {
      body.setVelocity(v);
      if (v.y < 0) {
        grounded = false;
        groundNormal = null;
        rising = false;
        air = null;
      }
    },
    step(dtMs, intent, env) {
      if (!(dtMs > 0)) return { ...zeroResult(), grounded, landed: false, jumped: false };
      const dt = dtMs / 1000;
      const g = ctx.gravity.y * opts.gravityScale;
      const accel = env?.accel ?? { x: 0, y: 0 };
      const wasGrounded = grounded;
      const t: Tally = { moved: { x: 0, y: 0 }, hits: [], blocked: false };

      if (intent.jump) press = 0;
      else if (press !== null) press++;
      if (press !== null && press > windowTicks(opts.jumpBufferMs)) press = null;

      let v = body.velocity();
      let jumped = false;
      if (press !== null && air !== null && air <= windowTicks(opts.coyoteMs)) {
        v = { x: v.x, y: -Math.sqrt(2 * Math.abs(g) * opts.jumpHeight) };
        jumped = true;
        rising = true;
        press = null;
        air = null;
        grounded = false;
        groundNormal = null;
      }

      const move = Math.max(-1, Math.min(1, intent.move));
      const target = move * opts.maxSpeed;
      const share = grounded ? 1 : opts.airControl;
      const reach = (move === 0 ? opts.decel : opts.accel) * share * dt;
      const gap = target - v.x;
      let vx = Math.abs(gap) <= reach ? target : v.x + Math.sign(gap) * reach;
      vx += accel.x * dt;

      let vy = v.y;
      if (rising && !intent.jumpHeld && vy < 0) {
        vy *= opts.jumpCut;
        rising = false;
      }
      const pull = g + accel.y;
      if (grounded && pull < 0) {
        grounded = false;
        groundNormal = null;
      }

      if (env?.carrier) fly(t, env.carrier, () => "slide");

      if (grounded) {
        vy = 0;
        if (vx !== 0 && walk(t, vx * dt)) {
          t.blocked = true;
          vx = 0;
        }
        const reachDown = Math.max(snap, GROUND_PROBE);
        const ground = probe(body.position(), { x: 0, y: reachDown });
        if (ground && walkable(ground.normal)) {
          commit(t, { x: 0, y: Math.max(0, ground.toi * reachDown - SKIN) });
          groundNormal = ground.normal;
        } else {
          grounded = false;
          groundNormal = null;
        }
      } else {
        if (vx !== 0) {
          fly(t, { x: vx * dt, y: 0 }, (n) => {
            if (n.x * vx < 0 && !walkable(n)) {
              t.blocked = true;
              vx = 0;
              return "stop";
            }
            return "slide";
          });
        }
        const vyNext = Math.min(vy + pull * dt, opts.maxFallSpeed);
        const dy = ((vy + vyNext) / 2) * dt;
        vy = vyNext;
        if (vy >= 0) rising = false;
        if (dy !== 0) {
          fly(t, { x: 0, y: dy }, (n) => {
            if (dy > 0 && walkable(n)) {
              grounded = true;
              groundNormal = n;
              vy = 0;
              return "stop";
            }
            if (dy < 0 && n.y > 0) {
              t.blocked = true;
              vy = 0;
              rising = false;
              return "stop";
            }
            t.blocked = true;
            return "slide";
          });
        }
      }

      body.setVelocity({ x: vx, y: vy });
      if (grounded) {
        air = 0;
        rising = false;
      } else if (air !== null) {
        air = air + 1 > windowTicks(opts.coyoteMs) ? null : air + 1;
      }
      return { ...t, grounded, landed: grounded && !wasGrounded, jumped };
    },
    save() {
      const v = body.velocity();
      const saved: Saved = {
        v: [v.x, v.y],
        air,
        press,
        rising,
        n: grounded && groundNormal ? [groundNormal.x, groundNormal.y] : null,
      };
      return saved;
    },
    restore(state) {
      const saved = readSaved(state);
      if (!saved) return;
      body.setVelocity({ x: saved.v[0], y: saved.v[1] });
      air = saved.air;
      press = saved.press;
      rising = saved.rising;
      grounded = saved.n !== null;
      groundNormal = saved.n ? { x: saved.n[0], y: saved.n[1] } : null;
    },
    destroy() {
      unregister?.();
    },
  };
  return controller;
}
