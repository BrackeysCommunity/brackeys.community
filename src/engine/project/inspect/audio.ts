import { hasAscii, u32be, u8 } from "./bytes";

export type AudioFormat = "ogg" | "mp3" | "wav" | "m4a";

/** ISO base media brands an audio-only MPEG-4 file is written with. */
const M4A_BRANDS = ["M4A ", "M4B ", "M4P ", "mp41", "mp42", "isom", "iso2", "iso4", "iso5", "iso6"];

/** An MPEG audio layer III frame header at `at`: sync, a known version, valid bitrate and sample rate. */
function mp3Frame(bytes: Uint8Array, at: number): boolean {
  if (at + 4 > bytes.length) return false;
  const b1 = u8(bytes, at + 1);
  const b2 = u8(bytes, at + 2);
  if (u8(bytes, at) !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const bitrate = b2 >> 4;
  const rate = (b2 >> 2) & 3;
  return version !== 1 && layer === 1 && bitrate !== 0 && bitrate !== 15 && rate !== 3;
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

/** An MPEG-4 file's `ftyp` box names an audio-capable brand, major or compatible. */
function m4aBrand(bytes: Uint8Array): boolean {
  if (!hasAscii(bytes, 4, "ftyp")) return false;
  const size = u32be(bytes, 0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return false;
  for (let at = 8; at + 4 <= size; at += 4) {
    if (at === 12) continue;
    if (M4A_BRANDS.some((brand) => hasAscii(bytes, at, brand))) return true;
  }
  return false;
}

/**
 * The container an audio file's header names: an Ogg page, a RIFF WAVE
 * file, an MP3's first frame (after any ID3v2 tag) or an MPEG-4 `ftyp`.
 * Null for anything else. Samples are never decoded.
 */
export function readAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (hasAscii(bytes, 0, "OggS") && bytes.length >= 27 && u8(bytes, 4) === 0) return "ogg";
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WAVE") && bytes.length >= 20) return "wav";
  if (m4aBrand(bytes)) return "m4a";
  if (hasAscii(bytes, 0, "ID3")) {
    const length = id3Length(bytes);
    return length !== null && mp3Frame(bytes, length) ? "mp3" : null;
  }
  return mp3Frame(bytes, 0) ? "mp3" : null;
}
