import type { AudioFault, AudioHeader } from "./audio";
import { hasAscii, u16be, u32be, u8 } from "./bytes";

/** Layer III bitrates in kbit/s by index, for MPEG-1 and for MPEG-2 and 2.5. */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** Sample rates by index, keyed by the header's version bits (0 = MPEG-2.5, 2 = MPEG-2, 3 = MPEG-1). */
const RATES: Readonly<Record<number, readonly number[]>> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};
/** Encoder tags that write LAME's extension (delay and padding) after a Xing or Info header. */
const LAME_TAGS = ["LAME", "Lavf", "Lavc"];

type Frame = { bytes: number; samples: number; sampleRate: number; channels: number; v1: boolean };

/** The MPEG audio layer III frame header at `at`, or null when there isn't a valid one. */
function frameAt(bytes: Uint8Array, at: number): Frame | null {
  if (at + 4 > bytes.length) return null;
  const b1 = u8(bytes, at + 1);
  const b2 = u8(bytes, at + 2);
  if (u8(bytes, at) !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const index = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const sampleRate = RATES[version]?.[rateIndex] ?? 0;
  const bitrate = ((v1 ? BITRATES_V1 : BITRATES_V2)[index] ?? 0) * 1000;
  const padding = (b2 >> 1) & 1;
  return {
    bytes: Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    samples: v1 ? 1152 : 576,
    sampleRate,
    channels: u8(bytes, at + 3) >> 6 === 3 ? 1 : 2,
    v1,
  };
}

/** An ID3v2 tag's total length, footer included, or null when its size bytes aren't synchsafe. */
function id3Length(bytes: Uint8Array): number | null {
  if (bytes.length < 10 || u8(bytes, 3) === 0xff || u8(bytes, 4) === 0xff) return null;
  let size = 0;
  for (let i = 6; i < 10; i++) {
    const b = u8(bytes, i);
    if (b >= 0x80) return null;
    size = size * 128 + b;
  }
  const footer = (u8(bytes, 5) & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/** Where the first frame starts: after any ID3v2 tag. Null when a tag's size is malformed. */
function firstFrame(bytes: Uint8Array): number | null {
  return hasAscii(bytes, 0, "ID3") ? id3Length(bytes) : 0;
}

export function isMp3(bytes: Uint8Array): boolean {
  const start = firstFrame(bytes);
  return start !== null && frameAt(bytes, start) !== null;
}

/** The frame count a Xing/Info or VBRI header in the first frame gives, and the encoder's delay and padding. */
function vbrHeader(
  bytes: Uint8Array,
  start: number,
  frame: Frame,
): { frames: number; trim: number } | null {
  const crc = (u8(bytes, start + 1) & 1) === 0 ? 2 : 0;
  const sideInfo = frame.v1 ? (frame.channels === 1 ? 17 : 32) : frame.channels === 1 ? 9 : 17;
  const xing = start + 4 + crc + sideInfo;
  if (hasAscii(bytes, xing, "Xing") || hasAscii(bytes, xing, "Info")) {
    const flags = u32be(bytes, xing + 4);
    if ((flags & 1) === 0) return null;
    const frames = u32be(bytes, xing + 8);
    const lame = xing + 8 + 4 + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    if (!LAME_TAGS.some((tag) => hasAscii(bytes, lame, tag))) return { frames, trim: 0 };
    const delay = (u8(bytes, lame + 21) << 4) | (u8(bytes, lame + 22) >> 4);
    const padding = ((u8(bytes, lame + 22) & 0x0f) << 8) | u8(bytes, lame + 23);
    return { frames, trim: delay + padding };
  }
  const vbri = start + 4 + 32;
  if (hasAscii(bytes, vbri, "VBRI") && u16be(bytes, vbri + 4) === 1)
    return { frames: u32be(bytes, vbri + 14), trim: 0 };
  return null;
}

/**
 * An MP3's channels and rate from its first frame header. The length is the
 * frame count a Xing/Info or VBRI header gives (less LAME's encoder delay
 * and padding), else the frames counted by walking the stream; walking also
 * finds a file that stops partway through a frame.
 */
export function readMp3(bytes: Uint8Array): AudioHeader | AudioFault {
  const start = firstFrame(bytes);
  const first = start === null ? null : frameAt(bytes, start);
  if (start === null || first === null)
    return { reason: "it has no MPEG layer III frame", truncated: false };
  let walked = 0;
  let at = start;
  for (let frame: Frame | null = first; frame; frame = frameAt(bytes, at)) {
    if (at + frame.bytes > bytes.length)
      return { reason: "it ends partway through a frame", truncated: true };
    walked++;
    at += frame.bytes;
  }
  const vbr = vbrHeader(bytes, start, first);
  let samples = walked * first.samples;
  if (vbr) {
    if (walked - 1 < vbr.frames)
      return { reason: "it holds fewer frames than its header counts", truncated: true };
    const total = vbr.frames * first.samples;
    samples = vbr.trim < total ? total - vbr.trim : total;
  }
  return {
    durationMs: (samples * 1000) / first.sampleRate,
    channels: first.channels,
    sampleRate: first.sampleRate,
  };
}
