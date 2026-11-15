// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { SceneView, TextVisual, ViewLayer } from "../context";
import { AUDIO } from "../game/behaviors/audio";
import {
  measureFont,
  richSource,
  TEXT,
  textBoxShape,
  textDirection,
  textFontOf,
  type FontAssetInfo,
  type TextHandle,
} from "../game/behaviors/text";
import { createRegistry } from "../game/define";
import type { FieldEnv, JsonValue } from "../game/types";
import type { FontMeta } from "../project/kinds/font";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { ENGINE_BEHAVIOR_SYSTEMS } from "../runtime/behaviors/index";
import { createTextSystem, textViewId, type TextSystem } from "../runtime/behaviors/text";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreLoaded } from "../runtime/save-state";
import { textBoxOf } from "../scene/svg";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import { measureText } from "../text/measure";
import { parseRichText } from "../text/rich";
import { localeDirection } from "../text/strings";
import { recordingView } from "./fixtures/recording-view";

const DT = 1000 / 60;
const PAGE = "a".repeat(64);
const WOFF = "b".repeat(64);
const FNT = "c".repeat(64);

/** A BMFont at face size 10: every glyph 5 px wide, "AV" kerned by -1, line height 12. */
const BITMAP: FontMeta = {
  format: "bmfont",
  lineHeight: 12,
  size: 10,
  advances: { "65": 5, "86": 5, "32": 5 },
  kerning: [[65, 86, -1]],
};

const ASSETS: Readonly<Record<string, FontAssetInfo>> = {
  pixel: { kind: "font", sha256: FNT, font: BITMAP, pages: ["pixel-page"] },
  "pixel-page": { kind: "texture", sha256: PAGE },
  rounded: { kind: "font", sha256: WOFF, font: { format: "woff2" } },
  crate: { kind: "texture", sha256: "d".repeat(64) },
};
const lookup = (id: string) => ASSETS[id];

/** The fields of a runtime view the text system and the runtime read. */
const fakeProject = {
  settings: {},
  engine: {},
  table: () => [],
  inputMap: null,
  asset: lookup,
} as unknown as ProjectRuntimeView;

type TextCall = { id: string; visual: TextVisual; layer: ViewLayer };

/** The recording view with a `text` member that logs every visual it is handed. */
function textView(opts: { text?: boolean } = {}) {
  const rec = recordingView();
  const texts: TextCall[] = [];
  const view: SceneView = { ...rec.view };
  if (opts.text !== false)
    view.text = (id, visual, layer) =>
      void texts.push({ id, visual: structuredClone(visual), layer });
  view.locale = () => {};
  return { ...rec, view, texts };
}

const scene = (entities: RuntimeEntity[]): ExpandedScene => ({
  name: "signs",
  bounds: [-10, -10, 10, 10],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities,
});

const sign = (id: string, text: Record<string, unknown>, over: Partial<RuntimeEntity> = {}) =>
  ({ id, type: "marker", at: [1, 2], behaviors: { text }, ...over }) as RuntimeEntity;

function loaded(entities: RuntimeEntity[], opts: { text?: boolean } = {}) {
  const rec = textView(opts);
  const rt = createSceneRuntime({
    rapier: null,
    view: rec.view,
    registry: createRegistry(),
    project: fakeProject,
  });
  const report = rt.load(scene(entities));
  expect(report.ok, JSON.stringify(report)).toBe(true);
  const system = rt.ctx.behavior<TextSystem>(TEXT.name)!;
  return { rt, system, ...rec };
}

const hasFunction = (v: unknown): boolean =>
  typeof v === "function" ||
  (v !== null && typeof v === "object" && Object.values(v).some(hasFunction));

describe("the text behavior", () => {
  it("is visual-only, with its system, and builds none headless", () => {
    expect(TEXT.visualOnly).toBe(true);
    expect(ENGINE_BEHAVIOR_SYSTEMS.text).toBe(createTextSystem);
    const headless = createSceneRuntime({ rapier: null, view: null, registry: createRegistry() });
    expect(headless.load(scene([sign("a", { text: "Hi" })])).ok).toBe(true);
    expect(headless.ctx.behavior(TEXT.name)).toBeUndefined();
    expect(headless.stats().behaviors).toEqual({});
    expect(() =>
      createTextSystem(headless.ctx, headless.ctx.registry.behaviors.get(TEXT.name)!),
    ).toThrow(/headless runs build none/);
  });

  it("hands the view one text call per block, of data only", () => {
    const { texts, rt } = loaded([
      sign("a", { text: "Gate" }),
      sign("b", { key: "gate.open", vars: { n: 2 } }),
    ]);
    expect(texts.map((t) => t.id)).toEqual([textViewId("a"), textViewId("b")]);
    for (const t of texts) expect(hasFunction(t.visual)).toBe(false);
    rt.step(DT, []);
    rt.step(DT, []);
    expect(texts).toHaveLength(2);
  });

  it("builds a literal text's lines, defaults and measured fallback", () => {
    const { texts } = loaded([sign("a", { text: "A[b]V{n}", vars: { n: 1 } })]);
    const visual = texts[0]!.visual;
    expect(visual).toEqual({
      lines: [[{ text: "A[b]V1" }]],
      font: null,
      size: 16,
      color: 0xffffff,
      align: "center",
      anchor: [0.5, 0.5],
      direction: "ltr",
      fallback: {
        // Six characters at 0.55 em of 16 px, 1.2 em tall, over 100 px per metre.
        shape: { type: "box", cx: 0, cy: 0, hw: 0.264, hh: 0.096, rotDeg: 0 },
        style: { stroke: 0xffffff, strokeAlpha: 0.6 },
      },
    });
  });

  it("reads markup only when rich", () => {
    const { texts } = loaded([sign("a", { text: "[b]Go[/b]", rich: true, color: 0xff0000 })]);
    expect(texts[0]!.visual).toMatchObject({
      lines: [[{ text: "Go", bold: true }]],
      color: 0xff0000,
    });
  });

  it("leaves a key for the view to resolve, and its font to the locale when the block names none", () => {
    const { texts } = loaded([sign("a", { key: "gate.open", vars: { n: 2 }, rich: true })]);
    const visual = texts[0]!.visual;
    expect(visual).toMatchObject({ key: "gate.open", vars: { n: 2 }, rich: true, font: null });
    expect("lines" in visual).toBe(false);
  });

  it("draws a block's own font: a BMFont by its .fnt's and pages' hashes, a web font by its hash", () => {
    const { texts } = loaded([
      sign("a", { text: "AV", font: "pixel", size: 20, wrap: 300, align: "left" }),
      sign("b", { text: "AV", font: "rounded", outline: { width: 2, color: 0 } }),
    ]);
    expect(texts[0]!.visual).toMatchObject({
      font: { kind: "bitmap", hash: FNT, pages: [PAGE], meta: BITMAP },
      size: 20,
      wrap: 300,
      align: "left",
      // 5 + 5 - 1 px at face size 10, doubled; line height 12 doubled.
      fallback: { shape: { hw: 0.09, hh: 0.12 } },
    });
    expect(texts[1]!.visual).toMatchObject({
      font: { kind: "web", family: WOFF },
      outline: { width: 2, color: 0 },
    });
  });

  it("draws the fallback box through a view without text", () => {
    const { live } = loaded([sign("a", { text: "Gate", anchor: [0, 1] })], { text: false });
    const shape = live.get(textViewId("a"))?.shape;
    expect(shape?.type).toBe("box");
    if (shape?.type !== "box") return;
    expect(shape.cx).toBeCloseTo(0.176, 9);
    expect(shape.cy).toBeCloseTo(-0.096, 9);
    const drawn = live.get(textViewId("a"));
    expect(drawn?.pose).toEqual({ x: 1, y: 2, rot: 0 });
  });

  it("redraws once per set and setKey through the handle, and never touches the simulation", () => {
    const { rt, texts } = loaded([sign("a", { text: "Gate" })]);
    const before = JSON.stringify(rt.step(DT, []).game);
    const handle = rt.ctx.behavior(TEXT.name)!.handle!("a") as TextHandle;
    handle.set("Open");
    handle.set("Open");
    handle.setKey("gate.open", { n: 3 });
    expect(texts.map((t) => ("lines" in t.visual ? t.visual.lines : t.visual.key))).toEqual([
      [[{ text: "Gate" }]],
      [[{ text: "Open" }]],
      "gate.open",
    ]);
    expect(texts[2]!.visual).toMatchObject({ vars: { n: 3 } });
    expect(JSON.stringify(rt.step(DT, []).game)).toBe(before);
  });

  it("puts the block's text back when the block changes", () => {
    const e = sign("a", { text: "Gate" });
    const { system, texts } = loaded([e]);
    system.set("a", "Open");
    system.update!("a", { text: "Shut" }, { text: "Gate" }, e);
    expect(system.save!("a")).toBeUndefined();
    expect(texts.at(-1)!.visual).toMatchObject({ lines: [[{ text: "Shut" }]] });
  });

  it("redraws nothing on a locale change: the view holds the table", () => {
    const { rt, view, texts } = loaded([sign("a", { key: "gate.open" })]);
    view.locale!({
      locale: "fr",
      direction: "ltr",
      strings: { "gate.open": "Ouvert" },
      font: null,
    });
    rt.step(DT, []);
    expect(texts).toHaveLength(1);
  });

  it("sits at the entity's pose, and a block on a child follows its parent", () => {
    const { rt, system, calls } = loaded([
      sign("parent", { text: "P" }, { at: [0, 0] }),
      sign("child", { text: "C" }, { at: [1, 0], parent: "parent" }),
    ]);
    rt.ctx.setPose("parent", 3, 4, 0);
    rt.step(DT, []);
    system.settle();
    const poses = calls.filter((c) => c.op === "pose" && c.id === textViewId("child"));
    expect(poses.at(-1)).toMatchObject({ x: 4, y: 4 });
  });

  it("hides while disabled and comes back with what it was set to", () => {
    const { system, texts, callsFor } = loaded([sign("a", { text: "Gate" })]);
    system.set("a", "Open");
    system.disable!("a");
    expect(callsFor(textViewId("a"), "remove")).toHaveLength(1);
    system.set("a", "Shut");
    expect(texts).toHaveLength(2);
    system.enable!("a");
    expect(texts.at(-1)!.visual).toMatchObject({ lines: [[{ text: "Shut" }]] });
  });
});

describe("the text system's save", () => {
  it("saves what set and setKey show, and restore draws it again", () => {
    const { system } = loaded([sign("a", { text: "Gate" }), sign("b", { text: "Gate" })]);
    expect(system.save!("a")).toBeUndefined();
    system.set("a", "Open");
    system.setKey("b", "gate.open", { n: 2 });
    const saved = { a: system.save!("a")!, b: system.save!("b")! };
    expect(saved).toEqual({ a: { text: "Open" }, b: { key: "gate.open", vars: { n: 2 } } });

    const fresh = loaded([sign("a", { text: "Gate" }), sign("b", { text: "Gate" })]);
    fresh.system.restore!("a", saved.a);
    fresh.system.restore!("b", saved.b);
    fresh.system.restore!("a", "junk" as JsonValue);
    expect(fresh.texts.slice(2).map((t) => t.visual)).toMatchObject([
      { lines: [[{ text: "Open" }]] },
      { key: "gate.open", vars: { n: 2 } },
    ]);
    expect(fresh.system.save!("a")).toEqual(saved.a);
  });

  it("rides a world save in a view and leaves a headless save as it was", () => {
    const viewed = loaded([sign("a", { text: "Gate" })]);
    viewed.system.set("a", "Open");
    const captured = captureSave(viewed.rt, { depth: "world", slot: "s", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const file = JSON.parse(JSON.stringify(captured.file)) as typeof captured.file;
    expect(JSON.stringify(file.world)).toContain('"Open"');

    const back = loaded([sign("a", { text: "Gate" })]);
    expect(restoreLoaded(back.rt, file)).toBeNull();
    expect(back.texts.at(-1)!.visual).toMatchObject({ lines: [[{ text: "Open" }]] });

    const headless = () => {
      const rt = createSceneRuntime({ rapier: null, view: null, registry: createRegistry() });
      rt.load(scene([sign("a", { text: "Gate" })]));
      return rt;
    };
    const plain = captureSave(headless(), { depth: "world", slot: "s", now: 0 });
    if (!plain.ok) throw new Error(plain.issue.message);
    expect(JSON.stringify(plain.file.world)).not.toContain("text");
    expect(restoreLoaded(headless(), file)).toBeNull();
  });

  it("keeps a set text across a live swap", () => {
    const { rt, system, texts } = loaded([sign("a", { text: "Gate" })]);
    system.set("a", "Open");
    const report = rt.swap(scene([sign("a", { text: "Gate", color: 0x00ff00 })]), {
      prefabs: new Map(),
    });
    expect(report).toMatchObject({ ok: true });
    expect(texts.at(-1)!.visual).toMatchObject({ lines: [[{ text: "Open" }]] });
  });
});

/** A text's lines as the system and the schematics read it. */
const linesOf = (source: string, rich: boolean, vars?: Record<string, number>) =>
  parseRichText(richSource(source, rich), vars).lines;

describe("text rules", () => {
  it("keeps markup literal unless rich, and fills placeholders either way", () => {
    expect(linesOf("[b]a\\[{n}\nz", false, { n: 1 })).toEqual([
      [{ text: "[b]a\\[1" }],
      [{ text: "z" }],
    ]);
    expect(linesOf("[b]a[/b]", true)).toEqual([[{ text: "a", bold: true }]]);
  });

  it("reads direction from the first letter", () => {
    expect(textDirection(linesOf("12 שלום", false))).toBe("rtl");
    expect(textDirection(linesOf("مرحبا", false))).toBe("rtl");
    expect(textDirection(linesOf("1 Hi", false))).toBe("ltr");
    expect(textDirection(linesOf("e\u0301t\u00e9", false))).toBe("ltr");
    expect(textDirection([])).toBe("ltr");
  });

  it("reads the scripts localeDirection calls right to left as right to left", () => {
    for (const [locale, letter] of [
      ["ff-Adlm", "𞤀"],
      ["rhg-Rohg", "𐴀"],
      ["dv-Thaa", "ދ"],
      ["smp-Samr", "ࠀ"],
      ["myz-Mand", "ࡀ"],
      ["phn-Phnx", "𐤀"],
    ] as const) {
      expect(localeDirection(locale)).toBe("rtl");
      expect(textDirection(linesOf(letter, false))).toBe("rtl");
    }
  });

  it("titles its font Font and its key a string-key, and steps its anchor as a fraction", () => {
    const env = { assets: () => [] } as unknown as FieldEnv;
    const shape = <F extends z.ZodRawShape>(fields: F | ((env: FieldEnv) => F)): F =>
      typeof fields === "function" ? fields(env) : fields;
    const meta = (schema: z.core.$ZodType) => z.globalRegistry.get(schema);
    const text = shape(TEXT.fields);
    expect(meta(text.font.unwrap())).toMatchObject({ title: "Font", group: "assets" });
    expect(meta(text.key)).toMatchObject({ widget: "string-key" });
    expect(meta(text.anchor)).toMatchObject({ step: 0.05, decimals: 2 });
    expect(meta(shape(AUDIO.fields).sound)).toMatchObject({ title: "Sound" });
  });

  it("finds a font's face, or none", () => {
    expect(textFontOf(lookup, "pixel")).toEqual({
      kind: "bitmap",
      hash: FNT,
      pages: [PAGE],
      meta: BITMAP,
    });
    expect(textFontOf(lookup, "rounded")).toEqual({ kind: "web", family: WOFF });
    expect(textFontOf(lookup, "crate")).toBeNull();
    expect(textFontOf(lookup, "missing")).toBeNull();
    expect(textFontOf(lookup, undefined)).toBeNull();
    expect(textFontOf(undefined, "pixel")).toBeNull();
    expect(textFontOf(() => ({ kind: "font", font: BITMAP, pages: ["gone"] }), "x")).toBeNull();
  });

  it("measures a BMFont exactly and a web font by an estimate, its box placed by the anchor", () => {
    const lines = linesOf("AV", false);
    const bitmap = measureText(lines, measureFont(textFontOf(lookup, "pixel")), 10);
    expect(bitmap).toEqual({ width: 9, height: 12, exact: true });
    expect(measureText(lines, measureFont(textFontOf(lookup, "rounded")), 10).exact).toBe(false);
    expect(textBoxShape(bitmap, undefined, 1)).toEqual({
      type: "box",
      cx: 0,
      cy: 0,
      hw: 4.5,
      hh: 6,
      rotDeg: 0,
    });
    expect(textBoxShape(bitmap, [1, 0], 100)).toEqual({
      type: "box",
      cx: -0.045,
      cy: 0.06,
      hw: 0.045,
      hh: 0.06,
      rotDeg: 0,
    });
  });

  it("places a schematic box at the entity's pose, turned with it", () => {
    const drawn = textBoxOf(
      { text: "AV", font: "pixel", size: 10, anchor: [0, 0] },
      { at: [100, 50], transform: { rot: 90, flip: false } },
      { asset: lookup, pxPerUnit: 1 },
    );
    expect(drawn).toEqual({
      label: "AV",
      shape: { type: "box", cx: 94, cy: 54.5, hw: 4.5, hh: 6, rotDeg: 90 },
      exact: true,
    });
    expect(textBoxOf("junk", { at: [0, 0] }, { pxPerUnit: 1 })).toBeUndefined();
    expect(textBoxOf({ text: "x" }, {}, { pxPerUnit: 1 })).toBeUndefined();
  });

  it("measures a key in the strings given, with their font when the block names none", () => {
    const drawn = textBoxOf(
      { key: "a.b" },
      { at: [0, 0] },
      { strings: { "a.b": "AV" }, font: textFontOf(lookup, "pixel"), pxPerUnit: 1 },
    );
    expect(drawn).toMatchObject({ label: "AV", key: "a.b", exact: true });
    expect(textBoxOf({ key: "a.b" }, { at: [0, 0] }, { pxPerUnit: 1 })).toMatchObject({
      label: "[a.b]",
      exact: false,
    });
  });
});
