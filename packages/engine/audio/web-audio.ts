/**
 * The browser's audio backend: the one file that reaches Web Audio and media
 * elements. One context; a gain node per bus, every bus into master; every
 * voice is source → gain → stereo panner → its bus. The panner places a
 * mono clip or patch and balances a stereo one, and nothing after it
 * downmixes, so the output stays two channels or more.
 */
import { clamp } from "../math";
import { loopSpan } from "../project/kinds/audio";
import type { AudioBackend, AudioClipHandle, BusName, Voice, VoiceOptions } from "./types";

type BufferSource = { kind: "buffer"; buffer: AudioBuffer };
type StreamSource = { kind: "stream"; url: string; handle: StreamHandle };
type StreamHandle = AudioClipHandle & { duration: number };

/** The time constant pan moves follow, s: quick enough to track a moving source, slow enough not to click. */
const PAN_GLIDE_S = 0.015;
/** How early a streamed loop jumps back, s: a timer fires late more often than early. */
const LOOP_EARLY_S = 0.005;

const clampPan = (pan: number): number => (Number.isFinite(pan) ? clamp(pan, -1, 1) : 0);
const level = (volume: number): number => (Number.isFinite(volume) && volume > 0 ? volume : 0);
const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Moves `param` to `to` over `ms` from now; at once for no ramp. */
function rampTo(param: AudioParam, to: number, now: number, ms = 0): void {
  param.cancelScheduledValues(now);
  if (ms > 0) {
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + ms / 1000);
  } else {
    param.setValueAtTime(to, now);
  }
}

/**
 * `webAudioBackend()`, or `false` where the browser has no Web Audio, so a
 * host's `GameConfig.audio.backend` plays the game silent instead of failing it.
 */
export function tryWebAudioBackend(): AudioBackend | false {
  try {
    return webAudioBackend();
  } catch {
    return false;
  }
}

/** The browser's audio backend; `context` is for tests (an OfflineAudioContext), hosts pass nothing. */
export function webAudioBackend(opts: { context?: BaseAudioContext } = {}): AudioBackend {
  const ctx: BaseAudioContext = opts.context ?? new AudioContext({ latencyHint: "interactive" });
  const offline = "startRendering" in ctx;
  const destination = ctx.destination;
  if (destination.channelCount < 2 && destination.maxChannelCount >= 2) {
    try {
      destination.channelCount = 2;
    } catch {
      // An offline context's destination is fixed at the channel count it was made with.
    }
  }

  const master = ctx.createGain();
  master.connect(destination);
  const buses = new Map<BusName, GainNode>([["master", master]]);
  const sources = new WeakMap<AudioClipHandle, BufferSource | StreamSource>();
  const voices = new Set<WebVoice>();
  /** The context has run since an unlock; a realtime one stopped since then is suspended, not locked. */
  let unlocked = false;
  /** Unlocks whose resume() hasn't settled: the context was asked to run and hasn't yet. */
  let resuming = 0;
  let closed = false;

  function bus(name: BusName): GainNode {
    const known = buses.get(name);
    if (known) return known;
    const gain = ctx.createGain();
    gain.connect(master);
    buses.set(name, gain);
    return gain;
  }

  function state(): AudioBackend["state"] {
    if (closed || ctx.state === "closed") return "closed";
    if (offline) return unlocked ? "running" : "locked";
    if (ctx.state === "running") return "running";
    return unlocked || resuming > 0 ? "suspended" : "locked";
  }

  type WebVoice = Voice & { kill(): void };

  /** The gain and panner every voice plays through, into its bus. */
  function chain(o: VoiceOptions, start: number): { gain: GainNode; panner: StereoPannerNode } {
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampPan(o.pan);
    const volume = level(o.volume);
    if (o.fadeInMs && o.fadeInMs > 0) {
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + o.fadeInMs / 1000);
    } else {
      gain.gain.value = volume;
    }
    gain.connect(panner);
    panner.connect(bus(o.bus));
    return { gain, panner };
  }

  function bufferVoice(buffer: AudioBuffer, o: VoiceOptions): WebVoice {
    const start = Math.max(o.when ?? ctx.currentTime, ctx.currentTime);
    const { gain, panner } = chain(o, start);
    const rate = o.rate > 0 ? o.rate : 1;
    const loop = loopSpan(o, buffer.duration);
    let node: AudioBufferSourceNode | null = null;
    /** Where the clip was at `anchor` (context time), s. */
    let from = o.offset ?? 0;
    let anchor = start;
    let ended = false;
    let stopping = false;

    function begin(at: number, offset: number): void {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.loop = o.loop;
      // Both points always: with only a start, Web Audio would loop the whole buffer.
      if (o.loop) {
        source.loopStart = loop.from;
        source.loopEnd = loop.to;
      }
      source.connect(gain);
      source.onended = () => {
        if (node !== source) return;
        finish();
      };
      node = source;
      from = offset;
      anchor = at;
      source.start(at, offset);
    }

    function finish(): void {
      if (ended) return;
      ended = true;
      node?.disconnect();
      node = null;
      gain.disconnect();
      panner.disconnect();
      voices.delete(voice);
    }

    function position(): number {
      const played = Math.max(0, ctx.currentTime - anchor) * rate;
      const at = from + played;
      if (!o.loop) return Math.min(at, buffer.duration);
      const span = loop.to - loop.from;
      if (at < loop.to || span <= 0) return at;
      return loop.from + ((at - loop.from) % span);
    }

    const voice: WebVoice = {
      key: o.key ?? null,
      stop(fadeMs = 0) {
        if (ended || stopping) return;
        stopping = true;
        const now = ctx.currentTime;
        rampTo(gain.gain, 0, now, fadeMs);
        node?.stop(now + Math.max(0, fadeMs) / 1000);
      },
      setPan: (pan) => panner.pan.setTargetAtTime(clampPan(pan), ctx.currentTime, PAN_GLIDE_S),
      setVolume: (volume, rampMs) => {
        if (!stopping) rampTo(gain.gain, level(volume), ctx.currentTime, rampMs);
      },
      position,
      seek(seconds) {
        if (ended || stopping || !node) return;
        const old = node;
        node = null;
        old.onended = null;
        old.stop();
        old.disconnect();
        begin(Math.max(anchor, ctx.currentTime), Math.max(0, Math.min(seconds, buffer.duration)));
      },
      get ended() {
        return ended;
      },
      kill() {
        if (node) {
          node.onended = null;
          try {
            node.stop();
          } catch {
            // Never started (a voice scheduled ahead on a context that's closing).
          }
        }
        finish();
      },
    };
    begin(start, Math.max(0, from));
    voices.add(voice);
    return voice;
  }

  function streamVoice(source: StreamSource, o: VoiceOptions): WebVoice {
    if (!("createMediaElementSource" in ctx)) {
      throw new Error("a streamed clip needs a realtime AudioContext, not an offline one");
    }
    const realtime = ctx as AudioContext;
    const element = document.createElement("audio") as HTMLAudioElement;
    const rate = o.rate > 0 ? o.rate : 1;
    const timedEnd = o.loop && o.loopEnd !== undefined && o.loopEnd > (o.loopStart ?? 0);
    // A media element loops only the whole file, so loop points are kept by hand.
    const loopPoints = o.loop && (timedEnd || (o.loopStart ?? 0) > 0);
    /** The loop over the file's length once the element knows it, as a buffered clip plays it. */
    const loop = () =>
      loopSpan(o, Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY);
    element.crossOrigin = "anonymous";
    element.preload = "auto";
    element.loop = o.loop && !loopPoints;
    element.playbackRate = rate;
    element.src = source.url;
    const node = realtime.createMediaElementSource(element);
    const start = Math.max(o.when ?? ctx.currentTime, ctx.currentTime);
    const { gain, panner } = chain(o, start);
    node.connect(gain);
    let ended = false;
    let stopping = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Jumps back to the loop start at the loop end: timed from the playback
     * rate, timed again on every seek, play and time update, so the element's
     * own clock corrects the timer's drift.
     */
    function armLoop(): void {
      if (loopTimer !== null) clearTimeout(loopTimer);
      loopTimer = null;
      if (!timedEnd || ended || element.paused) return;
      const { from, to } = loop();
      const left = to - element.currentTime;
      if (left <= LOOP_EARLY_S) {
        element.currentTime = from + (Math.max(0, -left) % (to - from));
        return;
      }
      loopTimer = setTimeout(armLoop, ((left - LOOP_EARLY_S) / rate) * 1000);
    }

    // A media element only seeks once it knows its length.
    let offset = o.offset ?? 0;
    const onMeta = () => {
      if (Number.isFinite(element.duration)) source.handle.duration = element.duration;
      if (offset > 0) element.currentTime = offset;
      offset = 0;
    };
    const onEnded = () => {
      if (!loopPoints || stopping) return finish();
      element.currentTime = loop().from;
      void element.play().catch(() => {});
    };
    element.addEventListener("loadedmetadata", onMeta);
    element.addEventListener("ended", onEnded);
    const loopEvents = timedEnd ? ["playing", "seeked", "timeupdate"] : [];
    for (const type of loopEvents) element.addEventListener(type, armLoop);

    function finish(): void {
      if (ended) return;
      ended = true;
      if (timer !== null) clearTimeout(timer);
      if (loopTimer !== null) clearTimeout(loopTimer);
      timer = null;
      loopTimer = null;
      element.removeEventListener("loadedmetadata", onMeta);
      element.removeEventListener("ended", onEnded);
      for (const type of loopEvents) element.removeEventListener(type, armLoop);
      element.pause();
      element.removeAttribute("src");
      element.load();
      node.disconnect();
      gain.disconnect();
      panner.disconnect();
      voices.delete(voice);
    }

    function play(): void {
      timer = null;
      // A refused play (no gesture yet, a network error) leaves the voice silent until stopped.
      void element.play().catch(() => {});
    }

    const delayMs = (start - ctx.currentTime) * 1000;
    if (delayMs > 1) timer = setTimeout(play, delayMs);
    else play();

    const voice: WebVoice = {
      key: o.key ?? null,
      stop(fadeMs = 0) {
        if (ended || stopping) return;
        stopping = true;
        rampTo(gain.gain, 0, ctx.currentTime, fadeMs);
        if (fadeMs > 0) {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(finish, fadeMs);
        } else {
          finish();
        }
      },
      setPan: (pan) => panner.pan.setTargetAtTime(clampPan(pan), ctx.currentTime, PAN_GLIDE_S),
      setVolume: (volume, rampMs) => {
        if (!stopping) rampTo(gain.gain, level(volume), ctx.currentTime, rampMs);
      },
      position: () => (element.readyState === 0 ? offset : element.currentTime),
      seek(seconds) {
        if (ended) return;
        if (element.readyState === 0) offset = Math.max(0, seconds);
        else element.currentTime = Math.max(0, seconds);
      },
      get ended() {
        return ended;
      },
      kill: finish,
    };
    voices.add(voice);
    return voice;
  }

  return {
    get now() {
      return ctx.currentTime;
    },
    get state() {
      return state();
    },
    get latency() {
      if (offline) return 0;
      const live = ctx as Partial<Pick<AudioContext, "outputLatency" | "baseLatency">>;
      return finite(live.outputLatency) + finite(live.baseLatency);
    },
    async unlock() {
      if (closed) return;
      if (offline) {
        unlocked = true;
        return;
      }
      const realtime = ctx as AudioContext;
      if (realtime.state === "running") {
        unlocked = true;
        return;
      }
      // Every try goes again in full: iOS refuses a touch's pointerdown and
      // accepts only its end, so a refused first resume can't latch the rest.
      // A one-sample silence started inside the gesture is what iOS Safari
      // wants besides resume().
      const blank = ctx.createBufferSource();
      blank.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      blank.connect(destination);
      blank.onended = () => blank.disconnect();
      blank.start();
      // A context with no output device (Firefox's, without one) never settles this.
      resuming++;
      try {
        await realtime.resume();
      } finally {
        resuming--;
      }
      if ((realtime.state as AudioContextState) === "running") unlocked = true;
    },
    async decode(bytes) {
      // decodeAudioData detaches what it's given; the caller keeps its bytes.
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      const handle: AudioClipHandle = Object.freeze({
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        streamed: false,
      });
      sources.set(handle, { kind: "buffer", buffer });
      return handle;
    },
    buffer(channels, sampleRate) {
      if (channels.length === 0) throw new Error("a buffer needs at least one channel");
      const length = Math.max(1, ...channels.map((c) => c.length));
      const buffer = ctx.createBuffer(channels.length, length, sampleRate);
      channels.forEach((samples, i) => {
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, i);
      });
      const handle: AudioClipHandle = Object.freeze({
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        streamed: false,
      });
      sources.set(handle, { kind: "buffer", buffer });
      return handle;
    },
    stream(url) {
      const handle: StreamHandle = { duration: Number.NaN, channels: 2, streamed: true };
      sources.set(handle, { kind: "stream", url, handle });
      return handle;
    },
    play(clip, o) {
      if (closed) throw new Error("this audio backend is closed");
      const source = sources.get(clip);
      if (!source) throw new Error("that clip wasn't made by this backend");
      return source.kind === "buffer" ? bufferVoice(source.buffer, o) : streamVoice(source, o);
    },
    setBusVolume(name, volume, rampMs) {
      if (!closed) rampTo(bus(name).gain, level(volume), ctx.currentTime, rampMs);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const voice of [...voices]) voice.kill();
      for (const gain of buses.values()) gain.disconnect();
      buses.clear();
      if (!offline) void (ctx as AudioContext).close().catch(() => {});
    },
  };
}
