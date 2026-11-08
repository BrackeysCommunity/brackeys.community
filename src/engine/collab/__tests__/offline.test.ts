import { describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { engine, engineYard, randomOp, rng } from "../../scene/__tests__/fixtures/random-ops";
import { readCell, type GridCells } from "../../scene/grid";
import { prefabLibrary } from "../../scene/prefab";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docToScene } from "../convert";
import type { SceneOrigin } from "../types";
import { ada, apply, bo, entity, link, must, pair, sync, text } from "./helpers";

const game = createRegistry(testGame);
const prefabs = prefabLibrary([
  {
    kind: "prefab",
    v: 2,
    game: "test-game",
    id: "room",
    entities: [{ id: "light", type: "lamp", at: [10, 0] }],
  },
]);

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
      {
        id: "lamp",
        type: "lamp",
        at: [10, 0],
        group: "g",
        behaviors: { "test-game/glow": { intensity: 3 } },
      },
      { id: "floor", type: "paint", at: [0, 640], cells: { "0,0": ["1*4"] } },
    ],
  };
}

const edit = (doc: Y.Doc, batch: OpBatch, origin: SceneOrigin) =>
  must(applyOpsToDoc(doc, batch, origin, game, { prefabs }));

describe("offline", () => {
  it("edits made while disconnected merge on reconnect", () => {
    const [a, b] = pair(engineYard());
    let unlink = link(a, b);
    apply(a, { ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] }, ada, engine);
    expect(entity(b, "crate")!.shape).toEqual(["circle", 1210, 940, 20]);

    unlink();
    apply(a, { ops: [{ op: "update", ref: "crate", set: { density: 7 } }] }, ada, engine);
    apply(
      a,
      { ops: [{ op: "add", entity: { id: "offline-a", type: "marker", at: [1, 1] } }] },
      ada,
      engine,
    );
    apply(b, { ops: [{ op: "remove", refs: ["zone"] }] }, bo, engine);
    apply(
      b,
      { ops: [{ op: "add", entity: { id: "offline-b", type: "marker", at: [2, 2] } }] },
      bo,
      engine,
    );
    expect(entity(b, "offline-a")).toBeUndefined();

    sync(a, b);
    unlink = link(a, b);
    expect(text(a)).toBe(text(b));
    expect(entity(a, "crate")).toMatchObject({ density: 7 });
    expect(entity(a, "zone")).toBeUndefined();
    expect(entity(a, "offline-a")).toBeDefined();
    expect(entity(a, "offline-b")).toBeDefined();
    unlink();
  });

  it("a long offline session of random batches on both sides converges on reconnect", () => {
    const rand = rng(404);
    const [a, b] = pair(engineYard());
    for (let i = 0; i < 80; i++) {
      const doc = i % 2 === 0 ? a : b;
      const ops = [randomOp(engine, docToScene(doc), rand)];
      applyOpsToDoc(doc, { ops }, i % 2 === 0 ? ada : bo, engine, { validate: "none" });
    }
    sync(a, b);
    expect(text(a)).toBe(text(b));
  });

  it("offline edits to assets, group and instance transforms, params, behaviors and paint merge", () => {
    const [a, b] = pair(gameYard());
    const paint = (cells: [number, number, number][]): OpBatch => ({
      ops: [{ op: "paintCells", ref: "floor", field: "cells", cells }],
    });
    edit(a, { ops: [{ op: "useAssets", add: ["hud"] }] }, ada);
    edit(a, { ops: [{ op: "setGroup", id: "g", rot: 1 }] }, ada);
    edit(a, { ops: [{ op: "update", ref: "room-1", set: { "params.tint": 2 } }] }, ada);
    edit(
      a,
      { ops: [{ op: "update", ref: "lamp", set: { "behaviors.test-game/glow.intensity": 5 } }] },
      ada,
    );
    edit(a, paint([[0, 1, 3]]), ada);

    edit(b, { ops: [{ op: "useAssets", add: ["music"], remove: ["boom"] }] }, bo);
    edit(b, { ops: [{ op: "setGroup", id: "g", at: [50, 50] }] }, bo);
    edit(b, { ops: [{ op: "update", ref: "room-1", set: { "params.speed": 7 } }] }, bo);
    edit(b, { ops: [{ op: "transform", refs: ["room-1"], flip: "x" }] }, bo);
    edit(b, { ops: [{ op: "setZ", refs: ["room-1"], z: -2 }] }, bo);
    edit(
      b,
      {
        ops: [{ op: "update", ref: "lamp", set: { "behaviors.test-game/glow.color": "#00ff00" } }],
      },
      bo,
    );
    edit(
      b,
      paint([
        [0, 2, 2],
        [40, 0, 1],
      ]),
      bo,
    );

    sync(a, b);
    expect(text(a)).toBe(text(b));
    const def = docToScene(a);
    expect(def.assets).toEqual(["hud", "music"]);
    expect(def.groups).toEqual({ g: { at: [50, 50], rot: 1 } });
    expect(def.instances![0]).toMatchObject({ flip: true, z: -2, params: { tint: 2, speed: 7 } });
    expect(entity(a, "lamp")!.behaviors).toEqual({
      "test-game/glow": { intensity: 5, color: "#00ff00" },
    });
    const cells = entity(a, "floor")!.cells as GridCells;
    expect([readCell(cells, 0, 0), readCell(cells, 0, 1), readCell(cells, 0, 2)]).toEqual([
      1, 3, 2,
    ]);
    expect(readCell(cells, 40, 0)).toBe(1);
  });
});
