import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { BEHAVIORS_FIELD } from "../../game/behaviors";
import { createRegistry } from "../../game/define";
import { decodeCell, encodeCell, FLIP_D, FLIP_X, FLIP_Y } from "../../game/tile-cell";
import type { Registry } from "../../game/types";
import { engineHomeRegistry } from "../../project/__tests__/fixtures/engine-home";
import { PREFAB_SCENE_OPS } from "../../project/ops";
import {
  engine,
  engineYard,
  fake,
  fakeYard,
  randomOp,
  rng,
  testGameRegistry,
  testGameYard,
  yardPrefabs,
} from "../../scene/__tests__/fixtures/random-ops";
import { formatScene } from "../../scene/format";
import { GRID_CHUNK, readCell, type GridCells } from "../../scene/grid";
import { sceneHash } from "../../scene/hash";
import { sceneFrames } from "../../scene/resolve";
import {
  SCENE_FORMAT_VERSION,
  type CellEdit,
  type CellRect,
  type EntityDef,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneOp,
} from "../../scene/types";
import { readPrefabFiles } from "../../vite/project-files";
import { applyOpsToDoc } from "../apply";
import { docLayout, docPrefabs, docToScene, entitiesMap, gridRowKey, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { staticPrefabSource } from "../prefab-source";
import { COLLAB_LAYOUT_VERSION, type SceneOrigin } from "../types";
import { validateDoc } from "../watch-issues";
import { must } from "./helpers";
import { SimNetwork } from "./sim-network";

/** Each entity and instance's parent as the resolver reads it, only where it has one. */
function treeOf(
  def: SceneDefinition,
  reg: Registry,
  prefabs: PrefabLibrary,
): Record<string, string> {
  const frames = sceneFrames(def, reg, prefabs);
  const out: Record<string, string> = {};
  for (const { id } of [...(def.entities ?? []), ...(def.instances ?? [])]) {
    const parent = frames.parentOf(id);
    if (parent !== undefined) out[id] = parent;
  }
  return out;
}

/**
 * What a counted op is: its name; `decor` for an add of one; `sprite` for an
 * update that writes the sprite block, `behavior` for one that writes another.
 */
function opKind(op: SceneOp): string {
  if (op.op === "add" && op.entity.type === "decor") return "decor";
  if (op.op !== "update") return op.op;
  const paths = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])];
  if (paths.some((p) => p.startsWith(`${BEHAVIORS_FIELD}.sprite`))) return "sprite";
  return paths.some((p) => p.startsWith(`${BEHAVIORS_FIELD}.`)) ? "behavior" : "update";
}

const SPRITE_KINDS = ["sprite", "decor"];
const V3_KINDS = ["transform", "setZ", "useAssets", "paintCells", "behavior", "setParam"];
const TREE_KINDS = ["reparent"];

const scenesDir = new URL("../../scenes/", import.meta.url);
const sinkRegistry = engineHomeRegistry();
/** Read at run time: the sink grows with each feature. */
const sink = (): SceneDefinition =>
  JSON.parse(readFileSync(new URL("kitchen-sink.json", scenesDir), "utf8")) as SceneDefinition;
let sinkPrefabs: PrefabLibrary;

beforeAll(async () => {
  const files = await readPrefabFiles(fileURLToPath(scenesDir), sinkRegistry);
  expect(files.problems).toEqual([]);
  sinkPrefabs = files.prefabs;
});

it("the kitchen sink carries a sprite and a decor for the fuzz to start from", () => {
  const entities = sink().entities ?? [];
  expect(entities.some((e) => e.type === "decor")).toBe(true);
  expect(
    entities.some((e) => (e[BEHAVIORS_FIELD] as Record<string, unknown> | undefined)?.sprite),
  ).toBe(true);
});

describe("convergence fuzz", () => {
  const yards = (game?: string) => yardPrefabs(game, { params: true });
  for (const [label, reg, yard, kinds, prefabsOf] of [
    [
      "engine-yard",
      engine,
      engineYard,
      ["transform", "setZ", "useAssets", "setParam", ...SPRITE_KINDS, ...TREE_KINDS],
      yards,
    ],
    [
      "the fake game's yard",
      fake,
      fakeYard,
      ["transform", "setZ", "useAssets", "setParam", ...SPRITE_KINDS, ...TREE_KINDS],
      yards,
    ],
    [
      "the test game's yard",
      testGameRegistry,
      testGameYard,
      [...V3_KINDS, ...SPRITE_KINDS, ...TREE_KINDS],
      yards,
    ],
    [
      "the kitchen sink",
      sinkRegistry,
      sink,
      ["transform", "setZ", "useAssets", "setParam", ...SPRITE_KINDS, ...TREE_KINDS],
      () => sinkPrefabs,
    ],
  ] as const) {
    // Prefab ops write prefab docs of their own; prefab-doc.test.ts covers how those merge.
    it(`random batches, delivery order, partitions and reconnects converge: ${label}`, () => {
      let batches = 0;
      let parented = 0;
      const landed = new Map<string, number>();
      for (let seed = 1; seed <= 24; seed++) {
        const rand = rng(seed * 7919);
        const clients = 2 + (seed % 4);
        const seed0 = sceneToDoc(yard(), { key: sequentialKeys("s") });
        const prefabs = prefabsOf(yard().game);
        const sceneOp = (def: ReturnType<typeof docToScene>): SceneOp => {
          for (;;) {
            const op = randomOp(reg, def, rand, prefabs, { v3: true, tree: true });
            if (!PREFAB_SCENE_OPS.includes(op.op)) return op;
          }
        };
        const net = new SimNetwork(clients, rand, seed0);
        const origins: SceneOrigin[] = net.docs.map((_, i) => ({ kind: "user", userId: `u${i}` }));
        const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));

        for (let step = 0; step < 60; step++) {
          const i = Math.floor(rand() * clients);
          const doc = net.docs[i]!;
          const ops = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
            sceneOp(docToScene(doc)),
          );
          const r = applyOpsToDoc(doc, { ops }, origins[i]!, reg, {
            validate: "none",
            key: keys[i],
            prefabs,
          });
          if (r.ok) {
            batches++;
            for (const op of ops) landed.set(opKind(op), (landed.get(opKind(op)) ?? 0) + 1);
          }
          net.deliver(Math.floor(rand() * 4));
          const roll = rand();
          if (roll < 0.05) net.partition([Math.floor(rand() * clients)]);
          else if (roll < 0.1) net.heal();
        }
        net.settle();

        for (const doc of net.docs) {
          expect(docLayout(doc), `seed ${seed}: layout 3`).toBe(COLLAB_LAYOUT_VERSION);
          expect(docPrefabs(doc).size, "layout 3 holds no prefabs").toBe(0);
        }
        const texts = net.docs.map((d) => formatScene(docToScene(d)).text);
        const hashes = net.docs.map((d) => sceneHash(docToScene(d)));
        const trees = net.docs.map((d) => treeOf(docToScene(d), reg, prefabs));
        const issues = net.docs.map((d) =>
          validateDoc(d, reg, { prefabs: staticPrefabSource(prefabs) }),
        );
        for (let i = 1; i < clients; i++) {
          expect(texts[i], `seed ${seed}, client ${i}`).toBe(texts[0]);
          expect(hashes[i]).toBe(hashes[0]);
          expect(trees[i], `seed ${seed}, client ${i}: the tree`).toEqual(trees[0]);
          expect(issues[i], `seed ${seed}, client ${i}: the issues`).toEqual(issues[0]);
        }
        const linked = Object.keys(trees[0]!).length;
        if (linked > 0) parented++;
      }
      expect(batches).toBeGreaterThan(400);
      expect(parented, "seeds that settle with a parent link").toBeGreaterThan(0);
      for (const kind of kinds)
        expect(landed.get(kind) ?? 0, `${kind} ops that landed`).toBeGreaterThan(10);
    }, 300_000);
  }
});

describe("the kitchen sink's sprite blocks under concurrent edits", () => {
  const user = (i: number): SceneOrigin => ({ kind: "user", userId: `u${i}` });
  const apart = (edits: SceneOp[][]) => {
    const net = new SimNetwork(
      edits.length,
      rng(11),
      sceneToDoc(sink(), { key: sequentialKeys("s") }),
    );
    net.partition([0]);
    edits.forEach((ops, i) => {
      const r = applyOpsToDoc(net.docs[i]!, { ops }, user(i), sinkRegistry, {
        validate: "none",
        key: sequentialKeys(`c${i}-`),
        prefabs: sinkPrefabs,
      });
      expect(r.ok).toBe(true);
    });
    net.heal();
    net.settle();
    const texts = net.docs.map((d) => formatScene(docToScene(d)).text);
    for (const t of texts) expect(t).toBe(texts[0]);
    return docToScene(net.docs[0]!);
  };
  const decor = (def: SceneDefinition) => (def.entities ?? []).find((e) => e.type === "decor")!;
  const spriteOf = (e: EntityDef) =>
    (e[BEHAVIORS_FIELD] as Record<string, Record<string, unknown>> | undefined)?.sprite;

  it("different fields of one sprite merge", () => {
    const id = decor(sink()).id;
    const def = apart([
      [{ op: "update", ref: id, set: { "behaviors.sprite.tint": 0xff8800 } }],
      [{ op: "update", ref: id, set: { "behaviors.sprite.blend": "add" } }],
    ]);
    expect(spriteOf(decor(def))).toMatchObject({ tint: 0xff8800, blend: "add" });
  });

  it("removing a sprite block wins over a concurrent field edit inside it", () => {
    const added = apart([
      [{ op: "update", ref: "crate", set: { "behaviors.sprite": { asset: "crates" } } }],
    ]);
    const net = new SimNetwork(2, rng(5), sceneToDoc(added, { key: sequentialKeys("s") }));
    net.partition([0]);
    const run = (i: number, op: SceneOp) =>
      expect(
        applyOpsToDoc(net.docs[i]!, { ops: [op] }, user(i), sinkRegistry, {
          validate: "none",
          key: sequentialKeys(`c${i}-`),
          prefabs: sinkPrefabs,
        }).ok,
      ).toBe(true);
    run(0, { op: "update", ref: "crate", unset: ["behaviors.sprite"] });
    run(1, { op: "update", ref: "crate", set: { "behaviors.sprite.tint": 0x00ff00 } });
    net.heal();
    net.settle();
    for (const doc of net.docs) {
      const crate = docToScene(doc).entities!.find((e) => e.id === "crate")!;
      expect(spriteOf(crate)).toBeUndefined();
    }
  });
});

describe("tilemap paints converge", () => {
  const tileGame = createRegistry(testGame);
  const grass = encodeCell({ id: 2, flipX: false, flipY: false, flipD: false });
  const stone = encodeCell({ id: 5, flipX: true, flipY: false, flipD: true });
  const water = encodeCell({ id: 7, flipX: false, flipY: true, flipD: false });
  const MAP: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "tile-yard",
    bounds: [0, 0, 4096, 4096],
    settings: { grid: { kind: "square", cell: [16, 16] } },
    entities: [
      {
        id: "ground",
        type: "tilemap",
        at: [0, 0],
        tileset: "ground",
        cells: { "0,0": [`${grass}*4`] },
      },
    ],
  };

  function mapNetwork(clients: number, seed: number) {
    const net = new SimNetwork(clients, rng(seed), sceneToDoc(MAP, { key: sequentialKeys("s") }));
    const origins: SceneOrigin[] = net.docs.map((_, i) => ({ kind: "user", userId: `u${i}` }));
    const paint = (i: number, cells: CellEdit[], rects?: CellRect[]) =>
      must(
        applyOpsToDoc(
          net.docs[i]!,
          {
            ops: [
              {
                op: "paintCells",
                ref: "ground",
                field: "cells",
                cells,
                ...(rects ? { rects } : {}),
              },
            ],
          },
          origins[i]!,
          tileGame,
        ),
      );
    const cellsOf = (i: number) =>
      (docToScene(net.docs[i]!).entities?.find((e) => e.id === "ground")?.cells ?? {}) as GridCells;
    const texts = () => net.docs.map((d) => formatScene(docToScene(d)).text);
    return { net, paint, cellsOf, texts };
  }

  const expectSame = (texts: string[], label: string) => {
    for (let i = 1; i < texts.length; i++) expect(texts[i], `${label}, client ${i}`).toBe(texts[0]);
  };

  /** Every painted cell decodes to a tile, flags intact: no row came out torn. */
  const expectWellFormed = (cells: GridCells, label: string) => {
    for (const [chunk, rows] of Object.entries(cells)) {
      const [cx, cy] = chunk.split(",").map(Number) as [number, number];
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < GRID_CHUNK; c++) {
          const v = readCell(cells, cx * GRID_CHUNK + c, cy * GRID_CHUNK + r);
          expect(() => decodeCell(v), `${label}: ${chunk} row ${r} col ${c}`).not.toThrow();
        }
    }
  };

  it("two clients painting different chunks converge, both paints kept", () => {
    const { net, paint, cellsOf, texts } = mapNetwork(2, 21);
    net.partition([0]);
    paint(0, [[5, 3, stone]], [[40, 0, 43, 1, water]]);
    paint(1, [
      [-3, 0, stone],
      [2, 40, water],
    ]);
    net.settle();
    expectSame(texts(), "different chunks");
    const cells = cellsOf(0);
    expect(readCell(cells, 0, 0)).toBe(grass);
    expect(readCell(cells, 5, 3)).toBe(stone);
    expect(readCell(cells, 41, 1)).toBe(water);
    expect(readCell(cells, -3, 0)).toBe(stone);
    expect(readCell(cells, 2, 40)).toBe(water);
    expect(decodeCell(readCell(cells, 5, 3))).toEqual({
      id: 5,
      flipX: true,
      flipY: false,
      flipD: true,
    });
    expect(Object.keys(cells).sort()).toEqual(["-1,0", "0,0", "0,1", "1,0"]);
  });

  it("two clients painting different rows of one chunk converge", () => {
    const { net, paint, cellsOf, texts } = mapNetwork(3, 22);
    net.partition([0]);
    net.partition([1]);
    paint(0, [[6, 0, stone]]);
    paint(1, [[1, 7, water]]);
    paint(2, [], [[0, 31, 31, 31, stone]]);
    net.settle();
    expectSame(texts(), "different rows");
    const cells = cellsOf(0);
    expect([0, 1, 2, 3, 6].map((c) => readCell(cells, c, 0))).toEqual([
      grass,
      grass,
      grass,
      grass,
      stone,
    ]);
    expect(readCell(cells, 1, 7)).toBe(water);
    expect(readCell(cells, 0, 31)).toBe(stone);
    expect(readCell(cells, 31, 31)).toBe(stone);
    expectWellFormed(cells, "different rows");
  });

  it("two clients painting one row end on one writer's row, whole, never a torn one", () => {
    const flags = FLIP_X | FLIP_Y | FLIP_D;
    const mine = [...Array.from({ length: 4 }, () => grass), stone];
    const theirs = [grass, water | flags, grass, grass];
    for (let seed = 1; seed <= 8; seed++) {
      const { net, paint, cellsOf, texts } = mapNetwork(2, seed * 211);
      net.partition([0]);
      paint(0, [[4, 0, stone]]);
      paint(1, [[1, 0, water | flags]]);
      net.settle();
      expectSame(texts(), `one row, seed ${seed}`);
      const cells = cellsOf(0);
      const row = Array.from({ length: 5 }, (_, c) => readCell(cells, c, 0));
      expect([mine, [...theirs, 0]], `seed ${seed}`).toContainEqual(row);
      expectWellFormed(cells, `one row, seed ${seed}`);
    }
  });

  it("random paints and fills across chunks and rows converge, every cell well formed", () => {
    const values = [0, grass, stone, water, water | FLIP_X];
    let painted = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const rand = rng(seed * 4099);
      const clients = 2 + (seed % 3);
      const { net, paint, cellsOf, texts } = mapNetwork(clients, seed * 4099);
      const int = (n: number) => Math.floor(rand() * n);
      for (let step = 0; step < 30; step++) {
        const i = int(clients);
        const cells: CellEdit[] = Array.from({ length: 1 + int(3) }, () => [
          int(96) - 32,
          int(64) - 16,
          values[int(values.length)]!,
        ]);
        const c0 = int(64) - 16;
        const r0 = int(64) - 16;
        const rects: CellRect[] | undefined =
          rand() < 0.3
            ? [[c0, r0, c0 + int(6), r0 + int(4), values[int(values.length)]!]]
            : undefined;
        paint(i, cells, rects);
        painted++;
        net.deliver(int(4));
        const roll = rand();
        if (roll < 0.1) net.partition([int(clients)]);
        else if (roll < 0.2) net.heal();
      }
      net.settle();
      expectSame(texts(), `tile seed ${seed}`);
      expectWellFormed(cellsOf(0), `tile seed ${seed}`);
    }
    expect(painted).toBe(300);
  });

  it("a paint writes one doc key per row it touches, flags kept in the row", () => {
    const { net, paint } = mapNetwork(1, 3);
    const doc = net.docs[0]!;
    paint(0, [
      [3, 2, stone],
      [33, 0, water],
    ]);
    const ground = [...entitiesMap(doc).values()].find((m) => m.get("id") === "ground")!;
    expect([...ground.keys()].filter((k) => k.startsWith("cells@")).sort()).toEqual(
      [
        gridRowKey("cells", "0,0", 0),
        gridRowKey("cells", "0,0", 2),
        gridRowKey("cells", "1,0", 0),
      ].sort(),
    );
    expect(decodeCell(readCell(docToScene(doc).entities![0]!.cells as GridCells, 3, 2))).toEqual({
      id: 5,
      flipX: true,
      flipY: false,
      flipD: true,
    });
  });
});
