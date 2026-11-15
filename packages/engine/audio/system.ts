import type { Registry } from "../game/types";
import { clamp } from "../math";
import { PREF_KEYS, setPref, type PrefsStore } from "../prefs";
import type { AssetInfo } from "../project/asset-info";
import { sameValue } from "../project/canonical";
import { AUDIO_KIND } from "../project/kinds/audio";
import { isPlainObject } from "../project/kinds/define";
import {
  audioBuses,
  SOUND_KIND,
  SOUND_MAX_VOICES_DEFAULT,
  type SoundFile,
} from "../project/kinds/sound";
import { SYNTH_KIND, type SynthFile } from "../project/kinds/synth";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import type { PoseIndex } from "../runtime/poses";
import type { AudioRequest } from "../runtime/present";
import type { StepEvent } from "../runtime/types";
import type { RuntimeEntity } from "../scene/types";
import { Rng, unitFloat } from "../sim-kit/rng";
import type { GameEventMap, Vec2 } from "../types";
import {
  CALIBRATION_BEATS_DEFAULT,
  CALIBRATION_BPM_DEFAULT,
  clickTimes,
  latencyFromTaps,
  MUSIC_DRIFT_LIMIT_MS,
  musicClock,
  musicDriftMs,
  wrapClipMs,
  type CalibrateLatencyOptions,
  type ClipSpan,
  type LatencyCalibration,
  type MusicAnchor,
} from "./clock";
import { renderSynth, SYNTH_SAMPLE_RATE } from "./synth";
import { CLICK_PATCH } from "./synth-presets";
import { soundTriggers, triggerEntityOf, triggerSource, type SoundTriggers } from "./triggers";
import type { AudioBackend, AudioClipHandle, AudioSystem, BusLevel, BusName, Voice } from "./types";

export { soundLeafMs } from "./sound-length";

/** The host events the audio system raises. */
export type AudioHostEvent = "audio:unlocked" | "audio:caption";

export type AudioSystemOptions = {
  backend: AudioBackend;
  project: ProjectRuntimeView;
  /** The game's registry: its declared buses join the engine's. */
  registry: Registry;
  /** Fetches a clip's bytes by asset id, through the host's loader. */
  fetchClip: (id: AssetId) => Promise<ArrayBuffer>;
  clipUrl: (id: AssetId) => string;
  /** World poses, so a source on a child entity follows its parent. */
  poses: Pick<PoseIndex, "get">;
  prefs: PrefsStore;
  /** The game id prefs are saved under, and the variant picks' seed. */
  gameId: string;
  /** The simulation's tick length, ms (`ctx.time.tickMs`). */
  tickMs: number;
  /** Reserved for a reduced-motion audio behaviour; nothing in the audio system reads it yet. */
  reducedMotion: () => boolean;
  /** Raises a host event on the game instance. */
  emit: <K extends AudioHostEvent>(event: K, payload: GameEventMap[K]) => void;
  /**
   * The entity a tick's event names, for `on` matchers that name a type or
   * tag: live, or as it was when that tick removed it. Without it those
   * matchers never match.
   */
  entity?: (id: string) => RuntimeEntity | undefined;
  /** The latency the last `@latency` command carried, ms, which the clock reports; 0 without it. */
  latencyMs?: () => number;
};

/** How a calibration hears taps and waits on the wall clock. */
export type CalibrationRun = CalibrateLatencyOptions & {
  /** Calls `tap` on each tap until the returned unsubscribe. */
  onTap: (tap: () => void) => () => void;
  /** Resolves after about `ms` of wall time. */
  wait: (ms: number) => Promise<void>;
};

/** What the shell drives beyond `AudioSystem`. */
export type AudioSystemHandle = AudioSystem & {
  /** Unlocks the backend (the first gesture); music asked for before it starts now. */
  unlock(): Promise<void>;
  /** Takes a new project view: rebuilds the triggers and drops renders and clips that changed. */
  reload(project: ProjectRuntimeView): void;
  /**
   * Plays a click track (`sound`'s first variant, else `CLICK_PATCH`,
   * rendered once) and times the taps `onTap` reports against it. Null when
   * locked, with no click, or with too few taps.
   */
  calibrate(run: CalibrationRun): Promise<LatencyCalibration | null>;
};

/** How long `music` crossfades when the request names no `fadeMs`. */
export const MUSIC_FADE_MS_DEFAULT = 800;

/** A positional voice's source: an entity it follows, or a fixed point. */
type Source = { entity?: string; at?: Vec2 };

type PlayRequest = {
  source?: Source;
  volume?: number;
  pitch?: number;
  key?: string;
  caption?: string;
};

type Variant = SoundFile["variants"][number];

/**
 * A variant by weight among those `present` keeps (all without it); `roll`
 * is drawn only when there are two or more to choose from.
 */
export function pickSoundVariant<V extends Pick<Variant, "clip" | "weight">>(
  variants: readonly V[],
  roll: () => number,
  present?: (clip: AssetId) => boolean,
): V | undefined {
  const candidates = present ? variants.filter((v) => present(v.clip)) : variants;
  if (candidates.length <= 1) return candidates[0];
  let total = 0;
  for (const v of candidates) total += v.weight ?? 1;
  let left = roll() * total;
  for (const v of candidates) {
    left -= v.weight ?? 1;
    if (left < 0) return v;
  }
  return candidates[candidates.length - 1];
}

/** A play's rate within the sound's pitch range; `roll` is drawn only for a range. */
export function soundRate(file: Pick<SoundFile, "pitch">, roll: () => number): number {
  const [min, max] = file.pitch ?? [1, 1];
  return min === max ? min : min + (max - min) * roll();
}

/** Where a voice plays from: set for a positional sound's voice. */
type Placed = {
  source: Source | null;
  range: number | undefined;
  /** The last position the source had, kept when its entity goes. */
  last: Vec2 | undefined;
};

type Playing = Placed & {
  voice: Voice;
  sound: AssetId;
  /** Volume before distance falloff. */
  volume: number;
  pan: number;
  gain: number;
};

type Clip = {
  sha: string | undefined;
  ready: AudioClipHandle | null;
  loading: Promise<void> | null;
};

/**
 * `anchor` is set for music started `at: "tick"`, which the clock follows.
 * `span` is filled once its clip plays; a stream's length arrives later
 * and is read from `clip` until then.
 */
type Music = {
  sound: AssetId;
  voice: Voice | null;
  anchor: MusicAnchor | null;
  clip: AudioClipHandle | null;
  span: ClipSpan | null;
};

/** How often a calibration looks at the context clock for the track's end, wall ms. */
const CALIBRATION_POLL_MS = 50;

/**
 * The shell's audio system over `opts.backend`: a presentation listener
 * that plays what each tick's step events trigger and what `present.audio`
 * asks, and never writes the simulation. A voice that starts with a
 * caption (the request's, else the sound's) raises `audio:caption`. The
 * backend stays the caller's to close.
 */
export function createAudioSystem(opts: AudioSystemOptions): AudioSystemHandle {
  const { backend, registry, prefs, gameId } = opts;
  let project = opts.project;
  let triggers: SoundTriggers = buildTriggers();
  const rng = Rng.from(gameId);
  const roll = () => unitFloat(rng);

  const patches = new Map<AssetId, { doc: SynthFile; clip: AudioClipHandle }>();
  const clips = new Map<AssetId, Clip>();
  const lastPlayMs = new Map<AssetId, number>();
  let voices: Playing[] = [];
  let music: Music | null = null;
  /** Music asked for before unlock: undefined for none, null for silence. */
  let pendingMusic: { sound: AssetId; fadeMs: number; tick: number | null } | null | undefined;
  /** Per key, the latest looping play asked for before unlock; a one-shot then is dropped. */
  const pendingLoops = new Map<string, { sound: AssetId; request: PlayRequest }>();
  /** The last tick the system was handed and the context time it came at. */
  let lastTick: { tick: number; at: number } | null = null;
  let driftMs = 0;
  /** The sim time the last frame resynced at: a frame with the simulation held doesn't resync. */
  let lastSimMs: number | null = null;
  let click: AudioClipHandle | null = null;
  let view: { centre: Vec2; halfWidth: number } | null = null;
  let unlocked = false;
  let destroyed = false;
  /** Bumped by `stopAll`, so a play waiting on a decode from before it never starts. */
  let epoch = 0;
  /** Per key, the plays waiting on a decode and the stops since the first: a stopped key's waiting plays never start. */
  const waitingKeys = new Map<string, { plays: number; stops: number }>();

  const buses = new Map<BusName, BusLevel>();
  const saved = prefs.load(gameId);
  for (const bus of audioBuses(registry)) {
    const declared = registry.game?.audio?.buses?.find((b) => b.name === bus);
    const level: BusLevel = { volume: declared?.volume ?? 1, muted: false };
    const pref = saved[PREF_KEYS.busKey(bus)];
    if (isPlainObject(pref)) {
      if (typeof pref.volume === "number") level.volume = clamp(pref.volume, 0, 1);
      if (typeof pref.muted === "boolean") level.muted = pref.muted;
    }
    buses.set(bus, level);
    backend.setBusVolume(bus, level.muted ? 0 : level.volume);
  }

  function buildTriggers(): SoundTriggers {
    return soundTriggers(
      project,
      triggerEntityOf(registry, (id) => opts.entity?.(id)),
    );
  }

  const soundFile = (id: AssetId) => project.doc?.<SoundFile>(SOUND_KIND, id);
  const nowMs = () => backend.now * 1000;

  /** A patch's rendered clip, rendered again only when its doc changed. */
  function patchClip(id: AssetId, doc: SynthFile): AudioClipHandle {
    const hit = patches.get(id);
    if (hit && (hit.doc === doc || sameValue(hit.doc, doc))) return hit.clip;
    const clip = backend.buffer([renderSynth(doc)], SYNTH_SAMPLE_RATE);
    patches.set(id, { doc, clip });
    return clip;
  }

  /** An audio clip's handle, or its decode started; a stream is ready at once. */
  function audioClip(id: AssetId, info: AssetInfo): Clip {
    const hit = clips.get(id);
    if (hit && hit.sha === info.sha256) return hit;
    const entry: Clip = { sha: info.sha256, ready: null, loading: null };
    clips.set(id, entry);
    if (info.stream) {
      entry.ready = backend.stream(opts.clipUrl(id));
      return entry;
    }
    entry.loading = opts
      .fetchClip(id)
      .then((bytes) => backend.decode(bytes))
      .then(
        (clip) => {
          if (clips.get(id) === entry) entry.ready = clip;
        },
        () => {},
      )
      .finally(() => {
        entry.loading = null;
      });
    return entry;
  }

  /**
   * Runs `start` with the variant's clip now, or once it decodes; nothing
   * for a clip that can't load. A play keyed `key` that waits on the decode
   * doesn't start once a stop of `key` came meanwhile.
   */
  function withClip(
    id: AssetId,
    key: string | undefined,
    start: (clip: AudioClipHandle, info: AssetInfo | undefined) => void,
  ): void {
    const patch = project.doc?.<SynthFile>(SYNTH_KIND, id);
    if (patch) return start(patchClip(id, patch), undefined);
    const info = project.asset(id);
    if (info?.kind !== AUDIO_KIND) return;
    const clip = audioClip(id, info);
    if (clip.ready) return start(clip.ready, info);
    const loading = clip.loading;
    if (!loading) return;
    const at = epoch;
    let waiting: { plays: number; stops: number } | undefined;
    if (key !== undefined) {
      waiting = waitingKeys.get(key) ?? { plays: 0, stops: 0 };
      waiting.plays++;
      waitingKeys.set(key, waiting);
    }
    const stopsAt = waiting?.stops ?? 0;
    void loading.then(() => {
      if (waiting && key !== undefined && --waiting.plays === 0) waitingKeys.delete(key);
      if (destroyed || at !== epoch || !clip.ready) return;
      if (waiting && waiting.stops !== stopsAt) return;
      start(clip.ready, info);
    });
  }

  /** Whether a variant's clip or patch is in the project, so a dangling one is never picked. */
  const present = (id: AssetId) =>
    project.doc?.<SynthFile>(SYNTH_KIND, id) !== undefined ||
    project.asset(id)?.kind === AUDIO_KIND;

  const pickVariant = (file: SoundFile) => pickSoundVariant(file.variants, roll, present)?.clip;

  function positionOf(p: Placed): Vec2 | undefined {
    const source = p.source;
    if (!source) return undefined;
    const pose = source.entity === undefined ? undefined : opts.poses.get(source.entity);
    if (pose) p.last = { x: pose.x, y: pose.y };
    else if (!p.last && source.at) p.last = source.at;
    return p.last;
  }

  /** Pan across the main view, and the linear falloff over `range` from its centre. */
  function place(p: Placed): { pan: number; gain: number } {
    const at = positionOf(p);
    if (!at || !view) return { pan: 0, gain: 1 };
    const dx = at.x - view.centre.x;
    const dy = at.y - view.centre.y;
    const pan = view.halfWidth > 0 ? clamp(dx / view.halfWidth, -1, 1) : 0;
    const gain =
      p.range === undefined ? 1 : Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / p.range);
    return { pan, gain };
  }

  function prune(): void {
    if (voices.some((p) => p.voice.ended)) voices = voices.filter((p) => !p.voice.ended);
  }

  function play(sound: AssetId, request: PlayRequest) {
    const file = soundFile(sound);
    if (!file) return;
    if (!unlocked) {
      if (file.loop && request.key !== undefined) pendingLoops.set(request.key, { sound, request });
      return;
    }
    if (file.cooldownMs !== undefined && file.cooldownMs > 0) {
      const last = lastPlayMs.get(sound);
      if (last !== undefined && nowMs() - last < file.cooldownMs) return;
    }
    const clipId = pickVariant(file);
    if (clipId === undefined) return;
    lastPlayMs.set(sound, nowMs());
    const rate = request.pitch ?? soundRate(file, roll);
    const volume = (file.volume ?? 1) * (request.volume ?? 1);
    const source = file.positional && request.source ? request.source : null;
    const caption = request.caption ?? file.caption;
    const key = request.key;
    withClip(clipId, key, (clip, info) => {
      prune();
      const own = voices.filter((p) => p.sound === sound);
      const excess = own.length - (file.maxVoices ?? SOUND_MAX_VOICES_DEFAULT) + 1;
      if (excess > 0) {
        const oldest = new Set(own.slice(0, excess));
        for (const p of oldest) p.voice.stop();
        voices = voices.filter((p) => !oldest.has(p));
      }
      const where: Placed = { source, range: file.range, last: undefined };
      const { pan, gain } = place(where);
      const voice = backend.play(clip, {
        bus: file.bus,
        volume: volume * gain,
        rate,
        pan,
        loop: file.loop ?? false,
        ...loopPoints(info),
        ...(key !== undefined ? { key } : {}),
      });
      voices.push({ ...where, voice, sound, volume, pan, gain });
      if (caption !== undefined) opts.emit("audio:caption", { key: caption, at: backend.now });
    });
  }

  const loopPoints = (info: AssetInfo | undefined) => ({
    ...(info?.loopStart !== undefined ? { loopStart: info.loopStart } : {}),
    ...(info?.loopEnd !== undefined ? { loopEnd: info.loopEnd } : {}),
  });

  /** The context time `tick` began at, from the last tick handed over; now for a later tick or none. */
  function contextTimeOf(tick: number): number {
    const now = backend.now;
    if (!lastTick || tick >= lastTick.tick) return now;
    return lastTick.at - ((lastTick.tick - tick) * opts.tickMs) / 1000;
  }

  /** `tick`: the request's tick for music `at: "tick"`, whose zero the clock lines up with it; null plays free. */
  function startMusic(sound: AssetId | null, fadeMs: number, tick: number | null): void {
    if (sound !== null && music?.sound === sound) return;
    const fading = music;
    fading?.voice?.stop(fadeMs);
    music = null;
    driftMs = 0;
    const file = sound === null ? undefined : soundFile(sound);
    const clipId = file ? pickVariant(file) : undefined;
    if (sound === null || !file || clipId === undefined) return;
    const rate = soundRate(file, roll);
    const anchor: MusicAnchor | null =
      tick === null ? null : { startTick: tick, startTime: contextTimeOf(tick), offsetMs: 0, rate };
    const own: Music = { sound, voice: null, anchor, clip: null, span: null };
    music = own;
    const fadeInMs = fading ? fadeMs : 0;
    const loop = file.loop ?? false;
    withClip(clipId, undefined, (clip, info) => {
      if (music !== own) return;
      const points = loopPoints(info);
      own.clip = clip;
      own.span = {
        durationMs: clip.duration * 1000,
        loop,
        ...(points.loopStart !== undefined ? { loopStartMs: points.loopStart * 1000 } : {}),
        ...(points.loopEnd !== undefined ? { loopEndMs: points.loopEnd * 1000 } : {}),
      };
      const now = backend.now;
      // A clip that decoded (or unlocked) late joins the song where the ticks have it.
      const late = anchor ? Math.max(0, now - anchor.startTime) * rate * 1000 : 0;
      own.voice = backend.play(clip, {
        bus: file.bus,
        volume: file.volume ?? 1,
        rate,
        pan: 0,
        loop,
        ...points,
        ...(anchor ? { when: Math.max(now, anchor.startTime) } : {}),
        ...(late > 0 ? { offset: wrapClipMs(late, own.span) / 1000 } : {}),
        ...(fadeInMs > 0 ? { fadeInMs } : {}),
      });
      if (file.caption !== undefined) {
        opts.emit("audio:caption", {
          key: file.caption,
          at: anchor ? Math.max(now, anchor.startTime) : now,
        });
      }
    });
  }

  /** Seeks tick-aligned music back to where the simulation has it once it drifts past the limit. */
  function resyncMusic(simMs: number): void {
    const own = music;
    const anchor = own?.anchor;
    const span = own?.span;
    if (!own || !anchor || !own.voice || !span || own.voice.ended) return;
    const held = lastSimMs === simMs;
    lastSimMs = simMs;
    if (held) return;
    if (!Number.isFinite(span.durationMs) && own.clip) span.durationMs = own.clip.duration * 1000;
    const expected = (simMs - anchor.startTick * opts.tickMs) * anchor.rate + anchor.offsetMs;
    if (expected < 0 || (!span.loop && expected >= span.durationMs)) return;
    driftMs = musicDriftMs(own.voice.position() * 1000, expected, span);
    if (Math.abs(driftMs) <= MUSIC_DRIFT_LIMIT_MS) return;
    own.voice.seek(wrapClipMs(expected, span) / 1000);
    driftMs = 0;
  }

  /** A variant's clip once it is ready; null for one that can't load. */
  async function loadClip(id: AssetId): Promise<AudioClipHandle | null> {
    const patch = project.doc?.<SynthFile>(SYNTH_KIND, id);
    if (patch) return patchClip(id, patch);
    const info = project.asset(id);
    if (info?.kind !== AUDIO_KIND) return null;
    const clip = audioClip(id, info);
    await clip.loading;
    return clip.ready;
  }

  async function calibrate(run: CalibrationRun): Promise<LatencyCalibration | null> {
    if (!unlocked || destroyed) return null;
    const beats = Math.max(1, Math.floor(run.beats ?? CALIBRATION_BEATS_DEFAULT));
    const bpm = run.bpm !== undefined && run.bpm > 0 ? run.bpm : CALIBRATION_BPM_DEFAULT;
    const file = run.sound === undefined ? undefined : soundFile(run.sound);
    let clip: AudioClipHandle | null;
    if (run.sound === undefined) {
      click ??= backend.buffer([renderSynth(CLICK_PATCH)], SYNTH_SAMPLE_RATE);
      clip = click;
    } else {
      const first = file?.variants[0]?.clip;
      clip = first === undefined ? null : await loadClip(first);
    }
    if (!clip || destroyed) return null;
    const at = epoch;
    const clicks = clickTimes(backend.now, beats, bpm);
    for (const when of clicks) {
      const voice = backend.play(clip, {
        bus: file?.bus ?? "ui",
        volume: file?.volume ?? 1,
        rate: 1,
        pan: 0,
        loop: false,
        when,
      });
      // Held with the other voices, so stopAll and destroy silence the track.
      voices.push({
        source: null,
        range: undefined,
        last: undefined,
        voice,
        sound: run.sound ?? "",
        volume: 1,
        pan: 0,
        gain: 1,
      });
    }
    const taps: number[] = [];
    const off = run.onTap(() => taps.push(backend.now));
    const beat = 60 / bpm;
    const end = (clicks[clicks.length - 1] ?? backend.now) + beat / 2;
    // A context that stops running ends the run after about twice the track's own length.
    const polls = Math.ceil(((end - backend.now) * 2000) / CALIBRATION_POLL_MS) + 1;
    try {
      for (let i = 0; i < polls && backend.now < end; i++) {
        if (destroyed || at !== epoch || backend.state === "closed") return null;
        await run.wait(Math.min(CALIBRATION_POLL_MS, Math.max(1, (end - backend.now) * 1000)));
      }
    } finally {
      off();
    }
    if (destroyed || at !== epoch) return null;
    return latencyFromTaps(clicks, taps, bpm);
  }

  function request(r: AudioRequest): void {
    switch (r.op) {
      case "play": {
        const source =
          r.entity !== undefined || r.at !== undefined
            ? {
                ...(r.entity !== undefined ? { entity: r.entity } : {}),
                ...(r.at !== undefined ? { at: { x: r.at.x, y: r.at.y } } : {}),
              }
            : undefined;
        play(r.sound, {
          ...(source ? { source } : {}),
          ...(r.volume !== undefined ? { volume: r.volume } : {}),
          ...(r.pitch !== undefined ? { pitch: r.pitch } : {}),
          ...(r.key !== undefined ? { key: r.key } : {}),
          ...(r.caption !== undefined ? { caption: r.caption } : {}),
        });
        return;
      }
      case "stop": {
        pendingLoops.delete(r.key);
        const waiting = waitingKeys.get(r.key);
        if (waiting) waiting.stops++;
        for (const p of voices) if (p.voice.key === r.key) p.voice.stop(r.fadeMs);
        prune();
        return;
      }
      case "music": {
        const fadeMs = r.fadeMs ?? MUSIC_FADE_MS_DEFAULT;
        const tick = r.at === "tick" ? r.tick : null;
        if (!unlocked) {
          pendingMusic = r.sound === null ? null : { sound: r.sound, fadeMs, tick };
          return;
        }
        startMusic(r.sound, fadeMs, tick);
        return;
      }
    }
  }

  function markUnlocked(): void {
    if (unlocked || destroyed) return;
    unlocked = true;
    opts.emit("audio:unlocked", undefined);
    const waiting = pendingMusic;
    pendingMusic = undefined;
    if (waiting) startMusic(waiting.sound, waiting.fadeMs, waiting.tick);
    const loops = [...pendingLoops.values()];
    pendingLoops.clear();
    for (const { sound, request } of loops) play(sound, request);
  }

  const checkUnlocked = () => {
    if (!unlocked && backend.state === "running") markUnlocked();
  };

  /** Renders the patches and starts decoding the clips of every `preload` sound. */
  function preload(): void {
    for (const id of project.docs?.(SOUND_KIND) ?? []) {
      const file = soundFile(id);
      if (!file?.preload) continue;
      for (const { clip } of file.variants) withClip(clip, undefined, () => {});
    }
  }

  function saveBus(bus: BusName, level: BusLevel): void {
    setPref(prefs, gameId, PREF_KEYS.busKey(bus), { ...level });
  }

  function stopAll(fadeMs?: number): void {
    epoch++;
    for (const p of voices) p.voice.stop(fadeMs);
    voices = [];
    music?.voice?.stop(fadeMs);
    music = null;
    pendingMusic = undefined;
    pendingLoops.clear();
    driftMs = 0;
  }

  const clock = musicClock({
    tickMs: opts.tickMs,
    anchor: () => music?.anchor ?? null,
    driftMs: () => driftMs,
    latencyMs: () => opts.latencyMs?.() ?? 0,
  });

  preload();
  checkUnlocked();

  return {
    tick(tick: number, events: readonly StepEvent[], requests: readonly AudioRequest[]) {
      if (destroyed) return;
      lastTick = { tick, at: backend.now };
      checkUnlocked();
      prune();
      for (const event of events) {
        for (const sound of triggers.match(event)) play(sound, { source: triggerSource(event) });
      }
      for (const r of requests) request(r);
    },
    frame(next, simMs) {
      if (destroyed) return;
      checkUnlocked();
      view = { centre: { x: next.centre.x, y: next.centre.y }, halfWidth: next.halfWidth };
      prune();
      for (const p of voices) {
        if (!p.source) continue;
        const { pan, gain } = place(p);
        if (pan !== p.pan) {
          p.pan = pan;
          p.voice.setPan(pan);
        }
        if (gain !== p.gain) {
          p.gain = gain;
          p.voice.setVolume(p.volume * gain);
        }
      }
      resyncMusic(simMs);
    },
    get unlocked() {
      return unlocked;
    },
    buses() {
      const out = {} as Record<BusName, BusLevel>;
      for (const [bus, level] of buses) out[bus] = { ...level };
      return out;
    },
    setBus(bus, volume, muted) {
      const level = buses.get(bus);
      if (!level || destroyed) return;
      level.volume = clamp(Number.isFinite(volume) ? volume : level.volume, 0, 1);
      if (muted !== undefined) level.muted = muted;
      backend.setBusVolume(bus, level.muted ? 0 : level.volume);
      saveBus(bus, level);
    },
    clock,
    stopAll(fadeMs) {
      if (!destroyed) stopAll(fadeMs);
    },
    destroy() {
      if (destroyed) return;
      stopAll();
      destroyed = true;
    },
    async unlock() {
      if (unlocked || destroyed) return;
      await backend.unlock();
      if (backend.state === "running") markUnlocked();
    },
    reload(next) {
      if (destroyed || next === project) return;
      project = next;
      triggers = buildTriggers();
      for (const [id, hit] of patches) {
        const doc = project.doc?.<SynthFile>(SYNTH_KIND, id);
        if (!doc || !sameValue(doc, hit.doc)) patches.delete(id);
      }
      for (const [id, clip] of clips) {
        if (project.asset(id)?.sha256 !== clip.sha) clips.delete(id);
      }
      preload();
    },
    calibrate,
  };
}
