import type { Vec2 } from "@jams/engine";
import {
  carrierDelta,
  type EngineContext,
  type GameRuntime,
  type SolidSystem,
} from "@jams/engine/game";

import type { GrappleAnchorSystem } from "./entities/grapple-anchor";
import {
  PLAYER_HEIGHT,
  PLAYER_TYPE,
  type MovementState,
  type PlayerEntity,
} from "./entities/player";
import type { PlayerSystem } from "./systems/player";
import { TYPE } from "./type-names";
import type { SpawnEntity } from "./types";

/** What a step reports about the player. */
export type PlayerSnapshot = {
  position: Vec2;
  velocity: Vec2;
  state: MovementState;
  grounded: boolean;
  /** The entity the player stands on. */
  groundId?: string;
};

/** What the jump-arc and player-scale debug layers read each tick; `null` without a player. */
export type PlatformerDebugInfo = {
  position: Vec2;
  velocity: Vec2;
  grounded: boolean;
  holdingJump: boolean;
  holdingMove: boolean;
  wallSliding: boolean;
  wallDirection: -1 | 0 | 1;
  /** State before this tick's update, the arc's frozen origin. */
  preUpdate: { position: Vec2; velocity: Vec2; grounded: boolean };
  /** The world's gravity, px/s², down. */
  gravity: number;
} | null;

/** The store slice: the player as of the last step, or `null` without one. */
export type PlatformerStoreSlice = { player: PlayerSnapshot | null };

/** Types whose one-way solids pass the player up through them. */
const ONE_WAY_TYPES = [TYPE.cloud, "solid"] as const;

function noPlayer(): PlayerSnapshot {
  return { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, state: "idle", grounded: false };
}

function sameSnapshot(a: PlayerSnapshot | null, b: PlayerSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.velocity.x === b.velocity.x &&
    a.velocity.y === b.velocity.y &&
    a.state === b.state &&
    a.grounded === b.grounded &&
    a.groundId === b.groundId
  );
}

/**
 * The runner, per runtime: spawns the `player` entity at the first `spawn`,
 * gates one-way platforms, rides followers, and reports `landed` /
 * `left-ground`. The actor's `update` runs from these hooks, not its system.
 */
export function createPlatformerRuntime(ctx: EngineContext): GameRuntime<PlayerSnapshot> {
  let playerId: string | null = null;
  let prevGrounded = false;
  let prevGroundId: string | undefined;
  let slice: PlatformerStoreSlice = { player: null };

  function snapshotOf(p: PlayerEntity): PlayerSnapshot {
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

  /** The vertical distance the follower under the player moved this frame, or the one carrying what it stands on. */
  function groundDeltaY(p: PlayerEntity): number {
    const handle = p.isGrounded() ? p.getGroundColliderHandle() : null;
    return handle !== null ? (carrierDelta(ctx, handle)?.y ?? 0) : 0;
  }

  /** The live actor, or null when none spawned or game code destroyed it. */
  function actor(): PlayerEntity | null {
    if (playerId === null) return null;
    return ctx.system<PlayerSystem>(PLAYER_TYPE)?.actor(playerId) ?? null;
  }

  function onUnload(): void {
    // Before the engine clears the other systems, so Rapier frees the actor's handles first.
    if (playerId !== null && ctx.exists(playerId)) ctx.destroy(playerId);
    playerId = null;
    prevGrounded = false;
    prevGroundId = undefined;
    slice = { player: null };
  }

  return {
    onLoad(scene) {
      // A play start is the centre of the spawn shape; a spawn marker is the player's feet.
      const start = ctx.play?.at;
      const spawn = scene.entities.find((e): e is SpawnEntity => e.type === TYPE.spawn);
      const feet = start
        ? { x: start.x, y: start.y + PLAYER_HEIGHT / 2 }
        : spawn && { x: spawn.at[0], y: spawn.at[1] };
      if (!feet) return;
      playerId = ctx.spawn({ type: PLAYER_TYPE, at: [feet.x, feet.y] }).id;
    },
    onUnload,
    beforeStep(dtMs, actions) {
      const player = actor();
      if (!player) return;
      const bottom = player.getPosition().y + player.getHalfHeight();
      for (const type of ONE_WAY_TYPES) {
        ctx.system<SolidSystem>(type)?.gateOneWay(bottom, player.isHoldingDown());
      }
      player.update(dtMs, actions, groundDeltaY(player));
    },
    afterStep() {
      const player = actor();
      if (!player) return;
      ctx.system<PlayerSystem>(PLAYER_TYPE)?.syncPoses();
      const snap = snapshotOf(player);
      const at = snap.position;
      if (snap.grounded) {
        if (!prevGrounded || (snap.groundId !== undefined && snap.groundId !== prevGroundId)) {
          ctx.emit({ type: "landed", entityId: snap.groundId, at });
        }
        if (snap.groundId !== undefined) prevGroundId = snap.groundId;
      } else if (prevGrounded) {
        ctx.emit({ type: "left-ground", entityId: prevGroundId, at });
        prevGroundId = undefined;
      }
      prevGrounded = snap.grounded;
      if (!sameSnapshot(slice.player, snap)) slice = { player: snap };
    },
    snapshot() {
      const player = actor();
      return player ? snapshotOf(player) : noPlayer();
    },
    cameraTarget: () => actor()?.getPosition() ?? null,
    storeSlice: () => slice,
    debugInfo(): PlatformerDebugInfo {
      const player = actor();
      if (!player) return null;
      return {
        position: player.getPosition(),
        velocity: player.getVelocity(),
        grounded: player.isGrounded(),
        holdingJump: player.isHoldingJump(),
        holdingMove: player.isHoldingMove(),
        wallSliding: player.isWallSliding(),
        wallDirection: player.getWallDirection(),
        preUpdate: player.getPreUpdateState(),
        gravity: ctx.gravity.y,
      };
    },
    destroy() {
      onUnload();
      ctx.system<GrappleAnchorSystem>(TYPE.anchor)?.destroy();
    },
  };
}
