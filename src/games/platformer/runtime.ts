import type { Vec2 } from "@jams/engine";
import {
  carrierDelta,
  castSpawn,
  type EngineContext,
  type GameCommand,
  type GameRuntime,
  type IssueCodeDef,
  type SolidSystem,
} from "@jams/engine/game";
import { makeIssue, roundLength, type SceneIssue, type ShapeObj } from "@jams/engine/scene";

import type { GrappleAnchorSystem } from "./entities/grapple-anchor";
import {
  PLAYER_HEIGHT,
  PLAYER_TYPE,
  PLAYER_WIDTH,
  type MovementState,
  type PlayerEntity,
} from "./entities/player";
import type { ConstructSystem, ConstructType } from "./entities/shaper-constructs";
import { PLATFORMER_PLAY } from "./play";
import type { PlayerSystem } from "./systems/player";
import { SHAPER_PLACE, SHAPER_REMOVE } from "./systems/shaper";
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
  /** The constructs the Shaper placed, oldest first; absent when there are none. */
  constructs?: string[];
};

/** A refused `shaper-place` or `shaper-remove`, with why. */
export const SHAPER_REFUSED = "shaper-refused";

type ShaperPlaceArgs = { type: ConstructType; at: [number, number]; rot: number };
type ShaperRemoveArgs = { id: string };

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
  /** The world's gravity, m/s², down. */
  gravity: number;
} | null;

/** The store slice: the player as of the last step, or `null` without one. */
export type PlatformerStoreSlice = { player: PlayerSnapshot | null };

/** Types whose one-way solids pass the player up through them. */
const ONE_WAY_TYPES = [TYPE.cloud, "solid"] as const;

/** The code `live.check` reports; registered with the game's other issue codes. */
export const PLATFORMER_LIVE_ISSUES = {
  "platformer/player-in-solid": {
    severity: "error",
    summary: `After a new version of the level went live, the ${PLAYER_WIDTH} × ${PLAYER_HEIGHT} m player box overlaps something it can't stand inside.`,
    hint: "Leave the player room where the change lands: with a free spot nearby the swap lifts the player onto it; boxed in, it stays stuck.",
    fixable: false,
  },
} as const satisfies Record<string, IssueCodeDef>;

/** How far apart the spots a swap tries for a stuck player are; under half the player box, so no gap it fits is skipped. */
const FREE_STEP = PLAYER_HEIGHT / 4;
/** How many `FREE_STEP`s out a swap looks (eight player heights); a player boxed in past that stays stuck for `live.check` to report. */
export const FREE_RINGS = 32;
/** Up first, then either side, then down. */
const FREE_DIRECTIONS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

/** How far the player's box may sink into what it touches (its resting contact) before it counts as inside. */
const CONTACT_SKIN = 0.001;

/** The player's box centred on `at`, less the contact skin. */
const playerBox = (at: Vec2): ShapeObj => ({
  type: "box",
  cx: at.x,
  cy: at.y,
  hw: PLAYER_WIDTH / 2 - CONTACT_SKIN,
  hh: PLAYER_HEIGHT / 2 - CONTACT_SKIN,
  rotDeg: 0,
});

/** The entities whose colliders the player `id`'s box at `at` overlaps; gated one-way solids and sensors don't count. */
function blockersAt(ctx: EngineContext, id: string, at: Vec2): string[] {
  const hits = ctx.space.overlaps(playerBox(at), { exclude: [id] });
  return [...new Set(hits.map((h) => h.tag.entityId))];
}

/** `live.check`: a player inside a solid, cloud, construct or platform. */
export function playerInSolidIssues(ctx: EngineContext): SceneIssue[] {
  const players = ctx.system<PlayerSystem>(PLAYER_TYPE);
  const issues: SceneIssue[] = [];
  for (const id of ctx.query.select({ type: PLAYER_TYPE })) {
    const at = players?.actor(id)?.getPosition();
    if (!at) continue;
    const inside = blockersAt(ctx, id, at);
    if (inside.length === 0) continue;
    issues.push(
      makeIssue(
        "platformer/player-in-solid",
        {
          message: `${id} at ${roundLength(at.x)}, ${roundLength(at.y)} m is inside ${inside.join(", ")}`,
          entityIds: [id, ...inside],
          at: [at.x, at.y],
        },
        PLATFORMER_LIVE_ISSUES,
      ),
    );
  }
  return issues;
}

/**
 * Where the stuck `player` comes to rest from the nearest spot with room for
 * its box, tried outward in `FREE_STEP`s up to `FREE_RINGS` within the bounds
 * and settled as a play start is (`castSpawn`, past the player's own
 * collider); null when nothing that near is free.
 */
function restFor(ctx: EngineContext, player: PlayerEntity, playerId: string): Vec2 | null {
  const shape = PLATFORMER_PLAY.spawnShape;
  if (!shape) return null;
  const [minX, minY, maxX, maxY] = ctx.bounds;
  const from = player.getPosition();
  const exclude = [playerId];
  for (let ring = 1, d = FREE_STEP; ring <= FREE_RINGS; ring++, d += FREE_STEP) {
    let inBounds = false;
    for (const dir of FREE_DIRECTIONS) {
      const at = { x: from.x + dir.x * d, y: from.y + dir.y * d };
      if (at.x < minX || at.x > maxX || at.y < minY || at.y > maxY) continue;
      inBounds = true;
      const cast = castSpawn(ctx, at, shape, { exclude });
      if (cast.ok) return cast.at;
    }
    if (!inBounds) return null;
  }
  return null;
}

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
    a.groundId === b.groundId &&
    (a.constructs ?? []).join() === (b.constructs ?? []).join()
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

  const constructs = () => ctx.system<ConstructSystem>(TYPE.construct);

  /** The Shaper's commands, in the order the tick delivers them; a refusal raises `shaper-refused`. */
  function applyShaper(commands: readonly GameCommand[]): void {
    for (const command of commands) {
      if (command.name !== SHAPER_PLACE && command.name !== SHAPER_REMOVE) continue;
      const system = constructs();
      if (!system) return;
      const seat = command.player ?? 0;
      if (command.name === SHAPER_PLACE) {
        const { type, at, rot } = command.args as ShaperPlaceArgs;
        const point = { x: at[0], y: at[1] };
        const result = system.shape(type, point, rot);
        if (!result.valid) {
          ctx.emit({
            type: SHAPER_REFUSED,
            at: point,
            player: seat,
            data: { command: command.name, reason: result.reason ?? "refused" },
          });
        }
      } else {
        const { id } = command.args as ShaperRemoveArgs;
        if (!system.unshape(id)) {
          const pose = ctx.poses.get(id);
          ctx.emit({
            type: SHAPER_REFUSED,
            entityId: id,
            at: pose ? { x: pose.x, y: pose.y } : { x: 0, y: 0 },
            player: seat,
            data: { command: command.name, reason: `"${id}" isn't a construct the Shaper placed` },
          });
        }
      }
    }
  }

  function withConstructs(snap: PlayerSnapshot): PlayerSnapshot {
    const shaped = constructs()?.shaped() ?? [];
    return shaped.length > 0 ? { ...snap, constructs: [...shaped] } : snap;
  }

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
    return withConstructs(snap);
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
      // A runtime scene loaded back already holds its player; adopt it rather than spawning a second.
      const loadedBack = scene.entities.find((e) => e.type === PLAYER_TYPE);
      if (loadedBack) {
        playerId = loadedBack.id;
        return;
      }
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
    beforeStep(dtMs, actions, commands) {
      applyShaper(commands);
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
      // A landing names what it landed on: grounded with no ground entity changes nothing.
      if (snap.grounded && snap.groundId !== undefined) {
        if (!prevGrounded || snap.groundId !== prevGroundId) {
          ctx.emit({ type: "landed", entityId: snap.groundId, at });
        }
        // Coming to rest from the air is the runner's safe moment to change the level under it.
        if (!prevGrounded) ctx.live.boundary("landed");
        prevGroundId = snap.groundId;
        prevGrounded = true;
      } else if (!snap.grounded && prevGrounded) {
        ctx.emit({ type: "left-ground", entityId: prevGroundId, at });
        prevGroundId = undefined;
        prevGrounded = false;
      }
      if (!sameSnapshot(slice.player, snap)) slice = { player: snap };
    },
    onSwap() {
      // A new solid where the player stands: lift it onto the nearest free spot.
      const player = actor();
      if (!player || playerId === null) return;
      if (blockersAt(ctx, playerId, player.getPosition()).length === 0) return;
      const rest = restFor(ctx, player, playerId);
      if (!rest) return;
      const body = player.getCollider().parent();
      body?.setTranslation(rest, true);
      body?.setNextKinematicTranslation(rest);
      ctx.physics?.refreshQueries();
      ctx.poses.set(playerId, rest.x, rest.y + PLAYER_HEIGHT / 2, 0, { snap: true });
    },
    snapshot() {
      const player = actor();
      return player ? snapshotOf(player) : withConstructs(noPlayer());
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
