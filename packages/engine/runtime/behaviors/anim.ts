import { clipFrameAt, resolveClips, type ResolvedClip } from "../../anim/clips";
import { frameShapesAt } from "../../anim/shapes";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { ANIM, type AnimBlock } from "../../game/behaviors/anim";
import { SPRITE, spriteOffset, type SpriteBlock } from "../../game/behaviors/sprite";
import { delayTicks, isCount, wholeTicksIn } from "../../game/time";
import { EngineError, type EngineContext, type JsonValue } from "../../game/types";
import { clipSourceIn } from "../../project/clip-source";
import { isPlainObject } from "../../project/kinds/define";
import { didYouMean } from "../../scene/did-you-mean";
import type { ShapeObj } from "../../scene/types";
import { currentPose } from "../spawn-pose";
import type { SpriteSystem } from "./sprite";

/** A frame that declares events was entered: `data` is `{ clip, frame, index, event }`, once per event. */
export const ANIM_FRAME = "anim:frame";
/** A `once` clip with no `next` played to its end and holds its last frame: `data` is `{ clip }`. */
export const ANIM_END = "anim:end";

/** Where an `anim` entity's clip is. */
export type AnimState = {
  clip: string;
  frame: string;
  index: number;
  /** Ticks into the frame. */
  into: number;
  playing: boolean;
  speed: number;
};

/** `EngineContext.anim`. */
export type AnimContext = {
  /** Throws `EngineError("anim-clip-unknown")` for a clip the entity's source lacks. */
  play(id: string, clip: string, opts?: { restart?: boolean; speed?: number }): void;
  stop(id: string): void;
  state(id: string): Readonly<AnimState> | undefined;
  /** A frame's named shape set in world space (pose, turn, flip applied); [] when the frame has none. */
  shapes(id: string, set: string): readonly ShapeObj[];
};

/** The `anim` behavior's system: it advances each entity's clip on the simulation's ticks. */
export interface AnimSystem extends BehaviorSystem<AnimBlock> {
  play(id: string, clip: string, opts?: { restart?: boolean; speed?: number }): void;
  stop(id: string): void;
  state(id: string): AnimState | undefined;
  shapes(id: string, set: string): readonly ShapeObj[];
}

/** One entity's clip as it runs. */
type Run = {
  block: AnimBlock;
  /** The clips its source resolves to at the run's tick rate; empty when it resolves to none. */
  clips: ReadonlyMap<string, ResolvedClip>;
  clip: ResolvedClip | null;
  /** Whole ticks into the clip's pass. */
  at: number;
  /** Thousandths of a tick carried to the next tick. */
  part: number;
  speed: number;
  playing: boolean;
  /** False until a step enters the clip's first frame. */
  started: boolean;
  off: boolean;
  /** The frame last handed to the sprite system. */
  shown: string | null;
  /** `play` or `stop` set it since its block last attached or changed clip. */
  byCode: boolean;
};

/** What a world save holds: the entity's `AnimState`, plus where in the pass it is and the carried thousandths. */
type Saved = AnimState & { at: number; part: number; started: boolean };

const MILLI = 1000;

/** Thousandths of a tick a run moves per tick: its speed times its clip's, at least one. */
const milliOf = (run: Run) => Math.max(1, Math.round(run.speed * (run.clip?.speed ?? 1) * MILLI));

const wraps = (clip: ResolvedClip) => clip.loop === "loop" || clip.loop === "pingpong";

/** Where a run starts `offset` ticks into `clip`: wrapped for a looping clip, short of the end for one that stops. */
function startAt(clip: ResolvedClip, offset: number): number {
  return wraps(clip) ? offset % clip.length : Math.min(offset, clip.length - 1);
}

/**
 * The `anim` system. Not visual: it runs headless, from the clips an
 * animation doc (or an atlas's tags) resolves to at the run's tick rate.
 * Each tick, in registration order after `sprite`, it moves every playing
 * entity on by its speed in whole thousandths of a tick. Entering a frame
 * hands it to the sprite system when there is a view and raises
 * `anim:frame` once per event the frame declares. A `once` clip's end goes
 * on to its `next`, else holds its last frame and raises `anim:end`.
 * An entity's first frame is entered on the first tick after it attaches
 * or after `play` (on that same tick when `play` runs before this system's
 * step); one started `offset` in mid-frame raises nothing for it.
 */
export const createAnimSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const runs = new Map<string, Run>();
  /** Resolved clips by source and tick rate, for the project they were read from. */
  const resolved = new Map<string, ReadonlyMap<string, ResolvedClip>>();
  let resolvedFor = ctx.project;

  function resolve(source: string): ReadonlyMap<string, ResolvedClip> {
    const project = ctx.project;
    if (project !== resolvedFor) {
      resolved.clear();
      resolvedFor = project;
    }
    const key = `${source}@${ctx.time.rate}`;
    const cached = resolved.get(key);
    if (cached) return cached;
    const found = project ? clipSourceIn(project, source) : null;
    const clips: ReadonlyMap<string, ResolvedClip> = found
      ? resolveClips(found.source, found.atlas, ctx.time).clips
      : new Map();
    resolved.set(key, clips);
    return clips;
  }

  const sprites = () => ctx.behavior<SpriteSystem>(SPRITE.name);

  function frameOf(run: Run): { index: number; into: number; frame: string } | null {
    if (!run.clip) return null;
    const { index, into } = clipFrameAt(run.clip, run.at);
    return { index, into, frame: run.clip.frames[index]!.frame };
  }

  function show(id: string, run: Run): void {
    const now = frameOf(run)?.frame ?? null;
    if (now === null || now === run.shown) return;
    run.shown = now;
    sprites()?.setFrame(id, now);
  }

  function enter(id: string, run: Run): void {
    show(id, run);
    const at = frameOf(run);
    if (!at || at.into !== 0) return;
    const events = run.clip!.frames[at.index]!.events;
    if (events.length === 0) return;
    const { x, y } = currentPose(ctx, id);
    for (const event of events) {
      ctx.emit({
        type: ANIM_FRAME,
        entityId: id,
        at: { x, y },
        data: { clip: run.clip!.name, frame: at.frame, index: at.index, event },
      });
    }
  }

  function begin(run: Run, clip: ResolvedClip | null, at: number): void {
    run.clip = clip;
    run.at = clip ? startAt(clip, at) : 0;
    run.part = 0;
    run.started = false;
  }

  /** One whole tick of `run`'s clip; `quiet` (a seek) raises nothing and draws nothing. */
  function advance(id: string, run: Run, quiet: boolean): void {
    const clip = run.clip!;
    run.at++;
    if (wraps(clip)) run.at %= clip.length;
    else if (run.at >= clip.length) {
      run.at = clip.length;
      if (clip.loop === "hold") return;
      const next = clip.next === null ? undefined : run.clips.get(clip.next);
      if (!next) {
        run.playing = false;
        if (quiet) return;
        const { x, y } = currentPose(ctx, id);
        ctx.emit({ type: ANIM_END, entityId: id, at: { x, y }, data: { clip: clip.name } });
        return;
      }
      // The next clip goes on from the thousandths of a tick this one left over.
      const part = run.part;
      begin(run, next, 0);
      run.part = part;
      run.started = true;
      if (!quiet) enter(id, run);
      return;
    }
    if (!quiet && clipFrameAt(clip, run.at).into === 0) enter(id, run);
  }

  /** Moves `run` on by one tick's worth of thousandths. */
  function tick(id: string, run: Run, quiet: boolean): void {
    if (!run.started) {
      run.started = true;
      if (!quiet) enter(id, run);
      return;
    }
    run.part += milliOf(run);
    while (run.part >= MILLI && run.playing && run.clip) {
      run.part -= MILLI;
      advance(id, run, quiet);
    }
  }

  function fresh(block: AnimBlock, shown: string | null): Run {
    const clips = resolve(block.source);
    const run: Run = {
      block,
      clips,
      clip: null,
      at: 0,
      part: 0,
      speed: block.speed ?? 1,
      playing: block.playing ?? true,
      started: false,
      off: false,
      shown,
      byCode: false,
    };
    begin(
      run,
      clips.get(block.clip) ?? null,
      delayTicks(block.offset ?? 0, ctx.time, "anim offset"),
    );
    return run;
  }

  function stateOf(run: Run): AnimState | undefined {
    const at = frameOf(run);
    if (!at) return undefined;
    return {
      clip: run.clip!.name,
      frame: at.frame,
      index: at.index,
      into: at.into,
      playing: run.playing,
      speed: run.speed,
    };
  }

  function runOf(id: string): Run {
    const run = runs.get(id);
    if (!run) throw new EngineError("behavior-missing", `"${id}" has no anim block`, id);
    return run;
  }

  const system: AnimSystem = {
    attach(id, block) {
      const run = fresh(block, null);
      runs.set(id, run);
      show(id, run);
    },
    update(id, block, prev) {
      const before = runs.get(id);
      if (!before || block.source !== prev.source || block.clip !== prev.clip) {
        const run = fresh(block, before?.shown ?? null);
        runs.set(id, run);
        show(id, run);
        return;
      }
      // Same clip: re-read the clips (an asset reload) and keep the place in it.
      before.block = block;
      before.clips = resolve(block.source);
      const clip = before.clip ? (before.clips.get(before.clip.name) ?? null) : null;
      const at = before.at;
      before.clip = clip;
      if (!clip) before.at = 0;
      else before.at = wraps(clip) ? at % clip.length : Math.min(at, clip.length);
      if (block.speed !== prev.speed) before.speed = block.speed ?? 1;
      if (block.playing !== prev.playing) before.playing = block.playing ?? true;
      show(id, before);
    },
    detach(id) {
      runs.delete(id);
    },
    step() {
      for (const [id, run] of runs) {
        if (run.off || !run.playing || !run.clip) continue;
        tick(id, run, false);
      }
    },
    // A run `play` or `stop` set is kept as it is: a load resets before any tick runs.
    reset() {
      for (const [id, run] of runs) {
        if (run.byCode) continue;
        const again = fresh(run.block, run.shown);
        again.off = run.off;
        runs.set(id, again);
        show(id, again);
      }
    },
    seek(ms) {
      const { ticks } = wholeTicksIn(ms, ctx.time);
      if (ticks === 0) return;
      for (const [id, run] of runs) {
        if (run.off) continue;
        for (let i = 0; i < ticks && run.playing && run.clip; i++) tick(id, run, true);
        show(id, run);
      }
    },
    disable(id) {
      const run = runs.get(id);
      if (run) run.off = true;
    },
    enable(id) {
      const run = runs.get(id);
      if (run) run.off = false;
    },
    play(id, name, opts) {
      const run = runOf(id);
      const clip = run.clips.get(name);
      if (!clip) {
        throw new EngineError(
          "anim-clip-unknown",
          `"${id}" has no clip "${name}"${didYouMean(name, [...run.clips.keys()])}`,
          id,
        );
      }
      if (opts?.speed !== undefined) {
        if (!(opts.speed > 0) || !Number.isFinite(opts.speed))
          throw new EngineError("schema", `an anim speed must be above 0, not ${opts.speed}`, id);
        run.speed = opts.speed;
      }
      const ended = run.clip === clip && clip.loop === "once" && run.at >= clip.length;
      const same = run.clip === clip && !opts?.restart && !ended;
      run.playing = true;
      run.byCode = true;
      if (same) return;
      begin(run, clip, 0);
      show(id, run);
    },
    stop(id) {
      const run = runOf(id);
      run.playing = false;
      run.byCode = true;
    },
    state(id) {
      const run = runs.get(id);
      return run ? stateOf(run) : undefined;
    },
    shapes(id, set) {
      const run = runs.get(id);
      const at = run ? frameOf(run) : null;
      const local = at ? run!.clip!.frames[at.index]!.shapes[set] : undefined;
      if (!local || local.length === 0) return [];
      // Placed as the sprite is drawn: at its anchor, mirrored by its flip, turned unless `turn: false`.
      const e = ctx.get(id);
      const sprite = e?.behaviors?.[SPRITE.name] as Partial<SpriteBlock> | undefined;
      const flipX = (sprite?.flipX ?? false) !== (e?.transform?.flip ?? false);
      const pose = currentPose(ctx, id);
      const turn = sprite?.turn !== false;
      const [dx, dy] = spriteOffset(sprite?.offset ?? [0, 0], e?.transform, turn ? pose.rot : null);
      return frameShapesAt(
        local,
        { x: pose.x + dx, y: pose.y + dy, rot: turn ? pose.rot : 0 },
        flipX,
      );
    },
    save(id) {
      const run = runs.get(id);
      const state = run ? stateOf(run) : undefined;
      if (!run || !state) return undefined;
      const saved: Saved = { ...state, at: run.at, part: run.part, started: run.started };
      return saved as JsonValue;
    },
    restore(id, state) {
      const run = runs.get(id);
      if (!run || !isPlainObject(state)) return;
      const saved = state as Partial<Record<keyof Saved, unknown>>;
      const clip = typeof saved.clip === "string" ? run.clips.get(saved.clip) : undefined;
      if (!clip || !isCount(saved.at) || !isCount(saved.part) || saved.part >= MILLI) return;
      if (typeof saved.speed !== "number" || !(saved.speed > 0)) return;
      run.clip = clip;
      run.at = Math.min(saved.at, clip.length);
      run.part = saved.part;
      run.speed = saved.speed;
      run.playing = saved.playing === true;
      run.started = saved.started !== false;
      show(id, run);
    },
    clear() {
      runs.clear();
      resolved.clear();
    },
    size: () => runs.size,
  };
  return system as BehaviorSystem;
};

/** `ctx.anim`: the `anim` system's queries, by entity id. */
export function animContext(ctx: Pick<EngineContext, "behavior">): AnimContext {
  const system = () => ctx.behavior<AnimSystem>(ANIM.name);
  return {
    play: (id, clip, opts) => system()?.play(id, clip, opts),
    stop: (id) => system()?.stop(id),
    state: (id) => system()?.state(id),
    shapes: (id, set) => system()?.shapes(id, set) ?? [],
  };
}
