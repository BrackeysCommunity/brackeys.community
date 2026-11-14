import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { spawnPose } from "@jams/engine/game";
import type { Registry, RuntimeEntity } from "@jams/engine/scene";

/**
 * Every scene and prefab file that was at format 4 when format 5 came in,
 * as its v4 text, with a digest of what a v4 engine expanded it to: the
 * scenes through `expandScene` with their project's prefabs, a prefab as
 * one instance of it at the origin.
 */
export type Format4Corpus = {
  files: Record<string, string>;
  expanded: Record<string, PoseDigest>;
};

export type PoseDigest = { entities: number; digest: string };

const CORPUS = new URL("./format-4-corpus.json.gz", import.meta.url);

export function readFormat4Corpus(): Format4Corpus {
  return JSON.parse(gunzipSync(readFileSync(CORPUS)).toString("utf8")) as Format4Corpus;
}

const micro = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** Degrees in [0, 360) to the micro-degree. */
function deg(n: number): number {
  const r = micro(((n % 360) + 360) % 360);
  return r === 360 ? 0 : r;
}

/**
 * One row per entity, in load order, leaving out the ids in `drop`: id,
 * type, the parent it loads under (none when that is dropped), and its
 * spawn pose (`spawnPose`: its first shape's centre, a path rider's at the
 * path's first point, else its point, else its path's first point; the
 * shape's angle, else its frame's), to the micrometre and micro-degree, and
 * its frame's flip.
 */
export function poseDigest(
  entities: readonly RuntimeEntity[],
  registry: Registry,
  drop: ReadonlySet<string> = new Set(),
): PoseDigest {
  const rows: unknown[] = [];
  for (const e of entities) {
    if (drop.has(e.id)) continue;
    const pose = spawnPose(e, registry);
    const parent = e.parent !== undefined && !drop.has(e.parent) ? e.parent : null;
    rows.push([
      e.id,
      e.type,
      parent,
      micro(pose.x),
      micro(pose.y),
      deg((pose.rot * 180) / Math.PI),
      e.transform?.flip === true,
    ]);
  }
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { entities: rows.length, digest };
}
