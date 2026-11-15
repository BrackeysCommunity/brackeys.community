import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { mediaFixtures, wavBytes } from "../project/__tests__/fixtures/make-media-fixtures";
import { stableJson } from "../project/canonical";
import { readAudioHeader } from "../project/inspect/audio";
import {
  audioKind,
  audioSettingsSchema,
  loopPastEnd,
  loopSpan,
  type AudioMeta,
} from "../project/kinds/audio";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../project/__tests__/fixtures/${name}`, import.meta.url)));
const env = (name: string) => ({ path: `sfx/${name}`, idAt: () => undefined });
const inspect = (name: string, bytes = fixture(name)) => audioKind.inspect(bytes, {}, env(name));

type Expected = {
  format: AudioMeta["format"];
  ms: number;
  frameMs: number;
  channels: number;
  rate: number;
};

/** Each clip's real length (as ffprobe reports it) and its codec's frame, the tolerance. */
const CLIPS: Readonly<Record<string, Expected>> = {
  "tone.wav": { format: "wav", ms: 50, frameMs: 1000 / 8000, channels: 1, rate: 8000 },
  "tone.ogg": {
    format: "ogg",
    ms: 101.587,
    frameMs: (256 * 1000) / 22050,
    channels: 2,
    rate: 22050,
  },
  "tone.mp3": { format: "mp3", ms: 100, frameMs: (576 * 1000) / 8000, channels: 1, rate: 8000 },
  "tone.m4a": { format: "m4a", ms: 100, frameMs: (1024 * 1000) / 8000, channels: 1, rate: 8000 },
  "media/tone-opus.ogg": { format: "ogg", ms: 100, frameMs: 20, channels: 2, rate: 48000 },
  "media/tone-cbr.mp3": {
    format: "mp3",
    ms: 130.5,
    frameMs: (1152 * 1000) / 44100,
    channels: 2,
    rate: 44100,
  },
  "media/tone-vbri.mp3": {
    format: "mp3",
    ms: 104.49,
    frameMs: (1152 * 1000) / 44100,
    channels: 2,
    rate: 44100,
  },
  "media/tone-tagged.mp3": {
    format: "mp3",
    ms: 130.5,
    frameMs: (1152 * 1000) / 44100,
    channels: 2,
    rate: 44100,
  },
  "media/stereo-44k.wav": {
    format: "wav",
    ms: 100,
    frameMs: 1000 / 44100,
    channels: 2,
    rate: 44100,
  },
  "media/mono-22k.wav": { format: "wav", ms: 120, frameMs: 1000 / 22050, channels: 1, rate: 22050 },
  "media/stereo-48k-24bit.wav": {
    format: "wav",
    ms: 75,
    frameMs: 1000 / 48000,
    channels: 2,
    rate: 48000,
  },
};

const TRUNCATED = [
  "media/stereo-44k-truncated.wav",
  "media/header-only.wav",
  "media/tone-truncated.ogg",
  "media/tone-opus-truncated.ogg",
  "media/tone-truncated.mp3",
  "media/tone-cbr-truncated.mp3",
  "media/tone-truncated.m4a",
];

describe("audio meta from the headers", () => {
  it.each(Object.entries(CLIPS))("%s: length within one frame, channels, rate", (name, clip) => {
    const result = inspect(name);
    expect(result.ok, stableJson(result)).toBe(true);
    if (!result.ok) return;
    const { format, durationMs, channels, sampleRate } = result.meta;
    expect(format).toBe(clip.format);
    expect(Math.abs(durationMs! - clip.ms)).toBeLessThanOrEqual(clip.frameMs);
    expect(channels).toBe(clip.channels);
    expect(sampleRate).toBe(clip.rate);
  });

  it("gives a WAV's length exactly from its data size", () => {
    expect(inspect("tone.wav")).toEqual({
      ok: true,
      meta: { format: "wav", durationMs: 50, channels: 1, sampleRate: 8000 },
    });
    const bytes = wavBytes({ channels: 2, sampleRate: 32_000, bits: 8, frames: 3_200 });
    expect(audioKind.inspect(bytes, {}, env("x.wav"))).toEqual({
      ok: true,
      meta: { format: "wav", durationMs: 100, channels: 2, sampleRate: 32_000 },
    });
  });

  it.each(TRUNCATED)("%s is import-failed as truncated", (name) => {
    const result = inspect(name);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.code).toBe("import-failed");
    expect(result.issue.message).toMatch(/truncated/);
  });

  it("refuses a clip cut anywhere inside its data, when its headers can tell", () => {
    const names = ["tone.ogg", "tone.m4a", "tone.mp3", "tone.wav", "media/tone-opus.ogg"];
    for (const name of [...names, "media/tone-vbri.mp3", "media/mono-22k.wav"]) {
      const bytes = fixture(name);
      for (let keep = 40; keep < bytes.length; keep += 37) {
        const read = readAudioHeader(bytes.subarray(0, keep));
        expect(read && "fault" in read, `${name} cut to ${keep}`).toBe(true);
      }
    }
  });

  it("refuses an Ogg stream that is neither Vorbis nor Opus", () => {
    const ogg = fixture("tone.ogg");
    ogg.set([0x7f, ...[..."FLAC"].map((c) => c.charCodeAt(0))], 28);
    const result = inspect("flac.ogg", ogg);
    expect(result.ok === false && result.issue.message).toMatch(/isn't Vorbis or Opus/);
  });

  it("checks loop points in the settings", () => {
    expect(audioSettingsSchema.safeParse({ stream: true, loopStart: 1, loopEnd: 4 }).success).toBe(
      true,
    );
    expect(audioSettingsSchema.safeParse({ loopEnd: 2 }).success).toBe(true);
    expect(audioSettingsSchema.safeParse({ loopStart: 3, loopEnd: 2 }).success).toBe(false);
    expect(audioSettingsSchema.safeParse({ loopStart: -1 }).success).toBe(false);
    expect(
      audioKind.inspect(fixture("tone.wav"), { loopStart: 2, loopEnd: 1 }, env("t.wav")).ok,
    ).toBe(false);
  });

  it("names loop points past the measured end of a 120 ms clip, which still imports", () => {
    const settings = { loopStart: 0.5 };
    const result = audioKind.inspect(fixture("media/mono-22k.wav"), settings, env("m.wav"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(loopPastEnd(settings, result.meta)).toBe(
      "loopStart 0.5 s is at or past the clip's 0.120 s end, so the whole clip loops",
    );
    expect(loopPastEnd({ loopStart: 0.12 }, result.meta)).toMatch(
      /^loopStart 0.12 s is at or past/,
    );
    expect(loopPastEnd({ loopStart: 0.05, loopEnd: 0.2 }, result.meta)).toBe(
      "loopEnd 0.2 s is past the clip's 0.120 s end, so the loop jumps back at the end",
    );
    expect(loopPastEnd({ loopStart: 0.05, loopEnd: 0.12 }, result.meta)).toBeNull();
    expect(loopPastEnd({}, result.meta)).toBeNull();
    expect(loopPastEnd(settings, { durationMs: undefined })).toBeNull();
  });

  it("plays loop points over a clip's length the same way for every backend", () => {
    expect(loopSpan({}, 4)).toEqual({ from: 0, to: 4 });
    expect(loopSpan({ loopStart: 1 }, 4)).toEqual({ from: 1, to: 4 });
    expect(loopSpan({ loopStart: 1, loopEnd: 3 }, 4)).toEqual({ from: 1, to: 3 });
    expect(loopSpan({ loopStart: 1, loopEnd: 9 }, 4)).toEqual({ from: 1, to: 4 });
    expect(loopSpan({ loopStart: 4 }, 4)).toEqual({ from: 0, to: 4 });
    expect(loopSpan({ loopStart: 6, loopEnd: 9 }, 4)).toEqual({ from: 0, to: 4 });
    expect(loopSpan({ loopStart: 1, loopEnd: 3 }, Number.POSITIVE_INFINITY)).toEqual({
      from: 1,
      to: 3,
    });
  });

  it("is versioned for re-inspection and declares each container's content type", () => {
    expect(audioKind.metaVersion).toBe(2);
    expect(audioKind.contentTypes).toEqual(["audio/ogg", "audio/mpeg", "audio/wav", "audio/mp4"]);
  });

  it("gives the same meta over two runs", () => {
    const names = [...Object.keys(CLIPS), ...TRUNCATED];
    const run = () => names.map((name) => stableJson(inspect(name)));
    expect(run()).toEqual(run());
  });

  it("keeps the generated fixtures byte-stable: the script writes what is checked in", () => {
    const twice = [mediaFixtures(), mediaFixtures()];
    for (const [name, bytes] of Object.entries(twice[0]!)) {
      expect(twice[1]![name], name).toEqual(bytes);
      expect(fixture(`media/${name}`), name).toEqual(bytes);
    }
  });
});
