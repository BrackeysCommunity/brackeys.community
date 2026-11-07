import { createColliderTags } from "../collider-tags";
import type { EngineContext, SceneView } from "../context";
import { createCloudPlatformSystem } from "../entities/cloud-platform";
import { createGrappleAnchorSystem, type GrappleAnchorSystem } from "../entities/grapple-anchor";
import { createMovingPlatformSystem } from "../entities/moving-platform";
import { createPlayerEntity, type PlayerEntity } from "../entities/player";
import { createConstructSystem, type ConstructSystem } from "../entities/shaper-constructs";
import { createForceFields } from "../force-fields";
import { createPhysicsWorld } from "../physics";
import {
  SPAWN_ORDER,
  type ExpandedScene,
  type RuntimeBehavior,
  type RuntimeEntity,
} from "../scene/types";
import { createPropSystem, createSensorSystem, createSolidSystem } from "../systems/bodies";
import type { SceneSystem } from "../systems/scene-system";
import type { InputAction, RapierModule } from "../types";
import type {
  LoadReport,
  PlayerSnapshot,
  RuntimeStats,
  SceneRuntime,
  StepEvent,
  StepResult,
} from "./types";

export type SceneRuntimeOptions = {
  rapier: RapierModule;
  view: SceneView | null;
  dev?: boolean;
  /** Clock for `LoadReport.ms`. Defaults to a constant 0 so reports stay deterministic. */
  now?: () => number;
};

/** The runtime plus the parts the game shell drives directly. */
export type SceneRuntimeHandle = SceneRuntime & {
  readonly ctx: EngineContext;
  readonly anchors: GrappleAnchorSystem;
  readonly constructs: ConstructSystem;
  /** The scene last loaded successfully, or null. */
  scene: () => ExpandedScene | null;
  player: () => PlayerEntity | null;
  playerState: () => PlayerSnapshot;
};

const NO_PLAYER: PlayerSnapshot = {
  position: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  state: "idle",
  grounded: false,
};

export function createSceneRuntime(opts: SceneRuntimeOptions): SceneRuntimeHandle {
  const { rapier, view } = opts;
  const now = opts.now ?? (() => 0);

  const ctx: EngineContext = {
    rapier,
    physics: createPhysicsWorld(rapier),
    view,
    tags: createColliderTags(),
    fields: createForceFields(),
    dev: opts.dev ?? false,
    bounds: [0, 0, 0, 0],
  };

  const solids = createSolidSystem(ctx);
  const clouds = createCloudPlatformSystem(ctx);
  const sensors = createSensorSystem(ctx);
  const props = createPropSystem(ctx);
  const movers = createMovingPlatformSystem(ctx);
  const anchors = createGrappleAnchorSystem(ctx);
  const constructs = createConstructSystem(ctx, anchors);

  const systems: Record<RuntimeBehavior, SceneSystem> = {
    solid: solids,
    cloud: clouds,
    sensor: sensors,
    prop: props,
    mover: movers,
    anchor: anchors,
    construct: constructs,
  };

  const byId = new Map<string, RuntimeEntity>();
  let scene: ExpandedScene | null = null;
  let player: PlayerEntity | null = null;
  let tick = 0;
  let prevGrounded = false;
  let prevGroundId: string | undefined;
  let destroyed = false;

  function unload(): void {
    player?.destroy();
    player = null;
    for (const behavior of [...SPAWN_ORDER].reverse()) systems[behavior].clear();
    ctx.tags.clear();
    ctx.fields.clear();
    byId.clear();
    scene = null;
    tick = 0;
    prevGrounded = false;
    prevGroundId = undefined;
  }

  function load(next: ExpandedScene): LoadReport {
    if (destroyed) return { ok: false, error: "runtime destroyed" };
    const started = now();

    const seen = new Set<string>();
    for (const e of next.entities) {
      if (seen.has(e.id))
        return { ok: false, error: `duplicate entity id "${e.id}"`, entityId: e.id };
      if (!(e.b in systems))
        return { ok: false, error: `unknown behavior "${e.b}"`, entityId: e.id };
      seen.add(e.id);
    }

    unload();
    ctx.bounds = [...next.bounds];
    const counts: Partial<Record<RuntimeBehavior, number>> = {};
    let current: string | undefined;
    try {
      for (const behavior of SPAWN_ORDER) {
        for (const e of next.entities) {
          if (e.b !== behavior) continue;
          current = e.id;
          systems[behavior].spawn(e);
          byId.set(e.id, e);
          counts[behavior] = (counts[behavior] ?? 0) + 1;
        }
      }
      current = undefined;
      const feet = next.spawn[0];
      if (feet) player = createPlayerEntity(ctx, { x: feet[0], y: feet[1] }, anchors);
      ctx.physics.refreshQueries();
    } catch (err) {
      unload();
      const error = err instanceof Error ? err.message : String(err);
      return current === undefined ? { ok: false, error } : { ok: false, error, entityId: current };
    }

    scene = next;
    return { ok: true, counts, ms: now() - started };
  }

  function snapshot(p: PlayerEntity): PlayerSnapshot {
    const handle = p.getGroundColliderHandle();
    const groundId = p.isGrounded() && handle !== null ? ctx.tags.get(handle)?.entityId : undefined;
    const snap: PlayerSnapshot = {
      position: p.getPosition(),
      velocity: p.getVelocity(),
      state: p.getMovementState(),
      grounded: p.isGrounded(),
    };
    if (groundId !== undefined) snap.groundId = groundId;
    return snap;
  }

  function step(dtMs: number, actions: InputAction[]): StepResult {
    const t = tick;
    const events: StepEvent[] = [];

    movers.tick(dtMs);

    if (player) {
      clouds.updateForPlayer(player.getPosition(), player.getHalfHeight(), player.isHoldingDown());

      let groundDeltaY = 0;
      const handle = player.isGrounded() ? player.getGroundColliderHandle() : null;
      const ground = handle !== null ? ctx.tags.get(handle) : undefined;
      if (ground?.behavior === "mover") groundDeltaY = movers.frameDelta(ground.entityId)?.y ?? 0;

      player.update(dtMs, actions, groundDeltaY);
    }

    ctx.physics.step();

    let snap = NO_PLAYER;
    if (player) {
      snap = snapshot(player);
      const at = snap.position;
      if (snap.grounded) {
        if (!prevGrounded || (snap.groundId !== undefined && snap.groundId !== prevGroundId)) {
          events.push({ tick: t, type: "landed", entityId: snap.groundId, at });
        }
        if (snap.groundId !== undefined) prevGroundId = snap.groundId;
      } else if (prevGrounded) {
        events.push({ tick: t, type: "left-ground", entityId: prevGroundId, at });
        prevGroundId = undefined;
      }
      prevGrounded = snap.grounded;

      for (const hit of sensors.entered(player.getCollider())) {
        events.push({ tick: t, type: hit.type, entityId: hit.entityId, at });
      }
    }

    tick++;
    return { tick: t, events, player: snap };
  }

  function stats(): RuntimeStats {
    const perBehavior: Partial<Record<RuntimeBehavior, number>> = {};
    for (const behavior of SPAWN_ORDER) {
      const n = systems[behavior].size();
      if (n > 0) perBehavior[behavior] = n;
    }
    return {
      bodies: ctx.physics.world.bodies.len(),
      colliders: ctx.physics.world.colliders.len(),
      tags: ctx.tags.size,
      fields: ctx.fields.size,
      entities: byId.size,
      perBehavior,
    };
  }

  function destroy(): void {
    if (destroyed) return;
    unload();
    anchors.destroy();
    ctx.physics.destroy();
    destroyed = true;
  }

  return {
    load,
    unload,
    get: (id) => byId.get(id),
    step,
    stats,
    destroy,
    ctx,
    anchors,
    constructs,
    scene: () => scene,
    player: () => player,
    playerState: () => (player ? snapshot(player) : NO_PLAYER),
  };
}
