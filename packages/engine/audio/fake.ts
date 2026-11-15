import { loopSpan } from "../project/kinds/audio";
import type { AudioBackend, AudioClipHandle, FakeAudioCall, Voice, VoiceOptions } from "./types";

/** One logged call, with the context time it was made at. */
export type FakeAudioLogEntry = FakeAudioCall & { at: number };

/** The fake's clips carry their number, which the log names. */
type FakeClip = AudioClipHandle & { readonly id: number };

/** A fake backend, and the controls a test drives it with. */
export type FakeAudioBackend = AudioBackend & {
  readonly log: readonly FakeAudioLogEntry[];
  /** Moves the context clock on; voices that reach their clip's end end. */
  advance(seconds: number): void;
  /** Every bus volume as last set. */
  readonly busVolumes: ReadonlyMap<string, number>;
};

export type FakeAudioOptions = {
  /** "running" starts unlocked, as a context resumed by an earlier gesture is. */
  state?: "locked" | "running";
  /** A decoded clip's length, seconds; default 1. */
  decodedSeconds?: number;
};

/**
 * A backend that plays nothing and logs every call, for tests and headless
 * checks. A buffer is logged by its channel count, length and rate, never
 * its samples, so two runs compare equal across JS engines.
 */
export function fakeAudioBackend(opts: FakeAudioOptions = {}): FakeAudioBackend {
  const log: FakeAudioLogEntry[] = [];
  const busVolumes = new Map<string, number>();
  let now = 0;
  let state: AudioBackend["state"] = opts.state ?? "locked";
  let clips = 0;
  let voices = 0;

  const record = (call: FakeAudioCall) => void log.push({ ...call, at: now });
  const clip = (duration: number, channels: number, streamed: boolean): FakeClip =>
    Object.freeze({ id: ++clips, duration, channels, streamed });
  const idOf = (handle: AudioClipHandle): number => (handle as FakeClip).id ?? 0;

  function play(handle: AudioClipHandle, voiceOpts: VoiceOptions): Voice {
    const voice = ++voices;
    record({ op: "play", clip: idOf(handle), voice, opts: { ...voiceOpts } });
    let startedAt = voiceOpts.when ?? now;
    let offset = voiceOpts.offset ?? 0;
    let stopped = false;
    const rate = voiceOpts.rate > 0 ? voiceOpts.rate : 1;
    const played = () => offset + Math.max(0, now - startedAt) * rate;
    /** Wrapped into the loop as a real backend plays it, the stream's length unknown till then. */
    const position = () => {
      const at = played();
      if (!voiceOpts.loop) return at;
      const length = Number.isFinite(handle.duration) ? handle.duration : Number.POSITIVE_INFINITY;
      const { from, to } = loopSpan(voiceOpts, length);
      const span = to - from;
      if (at < to || !(span > 0) || !Number.isFinite(span)) return at;
      return from + ((at - from) % span);
    };
    return {
      key: voiceOpts.key ?? null,
      get ended() {
        if (stopped) return true;
        if (voiceOpts.loop || !Number.isFinite(handle.duration)) return false;
        return played() >= handle.duration;
      },
      stop(fadeMs) {
        if (stopped) return;
        stopped = true;
        record(fadeMs === undefined ? { op: "stop", voice } : { op: "stop", voice, fadeMs });
      },
      setPan(pan) {
        record({ op: "pan", voice, pan });
      },
      setVolume(volume, rampMs) {
        record(
          rampMs === undefined
            ? { op: "volume", voice, volume }
            : { op: "volume", voice, volume, rampMs },
        );
      },
      position,
      seek(seconds) {
        record({ op: "seek", voice, seconds });
        offset = seconds;
        startedAt = now;
      },
    };
  }

  return {
    log,
    busVolumes,
    get now() {
      return now;
    },
    get state() {
      return state;
    },
    latency: 0,
    advance(seconds) {
      now += seconds;
    },
    unlock() {
      record({ op: "unlock" });
      if (state !== "closed") state = "running";
      return Promise.resolve();
    },
    decode(bytes) {
      const handle = clip(opts.decodedSeconds ?? 1, 1, false);
      record({ op: "decode", clip: handle.id, bytes: bytes.byteLength });
      return Promise.resolve(handle);
    },
    buffer(channels, sampleRate) {
      const length = channels[0]?.length ?? 0;
      const handle = clip(sampleRate > 0 ? length / sampleRate : 0, channels.length, false);
      record({ op: "buffer", clip: handle.id, channels: channels.length, length, sampleRate });
      return handle;
    },
    stream(url) {
      const handle = clip(Number.NaN, 2, true);
      record({ op: "stream", clip: handle.id, url });
      return handle;
    },
    play,
    setBusVolume(bus, volume, rampMs) {
      busVolumes.set(bus, volume);
      record(
        rampMs === undefined ? { op: "bus", bus, volume } : { op: "bus", bus, volume, rampMs },
      );
    },
    close() {
      record({ op: "close" });
      state = "closed";
    },
  };
}
