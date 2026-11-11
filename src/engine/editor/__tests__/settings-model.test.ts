import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { applyJsonEdits } from "../../project/json-edit";
import type { DocKindDef } from "../../project/kinds/define";
import { gameSettingsKind, type GameSettingsFile } from "../../project/kinds/game-settings";
import type { InspectorRow } from "../inspector-model";
import { settingsEdit, settingsRows, settingsValue } from "../settings-model";

const registry = createRegistry();
const settingsKind = gameSettingsKind as unknown as DocKindDef<GameSettingsFile>;
const layout = settingsKind.layout as Exclude<DocKindDef["layout"], "custom">;
const fileSchema = settingsKind.schema({ registry, project: null }) as unknown as z.ZodObject;
const engineSchema = fileSchema.shape.engine as z.ZodObject;

const byPath = (rows: readonly InspectorRow[], path: string): InspectorRow => {
  for (const r of rows) {
    if (r.path === path) return r;
    const inner = r.children && byPath(r.children, path);
    if (inner) return inner;
  }
  return undefined as never;
};

const doc = (): GameSettingsFile => ({
  kind: "game-settings",
  v: 2,
  engine: { physics: "rapier", gravity: [0, 12], resolution: { fit: "letterbox" } },
  game: {},
});

describe("settingsRows", () => {
  const rows = settingsRows(engineSchema, doc().engine, "engine");

  it("walks a doc's block in schema order, paths from the doc's root", () => {
    expect(rows.map((r) => r.path)).toEqual([
      "engine.resolution",
      "engine.physics",
      "engine.gravity",
      "engine.tickRate",
    ]);
    expect(rows.every((r) => !("section" in r))).toBe(true);
  });

  it("gives a nested object its fields as children, values read at their paths", () => {
    const resolution = byPath(rows, "engine.resolution");
    expect(resolution.widget).toEqual({ kind: "object" });
    expect(resolution.optional).toBe(true);
    expect(resolution.children?.map((c) => c.name)).toEqual([
      "virtual",
      "fit",
      "integer",
      "sampling",
      "antialias",
      "pixelSnap",
      "bars",
    ]);
    expect(byPath(rows, "engine.resolution.fit").value).toBe("letterbox");
    expect(byPath(rows, "engine.resolution.integer").widget).toEqual({ kind: "switch" });
    expect(byPath(rows, "engine.resolution.virtual").widget).toEqual({
      kind: "readonly",
      format: "json",
    });
  });

  it("draws an enum as a choice with every option", () => {
    expect(byPath(rows, "engine.physics")).toMatchObject({
      value: "rapier",
      optional: true,
      readonly: false,
      widget: {
        kind: "segmented",
        options: [
          { value: "rapier", label: "rapier" },
          { value: "none", label: "none" },
        ],
      },
    });
  });

  it("keeps a bounded number's bounds", () => {
    expect(byPath(rows, "engine.resolution.bars").widget).toEqual({
      kind: "number",
      integer: true,
      min: 0,
      max: 0xffffff,
      step: 1,
      bigStep: 10,
      scrub: false,
    });
    const open = settingsRows(
      z.object({ speed: z.number().positive().max(9).meta({ unit: "m/s" }) }),
      {},
      "",
    );
    expect(open[0]).toMatchObject({
      path: "speed",
      value: undefined,
      widget: { kind: "number", min: 0, exclusiveMin: true, max: 9, step: 0.01, unit: "m/s" },
    });
  });

  it("draws a number pair as x and y fields without a canvas pick", () => {
    expect(byPath(rows, "engine.gravity")).toMatchObject({
      value: [0, 12],
      widget: { kind: "point", pick: false, unit: "m/s²", step: 0.01, bigStep: 0.1, decimals: 2 },
    });
  });

  it("nests deeper objects, reads metadata, and keeps an id read-only", () => {
    const schema = z.object({
      id: z.string(),
      camera: z.object({
        follow: z.object({
          lag: z.number().min(0).describe("Seconds behind.").meta({ title: "Lag", default: 0.2 }),
          reach: z.number().optional().meta({ unit: "m" }),
        }),
      }),
      title: z.string().max(40),
      tint: z.number().meta({ widget: "color" }),
    });
    const value = { id: "main", camera: { follow: { lag: 0.5 } }, title: "Hi" };
    const out = settingsRows(schema, value, "game", { pxPerMetre: 32 });
    expect(byPath(out, "game.id").readonly).toBe(true);
    expect(byPath(out, "game.camera.follow.lag")).toMatchObject({
      title: "Lag",
      description: "Seconds behind.",
      value: 0.5,
      optional: false,
    });
    expect(byPath(out, "game.camera.follow.reach")).toMatchObject({
      optional: true,
      widget: { kind: "number", unit: "m", step: 1 / 32, decimals: 5 },
    });
    expect(byPath(out, "game.title").widget).toEqual({ kind: "text", maxLength: 40 });
    expect(byPath(out, "game.tint").widget).toEqual({ kind: "color" });
  });
});

describe("settingsValue", () => {
  const rows = settingsRows(engineSchema, doc().engine, "engine");

  it("parses typed and relative numbers, checks the schema, and unsets only optional rows", () => {
    const bars = byPath(rows, "engine.resolution.bars");
    expect(settingsValue(bars, "255")).toEqual({ ok: true, value: 255 });
    expect(settingsValue(bars, "-1").ok).toBe(false);
    expect(settingsValue(bars, "abc")).toEqual({
      ok: false,
      error: `"abc" isn't a number or a relative edit like +=16`,
    });
    expect(settingsValue(byPath(rows, "engine.physics"), undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    const required = settingsRows(z.object({ n: z.number() }), { n: 2 }, "")[0]!;
    expect(settingsValue(required, "*=3")).toEqual({ ok: true, value: 6 });
    expect(settingsValue(required, undefined)).toEqual({ ok: false, error: "n can't be unset" });
  });
});

describe("settingsEdit", () => {
  const apply = (file: GameSettingsFile, edits: readonly unknown[]) => {
    const r = applyJsonEdits(file, layout, edits as never);
    if (!r.ok) throw new Error(r.issue.message);
    return r.value as GameSettingsFile;
  };

  it("is one editAsset op with one edit per change", () => {
    expect(settingsEdit("settings", "engine.physics", "none")).toEqual({
      op: "editAsset",
      id: "settings",
      edits: [{ set: "/engine/physics", value: "none" }],
    });
    expect(settingsEdit("settings", "engine.tickRate", undefined)).toEqual({
      op: "editAsset",
      id: "settings",
      edits: [{ unset: "/engine/tickRate" }],
    });
  });

  it("sets a whole atomic value when a field inside it changes", () => {
    const current = { doc: doc(), layout };
    const op = settingsEdit("settings", "engine.resolution.fit", "crop", current);
    expect(op).toEqual({
      op: "editAsset",
      id: "settings",
      edits: [{ set: "/engine/resolution", value: { fit: "crop" } }],
    });
    const cleared = settingsEdit("settings", "engine.resolution.fit", undefined, current);
    expect(cleared.op === "editAsset" && cleared.edits).toEqual([
      { set: "/engine/resolution", value: {} },
    ]);
    if (op.op !== "editAsset") throw new Error("expected editAsset");
    expect(apply(doc(), op.edits).engine.resolution).toEqual({ fit: "crop" });
  });

  it("sets a missing parent object instead of a field under it", () => {
    const bare: GameSettingsFile = { kind: "game-settings", v: 2, engine: {}, game: {} };
    const nestedLayout = {
      as: "map",
      fields: { engine: { as: "map", fields: { a: { as: "map" } } } },
    } as const;
    const op = settingsEdit("settings", "engine.a.b", 3, { doc: bare, layout: nestedLayout });
    expect(op.op === "editAsset" && op.edits).toEqual([{ set: "/engine/a", value: { b: 3 } }]);
    const none = settingsEdit("settings", "engine.a.b", undefined, {
      doc: bare,
      layout: nestedLayout,
    });
    expect(none.op === "editAsset" && none.edits).toEqual([]);
    const gravity = settingsEdit("settings", "engine.gravity", [0, 9.8], { doc: bare, layout });
    if (gravity.op !== "editAsset") throw new Error("expected editAsset");
    expect(gravity.edits).toEqual([{ set: "/engine/gravity", value: [0, 9.8] }]);
    expect(apply(bare, gravity.edits).engine.gravity).toEqual([0, 9.8]);
  });
});
