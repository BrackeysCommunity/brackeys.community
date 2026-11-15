import type { AudioFault, AudioHeader } from "./audio";
import { hasAscii, u16le, u32le } from "./bytes";

/** WAVE format tags whose data is whole sample frames of `blockAlign` bytes. */
const FRAMED_FORMATS = [0x0001, 0x0003, 0x0006, 0x0007, 0xfffe];

export function isWav(bytes: Uint8Array): boolean {
  return hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WAVE") && bytes.length >= 20;
}

/**
 * A RIFF WAVE file's `fmt ` and `data` chunks: channels and rate from the
 * first, the length from the second's size (or a `fact` chunk's sample count
 * for a compressed format).
 */
export function readWav(bytes: Uint8Array): AudioHeader | AudioFault {
  let fmt = -1;
  let factFrames: number | null = null;
  for (let at = 12; ; ) {
    if (at + 8 > bytes.length)
      return fmt < 0
        ? { reason: "it ends before its fmt chunk", truncated: true }
        : { reason: "it ends before its data chunk", truncated: true };
    const size = u32le(bytes, at + 4);
    const body = at + 8;
    if (hasAscii(bytes, at, "fmt ")) {
      if (size < 16 || body + size > bytes.length)
        return { reason: "its fmt chunk is cut short", truncated: true };
      fmt = body;
    } else if (hasAscii(bytes, at, "fact") && size >= 4) {
      factFrames = u32le(bytes, body);
    } else if (hasAscii(bytes, at, "data")) {
      if (fmt < 0) return { reason: "its data chunk comes before a fmt chunk", truncated: false };
      if (body + size > bytes.length)
        return { reason: "it ends inside its data chunk", truncated: true };
      return wavHeader(bytes, fmt, size, factFrames);
    }
    at = body + size + (size & 1);
  }
}

function wavHeader(
  bytes: Uint8Array,
  fmt: number,
  dataBytes: number,
  factFrames: number | null,
): AudioHeader | AudioFault {
  const format = u16le(bytes, fmt);
  const channels = u16le(bytes, fmt + 2);
  const sampleRate = u32le(bytes, fmt + 4);
  const byteRate = u32le(bytes, fmt + 8);
  const blockAlign = u16le(bytes, fmt + 12);
  if (channels === 0 || sampleRate === 0 || byteRate === 0 || blockAlign === 0)
    return { reason: "its fmt chunk names no channels or no rate", truncated: false };
  const durationMs = FRAMED_FORMATS.includes(format)
    ? (Math.floor(dataBytes / blockAlign) * 1000) / sampleRate
    : factFrames !== null
      ? (factFrames * 1000) / sampleRate
      : (dataBytes * 1000) / byteRate;
  return { durationMs, channels, sampleRate };
}
