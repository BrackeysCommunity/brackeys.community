// @vitest-environment node
import { renderSynth, SYNTH_SAMPLE_RATE, synthDurationMs, webAudioBackend } from "@jams/engine";
import { createRegistry } from "@jams/engine/game";
import {
  createKindRegistry,
  parseAssetDoc,
  projectView,
  synthKind,
  type ProjectState,
} from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import type { BrowserOutcome } from "../browser-compare";
import { settledWithin, SMOKE_PATCH } from "../browser/audio";
import type { EngineSmokeResult } from "../browser/main";
import {
  AUDIO_ENDED_SLACK_MS,
  countSign,
  judgeAudio,
  judgeMedia,
  judgeSigns,
  type AudioProbe,
  type SignProbe,
} from "../browser/media-compare";
import { SIGN_GRID, SIGNS } from "../browser/signs";
import { SMOKE_BACKGROUND } from "../browser/sink";
import { smokeGame } from "../game";
import { audioPlayed, signsDrawn } from "./media-probes";

const rgb = (hex: number, a = 255) =>
  [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, a] as [number, number, number, number];

const points = SIGN_GRID[0] * SIGN_GRID[1];

describe("countSign", () => {
  it("counts points near the sign's colour, apart from the background and anything else", () => {
    const pixels = [
      rgb(SIGNS.web.colour),
      rgb(SMOKE_BACKGROUND),
      [60, 220, 250, 255] as const,
      [120, 120, 120, 255] as const,
      null,
    ];
    expect(countSign("web", "webgl", pixels, 7)).toEqual({
      font: "web",
      renderer: "webgl",
      points: 5,
      lit: 2,
      other: 1,
      sample: rgb(SIGNS.web.colour),
      ms: 7,
    });
  });

  it("reads a blank grid as no lit points", () => {
    const read = countSign("bitmap", "webgpu", Array(points).fill(rgb(SMOKE_BACKGROUND)), 0);
    expect(read).toMatchObject({ lit: 0, other: 0, sample: null, points });
  });
});

const signs = (patch: Partial<SignProbe> = {}): SignProbe => ({ ...signsDrawn, ...patch });

describe("judgeSigns", () => {
  it("passes when both signs show their colour and a web face loaded", () => {
    expect(judgeSigns(signsDrawn)).toBeNull();
  });

  it("fails a run without signs, a blank sign, a short grid or no loaded face", () => {
    expect(judgeSigns(undefined)).toBe("the page ran no signs");
    expect(judgeSigns(signs({ bitmap: { ...signsDrawn.bitmap, lit: 0 } }))).toMatch(
      /^the bitmap sign is blank: none of \d+ points showed its colour within 15 s on webgl/,
    );
    expect(judgeSigns(signs({ web: { ...signsDrawn.web, lit: 0, other: 40 } }))).toMatch(
      /web sign is blank.*\(40 showed something else\)$/,
    );
    expect(judgeSigns(signs({ web: { ...signsDrawn.web, points: 3 } }))).toBe(
      `the web sign was read at 3 points, not ${points}`,
    );
    expect(judgeSigns(signs({ loadedFaces: 0 }))).toBe(
      "the web sign drew, but the document loaded no font face",
    );
  });
});

const audio = (patch: Partial<AudioProbe> = {}): AudioProbe => ({ ...audioPlayed, ...patch });

describe("judgeAudio", () => {
  it("passes a running context on a stereo destination whose voice ended in time and panned left", () => {
    expect(judgeAudio(audioPlayed)).toBeNull();
    expect(judgeAudio(audio({ endedMs: 200 + AUDIO_ENDED_SLACK_MS, channels: 6 }))).toBeNull();
  });

  it("fails each requirement on its own", () => {
    expect(judgeAudio(undefined)).toBe("the page ran no audio");
    expect(judgeAudio(audio({ context: "suspended" }))).toBe(
      "after the click the context is suspended and the backend running, not running",
    );
    expect(judgeAudio(audio({ backend: "locked" }))).toMatch(/backend locked/);
    expect(judgeAudio(audio({ channels: 1 }))).toBe(
      "the destination has 1 channel, not two or more",
    );
    expect(judgeAudio(audio({ endedMs: 301 }))).toBe(
      "the patch's voice ended after 301 ms, not within its 200 ms plus 100",
    );
    expect(judgeAudio(audio({ endedMs: null }))).toMatch(/^the patch's voice never ended/);
    expect(judgeAudio(audio({ offlineChannels: 1 }))).toBe(
      "the offline render has 1 channel, not two",
    );
    expect(judgeAudio(audio({ offlineChannels: 0 }))).toBe(
      "the offline render has 0 channels, not two",
    );
    expect(judgeAudio(audio({ channels: 0, maxChannels: 2 }))).toBe(
      "the destination has 0 channels, not two or more",
    );
    expect(judgeAudio(audio({ leftShare: 0.95 }))).toBe(
      "at pan -1 the left channel holds 95.0% of the energy, not over 95%",
    );
    expect(judgeAudio(audio({ leftShare: Number.NaN }))).toMatch(/NaN% of the energy/);
  });
});

/**
 * A real-time context as Firefox's is with no output device: suspended, a
 * destination of no channels, and a resume() that never settles unless
 * `refuse` makes it reject.
 */
function devicelessContext(refuse = false): AudioContext {
  const node = () => ({ connect() {}, disconnect() {} });
  const param = (value: number) => ({
    value,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
    setTargetAtTime() {},
  });
  const ctx = {
    currentTime: 0,
    sampleRate: SYNTH_SAMPLE_RATE,
    state: "suspended",
    destination: { ...node(), channelCount: 0, maxChannelCount: 0 },
    createGain: () => ({ ...node(), gain: param(1) }),
    createStereoPanner: () => ({ ...node(), pan: param(0) }),
    createBuffer: (_channels: number, length: number, rate: number) => ({
      duration: length / rate,
      numberOfChannels: 1,
      copyToChannel() {},
    }),
    createBufferSource: () => ({
      ...node(),
      playbackRate: param(1),
      start() {},
      stop() {},
      onended: null,
    }),
    createMediaElementSource: () => node(),
    resume: () => (refuse ? Promise.reject(new Error("not allowed")) : new Promise<void>(() => {})),
    close: () => Promise.resolve(),
  };
  return ctx as unknown as AudioContext;
}

/** The live half of the probe as the page's run reads it, over `context`. */
async function liveRead(context: AudioContext): Promise<AudioProbe> {
  const backend = webAudioBackend({ context });
  await settledWithin(
    backend.unlock().catch(() => {}),
    5,
  );
  const samples = renderSynth(SMOKE_PATCH);
  const voice = backend.play(backend.buffer([samples], SYNTH_SAMPLE_RATE), {
    bus: "sfx",
    volume: 1,
    rate: 1,
    pan: 0,
    loop: false,
  });
  return {
    ...audioPlayed,
    context: context.state,
    backend: backend.state,
    channels: context.destination.channelCount,
    maxChannels: context.destination.maxChannelCount,
    endedMs: null,
    held: !voice.ended && voice.position() === 0,
  };
}

describe("the audio run on a context with no output device", () => {
  it("passes Firefox on what webAudioBackend reports there", async () => {
    const read = await liveRead(devicelessContext());
    expect(read).toMatchObject({ context: "suspended", backend: "suspended", held: true });
    expect(judgeAudio(read, "firefox")).toBeNull();
    expect(judgeAudio(read, "chromium")).toMatch(/no output device to run on/);
  });

  it("fails Firefox when the click's unlock was refused, and the backend reads locked", async () => {
    const read = await liveRead(devicelessContext(true));
    expect(read.backend).toBe("locked");
    expect(judgeAudio(read, "firefox")).toBe(
      "after the click the context is suspended and the backend locked: the click didn't reach its unlock, or the browser refused it",
    );
  });
});

describe("the audio run's patch", () => {
  it("is a valid synth patch whose render is one channel of its length, with sound in it", () => {
    const kinds = createKindRegistry(smokeGame);
    const state: ProjectState = {
      meta: { projectId: "smoke", layout: 1, name: "Smoke" },
      assets: {},
      history: {},
      code: {},
      build: {},
    };
    const env = { registry: createRegistry(smokeGame), project: projectView(state, kinds) };
    expect(parseAssetDoc(synthKind, SMOKE_PATCH, env)).toMatchObject({ ok: true });
    expect(synthDurationMs(SMOKE_PATCH)).toBe(200);
    const samples = renderSynth(SMOKE_PATCH);
    expect(samples.length).toBe(Math.round((200 * SYNTH_SAMPLE_RATE) / 1000));
    expect(samples.some((s) => Math.abs(s) > 0.5)).toBe(true);
  });
});

const passing: BrowserOutcome = { browser: "chromium", status: "pass", digest: "d" };

const page = (patch: Partial<Extract<EngineSmokeResult, { ok: true }>>): EngineSmokeResult =>
  ({ ok: true, signs: signsDrawn, audio: audioPlayed, ...patch }) as EngineSmokeResult;

describe("judgeMedia", () => {
  it("carries the page's signs and audio onto a passing outcome", () => {
    expect(judgeMedia(passing, page({}))).toEqual({
      ...passing,
      signs: signsDrawn,
      audio: audioPlayed,
    });
  });

  it("fails a passing outcome on the first media read that doesn't hold, signs first", () => {
    const blank = { ...signsDrawn, web: { ...signsDrawn.web, lit: 0 } };
    expect(
      judgeMedia(passing, page({ signs: blank, audio: audio({ channels: 1 }) })),
    ).toMatchObject({ status: "fail", reason: expect.stringMatching(/^the web sign is blank/) });
    expect(judgeMedia(passing, page({ audio: audio({ channels: 1 }) }))).toMatchObject({
      status: "fail",
      reason: "the destination has 1 channel, not two or more",
    });
  });

  it("keeps an earlier failure's reason, and leaves a failed page's outcome alone", () => {
    const failed: BrowserOutcome = { browser: "firefox", status: "fail", reason: "digest" };
    expect(judgeMedia(failed, page({ audio: audio({ channels: 1 }) }))).toMatchObject({
      status: "fail",
      reason: "digest",
      audio: { channels: 1 },
    });
    expect(judgeMedia(failed, { ok: false, error: "boom" })).toBe(failed);
    expect(judgeMedia(failed, undefined)).toBe(failed);
  });
});
