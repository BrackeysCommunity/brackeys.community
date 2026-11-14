/**
 * The particle layer: emitters and bursts drawn from `emitter` presets,
 * updated on rendered frames with the loop's scaled wall time. View-side
 * only: never built headless, and its randomness is its own stream, never
 * the simulation's.
 */
import { type Container, Particle, ParticleContainer, Texture } from "pixi.js";

import { layerOrder, type SpriteVisual, type ViewLayer } from "../context";
import { spriteAssets } from "../game/behaviors/sprite";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import type { EngineContext } from "../game/types";
import { lerpRgb } from "../math";
import {
  EMITTER_MAX_CAP,
  EMITTER_MAX_DEFAULT,
  type EmitterCurve,
  type EmitterFile,
} from "../project/kinds/emitter";
import type { Sha256 } from "../project/types";
import type { Pose } from "../runtime/poses";
import type { BurstOptions } from "../runtime/present";
import { viewRandom } from "../sim-kit/rng";
import type { Vec2 } from "../types";
import type { TextureSource } from "./pixi-view";
import { createSpriteTextures, type SpriteTextures } from "./sprite-textures";

export interface ParticleLayer {
  /**
   * Starts (or restarts) the emitter `id` on `layer` (default the layer's
   * own container), following `at` each frame; while `at` gives undefined
   * it emits nothing. A restart keeps the particles it has alive.
   */
  emitter(id: string, preset: EmitterFile, at: () => Pose | undefined, layer?: ViewLayer): void;
  /** Stops the emitter `id`: what it put in world space lives out its life, what it put in local space goes. */
  remove(id: string): void;
  /**
   * One burst at a world point (metres): `count` particles (default the
   * preset's bursts' total, else one second of its rate), its angle range
   * turned by `angle` degrees, drawn in `tint` instead of its tint curve.
   */
  burst(preset: EmitterFile, at: Vec2, opts?: BurstOptions): void;
  /** Wall ms scaled by the loop's time scale; 0 while paused. */
  update(dtMs: number): void;
  stats(): { emitters: number; particles: number };
  /** Drops every emitter and particle, and the textures it holds. */
  clear(): void;
}

/** A preset's texture as the layer draws it: a content hash, an atlas frame in it and the sampling. */
export type ParticleTexture = {
  hash: Sha256;
  frame?: NonNullable<SpriteVisual["frame"]>;
  sampling: SpriteVisual["sampling"];
};

export type ParticleLayerOptions = {
  /** Rates and burst counts are quartered while it holds; a function is read on each use. */
  reducedMotion: boolean | (() => boolean);
  /** Seeds the layer's own random stream: the scene's name. */
  seed: string;
  /** The game's px per metre; default 100. `container` and the layer containers draw in world px. */
  pxPerMetre?: number;
  /** The container an emitter's `layer` draws in; without it, everything draws in `container`. */
  layer?: (layer: ViewLayer) => Container;
  /** The preset's texture; null (or omitted) draws small squares. */
  texture?: (preset: EmitterFile) => ParticleTexture | null;
};

/** How big an untextured particle is at scale 1, metres. */
const SQUARE_METRES = 0.05;
const DEG = Math.PI / 180;

/** A preset's texture through a runtime's project: its texture, or its atlas's frame. */
export function particleTexture(
  ctx: Pick<EngineContext, "project" | "sampling">,
  preset: Pick<EmitterFile, "texture" | "frame">,
): ParticleTexture | null {
  const project = ctx.project;
  if (!project || preset.texture === undefined) return null;
  const { info, texture } = spriteAssets((id, frame) => project.asset(id, frame), {
    asset: preset.texture,
    ...(preset.frame !== undefined ? { frame: preset.frame } : {}),
  });
  if (!texture?.sha256) return null;
  return {
    hash: texture.sha256,
    ...(info?.rect ? { frame: { ...info.rect } } : {}),
    sampling: texture.filter ?? ctx.sampling,
  };
}

type CurveKey = EmitterCurve[number];

/** The keys either side of `t` on a non-empty curve; the end key twice past either end. */
function keysAround(curve: EmitterCurve, t: number): [CurveKey, CurveKey] {
  let before = curve[0]!;
  if (t <= before[0]) return [before, before];
  for (const key of curve) {
    if (key[0] >= t) return [before, key];
    before = key;
  }
  return [before, before];
}

/** The value of a `[t, value]` curve at `t`, linear between keys; `fallback` without one. */
export function curveAt(curve: EmitterCurve | undefined, t: number, fallback: number): number {
  if (!curve || curve.length === 0) return fallback;
  const [a, b] = keysAround(curve, t);
  const span = b[0] - a[0];
  return span > 0 ? a[1] + ((b[1] - a[1]) * (t - a[0])) / span : b[1];
}

/** A tint curve at `t`, blended per channel. */
export function tintAt(curve: EmitterCurve | undefined, t: number): number {
  if (!curve || curve.length === 0) return 0xffffff;
  const [a, b] = keysAround(curve, t);
  const span = b[0] - a[0];
  return lerpRgb(a[1], b[1], span > 0 ? (t - a[0]) / span : 1);
}

type Bucket = {
  key: string;
  container: ParticleContainer;
  /** Null while the preset's texture hasn't loaded, or for squares. */
  texture: Texture | null;
  want: ParticleTexture | null;
  /** Particles drawn in it, and emitters that draw into it: it stays, in its place, while any is left. */
  users: number;
};

type Live = {
  display: Particle;
  bucket: Bucket;
  preset: EmitterFile;
  /** Metres: world, or from the emitter's origin in local space. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  /** The scale a display needs for scale 1. */
  base: number;
  tint: number | null;
};

type Group = {
  preset: EmitterFile;
  /** Null draws in the layer's own container. */
  layer: ViewLayer | null;
  local: boolean;
  cap: number;
  particles: Live[];
  /** The bucket a running emitter keeps alive between its particles; null for a burst or leftovers. */
  held: Bucket | null;
  /** An emitter's own state; null for a burst or a stopped emitter's leftovers. */
  source: {
    at: () => Pose | undefined;
    owed: number;
    elapsedMs: number;
    /** The next of `bursts` (sorted by atMs) still to fire. */
    nextBurst: number;
    bursts: { atMs: number; count: number }[];
    origin: Pose | null;
  } | null;
};

/** A particle layer drawing into `container`; under reduced motion rates and bursts are quartered. */
export function createParticleLayer(
  container: Container,
  textures: TextureSource | undefined,
  opts: ParticleLayerOptions,
): ParticleLayer {
  const ppm = opts.pxPerMetre ?? DEFAULT_LENGTH_UNIT;
  const random = viewRandom(opts.seed);
  const unit = random.unit;
  const between = ([lo, hi]: readonly [number, number]) => random.between(lo, hi);
  const reduced = opts.reducedMotion;
  const motion = () => ((typeof reduced === "function" ? reduced() : reduced) ? 0.25 : 1);
  const emitters = new Map<string, Group>();
  /** Bursts, and stopped emitters' particles living out their life. */
  let loose: Group[] = [];
  const buckets = new Map<string, Bucket>();
  let sprites: SpriteTextures | null = null;
  /** Buckets whose texture is still loading. */
  const pending = new Set<Bucket>();

  const parentOf = (layer: ViewLayer | null): Container =>
    layer !== null && opts.layer ? opts.layer(layer) : container;

  function acquire(want: ParticleTexture): Texture | null {
    if (!textures) return null;
    sprites ??= createSpriteTextures(textures);
    return sprites.acquire(want.hash, want.frame, want.sampling);
  }

  function bucketFor(preset: EmitterFile, layer: ViewLayer | null): Bucket {
    const want = opts.texture?.(preset) ?? null;
    const frame = want?.frame
      ? `${want.frame.x},${want.frame.y},${want.frame.w},${want.frame.h}`
      : "";
    const where = layer === null ? "" : layerOrder(layer);
    const key = `${where}|${want ? `${want.hash}|${frame}|${want.sampling}` : "square"}|${preset.blend ?? "normal"}`;
    const known = buckets.get(key);
    if (known) return known;
    const texture = want ? acquire(want) : null;
    const display = new ParticleContainer({
      texture: texture ?? Texture.WHITE,
      dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
    });
    display.label = `particles:${key}`;
    display.blendMode = preset.blend ?? "normal";
    parentOf(layer).addChild(display);
    const bucket: Bucket = { key, container: display, texture, want, users: 0 };
    if (want && !texture) pending.add(bucket);
    buckets.set(key, bucket);
    return bucket;
  }

  function dropBucket(bucket: Bucket): void {
    if (bucket.users > 0) return;
    pending.delete(bucket);
    buckets.delete(bucket.key);
    if (bucket.texture) sprites?.release(bucket.texture);
    bucket.container.destroy();
  }

  /** Picks up textures that loaded since their bucket was made. */
  function settleTextures(): void {
    for (const bucket of [...pending]) {
      const texture = bucket.want ? acquire(bucket.want) : null;
      if (!texture) continue;
      pending.delete(bucket);
      bucket.texture = texture;
      bucket.container.texture = texture;
      for (const p of bucket.container.particleChildren as Particle[]) p.texture = texture;
      for (const g of [...emitters.values(), ...loose])
        for (const p of g.particles) if (p.bucket === bucket) p.base = baseScale(bucket);
    }
  }

  const baseScale = (bucket: Bucket) =>
    bucket.texture ? 1 : (SQUARE_METRES * ppm) / Math.max(1, Texture.WHITE.width);

  function hold(preset: EmitterFile, layer: ViewLayer | null): Bucket {
    const bucket = bucketFor(preset, layer);
    bucket.users++;
    return bucket;
  }

  function release(bucket: Bucket | null): void {
    if (!bucket) return;
    bucket.users--;
    if (bucket.users === 0) dropBucket(bucket);
  }

  function kill(p: Live): void {
    p.bucket.container.removeParticle(p.display);
    release(p.bucket);
  }

  function spawn(
    g: Group,
    count: number,
    origin: Pose,
    over?: { angle?: number; tint?: number },
  ): void {
    const { preset } = g;
    const room = Math.min(count, g.cap - g.particles.length);
    if (room <= 0) return;
    const bucket = bucketFor(preset, g.layer);
    for (let i = 0; i < room; i++) {
      let ox = 0;
      let oy = 0;
      const shape = preset.shape;
      if (shape?.kind === "circle") {
        const r = shape.r * Math.sqrt(unit());
        const a = unit() * Math.PI * 2;
        ox = Math.cos(a) * r;
        oy = Math.sin(a) * r;
      } else if (shape?.kind === "box") {
        ox = (unit() - 0.5) * shape.w;
        oy = (unit() - 0.5) * shape.h;
      }
      const heading = (between(preset.angle) + (over?.angle ?? 0)) * DEG + origin.rot;
      const speed = between(preset.speed);
      const display = new Particle({
        texture: bucket.texture ?? Texture.WHITE,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      bucket.container.addParticle(display);
      bucket.users++;
      const p: Live = {
        display,
        bucket,
        preset,
        x: (g.local ? 0 : origin.x) + ox,
        y: (g.local ? 0 : origin.y) + oy,
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed,
        ageMs: 0,
        lifeMs: between(preset.lifeMs),
        base: baseScale(bucket),
        tint: over?.tint ?? null,
      };
      g.particles.push(p);
      draw(p, g);
    }
  }

  function draw(p: Live, g: Group): void {
    const t = Math.min(1, p.ageMs / p.lifeMs);
    const origin = g.local ? g.source?.origin : null;
    const scale = curveAt(p.preset.scale, t, 1) * p.base;
    const d = p.display;
    d.x = ((origin?.x ?? 0) + p.x) * ppm;
    d.y = ((origin?.y ?? 0) + p.y) * ppm;
    d.scaleX = scale;
    d.scaleY = scale;
    d.alpha = curveAt(p.preset.alpha, t, 1);
    d.tint = p.tint ?? tintAt(p.preset.tint, t);
  }

  /** Moves `g`'s particles on by `dt` seconds, dropping the ones whose life ran out. */
  function age(g: Group, dtMs: number): void {
    const dt = dtMs / 1000;
    const [ax, ay] = g.preset.drift ?? [0, 0];
    const slow = g.preset.damping ? Math.exp(-g.preset.damping * dt) : 1;
    const kept: Live[] = [];
    for (const p of g.particles) {
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        kill(p);
        continue;
      }
      p.vx = (p.vx + ax * dt) * slow;
      p.vy = (p.vy + ay * dt) * slow;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      kept.push(p);
    }
    g.particles = kept;
  }

  const quartered = (count: number) => {
    const m = motion();
    return m === 1 ? count : Math.max(1, Math.round(count * m));
  };

  function emit(g: Group, dtMs: number): void {
    const s = g.source!;
    const pose = s.at();
    if (pose) s.origin = pose;
    if (!pose) return;
    const { preset } = g;
    const from = s.elapsedMs;
    s.elapsedMs += dtMs;
    const until = preset.durationMs === undefined ? Infinity : preset.durationMs;
    while (
      s.nextBurst < s.bursts.length &&
      s.bursts[s.nextBurst]!.atMs <= Math.min(s.elapsedMs, until)
    ) {
      spawn(g, quartered(s.bursts[s.nextBurst]!.count), pose);
      s.nextBurst++;
    }
    const emitting = Math.max(0, Math.min(s.elapsedMs, until) - from);
    s.owed += (preset.rate * motion() * emitting) / 1000;
    const n = Math.floor(s.owed);
    s.owed -= n;
    if (n > 0) spawn(g, n, pose);
  }

  function stop(g: Group): void {
    if (g.local) {
      for (const p of g.particles) kill(p);
      return;
    }
    if (g.particles.length > 0) loose.push({ ...g, held: null, source: null });
  }

  const capOf = (preset: EmitterFile) =>
    Math.min(EMITTER_MAX_CAP, Math.max(1, Math.floor(preset.max ?? EMITTER_MAX_DEFAULT)));

  return {
    emitter(id, preset, at, layer) {
      const before = emitters.get(id);
      const local = preset.space === "local";
      const keep = before && before.local === local ? before.particles : null;
      if (before && !keep) stop(before);
      const bursts = [...(preset.bursts ?? [])].sort((a, b) => a.atMs - b.atMs);
      emitters.set(id, {
        preset,
        layer: layer ?? null,
        local,
        cap: capOf(preset),
        particles: keep ?? [],
        held: hold(preset, layer ?? null),
        source: { at, owed: 0, elapsedMs: 0, nextBurst: 0, bursts, origin: at() ?? null },
      });
      // After the new hold, so a restart on the same bucket keeps it in place.
      release(before?.held ?? null);
    },
    remove(id) {
      const g = emitters.get(id);
      if (!g) return;
      emitters.delete(id);
      stop(g);
      release(g.held);
    },
    burst(preset, at, o = {}) {
      const total = (preset.bursts ?? []).reduce((n, b) => n + b.count, 0);
      const count = o.count ?? (total > 0 ? total : Math.max(1, Math.round(preset.rate)));
      if (count <= 0) return;
      const g: Group = {
        preset,
        layer: null,
        local: false,
        cap: capOf(preset),
        particles: [],
        held: null,
        source: null,
      };
      spawn(
        g,
        quartered(count),
        { x: at.x, y: at.y, rot: 0 },
        {
          ...(o.angle !== undefined ? { angle: o.angle } : {}),
          ...(o.tint !== undefined ? { tint: o.tint } : {}),
        },
      );
      if (g.particles.length > 0) loose.push(g);
    },
    update(dtMs) {
      if (!(dtMs > 0)) return;
      if (pending.size > 0) settleTextures();
      for (const g of emitters.values()) {
        age(g, dtMs);
        emit(g, dtMs);
        for (const p of g.particles) draw(p, g);
      }
      for (const g of loose) {
        age(g, dtMs);
        for (const p of g.particles) draw(p, g);
      }
      loose = loose.filter((g) => g.particles.length > 0);
    },
    stats() {
      let particles = 0;
      for (const g of emitters.values()) particles += g.particles.length;
      for (const g of loose) particles += g.particles.length;
      return { emitters: emitters.size, particles };
    },
    clear() {
      for (const g of [...emitters.values(), ...loose]) for (const p of g.particles) kill(p);
      emitters.clear();
      loose = [];
      for (const bucket of [...buckets.values()]) {
        bucket.users = 0;
        dropBucket(bucket);
      }
      sprites?.destroy();
      sprites = null;
    },
  };
}
