import { Readable } from "node:stream";

import type { ReleaseFile } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import {
  checkLeadingBytes,
  contentTypeFor,
  memoryReleaseStore,
  minioReleaseStoreFor,
  refusedReleaseFile,
  type ReleaseObjectClient,
} from "../release-storage";

type Role = ReleaseFile["role"];

const hash = "c".repeat(64);
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const pad = [0, 0, 0, 0];

/** Every extension the site takes for an asset: its type and a body with the right signature. */
const ASSETS: [ext: string, type: string, head: Uint8Array][] = [
  [".png", "image/png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
  [".jpg", "image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
  [".jpeg", "image/jpeg", bytes([0xff, 0xd8, 0xff, 0xdb])],
  [".webp", "image/webp", bytes("RIFF", pad, "WEBPVP8 ")],
  [".gif", "image/gif", bytes("GIF89a")],
  [".ogg", "audio/ogg", bytes("OggS", [0])],
  [".mp3", "audio/mpeg", bytes("ID3", [4, 0])],
  [".wav", "audio/wav", bytes("RIFF", pad, "WAVEfmt ")],
  [".m4a", "audio/mp4", bytes(pad, "ftypM4A ")],
  [".flac", "audio/flac", bytes("fLaC")],
  [".webm", "audio/webm", bytes([0x1a, 0x45, 0xdf, 0xa3])],
  [".woff2", "font/woff2", bytes("wOF2")],
  [".woff", "font/woff", bytes("wOFF")],
  [".ttf", "font/ttf", bytes([0, 1, 0, 0])],
  [".otf", "font/otf", bytes("OTTO")],
  [".json", "application/json", bytes('{"frames":{}}')],
  [".txt", "text/plain", bytes("hello")],
  [".fnt", "text/plain", bytes("info face=x")],
];

/** The fixed paths and folders of the other roles. */
const OTHERS: [path: string, role: Role, type: string, head: Uint8Array][] = [
  ["index.html", "shell", "text/html", bytes("<!doctype html>")],
  ["credits.html", "shell", "text/html", bytes("<!doctype html>")],
  ["app.webmanifest", "shell", "application/manifest+json", bytes("{}")],
  ["sw.js", "worker", "text/javascript", bytes("self")],
  ["code/index-B3xY.js", "code", "text/javascript", bytes("export")],
  ["code/chunks/a.mjs", "code", "text/javascript", bytes("export")],
  ["code/style.css", "style", "text/css", bytes("body{}")],
  ["code/rapier.wasm", "wasm", "application/wasm", bytes([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])],
  ["icons/icon-192.png", "icon", "image/png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
  ["icons/icon-512.png", "icon", "image/png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
  [`data/${hash}.json`, "data", "application/json", bytes('{"version":4}')],
];

describe("contentTypeFor and checkLeadingBytes", () => {
  it("type and check every asset extension", () => {
    for (const [ext, type, head] of ASSETS) {
      const path = `assets/${hash}${ext}`;
      expect(contentTypeFor(path, "asset"), path).toBe(type);
      expect(checkLeadingBytes(path, head), path).toBe(true);
    }
  });

  it("type and check every other role's files", () => {
    for (const [path, role, type, head] of OTHERS) {
      expect(contentTypeFor(path, role), path).toBe(type);
      expect(checkLeadingBytes(path, head), path).toBe(true);
    }
  });

  it("take an MP3 by its frame sync as well as its ID3 tag", () => {
    expect(checkLeadingBytes(`assets/${hash}.mp3`, bytes([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
    expect(checkLeadingBytes(`assets/${hash}.mp3`, bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(checkLeadingBytes(`assets/${hash}.mp3`, bytes([0xff, 0xe9, 0, 0]))).toBe(false);
  });

  it("refuse SVG and any HTML besides index.html and credits.html", () => {
    expect(contentTypeFor(`assets/${hash}.svg`, "asset")).toBeNull();
    expect(contentTypeFor("icons/icon.svg", "icon")).toBeNull();
    expect(checkLeadingBytes(`assets/${hash}.svg`, bytes("<svg"))).toBe(false);
    for (const path of ["about.html", "code/index.html", `assets/${hash}.html`, "Index.html"]) {
      for (const role of ["shell", "code", "asset"] as const) {
        expect(contentTypeFor(path, role), `${path} as ${role}`).toBeNull();
      }
    }
  });

  it("refuse a file outside its role's folder or name", () => {
    expect(contentTypeFor("index.html", "code")).toBeNull();
    expect(contentTypeFor("main.js", "code")).toBeNull();
    expect(contentTypeFor("code/main.js", "worker")).toBeNull();
    expect(contentTypeFor("code/style.css", "code")).toBeNull();
    expect(contentTypeFor("icons/icon-64.png", "icon")).toBeNull();
    expect(contentTypeFor("data/not-a-hash.json", "data")).toBeNull();
    expect(contentTypeFor(`data/${hash}.txt`, "data")).toBeNull();
    expect(contentTypeFor(`assets/${hash.toUpperCase()}.png`, "asset")).toBeNull();
    expect(contentTypeFor(`assets/${hash}.PNG`, "asset")).toBeNull();
    expect(contentTypeFor(`assets/${hash}`, "asset")).toBeNull();
    expect(contentTypeFor(`assets/${hash}.exe`, "asset")).toBeNull();
    expect(contentTypeFor("code/../index.js", "code")).toBeNull();
    expect(contentTypeFor("code//a.js", "code")).toBeNull();
    expect(contentTypeFor("code\\a.js", "code")).toBeNull();
  });

  it("refuse a PNG body under .ogg and other mismatched signatures", () => {
    const png = ASSETS[0]![2];
    expect(checkLeadingBytes(`assets/${hash}.ogg`, png)).toBe(false);
    expect(checkLeadingBytes(`assets/${hash}.wav`, bytes("RIFF", pad, "WEBP"))).toBe(false);
    expect(checkLeadingBytes(`assets/${hash}.png`, bytes("<html>"))).toBe(false);
    expect(checkLeadingBytes("code/a.wasm", png)).toBe(false);
    expect(checkLeadingBytes(`assets/${hash}.png`, bytes([0x89]))).toBe(false);
  });

  it("refuse JSON that doesn't parse or isn't UTF-8", () => {
    expect(checkLeadingBytes(`data/${hash}.json`, bytes("{nope"))).toBe(false);
    expect(checkLeadingBytes(`data/${hash}.json`, bytes([0x7b, 0xff, 0x7d]))).toBe(false);
  });
});

describe("refusedReleaseFile", () => {
  it("names the first refused file, or a path differing from another only in case", () => {
    const shell = { path: "index.html", role: "shell" } as const;
    expect(refusedReleaseFile([shell, { path: "code/a.js", role: "code" }])).toBeNull();
    expect(refusedReleaseFile([shell, { path: "about.html", role: "shell" }])).toBe("about.html");
    expect(
      refusedReleaseFile([
        { path: "code/A.js", role: "code" },
        { path: "code/a.js", role: "code" },
      ]),
    ).toBe("code/a.js");
  });
});

const read = async (stream: ReadableStream<Uint8Array> | null) =>
  stream ? new TextDecoder().decode(await new Response(stream).arrayBuffer()) : null;

describe("memoryReleaseStore", () => {
  it("stats, streams a range, and removes, with a missing object no error", async () => {
    const store = memoryReleaseStore();
    await store.put("k", bytes("0123456789"), "text/plain");
    expect(await store.stat("k")).toMatchObject({ size: 10 });
    expect(await read(await store.stream("k"))).toBe("0123456789");
    expect(await read(await store.stream("k", { start: 2, end: 4 }))).toBe("234");
    await store.remove("k");
    await store.remove("k");
    expect(await store.stat("k")).toBeNull();
    expect(await store.stream("k")).toBeNull();
  });
});

describe("minioReleaseStoreFor", () => {
  it("puts with its type, streams ranges and treats a missing object as no error", async () => {
    const objects = new Map<string, { body: Buffer; meta: Record<string, string> }>();
    const missing = () => Object.assign(new Error("gone"), { code: "NoSuchKey" });
    const client: ReleaseObjectClient = {
      async putObject(_b, key, body, _size, meta) {
        objects.set(key, { body, meta });
      },
      async statObject(_b, key) {
        const object = objects.get(key);
        if (!object) throw missing();
        return { size: object.body.byteLength, metaData: object.meta };
      },
      async getObject(_b, key) {
        const object = objects.get(key);
        if (!object) throw missing();
        return Readable.from([object.body]);
      },
      async getPartialObject(_b, key, offset, length) {
        const object = objects.get(key);
        if (!object) throw missing();
        return Readable.from([object.body.subarray(offset, offset + (length ?? Infinity))]);
      },
      async removeObject(_b, key) {
        if (!objects.delete(key)) throw missing();
      },
    };
    const store = minioReleaseStoreFor({ client, bucket: "site" });
    const key = `engine-releases/kitchen/${hash}`;
    await store.put(key, bytes("abcdef"), "audio/ogg");
    expect(objects.get(key)?.meta).toEqual({ "Content-Type": "audio/ogg" });
    expect(await store.stat(key)).toMatchObject({ size: 6 });
    expect(await read(await store.stream(key, { start: 1, end: 3 }))).toBe("bcd");
    expect(await read(await store.stream(key))).toBe("abcdef");
    await store.remove(key);
    await store.remove(key);
    expect(await store.stat(key)).toBeNull();
    expect(await store.stream(key)).toBeNull();
  });
});
