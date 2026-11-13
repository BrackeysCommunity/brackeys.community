import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { GLOW, SPIN, testGame } from "../../__tests__/fixtures/test-game";
import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineEntityType, defineGame, ENGINE_BEHAVIORS } from "../../game/define";
import { assetField, pointField, shapeField, tagsField } from "../../game/fields";
import { applyOps } from "../../scene/ops";
import { prefabLibrary } from "../../scene/prefab";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import {
  buildInspectorModel,
  instanceParamsModel,
  instanceTransformModel,
  instanceZBatch,
  lengthStep,
  modelBatch,
  modelOps,
  overlappingKeys,
  paramBatch,
  paramOverriddenBy,
  parseRelative,
  refCandidates,
  shapeConversions,
  type InspectorModel,
  type ModelField,
} from "../inspector-model";
import { lookupRef } from "../refs";
import { settingsRows } from "../settings-model";

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
  it("offers the registry's layers as the layer field's choices", () => {
    const names = ["sky", "far-hills", "ground", "actors", "fx", "notes"];
    const layered = createRegistry(
      defineGame({
        id: "layered",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        layers: names.map((name, i) => ({ name, description: `${name}.`, draw: i })),
      }),
    );
    const doc: SceneDefinition = {
      v: 1,
      game: "layered",
      name: "l",
      bounds: [0, 0, 100, 100],
      entities: [{ id: "s", type: "sensor", layer: "ground", shape: ["circle", 5, 5, 2] }],
    };
    const m = buildInspectorModel(layered, [lookupRef(doc, "s")!]);
    expect(field(m, "layer")).toMatchObject({
      value: "ground",
      widget: {
        kind: "select",
        options: [
          { value: "sky", label: "sky" },
          { value: "far-hills", label: "far hills" },
          { value: "ground", label: "ground" },
          { value: "actors", label: "actors" },
          { value: "fx", label: "fx" },
          { value: "notes", label: "notes" },
        ],
      },
    });
    const two = createRegistry(
      defineGame({
        id: "two",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        layers: [
          { name: "back", description: "", draw: 0 },
          { name: "front", description: "", draw: 1 },
        ],
      }),
    );
    expect(field(buildInspectorModel(two, [lookupRef(doc, "s")!]), "layer").widget).toEqual({
      kind: "segmented",
      options: [
        { value: "back", label: "back" },
        { value: "front", label: "front" },
      ],
    });
  });

  it("offers a one-way side as the four sides, showing `true` as up", () => {
    const doc: SceneDefinition = {
      v: 1,
      name: "w",
      bounds: [0, 0, 100, 100],
      entities: [
        { id: "p", type: "solid", shape: ["box", 5, 5, 20, 2], oneWay: true },
        { id: "q", type: "solid", shape: ["box", 5, 15, 20, 2], oneWay: "up" },
        { id: "r", type: "solid", shape: ["box", 5, 25, 20, 2], oneWay: "left" },
        { id: "w", type: "solid", shape: ["box", 5, 35, 20, 2] },
      ],
    };
    const engine = createRegistry();
    const solids = (...ids: string[]) =>
      buildInspectorModel(
        engine,
        ids.map((id) => lookupRef(doc, id)!),
      );
    expect(field(solids("p"), "oneWay")).toMatchObject({
      value: "up",
      optional: true,
      section: "physics",
      widget: {
        kind: "segmented",
        options: ["up", "right", "down", "left"].map((v) => ({ value: v, label: v })),
      },
    });
    expect(field(solids("p", "q"), "oneWay")).toMatchObject({ value: "up", mixed: false });
    expect(field(solids("p", "r"), "oneWay").mixed).toBe(true);
    expect(field(solids("w"), "oneWay").value).toBeUndefined();
  });

  const m = model("a");

  it("sections fields by meta.group, else by kind, in the fixed section order", () => {
    expect(m.sections.map((s) => [s.title, s.fields.map((f) => f.path)])).toEqual([
      ["Identity", ["id", "type", "name", "layer", "group", "off", "z"]],
      ["Transform", ["turn"]],
      ["Shape", ["shape"]],
      ["Gameplay", ["mode", "power", "ratio", "color", "armed", "target", "tags"]],
      ["Physics", ["glow"]],
    ]);
    expect(m.types).toEqual(["gadget"]);
  });

  it("titles from meta.title and tooltips from describe", () => {
    expect(field(m, "power")).toMatchObject({ title: "Power", description: "How hard it pushes." });
    expect(field(m, "ratio").title).toBe("Ratio");
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
    expect(field(m, "layer").widget).toEqual({
      kind: "segmented",
      options: ["terrain", "decor", "gameplay", "editor"].map((v) => ({ value: v, label: v })),
    });
    expect(field(m, "z").widget).toMatchObject({
      kind: "number",
      integer: true,
      min: -10000,
      max: 10000,
    });
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
      widget: { unit: "m/s", scrub: true, step: 0.01, bigStep: 0.1, decimals: 2 },
    });
    const marker = buildInspectorModel(registry, [
      { kind: "entity", ref: "m", index: 0, entity: { id: "m", type: "marker", at: [1, 2] } },
    ]);
    expect(field(marker, "at")).toMatchObject({
      section: "transform",
      value: [1, 2],
      widget: { kind: "point", pick: true, unit: "m", step: 0.01, decimals: 2 },
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
      "z",
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

const GATE: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  game: "gizmo",
  id: "gate",
  entities: [
    def.entities![3]!,
    { id: "door", type: "sensor", shape: ["circle", 0, 0, 3] },
    gadget("knob"),
  ],
  params: {
    speed: { description: "How fast the lift goes.", targets: ["lift.path.speed"] },
    mode: { description: "The knob's mode.", targets: ["knob.mode"], default: "off" },
  },
};
const ROOM: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  game: "gizmo",
  id: "room",
  entities: [],
  instances: [{ id: "gate-1", prefab: "gate", at: [0, 0] }],
  params: { pace: { description: "Its gate's pace.", targets: ["gate-1.params.speed"] } },
};
const prefabs = prefabLibrary([GATE, ROOM]);
const placed: SceneDefinition = {
  ...def,
  instances: [
    { id: "gate-2", prefab: "gate", at: [50, 50], params: { speed: 40 } },
    { id: "room-1", prefab: "room", at: [0, 0], overrides: { "gate-1.params.mode": "on" } },
  ],
};

describe("refCandidates", () => {
  it("lists entities whose type or base is accepted", () => {
    expect(refCandidates(def, registry, ["sensor"])).toEqual(["a", "b", "s1"]);
    expect(refCandidates(def, registry, ["follower"])).toEqual(["lift"]);
  });

  it("includes instances' children of the accepted types by their resolved refs, at any depth", () => {
    expect(refCandidates(placed, registry, ["follower"], prefabs)).toEqual([
      "lift",
      "gate-2/lift",
      "room-1/gate-1/lift",
    ]);
    expect(refCandidates(placed, registry, ["sensor"], prefabs)).toEqual([
      "a",
      "b",
      "s1",
      "gate-2/door",
      "gate-2/knob",
      "room-1/gate-1/door",
      "room-1/gate-1/knob",
    ]);
    expect(refCandidates(placed, registry, ["follower"])).toEqual(["lift"]);
  });
});

describe("instance parameters", () => {
  const params = (ref: string) => instanceParamsModel(placed, ref, registry, prefabs)!;
  const param = (ref: string, name: string) => params(ref).params.find((p) => p.name === name)!;

  it("lists the prefab's params, each typed by its first target's schema", () => {
    const m = params("gate-2");
    expect(m).toMatchObject({ ref: "gate-2", instance: "gate-2" });
    expect(m.nested).toBeUndefined();
    expect(m.params.map((p) => [p.name, p.set])).toEqual([
      ["speed", true],
      ["mode", false],
    ]);
    expect(param("gate-2", "speed")).toMatchObject({
      description: "How fast the lift goes.",
      targets: ["lift.path.speed"],
      field: {
        path: "params.speed",
        name: "speed",
        title: "speed",
        description: "How fast the lift goes.",
        widget: { kind: "number", unit: "m/s" },
        value: 40,
        defaultValue: 20,
        optional: true,
        readonly: false,
      },
    });
    expect(param("gate-2", "mode").field).toMatchObject({
      widget: {
        kind: "segmented",
        options: [{ value: "idle" }, { value: "on" }, { value: "off" }],
      },
      defaultValue: "off",
    });
    expect(param("gate-2", "mode").field.value).toBeUndefined();
  });

  it("sets a param with setParam, relative edits against its value, and clears it with null", () => {
    const m = params("gate-2");
    const speed = param("gate-2", "speed");
    expect(paramBatch(m, speed, "*=2")).toEqual({
      ok: true,
      batch: {
        label: "Set gate-2's speed",
        ops: [{ op: "setParam", ref: "gate-2", name: "speed", value: 80 }],
      },
    });
    expect(paramBatch(m, speed, undefined)).toMatchObject({
      ok: true,
      batch: { ops: [{ op: "setParam", ref: "gate-2", name: "speed", value: null }] },
    });
    expect(paramBatch(m, speed, 40)).toMatchObject({ ok: true, batch: { ops: [] } });
    const mode = param("gate-2", "mode");
    expect(paramBatch(m, mode, "on")).toMatchObject({
      ok: true,
      batch: { ops: [{ op: "setParam", ref: "gate-2", name: "mode", value: "on" }] },
    });
    expect(paramBatch(m, mode, "sideways").ok).toBe(false);
  });

  it("writes a nested instance's param as an override on its scene instance", () => {
    const m = params("room-1/gate-1");
    expect(m).toMatchObject({ ref: "room-1/gate-1", instance: "room-1", nested: "gate-1" });
    const mode = param("room-1/gate-1", "mode");
    expect(mode).toMatchObject({ set: true, field: { value: "on" } });
    expect(paramBatch(m, mode, "idle")).toMatchObject({
      ok: true,
      batch: { ops: [{ op: "override", ref: "room-1", set: { "gate-1.params.mode": "idle" } }] },
    });
    expect(paramBatch(m, mode, undefined)).toMatchObject({
      ok: true,
      batch: { ops: [{ op: "revertOverride", ref: "room-1", paths: ["gate-1.params.mode"] }] },
    });
    const speed = param("room-1/gate-1", "speed");
    expect(speed.set).toBe(false);
    expect(paramBatch(m, speed, undefined)).toMatchObject({ ok: true, batch: { ops: [] } });
  });

  it("types a param that feeds a nested instance's param by that param's first target", () => {
    expect(param("room-1", "pace").field).toMatchObject({
      path: "params.pace",
      widget: { kind: "number", unit: "m/s" },
      defaultValue: 20,
    });
  });

  it("names the overrides that beat a param's target, at, above or under it", () => {
    const shadowed: SceneDefinition = {
      ...placed,
      instances: [
        { ...placed.instances![0]!, overrides: { "lift.path": { speed: 9 }, "knob.at": [1, 1] } },
        {
          ...placed.instances![1]!,
          overrides: { "gate-1.params.mode": "on", "gate-1/lift.path.speed": 3 },
        },
      ],
    };
    const of = (ref: string, name: string) => {
      const m = instanceParamsModel(shadowed, ref, registry, prefabs)!;
      return paramOverriddenBy(shadowed, m, m.params.find((p) => p.name === name)!);
    };
    expect(of("gate-2", "speed")).toEqual(["lift.path"]);
    expect(of("gate-2", "mode")).toEqual([]);
    expect(of("room-1/gate-1", "speed")).toEqual(["gate-1/lift.path.speed"]);
    expect(of("room-1/gate-1", "mode")).toEqual([]);
    expect(overlappingKeys(["a.b", "a.bc", "a.b.c", "a"], "a.b")).toEqual(["a.b", "a.b.c", "a"]);
  });

  it("is null for a ref that names no instance or a missing prefab", () => {
    expect(instanceParamsModel(placed, "a", registry, prefabs)).toBeNull();
    expect(instanceParamsModel(placed, "gate-2", registry, new Map())).toBeNull();
  });
});

describe("instance placement", () => {
  const turned: SceneDefinition = {
    ...placed,
    instances: [{ ...placed.instances![0]!, rot: 1, flip: true, z: 3 }, placed.instances![1]!],
  };

  it("reads a scene instance's turns, mirror and z, and a nested one's without editing", () => {
    expect(instanceTransformModel(turned, "gate-2", prefabs)).toEqual({
      ref: "gate-2",
      rot: 1,
      flip: true,
      z: 3,
      editable: true,
    });
    expect(instanceTransformModel(placed, "gate-2", prefabs)).toMatchObject({
      rot: 0,
      flip: false,
      z: 0,
    });
    expect(instanceTransformModel(placed, "room-1/gate-1", prefabs)).toMatchObject({
      ref: "room-1/gate-1",
      editable: false,
    });
    expect(instanceTransformModel(placed, "a", prefabs)).toBeNull();
  });

  it("sets z with one setZ, relative edits against the current z, and checks the bounds", () => {
    const m = instanceTransformModel(turned, "gate-2", prefabs)!;
    expect(instanceZBatch(m, "+=2")).toEqual({
      ok: true,
      batch: { label: "Set gate-2's z", ops: [{ op: "setZ", refs: ["gate-2"], z: 5 }] },
    });
    expect(instanceZBatch(m, "-4")).toMatchObject({
      ok: true,
      batch: { ops: [{ op: "setZ", refs: ["gate-2"], z: -4 }] },
    });
    expect(instanceZBatch(m, "3")).toMatchObject({ ok: true, batch: { ops: [] } });
    expect(instanceZBatch(m, "1.6")).toMatchObject({ ok: true, batch: { ops: [{ z: 2 }] } });
    expect(instanceZBatch(m, "20000").ok).toBe(false);
    expect(instanceZBatch(m, "high").ok).toBe(false);
    const nested = instanceTransformModel(placed, "room-1/gate-1", prefabs)!;
    expect(instanceZBatch(nested, "1").ok).toBe(false);
  });

  it("writes a z the scene keeps", () => {
    const m = instanceTransformModel(placed, "gate-2", prefabs)!;
    const r = instanceZBatch(m, "7");
    if (!r.ok) throw new Error(r.error);
    const out = applyOps(placed, r.batch, registry, { prefabs });
    expect(out.ok && out.def.instances![0]!.z).toBe(7);
  });
});

describe("metric fields", () => {
  const metric = (lengthUnit?: number) =>
    createRegistry(
      defineGame({
        id: "metric",
        ...(lengthUnit ? { world: { lengthUnit } } : {}),
        types: [
          defineEntityType({
            type: "probe",
            description: "Lengths in metres.",
            base: "marker",
            fields: {
              at: pointField("Where it sits."),
              reach: z.number().describe("How far it reaches, m.").meta({ unit: "m" }),
              pace: z.number().describe("How fast it goes, m/s.").meta({ unit: "m/s" }),
              pull: z.number().describe("How hard it pulls, m/s².").meta({ unit: "m/s²" }),
            },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
  const probe = { id: "p", type: "probe", at: [1, 2], reach: 1.5, pace: 2, pull: 9.8 };
  const target = { kind: "entity" as const, ref: "p", index: 0, entity: probe };
  const of = (lengthUnit?: number) => buildInspectorModel(metric(lengthUnit), [target]);

  it("steps an m field one world px and shows the decimals one px needs", () => {
    expect(field(of(), "reach").widget).toMatchObject({
      kind: "number",
      unit: "m",
      step: 0.01,
      bigStep: 0.1,
      decimals: 2,
      scrub: true,
    });
    expect(field(of(32), "reach").widget).toMatchObject({
      step: 1 / 32,
      bigStep: 10 / 32,
      decimals: 5,
    });
    expect(field(of(48), "reach").widget).toMatchObject({ step: 1 / 48, decimals: 6 });
    expect(field(of(32), "at").widget).toMatchObject({
      unit: "m",
      step: 1 / 32,
      bigStep: 10 / 32,
      decimals: 5,
    });
    expect(lengthStep("m", 32)).toEqual({ step: 1 / 32, bigStep: 10 / 32, decimals: 5 });
  });

  it("steps m/s and m/s² fields 0.01 at any px per metre", () => {
    for (const ppm of [undefined, 32]) {
      expect(field(of(ppm), "pace").widget).toMatchObject({
        step: 0.01,
        bigStep: 0.1,
        decimals: 2,
      });
      expect(field(of(ppm), "pull").widget).toMatchObject({ step: 0.01, decimals: 2 });
    }
  });

  it("writes typed and stepped metric values to micrometres", () => {
    const m = of(48);
    const reach = field(m, "reach");
    const step = reach.widget.kind === "number" ? reach.widget.step : NaN;
    expect(modelOps(reach, (reach.value as number) + step, [target])).toEqual({
      ok: true,
      ops: [{ op: "update", ref: "p", set: { reach: 1.520833 } }],
    });
    expect(modelOps(reach, "+=0.0000004", [target])).toEqual({ ok: true, ops: [] });
    expect(modelOps(field(m, "at"), [1.23456789, 2], [target])).toEqual({
      ok: true,
      ops: [{ op: "update", ref: "p", set: { at: [1.234568, 2] } }],
    });
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

  it("lands converted points and sizes on whole world px", () => {
    // An octagon from a 0.1 m circle: its corners at 100 px per metre, then at 32.
    const at100 = shapeConversions(["circle", 0, 0, 0.1], ["poly"])[0]!.tuple;
    expect(at100).toEqual([
      "poly",
      0.1,
      0,
      0.07,
      0.07,
      0,
      0.1,
      -0.07,
      0.07,
      -0.1,
      0,
      -0.07,
      -0.07,
      0,
      -0.1,
      0.07,
      -0.07,
    ]);
    const at32 = shapeConversions(["circle", 0, 0, 0.1], ["poly"], 32)[0]!.tuple;
    expect(
      (at32.slice(1) as number[]).every((v) => Math.abs(v * 32 - Math.round(v * 32)) < 1e-4),
    ).toBe(true);
    // A circle becomes a capsule one world px longer each way.
    expect(shapeConversions(["circle", 0, 0, 0.2], ["capsule"], 100)[0]!.tuple).toEqual([
      "capsule",
      0,
      0,
      0.01,
      0.2,
    ]);
  });
});

describe("behavior sections", () => {
  const BADGE = defineBehavior({
    name: "badges/badge",
    description: "A badge with a rank and a kind.",
    fields: {
      rank: z.number().int().min(1).max(9).describe("Its rank."),
      kind: z.enum(["gold", "silver"]).describe("Its kind."),
      note: z.string().optional().describe("A note."),
      art: z.string().optional().describe("Its art.").meta({ title: "Art", group: "assets" }),
    },
  });
  const badges = createRegistry(
    defineGame({
      id: "badges",
      types: [
        defineEntityType({
          type: "medal",
          description: "A medal.",
          base: "marker",
          fields: {
            at: pointField("Where it hangs."),
            art: z.string().optional().describe("Its art.").meta({ group: "assets" }),
          },
        }),
      ],
      behaviors: [BADGE],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const games = createRegistry(testGame);
  const doc: SceneDefinition = {
    v: 2,
    game: "test-game",
    name: "b",
    bounds: [0, 0, 100, 100],
    entities: [
      { id: "lamp", type: "lamp", at: [10, 10] },
      {
        id: "lamp-2",
        type: "lamp",
        at: [20, 10],
        behaviors: { [SPIN.name]: {}, [GLOW.name]: { color: "#00ff00" } },
      },
      { id: "spot", type: "marker", at: [30, 10], behaviors: { [SPIN.name]: { speed: 45 } } },
      { id: "dull", type: "plain", at: [40, 10] },
    ],
  };
  const of = (reg: typeof games, def: SceneDefinition, ...refs: string[]) =>
    buildInspectorModel(
      reg,
      refs.map((r) => lookupRef(def, r)!),
    );
  const sectionOf = (m: InspectorModel, id: string) => m.sections.find((s) => s.id === id);

  it("gives each carried behavior a section titled by its label, fields in its order", () => {
    const m = of(games, doc, "lamp");
    expect(m.sections.map((s) => s.id)).toEqual([
      "identity",
      "transform",
      `behaviors:${GLOW.name}`,
    ]);
    const glow = sectionOf(m, `behaviors:${GLOW.name}`)!;
    expect(glow.title).toBe("Glow");
    expect(glow.fields.map((f) => [f.path, f.defaultValue, f.optional])).toEqual([
      [`behaviors.${GLOW.name}.intensity`, 2, true],
      [`behaviors.${GLOW.name}.color`, "#ffcc00", true],
    ]);
    expect(glow.behavior).toEqual({ name: GLOW.name, description: GLOW.description });
    expect(m.addBehaviors.map((o) => [o.name, o.label])).toEqual([
      ...ENGINE_BEHAVIORS.map((b) => [b.name, b.inspector?.label ?? b.name]),
      [SPIN.name, SPIN.name],
    ]);
  });

  it("lists the engine's lifetime with its three fields and description, no special case", () => {
    const timed: SceneDefinition = {
      ...doc,
      entities: [{ id: "spark", type: "marker", at: [5, 5], behaviors: { lifetime: { ms: 250 } } }],
    };
    const section = sectionOf(of(games, timed, "spark"), "behaviors:lifetime")!;
    expect(section.title).toBe("lifetime");
    expect(section.behavior).toMatchObject({
      name: "lifetime",
      description: "Destroys or disables the entity a time after it spawns or is enabled.",
    });
    expect(section.fields.map((f) => [f.path, f.value, f.optional])).toEqual([
      ["behaviors.lifetime.ticks", undefined, true],
      ["behaviors.lifetime.ms", 250, true],
      ["behaviors.lifetime.then", undefined, true],
    ]);
  });

  it("edits a nav-agent's destination as an entity, or as a world point to pick when it holds one", () => {
    const walkers: SceneDefinition = {
      ...doc,
      entities: [
        { id: "a", type: "marker", at: [1, 1], behaviors: { "nav-agent": {} } },
        { id: "b", type: "marker", at: [2, 2], behaviors: { "nav-agent": { to: "a" } } },
        { id: "c", type: "marker", at: [3, 3], behaviors: { "nav-agent": { to: [4, 5] } } },
      ],
    };
    const to = (ref: string) => field(of(games, walkers, ref), "behaviors.nav-agent.to");
    const picker = { kind: "entity-ref", accepts: [], multiple: false, any: true };
    expect(to("a")).toMatchObject({ widget: picker, value: undefined, optional: true });
    expect(to("b")).toMatchObject({ widget: picker, value: "a" });
    expect(to("c")).toMatchObject({
      widget: { kind: "point", pick: true, unit: "m" },
      value: [4, 5],
    });
  });

  it("reads written values, and keeps the type's own fields out of the behaviors key", () => {
    const m = of(games, doc, "lamp-2");
    expect(m.sections.map((s) => s.title)).toEqual(["Identity", "Transform", "Glow", SPIN.name]);
    expect(field(m, `behaviors.${GLOW.name}.color`).value).toBe("#00ff00");
    expect(field(m, `behaviors.${SPIN.name}.speed`)).toMatchObject({
      value: undefined,
      defaultValue: 30,
    });
    expect(fields(m).some((f) => f.path === "behaviors")).toBe(false);
    expect(m.addBehaviors.map((o) => o.name)).toEqual(ENGINE_BEHAVIORS.map((b) => b.name));
    expect(of(games, doc, "spot").sections.at(-1)!.fields[0]).toMatchObject({
      value: 45,
      defaultValue: 90,
    });
  });

  it("removes an optional behavior with one update per target, a required one never", () => {
    const m = of(games, doc, "lamp-2", "spot");
    expect(m.sections.map((s) => s.id)).toEqual([
      "identity",
      "transform",
      `behaviors:${SPIN.name}`,
    ]);
    const remove = m.sections.at(-1)!.behavior!.remove!;
    expect(remove).toEqual({
      label: `Remove ${SPIN.name} from 2 entities`,
      ops: [
        { op: "update", ref: "lamp-2", unset: [`behaviors.${SPIN.name}`] },
        { op: "update", ref: "spot", unset: ["behaviors"] },
      ],
    });
    const r = applyOps(doc, remove, games);
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.def.entities![1]!.behaviors).toEqual({ [GLOW.name]: { color: "#00ff00" } });
    expect(r.def.entities![2]!.behaviors).toBeUndefined();
    expect(sectionOf(of(games, doc, "lamp"), `behaviors:${GLOW.name}`)!.behavior!.remove).toBe(
      undefined,
    );
  });

  it("adds a behavior the types allow with one update per target lacking it", () => {
    const m = of(games, doc, "lamp", "spot");
    expect(m.sections.some((s) => s.id.startsWith("behaviors:"))).toBe(false);
    expect(m.addBehaviors.map((o) => o.name)).toEqual([
      ...ENGINE_BEHAVIORS.map((b) => b.name),
      GLOW.name,
      SPIN.name,
    ]);
    const offered = (name: string) => m.addBehaviors.find((o) => o.name === name)!.batch;
    expect(offered(GLOW.name)).toEqual({
      label: "Add Glow to spot",
      ops: [{ op: "update", ref: "spot", set: { [`behaviors.${GLOW.name}`]: {} } }],
    });
    const add = offered(SPIN.name);
    expect(add).toEqual({
      label: `Add ${SPIN.name} to lamp`,
      ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${SPIN.name}`]: {} } }],
    });
    const r = applyOps(doc, add, games);
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.def.entities![0]!.behaviors).toEqual({ [SPIN.name]: {} });
    // `plain` forbids every behavior, so nothing is offered alongside it.
    expect(of(games, doc, "dull").addBehaviors).toEqual([]);
    expect(of(games, doc, "spot", "dull").addBehaviors).toEqual([]);
  });

  it("adds a behavior from its template, so a block `{}` would fail is still valid", () => {
    const add = of(games, doc, "lamp").addBehaviors.find((o) => o.name === "lifetime")!.batch;
    expect(add).toEqual({
      label: "Add lifetime to lamp",
      ops: [{ op: "update", ref: "lamp", set: { "behaviors.lifetime": { ticks: 60 } } }],
    });
    const r = applyOps(doc, add, games);
    if (!r.ok) throw new Error(r.issue.message);
    expect(r.def.entities![0]!.behaviors).toMatchObject({ lifetime: { ticks: 60 } });
  });

  it("keeps the template under a type's own defaults, unless together they fail the refine", () => {
    const fuses = createRegistry(
      defineGame({
        id: "fuses",
        types: [
          defineEntityType({
            type: "fuse",
            description: "Goes dark after a while.",
            base: "marker",
            fields: { at: pointField("Where it burns.") },
            behaviors: { defaults: { lifetime: { then: "disable" } } },
          }),
          defineEntityType({
            type: "flash",
            description: "Gone in half a second.",
            base: "marker",
            fields: { at: pointField("Where it flashes.") },
            behaviors: { defaults: { lifetime: { ms: 500 } } },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const scene: SceneDefinition = {
      v: 2,
      game: "fuses",
      name: "f",
      bounds: [0, 0, 100, 100],
      entities: [
        { id: "fuse", type: "fuse", at: [10, 10] },
        { id: "flash", type: "flash", at: [20, 10] },
      ],
    };
    const added = (ref: string) => {
      const add = of(fuses, scene, ref).addBehaviors.find((o) => o.name === "lifetime")!.batch;
      const r = applyOps(scene, add, fuses);
      if (!r.ok) throw new Error(r.issue.message);
      return add.ops[0];
    };
    expect(added("fuse")).toEqual({
      op: "update",
      ref: "fuse",
      set: { "behaviors.lifetime": { ticks: 60 } },
    });
    expect(added("flash")).toEqual({
      op: "update",
      ref: "flash",
      set: { "behaviors.lifetime": {} },
    });
  });

  it("gives the engine's sprite a section of its fields, its asset a picker and its tint a colour", () => {
    const sprited: SceneDefinition = {
      v: 2,
      name: "s",
      bounds: [0, 0, 100, 100],
      entities: [
        { id: "pic", type: "marker", at: [5, 5], behaviors: { sprite: { tint: 0xff0000 } } },
      ],
    };
    const m = of(createRegistry(), sprited, "pic");
    const section = sectionOf(m, "behaviors:sprite")!;
    expect(section.title).toBe("sprite");
    expect(section.fields.map((f) => f.name)).toEqual([
      "asset",
      "frame",
      "size",
      "scale",
      "anchor",
      "offset",
      "tint",
      "alpha",
      "flipX",
      "flipY",
      "blend",
      "tile",
      "nineSlice",
      "turn",
    ]);
    expect(field(m, "behaviors.sprite.asset").widget).toEqual({
      kind: "asset",
      kinds: ["texture", "atlas"],
      frame: "behaviors.sprite.frame",
    });
    expect(field(m, "behaviors.sprite.frame").widget.kind).toBe("text");
    expect(field(m, "behaviors.sprite.tint")).toMatchObject({
      value: 0xff0000,
      widget: { kind: "color" },
    });
    expect(field(m, "behaviors.sprite.blend").widget).toMatchObject({ kind: "segmented" });
    expect(field(m, "behaviors.sprite.flipX").widget.kind).toBe("switch");
  });

  it("seeds the fields with no default so an added block validates, and edits by dot path", () => {
    const medals: SceneDefinition = {
      v: 2,
      game: "badges",
      name: "m",
      bounds: [0, 0, 100, 100],
      entities: [{ id: "m1", type: "medal", at: [5, 5] }],
    };
    const m = of(badges, medals, "m1");
    expect(sectionOf(m, "assets")).toMatchObject({ title: "Assets", fields: [{ path: "art" }] });
    const add = m.addBehaviors.find((o) => o.name === BADGE.name)!;
    expect(add).toMatchObject({ name: BADGE.name, label: BADGE.name });
    expect(add.batch.ops).toEqual([
      { op: "update", ref: "m1", set: { [`behaviors.${BADGE.name}`]: { rank: 1, kind: "gold" } } },
    ]);
    const added = applyOps(medals, add.batch, badges);
    if (!added.ok) throw new Error(added.issue.message);
    const after = of(badges, added.def, "m1");
    const badge = sectionOf(after, `behaviors:${BADGE.name}`)!;
    // A behavior's asset field stays in the behavior's section.
    expect(badge.fields.map((f) => f.name)).toEqual(["rank", "kind", "note", "art"]);
    expect(badge.fields.map((f) => f.optional)).toEqual([false, false, true, true]);
    const rank = field(after, `behaviors.${BADGE.name}.rank`);
    const edit = modelBatch(rank, "+=2", [lookupRef(added.def, "m1")!], added.def);
    if (!edit.ok) throw new Error(edit.error);
    expect(edit.batch.ops).toEqual([
      { op: "update", ref: "m1", set: { [`behaviors.${BADGE.name}.rank`]: 3 } },
    ]);
    expect(modelOps(rank, 12, [lookupRef(added.def, "m1")!]).ok).toBe(false);
  });

  it("shows a block no registered behavior owns, so it can be removed", () => {
    const odd: SceneDefinition = {
      ...doc,
      entities: [{ id: "spot", type: "marker", at: [0, 0], behaviors: { "test-game/gone": {} } }],
    };
    const s = of(games, odd, "spot").sections.at(-1)!;
    expect(s).toMatchObject({
      id: "behaviors:test-game/gone",
      title: "test-game/gone",
      fields: [{ path: "behaviors.test-game/gone", readonly: true }],
      behavior: { remove: { ops: [{ op: "update", ref: "spot", unset: ["behaviors"] }] } },
    });
  });

  it("carries no behavior sections for a bulk entry", () => {
    expect(model("~tile:0").addBehaviors).toEqual([]);
    expect(model("~tile:0").sections.every((s) => !s.behavior)).toBe(true);
  });
});

describe("standard behavior fields", () => {
  const engine = createRegistry();
  const at = (behaviors: Record<string, unknown>): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name: "kinds",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities: [
      { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] },
      { id: "hero", type: "marker", at: [5, 3], behaviors },
    ],
  });
  const names = (def: SceneDefinition, behavior: string) =>
    buildInspectorModel(engine, [lookupRef(def, "hero")!], { def })
      .sections.find((s) => s.id === `behaviors:${behavior}`)!
      .fields.map((f) => f.name);
  const body = { collider: { shape: ["box", 0, 0, 0.25, 0.25] }, body: {} };

  it("shows a joint only the fields its kind takes", () => {
    const joint = (block: Record<string, unknown>) =>
      names(at({ ...body, joint: { to: "crate", ...block } }), "joint");
    expect(joint({ kind: "revolute" })).toEqual([
      "kind",
      "to",
      "anchorA",
      "anchorB",
      "limits",
      "motor",
      "collide",
    ]);
    expect(joint({ kind: "spring", length: 1 })).toEqual([
      "kind",
      "to",
      "anchorA",
      "anchorB",
      "length",
      "stiffness",
      "damping",
      "collide",
    ]);
    expect(joint({ kind: "prismatic" })).toContain("axis");
  });

  const jointField = (block: Record<string, unknown>, path: string) => {
    const def = at({ ...body, joint: { to: "crate", ...block } });
    const m = buildInspectorModel(engine, [lookupRef(def, "hero")!], { def });
    const found = fields(m).flatMap((f) => [f, ...(f.children ?? [])]);
    return { def, field: found.find((f) => f.path === `behaviors.joint.${path}`)! };
  };

  it("shows a revolute joint's limits as a range in degrees, stored in radians", () => {
    const { def, field: limits } = jointField(
      { kind: "revolute", limits: [-Math.PI / 4, Math.PI / 2] },
      "limits",
    );
    expect(limits.widget).toMatchObject({ kind: "range", unit: "deg", step: 1, bigStep: 15 });
    expect(limits.value).toEqual([-45, 90]);
    expect(limits.group).toBe("limits");
    const edit = modelOps(limits, [-30, 60], [lookupRef(def, "hero")!]);
    expect(edit.ok && edit.ops[0]).toMatchObject({
      set: { "behaviors.joint.limits": [-Math.PI / 6, Math.PI / 3] },
    });
  });

  it("shows a prismatic joint's limits as a range in metres", () => {
    const { field: limits } = jointField({ kind: "prismatic", limits: [0, 2] }, "limits");
    expect(limits.widget).toMatchObject({ kind: "range", unit: "m" });
    expect(limits.widget).not.toHaveProperty("scale");
    expect(limits.value).toEqual([0, 2]);
  });

  it("gives a joint motor its own group, with units by the joint's kind", () => {
    const motor = { velocity: Math.PI, maxForce: 5 };
    const revolute = jointField({ kind: "revolute", motor }, "motor.velocity");
    expect(jointField({ kind: "revolute", motor }, "motor").field.group).toBe("motor");
    expect(revolute.field.widget).toMatchObject({ kind: "number", unit: "deg/s" });
    expect(revolute.field.value).toBe(180);
    const edit = modelOps(revolute.field, "+=90", [lookupRef(revolute.def, "hero")!]);
    expect(edit.ok && edit.ops[0]).toMatchObject({
      set: { "behaviors.joint.motor.velocity": (3 * Math.PI) / 2 },
    });
    expect(jointField({ kind: "revolute", motor }, "motor.maxForce").field.widget).toMatchObject({
      unit: "N·m",
    });
    const slider = jointField({ kind: "prismatic", motor }, "motor.velocity").field;
    expect(slider.widget).toMatchObject({ kind: "number", unit: "m/s" });
    expect(slider.value).toBe(Math.PI);
    expect(jointField({ kind: "prismatic", motor }, "motor.maxForce").field.widget).toMatchObject({
      unit: "N",
    });
  });

  it("puts every engine behavior under an Add behavior category", () => {
    const def = at({});
    const options = buildInspectorModel(engine, [lookupRef(def, "hero")!], { def }).addBehaviors;
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((o) => o.category === undefined).map((o) => o.name)).toEqual([]);
    expect(options.find((o) => o.name === "joint")?.category).toBe("physics");
    expect(options.find((o) => o.name === "sprite")?.category).toBe("visual");
  });

  it("keeps a field the kind doesn't take while the block sets it, so it can be cleared", () => {
    const def = at({ ...body, joint: { kind: "weld", to: "crate", stiffness: 5 } });
    expect(names(def, "joint")).toContain("stiffness");
    expect(names(def, "joint")).not.toContain("damping");
  });

  it("judges a force area by its default kind when it sets none", () => {
    const sensor = { collider: { shape: ["box", 0, 0, 1, 1], sensor: true } };
    expect(names(at({ ...sensor, "force-area": { force: [0, -20] } }), "force-area")).toEqual([
      "kind",
      "force",
      "drag",
      "affects",
    ]);
    expect(
      names(at({ ...sensor, "force-area": { kind: "point", strength: 5 } }), "force-area"),
    ).toEqual(["kind", "strength", "falloff", "drag", "affects"]);
  });

  it("groups path-follow's path, with units on its speed and pause", () => {
    const def = at({
      "path-follow": {
        path: {
          pts: [
            [0, 0],
            [2, 0],
          ],
          mode: "loop",
          speed: 1,
        },
      },
    });
    const m = buildInspectorModel(engine, [lookupRef(def, "hero")!], { def });
    const path = field(m, "behaviors.path-follow.path");
    expect(path.group).toBe("motion");
    expect(field(m, "behaviors.path-follow.path.speed").widget).toMatchObject({ unit: "m/s" });
    expect(field(m, "behaviors.path-follow.path.pauseMs").widget).toMatchObject({ unit: "ms" });
  });

  it("starts an added path from the entity, since its waypoints are world metres", () => {
    const def = at({});
    const option = buildInspectorModel(engine, [lookupRef(def, "hero")!], {
      def,
    }).addBehaviors.find((o) => o.name === "path-follow")!;
    expect(option.batch.ops).toEqual([
      {
        op: "update",
        ref: "hero",
        set: {
          "behaviors.path-follow": {
            path: {
              pts: [
                [5, 3],
                [7, 3],
              ],
              mode: "ping_pong",
              speed: 1,
            },
          },
        },
      },
    ]);
  });
});

describe("colour and asset widgets", () => {
  const LAMP_SHADE = defineBehavior({
    name: "shades/shade",
    description: "A lampshade.",
    fields: (env) => ({
      hue: z.string().optional().describe("Its hue.").meta({ widget: "color" }),
      cloth: assetField(env, "texture", "Its cloth.").optional(),
      frame: z.string().optional().describe("Not an atlas frame: cloth takes no atlas."),
    }),
  });
  const shades = (widgets?: Record<string, { kind: "slider"; min: number; max: number }>) =>
    createRegistry(
      defineGame({
        id: "shades",
        types: [
          defineEntityType({
            type: "lampshade",
            description: "A lampshade.",
            base: "marker",
            fields: (env) => ({
              at: pointField("Where it stands."),
              glow: z.number().int().optional().describe("Its glow.").meta({ widget: "color" }),
              art: assetField(env, ["texture", "atlas"], "Its art.").optional(),
              frame: z.string().optional().describe("Its art's frame."),
              sound: assetField(env, "audio", "Its click.").optional(),
            }),
          }),
        ],
        behaviors: [LAMP_SHADE],
        actions: [],
        ...(widgets ? { editor: { widgets } } : {}),
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
  const doc: SceneDefinition = {
    v: 2,
    game: "shades",
    name: "s",
    bounds: [0, 0, 100, 100],
    entities: [
      {
        id: "shade",
        type: "lampshade",
        at: [5, 5],
        glow: 0x00ff00,
        art: "sheet",
        frame: "lit",
        behaviors: { [LAMP_SHADE.name]: { hue: "#ff0000" } },
      },
    ],
  };
  const of = (r: ReturnType<typeof shades>) => buildInspectorModel(r, [lookupRef(doc, "shade")!]);

  it("draws meta.widget color as the built-in colour widget, numbers and strings alike", () => {
    const m = of(shades());
    expect(field(m, "glow")).toMatchObject({ value: 0x00ff00, widget: { kind: "color" } });
    expect(field(m, `behaviors.${LAMP_SHADE.name}.hue`).widget).toEqual({ kind: "color" });
  });

  it("lets a game's own widget named color win over the built-in one", () => {
    const m = of(shades({ color: { kind: "slider", min: 0, max: 9 } }));
    expect(field(m, "glow").widget).toMatchObject({ kind: "custom", id: "color" });
  });

  it("gives an assetField its kinds, and an atlas-taking one its sibling frame field", () => {
    const m = of(shades());
    expect(field(m, "art")).toMatchObject({
      section: "assets",
      value: "sheet",
      widget: { kind: "asset", kinds: ["texture", "atlas"], frame: "frame" },
    });
    expect(field(m, "sound").widget).toEqual({ kind: "asset", kinds: ["audio"] });
    // A texture-only field has no frame, even beside a field named frame.
    expect(field(m, `behaviors.${LAMP_SHADE.name}.cloth`).widget).toEqual({
      kind: "asset",
      kinds: ["texture"],
    });
  });

  it("validates an asset pick as the id it is", () => {
    const m = of(shades());
    const art = field(m, "art");
    const ok = modelOps(art, "other-sheet", [lookupRef(doc, "shade")!]);
    expect(ok).toEqual({
      ok: true,
      ops: [{ op: "update", ref: "shade", set: { art: "other-sheet" } }],
    });
    expect(modelOps(art, "Not An Id!", [lookupRef(doc, "shade")!]).ok).toBe(false);
  });
});

describe("the field rule the settings model shares", () => {
  it("describes a field as settingsRows does, plus its section", () => {
    const gadgetType = registry.types.get("gadget")!;
    const schema = z.object({
      ratio: gadgetType.shape.ratio as z.ZodType,
      mode: gadgetType.shape.mode as z.ZodType,
      armed: gadgetType.shape.armed as z.ZodType,
    });
    const value = { ratio: 0.5, mode: "on" };
    const rows = settingsRows(schema, value, "", { registry });
    for (const row of rows) {
      const { section, ...rest } = field(model("a"), row.path);
      expect(section).toBe("behavior");
      expect(rest).toEqual(row);
    }
  });

  it("keeps a scene point's canvas pick", () => {
    const pt = createRegistry(
      defineGame({
        id: "pt",
        types: [
          defineEntityType({
            type: "spot",
            description: "A point.",
            base: "decor",
            fields: { at: pointField("Where.") },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const doc: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "pt",
      name: "p",
      bounds: [0, 0, 10, 10],
      entities: [{ id: "s", type: "spot", at: [1, 2] }],
    };
    const m = buildInspectorModel(pt, [lookupRef(doc, "s")!]);
    const at = m.sections.flatMap((s) => s.fields).find((f) => f.path === "at");
    expect(at?.widget).toMatchObject({ kind: "point", pick: true });
  });
});
