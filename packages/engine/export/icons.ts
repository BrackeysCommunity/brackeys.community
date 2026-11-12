import { TEXTURE_KIND, type TextureMeta } from "../project/kinds/texture";
import { formatProjectFile } from "../project/project-file";
import type { AssetId, ProjectFile, ProjectView, Sha256 } from "../project/types";
import { makeIssue } from "../scene/issues";
import { locatePointer } from "../scene/parse";
import type { SceneIssue } from "../scene/types";
import { crc32 } from "./crc32";

/** The icon sizes a build ships. */
export type ExportIconSize = 192 | 512;

/** One shipped icon: the project's texture, or the engine's default. */
export type ExportIcon = {
  size: ExportIconSize;
  /** `icons/icon-<size>.png`. */
  file: string;
  source: { kind: "asset"; id: AssetId; sha256: Sha256; bytes: number } | { kind: "default" };
};

/** Where an icon of `size` ships in every build. */
export const iconFile = (size: ExportIconSize): string => `icons/icon-${size}.png`;

const ICON_SIZES = (): readonly ExportIconSize[] => [192, 512];

/** Why `id` can't be the `size` icon, or null when it is a PNG of exactly that size. */
function iconProblem(view: ProjectView, id: AssetId, size: ExportIconSize): string | null {
  const entry = view.byId.get(id);
  if (!entry) return `the project has no asset "${id}"`;
  if (entry.kind !== TEXTURE_KIND) return `"${id}" is a ${entry.kind}, not a texture`;
  if (entry.sha256 === undefined || entry.bytes === undefined)
    return `"${id}" has no content to ship`;
  const meta = entry.meta as Partial<TextureMeta> | undefined;
  if (meta?.format !== "png" || meta.width !== size || meta.height !== size) {
    const got =
      meta?.width !== undefined && meta.height !== undefined
        ? `a ${meta.width}×${meta.height} ${meta.format ?? "image"}`
        : "an image of unknown size";
    return `"${id}" is ${got}, not a ${size}×${size} PNG`;
  }
  return null;
}

/**
 * The project's `export.icons`, checked by meta (exactly a 192×192 or
 * 512×512 PNG); a named icon that isn't one falls back to the default with
 * `export-asset-missing` at warn. An omitted icon is the default, quietly.
 */
export function planIcons(input: { project: ProjectFile; view: ProjectView }): {
  icons: ExportIcon[];
  issues: SceneIssue[];
} {
  const named = input.project.export?.icons ?? {};
  const icons: ExportIcon[] = [];
  const issues: SceneIssue[] = [];
  let text: string | undefined;
  for (const size of ICON_SIZES()) {
    const file = iconFile(size);
    const id = named[`${size}`];
    const problem = id === undefined ? null : iconProblem(input.view, id, size);
    if (id !== undefined && problem === null) {
      const entry = input.view.byId.get(id)!;
      icons.push({
        size,
        file,
        source: { kind: "asset", id, sha256: entry.sha256!, bytes: entry.bytes! },
      });
      continue;
    }
    icons.push({ size, file, source: { kind: "default" } });
    if (id === undefined || problem === null) continue;
    text ??= formatProjectFile(input.project);
    const path = `/export/icons/${size}`;
    const line = locatePointer(text, path);
    issues.push(
      makeIssue("export-asset-missing", {
        severity: "warn",
        message: `${file} falls back to the default: export.icons.${size} names ${problem}`,
        path,
        ...(line === undefined ? {} : { line }),
        entityIds: [id],
        expected: `a ${size}×${size} PNG texture`,
        got: id,
      }),
    );
  }
  return { icons, issues };
}

// ─── The default icons ───────────────────────────────────

/** Background, disc, and the play mark cut out of the disc. */
const PALETTE = (): readonly [number, number, number][] => [
  [0x1b, 0x1f, 0x2a],
  [0xf2, 0xb3, 0x3d],
];

/**
 * One palette index per pixel, row by row: a disc on the background with a
 * play triangle cut out of it. Integer geometry on doubled coordinates, so
 * every size draws the same shape on every runtime.
 */
function iconPixels(size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const r = Math.floor((size * 72) / 100);
  const left = -Math.floor((size * 22) / 100);
  const right = Math.floor((size * 30) / 100);
  const half = Math.floor((size * 30) / 100);
  for (let y = 0; y < size; y++) {
    const dy = 2 * y + 1 - size;
    for (let x = 0; x < size; x++) {
      const dx = 2 * x + 1 - size;
      const disc = dx * dx + dy * dy <= r * r;
      const play =
        dx >= left && dx <= right && Math.abs(dy) * (right - left) <= (right - dx) * half;
      out[y * size + x] = disc && !play ? 1 : 0;
    }
  }
  return out;
}

/** Writes bits least significant first, as deflate packs them. */
class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private count = 0;

  bits(value: number, n: number): void {
    for (let i = 0; i < n; i++) this.push((value >>> i) & 1);
  }

  /** A Huffman code, most significant bit first. */
  code(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.push((value >>> i) & 1);
  }

  private push(bit: number): void {
    this.acc |= bit << this.count;
    if (++this.count === 8) {
      this.bytes.push(this.acc);
      this.acc = 0;
      this.count = 0;
    }
  }

  finish(): Uint8Array {
    if (this.count > 0) this.bytes.push(this.acc);
    return Uint8Array.from(this.bytes);
  }
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
] as const;
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
] as const;
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
] as const;
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
] as const;

/** The fixed Huffman code of a literal/length symbol. */
function litLen(w: BitWriter, symbol: number): void {
  if (symbol < 144) w.code(0x30 + symbol, 8);
  else if (symbol < 256) w.code(0x190 + symbol - 144, 9);
  else if (symbol < 280) w.code(symbol - 256, 7);
  else w.code(0xc0 + symbol - 280, 8);
}

/** The last index of `table` whose value is at most `value`. */
function slot(table: readonly number[], value: number): number {
  let i = table.length - 1;
  while (table[i]! > value) i--;
  return i;
}

/**
 * One final fixed-Huffman deflate block. Matches are found greedily at two
 * distances, the pixel before and the row above, which is all a flat-colour
 * image needs; anything else is a literal.
 */
function deflateFixed(data: Uint8Array, stride: number): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1);
  w.bits(1, 2);
  let i = 0;
  while (i < data.length) {
    let best = 0;
    let bestDist = 0;
    for (const dist of [1, stride]) {
      if (dist > i) continue;
      let n = 0;
      while (n < 258 && i + n < data.length && data[i + n] === data[i + n - dist]) n++;
      if (n > best) {
        best = n;
        bestDist = dist;
      }
    }
    if (best < 3) {
      litLen(w, data[i]!);
      i++;
      continue;
    }
    const l = slot(LENGTH_BASE, best);
    litLen(w, 257 + l);
    w.bits(best - LENGTH_BASE[l]!, LENGTH_EXTRA[l]!);
    const d = slot(DIST_BASE, bestDist);
    w.code(d, 5);
    w.bits(bestDist - DIST_BASE[d]!, DIST_EXTRA[d]!);
    i += best;
  }
  litLen(w, 256);
  return w.finish();
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

function chunk(type: string, body: Uint8Array): number[] {
  const typed = new Uint8Array(4 + body.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(body, 4);
  return [...u32(body.length), ...typed, ...u32(crc32(typed))];
}

/** The engine's default icon of `size`: an 8-bit palette PNG built in code, byte-identical on every run. */
export function defaultIconPng(size: ExportIconSize): Uint8Array {
  const pixels = iconPixels(size);
  const stride = size + 1;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) raw.set(pixels.subarray(y * size, (y + 1) * size), y * stride + 1);
  const zlib = [0x78, 0x01, ...deflateFixed(raw, stride), ...u32(adler32(raw))];
  const header = Uint8Array.from([...u32(size), ...u32(size), 8, 3, 0, 0, 0]);
  const palette = Uint8Array.from(PALETTE().flat());
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...chunk("PLTE", palette),
    ...chunk("IDAT", Uint8Array.from(zlib)),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}
