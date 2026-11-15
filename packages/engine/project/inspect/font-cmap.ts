import { u16be, u32be, u8 } from "./bytes";

/** Inclusive code point ranges, ascending, neither overlapping nor touching. */
export type CodePointRanges = [from: number, to: number][];

const MAX_CODE_POINT = 0x10ffff;

/** `ranges` sorted, clamped to Unicode and coalesced where they overlap or touch. */
export function mergeRanges(ranges: readonly (readonly [number, number])[]): CodePointRanges {
  const sorted = ranges
    .map(([from, to]): [number, number] => [Math.max(0, from), Math.min(to, MAX_CODE_POINT)])
    .filter(([from, to]) => from <= to)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: CodePointRanges = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** The ranges a set of code points makes. */
export function codePointRanges(codePoints: Iterable<number>): CodePointRanges {
  const points = [...codePoints].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const cp of points) pushPoint(runs, cp);
  return mergeRanges(runs);
}

function pushPoint(runs: [number, number][], cp: number): void {
  const last = runs[runs.length - 1];
  if (last && last[1] === cp - 1) last[1] = cp;
  else if (!last || last[1] !== cp) runs.push([cp, cp]);
}

/** Unicode subtables only: platform 0 (bar its variation sequences), or Windows' BMP and full-repertoire encodings. */
const isUnicode = (platform: number, encoding: number) =>
  (platform === 0 && encoding !== 5) || (platform === 3 && (encoding === 1 || encoding === 10));

/** Code points a byte- or word-indexed glyph array maps to a real glyph (not glyph 0). */
function glyphArrayRuns(
  cmap: Uint8Array,
  first: number,
  count: number,
  at: number,
  width: 1 | 2,
): [number, number][] | null {
  if (at + count * width > cmap.length) return null;
  const runs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const glyph = width === 1 ? u8(cmap, at + i) : u16be(cmap, at + i * 2);
    if (glyph !== 0) pushPoint(runs, first + i);
  }
  return runs;
}

function format4(cmap: Uint8Array, at: number): [number, number][] | null {
  const segX2 = u16be(cmap, at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  if (segX2 % 2 !== 0 || rangeOffsets + segX2 > cmap.length) return null;
  const runs: [number, number][] = [];
  for (let seg = 0; seg < segX2; seg += 2) {
    const start = u16be(cmap, starts + seg);
    const end = u16be(cmap, ends + seg);
    const delta = u16be(cmap, deltas + seg);
    const rangeOffset = u16be(cmap, rangeOffsets + seg);
    if (start > end || start === 0xffff) continue;
    for (let cp = start; cp <= end; cp++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const slot = rangeOffsets + seg + rangeOffset + 2 * (cp - start);
        glyph = slot + 2 > cmap.length ? 0 : u16be(cmap, slot);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) pushPoint(runs, cp);
    }
  }
  return runs;
}

function groups(cmap: Uint8Array, at: number, manyToOne: boolean): [number, number][] | null {
  const count = u32be(cmap, at + 12);
  if (at + 16 + count * 12 > cmap.length) return null;
  const runs: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const group = at + 16 + i * 12;
    const start = u32be(cmap, group);
    const end = u32be(cmap, group + 4);
    const glyph = u32be(cmap, group + 8);
    if (manyToOne && glyph === 0) continue;
    runs.push([!manyToOne && glyph === 0 ? start + 1 : start, end]);
  }
  return runs;
}

function subtableRanges(cmap: Uint8Array, at: number): [number, number][] | null {
  if (at + 4 > cmap.length) return null;
  switch (u16be(cmap, at)) {
    case 0:
      return glyphArrayRuns(cmap, 0, 256, at + 6, 1);
    case 4:
      return format4(cmap, at);
    case 6:
      return glyphArrayRuns(cmap, u16be(cmap, at + 6), u16be(cmap, at + 8), at + 10, 2);
    case 10:
      return glyphArrayRuns(cmap, u32be(cmap, at + 12), u32be(cmap, at + 16), at + 20, 2);
    case 12:
      return groups(cmap, at, false);
    case 13:
      return groups(cmap, at, true);
    default:
      return null;
  }
}

/**
 * The code points an sfnt `cmap` table maps to a glyph, merged over its
 * Unicode subtables. Null when it has no Unicode subtable this can read,
 * so the face's coverage stays unknown rather than empty.
 */
export function cmapCoverage(cmap: Uint8Array): CodePointRanges | null {
  if (!(cmap instanceof Uint8Array) || cmap.length < 4 || u16be(cmap, 0) !== 0) return null;
  const records = u16be(cmap, 2);
  if (4 + records * 8 > cmap.length) return null;
  const read = new Set<number>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < records; i++) {
    const record = 4 + i * 8;
    const at = u32be(cmap, record + 4);
    if (!isUnicode(u16be(cmap, record), u16be(cmap, record + 2)) || read.has(at)) continue;
    const runs = subtableRanges(cmap, at);
    if (!runs) continue;
    read.add(at);
    for (const run of runs) ranges.push(run);
  }
  return read.size === 0 ? null : mergeRanges(ranges);
}
