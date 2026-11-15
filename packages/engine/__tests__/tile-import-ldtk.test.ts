// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { decodeCell } from "../game/tile-cell";
import { createKindRegistry } from "../project/kinds";
import type { TilesetFile } from "../project/kinds/tileset";
import { checkProjectBatch, type ProjectOp } from "../project/ops";
import type { ProjectState } from "../project/types";
import { projectView } from "../project/view";
import { readCell, type GridCells } from "../scene/grid";
import type { EntityDef, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import { importLdtk, type LdtkImportOptions } from "../tiles/import-ldtk";
import { sampleText, sampleTilesPng } from "./fixtures/ldtk/generate";

const dir = new URL("./fixtures/ldtk/", import.meta.url);
const world: unknown = JSON.parse(readFileSync(new URL("sample.ldtk", dir), "utf8"));
const tilesPng = new Uint8Array(readFileSync(new URL("tiles.png", dir)));

const state: ProjectState = {
  meta: { projectId: "p", layout: 2, name: "P" },
  assets: {},
  history: {},
  code: {},
  build: {},
};
const project = projectView(state);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const run = (over: Partial<LdtkImportOptions> = {}) =>
  importLdtk(world, {
    project,
    pxPerMetre: 8,
    hash,
    files: new Map([["tiles.png", tilesPng]]),
    ...over,
  });

const created = (ops: readonly ProjectOp[], id: string): unknown => {
  const op = ops.find((o) => o.op === "createAsset" && o.id === id);
  if (op?.op !== "createAsset") throw new Error(`no createAsset ${id}`);
  return op.content;
};
const scene = (ops: readonly ProjectOp[], id: string) => created(ops, id) as SceneDefinition;
const entity = (s: SceneDefinition, id: string): EntityDef => {
  const e = s.entities?.find((x) => x.id === id);
  if (!e) throw new Error(`no entity ${id}`);
  return e;
};
const cell = (cells: unknown, col: number, row: number) =>
  decodeCell(readCell(cells as GridCells, col, row));

describe("the LDtk sample fixture", () => {
  it("is what its committed generator writes", () => {
    expect(readFileSync(new URL("sample.ldtk", dir), "utf8")).toBe(sampleText());
    expect(tilesPng).toEqual(sampleTilesPng());
  });
});

describe("importLdtk", () => {
  it("makes one scene per level with a grid of the layers' cell, in metres", () => {
    const { ops, notes } = run();
    const level = scene(ops, "level-0");
    expect(level.bounds).toEqual([0, 0, 4, 3]);
    expect(level.settings?.grid).toEqual({ kind: "square", cell: [1, 1] });
    expect(scene(ops, "level-1").entities?.map((e) => e.id)).toEqual(["collisions"]);
    expect(notes.map((n) => [n.code, n.severity, n.message])).toEqual([
      ["import-failed", "error", expect.stringContaining("Far_Away is saved in a separate file")],
    ]);
  });

  it("turns an IntGrid layer into a tilemap over a generated one-colour-per-value tileset", () => {
    const { ops, blobs } = run();
    const map = entity(scene(ops, "level-0"), "collisions");
    expect(map).toMatchObject({ type: "tilemap", tileset: "collisions-intgrid", at: [0, 0] });
    expect(cell(map.cells, 3, 1)).toEqual({ id: 1, flipX: false, flipY: false, flipD: false });
    expect(cell(map.cells, 0, 2)?.id).toBe(0);
    expect(cell(map.cells, 0, 0)).toBeNull();
    const set = created(ops, "collisions-intgrid") as TilesetFile;
    expect(set).toMatchObject({ image: "collisions-intgrid-image", tile: [8, 8], columns: 2 });
    expect(set.tiles).toEqual([
      { id: 0, tags: ["wall"], data: { intGrid: 1 } },
      { id: 1, tags: ["water"], data: { intGrid: 2 } },
    ]);
    const image = ops.find((o) => o.op === "importAsset" && o.id === "collisions-intgrid-image");
    if (image?.op !== "importAsset") throw new Error("no generated image");
    const png = blobs.get(image.sha256);
    expect(png && hash(png)).toBe(image.sha256);
    expect([...png!.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(scene(ops, "level-1").entities?.[0]?.tileset).toBe("collisions-intgrid");
    expect(ops.filter((o) => o.op === "createAsset" && o.id === "collisions-intgrid")).toHaveLength(
      1,
    );
  });

  it("uses an IntGrid layer's auto-layer tiles over its tileset when it has them", () => {
    const { ops } = run();
    const ground = entity(scene(ops, "level-0"), "ground");
    expect(ground.tileset).toBe("terrain");
    for (const col of [0, 1, 2, 3]) expect(cell(ground.cells, col, 2)?.id).toBe(3);
    expect(ops.some((o) => o.op === "createAsset" && o.id === "ground-intgrid")).toBe(false);
  });

  it("imports tile layers with their flips, and the tileset with its tags and data", () => {
    const { ops } = run();
    const decor = entity(scene(ops, "level-0"), "decor");
    expect(cell(decor.cells, 0, 0)).toEqual({ id: 0, flipX: false, flipY: false, flipD: false });
    expect(cell(decor.cells, 1, 0)).toEqual({ id: 1, flipX: true, flipY: false, flipD: false });
    expect(cell(decor.cells, 2, 1)).toEqual({ id: 2, flipX: true, flipY: true, flipD: false });
    expect(created(ops, "terrain")).toEqual({
      kind: "tileset",
      v: 1,
      image: "terrain-image",
      tile: [8, 8],
      columns: 4,
      tiles: [
        { id: 1, data: { customData: "plank" } },
        { id: 3, data: { grass: true }, tags: ["Solid"] },
      ],
    });
    expect(ops.find((o) => o.op === "importAsset" && o.id === "terrain-image")).toMatchObject({
      path: "tilesets/tiles.png",
      kind: "texture",
      sha256: hash(tilesPng),
    });
  });

  it("names an image already in the project instead of importing it", () => {
    const { ops } = run({ images: new Map([["tiles.png", "terrain-art"]]), files: undefined });
    expect((created(ops, "terrain") as TilesetFile).image).toBe("terrain-art");
    expect(ops.some((o) => o.op === "importAsset" && o.id === "terrain-image")).toBe(false);
  });

  it("drops layers over a missing image with an error note", () => {
    const { ops, notes } = run({ files: undefined });
    expect(notes.some((n) => n.severity === "error" && n.message.includes('"tiles.png"'))).toBe(
      true,
    );
    expect(scene(ops, "level-0").entities?.some((e) => e.id === "decor")).toBe(false);
  });

  it("turns entities into markers with their fields in extra", () => {
    const { ops } = run();
    const level = scene(ops, "level-0");
    expect(entity(level, "player-start")).toEqual({
      id: "player-start",
      type: "marker",
      name: "PlayerStart",
      at: [1.5, 2.5],
      tags: ["player-start"],
      z: 3,
      extra: { lives: 3, facing: "left", iid: "aa11", width: 1, height: 2 },
    });
    expect(entity(level, "coin").extra).toMatchObject({ iid: "bb22" });
    expect(entity(level, "coin-2")).toMatchObject({ at: [2.5, 0.5], extra: { value: 5 } });
  });

  it("imports only the named levels, and notes a name the world lacks", () => {
    const { ops, notes } = run({ levels: ["Level_1", "Nope"] });
    expect(
      ops.flatMap((o) => (o.op === "createAsset" && o.kind === "scene" ? [o.id] : [])),
    ).toEqual(["level-1"]);
    expect(notes.map((n) => n.message)).toEqual(['the world has no level "Nope"']);
  });

  it("refuses ids the project already holds", () => {
    const taken = projectView({
      ...state,
      assets: {
        k: {
          key: "k",
          id: "level-1",
          kind: "scene",
          path: "scenes/level-1.json",
          created: { at: 0, by: "t" },
        },
      },
    });
    const { ops, notes } = run({ project: taken });
    expect(ops.some((o) => o.op === "createAsset" && o.id === "level-1")).toBe(false);
    expect(notes.some((n) => n.message.includes('"level-1"'))).toBe(true);
  });

  it("refuses what isn't an LDtk world", () => {
    expect(run().ops.length).toBeGreaterThan(0);
    const bad = importLdtk({ levels: [] }, { project, pxPerMetre: 8, hash });
    expect(bad.ops).toEqual([]);
    expect(bad.notes.map((n) => n.code)).toEqual(["import-failed"]);
  });

  it("is one batch the project accepts, with scenes that validate", () => {
    const registry = createRegistry();
    const { ops } = run();
    let n = 0;
    const check = checkProjectBatch(
      state,
      new Map(),
      { v: 1, label: "Import LDtk world", ops: [...ops] },
      { registry, kinds: createKindRegistry(null), now: 1, by: "t", newKey: () => `k${n++}` },
    );
    if (!check.ok) throw new Error(JSON.stringify(check.issue));
    for (const id of ["level-0", "level-1"])
      expect(validateScene(scene(ops, id), registry).filter((i) => i.severity === "error")).toEqual(
        [],
      );
  });
});
