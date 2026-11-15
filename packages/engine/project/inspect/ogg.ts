import type { AudioFault, AudioHeader } from "./audio";
import { hasAscii, u16le, u32le, u8 } from "./bytes";

const PAGE_HEADER = 27;
const FLAG_EOS = 0x04;
/** Opus granule positions always count 48 kHz samples. */
const OPUS_RATE = 48_000;

export function isOgg(bytes: Uint8Array): boolean {
  return hasAscii(bytes, 0, "OggS") && bytes.length >= PAGE_HEADER && u8(bytes, 4) === 0;
}

type Codec = { channels: number; sampleRate: number; preSkip: number };

/** The id header that opens a Vorbis or Opus stream. */
function idHeader(bytes: Uint8Array, at: number, end: number): Codec | AudioFault {
  if (u8(bytes, at) === 1 && hasAscii(bytes, at + 1, "vorbis")) {
    if (at + 16 > end) return { reason: "its Vorbis id header is cut short", truncated: true };
    return { channels: u8(bytes, at + 11), sampleRate: u32le(bytes, at + 12), preSkip: 0 };
  }
  if (hasAscii(bytes, at, "OpusHead")) {
    if (at + 19 > end) return { reason: "its Opus id header is cut short", truncated: true };
    return { channels: u8(bytes, at + 9), sampleRate: OPUS_RATE, preSkip: u16le(bytes, at + 10) };
  }
  return { reason: "its stream isn't Vorbis or Opus", truncated: false };
}

/**
 * An Ogg Vorbis or Opus file: channels and rate from the first page's id
 * header, the length from the granule position of the last page of that
 * stream (less Opus's pre-skip). The stream must reach its end-of-stream
 * page, so a cut file is refused.
 */
export function readOgg(bytes: Uint8Array): AudioHeader | AudioFault {
  let codec: Codec | null = null;
  let serial = 0;
  let granule = -1;
  for (let at = 0; ; ) {
    if (at >= bytes.length || !hasAscii(bytes, at, "OggS"))
      return { reason: "it ends before its last page", truncated: true };
    const segments = u8(bytes, at + 26);
    const body = at + PAGE_HEADER + segments;
    if (body > bytes.length) return { reason: "a page header is cut short", truncated: true };
    let size = 0;
    for (let i = 0; i < segments; i++) size += u8(bytes, at + PAGE_HEADER + i);
    if (body + size > bytes.length) return { reason: "a page is cut short", truncated: true };
    if (codec === null) {
      const found = idHeader(bytes, body, body + size);
      if ("reason" in found) return found;
      codec = found;
      serial = u32le(bytes, at + 14);
    }
    if (u32le(bytes, at + 14) === serial) {
      const low = u32le(bytes, at + 6);
      const high = u32le(bytes, at + 10);
      if (high !== 0xffffffff || low !== 0xffffffff) {
        if (high >= 0x200000)
          return { reason: "a page's granule position is too large", truncated: false };
        granule = high * 0x100000000 + low;
      }
      if ((u8(bytes, at + 5) & FLAG_EOS) !== 0) break;
    }
    at = body + size;
  }
  if (!codec || codec.channels === 0 || codec.sampleRate === 0)
    return { reason: "its id header names no channels or no rate", truncated: false };
  const samples = Math.max(0, granule - codec.preSkip);
  return {
    durationMs: (samples * 1000) / codec.sampleRate,
    channels: codec.channels,
    sampleRate: codec.sampleRate,
  };
}
