import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { parseAsepriteJson } from "../inspect/aseprite";
import { atlasImage, atlasTool, type AtlasSheet } from "../inspect/atlas";
import { readAudioFormat } from "../inspect/audio";
import { parseBmfont } from "../inspect/bmfont";
import { readFontFormat } from "../inspect/font";
import { readGifSize } from "../inspect/gif";
import { readJpegSize } from "../inspect/jpeg";
import { siblingPath } from "../inspect/paths";
import { readPngSize } from "../inspect/png";
import { utf8Json, utf8Text } from "../inspect/text";
import { parseTexturePackerJson } from "../inspect/texturepacker";
import { readWebpSize } from "../inspect/webp";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const fixtureText = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const fixtureJson = (name: string): unknown => JSON.parse(fixtureText(name));

const BINARY = [
  "texture.png",
  "texture.jpg",
  "texture.webp",
  "texture-lossless.webp",
  "texture-alpha.webp",
  "texture.gif",
  "hero.png",
  "items.png",
  "font_0.png",
  "tone.ogg",
  "tone.wav",
  "tone.mp3",
  "tone.m4a",
];

const IMAGE_READERS = {
  png: readPngSize,
  jpeg: readJpegSize,
  webp: readWebpSize,
  gif: readGifSize,
};

function readerFor(name: string): keyof typeof IMAGE_READERS | null {
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg")) return "jpeg";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".gif")) return "gif";
  return null;
}

/** mulberry32: a small seeded generator, so a failing case reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("image header readers", () => {
  it.each([
    ["texture.png", readPngSize, 12, 10],
    ["hero.png", readPngSize, 32, 8],
    ["items.png", readPngSize, 16, 16],
    ["font_0.png", readPngSize, 16, 16],
    ["texture.jpg", readJpegSize, 20, 14],
    ["texture.webp", readWebpSize, 18, 6],
    ["texture-lossless.webp", readWebpSize, 12, 10],
    ["texture-alpha.webp", readWebpSize, 9, 7],
    ["texture.gif", readGifSize, 7, 5],
  ] as const)("%s is %ix%i", (name, read, width, height) => {
    expect(read(fixture(name))).toEqual({ width, height });
  });

  it("each reader refuses every other format's fixture", () => {
    for (const name of BINARY) {
      const own = readerFor(name);
      for (const [format, read] of Object.entries(IMAGE_READERS)) {
        if (format === own) continue;
        expect(read(fixture(name)), `${format} on ${name}`).toBeNull();
      }
    }
  });

  it("reads the size from a subarray view, not the start of its buffer", () => {
    const png = fixture("texture.png");
    const padded = new Uint8Array(png.length + 5);
    padded.set(png, 5);
    expect(readPngSize(padded.subarray(5))).toEqual({ width: 12, height: 10 });
  });

  it("refuses zero dimensions", () => {
    const gif = fixture("texture.gif");
    gif[6] = 0;
    gif[7] = 0;
    expect(readGifSize(gif)).toBeNull();
    const png = fixture("texture.png");
    png.fill(0, 16, 20);
    expect(readPngSize(png)).toBeNull();
  });

  it("refuses a PNG whose first chunk isn't IHDR", () => {
    const png = fixture("texture.png");
    png[12] = "X".charCodeAt(0);
    expect(readPngSize(png)).toBeNull();
  });

  it("skips JPEG fill bytes and stops at the scan when no frame header came first", () => {
    const jpeg = fixture("texture.jpg");
    const filled = new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...jpeg.subarray(2)]);
    expect(readJpegSize(filled)).toEqual({ width: 20, height: 14 });
    const sos = [0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x05];
    expect(readJpegSize(new Uint8Array([...sos, 0x00, 0x07, 0x03]))).toBeNull();
  });

  it("reads a progressive JPEG's SOF2", () => {
    const sof2 = [0xff, 0xd8, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03];
    expect(readJpegSize(new Uint8Array(sof2))).toEqual({ width: 600, height: 300 });
  });

  it("refuses a lossy WebP whose first frame is an interframe", () => {
    const webp = fixture("texture.webp");
    webp[20] = (webp[20] ?? 0) | 1;
    expect(readWebpSize(webp)).toBeNull();
  });
});

const HERO: AtlasSheet = {
  frames: {
    "hero 0.aseprite": { x: 0, y: 0, w: 8, h: 8, durationMs: 100 },
    "hero 1.aseprite": { x: 8, y: 0, w: 8, h: 8, durationMs: 100 },
    "hero 2.aseprite": { x: 16, y: 0, w: 8, h: 8, durationMs: 150 },
    "hero 3.aseprite": { x: 24, y: 0, w: 8, h: 8, durationMs: 200 },
  },
  tags: [
    { name: "idle", from: 0, to: 1, direction: "forward" },
    { name: "walk", from: 1, to: 3, direction: "pingpong" },
    { name: "rewind", from: 0, to: 3, direction: "reverse" },
  ],
  slices: [
    { name: "panel", frame: "hero 0.aseprite", x: 1, y: 1, w: 6, h: 6, center: [2, 2, 2, 2] },
    { name: "hitbox", frame: "hero 0.aseprite", x: 2, y: 1, w: 4, h: 7 },
    { name: "hitbox", frame: "hero 2.aseprite", x: 1, y: 1, w: 6, h: 7 },
  ],
  order: ["hero 0.aseprite", "hero 1.aseprite", "hero 2.aseprite", "hero 3.aseprite"],
};

const ITEMS: AtlasSheet = {
  frames: {
    "coin.png": { x: 0, y: 0, w: 8, h: 8, pivot: [0.5, 0.5] },
    "gem.png": { x: 8, y: 0, w: 8, h: 8, pivot: [0.5, 1] },
    "panel.png": { x: 0, y: 8, w: 12, h: 8 },
  },
  tags: [{ name: "spin", from: 0, to: 1, direction: "forward" }],
  slices: [
    { name: "panel.png", frame: "panel.png", x: 0, y: 0, w: 12, h: 8, center: [3, 2, 6, 4] },
  ],
  order: ["coin.png", "gem.png", "panel.png"],
};

type Frames = Record<string, Record<string, unknown>>;

/** The other JSON export form of the same sheet. */
function toArrayForm(json: unknown): unknown {
  const sheet = json as { frames: Frames };
  return {
    ...sheet,
    frames: Object.entries(sheet.frames).map(([filename, f]) => ({ filename, ...f })),
  };
}

function toHashForm(json: unknown): unknown {
  const sheet = json as { frames: ({ filename: string } & Record<string, unknown>)[] };
  return {
    ...sheet,
    frames: Object.fromEntries(sheet.frames.map(({ filename, ...f }) => [filename, f])),
  };
}

describe("parseAsepriteJson", () => {
  it("reads the sheet's frames, tags, slices and order in both export forms", () => {
    const hash = fixtureJson("hero.json");
    expect(parseAsepriteJson(hash)).toEqual(HERO);
    expect(parseAsepriteJson(toArrayForm(hash))).toEqual(HERO);
  });

  it("names its tool and texture", () => {
    expect(atlasTool(fixtureJson("hero.json"))).toBe("aseprite");
    expect(atlasImage(fixtureJson("hero.json"))).toBe("hero.png");
  });

  it("keeps file order, frame names that look like indices or prototype keys included", () => {
    const json = {
      frames: [
        { filename: "b", frame: { x: 0, y: 0, w: 1, h: 1 } },
        { filename: "__proto__", frame: { x: 1, y: 0, w: 1, h: 1 } },
        { filename: "a", frame: { x: 2, y: 0, w: 1, h: 1 } },
      ],
    };
    const sheet = parseAsepriteJson(json);
    expect(sheet?.order).toEqual(["b", "__proto__", "a"]);
    expect(Object.keys(sheet?.frames ?? {})).toEqual(["b", "__proto__", "a"]);
    expect(Object.getPrototypeOf(sheet?.frames)).toBe(Object.prototype);
  });

  it("reads reverse ping-pong as ping-pong over the same frames", () => {
    const json = fixtureJson("hero.json") as { meta: { frameTags: { direction: string }[] } };
    json.meta.frameTags[1]!.direction = "pingpong_reverse";
    expect(parseAsepriteJson(json)?.tags[1]).toEqual({
      name: "walk",
      from: 1,
      to: 3,
      direction: "pingpong",
    });
  });

  it.each([
    ["a tag past the last frame", (j: any) => (j.meta.frameTags[0].to = 4)],
    ["a tag running backwards", (j: any) => (j.meta.frameTags[0].from = 2)],
    ["an unknown direction", (j: any) => (j.meta.frameTags[0].direction = "sideways")],
    ["a slice key past the last frame", (j: any) => (j.meta.slices[0].keys[0].frame = 9)],
    ["a rotated frame", (j: any) => (j.frames["hero 1.aseprite"].rotated = true)],
    ["a fractional rect", (j: any) => (j.frames["hero 1.aseprite"].frame.x = 0.5)],
    ["a missing frame rect", (j: any) => delete j.frames["hero 1.aseprite"].frame],
    ["frames that aren't a list or a map", (j: any) => (j.frames = "hero")],
  ])("refuses %s", (_, mutate) => {
    const json = fixtureJson("hero.json");
    mutate(json);
    expect(parseAsepriteJson(json)).toBeNull();
  });

  it("refuses a repeated frame name in the array form", () => {
    const json = toArrayForm(fixtureJson("hero.json")) as { frames: { filename: string }[] };
    json.frames[1]!.filename = json.frames[0]!.filename;
    expect(parseAsepriteJson(json)).toBeNull();
  });
});

describe("parseTexturePackerJson", () => {
  it("reads pivots, animations and nine-slice borders in both export forms", () => {
    const array = fixtureJson("items.json");
    expect(parseTexturePackerJson(array)).toEqual(ITEMS);
    expect(parseTexturePackerJson(toHashForm(array))).toEqual(ITEMS);
  });

  it("names its tool and texture", () => {
    expect(atlasTool(fixtureJson("items.json"))).toBe("texturepacker");
    expect(atlasImage(fixtureJson("items.json"))).toBe("items.png");
    expect(atlasTool({ meta: {} })).toBeNull();
    expect(atlasImage({ frames: {} })).toBeNull();
  });

  it("reads a PixiJS anchor, a Phaser scale9Borders and a descending animation", () => {
    const json = fixtureJson("items.json") as any;
    delete json.frames[0].pivot;
    json.frames[0].anchor = { x: 0.25, y: 0.75 };
    delete json.frames[2].borders;
    json.frames[2].scale9Enabled = true;
    json.frames[2].scale9Borders = { x: 4, y: 1, w: 4, h: 6 };
    json.animations = { back: ["panel.png", "gem.png", "coin.png"] };
    const sheet = parseTexturePackerJson(json);
    expect(sheet?.frames["coin.png"]?.pivot).toEqual([0.25, 0.75]);
    expect(sheet?.slices).toEqual([
      { name: "panel.png", frame: "panel.png", x: 0, y: 0, w: 12, h: 8, center: [4, 1, 4, 6] },
    ]);
    expect(sheet?.tags).toEqual([{ name: "back", from: 0, to: 2, direction: "reverse" }]);
  });

  it("leaves out an animation that skips frames, which a tag's range can't hold", () => {
    const json = fixtureJson("items.json") as any;
    json.animations = { blink: ["coin.png", "panel.png"], spin: ["coin.png", "gem.png"] };
    expect(parseTexturePackerJson(json)?.tags).toEqual([
      { name: "spin", from: 0, to: 1, direction: "forward" },
    ]);
  });

  it("ignores packer-only fields when reading as Aseprite", () => {
    const sheet = parseAsepriteJson(fixtureJson("items.json"));
    expect(sheet?.tags).toEqual([]);
    expect(sheet?.slices).toEqual([]);
  });

  it.each([
    ["an animation naming a missing frame", (j: any) => (j.animations.spin = ["coin.png", "x"])],
    ["borders wider than the frame", (j: any) => (j.frames[2].borders.left = 10)],
    ["a rotated frame", (j: any) => (j.frames[1].rotated = true)],
    ["animations that aren't a map", (j: any) => (j.animations = ["spin"])],
  ])("refuses %s", (_, mutate) => {
    const json = fixtureJson("items.json");
    mutate(json);
    expect(parseTexturePackerJson(json)).toBeNull();
  });
});

describe("parseBmfont", () => {
  it("reads the fixture's line height and page", () => {
    expect(parseBmfont(fixtureText("font.fnt"))).toEqual({ lineHeight: 9, pages: ["font_0.png"] });
  });

  it("orders pages by id and keeps spaces in quoted file names", () => {
    const text = [
      '﻿info face="A b" size=12',
      "common lineHeight=14 base=11 scaleW=64 scaleH=64 pages=2",
      'page id=1 file="font 1.png"',
      "page id=0 file=font_0.png",
    ].join("\r\n");
    expect(parseBmfont(text)).toEqual({ lineHeight: 14, pages: ["font_0.png", "font 1.png"] });
  });

  it.each([
    ["no common line", 'info face="x"\npage id=0 file="a.png"'],
    ["no pages", "common lineHeight=9 pages=0"],
    ["a page count that disagrees", 'common lineHeight=9 pages=2\npage id=0 file="a.png"'],
    ["a gap in page ids", 'common lineHeight=9\npage id=1 file="a.png"'],
    ["a repeated page id", 'common lineHeight=9\npage id=0 file="a"\npage id=0 file="b"'],
    ["an empty page file", 'common lineHeight=9\npage id=0 file=""'],
    ["a non-numeric line height", 'common lineHeight=big\npage id=0 file="a.png"'],
    ["a zero line height", 'common lineHeight=0\npage id=0 file="a.png"'],
    ["two common lines", 'common lineHeight=9\ncommon lineHeight=8\npage id=0 file="a"'],
    ["the XML variant", '<?xml version="1.0"?><font><common lineHeight="9" pages="1"/></font>'],
    ["the binary variant", "BMF\u0003\u0001"],
  ])("refuses %s", (_, text) => {
    expect(parseBmfont(text)).toBeNull();
  });
});

describe("readers never throw", () => {
  const fixtures = BINARY.map(fixture);
  const readers = Object.values(IMAGE_READERS);

  function checkImage(bytes: Uint8Array): void {
    for (const read of readers) {
      const size = read(bytes);
      if (size === null) continue;
      expect(Number.isInteger(size.width) && size.width > 0).toBe(true);
      expect(Number.isInteger(size.height) && size.height > 0).toBe(true);
    }
    expect([null, "ogg", "mp3", "wav", "m4a"]).toContain(readAudioFormat(bytes));
    expect([null, "woff2", "woff", "ttf", "otf"]).toContain(readFontFormat(bytes));
  }

  it("on every truncation of every fixture", () => {
    for (const bytes of fixtures) {
      for (let end = 0; end <= bytes.length; end++) checkImage(bytes.subarray(0, end));
    }
  });

  it("on random bytes and on fixtures with random bytes overwritten", () => {
    const next = rng(0x5eed);
    const byte = () => Math.floor(next() * 256);
    for (let i = 0; i < 2000; i++) {
      checkImage(Uint8Array.from({ length: Math.floor(next() * 64) }, byte));
      const base = fixtures[i % fixtures.length]!;
      const mutated = base.slice(0, Math.floor(next() * (base.length + 1)));
      for (let n = 0; n < 4; n++) mutated[Math.floor(next() * mutated.length)] = byte();
      checkImage(mutated);
    }
  });

  function randomJson(next: () => number, depth: number): unknown {
    const pick = Math.floor(next() * (depth > 3 ? 5 : 8));
    const keys = ["frames", "meta", "frame", "x", "y", "w", "h", "frameTags", "slices", "keys"];
    const key = () => keys[Math.floor(next() * keys.length)] ?? "x";
    switch (pick) {
      case 0:
        return null;
      case 1:
        return next() < 0.5;
      case 2:
        return [0, -1, 1.5, 2 ** 40, Number.NaN][Math.floor(next() * 5)];
      case 3:
        return ["", "forward", "pingpong_reverse", "__proto__"][Math.floor(next() * 4)];
      case 4:
        return Math.floor(next() * 8);
      case 5:
        return Array.from({ length: Math.floor(next() * 4) }, () => randomJson(next, depth + 1));
      default: {
        const out: Record<string, unknown> = {};
        for (let n = Math.floor(next() * 5); n > 0; n--) out[key()] = randomJson(next, depth + 1);
        return out;
      }
    }
  }

  /** Replaces one value somewhere inside `json` with `value`. */
  function graft(json: unknown, next: () => number, value: unknown): unknown {
    if (typeof json !== "object" || json === null || next() < 0.2) return value;
    const copy: any = Array.isArray(json) ? [...json] : { ...json };
    const keys = Object.keys(copy);
    const key = keys[Math.floor(next() * keys.length)];
    if (key === undefined) return value;
    copy[key] = graft(copy[key], next, value);
    return copy;
  }

  it("on random JSON and on fixture JSON with random values grafted in", () => {
    const next = rng(0xa71a5);
    const sheets = [fixtureJson("hero.json"), fixtureJson("items.json")];
    for (let i = 0; i < 3000; i++) {
      const json =
        i % 2 === 0
          ? randomJson(next, 0)
          : graft(sheets[i % 4 === 1 ? 0 : 1], next, randomJson(next, 2));
      for (const parse of [parseAsepriteJson, parseTexturePackerJson]) {
        const sheet = parse(json);
        if (sheet) expect(Object.keys(sheet.frames)).toEqual(sheet.order);
      }
      atlasImage(json);
      atlasTool(json);
    }
  });

  it("on truncated and random .fnt text", () => {
    const text = fixtureText("font.fnt");
    for (let end = 0; end <= text.length; end++) parseBmfont(text.slice(0, end));
    const next = rng(0xf0a7);
    const pool = [
      "common",
      "page",
      " ",
      "=",
      '"',
      "id",
      "file",
      "lineHeight",
      "pages",
      "\n",
      "0",
      "9",
    ];
    for (let i = 0; i < 2000; i++) {
      let s = "";
      for (let n = Math.floor(next() * 40); n > 0; n--) s += pool[Math.floor(next() * pool.length)];
      const font = parseBmfont(s);
      if (font) expect(font.pages.length).toBeGreaterThan(0);
    }
  });
});

describe("readAudioFormat", () => {
  it.each([
    ["tone.ogg", "ogg"],
    ["tone.wav", "wav"],
    ["tone.mp3", "mp3"],
    ["tone.m4a", "m4a"],
  ] as const)("%s is %s", (name, format) => {
    expect(readAudioFormat(fixture(name))).toBe(format);
  });

  it("refuses every image fixture", () => {
    for (const name of BINARY.filter((n) => !n.startsWith("tone.")))
      expect(readAudioFormat(fixture(name)), name).toBeNull();
  });

  it("refuses an MPEG-4 file with no audio brand, and an ftyp box longer than the file", () => {
    const m4a = fixture("tone.m4a");
    const video = m4a.slice();
    for (const at of [8, 16, 20, 24]) video.set([0x61, 0x76, 0x63, 0x31], at);
    expect(readAudioFormat(video)).toBeNull();
    expect(readAudioFormat(m4a.subarray(0, 20))).toBeNull();
  });
});

describe("readFontFormat", () => {
  const header = (tag: string | number[], length = 64) => {
    const bytes = new Uint8Array(length);
    bytes.set(typeof tag === "string" ? [...tag].map((c) => c.charCodeAt(0)) : tag, 0);
    return bytes;
  };

  it("reads WOFF and WOFF2 headers whose length is the file's", () => {
    const woff2 = header("wOF2");
    woff2[11] = 64;
    woff2[13] = 1;
    expect(readFontFormat(woff2)).toBe("woff2");
    const woff = header("wOFF");
    woff[11] = 64;
    woff[13] = 1;
    expect(readFontFormat(woff)).toBe("woff");
    woff[11] = 65;
    expect(readFontFormat(woff)).toBeNull();
  });

  it("reads sfnt headers with a table directory inside the file", () => {
    const ttf = header([0, 1, 0, 0, 0, 3]);
    expect(readFontFormat(ttf)).toBe("ttf");
    expect(readFontFormat(header([0x4f, 0x54, 0x54, 0x4f, 0, 3]))).toBe("otf");
    expect(readFontFormat(header([0, 1, 0, 0, 0, 4]))).toBeNull();
    expect(readFontFormat(header("ttcf"))).toBeNull();
  });

  it("refuses every other fixture", () => {
    for (const name of BINARY) expect(readFontFormat(fixture(name)), name).toBeNull();
    expect(readFontFormat(fixture("font.fnt"))).toBeNull();
  });
});

describe("siblingPath", () => {
  it.each([
    ["art/hero.json", "hero.png", "art/hero.png"],
    ["hero.json", "hero.png", "hero.png"],
    ["art/a/hero.json", "../b/./hero.png", "art/b/hero.png"],
    ["art/hero.json", "sub\\hero.png", "art/sub/hero.png"],
    ["art/hero.json", "/Users/ada/hero.png", "art/hero.png"],
    ["art/hero.json", "C:\\export\\hero.png", "art/hero.png"],
    ["art/hero.json", "../../hero.png", "art/hero.png"],
  ])("from %s, %s is %s", (from, name, path) => {
    expect(siblingPath(from, name)).toBe(path);
  });

  it.each(["", "art/", "..", "."])("names no file for %j", (name) => {
    expect(siblingPath("art/hero.json", name)).toBeNull();
  });
});

describe("utf8Text and utf8Json", () => {
  it("drops a byte-order mark and refuses invalid UTF-8", () => {
    expect(utf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(utf8Text(new Uint8Array([0x61, 0xff]))).toBeNull();
  });

  it("gives the engine's own reason, never the runtime's parser message", () => {
    expect(utf8Json(new TextEncoder().encode("{ nope"))).toEqual({
      ok: false,
      reason: "it isn't valid JSON",
    });
    expect(utf8Json(new TextEncoder().encode('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });
});
