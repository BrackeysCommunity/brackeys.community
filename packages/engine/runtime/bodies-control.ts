import type { RigidBody } from "@dimforge/rapier2d";

import { EngineError, type BodyControl, type EngineContext } from "../game/types";
import type { Vec2 } from "../types";

export type BodyKind = "dynamic" | "kinematic" | "static";

/**
 * What a body's owner hands `ctx.bodies` when it registers the body. Only a
 * dynamic entry is ever asked for an impulse, a force or a torque.
 */
export type BodyEntry = {
  readonly kind: BodyKind;
  /** m/s. */
  velocity(): Vec2;
  setVelocity(v: Vec2): void;
  /** rad/s. */
  angularVelocity(): number;
  setAngularVelocity(w: number): void;
  applyImpulse(impulse: Vec2, at?: Vec2): void;
  /** Held until `resetForces`. */
  addForce(force: Vec2, at?: Vec2): void;
  addTorque(torque: number): void;
  resetForces(): void;
  mass(): number;
  wake(): void;
};

/**
 * What a system that owns entities' bodies (the collider behavior's) offers
 * one that moves the entity through a body of its own (a character, a nav
 * agent): its body out of the world while the other stands in, and back.
 */
export type BodyStandIn = {
  /**
   * Takes the entity's body out of the world, and out of `ctx.bodies`, which
   * the standing-in body answers meanwhile; it holds across rebuilds.
   */
  standIn(entityId: string): void;
  /** Gives the body back: built again where the entity is now, in `ctx.bodies` again. */
  release(entityId: string): void;
};

/** The runtime's side of `ctx.bodies`: owners register bodies, the step flushes and clears forces. */
export type RuntimeBodyControl = BodyControl & {
  /** Registers `id`'s body, replacing any earlier entry; the returned call unregisters this one. */
  register(id: string, entry: BodyEntry): () => void;
  /** Hands the tick's summed forces and torques to the bodies, before the physics step. */
  flush(): void;
  /** Takes the forces and torques `flush` handed over off the bodies, after the physics step, so each lasts one step. */
  clear(): void;
  /**
   * Drops the forces and torques applied since the physics step, at the end
   * of the tick: the step they were for has run, and a tick boundary (where
   * a save is taken) holds none.
   */
  endTick(): void;
  /** Forgets every body and force, for an unload. */
  reset(): void;
};

const refuse = (id: string, kind: BodyKind, what: string, why: string): never => {
  throw new EngineError(
    "body-not-dynamic",
    `can't ${what} "${id}": its body is ${kind}, ${why}`,
    id,
  );
};

/** A dynamic or static Rapier body; a static one answers reads and refuses writes. */
export function rapierBodyEntry(
  id: string,
  body: RigidBody,
  kind: "dynamic" | "static",
): BodyEntry {
  const still = (what: string) => refuse(id, kind, what, "and a static body never moves");
  return {
    kind,
    velocity() {
      const v = body.linvel();
      return { x: v.x, y: v.y };
    },
    setVelocity(v) {
      if (kind === "static") still("set the velocity of");
      body.setLinvel({ x: v.x, y: v.y }, true);
    },
    angularVelocity: () => body.angvel(),
    setAngularVelocity(w) {
      if (kind === "static") still("set the angular velocity of");
      body.setAngvel(w, true);
    },
    applyImpulse(impulse, at) {
      if (at) body.applyImpulseAtPoint(impulse, at, true);
      else body.applyImpulse(impulse, true);
    },
    addForce(force, at) {
      if (at) body.addForceAtPoint(force, at, true);
      else body.addForce(force, true);
    },
    addTorque: (torque) => body.addTorque(torque, true),
    resetForces() {
      body.resetForces(false);
      body.resetTorques(false);
    },
    mass: () => (kind === "static" ? Infinity : body.mass()),
    wake: () => body.wakeUp(),
  };
}

/**
 * A kinematic body whose owner moves it: `velocity` reads what the owner
 * reports, and `setVelocity`, when the owner takes one, writes what it
 * moves by. It never turns, and forces don't move it, so its mass is
 * infinite.
 */
export function kinematicBodyEntry(
  id: string,
  motion: { velocity(): Vec2; setVelocity?(v: Vec2): void; wake?(): void },
): BodyEntry {
  const owned = (what: string, why: string) => () => refuse(id, "kinematic", what, why);
  const forces = owned("apply a force to", "and only a dynamic body takes forces");
  return {
    kind: "kinematic",
    velocity: () => motion.velocity(),
    setVelocity: motion.setVelocity
      ? (v) => motion.setVelocity!(v)
      : owned("set the velocity of", "and what owns it sets its velocity"),
    angularVelocity: () => 0,
    setAngularVelocity: owned("set the angular velocity of", "and it never turns"),
    applyImpulse: forces,
    addForce: forces,
    addTorque: forces,
    resetForces: () => {},
    mass: () => Infinity,
    wake: () => motion.wake?.(),
  };
}

/**
 * Registers `id`'s body with the context's `ctx.bodies`; the returned call
 * unregisters it. A context without one (a bare test context) registers
 * nothing.
 */
export function registerBody(ctx: EngineContext, id: string, entry: BodyEntry): () => void {
  const bodies = (ctx as { bodies?: Partial<RuntimeBodyControl> }).bodies;
  return typeof bodies?.register === "function" ? bodies.register(id, entry) : () => {};
}

/** This tick's forces on one body: the sum through its centre of mass, and those at a point. */
type ForceSum = { x: number; y: number; torque: number; at: { force: Vec2; at: Vec2 }[] | null };

/** `ctx.bodies` for one runtime: bodies by entity id, whichever system owns them. */
export function createBodyControl(_ctx: EngineContext): RuntimeBodyControl {
  const entries = new Map<string, BodyEntry>();
  const sums = new Map<string, ForceSum>();
  /** The entries `flush` handed forces to, for `clear` to reset. */
  const flushed: BodyEntry[] = [];

  function entryOf(id: string): BodyEntry {
    const entry = entries.get(id);
    if (!entry) throw new EngineError("body-missing", `"${id}" has no body`, id);
    return entry;
  }

  function dynamicEntryOf(id: string, what: string): BodyEntry {
    const entry = entryOf(id);
    if (entry.kind !== "dynamic")
      refuse(id, entry.kind, `apply ${what} to`, "and only a dynamic body takes forces");
    return entry;
  }

  function sumOf(id: string): ForceSum {
    let sum = sums.get(id);
    if (!sum) {
      sum = { x: 0, y: 0, torque: 0, at: null };
      sums.set(id, sum);
    }
    return sum;
  }

  return {
    has: (id) => entries.has(id),
    kind: (id) => entries.get(id)?.kind ?? null,
    velocity: (id) => entryOf(id).velocity(),
    setVelocity(id, v) {
      entryOf(id).setVelocity(v);
    },
    angularVelocity: (id) => entryOf(id).angularVelocity(),
    setAngularVelocity(id, w) {
      entryOf(id).setAngularVelocity(w);
    },
    applyImpulse(id, impulse, at) {
      dynamicEntryOf(id, "an impulse").applyImpulse(
        { x: impulse.x, y: impulse.y },
        at && { x: at.x, y: at.y },
      );
    },
    applyForce(id, force, at) {
      dynamicEntryOf(id, "a force");
      const sum = sumOf(id);
      if (at) (sum.at ??= []).push({ force: { x: force.x, y: force.y }, at: { x: at.x, y: at.y } });
      else {
        sum.x += force.x;
        sum.y += force.y;
      }
    },
    applyTorque(id, torque) {
      dynamicEntryOf(id, "a torque");
      sumOf(id).torque += torque;
    },
    mass: (id) => entryOf(id).mass(),
    wake(id) {
      entryOf(id).wake();
    },
    register(id, entry) {
      entries.set(id, entry);
      return () => {
        if (entries.get(id) !== entry) return;
        entries.delete(id);
        sums.delete(id);
      };
    },
    flush() {
      if (sums.size === 0) return;
      for (const [id, sum] of sums) {
        const entry = entries.get(id);
        if (!entry) continue;
        if (sum.x !== 0 || sum.y !== 0) entry.addForce({ x: sum.x, y: sum.y });
        if (sum.torque !== 0) entry.addTorque(sum.torque);
        if (sum.at) for (const f of sum.at) entry.addForce(f.force, f.at);
        flushed.push(entry);
      }
      sums.clear();
    },
    clear() {
      if (flushed.length === 0) return;
      for (const entry of flushed) entry.resetForces();
      flushed.length = 0;
    },
    endTick() {
      sums.clear();
    },
    reset() {
      entries.clear();
      sums.clear();
      flushed.length = 0;
    },
  };
}
