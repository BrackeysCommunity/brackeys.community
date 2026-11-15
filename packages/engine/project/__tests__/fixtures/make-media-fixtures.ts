/**
 * Writes the generated audio fixtures in `media/`: WAV files of an integer
 * triangle wave, and edited copies of the encoded tones (cut short, tagged,
 * or given a VBRI header). Every byte comes from integer arithmetic, so a
 * rerun writes the same files.
 *
 *   bun packages/engine/project/__tests__/fixtures/make-media-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { pcmWav, triangleLevel, type PcmWav } from "../../../audio/wav";

const DIR = new URL("./", import.meta.url);
const MEDIA = new URL("./media/", import.meta.url);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le = (value: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) => Math.floor(value / 256 ** i) % 256);
const be = (value: number, bytes: number) => le(value, bytes).reverse();

export type WavSpec = Omit<PcmWav, "samples"> & { frames: number };

/** A PCM WAV of `frames` sample frames: a triangle wave, its period in samples set per channel. */
export function wavBytes(spec: WavSpec): Uint8Array {
  const full = 2 ** (spec.bits - 1) - 1;
  const samples: number[] = [];
  for (let frame = 0; frame < spec.frames; frame++)
    for (let channel = 0; channel < spec.channels; channel++)
      samples.push(triangleLevel(frame, 40 + channel * 20, full));
  return pcmWav({ ...spec, samples });
}

const encoded = (path: string) => new Uint8Array(readFileSync(new URL(path, DIR)));
const cut = (bytes: Uint8Array, keep: number) => bytes.slice(0, keep);

/** `tone-cbr.mp3` with its first frame's payload replaced by a VBRI header counting the four frames after it. */
function vbriMp3(): Uint8Array {
  const out = encoded("media/tone-cbr.mp3");
  const vbri = [
    ...ascii("VBRI"),
    ...be(1, 2),
    ...be(0, 2),
    ...be(75, 2),
    ...be(out.length, 4),
    ...be(4, 4),
  ];
  out.set(vbri, 36);
  return out;
}

/** `tone-cbr.mp3` behind an ID3v2 tag and followed by an ID3v1 tag. */
function taggedMp3(): Uint8Array {
  const frames = encoded("media/tone-cbr.mp3");
  const id3v2 = [...ascii("ID3"), 4, 0, 0, 0, 0, 0, 20, ...new Array<number>(20).fill(0)];
  const id3v1 = [...ascii("TAG"), ...new Array<number>(125).fill(0x20)];
  return new Uint8Array([...id3v2, ...frames, ...id3v1]);
}

const STEREO_44K: WavSpec = { channels: 2, sampleRate: 44_100, bits: 16, frames: 4_410 };

/** Every generated file under `media/`, by name. */
export function mediaFixtures(): Record<string, Uint8Array> {
  const stereo = wavBytes(STEREO_44K);
  return {
    "stereo-44k.wav": stereo,
    "mono-22k.wav": wavBytes({ channels: 1, sampleRate: 22_050, bits: 16, frames: 2_646 }),
    "stereo-48k-24bit.wav": wavBytes({
      channels: 2,
      sampleRate: 48_000,
      bits: 24,
      frames: 3_600,
      extra: [["LIST", [...ascii("INFO"), ...ascii("ISFT"), ...le(3, 4), ...ascii("gen")]]],
    }),
    "stereo-44k-truncated.wav": cut(stereo, stereo.length - 1_000),
    "header-only.wav": cut(stereo, 36),
    "tone-vbri.mp3": vbriMp3(),
    "tone-tagged.mp3": taggedMp3(),
    "tone-truncated.ogg": cut(encoded("tone.ogg"), 3_000),
    "tone-opus-truncated.ogg": cut(encoded("media/tone-opus.ogg"), 400),
    "tone-truncated.mp3": cut(encoded("tone.mp3"), 400),
    "tone-cbr-truncated.mp3": cut(encoded("media/tone-cbr.mp3"), 470),
    "tone-truncated.m4a": cut(encoded("tone.m4a"), 1_200),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  for (const [name, bytes] of Object.entries(mediaFixtures()))
    writeFileSync(new URL(name, MEDIA), bytes);
