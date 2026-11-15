import { isM4a, readM4a } from "./m4a";
import { isMp3, readMp3 } from "./mp3";
import { isOgg, readOgg } from "./ogg";
import { isWav, readWav } from "./wav";

export type AudioFormat = "ogg" | "mp3" | "wav" | "m4a";

/** What an audio header gives without decoding a sample. */
export type AudioHeader = { durationMs: number; channels: number; sampleRate: number };

/** Why a reader couldn't give a header; `truncated` when the file stops before its header says it should. */
export type AudioFault = { reason: string; truncated: boolean };

type Reader = {
  format: AudioFormat;
  is(bytes: Uint8Array): boolean;
  read(bytes: Uint8Array): AudioHeader | AudioFault;
};

const READERS: readonly Reader[] = [
  { format: "ogg", is: isOgg, read: readOgg },
  { format: "wav", is: isWav, read: readWav },
  { format: "m4a", is: isM4a, read: readM4a },
  { format: "mp3", is: isMp3, read: readMp3 },
];

/**
 * The container an audio file's header names: an Ogg page, a RIFF WAVE
 * file, an MP3's first frame (after any ID3v2 tag) or an MPEG-4 `ftyp`.
 * Null for anything else. Samples are never decoded.
 */
export function readAudioFormat(bytes: Uint8Array): AudioFormat | null {
  return READERS.find((reader) => reader.is(bytes))?.format ?? null;
}

/**
 * The file's format, then its length, channels and sample rate from that
 * format's headers, or why they can't be read. Null when no format matches.
 */
export function readAudioHeader(
  bytes: Uint8Array,
): { format: AudioFormat; header: AudioHeader } | { format: AudioFormat; fault: string } | null {
  const reader = READERS.find((candidate) => candidate.is(bytes));
  if (!reader) return null;
  const read = reader.read(bytes);
  if (!("reason" in read)) return { format: reader.format, header: read };
  return {
    format: reader.format,
    fault: read.truncated ? `it's truncated: ${read.reason}` : read.reason,
  };
}
