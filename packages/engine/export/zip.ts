import { byCodeUnit } from "../project/kinds/define";
import { crc32 } from "./crc32";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Version 1.0: stored entries, no directories, no zip64. */
const VERSION = 10;
/** General-purpose bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
/** DOS date 1980-01-01 (year 0, month 1, day 1); the time is 00:00:00. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

/**
 * Stored entries, sorted by path, DOS time 1980-01-01 00:00, no extra
 * fields, CRC-32 in TypeScript: the same files give the same bytes on every
 * runtime. Throws on a duplicate path or a zip that would need zip64.
 */
export function zipFiles(files: readonly { path: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const sorted = [...files].sort((a, b) => byCodeUnit(a.path, b.path));
  if (sorted.length > MAX_U16) throw new Error(`zipFiles: ${sorted.length} files need zip64`);
  const entries = sorted.map((file, i) => {
    if (i > 0 && sorted[i - 1]!.path === file.path)
      throw new Error(`zipFiles: "${file.path}" is listed twice`);
    const name = encoder.encode(file.path);
    if (name.length > MAX_U16) throw new Error(`zipFiles: "${file.path}" is too long a name`);
    if (file.bytes.length > MAX_U32) throw new Error(`zipFiles: "${file.path}" needs zip64`);
    return { name, bytes: file.bytes, crc: crc32(file.bytes), offset: 0 };
  });

  let localSize = 0;
  for (const e of entries) {
    e.offset = localSize;
    localSize += 30 + e.name.length + e.bytes.length;
  }
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  if (localSize + centralSize > MAX_U32) throw new Error("zipFiles: the archive needs zip64");

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(at, v, true);
    at += 4;
  };
  const put = (bytes: Uint8Array) => {
    out.set(bytes, at);
    at += bytes.length;
  };
  /** The fields a local header and a central header share, from "version needed" to the extra length. */
  const common = (e: (typeof entries)[number]) => {
    u16(VERSION);
    u16(UTF8_NAMES);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(e.crc);
    u32(e.bytes.length);
    u32(e.bytes.length);
    u16(e.name.length);
    u16(0);
  };

  for (const e of entries) {
    u32(LOCAL_HEADER);
    common(e);
    put(e.name);
    put(e.bytes);
  }
  for (const e of entries) {
    u32(CENTRAL_HEADER);
    u16(VERSION);
    common(e);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(e.offset);
    put(e.name);
  }
  u32(END_OF_CENTRAL);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(localSize);
  u16(0);
  return out;
}
