/**
 * Presentation requests: game code and behaviors ask the shell for camera
 * moves, effects and sounds during a step, and nothing reads them back in
 * the simulation. The runtime takes each tick's list after the tick; the
 * shell presents it, and headless keeps it only when a test asks.
 */
import type { EaseName } from "../anim/ease";
import type { CameraTargetSpec } from "../camera/rig";
import type { AssetId } from "../project/types";
import type { Vec2 } from "../types";

/** What the camera rig is asked to do; `viewport` picks one of several (default 0). */
export type CameraRequest =
  /** Replaces the targets until `follow(null)` gives the rig's own back. */
  | { op: "follow"; target: CameraTargetSpec | null; viewport?: number }
  /** Eases to `zoom` over `ms` (default at once). */
  | { op: "zoom"; zoom: number; ms?: number; ease?: EaseName; viewport?: number }
  /** Adds trauma, 0–1; nothing under reduced motion. */
  | { op: "shake"; trauma: number; viewport?: number }
  /** Jumps to `at`, or to the targets' goal, with no easing. */
  | { op: "snap"; at?: Vec2; viewport?: number };

/** What the effect and particle layers are asked to do. */
export type EffectRequest =
  /** A full-canvas flash: `color` 0xRRGGBB, fading over `ms`. */
  | { op: "flash"; color?: number; ms?: number; alpha?: number }
  /** Stops the loop's clock for `ms` of wall time; no tick runs meanwhile. */
  | { op: "hitStop"; ms: number }
  /** Particles from an emitter preset at a world point (metres). */
  | { op: "burst"; preset: AssetId; at: Vec2; count?: number; angle?: number; tint?: number };

/** What the audio system is asked to do. */
export type AudioRequest =
  | {
      op: "play";
      sound: AssetId;
      at?: Vec2;
      entity?: string;
      volume?: number;
      pitch?: number;
      key?: string;
    }
  | { op: "stop"; key: string; fadeMs?: number }
  /** `tick` is the tick the request was made on, so music `at: "tick"` can line up with it. */
  | { op: "music"; sound: AssetId | null; fadeMs?: number; at: "start" | "tick"; tick: number };

export type PresentRequest =
  | { kind: "camera"; op: CameraRequest }
  | { kind: "effect"; op: EffectRequest }
  | { kind: "audio"; op: AudioRequest };

/** A request with the tick that made it, as a playtest report lists them. */
export type PresentedRequest = PresentRequest & { tick: number };

/**
 * `EngineContext.present`: write-only. Each call appends to the tick's list
 * and returns nothing; there is no getter.
 */
export interface PresentationQueue {
  camera: {
    follow(target: CameraTargetSpec | null, opts?: { viewport?: number }): void;
    zoom(zoom: number, opts?: { ms?: number; ease?: EaseName; viewport?: number }): void;
    shake(trauma: number, opts?: { viewport?: number }): void;
    snap(at?: Vec2, opts?: { viewport?: number }): void;
  };
  effects: {
    flash(opts?: { color?: number; ms?: number; alpha?: number }): void;
    hitStop(ms: number): void;
    burst(
      preset: AssetId,
      at: Vec2,
      opts?: { count?: number; angle?: number; tint?: number },
    ): void;
  };
  audio: {
    play(sound: AssetId, opts?: { at?: Vec2; volume?: number; pitch?: number; key?: string }): void;
    stop(key: string, opts?: { fadeMs?: number }): void;
    music(sound: AssetId | null, opts?: { fadeMs?: number; at?: "start" | "tick" }): void;
  };
}

/** The queue game code writes to, and the runtime's way of taking each tick's list. */
export type PresentationQueueHandle = {
  readonly queue: PresentationQueue;
  /** The requests made since the last call, in request order, emptied. */
  readonly take: () => readonly PresentRequest[];
};

const point = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

/** `opts`'s defined fields, copied, so a caller changing its object later can't reach the list. */
function defined<T extends object>(opts: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!opts) return out;
  for (const key of Object.keys(opts) as (keyof T)[]) {
    const value = opts[key];
    if (value === undefined) continue;
    out[key] = (
      key === "at" && typeof value === "object" && value !== null
        ? point(value as unknown as Vec2)
        : value
    ) as T[keyof T];
  }
  return out;
}

const NONE: readonly PresentRequest[] = Object.freeze([]);

/**
 * A presentation queue. With `record` false every call is dropped and
 * `take` gives an empty list, so a run nobody presents allocates nothing.
 * `tick` is read when a music request is made.
 */
export function createPresentationQueue(opts: {
  record: boolean;
  tick: () => number;
}): PresentationQueueHandle {
  let list: PresentRequest[] = [];
  const push = (req: PresentRequest) => {
    if (opts.record) list.push(req);
  };
  const camera = (op: CameraRequest) => push({ kind: "camera", op });
  const effect = (op: EffectRequest) => push({ kind: "effect", op });
  const audio = (op: AudioRequest) => push({ kind: "audio", op });

  const queue: PresentationQueue = {
    camera: {
      follow(target, o) {
        const copied: CameraTargetSpec | null =
          target === null
            ? null
            : "point" in target
              ? { ...target, point: point(target.point) }
              : { ...target };
        camera({ op: "follow", target: copied, ...defined(o) });
      },
      zoom: (zoom, o) => camera({ op: "zoom", zoom, ...defined(o) }),
      shake: (trauma, o) => camera({ op: "shake", trauma, ...defined(o) }),
      snap: (at, o) => camera({ op: "snap", ...(at ? { at: point(at) } : {}), ...defined(o) }),
    },
    effects: {
      flash: (o) => effect({ op: "flash", ...defined(o) }),
      hitStop: (ms) => effect({ op: "hitStop", ms }),
      burst: (preset, at, o) => effect({ op: "burst", preset, at: point(at), ...defined(o) }),
    },
    audio: {
      play: (sound, o) => audio({ op: "play", sound, ...defined(o) }),
      stop: (key, o) => audio({ op: "stop", key, ...defined(o) }),
      music: (sound, o) =>
        audio({
          op: "music",
          sound,
          ...(o?.fadeMs !== undefined ? { fadeMs: o.fadeMs } : {}),
          at: o?.at ?? "start",
          tick: opts.tick(),
        }),
    },
  };

  return {
    queue,
    take: () => {
      if (list.length === 0) return NONE;
      const taken = list;
      list = [];
      return taken;
    },
  };
}
