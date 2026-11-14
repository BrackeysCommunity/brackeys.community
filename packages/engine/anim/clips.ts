/**
 * Clips resolved for the simulation: every frame duration a whole number of
 * ticks, frames checked against the atlas's meta. Pure, so a run, its
 * replay and a seek agree on which frame shows on which tick.
 */
import { ticksFor, type ResolvedTime } from "../game/time";
import type { AssetInfo } from "../project/asset-info";
import { clipFrames, tagOf } from "../project/clip-source";
import {
  animationIssues,
  DEFAULT_FRAME_MS,
  sourceAnimation,
  type AnimFrameDef,
  type ClipLoop,
  type ClipSource,
} from "../project/kinds/animation";
import { parseShape } from "../scene/shapes";
import type { SceneIssue, ShapeObj } from "../scene/types";

export { DEFAULT_FRAME_MS, type ClipSource };

/** A clip with every duration in ticks and frames resolved against the atlas meta. */
export type ResolvedClip = {
  name: string;
  frames: readonly {
    frame: string;
    ticks: number;
    events: readonly string[];
    shapes: Readonly<Record<string, readonly ShapeObj[]>>;
  }[];
  loop: ClipLoop;
  speed: number;
  next: string | null;
  /** Sum of `ticks` over one pass (pingpong: there and back without repeating the ends). */
  length: number;
};

const CLIP_PATH = /^\/clips\/(\d+)(?:\/|$)/;

/** The clip indices an error leaves out, or "all" when one names no clip (the atlas itself). */
function refusedClips(issues: readonly SceneIssue[]): Set<number> | "all" {
  const out = new Set<number>();
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    const clip = CLIP_PATH.exec(issue.path ?? "")?.[1];
    if (clip === undefined) return "all";
    out.add(Number(clip));
  }
  return out;
}

function resolveShapes(def: AnimFrameDef): Readonly<Record<string, readonly ShapeObj[]>> {
  return Object.fromEntries(
    Object.entries(def.shapes ?? {}).map(([set, tuples]) => [
      set,
      tuples.flatMap((tuple) => {
        const parsed = parseShape(tuple);
        return parsed.ok ? [parsed.shape] : [];
      }),
    ]),
  );
}

/** Ticks in one pass of `frames` played as `loop`. */
function passLength(frames: readonly { ticks: number }[], loop: ClipLoop): number {
  const sum = frames.reduce((n, f) => n + f.ticks, 0);
  if (loop !== "pingpong") return sum;
  return frames.slice(1, -1).reduce((n, f) => n + f.ticks, sum);
}

/**
 * The clips of `source` over `atlas`, at the run's tick rate, and the
 * issues that left any out. An atlas source's tags become clips named
 * after them. Each frame's `ms` (else the atlas frame's durationMs, else
 * `DEFAULT_FRAME_MS`) becomes whole ticks, at least 1. A clip any error points into is
 * left out, and a `next` naming a clip left out is dropped; an error on
 * the atlas itself leaves every clip out. Of two clips with one name, the
 * first counts.
 */
export function resolveClips(
  source: ClipSource,
  atlas: AssetInfo,
  time: Pick<ResolvedTime, "rate">,
): { clips: ReadonlyMap<string, ResolvedClip>; issues: SceneIssue[] } {
  const file = sourceAnimation(source);
  const issues = animationIssues(file, atlas);
  const refused = refusedClips(issues);
  const clips = new Map<string, ResolvedClip>();
  if (refused === "all") return { clips, issues };
  const names = atlas.frames ?? [];
  const atlasMs = (frame: string): number | undefined => {
    const at = names.indexOf(frame);
    return at < 0 ? undefined : (atlas.durations?.[at] ?? undefined);
  };
  file.clips.forEach((clip, c) => {
    if (refused.has(c) || clips.has(clip.name)) return;
    const tag = tagOf(clip, atlas);
    const loop = clip.loop ?? (tag?.direction === "pingpong" ? "pingpong" : "loop");
    const frames = clipFrames(clip, atlas).map((def) => ({
      frame: def.frame,
      ticks: ticksFor(def.ms ?? atlasMs(def.frame) ?? DEFAULT_FRAME_MS, time),
      events: [...(def.events ?? [])],
      shapes: resolveShapes(def),
    }));
    if (frames.length === 0) return;
    clips.set(clip.name, {
      name: clip.name,
      frames,
      loop,
      speed: clip.speed ?? 1,
      next: clip.next ?? null,
      length: passLength(frames, loop),
    });
  });
  for (const [name, clip] of clips)
    if (clip.next !== null && !clips.has(clip.next)) clips.set(name, { ...clip, next: null });
  return { clips, issues };
}

/**
 * The frame index and ticks into it after `elapsed` whole ticks of `clip`.
 * `loop` and `pingpong` wrap at `length`; `once` and `hold` stay on their
 * last frame from `length` on, `into` at its last tick, and only `once` is
 * then `done`.
 */
export function clipFrameAt(
  clip: ResolvedClip,
  elapsed: number,
): { index: number; into: number; done: boolean } {
  const frames = clip.frames;
  const last = frames.length - 1;
  if (last < 0) return { index: 0, into: 0, done: true };
  let rest = Math.max(0, Math.floor(elapsed));
  if (clip.loop === "once" || clip.loop === "hold") {
    if (rest >= clip.length)
      return { index: last, into: frames[last]!.ticks - 1, done: clip.loop === "once" };
  } else rest %= clip.length;
  const pass = clip.loop === "pingpong" ? 2 * last : last + 1;
  for (let step = 0; step < Math.max(1, pass); step++) {
    const index = step <= last ? step : 2 * last - step;
    const ticks = frames[index]!.ticks;
    if (rest < ticks) return { index, into: rest, done: false };
    rest -= ticks;
  }
  return { index: last, into: frames[last]!.ticks - 1, done: false };
}
