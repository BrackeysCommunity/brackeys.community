import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import {
  engine,
  engineYard,
  fake,
  fakeYard,
  randomOp,
  rng,
  yardPrefabs,
} from "../../scene/__tests__/fixtures/random-ops";
import { formatScene } from "../../scene/format";
import { readCell, type GridCells } from "../../scene/grid";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { formatPrefabs, prefabLibrary } from "../../scene/prefab";
import type { OpBatch, Prefab, SceneDefinition } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { applyOpsToDoc } from "../apply";
import {
  assetsMap,
  docToScene,
  entitiesMap,
  groupsMap,
  instancesMap,
  readDoc,
  sceneMap,
  sceneToDoc,
} from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import { localPrefabSource } from "../prefab-source";
import { revertEntry } from "../revert";
import { ASSETS_KEY, GROUP_KEY_PREFIX, INSTANCE_KEY_PREFIX, type SceneOrigin } from "../types";
import { createSceneUndo } from "../undo";
import { bo, keyOf, pair, sync } from "./helpers";

const text = (def: SceneDefinition) => formatScene(def).text;
const user: SceneOrigin = { kind: "user", userId: "u1", name: "Ada" };

describe("applyOpsToDoc", () => {
  for (const [label, reg, yard] of [
    ["engine-yard", engine, engineYard],
    ["the fake game's yard", fake, fakeYard],
  ] as const) {
    it(`writes what applyOps computes, byte for byte, for random batches: ${label}`, () => {
      const rand = rng(0xd0c);
      const doc = sceneToDoc(yard(), { key: sequentialKeys("seed") });
      const source = localPrefabSource(yardPrefabs(yard().game), { key: sequentialKeys("pf") });
      const key = sequentialKeys("new");
      let applied = 0;
      for (let i = 0; i < 300; i++) {
        const before = docToScene(doc);
        const prefabs = source.library();
        const ops = Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
          randomOp(reg, before, rand, prefabs),
        );
        const batch: OpBatch = { ops };
        const expected = applyOps(before, { ...batch, base: sceneHash(before) }, reg, {
          validate: "none",
          prefabs,
        });
        const vector = Y.encodeStateVector(doc);
        let transactions = 0;
        const count = () => transactions++;
        doc.on("afterTransaction", count);
        const got = applyOpsToDoc(doc, batch, user, reg, {
          validate: "none",
          key,
          prefabs,
          prefabWriter: source.writer!,
        });
        doc.off("afterTransaction", count);

        expect(got.ok).toBe(expected.ok);
        if (!expected.ok || !got.ok) {
          expect(transactions).toBe(0);
          expect(Y.encodeStateVector(doc)).toEqual(vector);
          continue;
        }
        applied++;
        expect(transactions).toBe(1);
        expect(text(docToScene(doc))).toBe(text(expected.def));
        expect(Object.fromEntries(formatPrefabs(source.library()))).toEqual(
          Object.fromEntries(formatPrefabs(expected.prefabs ?? prefabs)),
        );
        expect(got.hash).toBe(sceneHash(docToScene(doc)));
        for (const ref of [...got.touched, ...got.created])
          if (!expected.diff.some((c) => c.kind === "removed" && c.ref === ref))
            expect(got.refKeys[ref], ref).toBeDefined();
      }
      expect(applied).toBeGreaterThan(100);
    }, 60_000);
  }

  it("keeps keys across renames, shifts, promotes and demotes", () => {
    const doc = sceneToDoc(engineYard(), { key: sequentialKeys() });
    const keyOf = (ref: string) => {
      const view = readDoc(doc);
      if (!ref.startsWith("~"))
        return view.entityKeys[view.def.entities!.findIndex((e) => e.id === ref)];
      const [, bulk, index] = /^~(.+):(\d+)$/.exec(ref)!;
      return view.bulkKeys.get(bulk!)![Number(index)];
    };
    const ledge = keyOf("ledge");
    const third = keyOf("~solid:2");
    const r1 = applyOpsToDoc(
      doc,
      { ops: [{ op: "rename", from: "ledge", to: "shelf" }] },
      user,
      engine,
    );
    expect(r1.ok).toBe(true);
    expect(keyOf("shelf")).toBe(ledge);
    applyOpsToDoc(doc, { ops: [{ op: "remove", refs: ["~solid:0"] }] }, user, engine);
    expect(keyOf("~solid:1")).toBe(third);
    applyOpsToDoc(doc, { ops: [{ op: "promote", ref: "~solid:1", id: "wall" }] }, user, engine);
    expect(keyOf("wall")).toBe(third);
    applyOpsToDoc(doc, { ops: [{ op: "demote", id: "wall" }] }, user, engine);
    expect(keyOf("~solid:1")).toBe(third);
  });

  it("resolves bulk refs against the doc as it is, with no base", () => {
    const doc = sceneToDoc(engineYard());
    const r = applyOpsToDoc(
      doc,
      { ops: [{ op: "move", refs: ["~solid:1"], by: [5, 0] }] },
      user,
      engine,
    );
    expect(r.ok).toBe(true);
    expect((docToScene(doc).solid as unknown[][])[1]).toEqual(["box", 25, 500, 20, 500]);
  });

  it("still checks a base the batch brings", () => {
    const doc = sceneToDoc(engineYard());
    const r = applyOpsToDoc(
      doc,
      { base: "0000000000000000", ops: [{ op: "remove", refs: ["~solid:0"] }] },
      user,
      engine,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe("stale-base");
  });

  it("writes only the fields that changed", () => {
    const doc = sceneToDoc(engineYard());
    const changed: string[] = [];
    doc.getMap("entities").observeDeep((events) => {
      for (const ev of events) for (const k of ev.changes.keys.keys()) changed.push(k);
    });
    applyOpsToDoc(
      doc,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 90 } }] },
      user,
      engine,
    );
    expect(changed).toEqual(["speed"]);
  });

  it("logs each batch with its actor, keys and before state", () => {
    const doc = sceneToDoc(engineYard());
    const agent: SceneOrigin = { kind: "agent", agentId: "claude", onBehalfOf: "u1" };
    applyOpsToDoc(
      doc,
      { label: "Nudge", ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] },
      agent,
      engine,
    );
    const [entry] = readLog(doc);
    expect(entry).toMatchObject({ actor: agent, label: "Nudge", ops: ["move"] });
    expect(entry!.keys).toHaveLength(1);
    expect(entry!.before![entry!.keys[0]!]).toMatchObject({
      id: "crate",
      shape: ["circle", 1200, 940, 20],
    });
  });
});

const game = createRegistry(testGame);
const GLOW = "test-game/glow";

/** A test-game scene on a square grid: a painted floor, a lamp in a group and an instance of a prefab. */
function gameYard(): SceneDefinition {
  return {
    v: 2,
    game: "test-game",
    name: "game-yard",
    bounds: [0, 0, 1000, 1000],
    settings: { grid: { kind: "square", cell: [32, 32] } },
    assets: ["boom"],
    groups: { g: { at: [100, 100] } },
    instances: [{ id: "room-1", prefab: "room", at: [200, 200], params: { tint: 1 } }],
    entities: [
      { id: "lamp", type: "lamp", at: [10, 10], group: "g" },
      { id: "floor", type: "paint", at: [0, 640], cells: { "0,0": ["1*4", "", "2"] } },
    ],
  };
}

const gamePrefabs = prefabLibrary([
  {
    kind: "prefab",
    v: 2,
    game: "test-game",
    id: "room",
    entities: [{ id: "light", type: "lamp", at: [10, 10] }],
  },
]);

const run = (doc: Y.Doc, batch: OpBatch, origin: SceneOrigin = user) => {
  const r = applyOpsToDoc(doc, batch, origin, game, { prefabs: gamePrefabs });
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r;
};

/** The keys written inside `map`'s entries (or `map` itself) while `fn` runs, as `entry/key`. */
function writes<T>(map: Y.Map<T>, fn: () => void): string[] {
  const out: string[] = [];
  const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const ev of events) {
      const at = ev.path.join("/");
      for (const k of ev.changes.keys.keys()) out.push(at ? `${at}/${k}` : k);
    }
  };
  map.observeDeep(observer);
  fn();
  map.unobserveDeep(observer);
  return out.sort();
}

describe("applyOpsToDoc: layout 3", () => {
  it("reads back every v3 addition the batch wrote", () => {
    const doc = sceneToDoc(gameYard(), { key: sequentialKeys() });
    run(doc, {
      ops: [
        { op: "useAssets", add: ["hud"], remove: ["boom"] },
        { op: "setGroup", id: "g", rot: 2, flip: true },
        { op: "transform", refs: ["room-1"], turn: 1 },
        { op: "setZ", refs: ["room-1"], z: 3 },
        { op: "paintCells", ref: "floor", field: "cells", cells: [[40, 0, 3]] },
      ],
    });
    const def = docToScene(doc);
    expect(def.assets).toEqual(["hud"]);
    expect(def.groups).toEqual({ g: { at: [100, 100], rot: 2, flip: true } });
    expect(def.instances![0]).toMatchObject({ id: "room-1", rot: 1, z: 3, params: { tint: 1 } });
    expect(readCell(def.entities!.find((e) => e.id === "floor")!.cells as GridCells, 40, 0)).toBe(
      3,
    );
    expect(sceneMap(doc).has("assets")).toBe(false);
  });

  it("writes useAssets one id at a time, and concurrent adds merge", () => {
    const [a, b] = pair(gameYard());
    expect(
      writes(assetsMap(a), () => run(a, { ops: [{ op: "useAssets", add: ["hud"] }] })),
    ).toEqual(["hud"]);
    run(b, { ops: [{ op: "useAssets", add: ["music"], remove: ["boom"] }] }, bo);
    sync(a, b);
    expect(docToScene(a).assets).toEqual(["hud", "music"]);
    expect(docToScene(b).assets).toEqual(["hud", "music"]);
  });

  it("writes a group's rot and flip as keys of their own, merging with a concurrent move", () => {
    const [a, b] = pair(gameYard());
    const g = groupsMap(a);
    expect(
      writes(g, () => run(a, { ops: [{ op: "setGroup", id: "g", rot: 1, flip: true }] })),
    ).toEqual(["g/flip", "g/rot"]);
    run(b, { ops: [{ op: "setGroup", id: "g", at: [120, 100] }] }, bo);
    sync(a, b);
    expect(docToScene(a).groups).toEqual({ g: { at: [120, 100], rot: 1, flip: true } });
    expect(
      writes(g, () => run(a, { ops: [{ op: "setGroup", id: "g", rot: 0, flip: false }] })),
    ).toEqual(["g/flip", "g/rot"]);
    expect(docToScene(a).groups).toEqual({ g: { at: [120, 100] } });
  });

  it("writes an instance's rot, flip and z as fields and its params per key", () => {
    const [a, b] = pair(gameYard());
    const key = readDoc(a).instanceKeys[0]!;
    const map = instancesMap(a);
    expect(
      writes(map, () => run(a, { ops: [{ op: "transform", refs: ["room-1"], flip: "x" }] })),
    ).toEqual([`${key}/flip`]);
    expect(writes(map, () => run(a, { ops: [{ op: "setZ", refs: ["room-1"], z: 4 }] }))).toEqual([
      `${key}/z`,
    ]);
    expect(
      writes(map, () =>
        run(a, { ops: [{ op: "update", ref: "room-1", set: { "params.tint": 2 } }] }),
      ),
    ).toEqual([`${key}/params/tint`]);
    run(b, { ops: [{ op: "update", ref: "room-1", set: { "params.speed": 5 } }] }, bo);
    sync(a, b);
    expect(docToScene(a).instances![0]!.params).toEqual({ tint: 2, speed: 5 });
    expect(docToScene(b).instances![0]).toMatchObject({ flip: true, z: 4 });
  });

  it("writes a paint as the rows it changed, and painters in different rows merge", () => {
    const [a, b] = pair(gameYard());
    const key = keyOf(a, "floor")!;
    const paint = (cells: [number, number, number][]) => ({
      ops: [{ op: "paintCells" as const, ref: "floor", field: "cells", cells }],
    });
    expect(writes(entitiesMap(a), () => run(a, paint([[5, 0, 3]])))).toEqual([
      `${key}/cells@0,0/0`,
    ]);
    expect(writes(entitiesMap(a), () => run(a, paint([[33, 1, 2]])))).toEqual([
      `${key}/cells@1,0/1`,
    ]);
    expect(writes(entitiesMap(a), () => run(a, paint([[0, 2, 0]])))).toEqual([
      `${key}/cells@0,0/2`,
    ]);
    sync(a, b);
    run(a, paint([[1, 3, 1]]));
    run(b, paint([[1, 4, 2]]), bo);
    sync(a, b);
    const cells = docToScene(b).entities!.find((e) => e.id === "floor")!.cells as GridCells;
    expect([readCell(cells, 5, 0), readCell(cells, 33, 1), readCell(cells, 0, 2)]).toEqual([
      3, 2, 0,
    ]);
    expect([readCell(cells, 1, 3), readCell(cells, 1, 4)]).toEqual([1, 2]);
    expect(formatScene(docToScene(a)).text).toBe(formatScene(docToScene(b)).text);
  });

  it("logs and reverts the assets, a group's transform, an instance's params and a paint", () => {
    const doc = sceneToDoc(gameYard(), { key: sequentialKeys() });
    const start = text(docToScene(doc));
    const instanceKey = readDoc(doc).instanceKeys[0]!;
    const r = run(doc, {
      ops: [
        { op: "useAssets", add: ["hud"], remove: ["boom"] },
        { op: "setGroup", id: "g", rot: 3 },
        { op: "update", ref: "room-1", set: { "params.tint": 9 } },
        { op: "paintCells", ref: "floor", field: "cells", rects: [[0, 0, 40, 3, 2]] },
      ],
    });
    expect(r.keys).toEqual(
      expect.arrayContaining([
        ASSETS_KEY,
        `${GROUP_KEY_PREFIX}g`,
        `${INSTANCE_KEY_PREFIX}${instanceKey}`,
        keyOf(doc, "floor"),
      ]),
    );
    const entry = readLog(doc).at(-1)!;
    expect(entry.before![ASSETS_KEY]).toEqual(["boom"]);
    const reverted = revertEntry(doc, entry, bo);
    expect(reverted.ok).toBe(true);
    expect(text(docToScene(doc))).toBe(start);
  });

  it("reverts an assets change back to none, and refuses one changed since", () => {
    const doc = sceneToDoc({ ...gameYard(), assets: [] }, { key: sequentialKeys() });
    run(doc, { ops: [{ op: "useAssets", add: ["hud"] }] });
    const added = readLog(doc).at(-1)!;
    expect(added.before![ASSETS_KEY]).toBeNull();
    run(doc, { ops: [{ op: "useAssets", add: ["music"] }] });
    const refused = revertEntry(doc, added, bo);
    expect(refused.ok).toBe(false);
    expect(revertEntry(doc, readLog(doc).at(-1)!, bo).ok).toBe(true);
    expect(revertEntry(doc, added, bo).ok).toBe(true);
    expect(docToScene(doc).assets).toBeUndefined();
  });

  it("undoes and redoes the new maps' writes as one step each", () => {
    const doc = sceneToDoc(gameYard(), { key: sequentialKeys() });
    const start = text(docToScene(doc));
    const undo = createSceneUndo(doc, user);
    run(doc, {
      ops: [
        { op: "useAssets", add: ["hud"] },
        { op: "setGroup", id: "g", flip: true },
        { op: "update", ref: "room-1", set: { "params.tint": 3 } },
        { op: "paintCells", ref: "floor", field: "cells", cells: [[7, 7, 1]] },
      ],
    });
    undo.commit({ before: [], after: [] });
    const edited = text(docToScene(doc));
    expect(edited).not.toBe(start);
    expect(undo.undo()).not.toBeNull();
    expect(text(docToScene(doc))).toBe(start);
    expect(undo.redo()).not.toBeNull();
    expect(text(docToScene(doc))).toBe(edited);
    undo.destroy();
  });

  it("writes a behavior block field by field", () => {
    const doc = sceneToDoc(gameYard(), { key: sequentialKeys() });
    const key = keyOf(doc, "lamp")!;
    const kept = entitiesMap(doc).get(key)!.get("behaviors");
    expect(kept).toBeInstanceOf(Y.Map);
    expect((kept as Y.Map<unknown>).size).toBe(0);
    expect(
      writes(entitiesMap(doc), () =>
        run(doc, {
          ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${GLOW}.intensity`]: 3 } }],
        }),
      ),
    ).toEqual([`${key}/behaviors/${GLOW}`]);
    expect(
      writes(entitiesMap(doc), () =>
        run(doc, {
          ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${GLOW}.color`]: "#00ff00" } }],
        }),
      ),
    ).toEqual([`${key}/behaviors/${GLOW}/color`]);
  });

  it("writes a prefab doc's assets and nested instances, and reverts its params and variant", () => {
    const doc = prefabToDoc(gamePrefabs.get("room")!, { key: sequentialKeys() });
    const start = docToPrefab(doc);
    const lightKey = keyOf(doc, "light")!;
    const r = run(doc, {
      ops: [
        { op: "useAssets", add: ["hud"] },
        { op: "setZ", refs: ["light"], z: 2 },
      ],
    });
    expect(r.keys.sort()).toEqual([ASSETS_KEY, lightKey].sort());
    expect(docToPrefab(doc).assets).toEqual(["hud"]);
    expect(assetsMap(doc).toJSON()).toEqual({ hud: true });
    expect(revertEntry(doc, readLog(doc).at(-1)!, bo).ok).toBe(true);
    expect(docToPrefab(doc)).toEqual(start);

    const entry = prefabPatch(
      doc,
      {
        ...start,
        base: "hall",
        overrides: { "light.at": [1, 1] },
        params: {
          glow: { description: "How bright.", targets: [`light.behaviors.${GLOW}.intensity`] },
        },
        instances: [{ id: "inner", prefab: "hall", at: [5, 5] }],
      },
      user,
    )!;
    expect(docToPrefab(doc)).toMatchObject({ base: "hall", instances: [{ id: "inner" }] });
    expect(revertEntry(doc, entry, bo).ok).toBe(true);
    expect(docToPrefab(doc)).toEqual(start);
  });

  it("paints a prefab doc's grid child as the rows it changed", () => {
    const doc = prefabToDoc(
      {
        kind: "prefab",
        v: 2,
        game: "test-game",
        id: "tiles",
        entities: [{ id: "floor", type: "paint", at: [0, 0], cells: { "0,0": ["1*4"] } }],
      },
      { key: sequentialKeys() },
    );
    const key = keyOf(doc, "floor")!;
    expect(
      writes(entitiesMap(doc), () =>
        run(doc, { ops: [{ op: "paintCells", ref: "floor", field: "cells", cells: [[2, 1, 3]] }] }),
      ),
    ).toEqual([`${key}/cells@0,0/1`]);
    const cells = docToPrefab(doc).entities[0]!.cells as GridCells;
    expect([readCell(cells, 0, 0), readCell(cells, 2, 1)]).toEqual([1, 3]);
  });
});

const fixturePrefab = (name: string): Prefab =>
  JSON.parse(
    readFileSync(
      new URL(`../../scene/__tests__/fixtures/prefabs/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Prefab;

describe("applyOpsToDoc on a prefab that nests instances", () => {
  const engineReg = createRegistry();
  /** room holds two gates and a door, and the door holds a gate: three levels. */
  const nested = () =>
    localPrefabSource(prefabLibrary(["gate", "door", "room"].map(fixturePrefab)), {
      key: sequentialKeys("n"),
    });
  const instanceOf = (doc: Y.Doc, id: string) =>
    docToPrefab(doc).instances?.find((i) => i.id === id);

  it("needs the project's writer to apply an instance's overrides to a prefab", () => {
    const source = nested();
    const room = source.docs().get("room")!;
    const vector = Y.encodeStateVector(room);
    const r = applyOpsToDoc(
      room,
      { ops: [{ op: "applyToPrefab", ref: "door-1" }] },
      user,
      engineReg,
      { prefabs: source.library() },
    );
    expect(r.ok || [r.issue.code, r.issue.message]).toEqual([
      "op-invalid",
      expect.stringContaining("needs the project"),
    ]);
    expect(Y.encodeStateVector(room)).toEqual(vector);
  });

  it("applies a nested instance's overrides to its own prefab, or to a deeper one with `to`", () => {
    const source = nested();
    const room = source.docs().get("room")!;
    const opts = () => ({ prefabs: source.library(), prefabWriter: source.writer! });
    const own = applyOpsToDoc(
      room,
      { ops: [{ op: "applyToPrefab", ref: "door-1", paths: ["panel.path.speed"] }] },
      user,
      engineReg,
      opts(),
    );
    expect(own.ok && own.docs).toEqual([{ doc: "prefab:door", entry: expect.any(String) }]);
    const panel = source
      .library()
      .get("door")!
      .entities.find((e) => e.id === "panel")!;
    expect((panel.path as { speed: number }).speed).toBe(50);
    expect(instanceOf(room, "door-1")!.overrides).toEqual({ "latch/door.path.speed": 30 });

    const deeper = applyOpsToDoc(
      room,
      { ops: [{ op: "applyToPrefab", ref: "door-1", to: "gate" }] },
      user,
      engineReg,
      opts(),
    );
    expect(deeper.ok && deeper.docs).toEqual([{ doc: "prefab:gate", entry: expect.any(String) }]);
    const gateDoor = source
      .library()
      .get("gate")!
      .entities.find((e) => e.id === "door")!;
    expect((gateDoor.path as { speed: number }).speed).toBe(30);
    expect(instanceOf(room, "door-1")!.overrides).toBeUndefined();
    expect(readLog(room).map((e) => e.ops)).toEqual([["applyToPrefab"], ["applyToPrefab"]]);
  });

  it("unpacks one level: the nested instance's own instances become the prefab's", () => {
    const source = nested();
    const room = source.docs().get("room")!;
    const r = applyOpsToDoc(room, { ops: [{ op: "unpack", ref: "door-1" }] }, user, engineReg, {
      prefabs: source.library(),
      prefabWriter: source.writer!,
    });
    expect(r.ok || r.issue).toBe(true);
    const after = docToPrefab(room);
    expect(after.instances!.map((i) => i.id)).not.toContain("door-1");
    expect(after.instances!.filter((i) => i.prefab === "gate")).toHaveLength(3);
    expect(after.entities.length).toBeGreaterThan(fixturePrefab("room").entities.length);
    expect(r.ok && r.docs).toEqual([]);
  });

  it("refuses a nested instance in a group", () => {
    const source = nested();
    const room = source.docs().get("room")!;
    const r = applyOpsToDoc(
      room,
      {
        ops: [
          { op: "instantiate", instance: { id: "gate-9", prefab: "gate", at: [0, 0], group: "g" } },
        ],
      },
      user,
      engineReg,
      { prefabs: source.library() },
    );
    expect(r.ok).toBe(false);
  });
});

describe("applyOpsToDoc: a prefab doc's header ops", () => {
  const engineReg = createRegistry();
  const post: Prefab = {
    kind: "prefab",
    v: 4,
    id: "post",
    entities: [{ id: "cap", type: "marker", at: [0, -130] }],
  };
  const tall: Prefab = {
    kind: "prefab",
    v: 4,
    id: "tall",
    base: "post",
    overrides: { "cap.at": [0, -150] },
    entities: [{ id: "lamp", type: "marker", at: [0, -160] }],
  };
  const library = prefabLibrary([post, tall, { ...post, id: "short" }]);
  const height = { description: "Cap height.", targets: ["cap.at"] };
  const apply = (doc: Y.Doc, ops: OpBatch["ops"], lib = library) =>
    applyOpsToDoc(doc, { ops }, user, engineReg, { prefabs: lib });

  it("sets the base and exposes parameters per key, logged under the variant and param keys", () => {
    const doc = prefabToDoc(tall, { key: sequentialKeys() });
    const header = doc.getMap("prefab");
    const params = doc.getMap("params");
    const headerWrites: string[] = [];
    const paramWrites: string[] = [];
    header.observe((e) => headerWrites.push(...e.keysChanged));
    params.observe((e) => paramWrites.push(...e.keysChanged));
    const r = apply(doc, [
      { op: "setPrefabBase", base: "short" },
      { op: "exposeParam", name: "height", param: height },
    ]);
    expect(r.ok && r.keys.sort()).toEqual(["@param:height", "@variant"]);
    expect(headerWrites).toEqual(["base"]);
    expect(paramWrites).toEqual(["height"]);
    expect(docToPrefab(doc)).toMatchObject({
      base: "short",
      overrides: tall.overrides,
      params: { height },
    });
    const entry = readLog(doc).at(-1)!;
    expect(entry.ops).toEqual(["setPrefabBase", "exposeParam"]);
    expect(entry.before).toEqual({
      "@variant": { base: "post", overrides: tall.overrides },
      "@param:height": null,
    });

    const cleared = apply(doc, [
      { op: "exposeParam", name: "height", param: null },
      { op: "setPrefabBase", base: null },
    ]);
    expect(cleared.ok && cleared.keys.sort()).toEqual(["@param:height", "@variant"]);
    expect(docToPrefab(doc).base).toBeUndefined();
    expect(docToPrefab(doc).params).toBeUndefined();
    expect(docToPrefab(doc).overrides).toEqual(tall.overrides);
    expect(revertEntry(doc, readLog(doc).at(-1)!, bo).ok).toBe(true);
    expect(revertEntry(doc, entry, bo).ok).toBe(true);
    expect(docToPrefab(doc)).toEqual(tall);
  });

  it("writes body ops and header ops in one transaction and one log entry", () => {
    const doc = prefabToDoc(post, { key: sequentialKeys() });
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    const r = apply(doc, [
      { op: "exposeParam", name: "height", param: height },
      { op: "move", refs: ["cap"], by: [0, -5] },
    ]);
    expect(r.ok).toBe(true);
    expect(transactions).toBe(1);
    expect(readLog(doc).at(-1)!.keys).toContain("@param:height");
    expect(docToPrefab(doc).entities[0]!.at).toEqual([0, -135]);
  });

  it("two clients exposing different parameters and one setting the base all land", () => {
    const seed = prefabToDoc(post, { key: sequentialKeys("s") });
    const [a, b] = [new Y.Doc(), new Y.Doc()];
    Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));
    expect(apply(a, [{ op: "exposeParam", name: "height", param: height }]).ok).toBe(true);
    expect(
      apply(b, [
        { op: "exposeParam", name: "tags", param: { description: "Tags.", targets: ["cap.tags"] } },
        { op: "setPrefabBase", base: "short" },
      ]).ok,
    ).toBe(true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(docToPrefab(a)).toEqual(docToPrefab(b));
    expect(docToPrefab(a)).toMatchObject({ base: "short" });
    expect(Object.keys(docToPrefab(a).params!).sort()).toEqual(["height", "tags"]);
  });

  it("refuses an unknown base, itself and a cycle through bases or nested instances, writing nothing", () => {
    const doc = prefabToDoc(post, { key: sequentialKeys() });
    const vector = Y.encodeStateVector(doc);
    const issue = (ops: OpBatch["ops"], lib = library) => {
      const r = apply(doc, ops, lib);
      return r.ok ? null : { code: r.issue.code, failedAt: r.failedAt, path: r.issue.path };
    };
    expect(issue([{ op: "setPrefabBase", base: "shorts" }])).toEqual({
      code: "variant-base-unknown",
      failedAt: 0,
      path: "/ops/0/base",
    });
    const r = apply(doc, [{ op: "setPrefabBase", base: "shorts" }]);
    expect(r.ok || r.issue.message).toContain('did you mean "short"');
    expect(issue([{ op: "setPrefabBase", base: "post" }])?.code).toBe("prefab-cycle");
    expect(
      issue([
        { op: "move", refs: ["cap"], by: [1, 0] },
        { op: "setPrefabBase", base: "tall" },
      ]),
    ).toEqual({ code: "prefab-cycle", failedAt: 1, path: "/ops/1/base" });
    const holder: Prefab = {
      kind: "prefab",
      v: 4,
      id: "holder",
      entities: [],
      instances: [{ id: "p-1", prefab: "post", at: [0, 0] }],
    };
    const withHolder = new Map([...library, ["holder", holder]]);
    expect(issue([{ op: "setPrefabBase", base: "holder" }], withHolder)?.code).toBe("prefab-cycle");
    expect(
      issue([{ op: "exposeParam", name: "height", param: { description: "", targets: [] } }]),
    ).toMatchObject({ code: "op-invalid", failedAt: 0 });
    expect(Y.encodeStateVector(doc)).toEqual(vector);
  });

  it("applies a variant's unused-override fix to its doc, per path, keeping a concurrent edit", () => {
    const stale: Prefab = { ...tall, overrides: { "cap.at": [0, -150], "ghost.at": [1, 1] } };
    const lib = prefabLibrary([post, stale]);
    const doc = prefabToDoc(stale, { key: sequentialKeys() });
    const view = readDoc(doc, { registry: engineReg, prefabs: lib });
    const [issue, ...rest] = validateScene(view.def, engineReg, { prefabs: lib, prefab: "tall" });
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ code: "unused-override", path: "/overrides/ghost.at" });
    expect(issue!.fix!.ops).toEqual([{ op: "revertOverride", paths: ["ghost.at"] }]);

    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const moved = applyOpsToDoc(
      other,
      { ops: [{ op: "move", refs: ["lamp"], by: [0, 5] }] },
      user,
      engineReg,
      { prefabs: lib },
    );
    expect(moved.ok).toBe(true);

    const fixed = applyOpsToDoc(doc, issue!.fix!, user, engineReg, { prefabs: lib });
    expect(fixed.ok && fixed.keys).toEqual(["@variant"]);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const merged = docToPrefab(doc);
    expect(docToPrefab(other)).toEqual(merged);
    expect(merged.overrides).toEqual({ "cap.at": [0, -150] });
    expect(merged.entities).toEqual([{ id: "lamp", type: "marker", at: [0, -155] }]);
    const after = prefabLibrary([post, merged]);
    expect(
      validateScene(readDoc(doc, { registry: engineReg, prefabs: after }).def, engineReg, {
        prefabs: after,
        prefab: "tall",
      }),
    ).toEqual([]);
    const entry = readLog(doc).find((e) => e.ops?.includes("revertOverride"))!;
    expect(revertEntry(doc, entry, bo).ok).toBe(true);
    expect(docToPrefab(doc).overrides).toEqual(stale.overrides);
    expect(docToPrefab(doc).entities).toEqual(merged.entities);
  });

  it("sets a variant's own overrides with an override that has no ref", () => {
    const doc = prefabToDoc(tall, { key: sequentialKeys() });
    const r = apply(doc, [{ op: "override", set: { "cap.at": [0, -170] } }]);
    expect(r.ok && r.keys).toEqual(["@variant"]);
    expect(docToPrefab(doc).overrides).toEqual({ "cap.at": [0, -170] });
    const cleared = apply(doc, [{ op: "revertOverride" }]);
    expect(cleared.ok).toBe(true);
    expect(docToPrefab(doc).overrides).toBeUndefined();
    expect(docToPrefab(doc).base).toBe("post");
  });

  it("reports a body op's failure at its index in the batch the header ops were sent in", () => {
    const doc = prefabToDoc(post, { key: sequentialKeys() });
    const r = apply(doc, [
      { op: "exposeParam", name: "height", param: height },
      { op: "setPrefabBase", base: "short" },
      { op: "remove", refs: ["nope"] },
    ]);
    expect(r.ok || [r.failedAt, r.issue.path]).toEqual([2, "/ops/2"]);
    expect(docToPrefab(doc)).toEqual(post);
  });

  it("refuses header ops on a scene with op-invalid", () => {
    const doc = sceneToDoc({ v: 4, name: "yard", bounds: [0, 0, 100, 100] });
    const vector = Y.encodeStateVector(doc);
    for (const op of [
      { op: "setPrefabBase", base: "post" },
      { op: "exposeParam", name: "height", param: height },
      { op: "revertOverride", paths: ["cap.at"] },
    ] as OpBatch["ops"]) {
      const r = apply(doc, [{ op: "setScene", set: { name: "court" } }, op]);
      expect(r.ok || [r.issue.code, r.failedAt]).toEqual(["op-invalid", 1]);
      expect(r.ok || r.issue.message).toContain("only works on a prefab doc");
    }
    expect(Y.encodeStateVector(doc)).toEqual(vector);
  });
});
