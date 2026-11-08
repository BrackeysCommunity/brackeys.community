import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { sha256 } from "../hash";
import { parseAsepriteJson } from "../inspect/aseprite";
import { parseTexturePackerJson } from "../inspect/texturepacker";
import { createKindRegistry, type BlobKindDef, type InspectEnv } from "../kinds";
import { atlasKind } from "../kinds/atlas";
import { audioKind } from "../kinds/audio";
import { fontKind } from "../kinds/font";
import { ENGINE_ASSET_KINDS } from "../kinds/index";
import { recordingKind } from "../kinds/recording";
import { textureKind } from "../kinds/texture";
import { checkProjectBatch, type ProjectBatchEnv, type ProjectOp } from "../ops";
import type { AssetEntry, ProjectState } from "../types";
import { BLOB_KINDS, fixtureEnv, fixtureFiles } from "./fixtures/inspect-digests";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const fixtureJson = (name: string): any =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const encode = (value: unknown) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

const MiB = 1024 * 1024;

const noIds: InspectEnv = { path: "art/thing", idAt: () => undefined };
const at = (path: string, ids: Record<string, string> = {}): InspectEnv => ({
  path,
  idAt: (p) => ids[p],
});

function meta<M>(
  kind: BlobKindDef<M, any>,
  bytes: Uint8Array,
  settings: unknown = {},
  env = noIds,
) {
  const result = kind.inspect(bytes, settings, env);
  if (!result.ok) throw new Error(result.issue.message);
  return result;
}

function failure(kind: BlobKindDef, bytes: Uint8Array, settings: unknown = {}, env = noIds) {
  const result = kind.inspect(bytes, settings, env);
  if (result.ok) throw new Error(`expected import-failed, got ${JSON.stringify(result.meta)}`);
  expect(result.issue.code).toBe("import-failed");
  expect(result.issue.severity).toBe("error");
  return result.issue;
}

function entry(extra: Partial<AssetEntry> & Pick<AssetEntry, "kind">): AssetEntry {
  return { key: "k", id: "a", path: "a", created: { at: 0, by: "t" }, ...extra };
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

describe("the blob kinds", () => {
  it.each([
    [textureKind, 8, ["image/png", "image/jpeg", "image/webp", "image/gif"]],
    [atlasKind, 2, ["application/json"]],
    [fontKind, 4, ["text/plain", "font/woff2", "font/woff", "font/ttf", "font/otf"]],
    [audioKind, 16, ["audio/ogg", "audio/mpeg", "audio/wav", "audio/mp4"]],
    [recordingKind, 4, ["application/json"]],
  ] as const)("$kind: is a blob of at most N MiB with its content types", (kind, mib, types) => {
    expect(kind.storage).toBe("blob");
    expect(kind.maxBytes).toBe(mib * MiB);
    expect(kind.contentTypes).toEqual(types);
  });

  it("each takes {} as settings and refuses unknown settings keys", () => {
    for (const kind of BLOB_KINDS) {
      expect(kind.settings.safeParse({}).success, kind.kind).toBe(true);
      expect(kind.settings.safeParse({ nope: 1 }).success, kind.kind).toBe(false);
    }
  });

  it("are engine kinds, between checks and code, and a default registry detects their files", () => {
    const names = ENGINE_ASSET_KINDS.map((k) => k.kind);
    expect(names.slice(names.indexOf("checks"))).toEqual([
      "checks",
      "texture",
      "atlas",
      "font",
      "audio",
      "recording",
      "code",
    ]);
    const kinds = createKindRegistry();
    const kindOf = (path: string, json?: unknown, sidecar?: string) =>
      kinds.detect(path, json, sidecar)?.kind ?? null;
    for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "PNG"])
      expect(kindOf(`art/hero.${ext}`)).toBe("texture");
    expect(kindOf("art/hero.atlas.json", { frames: {} })).toBe("atlas");
    expect(kindOf("art/hero.json", fixtureJson("hero.json"), "atlas")).toBe("atlas");
    expect(kindOf("art/hero.json", fixtureJson("hero.json"))).toBeNull();
    for (const ext of ["fnt", "woff2", "woff", "ttf", "otf"])
      expect(kindOf(`fonts/a.${ext}`)).toBe("font");
    for (const ext of ["ogg", "mp3", "wav", "m4a"]) expect(kindOf(`sfx/a.${ext}`)).toBe("audio");
    expect(kindOf("runs/a.recording.json", fixtureJson("run.recording.json"))).toBe("recording");
  });

  it("schema-hash their settings and meta", async () => {
    const hashes = await createKindRegistry().schemaHashes({
      registry: createRegistry(),
      project: null,
    });
    for (const kind of BLOB_KINDS) expect(hashes[kind.kind], kind.kind).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("texture", () => {
  it.each([
    ["texture.png", "png", 12, 10],
    ["hero.png", "png", 32, 8],
    ["texture.jpg", "jpeg", 20, 14],
    ["texture.webp", "webp", 18, 6],
    ["texture-lossless.webp", "webp", 12, 10],
    ["texture-alpha.webp", "webp", 9, 7],
    ["texture.gif", "gif", 7, 5],
  ])("%s is a %s of %ix%i", (name, format, width, height) => {
    expect(meta(textureKind, fixture(name))).toEqual({ ok: true, meta: { format, width, height } });
  });

  it("reads the format from the header, not the file name", () => {
    expect(meta(textureKind, fixture("texture.gif"), {}, at("art/mislabelled.png")).meta).toEqual({
      format: "gif",
      width: 7,
      height: 5,
    });
  });

  it("gives the same meta whatever the settings", () => {
    const settings = { filter: "linear", pivot: [0, 1], nineSlice: [1, 2, 3, 4] };
    expect(meta(textureKind, fixture("texture.png"), settings)).toEqual(
      meta(textureKind, fixture("texture.png")),
    );
  });

  it("refuses what isn't an image, naming the file", () => {
    const issue = failure(textureKind, fixture("tone.ogg"), {}, at("art/tone.png"));
    expect(issue.message).toContain('"art/tone.png"');
    expect(issue.expected).toBe("texture");
    failure(textureKind, new Uint8Array());
  });

  it("refuses invalid settings with import-failed rather than throwing", () => {
    failure(textureKind, fixture("texture.png"), { filter: "blurry" });
    failure(textureKind, fixture("texture.png"), { nineSlice: [1, 2] });
  });
});

describe("atlas", () => {
  it("reads an Aseprite export by meta.app and finds its texture beside it", () => {
    const result = meta(
      atlasKind,
      fixture("hero.json"),
      {},
      at("art/hero.json", { "art/hero.png": "hero" }),
    );
    expect(result.meta).toEqual({
      tool: "aseprite",
      ...parseAsepriteJson(fixtureJson("hero.json")),
    });
    expect(result.import).toEqual({ texture: "hero" });
  });

  it("reads a TexturePacker export, which names no Aseprite app", () => {
    const result = meta(
      atlasKind,
      fixture("items.json"),
      {},
      at("ui/items.atlas.json", { "ui/items.png": "items" }),
    );
    expect(result.meta).toEqual({
      tool: "texturepacker",
      ...parseTexturePackerJson(fixtureJson("items.json")),
    });
    expect(result.import).toEqual({ texture: "items" });
  });

  it("resolves meta.image relative to the atlas, and an absolute one as a sibling", () => {
    const json = fixtureJson("hero.json");
    const ids = { "sheets/hero.png": "a", "art/hero.png": "b" };
    json.meta.image = "../sheets/./hero.png";
    expect(meta(atlasKind, encode(json), {}, at("art/hero.json", ids)).import).toEqual({
      texture: "a",
    });
    json.meta.image = "C:\\Users\\ada\\export\\hero.png";
    expect(meta(atlasKind, encode(json), {}, at("art/hero.json", ids)).import).toEqual({
      texture: "b",
    });
    json.meta.image = "../../../hero.png";
    expect(meta(atlasKind, encode(json), {}, at("art/hero.json", ids)).import).toEqual({
      texture: "b",
    });
  });

  it("fills no texture when none matches or the settings already name one", () => {
    expect(meta(atlasKind, fixture("hero.json")).import).toBeUndefined();
    const named = meta(
      atlasKind,
      fixture("hero.json"),
      { texture: "other" },
      at("art/hero.json", { "art/hero.png": "hero" }),
    );
    expect(named.import).toBeUndefined();
  });

  it("gives frames without a pivot the default pivot", () => {
    const { meta: m } = meta(atlasKind, fixture("items.json"), { pivotDefault: [0.25, 1] });
    expect(m.frames["coin.png"]?.pivot).toEqual([0.5, 0.5]);
    expect(m.frames["panel.png"]?.pivot).toEqual([0.25, 1]);
  });

  it("keeps a frame named __proto__ when filling pivots", () => {
    const json = { frames: [{ filename: "__proto__", frame: { x: 0, y: 0, w: 1, h: 1 } }] };
    const { meta: m } = meta(atlasKind, encode(json), { pivotDefault: [0, 0] });
    expect(Object.keys(m.frames)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(m.frames)).toBe(Object.prototype);
  });

  it.each([
    ["bytes that aren't JSON", encode("{ frames")],
    ["bytes that aren't UTF-8", new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])],
    ["JSON without frames", encode({ meta: { app: "x" } })],
    [
      "an Aseprite sheet whose tag runs past its frames",
      (() => {
        const json = fixtureJson("hero.json");
        json.meta.frameTags[0].to = 9;
        return encode(json);
      })(),
    ],
  ])("refuses %s", (_, bytes) => {
    failure(atlasKind, bytes);
  });

  it("references the texture import.texture names", () => {
    expect(atlasKind.refs!(entry({ kind: "atlas", import: { texture: "hero" } }))).toEqual([
      { pointer: "/import/texture", id: "hero", kinds: ["texture"] },
    ]);
    expect(atlasKind.refs!(entry({ kind: "atlas" }))).toEqual([]);
  });
});

describe("font", () => {
  it("reads a text BMFont's line height and pages as project paths, and finds the page textures", () => {
    const result = meta(
      fontKind,
      fixture("font.fnt"),
      {},
      at("fonts/mono.fnt", { "fonts/font_0.png": "font-0" }),
    );
    expect(result.meta).toEqual({ format: "bmfont", lineHeight: 9, pages: ["fonts/font_0.png"] });
    expect(result.import).toEqual({ pages: ["font-0"] });
  });

  it("fills no pages unless every page is a texture, or when the settings name them", () => {
    const fnt = encode(
      'common lineHeight=9 pages=2\npage id=0 file="a.png"\npage id=1 file="sub/b.png"',
    );
    const env = at("f/x.fnt", { "f/a.png": "a" });
    expect(meta(fontKind, fnt, {}, env).meta.pages).toEqual(["f/a.png", "f/sub/b.png"]);
    expect(meta(fontKind, fnt, {}, env).import).toBeUndefined();
    expect(
      meta(fontKind, fnt, {}, at("f/x.fnt", { "f/a.png": "a", "f/sub/b.png": "b" })).import,
    ).toEqual({
      pages: ["a", "b"],
    });
    expect(
      meta(fontKind, fixture("font.fnt"), { pages: ["x"] }, at("font.fnt", { "font_0.png": "y" }))
        .import,
    ).toBeUndefined();
  });

  const sfnt = (tag: number[], tables = 1) => {
    const bytes = new Uint8Array(12 + tables * 16);
    bytes.set(tag, 0);
    bytes[5] = tables;
    return bytes;
  };
  const woff = (sig: string, headerSize: number) => {
    const bytes = new Uint8Array(headerSize + 8);
    bytes.set(encode(sig), 0);
    new DataView(bytes.buffer).setUint32(8, bytes.length);
    bytes[13] = 1;
    return bytes;
  };

  it.each([
    ["woff2", woff("wOF2", 48)],
    ["woff", woff("wOFF", 44)],
    ["ttf", sfnt([0, 1, 0, 0])],
    ["ttf", sfnt([...encode("true")])],
    ["otf", sfnt([...encode("OTTO")])],
  ])("reads a %s header", (format, bytes) => {
    expect(meta(fontKind, bytes)).toEqual({ ok: true, meta: { format } });
  });

  it.each([
    ["a WOFF whose length isn't the file's", woff("wOFF", 44).subarray(0, 50)],
    ["an sfnt with no tables", sfnt([0, 1, 0, 0], 0)],
    ["an sfnt whose table directory runs past the file", sfnt([0, 1, 0, 0], 2).subarray(0, 20)],
    ["a font collection", sfnt([...encode("ttcf")])],
    ["a PNG", fixture("font_0.png")],
  ])("refuses %s", (_, bytes) => {
    failure(fontKind, bytes);
  });

  it("refuses the binary and XML BMFont variants, saying to export text", () => {
    expect(failure(fontKind, encode("BMF\u0003\u0001")).message).toMatch(/binary BMFont/);
    const xml = '<?xml version="1.0"?><font><common lineHeight="9" pages="1"/></font>';
    expect(failure(fontKind, encode(xml)).message).toMatch(/XML BMFont/);
  });

  it("references a bitmap font's page textures", () => {
    expect(fontKind.refs!(entry({ kind: "font", import: { pages: ["p0", "p1"] } }))).toEqual([
      { pointer: "/import/pages/0", id: "p0", kinds: ["texture"] },
      { pointer: "/import/pages/1", id: "p1", kinds: ["texture"] },
    ]);
    expect(fontKind.refs!(entry({ kind: "font" }))).toEqual([]);
  });
});

describe("audio", () => {
  it.each([
    ["tone.ogg", "ogg"],
    ["tone.wav", "wav"],
    ["tone.mp3", "mp3"],
    ["tone.m4a", "m4a"],
  ])("%s is %s", (name, format) => {
    expect(meta(audioKind, fixture(name))).toEqual({ ok: true, meta: { format } });
  });

  it("reads an MP3 behind an ID3v2 tag", () => {
    const mp3 = fixture("tone.mp3");
    const tag = [...encode("ID3"), 4, 0, 0, 0, 0, 0, 3, 0, 0, 0];
    expect(meta(audioKind, new Uint8Array([...tag, ...mp3])).meta).toEqual({ format: "mp3" });
    const bad = [...encode("ID3"), 4, 0, 0, 0, 0, 0, 0x80, 0, 0, 0];
    failure(audioKind, new Uint8Array([...bad, ...mp3]));
  });

  it.each([
    ["an image", fixture("texture.png")],
    ["a WebP, also RIFF", fixture("texture.webp")],
    ["text", encode("hello")],
    ["an MPEG layer II frame", new Uint8Array([0xff, 0xfd, 0x90, 0x00])],
  ])("refuses %s", (_, bytes) => {
    failure(audioKind, bytes);
  });
});

describe("recording", () => {
  it("reads the scene, ticks and scene hash", () => {
    expect(meta(recordingKind, fixture("run.recording.json"))).toEqual({
      ok: true,
      meta: { scene: "kitchen-sink", ticks: 120, sceneHash: "3f1c9a2b" },
    });
  });

  it("refuses a file that isn't recording:v1, saying where", () => {
    const json = fixtureJson("run.recording.json");
    json.v = 2;
    expect(failure(recordingKind, encode(json)).message).toMatch(/recording:v1 file \(\/v: /);
    failure(recordingKind, fixture("hero.json"));
  });

  it("references its scene", () => {
    expect(recordingKind.refs!(entry({ kind: "recording", meta: { scene: "w1" } }))).toEqual([
      { pointer: "/meta/scene", id: "w1", kinds: ["scene"] },
    ]);
  });

  it("states that it's immutable", () => {
    expect(recordingKind.description).toMatch(/immutable/);
  });
});

describe("inspect never throws", { timeout: 30_000 }, () => {
  const files = fixtureFiles().map((name) => [name, fixture(name)] as const);

  function check(kind: BlobKindDef, bytes: Uint8Array, settings: unknown, env: InspectEnv): void {
    const result = kind.inspect(bytes, settings, env);
    if (result.ok) expect(kind.meta.safeParse(result.meta).success).toBe(true);
    else expect(result.issue.code).toBe("import-failed");
  }

  it("on every truncation of every fixture", () => {
    for (const [name, bytes] of files) {
      const step = Math.max(1, Math.floor(bytes.length / 400));
      for (let end = 0; end <= bytes.length; end += step)
        for (const kind of BLOB_KINDS) check(kind, bytes.subarray(0, end), {}, fixtureEnv(name));
    }
  });

  it("on random bytes and on fixtures with random bytes overwritten", () => {
    const next = rng(0xb10b);
    const byte = () => Math.floor(next() * 256);
    for (let i = 0; i < 600; i++) {
      const random = Uint8Array.from({ length: Math.floor(next() * 64) }, byte);
      const [name, base] = files[i % files.length]!;
      const mutated = base.slice(0, Math.floor(next() * (base.length + 1)));
      for (let n = 0; n < 4; n++) mutated[Math.floor(next() * mutated.length)] = byte();
      for (const kind of BLOB_KINDS) {
        check(kind, random, {}, noIds);
        check(kind, mutated, {}, fixtureEnv(name));
      }
    }
  });

  it("on bad settings, bad bytes and a throwing env", () => {
    const throwing: InspectEnv = {
      path: "art/hero.json",
      idAt: () => {
        throw new Error("boom");
      },
    };
    for (const kind of BLOB_KINDS) {
      for (const settings of [null, undefined, 3, { pivotDefault: "x" }, { pages: [1] }])
        check(kind, fixture("hero.json"), settings, noIds);
      check(kind, "not bytes" as unknown as Uint8Array, {}, noIds);
      check(kind, fixture("hero.json"), {}, throwing);
    }
  });
});

describe("through project ops", { timeout: 60_000 }, () => {
  const H = (c: string) => c.repeat(64);

  async function store(names: string[]) {
    const byHash = new Map<string, Uint8Array>();
    const hashes: Record<string, string> = {};
    for (const name of names) {
      const bytes = fixture(name);
      const hash = await sha256(bytes);
      byHash.set(hash, bytes);
      hashes[name] = hash;
    }
    return { byHash, hashes };
  }

  function env(state: () => ProjectState, byHash: Map<string, Uint8Array>): ProjectBatchEnv {
    let n = 0;
    return {
      registry: createRegistry(),
      kinds: createKindRegistry(),
      now: 1,
      by: "ada",
      newKey: () => `k${n++}`,
      inspect: (def, e) => {
        const ids = new Map(Object.values(state().assets).map((a) => [a.path, a.id]));
        return def.inspect(byHash.get(e.sha256 ?? "") ?? new Uint8Array(), e.import ?? {}, {
          path: e.path,
          idAt: (p) => ids.get(p),
        });
      },
    };
  }

  it("imports a texture and its atlas, filling meta and import.texture, and refuses new recording bytes", async () => {
    const { byHash, hashes } = await store(["hero.png", "hero.json", "run.recording.json"]);
    let state: ProjectState = {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {},
      history: {},
      code: {},
      build: {},
    };
    const e = env(() => state, byHash);
    const apply = (ops: ProjectOp[]) => {
      const result = checkProjectBatch(state, new Map(), { v: 1, ops }, e);
      if (result.ok) state = result.state;
      return result;
    };
    const imp = (path: string, name: string, kind?: string): ProjectOp => ({
      op: "importAsset",
      path,
      sha256: hashes[name]!,
      bytes: fixture(name).length,
      ...(kind ? { kind } : {}),
    });

    expect(apply([imp("art/hero.png", "hero.png")]).ok).toBe(true);
    expect(apply([imp("art/hero.atlas.json", "hero.json")]).ok).toBe(true);
    expect(apply([imp("runs/a.recording.json", "run.recording.json")]).ok).toBe(true);
    const byPath = (p: string) => Object.values(state.assets).find((a) => a.path === p)!;
    expect(byPath("art/hero.png").meta).toEqual({ format: "png", width: 32, height: 8 });
    expect(byPath("art/hero.atlas.json").import).toEqual({ texture: "hero" });
    expect(byPath("art/hero.atlas.json").meta?.tool).toBe("aseprite");
    expect(byPath("runs/a.recording.json").meta).toEqual({
      scene: "kitchen-sink",
      ticks: 120,
      sceneHash: "3f1c9a2b",
    });

    const replaced = apply([
      { op: "replaceContent", id: byPath("runs/a.recording.json").id, sha256: H("e"), bytes: 10 },
    ]);
    expect(replaced.ok).toBe(false);
    if (!replaced.ok) expect(replaced.issue.code).toBe("asset-kind");

    const wrong = apply([imp("art/fake.png", "hero.json")]);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.issue.code).toBe("import-failed");
  });
});
