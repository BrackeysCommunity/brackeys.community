import { z } from "zod";

import type {
  BehaviorSystem,
  BehaviorSystemFactory,
  RegisteredBehavior,
} from "../../game/behaviors";
import { BODY, type BodyBlock } from "../../game/behaviors/body";
import type { CharacterSideViewBlock } from "../../game/behaviors/character-side-view";
import type { CharacterIntent, CharacterSystem } from "../../game/behaviors/character-top-down";
import { COLLIDER, type ColliderBlock, type ColliderSystem } from "../../game/behaviors/collider";
import { FORCE_AREA, type ForceAreaSystem } from "../../game/behaviors/force-area";
import { PLAYER_INPUT } from "../../game/behaviors/player-input";
import { SIDE_VIEW_CONTROLLER } from "../../game/defaults";
import { inputFor, type PlayerInputSystem } from "../../game/input-for";
import { EngineError, type EngineContext, type JsonValue } from "../../game/types";
import { createMotionBody, type MotionBody } from "../../motion/body";
import { createSideViewController, type SideViewController } from "../../motion/side-view";
import { aabb, translateShape } from "../../scene/shape-geometry";
import { parseShape } from "../../scene/shapes";
import type { Aabb, RuntimeEntity, ShapeObj } from "../../scene/types";
import { oneWayPasses, type SolidSystem } from "../../systems/bodies";
import { carrierDelta } from "../../systems/path-follower";
import { kinematicBodyEntry, registerBody } from "../bodies-control";
import type { SpaceCastHit, SpaceFilter, SpaceHit, SpaceQuery } from "../space";
import { CHARACTER_JUMPED, CHARACTER_LANDED, CHARACTER_LEFT_GROUND } from "../types";

type Vec2 = { x: number; y: number };

/** How far below its feet the ground it stands on is looked for, m. */
const GROUND_PROBE = 0.01;
/** The share of its width the ground band spans. */
const FOOT_INSET = 0.9;
/** The gap kept from what it rides into, the controller's. */
const SKIN = SIDE_VIEW_CONTROLLER.offset ?? 0.0001;
/** A move action's y past this, down being +y, holds down: it drops through a one-way solid. */
const HOLD_DOWN = 0.5;

type Character = {
  id: string;
  type: string;
  block: CharacterSideViewBlock;
  /** The collider block the body was built from; another one rebuilds it. */
  collider: ColliderBlock;
  shape: ShapeObj;
  /** The shape's box around the entity's pose. */
  box: Aabb;
  filter: SpaceFilter;
  /** The context its controller sees: sweeps that leave out the one-way solids it passes. */
  view: EngineContext;
  body: MotionBody;
  controller: SideViewController;
  /** The move action is an axis, read by its value, not a vector's x. */
  axis: boolean;
  /** The last `setIntent`, for an entity with no `player-input`. */
  intent: CharacterIntent | null;
  /** Whether the intent's jump was held last tick, so a hold presses once. */
  held: boolean;
  /** Grounded at the end of its last step: what the landed and left-ground events compare. */
  grounded: boolean;
  disabled: boolean;
  /** Drops its `ctx.bodies` entry. */
  release: () => void;
};

function readSaved(state: JsonValue): {
  intent: CharacterIntent | null;
  held: boolean;
  grounded: boolean;
} | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const { i, h, g } = state;
  let intent: CharacterIntent | null = null;
  if (typeof i === "object" && i !== null && !Array.isArray(i)) {
    const m = i.m;
    if (
      Array.isArray(m) &&
      m.length === 2 &&
      m.every((n) => typeof n === "number" && Number.isFinite(n))
    )
      intent = { move: { x: m[0] as number, y: m[1] as number }, jump: i.j === true };
  }
  return { intent, held: h === true, grounded: g === true };
}

/**
 * The `character-side-view` behavior's system: a motion body in the
 * entity's `collider` shape run by `createSideViewController`, which then
 * stands in for the collider system's own body on that entity (that one is
 * taken out of the world, and `ctx.bodies` answers for the motion body).
 *
 * Each `beforeStep` it reads the entity's seat through `inputFor` (the move
 * action's x, or an axis's value, and the jump button), or the last
 * `setIntent` when the entity has no `player-input`; gates every solid
 * system's one-way solids for it, passing up through a platform while it
 * rises and down through one while it holds down;
 * rides what it stands on by `carrierDelta`; adds the force areas'
 * `sample` as acceleration, which its `decel` (at its air share off the
 * ground) takes back each tick while idle, so only a push past the decel
 * builds speed; and steps. It raises `character:jumped`,
 * `character:left-ground` and `character:landed` (with the ground's entity
 * as `other`). With `pushDynamic` it pushes the dynamic bodies it walks
 * into. Play from here starts seat 0's character at the chosen point.
 * The controller keeps its velocity and timers in world saves; its
 * own save holds the intent and the grounded state the events compare.
 */
export const createCharacterSideViewSystem: BehaviorSystemFactory = (
  ctx: EngineContext,
  def: RegisteredBehavior,
) => {
  const schema = z.object(def.shape);
  const characters = new Map<string, Character>();
  let solids: SolidSystem[] | null = null;
  /** Set by a load; the first tick after it places Play from here's hero. */
  let loaded = false;

  const solidSystems = (): SolidSystem[] => {
    if (solids) return solids;
    solids = [];
    for (const type of ctx.registry.typeNames) {
      const system = ctx.system(type) as Partial<SolidSystem> | undefined;
      if (typeof system?.passesOneWay === "function") solids.push(system as SolidSystem);
    }
    return solids;
  };

  const seated = (id: string) =>
    (ctx.behavior<PlayerInputSystem>(PLAYER_INPUT.name)?.seatOf(id) ?? null) !== null;

  const isAxis = (action: string) =>
    ctx.registry.actions.find((a) => a.action === action)?.kind === "axis";

  function colliderOf(e: RuntimeEntity | undefined): ColliderBlock | undefined {
    return e?.behaviors?.[COLLIDER.name] as ColliderBlock | undefined;
  }

  function refuseDynamic(e: RuntimeEntity): void {
    const body = e.behaviors?.[BODY.name] as Partial<BodyBlock> | undefined;
    if (body && (body.kind ?? "dynamic") === "dynamic")
      throw new EngineError(
        "character-body-kind",
        `${e.id} has a character-side-view on a dynamic body: the controller and the physics solver would both move it`,
        e.id,
      );
  }

  /** `filter` leaving out the one-way solids `id` passes this tick as well. */
  function passing(id: string, filter: SpaceFilter | undefined): SpaceFilter | undefined {
    const passes = oneWayPasses(ctx, id);
    if (passes.size === 0) return filter;
    const exclude = [...(filter?.exclude ?? [])];
    for (const handle of passes) {
      const other = ctx.tags.get(handle)?.entityId;
      if (other !== undefined && !exclude.includes(other)) exclude.push(other);
    }
    return { ...filter, exclude };
  }

  /** The context the controller of `id` runs in: `ctx` with sweeps that skip what `id` passes. */
  function actorView(id: string): EngineContext {
    const space: SpaceQuery = {
      get backend() {
        return ctx.space.backend;
      },
      pointAt: (p, filter) => ctx.space.pointAt(p, filter),
      overlaps: (shape, filter) => ctx.space.overlaps(shape, passing(id, filter)),
      raycast: (from, dir, maxDist, filter) =>
        ctx.space.raycast(from, dir, maxDist, passing(id, filter)),
      sweep: (shape, by, filter) => ctx.space.sweep(shape, by, passing(id, filter)),
    };
    return Object.create(ctx, { space: { value: space } }) as EngineContext;
  }

  /** Takes the entity's body over from the collider system (`standIn`), and its `ctx.bodies` entry onto the controller. */
  function takeOver(c: Character): void {
    ctx.behavior<ColliderSystem>(COLLIDER.name)?.standIn(c.id);
    c.release();
    c.release = registerBody(
      ctx,
      c.id,
      kinematicBodyEntry(c.id, {
        velocity: () => c.controller.velocity(),
        setVelocity: (v) => c.body.setVelocity(v),
      }),
    );
  }

  function controllerFor(
    body: MotionBody,
    c: Pick<Character, "shape" | "filter" | "block" | "view">,
  ) {
    const b = c.block;
    return createSideViewController(c.view, body, {
      shape: c.shape,
      group: c.filter.group ?? "dynamic",
      maxSpeed: b.maxSpeed,
      accel: b.accel,
      decel: b.decel,
      airControl: b.airControl,
      jumpHeight: b.jumpHeight,
      gravityScale: b.gravityScale,
      maxFallSpeed: b.maxFallSpeed,
      coyoteMs: b.coyoteMs,
      jumpBufferMs: b.jumpBufferMs,
      jumpCut: b.jumpCut,
      maxSlopeDeg: b.maxSlopeDeg,
      stepHeight: b.stepHeight,
      snapToGround: b.snapToGround,
    });
  }

  function build(e: RuntimeEntity, written: CharacterSideViewBlock, was?: Character): void {
    refuseDynamic(e);
    const read = schema.safeParse(written);
    if (!read.success)
      throw new EngineError("schema", `${e.id}'s character-side-view: ${read.error.message}`, e.id);
    const block = read.data as CharacterSideViewBlock;
    const collider = colliderOf(e);
    if (!collider)
      throw new EngineError(
        "behavior-missing",
        `${e.id}'s character-side-view needs a collider`,
        e.id,
      );
    const parsed = parseShape(collider.shape, `${e.id}.behaviors.collider.shape`);
    if (!parsed.ok) throw new EngineError("schema", parsed.issue.message, e.id);
    const shape = parsed.shape;
    const group = collider.group ?? "dynamic";
    const at = was ? was.body.position() : (ctx.poses.get(e.id) ?? { x: 0, y: 0 });
    const kept = was?.controller.save();
    if (was) {
      was.controller.destroy();
      was.body.destroy();
    }
    const body = createMotionBody(ctx, e, at, {
      shape,
      group,
      ...(collider.material !== undefined ? { tag: { material: collider.material } } : {}),
    });
    const filter: SpaceFilter = { exclude: [e.id], group };
    const view = actorView(e.id);
    const controller = controllerFor(body, { shape, filter, block, view });
    if (kept !== undefined) controller.restore(kept);
    const c: Character = {
      id: e.id,
      type: e.type,
      block,
      collider,
      shape,
      box: aabb(shape),
      filter,
      view,
      body,
      controller,
      axis: isAxis(block.move),
      intent: was?.intent ?? null,
      held: was?.held ?? false,
      grounded: was ? was.grounded : controller.grounded(),
      disabled: was?.disabled ?? false,
      release: was?.release ?? (() => {}),
    };
    if (c.disabled) body.setEnabled(false);
    characters.set(e.id, c);
    takeOver(c);
  }

  /** Play from here: on a play world's first tick (a restored one is past it), seat 0's first character starts at `ctx.play.at`, at rest. */
  function startAtPlay(): void {
    const at = ctx.play?.at;
    if (!at || ctx.tick !== 0) return;
    for (const c of characters.values()) {
      if (ctx.behavior<PlayerInputSystem>(PLAYER_INPUT.name)?.seatOf(c.id) !== 0) continue;
      c.body.teleport(at.x, at.y);
      c.body.setVelocity({ x: 0, y: 0 });
      return;
    }
  }

  function remove(id: string, giveBack: boolean): void {
    const c = characters.get(id);
    if (!c) return;
    characters.delete(id);
    c.release();
    c.controller.destroy();
    c.body.destroy();
    if (giveBack) ctx.behavior<ColliderSystem>(COLLIDER.name)?.release(id);
  }

  /**
   * What it stands on: what a band across its feet overlaps, from a quarter
   * of its height above them (a carrier that rose into it this tick) to just
   * below, inset from its sides so a wall it touches isn't ground. One that
   * carries it comes first, then the lowest handle.
   */
  function groundOf(c: Character): SpaceHit | null {
    const at = c.body.position();
    const { minX, minY, maxX, maxY } = c.box;
    const lift = (maxY - minY) / 4;
    const top = at.y + maxY - lift;
    const bottom = at.y + maxY + GROUND_PROBE;
    const band: ShapeObj = {
      type: "box",
      cx: at.x + (minX + maxX) / 2,
      cy: (top + bottom) / 2,
      hw: ((maxX - minX) / 2) * FOOT_INSET,
      hh: (bottom - top) / 2,
      rotDeg: 0,
    };
    const hits = c.view.space.overlaps(band, c.filter);
    return hits.find((h) => carrierDelta(ctx, h.handle) !== null) ?? hits[0] ?? null;
  }

  /**
   * Moves it with what carries it, as far as is clear of everything but the
   * carrier, which has moved (or is about to) by as much. The carrier may
   * already have risen into its feet this tick, so this goes before the
   * controller's own sweeps, which would stop at it.
   */
  function ride(c: Character, by: Vec2, carrierId: string): void {
    const len = Math.sqrt(by.x * by.x + by.y * by.y);
    const filter = { ...c.filter, exclude: [c.id, carrierId] };
    const at = c.body.position();
    const hit = c.view.space.sweep(translateShape(c.shape, [at.x, at.y]), by, filter);
    const travel = hit ? Math.max(0, hit.toi * len - SKIN) : len;
    if (travel <= 0) return;
    c.body.setEnabled(false);
    c.body.move({ x: (by.x / len) * travel, y: (by.y / len) * travel });
    c.body.setEnabled(!c.disabled);
  }

  /** This tick's move, jump press, jump hold and hold-down, from its seat or its intent. */
  function intentOf(c: Character) {
    if (seated(c.id)) {
      const input = inputFor(ctx, c.id);
      const v = c.axis ? { x: input.value(c.block.move), y: 0 } : input.vector(c.block.move);
      return {
        move: v.x,
        jump: input.pressed(c.block.jump),
        jumpHeld: input.held(c.block.jump),
        down: v.y > HOLD_DOWN,
      };
    }
    const held = c.intent?.jump === true;
    const jump = held && !c.held;
    c.held = held;
    const move = c.intent?.move ?? { x: 0, y: 0 };
    return { move: move.x, jump, jumpHeld: held, down: move.y > HOLD_DOWN };
  }

  /** Pushes the dynamic bodies it walked into toward its intended speed, at most its acceleration this tick. */
  function push(c: Character, hits: readonly SpaceCastHit[], move: number, dt: number): void {
    const pushed: string[] = [];
    for (const hit of hits) {
      const id = hit.tag.entityId;
      if (Math.abs(hit.normal.x) < 0.5 || pushed.includes(id)) continue;
      if (ctx.bodies.kind(id) !== "dynamic") continue;
      pushed.push(id);
      const dir = hit.normal.x < 0 ? 1 : -1;
      if (Math.sign(move) !== dir) continue;
      const want = Math.abs(move) * c.block.maxSpeed;
      const gap = want - ctx.bodies.velocity(id).x * dir;
      if (gap <= 0) continue;
      const dv = Math.min(gap, c.block.accel * dt);
      ctx.bodies.applyImpulse(id, { x: ctx.bodies.mass(id) * dv * dir, y: 0 });
    }
  }

  /** The character, built again first when its collider block changed. */
  function current(c: Character): Character {
    const e = ctx.get(c.id);
    const collider = colliderOf(e);
    if (!e || !collider || collider === c.collider) return c;
    build(e, c.block, c);
    return characters.get(c.id) ?? c;
  }

  function stepOne(was: Character, dtMs: number): void {
    const c = current(was);
    const at = c.body.position();
    const intent = intentOf(c);
    const passing = c.controller.velocity().y < 0 || intent.down;
    const box = {
      minX: at.x + c.box.minX,
      minY: at.y + c.box.minY,
      maxX: at.x + c.box.maxX,
      maxY: at.y + c.box.maxY,
    };
    for (const solid of solidSystems()) solid.passesOneWay(c.id, box, passing);

    const ground = c.controller.grounded() ? groundOf(c) : null;
    const carrier = ground ? carrierDelta(ctx, ground.handle) : null;
    if (ground && carrier && (carrier.x !== 0 || carrier.y !== 0))
      ride(c, carrier, ground.tag.entityId);
    const accel = ctx.behavior<ForceAreaSystem>(FORCE_AREA.name)?.sample(at, c.id);
    // Its moves travel what the controller's sweeps found clear; out of the
    // world, the body's own move doesn't stop at a one-way solid it passes.
    const through = oneWayPasses(ctx, c.id).size > 0;
    if (through) c.body.setEnabled(false);
    const result = c.controller.step(
      dtMs,
      { move: intent.move, jump: intent.jump, jumpHeld: intent.jumpHeld },
      accel && (accel.x !== 0 || accel.y !== 0) ? { accel } : {},
    );
    if (through) c.body.setEnabled(true);
    if (c.block.pushDynamic && result.hits.length > 0)
      push(c, result.hits, intent.move, dtMs / 1000);

    const now = c.body.position();
    if (result.jumped) ctx.emit({ type: CHARACTER_JUMPED, entityId: c.id, at: now });
    if (c.grounded && !result.grounded)
      ctx.emit({ type: CHARACTER_LEFT_GROUND, entityId: c.id, at: now });
    if (!c.grounded && result.grounded) {
      const other = groundOf(c)?.tag.entityId;
      ctx.emit({
        type: CHARACTER_LANDED,
        entityId: c.id,
        ...(other !== undefined ? { other } : {}),
        at: now,
      });
    }
    c.grounded = result.grounded;
  }

  const live = (id: string, what: string): Character => {
    const c = characters.get(id);
    if (!c) throw new Error(`character-side-view.${what}: "${id}" carries no character-side-view`);
    return c;
  };

  const system: CharacterSystem<CharacterSideViewBlock> = {
    attach(_id, block, e) {
      build(e, block);
    },
    update(id, block, _prev, e) {
      const c = characters.get(id);
      if (c) build(e, block, c);
      else build(e, block);
    },
    /** Gives the body back to the collider system while the entity lives: it may only have lost the block. */
    detach(id) {
      remove(id, ctx.exists(id));
    },
    disable(id) {
      const c = characters.get(id);
      if (!c || c.disabled) return;
      c.disabled = true;
      c.body.setEnabled(false);
    },
    enable(id) {
      const c = characters.get(id);
      if (!c || !c.disabled) return;
      c.disabled = false;
      c.body.setEnabled(true);
    },
    reset() {
      loaded = true;
    },
    beforeStep(dtMs) {
      if (loaded) {
        loaded = false;
        startAtPlay();
      }
      for (const c of characters.values()) if (!c.disabled) stepOne(c, dtMs);
    },
    clear() {
      for (const id of [...characters.keys()]) remove(id, false);
      solids = null;
    },
    size: () => characters.size,
    setIntent(id, intent) {
      const c = live(id, "setIntent");
      c.intent = {
        move: { x: intent.move.x, y: intent.move.y },
        ...(intent.jump !== undefined ? { jump: intent.jump } : {}),
      };
    },
    velocity(id) {
      return live(id, "velocity").controller.velocity();
    },
    grounded(id) {
      return live(id, "grounded").controller.grounded();
    },
    launch(id, v) {
      live(id, "launch").controller.launch({ x: v.x, y: v.y });
    },
    handle: (id) => ({
      grounded: () => system.grounded(id),
      launch: (v: Vec2) => system.launch(id, v),
      setIntent: (intent: CharacterIntent) => system.setIntent(id, intent),
      velocity: () => system.velocity(id),
    }),
    posed(id, pose, snap) {
      characters.get(id)?.body.teleport(pose.x, pose.y, { snap });
    },
    save(id): JsonValue | undefined {
      const c = characters.get(id);
      if (!c) return undefined;
      const out: Record<string, JsonValue> = {};
      if (c.intent)
        out.i = {
          m: [c.intent.move.x, c.intent.move.y],
          ...(c.intent.jump === true ? { j: true } : {}),
        };
      if (c.held) out.h = true;
      if (c.grounded) out.g = true;
      return out;
    },
    restore(id, state) {
      const c = characters.get(id);
      const saved = readSaved(state);
      if (!c || !saved) return;
      c.intent = saved.intent;
      c.held = saved.held;
      c.grounded = saved.grounded;
    },
  };
  return system as BehaviorSystem;
};
