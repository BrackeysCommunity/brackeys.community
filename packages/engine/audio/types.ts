import type { AudioRequest } from "../runtime/present";
/**
 * The audio system's contract. No Web Audio type is named here, so headless
 * code and the fake backend typecheck against it; `audio/web-audio.ts` is
 * the one file that reaches the browser's audio API.
 */
import type { StepEvent } from "../runtime/types";
import type { Vec2 } from "../types";
import type { AudioClock } from "./clock";

/** The engine's five buses, or one a game declares (`GameDefinition.audio.buses`). */
export type BusName = "master" | "music" | "sfx" | "voice" | "ui" | (string & {});

/** A decoded, rendered or streamed clip a backend can play; opaque beyond its shape. */
export interface AudioClipHandle {
  /** Seconds; NaN for a stream whose length isn't known yet. */
  readonly duration: number;
  readonly channels: number;
  /** Played through a media element rather than a decoded buffer. */
  readonly streamed: boolean;
}

/** Where voices play: a Web Audio context in a browser, a logging fake in tests. */
export interface AudioBackend {
  /** Seconds, the context's clock. */
  readonly now: number;
  readonly state: "locked" | "running" | "suspended" | "closed";
  /** Output latency in seconds (outputLatency + baseLatency where known, else 0). */
  readonly latency: number;
  unlock(): Promise<void>;
  decode(bytes: ArrayBuffer): Promise<AudioClipHandle>;
  /** One array per channel, samples in −1 to 1 at `sampleRate`; a rendered synth patch is one channel. */
  buffer(channels: readonly Float32Array[], sampleRate: number): AudioClipHandle;
  stream(url: string): AudioClipHandle;
  play(clip: AudioClipHandle, opts: VoiceOptions): Voice;
  setBusVolume(bus: BusName, volume: number, rampMs?: number): void;
  close(): void;
}

export type VoiceOptions = {
  bus: BusName;
  volume: number;
  /** Playback rate; 1 = original pitch. */
  rate: number;
  /** -1 (left) to 1 (right); balances a stereo clip. */
  pan: number;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  /** Context time to start at; default now. */
  when?: number;
  /** Seconds into the clip. */
  offset?: number;
  fadeInMs?: number;
  /** The request's key, which a `stop` names. */
  key?: string;
};

/** One playing clip, panned on its own ahead of its bus. */
export interface Voice {
  readonly key: string | null;
  stop(fadeMs?: number): void;
  setPan(pan: number): void;
  setVolume(volume: number, rampMs?: number): void;
  /** Seconds into the clip now. */
  position(): number;
  seek(seconds: number): void;
  readonly ended: boolean;
}

/** What `fakeAudioBackend` logs, in call order; a buffer's samples are never logged. */
export type FakeAudioCall =
  | { op: "unlock" }
  | { op: "decode"; clip: number; bytes: number }
  | { op: "buffer"; clip: number; channels: number; length: number; sampleRate: number }
  | { op: "stream"; clip: number; url: string }
  | { op: "play"; clip: number; voice: number; opts: VoiceOptions }
  | { op: "stop"; voice: number; fadeMs?: number }
  | { op: "pan"; voice: number; pan: number }
  | { op: "volume"; voice: number; volume: number; rampMs?: number }
  | { op: "seek"; voice: number; seconds: number }
  | { op: "bus"; bus: BusName; volume: number; rampMs?: number }
  | { op: "close" };

/** A bus's level as the player set it. */
export type BusLevel = { volume: number; muted: boolean };

/** The shell's presentation listener: it plays what each tick asks and never writes the simulation. */
export interface AudioSystem {
  /** After each tick: step events through the sound map, then present.audio requests, in order. */
  tick(tick: number, events: readonly StepEvent[], requests: readonly AudioRequest[]): void;
  /** Each frame: pan positional voices from the main viewport, resync music. */
  frame(view: { centre: Vec2; halfWidth: number }, simMs: number): void;
  readonly unlocked: boolean;
  buses(): Readonly<Record<BusName, BusLevel>>;
  setBus(bus: BusName, volume: number, muted?: boolean): void;
  readonly clock: AudioClock;
  stopAll(fadeMs?: number): void;
  destroy(): void;
}

/** What `GameInstance.audio` lets a host reach of the shell's audio system. */
export type GameAudio = Pick<AudioSystem, "buses" | "setBus" | "unlocked" | "clock" | "stopAll">;
