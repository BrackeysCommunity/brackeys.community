// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 as zlibCrc32 } from "node:zlib";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { crc32 } from "../export/crc32";
import { zipFiles } from "../export/zip";

const text = (s: string) => new TextEncoder().encode(s);

const FILES = [
  { path: "release.json", bytes: text('{ "kind": "release" }\n') },
  { path: "index.html", bytes: text("<!doctype html><title>Game</title>") },
  { path: "code/main-3f9a1c.js", bytes: text("console.log('game');\n".repeat(50)) },
  {
    path: "assets/1b-tiles.png",
    bytes: Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) % 256),
  },
  { path: "credits.html", bytes: new Uint8Array(0) },
];

const SORTED = FILES.map((f) => f.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

type Entry = {
  name: string;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  size: number;
  extra: number;
};

/** The central directory's entries, read straight from the bytes. */
function centralEntries(zip: Uint8Array): Entry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    out.push({
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      extra,
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

describe("zipFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "jams-zip-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a zip unzip reads, whose CRCs Node's zlib agrees with", () => {
    const file = join(dir, "build.zip");
    writeFileSync(file, zipFiles(FILES));
    const listed = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(listed).toEqual(SORTED);
    const tested = execFileSync("unzip", ["-tq", file], { encoding: "utf8" });
    expect(tested).toMatch(/No errors detected/);
    const long = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
    for (const f of FILES) expect(long).toContain(f.path);

    const entries = centralEntries(zipFiles(FILES));
    for (const f of FILES) {
      const entry = entries.find((e) => e.name === f.path)!;
      expect(crc32(f.bytes), f.path).toBe(zlibCrc32(f.bytes));
      expect(entry.crc, f.path).toBe(zlibCrc32(f.bytes));
      expect(entry.size).toBe(f.bytes.length);
    }
  }, 30_000);

  it("gives equal bytes for one input, whatever its order", () => {
    const a = zipFiles(FILES);
    expect(zipFiles(FILES)).toEqual(a);
    expect(zipFiles([...FILES].reverse())).toEqual(a);
  });

  it("stores every entry sorted by path, at 1980-01-01 00:00, with no extra fields", () => {
    const entries = centralEntries(zipFiles(FILES));
    expect(entries.map((e) => e.name)).toEqual(SORTED);
    for (const e of entries) {
      expect(e.method, e.name).toBe(0);
      expect(e.time, e.name).toBe(0);
      expect(e.date, e.name).toBe((1 << 5) | 1);
      expect(e.extra, e.name).toBe(0);
    }
  });

  it("writes names as UTF-8 and flags them so", () => {
    const [entry] = centralEntries(zipFiles([{ path: "assets/ä.png", bytes: text("x") }]));
    expect(entry?.name).toBe("assets/ä.png");
    expect(entry!.flags & 0x0800).toBe(0x0800);
  });

  it("refuses a path listed twice", () => {
    expect(() => zipFiles([...FILES, { path: "index.html", bytes: text("") }])).toThrow(/twice/);
  });

  it("zips nothing into an empty archive", () => {
    const empty = zipFiles([]);
    expect(empty.length).toBe(22);
    expect(centralEntries(empty)).toEqual([]);
  });
});
