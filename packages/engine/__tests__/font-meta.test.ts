import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { stableJson } from "../project/canonical";
import { parseBmfont } from "../project/inspect/bmfont";
import { inspectEntry } from "../project/inspect/entry";
import { readFontFormat, type FontDecompress } from "../project/inspect/font";
import { cmapCoverage, codePointRanges, mergeRanges } from "../project/inspect/font-cmap";
import type { InspectEnv } from "../project/kinds/define";
import { fontKind, fontMetaSchema, type FontMeta } from "../project/kinds/font";
import { NODE_DECOMPRESS as NODE } from "../vite/font-decompress";

const FONTS = new URL("../project/__tests__/fixtures/fonts/", import.meta.url);
const file = (name: string) => new Uint8Array(readFileSync(new URL(name, FONTS)));
const text = (name: string) => readFileSync(new URL(name, FONTS), "utf8");

function env(path: string, decompress?: FontDecompress): InspectEnv {
  return Object.assign({ path, idAt: () => undefined }, decompress ? { decompress } : {});
}

function meta(name: string, decompress?: FontDecompress): FontMeta {
  const result = fontKind.inspect(file(name), {}, env(`fonts/${name}`, decompress));
  if (!result.ok) throw new Error(result.issue.message);
  expect(fontMetaSchema.safeParse(result.meta).success).toBe(true);
  return result.meta;
}

const covers = (coverage: FontMeta["coverage"], cp: number) =>
  (coverage ?? []).some(([from, to]) => from <= cp && cp <= to);

/** The sample glyphs the generated faces carry: space, A–C, é and one astral code point. */
const SAMPLES = [0x20, 0x41, 0x42, 0x43, 0xe9, 0x1f600];

describe("BMFont meta", () => {
  it("gives the same meta for the text and XML formats", () => {
    const fromText = meta("mono-text.fnt");
    expect(meta("mono-xml.fnt")).toEqual(fromText);
    expect(fromText).toEqual({
      format: "bmfont",
      lineHeight: 14,
      pages: ["font_0.png"],
      size: 12,
      advances: { "32": 3, "65": 5, "66": 5, "233": 4 },
      kerning: [
        [65, 66, -1],
        [66, 65, -2],
      ],
      coverage: [
        [32, 32],
        [65, 66],
        [233, 233],
      ],
    });
  });

  it("reports an MSDF or SDF font's distance field", () => {
    expect(meta("msdf.fnt").distanceField).toEqual({ type: "msdf", range: 4 });
    expect(meta("sdf-xml.fnt").distanceField).toEqual({ type: "sdf", range: 8 });
    expect(meta("mono-text.fnt").distanceField).toBeUndefined();
    expect(meta("msdf.fnt").advances).toEqual({ "65": 21, "66": 20 });
  });

  it("reads MTSDF as MSDF and drops a `none` field", () => {
    const base = text("msdf.fnt");
    expect(parseBmfont(base.replace("fieldType=msdf", "fieldType=mtsdf"))?.distanceField).toEqual({
      type: "msdf",
      range: 4,
    });
    expect(parseBmfont(base.replace("fieldType=msdf", "fieldType=none"))?.distanceField).toBe(
      undefined,
    );
  });

  it.each([
    ["a field type it can't draw", (s: string) => s.replace("fieldType=msdf", "fieldType=psdf")],
    ["a field with no range", (s: string) => s.replace(" distanceRange=4", "")],
    ["a zero range", (s: string) => s.replace("distanceRange=4", "distanceRange=0")],
    ["a repeated char", (s: string) => s.replace("char id=66", "char id=65")],
    ["a char past Unicode", (s: string) => s.replace("char id=66", "char id=1114112")],
    ["a char with no advance", (s: string) => s.replace("xadvance=20 ", "")],
  ])("refuses %s", (_, edit) => {
    expect(parseBmfont(edit(text("msdf.fnt")))).toBeNull();
  });

  it("refuses a repeated kerning pair and drops zero-amount pairs", () => {
    const base = text("mono-text.fnt");
    expect(parseBmfont(base.replace("first=66  second=65", "first=65  second=66"))).toBeNull();
    expect(parseBmfont(base.replace("amount=-2", "amount=0"))?.kerning).toEqual([[65, 66, -1]]);
  });

  it("decodes XML entities and takes a negative size as the face's", () => {
    const xml = text("mono-xml.fnt")
      .replace('file="../font_0.png"', 'file="a&amp;b.png"')
      .replace('size="12"', 'size="-12"');
    expect(parseBmfont(xml)).toMatchObject({ pages: ["a&b.png"], size: 12 });
  });

  it("refuses an XML document that isn't a <font>", () => {
    expect(parseBmfont('<?xml version="1.0"?><svg><common lineHeight="9"/></svg>')).toBeNull();
  });

  it("refuses the binary variant, saying to export text or XML", () => {
    const result = fontKind.inspect(new TextEncoder().encode("BMF\u0003\u0001"), {}, env("a.fnt"));
    expect(result.ok || result.issue.message).toMatch(/binary BMFont; export it as text or XML/);
  });
});

describe("web font coverage", () => {
  it.each(["sample.ttf", "sample.otf", "sample.woff", "sample.woff2"])(
    "%s covers its sample glyphs",
    (name) => {
      const font = meta(name, NODE);
      expect(font.format).toBe(readFontFormat(file(name)));
      for (const cp of SAMPLES) expect(covers(font.coverage, cp), cp.toString(16)).toBe(true);
      expect(covers(font.coverage, 0x44)).toBe(false);
      expect(font.coverage).toEqual(meta("sample.ttf").coverage);
    },
  );

  it("records a WOFF2's coverage when the host lends inspectEntry its decompressors", () => {
    const entry = { path: "fonts/sample.woff2" };
    const lent = inspectEntry(fontKind, entry, file("sample.woff2"), () => undefined, NODE);
    const bare = inspectEntry(fontKind, entry, file("sample.woff2"), () => undefined);
    expect(lent.ok && lent.meta).toEqual({ ...meta("sample.ttf"), format: "woff2" });
    expect(bare.ok && bare.meta).toEqual({ format: "woff2" });
  });

  it("leaves coverage absent, with no issue, where nothing can decompress", () => {
    expect(meta("sample.woff2")).toEqual({ format: "woff2" });
    expect(meta("sample.woff")).toEqual({ format: "woff" });
    expect(meta("sample.woff2", { inflate: NODE.inflate })).toEqual({ format: "woff2" });
  });

  it("leaves coverage absent when a decompressor gives the wrong bytes or throws", () => {
    const short = { brotli: () => new Uint8Array(4), inflate: () => new Uint8Array(4) };
    const throws = {
      brotli: () => {
        throw new Error("corrupt");
      },
    };
    expect(meta("sample.woff2", short)).toEqual({ format: "woff2" });
    expect(meta("sample.woff", short)).toEqual({ format: "woff" });
    expect(meta("sample.woff2", throws)).toEqual({ format: "woff2" });
  });

  it("reads format 4 with a glyph id array, and skips glyph 0", () => {
    // One format 4 subtable: segment 0x41–0x43 through the glyph array (0x42 maps to glyph 0), then the 0xFFFF end segment.
    const words = [
      ...[0, 1, 3, 1, 0, 12],
      ...[4, 40, 0, 4, 2, 0, 0],
      ...[0x43, 0xffff, 0, 0x41, 0xffff, 0, 1, 4, 0],
      ...[5, 0, 6],
    ];
    const bytes = new Uint8Array(words.length * 2);
    words.forEach((w, i) => new DataView(bytes.buffer).setUint16(i * 2, w));
    expect(cmapCoverage(bytes)).toEqual([
      [0x41, 0x41],
      [0x43, 0x43],
    ]);
  });

  it("reads no coverage from a cmap with no Unicode subtable", () => {
    const symbolOnly = new Uint8Array([0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 12, 0, 4]);
    expect(cmapCoverage(symbolOnly)).toBeNull();
    expect(cmapCoverage(new Uint8Array([0, 1]))).toBeNull();
  });

  it("merges ranges and code points into ascending, disjoint ranges", () => {
    expect(
      mergeRanges([
        [10, 12],
        [1, 3],
        [4, 5],
        [11, 20],
        [0x10fff0, 0x200000],
      ]),
    ).toEqual([
      [1, 5],
      [10, 20],
      [0x10fff0, 0x10ffff],
    ]);
    expect(codePointRanges([5, 3, 4, 4, 9])).toEqual([
      [3, 5],
      [9, 9],
    ]);
  });

  it("never throws on any truncation of the web fonts", () => {
    for (const name of ["sample.ttf", "sample.otf", "sample.woff", "sample.woff2"]) {
      const bytes = file(name);
      for (let end = 0; end <= bytes.length; end++) {
        const result = fontKind.inspect(bytes.slice(0, end), {}, env(`fonts/${name}`, NODE));
        if (result.ok) expect(fontMetaSchema.safeParse(result.meta).success).toBe(true);
      }
    }
  });
});

describe("determinism", () => {
  it("gives the same meta over two runs of every fixture", () => {
    const names = [
      "mono-text.fnt",
      "mono-xml.fnt",
      "msdf.fnt",
      "sdf-xml.fnt",
      "sample.ttf",
      "sample.otf",
      "sample.woff",
      "sample.woff2",
    ];
    const run = () => names.map((name) => stableJson(meta(name, NODE)));
    expect(run()).toEqual(run());
  });

  it("records the meta version", () => {
    expect(fontKind.metaVersion).toBe(2);
    expect(fontKind.contentTypes).toEqual([
      "text/plain",
      "font/woff2",
      "font/woff",
      "font/ttf",
      "font/otf",
    ]);
  });
});
