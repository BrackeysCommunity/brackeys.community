import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { BEHAVIORS_FIELD } from "../../game/behaviors";
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
import { sceneHash } from "../../scene/hash";
import { sceneFrames } from "../../scene/resolve";
import type { EntityDef, PrefabLibrary, SceneDefinition, SceneOp } from "../../scene/types";
import { readPrefabFiles } from "../../vite/project-files";
import { applyOpsToDoc } from "../apply";
import { docLayout, docPrefabs, docToScene, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { staticPrefabSource } from "../prefab-source";
import { COLLAB_LAYOUT_VERSION, type SceneOrigin } from "../types";
import { validateDoc } from "../watch-issues";
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
