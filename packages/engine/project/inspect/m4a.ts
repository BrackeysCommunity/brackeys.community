import type { AudioFault, AudioHeader } from "./audio";
import { hasAscii, u16be, u32be, u8 } from "./bytes";

/** ISO base media brands an audio-only MPEG-4 file is written with. */
const M4A_BRANDS = ["M4A ", "M4B ", "M4P ", "mp41", "mp42", "isom", "iso2", "iso4", "iso5", "iso6"];

/** An MPEG-4 file's `ftyp` box names an audio-capable brand, major or compatible. */
export function isM4a(bytes: Uint8Array): boolean {
  if (!hasAscii(bytes, 4, "ftyp")) return false;
  const size = u32be(bytes, 0);
  if (size < 16 || size > bytes.length || size % 4 !== 0) return false;
  for (let at = 8; at + 4 <= size; at += 4) {
    if (at === 12) continue;
    if (M4A_BRANDS.some((brand) => hasAscii(bytes, at, brand))) return true;
  }
  return false;
}

type Box = { type: string; body: number; end: number };

/** The boxes between `from` and `to`, or null when one runs past `to`. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  for (let at = from; at < to; ) {
    if (at + 8 > to) return null;
    let size = u32be(bytes, at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      size = u32be(bytes, at + 8) * 0x100000000 + u32be(bytes, at + 12);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return null;
    out.push({
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      body,
      end: at + size,
    });
    at += size;
  }
  return out;
}

function child(bytes: Uint8Array, parent: Box | undefined, type: string): Box | undefined {
  return parent
    ? boxes(bytes, parent.body, parent.end)?.find((box) => box.type === type)
    : undefined;
}

/** A `mvhd` or `mdhd` box's timescale and duration: both share the layout up to there. */
function timing(bytes: Uint8Array, box: Box): { timescale: number; duration: number } {
  if (u8(bytes, box.body) === 1)
    return {
      timescale: u32be(bytes, box.body + 20),
      duration: u32be(bytes, box.body + 24) * 0x100000000 + u32be(bytes, box.body + 28),
    };
  return { timescale: u32be(bytes, box.body + 12), duration: u32be(bytes, box.body + 16) };
}

/** The first sound track's sample entry: channels, and its rate (the media timescale when the entry's 16.16 rate is zero). */
function soundTrack(bytes: Uint8Array, moov: Box): { channels: number; sampleRate: number } | null {
  for (const trak of boxes(bytes, moov.body, moov.end) ?? []) {
    if (trak.type !== "trak") continue;
    const mdia = child(bytes, trak, "mdia");
    const hdlr = child(bytes, mdia, "hdlr");
    if (!hdlr || !hasAscii(bytes, hdlr.body + 8, "soun")) continue;
    const mdhd = child(bytes, mdia, "mdhd");
    const stsd = child(bytes, child(bytes, child(bytes, mdia, "minf"), "stbl"), "stsd");
    if (!stsd || u32be(bytes, stsd.body + 4) === 0) return null;
    const entry = stsd.body + 8;
    if (entry + 36 > stsd.end) return null;
    const rate = u16be(bytes, entry + 32);
    return {
      channels: u16be(bytes, entry + 24),
      sampleRate: rate > 0 ? rate : mdhd ? timing(bytes, mdhd).timescale : 0,
    };
  }
  return null;
}

/**
 * An MPEG-4 audio file: the length from `moov`'s `mvhd`, channels and rate
 * from the first sound track's sample entry. A file whose boxes run past
 * its end, or that ends before its `moov`, is refused.
 */
export function readM4a(bytes: Uint8Array): AudioHeader | AudioFault {
  const top = boxes(bytes, 0, bytes.length);
  if (!top) return { reason: "a box runs past the end of the file", truncated: true };
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return { reason: "it ends before its moov box", truncated: true };
  const mvhd = child(bytes, moov, "mvhd");
  if (!mvhd || mvhd.body + 20 > mvhd.end)
    return { reason: "its moov box has no movie header", truncated: false };
  const { timescale, duration } = timing(bytes, mvhd);
  if (timescale === 0 || duration === 0)
    return { reason: "its movie header gives no duration", truncated: false };
  const track = soundTrack(bytes, moov);
  if (!track || track.channels === 0 || track.sampleRate === 0)
    return { reason: "it has no sound track", truncated: false };
  return { durationMs: (duration * 1000) / timescale, ...track };
}
