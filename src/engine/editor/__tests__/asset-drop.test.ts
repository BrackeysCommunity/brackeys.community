import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { AssetEntry } from "../../project/types";
import { engine } from "../../scene/__tests__/fixtures/fake-game";
import { yardPrefabs } from "../../scene/__tests__/fixtures/random-ops";
import { fragmentBounds } from "../../scene/fragment";
import { applyOps } from "../../scene/ops";
import { SCENE_FORMAT_VERSION, type OpBatch, type SceneDefinition } from "../../scene/types";
import { snapToPixel } from "../../scene/units";
import { dropBatch, dropFragment, dropPreview, type AssetDrop } from "../asset-drop";
import { DEFAULT_SNAP } from "../tools";

const entry = (id: string, kind: string, over: Partial<AssetEntry> = {}): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `art/${id}.${kind === "prefab" ? "json" : "png"}`,
  created: { at: 0, by: "test" },
  ...over,
});

const drop = (e: AssetEntry, frame?: string): AssetDrop => ({
  entry: e,
  info: { id: e.id, kind: e.kind },
  ...(frame !== undefined ? { frame } : {}),
});

const scene = (over: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "drop",
  bounds: [0, 0, 20, 20],
  ...over,
});

const prefabs = yardPrefabs();
const tree = entry("tree", "texture");
const sheet = entry("sheet", "atlas");
const post = entry("post", "prefab");

const apply = (def: SceneDefinition, batch: OpBatch) => {
  const r = applyOps(def, batch, engine, { prefabs });
  if (!r.ok) throw new Error(r.issue.message);
  return r.def;
};

describe("dropFragment", () => {
  it("turns a texture into a decor drawing it", () => {
    expect(dropFragment(drop(tree), engine)).toEqual({
      kind: "scene-fragment",
      v: SCENE_FORMAT_VERSION,
      entities: [
        { id: "decor", type: "decor", at: [0, 0], behaviors: { sprite: { asset: "tree" } } },
      ],
    });
  });

  it("turns an atlas frame into a decor drawing that frame", () => {
    expect(dropFragment(drop(sheet, "run-2"), engine)?.entities).toEqual([
      {
        id: "decor",
        type: "decor",
        at: [0, 0],
        behaviors: { sprite: { asset: "sheet", frame: "run-2" } },
      },
    ]);
  });

  it("turns a prefab into an instance of it", () => {
    const fragment = dropFragment(drop(post), engine);
    expect(fragment?.entities).toEqual([]);
    expect(fragment?.instances).toEqual([{ id: "post-1", prefab: "post", at: [0, 0] }]);
  });

  it("places nothing for an atlas without a frame or another kind", () => {
    expect(dropFragment(drop(sheet), engine)).toBeNull();
    expect(dropFragment(drop(entry("boom", "audio")), engine)).toBeNull();
    expect(dropFragment(drop(entry("level", "scene")), engine)).toBeNull();
  });
});

describe("dropBatch", () => {
  it("adds a texture's decor at the snapped drop point in one labelled batch", () => {
    const r = dropBatch(drop(tree, undefined), [1, 0.3], {
      def: scene(),
      registry: engine,
      snap: { ...DEFAULT_SNAP, step: 0.16 },
    });
    if (!r.ok) throw new Error(r.issues[0]?.message);
    expect(r.batch.label).toBe("Place tree");
    expect(r.batch.ops).toHaveLength(1);
    expect(r.select).toEqual(["decor"]);
    const after = apply(scene(), r.batch);
    expect(after.entities).toEqual([
      { id: "decor", type: "decor", at: [0.96, 0.32], behaviors: { sprite: { asset: "tree" } } },
    ]);
  });

  it("keeps the point on whole world px with snapping off, and renames a clashing id", () => {
    const def = scene({
      entities: [
        { id: "decor", type: "decor", at: [0, 0], behaviors: { sprite: { asset: "tree" } } },
      ],
    });
    const r = dropBatch(drop(sheet, "idle"), [1.013, 0.374], {
      def,
      registry: engine,
      snap: { ...DEFAULT_SNAP, enabled: false },
    });
    if (!r.ok) throw new Error(r.issues[0]?.message);
    expect(r.select).toEqual(["decor-2"]);
    expect(r.batch.label).toBe("Place idle");
    expect(apply(def, r.batch).entities?.[1]).toEqual({
      id: "decor-2",
      type: "decor",
      at: [1.01, 0.37],
      behaviors: { sprite: { asset: "sheet", frame: "idle" } },
    });
  });

  it("instantiates a prefab with its box centred on the drop point", () => {
    const fragment = dropFragment(drop(post), engine)!;
    const box = fragmentBounds(fragment, engine, prefabs)!;
    const r = dropBatch(drop(post), [5, 5], {
      def: scene(),
      registry: engine,
      prefabs,
      snap: { ...DEFAULT_SNAP, enabled: false },
    });
    if (!r.ok) throw new Error(r.issues[0]?.message);
    expect(r.batch.ops.map((o) => o.op)).toEqual(["instantiate"]);
    expect(apply(scene(), r.batch).instances).toEqual([
      {
        id: "post-1",
        prefab: "post",
        at: [
          snapToPixel(5 - (box.minX + box.maxX) / 2, 100),
          snapToPixel(5 - (box.minY + box.maxY) / 2, 100),
        ],
      },
    ]);
  });

  it("refuses a kind that isn't placeable with an issue to show", () => {
    const audio = dropBatch(drop(entry("boom", "audio")), [0, 0], {
      def: scene(),
      registry: engine,
    });
    expect(audio).toMatchObject({ ok: false, issues: [{ code: "asset-kind" }] });
    const atlas = dropBatch(drop(sheet), [0, 0], { def: scene(), registry: engine });
    expect(atlas).toMatchObject({ ok: false, issues: [{ code: "asset-frame-unknown" }] });
  });

  it("draws a refused drop's ghost at its texture px as world px, in metres", () => {
    const sized: AssetDrop = {
      ...drop(entry("boom", "audio")),
      info: { id: "boom", kind: "audio" },
    };
    expect(dropPreview(sized, [1.004, 2], { def: scene(), registry: engine }).ghosts).toMatchObject(
      [
        // The 32 px fallback at 100 px per metre.
        { shape: { type: "box", cx: 1, cy: 2, hw: 0.16, hh: 0.16 }, valid: false },
      ],
    );
  });
});

describe("a game's assetDrop", () => {
  const game = createRegistry(
    defineGame({
      id: "droppy",
      types: [],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
      editor: {
        assetDrop: ({ entry: e }) =>
          e.id === "spot" ? { id: "spot-marker", type: "marker", at: [0, 0] } : null,
      },
    }),
  );

  it("wins over the engine's mapping", () => {
    expect(dropFragment(drop(entry("spot", "texture")), game)?.entities).toEqual([
      { id: "spot-marker", type: "marker", at: [0, 0] },
    ]);
    const r = dropBatch(drop(entry("spot", "texture")), [64, 64], {
      def: scene({ game: "droppy" }),
      registry: game,
      snap: DEFAULT_SNAP,
    });
    expect(r.ok && r.select).toEqual(["spot-marker"]);
  });

  it("falls back to the engine's when it returns null", () => {
    expect(dropFragment(drop(tree), game)?.entities[0]).toMatchObject({
      type: "decor",
      behaviors: { sprite: { asset: "tree" } },
    });
  });
});
