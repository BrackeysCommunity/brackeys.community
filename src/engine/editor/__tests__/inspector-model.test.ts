import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { shapeField, tagsField } from "../../game/fields";
import type { SceneDefinition } from "../../scene/types";
import {
  buildInspectorModel,
  modelBatch,
  modelOps,
  parseRelative,
  refCandidates,
  shapeConversions,
  type InspectorModel,
  type ModelField,
} from "../inspector-model";
import { lookupRef } from "../refs";

const registry = createRegistry(
  defineGame({
    id: "gizmo",
    types: [
      defineEntityType({
        type: "gadget",
        description: "Every kind of field.",
        base: "sensor",
        fields: {
          shape: shapeField("Gadget shape."),
          power: z
            .number()
            .int()
            .describe("How hard it pushes.")
            .meta({ title: "Power", unit: "px" }),
          ratio: z.number().min(0).max(1).describe("A share."),
          mode: z.enum(["idle", "on", "off"]).describe("Mode."),
          color: z.enum(["red", "green", "blue", "cyan", "magenta"]).describe("Colour."),
          armed: z.boolean().optional().describe("Armed."),
          turn: z.number().int().optional().describe("Turn.").meta({ unit: "deg" }),
          target: z.string().optional().describe("What it pokes."),
          glow: z.number().describe("Glow.").meta({ widget: "glow", group: "physics" }),
          tags: tagsField("Labels."),
        },
        refs: [{ field: "target", targets: ["sensor"] }],
        inspector: { order: ["mode"] },
      }),
      defineEntityType({
        type: "tile",
        description: "Boxes only.",
        base: "solid",
        fields: {
          shape: shapeField("Tile.", { types: ["box"], id: "TileShape", owner: "a tile's" }),
        },
        bulk: { form: "shape", description: "Tiles." },
      }),
    ],
    actions: [],
    editor: { widgets: { glow: { kind: "slider", min: 0, max: 10 } } },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const gadget = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "gadget",
  shape: ["box", 10, 10, 5, 5],
  power: 4,
  ratio: 0.5,
  mode: "on",
  color: "red",
  glow: 1,
  ...over,
});

const def: SceneDefinition = {
  v: 1,
  game: "gizmo",
  name: "m",
  bounds: [0, 0, 100, 100],
  tile: [["box", 1, 1, 1, 1]],
  entities: [
    gadget("a", { target: "s1", turn: 90 }),
    gadget("b", { power: 8 }),
    { id: "s1", type: "sensor", shape: ["circle", 5, 5, 2] },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 4, 1],
      path: {
        pts: [
          [0, 0],
          [10, 0],
        ],
        mode: "loop",
        speed: 20,
      },
    },
  ],
};

const targets = (...refs: string[]) => refs.map((r) => lookupRef(def, r)!);
const model = (...refs: string[]) => buildInspectorModel(registry, targets(...refs));
const fields = (m: InspectorModel) => m.sections.flatMap((s) => s.fields);
const field = (m: InspectorModel, path: string): ModelField => {
  const all = (fs: ModelField[]): ModelField[] => fs.flatMap((f) => [f, ...all(f.children ?? [])]);
  const f = all(fields(m)).find((g) => g.path === path);
  if (!f) throw new Error(`no field ${path}`);
  return f;
};

describe("buildInspectorModel", () => {
  const m = model("a");

  it("sections fields by meta.group, else by kind, in the fixed section order", () => {
    expect(m.sections.map((s) => [s.title, s.fields.map((f) => f.path)])).toEqual([
      ["Identity", ["id", "type", "name", "layer", "group", "off"]],
      ["Transform", ["turn"]],
      ["Shape", ["shape"]],
      ["Behavior", ["mode", "power", "ratio", "color", "armed", "target", "tags"]],
      ["Physics", ["glow"]],
    ]);
    expect(m.types).toEqual(["gadget"]);
  });

  it("titles from meta.title and tooltips from describe", () => {
    expect(field(m, "power")).toMatchObject({ title: "Power", description: "How hard it pushes." });
    expect(field(m, "ratio").title).toBe("ratio");
  });

  it("picks a widget per Zod kind", () => {
    expect(field(m, "power").widget).toEqual({
      kind: "number",
      integer: true,
      unit: "px",
      step: 1,
      bigStep: 10,
      scrub: true,
    });
    expect(field(m, "ratio").widget).toEqual({
      kind: "number",
      integer: false,
      min: 0,
      max: 1,
      step: 0.1,
      bigStep: 1,
      scrub: false,
    });
    expect(field(m, "mode").widget).toEqual({
      kind: "segmented",
      options: [
        { value: "idle", label: "idle" },
        { value: "on", label: "on" },
        { value: "off", label: "off" },
      ],
    });
    expect(field(m, "color").widget.kind).toBe("select");
    expect(field(m, "layer").widget.kind).toBe("segmented");
    expect(field(m, "armed")).toMatchObject({ widget: { kind: "switch" }, optional: true });
    expect(field(m, "turn")).toMatchObject({
      widget: { kind: "angle", integer: true, snapDeg: 15 },
      value: 90,
    });
    expect(field(m, "target").widget).toEqual({
      kind: "entity-ref",
      accepts: ["sensor"],
      multiple: false,
    });
    expect(field(m, "tags").widget).toEqual({ kind: "tags" });
    expect(field(m, "shape").widget).toEqual({
      kind: "shape",
      types: ["box", "circle", "capsule", "poly", "chain"],
    });
    expect(field(m, "id")).toMatchObject({ readonly: true, widget: { kind: "text" } });
    expect(field(m, "type")).toMatchObject({ readonly: true, widget: { kind: "readonly" } });
  });

  it("carries a game's custom widget for the site to render", () => {
    expect(field(m, "glow").widget).toEqual({
      kind: "custom",
      id: "glow",
      widget: { kind: "slider", min: 0, max: 10 },
    });
  });

  it("describes a point field and a path's mode, speed, pause and points", () => {
    const lift = model("lift");
    const path = field(lift, "path");
    expect(path).toMatchObject({ section: "path", widget: { kind: "path" } });
    expect(path.children!.map((c) => [c.path, c.widget.kind, c.section])).toEqual([
      ["path.pts", "points", "path"],
      ["path.mode", "segmented", "path"],
      ["path.speed", "number", "path"],
      ["path.pauseMs", "number", "path"],
    ]);
    expect(field(lift, "path.speed")).toMatchObject({
      value: 20,
      widget: { unit: "px/s", scrub: true },
    });
    const marker = buildInspectorModel(registry, [
      { kind: "entity", ref: "m", index: 0, entity: { id: "m", type: "marker", at: [1, 2] } },
    ]);
    expect(field(marker, "at")).toMatchObject({
      section: "transform",
      value: [1, 2],
      widget: { kind: "point", pick: true, unit: "px" },
    });
  });

  it("limits a shape field to the types its schema allows, and a bulk entry to its one field", () => {
    const tile = model("~tile:0");
    expect(fields(tile).map((f) => f.path)).toEqual(["shape"]);
    expect(field(tile, "shape")).toMatchObject({
      value: ["box", 1, 1, 1, 1],
      widget: { kind: "shape", types: ["box"] },
    });
  });

  it("shows only shared fields for several targets, mixed where they differ", () => {
    const both = model("a", "b");
    expect(field(both, "power")).toMatchObject({ mixed: true, value: undefined });
    expect(field(both, "mode")).toMatchObject({ mixed: false, value: "on" });
    expect(field(both, "id").mixed).toBe(true);

    const mixed = model("a", "s1");
    expect(fields(mixed).map((f) => f.path)).toEqual([
      "id",
      "type",
      "name",
      "layer",
      "group",
      "off",
      "shape",
      "tags",
    ]);
    expect(field(mixed, "type").mixed).toBe(true);
    expect(model("a", "~tile:0").sections).toEqual([]);
  });

  it("marks mixed values inside a path", () => {
    const other = structuredClone(def.entities![3]!);
    (other.path as { speed: number }).speed = 40;
    const m2 = buildInspectorModel(registry, [
      targets("lift")[0]!,
      { kind: "entity", ref: "lift-2", index: 4, entity: { ...other, id: "lift-2" } },
    ]);
    expect(field(m2, "path.speed").mixed).toBe(true);
    expect(field(m2, "path.mode")).toMatchObject({ mixed: false, value: "loop" });
    expect(field(m2, "path").mixed).toBe(true);
  });
});

describe("parseRelative", () => {
  it("reads plain numbers and relative edits", () => {
    expect(parseRelative("12", 3)).toBe(12);
    expect(parseRelative(" -4.5 ", 3)).toBe(-4.5);
    expect(parseRelative("+=16", 3)).toBe(19);
    expect(parseRelative("-=4", 3)).toBe(-1);
    expect(parseRelative("*=2", 3)).toBe(6);
    expect(parseRelative("/=2", 3)).toBe(1.5);
    expect(parseRelative("+=16", undefined)).toBeUndefined();
    expect(parseRelative("/=0", 3)).toBeUndefined();
    expect(parseRelative("abc", 3)).toBeUndefined();
  });
});

describe("modelOps", () => {
  const both = model("a", "b");

  it("applies a relative edit to each target's own value, one update each", () => {
    expect(modelOps(field(both, "power"), "+=16", targets("a", "b"))).toEqual({
      ok: true,
      ops: [
        { op: "update", ref: "a", set: { power: 20 } },
        { op: "update", ref: "b", set: { power: 24 } },
      ],
    });
  });

  it("skips targets that already hold the value and unsets optional fields", () => {
    expect(modelOps(field(both, "mode"), "on", targets("a", "b"))).toEqual({ ok: true, ops: [] });
    expect(modelOps(field(model("a"), "turn"), undefined, targets("a"))).toEqual({
      ok: true,
      ops: [{ op: "update", ref: "a", unset: ["turn"] }],
    });
  });

  it("refuses values the schema rejects", () => {
    expect(modelOps(field(both, "ratio"), 2, targets("a")).ok).toBe(false);
    expect(modelOps(field(both, "mode"), "boom", targets("a")).ok).toBe(false);
    expect(modelOps(field(both, "power"), "lots", targets("a")).ok).toBe(false);
    expect(modelOps(field(both, "power"), undefined, targets("a")).ok).toBe(false);
  });

  it("edits nested fields by their dot path, and batches bulk edits with a base", () => {
    const lift = model("lift");
    expect(modelOps(field(lift, "path.speed"), "*=2", targets("lift"))).toEqual({
      ok: true,
      ops: [{ op: "update", ref: "lift", set: { "path.speed": 40 } }],
    });
    const tile = model("~tile:0");
    const r = modelBatch(field(tile, "shape"), ["box", 1, 1, 2, 2], targets("~tile:0"), def);
    expect(r.ok && r.batch).toMatchObject({
      label: "Set Shape",
      base: expect.any(String),
      ops: [{ op: "update", ref: "~tile:0", set: { shape: ["box", 1, 1, 2, 2] } }],
    });
  });
});

describe("refCandidates", () => {
  it("lists entities whose type or base is accepted", () => {
    expect(refCandidates(def, registry, ["sensor"])).toEqual(["a", "b", "s1"]);
    expect(refCandidates(def, registry, ["follower"])).toEqual(["lift"]);
  });
});

describe("shapeConversions", () => {
  it("says which tag switches are lossless", () => {
    const box = shapeConversions(["box", 0, 0, 4, 2]);
    expect(box.map((c) => [c.to, c.lossless])).toEqual([
      ["circle", false],
      ["capsule", false],
      ["poly", true],
      ["chain", false],
    ]);
    expect(box.find((c) => c.to === "poly")!.tuple).toEqual(["poly", -4, -2, 4, -2, 4, 2, -4, 2]);
    expect(shapeConversions(["box", 0, 0, 4, 2, 30]).find((c) => c.to === "poly")!.lossless).toBe(
      false,
    );
    expect(shapeConversions(["poly", -4, -2, 4, -2, 4, 2, -4, 2], ["box"])).toEqual([
      { to: "box", tuple: ["box", 0, 0, 4, 2], lossless: true },
    ]);
    expect(
      shapeConversions(["chain", 0, 0, 4, 0, 0, 4, 0, 0], ["poly"]).map((c) => [
        c.lossless,
        c.tuple,
      ]),
    ).toEqual([[true, ["poly", 0, 0, 4, 0, 0, 4]]]);
    expect(shapeConversions(["box", 0, 0, 8, 2], ["capsule"])[0]!.tuple).toEqual([
      "capsule",
      0,
      0,
      6,
      2,
      90,
    ]);
  });
});
