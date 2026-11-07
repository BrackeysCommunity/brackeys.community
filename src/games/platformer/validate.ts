import type { SceneValidator } from "@jams/engine/game";
import {
  aabb,
  bulkEntries,
  jsonPointer,
  makeIssue,
  parseShape,
  type EntityDef,
  type Pt,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";

import { PLAYER_HEIGHT, PLAYER_WIDTH } from "./entities/player";
import { PLATFORMER_ISSUES, type PlatformerIssueCode } from "./issues";
import { TYPE } from "./type-names";

export type Spawn = { ref: string; at: Pt; path: string };

/** A `SceneIssue` for one of the platformer's own codes. */
export const platformerIssue = (
  code: PlatformerIssueCode,
  fields: Omit<Partial<SceneIssue>, "code"> & { message: string },
) => makeIssue(code, fields, PLATFORMER_ISSUES);

const live = (def: SceneDefinition): [EntityDef, number][] =>
  (def.entities ?? []).map((e, i): [EntityDef, number] => [e, i]).filter(([e]) => !e.off);

/** Something a scene places: a bulk entry or a live entity's `field`, with its ref and document path. */
export type Placed = { ref: string; value: unknown; path: string };

/** A type's bulk entries, then its live entities (those `where` keeps), as the runtime spawns them. */
export function placedOf(
  def: SceneDefinition,
  type: string,
  field: string,
  where: (e: EntityDef) => boolean = () => true,
): Placed[] {
  const out: Placed[] = bulkEntries(def, type).map((value, i) => ({
    ref: `~${type}:${i}`,
    value,
    path: jsonPointer([type, i]),
  }));
  for (const [e, i] of live(def)) {
    if (e.type === type && where(e))
      out.push({ ref: e.id, value: e[field], path: jsonPointer(["entities", i, field]) });
  }
  return out;
}

/** Spawn points, bulk first, as the runtime spawns them. */
export function spawnsOf(def: SceneDefinition): Spawn[] {
  return placedOf(def, TYPE.spawn, "at").map(({ ref, value, path }) => ({
    ref,
    at: value as Pt,
    path,
  }));
}

const spawns: SceneValidator = (def) => {
  const list = spawnsOf(def);
  if (list.length === 0) {
    return [
      platformerIssue("platformer/spawn-missing", {
        message: "the scene has no spawn point",
        path: "",
      }),
    ];
  }
  const out: SceneIssue[] = [];
  list.forEach((s, j) => {
    for (const o of list.slice(0, j)) {
      if (
        Math.abs(s.at[0] - o.at[0]) < PLAYER_WIDTH &&
        Math.abs(s.at[1] - o.at[1]) < PLAYER_HEIGHT
      ) {
        out.push(
          platformerIssue("platformer/spawn-overlap", {
            message: `spawn ${s.ref} at [${s.at[0]}, ${s.at[1]}] overlaps spawn ${o.ref} at [${o.at[0]}, ${o.at[1]}]`,
            path: s.path,
            entityIds: [s.ref, o.ref],
            at: [s.at[0], s.at[1]],
          }),
        );
      }
    }
  });
  return out;
};

const windRotation: SceneValidator = (def) =>
  live(def)
    .filter(
      ([e]) =>
        e.type === TYPE.construct &&
        e.construct === "wind_zone" &&
        ((e.rot as number | undefined) ?? 0) % 360 !== 0,
    )
    .map(([e, i]) => {
      const at = e.at as Pt;
      return platformerIssue("platformer/wind-rotation", {
        message: `${e.id} is a wind zone rotated ${String(e.rot)}°, but the player ignores wind rotation`,
        path: jsonPointer(["entities", i, "rot"]),
        entityIds: [e.id],
        at: [at[0], at[1]],
        fix: { label: `Unrotate ${e.id}`, ops: [{ op: "update", ref: e.id, unset: ["rot"] }] },
      });
    });

const playability: SceneValidator = (def) => {
  const out: SceneIssue[] = [];
  const entities = live(def).map(([e]) => e);
  if (!entities.some((e) => e.type === TYPE.goal || e.type === TYPE.exit)) {
    out.push(
      platformerIssue("platformer/no-goal", {
        message: "the scene has no goal or exit, so a run can't finish",
        path: "",
      }),
    );
  }
  const [minX, , maxX] = def.bounds;
  const killPlane = entities.some((e) => {
    if (e.type !== TYPE.hazard) return false;
    const s = parseShape(e.shape);
    if (!s.ok) return false;
    const box = aabb(s.shape);
    return box.minX <= minX && box.maxX >= maxX;
  });
  if (!killPlane) {
    const ids = new Set((def.entities ?? []).map((e) => e.id));
    let id = "kill-plane";
    for (let n = 2; ids.has(id); n++) id = `kill-plane-${n}`;
    const maxY = def.bounds[3];
    const cx = Math.floor((minX + maxX) / 2);
    out.push(
      platformerIssue("platformer/no-kill-plane", {
        message: "no hazard spans the bounds' full width, so a fall never ends",
        path: "/bounds",
        fix: {
          label: "Add a kill plane along the bottom of the bounds",
          ops: [
            {
              op: "add",
              entity: { id, type: TYPE.hazard, shape: ["box", cx, maxY - 8, maxX - cx, 8] },
            },
          ],
        },
      }),
    );
  }
  return out;
};

export const PLATFORMER_VALIDATORS: readonly SceneValidator[] = [spawns, windRotation, playability];
