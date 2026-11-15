// @vitest-environment node
import { BitmapText, Cache, Container, RendererType, Text } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TextFont, TextVisual } from "../../context";
import type { AssetBundle, BundleEntry } from "../../project/bundle";
import type { Sha256 } from "../../project/types";
import type { ShapeObj } from "../../scene/types";
import { parseRichText, type RichLine, type TextVars } from "../../text/rich";
import type { StringTableData } from "../../text/strings";
import { createAssetLoader } from "../asset-loader";

type Loader = ReturnType<typeof createAssetLoader>;
import { createPixiView, type PixiView } from "../pixi-view";
import { createRichText, DEFAULT_TEXT_FACE, reverseRtlRuns, visualOrder } from "../text";

type Style = { fontFamily: string | string[]; fontSize: number; fill: number };

const fake = vi.hoisted(() => ({
  installs: [] as { data: { distanceField?: unknown }; textures: unknown[]; pages: unknown[] }[],
  page: null as unknown,
}));

vi.mock("pixi.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("pixi.js")>();
  /** A text display measured at half an em per character, one em tall. */
  class FakeText extends real.Container {
    text: string;
    style: Style;
    constructor(opts: { text: string; style: Style }) {
      super();
      this.text = opts.text;
      this.style = opts.style;
    }
    override get width(): number {
      return Array.from(this.text).length * this.style.fontSize * 0.5;
    }
    override set width(_: number) {}
    override get height(): number {
      return this.style.fontSize;
    }
    override set height(_: number) {}
  }
  class FakeBitmapText extends FakeText {}
  class FakeBitmapFont {
    pages: { texture: unknown }[];
    data: { distanceField?: unknown };
    textures: unknown[];
    destroyed = false;
    constructor(opts: { data: { distanceField?: unknown }; textures: unknown[] }) {
      this.data = opts.data;
      this.textures = opts.textures;
      this.pages = opts.textures.map((texture) => ({ texture }));
      fake.installs.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const page = new real.Texture({ source: new real.TextureSource({ width: 16, height: 16 }) });
  fake.page = page;
  return {
    ...real,
    Text: FakeText,
    BitmapText: FakeBitmapText,
    BitmapFont: FakeBitmapFont,
    Assets: { load: vi.fn(async () => page), unload: vi.fn(async () => {}) },
  };
});

const box: ShapeObj = { type: "box", cx: 0, cy: 0, hw: 0.1, hh: 0.05, rotDeg: 0 };
const hash = (n: number) => n.toString(16).padStart(64, "0") as Sha256;
const FNT = hash(1);
const MSDF = hash(2);
const PAGE = hash(3);
const WEB = hash(4);

const FNT_TEXT = [
  'info face="Mono" size=8',
  "common lineHeight=9 base=7 scaleW=16 scaleH=16 pages=1",
  'page id=0 file="font_0.png"',
  "char id=65 x=1 y=1 width=3 height=7 xoffset=0 yoffset=0 xadvance=4 page=0",
  "char id=1488 x=5 y=1 width=3 height=7 xoffset=0 yoffset=0 xadvance=4 page=0",
].join("\n");
const MSDF_TEXT = `${FNT_TEXT}\ndistanceField fieldType=msdf distanceRange=4`;
/** The smallest header `readFontFormat` reads as a TrueType file: one table record. */
const TTF = new Uint8Array(28);
TTF.set([0, 1, 0, 0, 0, 1]);

const blobs = new Map<string, BodyInit>([
  [`/blobs/${FNT}`, FNT_TEXT],
  [`/blobs/${MSDF}`, MSDF_TEXT],
  [`/blobs/${WEB}`, TTF],
]);
const fetched: string[] = [];
const fetchBlob = async (url: string) => {
  fetched.push(url);
  const body = blobs.get(url);
  return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
};

const faces: { family: string }[] = [];
const documentFonts = { add: vi.fn(), delete: vi.fn() };

const live: { loader: Loader; view: PixiView }[] = [];

beforeEach(() => {
  fake.installs.length = 0;
  fetched.length = 0;
  faces.length = 0;
  documentFonts.add.mockClear();
  documentFonts.delete.mockClear();
  vi.stubGlobal(
    "FontFace",
    class {
      family: string;
      constructor(family: string) {
        this.family = family;
        faces.push(this);
      }
      async load() {
        return this;
      }
    },
  );
  vi.stubGlobal("document", { fonts: documentFonts });
});

afterEach(() => {
  for (const { loader, view } of live.splice(0)) {
    view.destroy();
    loader.destroy();
  }
  vi.unstubAllGlobals();
});

function entry(id: string, kind: string, sha256: Sha256): BundleEntry {
  return { id, kind, sha256, bytes: 10 };
}

function bundle(entries: BundleEntry[]): AssetBundle {
  return { name: "scene", entries, bytes: entries.length * 10 };
}

function setup(): { loader: Loader; view: PixiView } {
  const loader = createAssetLoader({
    project: "p",
    url: (_project, e) => `/blobs/${e.sha256}`,
    fetch: fetchBlob,
  });
  const view = createPixiView(new Container(), { textures: loader });
  const made = { loader, view };
  live.push(made);
  return made;
}

function textVisual(
  over: Partial<Omit<TextVisual, "lines" | "key">> &
    ({ lines: readonly RichLine[] } | { key: string; vars?: TextVars; rich?: boolean }),
) {
  return {
    font: null,
    size: 16,
    color: 0xffffff,
    align: "left",
    anchor: [0, 0],
    direction: "ltr",
    fallback: { shape: box, style: {} },
    ...over,
  } as TextVisual;
}

const lines = (source: string) => parseRichText(source).lines;

const bitmap = (fnt: Sha256, distanceField?: { type: "msdf"; range: number }) =>
  ({
    kind: "bitmap",
    hash: fnt,
    pages: [PAGE],
    meta: { format: "bmfont", lineHeight: 9, size: 8, ...(distanceField ? { distanceField } : {}) },
  }) as TextFont;

/** The runs `id` draws, in visual order. */
function runsOf(view: PixiView, id: string): (InstanceType<typeof Text> & { style: Style })[] {
  for (const layer of view.container.children) {
    const display = layer.children.find((c) => c.label === id);
    if (display) return display.children as never;
  }
  return [];
}

describe("bitmap fonts", () => {
  it("installs a BMFont once from its loaded page and draws BitmapText", async () => {
    const { loader, view } = setup();
    const scene = bundle([entry("mono", "font", FNT), entry("mono-page", "texture", PAGE)]);
    const visual = textVisual({ lines: lines("A"), font: bitmap(FNT) });
    view.text!("sign", visual, "actor");
    // Until the font arrives it draws in the default face.
    expect(runsOf(view, "sign")[0]).not.toBeInstanceOf(BitmapText);
    expect(runsOf(view, "sign")[0]!.style.fontFamily).toEqual(DEFAULT_TEXT_FACE);

    expect((await loader.load(scene)).failed).toEqual([]);
    view.text!("other", visual, "actor");
    view.text!("sign", visual, "actor");

    expect(fake.installs).toHaveLength(1);
    expect(fake.installs[0]!.textures).toEqual([fake.page]);
    expect(fake.installs[0]!.data.distanceField).toBeUndefined();
    const family = loader.bitmapFamily(FNT, [PAGE])!;
    expect(Cache.has(`${family}-bitmap`)).toBe(true);
    for (const id of ["sign", "other"]) {
      const [run] = runsOf(view, id);
      expect(run).toBeInstanceOf(BitmapText);
      expect(run!.style).toMatchObject({ fontFamily: family, fontSize: 16, fill: 0xffffff });
    }
    expect(fetched.filter((u) => u === `/blobs/${FNT}`)).toHaveLength(1);

    loader.destroy();
    expect(Cache.has(`${family}-bitmap`)).toBe(false);
    expect(loader.bitmapFamily(FNT, [PAGE])).toBeNull();
  });

  it("fails a font that isn't one, and uninstalls a font whose page is evicted", async () => {
    const loader = createAssetLoader({
      project: "p",
      url: (_project, e) => `/blobs/${e.sha256}`,
      fetch: fetchBlob,
      budgetBytes: 0,
    });
    const scene = bundle([entry("mono", "font", FNT), entry("page", "texture", PAGE)]);
    const broken = entry("broken", "font", hash(9));
    loader.retain(scene);
    const { failed } = await loader.load(bundle([...scene.entries, broken]));
    expect(failed).toEqual([broken]);
    expect(loader.stats().textures).toBe(1);
    const family = loader.bitmapFamily(FNT, [PAGE])!;
    expect(Cache.has(`${family}-bitmap`)).toBe(true);

    loader.release(scene);
    expect(Cache.has(`${family}-bitmap`)).toBe(false);
    expect(fake.installs[0]!.pages).toEqual([]);
    loader.destroy();
  });

  it("draws an MSDF font through its distance field, and the default face under Canvas2D", async () => {
    const { loader } = setup();
    await loader.load(bundle([entry("field", "font", MSDF), entry("page", "texture", PAGE)]));
    const visual = textVisual({
      lines: lines("A"),
      font: bitmap(MSDF, { type: "msdf", range: 4 }),
    });

    const gpu = createRichText(visual, loader);
    expect(fake.installs.map((f) => f.data.distanceField)).toEqual([{ type: "msdf", range: 4 }]);
    gpu.onRender?.({ type: RendererType.WEBGL } as never);
    expect(gpu.children[0]).toBeInstanceOf(BitmapText);
    expect(gpu.onRender).toBeNull();

    const canvas = createRichText(visual, loader);
    canvas.onRender?.({ type: RendererType.CANVAS } as never);
    expect(canvas.children[0]).not.toBeInstanceOf(BitmapText);
    expect((canvas.children[0] as unknown as { style: Style }).style.fontFamily).toEqual(
      DEFAULT_TEXT_FACE,
    );
    expect(fake.installs).toHaveLength(1);
    gpu.destroy();
    canvas.destroy();
  });

  it("reverses a pure right-to-left run and keeps left-to-right text in order", async () => {
    expect(reverseRtlRuns("שלום")).toBe("םולש");
    expect(reverseRtlRuns("go שלום עולם now")).toBe("go םלוע םולש now");
    expect(reverseRtlRuns("A1")).toBe("A1");

    const { loader, view } = setup();
    await loader.load(bundle([entry("mono", "font", FNT), entry("page", "texture", PAGE)]));
    view.text!("he", textVisual({ lines: lines("אA"), font: bitmap(FNT) }), "actor");
    expect(runsOf(view, "he").map((r) => r.text)).toEqual(["אA"]);
    view.text!("he", textVisual({ lines: lines("אב"), font: bitmap(FNT) }), "actor");
    expect(runsOf(view, "he").map((r) => r.text)).toEqual(["בא"]);
  });

  it("orders a line's pieces right to left in a right-to-left line, turning back its left-to-right runs", () => {
    const strong = (p: string) => (/[a-z]/.test(p) ? "ltr" : /[א-ת]/.test(p) ? "rtl" : null);
    expect(visualOrder(["א", " ", "ב", " ", "c", " ", "d"], strong, "rtl")).toEqual([
      "c",
      " ",
      "d",
      " ",
      "ב",
      " ",
      "א",
    ]);
    expect(visualOrder(["a", " ", "א", " ", "ב", " ", "c"], strong, "ltr")).toEqual([
      "a",
      " ",
      "ב",
      " ",
      "א",
      " ",
      "c",
    ]);
  });
});

describe("web fonts", () => {
  it("registers one FontFace per hash and draws Text in its family", async () => {
    const { loader, view } = setup();
    const scene = bundle([entry("serif", "font", WEB)]);
    const again = bundle([entry("serif-copy", "font", WEB)]);
    await Promise.all([loader.load(scene), loader.load(again)]);
    await loader.load(scene);

    expect(faces.map((f) => f.family)).toEqual([`jams-font-${WEB}`]);
    expect(documentFonts.add).toHaveBeenCalledTimes(1);
    expect(loader.webFamily(WEB)).toBe(`jams-font-${WEB}`);
    expect(loader.webFamily("serif")).toBe(`jams-font-${WEB}`);

    view.text!("t", textVisual({ lines: lines("Hi"), font: { kind: "web", family: WEB } }), 30);
    const [run] = runsOf(view, "t");
    expect(run).toBeInstanceOf(Text);
    expect(run).not.toBeInstanceOf(BitmapText);
    expect(run!.style.fontFamily).toEqual([`jams-font-${WEB}`, ...DEFAULT_TEXT_FACE]);

    loader.destroy();
    expect(documentFonts.delete).toHaveBeenCalledWith(faces[0]);
  });

  it("sets a right-to-left base direction on web text", () => {
    const visual = textVisual({ lines: lines("שלום"), direction: "rtl" });
    const display = createRichText(visual, null);
    expect((display.children[0] as unknown as { text: string }).text).toBe("\u202bשלום\u202c");
    display.destroy();
  });
});

describe("keyed text", () => {
  const en: StringTableData = {
    locale: "en",
    direction: "ltr",
    strings: { "sign.hello": "Hello, {name}", "sign.tag": "[b]x[/b]" },
    font: null,
  };
  const he: StringTableData = {
    locale: "he",
    direction: "rtl",
    strings: { "sign.hello": "שלום {name}" },
    font: null,
  };

  it("resolves keys through the view's table and redraws them when the table changes", () => {
    const { view } = setup();
    const hello = textVisual({ key: "sign.hello", vars: { name: "Ada" } });
    const literal = textVisual({ lines: lines("fixed"), font: { kind: "web", family: "serif" } });
    view.text!("missing", textVisual({ key: "sign.none" }), "actor");
    expect(runsOf(view, "missing").map((r) => r.text)).toEqual(["[sign.none]"]);

    view.locale!(en);
    view.text!("hello", hello, "actor");
    view.text!("tag", textVisual({ key: "sign.tag" }), "actor");
    view.text!("literal", literal, "actor");
    expect(runsOf(view, "hello").map((r) => r.text)).toEqual(["Hello, Ada"]);
    // Without `rich`, a key's markup shows as written.
    expect(runsOf(view, "tag").map((r) => r.text)).toEqual(["[b]x[/b]"]);
    const fixed = runsOf(view, "literal")[0];

    view.pose("hello", 1, 2);
    view.locale!(he);
    expect(runsOf(view, "hello").map((r) => r.text)).toEqual(["\u202bשלום Ada\u202c"]);
    expect(runsOf(view, "tag").map((r) => r.text)).toEqual(["\u202b[sign.tag]\u202c"]);
    expect(runsOf(view, "literal")[0]).toBe(fixed);
    const display = view.container.children
      .flatMap((l) => l.children)
      .find((c) => c.label === "hello")!;
    expect([display.position.x, display.position.y]).toEqual([100, 200]);
  });

  it("parses a rich key's markup, and draws a fontless text in the table's font", async () => {
    const { loader, view } = setup();
    await loader.load(bundle([entry("serif", "font", WEB)]));
    view.locale!({ ...en, font: { kind: "web", family: WEB } });
    view.text!("tag", textVisual({ key: "sign.tag", rich: true }), "actor");
    const [run] = runsOf(view, "tag");
    expect(run!.text).toBe("x");
    expect(run!.style).toMatchObject({ fontWeight: "bold" });
    expect(run!.style.fontFamily).toEqual([`jams-font-${WEB}`, ...DEFAULT_TEXT_FACE]);
  });
});

describe("layout", () => {
  it("wraps at spaces, aligns each line and anchors the box", () => {
    const display = createRichText(
      textVisual({ lines: lines("aa bb cc"), wrap: 40, align: "right", anchor: [0.5, 1] }),
      null,
    );
    const runs = display.children as unknown as { text: string; x: number; y: number }[];
    const tenths = (n: number) => Math.round(n * 10) / 10;
    // Half an em per character at 16 px: "aa bb" is 40 px wide, "cc" 16; rows are 1.2 em, runs sit on their foot.
    expect(runs.map((r) => [r.text, r.x, tenths(r.y)])).toEqual([
      ["aa", 0, 3.2],
      [" ", 16, 3.2],
      ["bb", 24, 3.2],
      ["cc", 24, 22.4],
    ]);
    expect([display.pivot.x, tenths(display.pivot.y)]).toEqual([20, 38.4]);
    display.destroy();
  });

  it("holds shake and wave still under reduced motion", () => {
    const visual = textVisual({ lines: lines("[wave]ab[/wave]") });
    const still = createRichText(visual, null, { reducedMotion: true });
    const moving = createRichText(visual, null, { reducedMotion: false });
    for (const root of [still, moving]) root.children[0]!.onRender?.({} as never);
    const ys = (root: Container) => root.children[0]!.children.map((g) => g.position.y);
    expect(ys(still)).toEqual([0, 0]);
    expect(ys(moving).some((y) => y !== 0)).toBe(true);
    still.destroy();
    moving.destroy();
  });
});
