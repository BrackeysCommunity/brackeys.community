import { pxPerMetreOf, type GameDefinition } from "@jams/engine/game";
import {
  parseShape,
  roundLength,
  sceneHash,
  snapToPixel,
  type Pt,
  type SceneIssue,
  type SceneOp,
  type ShapeObj,
} from "@jams/engine/scene";

import { GRAPPLE_RANGE } from "./entities/grapple-anchor";
import { PLAYER_HEIGHT, PLAYER_TYPE, PLAYER_WIDTH } from "./entities/player";
import { TYPE } from "./type-names";
import { placedOf, platformerIssue, spawnsOf, type Spawn } from "./validate";

type PhysicalCheck = NonNullable<GameDefinition["physicalChecks"]>[number];
type PhysicalEnv = Parameters<PhysicalCheck["run"]>[0];
type Hit = ReturnType<PhysicalEnv["overlaps"]>[number];

/** What a player can't stand inside: ground, clouds and Shaper constructs. */
const BLOCKING: readonly string[] = ["solid", TYPE.cloud, TYPE.construct];
/** The ids of the loaded world's actors, which the runtime spawns at the first spawn: never in the way of a check. */
const selfOf = (env: PhysicalEnv) =>
  env.scene.entities.filter((e) => e.type === PLAYER_TYPE).map((e) => e.id);
/** How far up `spawn-in-solid`'s fix looks for room, per try; under half the player box, so no gap it fits is skipped. */
const LIFT_STEP = PLAYER_HEIGHT / 4;

const fmt = ([x, y]: Pt) => `[${x}, ${y}]`;
const ids = (hits: readonly Hit[]) => [...new Set(hits.map((h) => h.tag.entityId))];
const blocking = (hits: readonly Hit[]) => hits.filter((h) => BLOCKING.includes(h.tag.type));
/** A length on the nearest whole world px, as the scene would hold it. */
const toPixel = (env: PhysicalEnv, m: number) => snapToPixel(m, pxPerMetreOf(env.registry));
const pointOf = (env: PhysicalEnv, h: Hit): Pt => [toPixel(env, h.at.x), toPixel(env, h.at.y)];

/** The player's box standing with its feet at `feet`. */
const playerBox = ([x, y]: Pt): ShapeObj => ({
  type: "box",
  cx: x,
  cy: y - PLAYER_HEIGHT / 2,
  hw: PLAYER_WIDTH / 2,
  hh: PLAYER_HEIGHT / 2,
  rotDeg: 0,
});

/** A point as a tiny circle (1 cm), for "is this inside something". */
const dot = ([cx, cy]: Pt, r = 0.01): ShapeObj => ({ type: "circle", cx, cy, r });

/**
 * Where the player lands when dropped from the first spot above `feet`
 * with room for its box, within the bounds; null when there is none.
 */
function landing(env: PhysicalEnv, feet: Pt): Pt | null {
  const [, minY, , maxY] = env.def.bounds;
  const self = selfOf(env);
  for (let y = feet[1] - LIFT_STEP; y - PLAYER_HEIGHT >= minY; y -= LIFT_STEP) {
    const box = playerBox([feet[0], y]);
    if (blocking(env.overlaps(box, { exclude: self })).length > 0) continue;
    const fall = maxY - y;
    const hit = env.cast(box, { x: 0, y: fall }, { exclude: self });
    return hit ? [feet[0], toPixel(env, y + hit.toi * fall)] : null;
  }
  return null;
}

function spawnInSolid(env: PhysicalEnv, spawn: Spawn, hits: readonly Hit[]): SceneIssue {
  const to = landing(env, spawn.at);
  const move: SceneOp | null = to && {
    op: "move",
    refs: [spawn.ref],
    by: [0, roundLength(to[1] - spawn.at[1])],
  };
  return platformerIssue("platformer/spawn-in-solid", {
    message: `spawn ${spawn.ref} at ${fmt(spawn.at)} puts the player inside ${ids(hits).join(", ")}${to ? `; it would land at ${fmt(to)}` : ""}`,
    path: spawn.path,
    entityIds: [spawn.ref, ...ids(hits)],
    at: pointOf(env, hits[0]!),
    ...(move && {
      fix: {
        label: `Drop ${spawn.ref} onto the surface at ${fmt(to!)}`,
        ...(spawn.ref.startsWith("~") && { base: sceneHash(env.def) }),
        ops: [move],
      },
    }),
  });
}

const spawnChecks: PhysicalCheck = {
  id: "spawns",
  description: "Each spawn's player box is clear of solids and hazards and has a floor below.",
  needsPhysics: true,
  run(env) {
    const out: SceneIssue[] = [];
    const self = selfOf(env);
    for (const spawn of spawnsOf(env.def)) {
      const box = playerBox(spawn.at);
      const solids = blocking(env.overlaps(box, { exclude: self }));
      if (solids.length > 0) out.push(spawnInSolid(env, spawn, solids));
      const hazards = env
        .overlaps(box, { sensors: true, exclude: self })
        .filter((h) => h.tag.type === TYPE.hazard);
      if (hazards.length > 0) {
        out.push(
          platformerIssue("platformer/spawn-in-hazard", {
            message: `spawn ${spawn.ref} at ${fmt(spawn.at)} puts the player in hazard ${ids(hazards).join(", ")}`,
            path: spawn.path,
            entityIds: [spawn.ref, ...ids(hazards)],
            at: pointOf(env, hazards[0]!),
          }),
        );
      }
      const fall = env.def.bounds[3] - spawn.at[1];
      if (solids.length === 0 && fall > 0 && !env.cast(box, { x: 0, y: fall }, { exclude: self })) {
        out.push(
          platformerIssue("platformer/spawn-floating", {
            message: `nothing is under spawn ${spawn.ref} at ${fmt(spawn.at)} down to the bounds' bottom (y ${env.def.bounds[3]})`,
            path: spawn.path,
            entityIds: [spawn.ref],
            at: spawn.at,
          }),
        );
      }
    }
    return out;
  },
};

const anchorChecks: PhysicalCheck = {
  id: "anchors",
  description: `Each grapple anchor is in open air with something to stand on within ${GRAPPLE_RANGE} m.`,
  needsPhysics: true,
  run(env) {
    const anchors = [
      ...placedOf(env.def, TYPE.anchor, "at"),
      ...placedOf(env.def, TYPE.construct, "at", (e) => e.construct === "grapple_anchor"),
    ];
    const out: SceneIssue[] = [];
    const self = selfOf(env);
    for (const { ref, value, path } of anchors) {
      const at = value as Pt;
      const inside = blocking(env.overlaps(dot(at), { exclude: self }));
      if (inside.length > 0) {
        out.push(
          platformerIssue("platformer/anchor-in-solid", {
            message: `anchor ${ref} at ${fmt(at)} is inside ${ids(inside).join(", ")}`,
            path,
            entityIds: [ref, ...ids(inside)],
            at,
          }),
        );
      }
      if (env.overlaps(dot(at, GRAPPLE_RANGE), { exclude: self }).length === 0) {
        out.push(
          platformerIssue("platformer/anchor-orphan", {
            message: `nothing to stand on within ${GRAPPLE_RANGE} m of anchor ${ref} at ${fmt(at)}`,
            path,
            entityIds: [ref],
            at,
          }),
        );
      }
    }
    return out;
  },
};

const cloudChecks: PhysicalCheck = {
  id: "clouds",
  description: "No cloud overlaps a solid.",
  needsPhysics: true,
  run(env) {
    const out: SceneIssue[] = [];
    const self = selfOf(env);
    for (const { ref, value, path } of placedOf(env.def, TYPE.cloud, "shape")) {
      const parsed = parseShape(value);
      if (!parsed.ok) continue;
      const solids = env.overlaps(parsed.shape, { exclude: [ref, ...self] });
      const hits = solids.filter((h) => h.tag.type === "solid");
      if (hits.length === 0) continue;
      out.push(
        platformerIssue("platformer/cloud-in-solid", {
          message: `cloud ${ref} overlaps ${ids(hits).join(", ")}`,
          path,
          entityIds: [ref, ...ids(hits)],
          at: pointOf(env, hits[0]!),
        }),
      );
    }
    return out;
  },
};

/**
 * The platformer's checks over the loaded world: spawns, grapple anchors and
 * clouds. They model the player's Rapier body, so a scene without physics
 * skips them.
 */
export const PLATFORMER_PHYSICAL_CHECKS: readonly PhysicalCheck[] = [
  spawnChecks,
  anchorChecks,
  cloudChecks,
];
