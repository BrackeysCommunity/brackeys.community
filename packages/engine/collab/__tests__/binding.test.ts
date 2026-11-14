import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { createSceneRuntime } from "../../runtime/runtime";
import { engine, engineYard, yardPrefabs } from "../../scene/__tests__/fixtures/random-ops";
import { expandScene } from "../../scene/expand";
import { prefabLibrary } from "../../scene/prefab";
import type {
  ExpandedScene,
  OpBatch,
  Prefab,
  RuntimeEntity,
  SceneDefinition,
} from "../../scene/types";
import type { RapierModule } from "../../types";
import { applyOpsToDoc } from "../apply";
import { bindSceneDoc, expandLenient, type BindableRuntime } from "../bind";
import { docToScene } from "../convert";
import { docToPrefab, prefabPatch } from "../prefab-doc";
import { localPrefabSource } from "../prefab-source";
import { ada, apply, bo, link, must, pair } from "./helpers";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function spyRuntime() {
  const rt = {
    load: vi.fn((_s: ExpandedScene) => ({ ok: true })),
    add: vi.fn((_e: RuntimeEntity[]) => ({ ok: true })),
    update: vi.fn((_e: RuntimeEntity[]) => ({ ok: true })),
    remove: vi.fn((_ids: string[]) => {}),
  } satisfies BindableRuntime;
  return rt;
}

describe("bindSceneDoc", () => {
  it("applies a remote transaction to the edit world once", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const rt = spyRuntime();
    const binding = bindSceneDoc(a, rt, engine);
    expect(rt.load).toHaveBeenCalledTimes(1);

    apply(
      b,
      {
        ops: [
          { op: "move", refs: ["crate", "avatar", "~solid:0"], by: [5, 0] },
          { op: "update", ref: "lift", set: { "path.speed": 10 } },
        ],
      },
      bo,
      engine,
    );
    expect(rt.update).toHaveBeenCalledTimes(1);
    expect(rt.update.mock.calls[0]![0].map((e) => e.id).sort()).toEqual(
      ["avatar", "crate", "lift", "~solid:0"].sort(),
    );
    expect(rt.add).not.toHaveBeenCalled();
    expect(rt.remove).not.toHaveBeenCalled();
    expect(rt.load).toHaveBeenCalledTimes(1);

    apply(
      b,
      {
        ops: [
          { op: "remove", refs: ["zone"] },
          { op: "add", entity: { id: "m", type: "marker", at: [1, 1] } },
        ],
      },
      bo,
      engine,
    );
    expect(rt.remove).toHaveBeenCalledTimes(1);
    expect(rt.remove).toHaveBeenCalledWith(["zone"]);
    expect(rt.add).toHaveBeenCalledTimes(1);
    expect(rt.update).toHaveBeenCalledTimes(1);

    apply(b, { ops: [{ op: "setSettings", set: { gravity: [0, 10] } }] }, bo, engine);
    expect(rt.load).toHaveBeenCalledTimes(2);
    binding.destroy();
    unlink();
  });

  it("ignores transactions that touch only the log or presence-free maps", () => {
    const [a] = pair(engineYard());
    const rt = spyRuntime();
    bindSceneDoc(a, rt, engine);
    a.transact(() => a.getArray("log").push([{ note: 1 }]));
    expect(rt.update).not.toHaveBeenCalled();
    expect(rt.load).toHaveBeenCalledTimes(1);
  });

  it("leaves a paused world alone, still reports changes, and reloads on resume", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const rt = spyRuntime();
    const onChange = vi.fn();
    const binding = bindSceneDoc(a, rt, engine, { onChange });
    binding.setPaused(true);
    apply(b, { ops: [{ op: "move", refs: ["crate"], by: [5, 0] }] }, bo, engine);
    expect(rt.update).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    binding.setPaused(false);
    expect(rt.load).toHaveBeenCalledTimes(2);
    expect(rt.load.mock.calls[1]![0].entities.find((e) => e.id === "crate")).toMatchObject({
      shape: { type: "circle", cx: 1205 },
    });
    unlink();
  });

  it("keeps a real runtime equal to a fresh load of the doc", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const live = createSceneRuntime({ rapier, view: null, registry: engine });
    bindSceneDoc(a, live, engine);
    apply(b, { ops: [{ op: "move", refs: ["crate", "~solid:1"], by: [5, -3] }] }, bo, engine);
    apply(
      a,
      {
        ops: [
          { op: "remove", refs: ["~solid:0"] },
          { op: "add", entity: { id: "box", type: "solid", shape: ["box", 50, 50, 10, 10] } },
        ],
      },
      ada,
      engine,
    );
    apply(b, { ops: [{ op: "update", ref: "zone", set: { tags: ["exit"] } }] }, bo, engine);

    const fresh = createSceneRuntime({ rapier, view: null, registry: engine });
    const expanded = expandScene(docToScene(a), engine);
    fresh.load(expanded);
    expect(live.stats()).toEqual(fresh.stats());
    for (const e of expanded.entities) expect(live.get(e.id)).toEqual(fresh.get(e.id));
    live.destroy();
    fresh.destroy();
    unlink();
  });

  it("expands a merged scene with a broken entry and a duplicate id, leaving those out", () => {
    const def = engineYard();
    def.entities!.push({ id: "crate", type: "prop", shape: ["circle", 5, 5, 5] });
    (def.solid as unknown[]).push(["box", 1, 1]);
    const { scene, errors } = expandLenient(def, engine);
    expect(errors.length).toBe(2);
    expect(scene.entities.filter((e) => e.id === "crate")).toHaveLength(1);
    expect(scene.entities.some((e) => e.id === "~solid:3")).toBe(false);
    expect(scene.entities.some((e) => e.id === "~solid:2")).toBe(true);
  });

  it("keeps the last name and bounds when the doc loses its header, emptying the world", () => {
    const [a] = pair(engineYard());
    const rt = spyRuntime();
    const onChange = vi.fn();
    const binding = bindSceneDoc(a, rt, engine, { onChange });
    const { name, bounds } = binding.scene();
    // What undoing the createAsset that seeded the doc leaves: only meta and the log.
    a.transact(() => {
      for (const [root, type] of a.share)
        if (root !== "meta" && root !== "log" && type instanceof Y.Map)
          for (const k of [...type.keys()]) type.delete(k);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(binding.scene()).toMatchObject({ name, bounds, entities: [] });
    expect(rt.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ name, bounds, entities: [] }),
    );
    binding.reload();
    expect(rt.load).toHaveBeenLastCalledWith(expect.objectContaining({ name, bounds }));
    binding.destroy();
  });

  it("expands a scene with no header empty-named, with zero bounds", () => {
    const { scene, errors } = expandLenient({ v: 4 } as SceneDefinition, engine);
    expect(errors).toEqual([]);
    expect(scene).toMatchObject({ name: "", bounds: [0, 0, 0, 0], entities: [] });
  });

  describe("a merge that leaves a parent cycle or a missing parent", () => {
    const merged = (): SceneDefinition => ({
      v: 4,
      name: "tree",
      bounds: [0, 0, 400, 400],
      entities: [
        { id: "p", type: "node", at: [10, 0], parent: "q" },
        { id: "q", type: "node", at: [20, 0], parent: "p" },
        { id: "eye", type: "marker", at: [1, 1], parent: "p" },
        { id: "orphan", type: "marker", at: [50, 50], parent: "gone" },
      ],
    });

    it("expands every entity, the cycle's last id and the orphan as roots, with no errors", () => {
      const { scene, errors } = expandLenient(merged(), engine);
      expect(errors).toEqual([]);
      const byId = new Map(scene.entities.map((e) => [e.id, e]));
      expect([...byId.keys()].sort()).toEqual(["eye", "orphan", "p", "q"]);
      expect(byId.get("q")).toMatchObject({ at: [20, 0] });
      expect(byId.get("q")).not.toHaveProperty("parent");
      expect(byId.get("p")).toMatchObject({ at: [30, 0], parent: "q" });
      expect(byId.get("eye")).toMatchObject({ at: [31, 1], parent: "p" });
      expect(byId.get("orphan")).toMatchObject({ at: [50, 50] });
      expect(byId.get("orphan")).not.toHaveProperty("parent");
    });

    it("leaves out a broken entry and keeps the others in their parents' frames", () => {
      const def = merged();
      def.entities!.push(
        { id: "hub", type: "node", at: [100, 100], rot: 90 },
        { id: "spoke", type: "marker", at: [10, 0], parent: "hub" },
        { id: "bad", type: "solid", shape: ["box", 1, 1] as never, parent: "hub" },
      );
      const clean = expandLenient(merged(), engine).scene.entities;
      const { scene, errors } = expandLenient(def, engine);
      expect(errors).toHaveLength(1);
      const byId = new Map(scene.entities.map((e) => [e.id, e]));
      expect(byId.has("bad")).toBe(false);
      expect(byId.get("spoke")).toMatchObject({
        at: [100, 110],
        parent: "hub",
        transform: { rot: 90 },
      });
      for (const e of clean) expect(byId.get(e.id)).toEqual(e);
    });

    it("expands the same whatever order the merge left the entities in", () => {
      const def = merged();
      const reversed = { ...def, entities: [...def.entities!].reverse() };
      const sorted = (s: ExpandedScene) => [...s.entities].sort((x, y) => (x.id < y.id ? -1 : 1));
      expect(sorted(expandLenient(reversed, engine).scene)).toEqual(
        sorted(expandLenient(def, engine).scene),
      );
    });

    it("follows a remote reparent into the edit world, the moved entity's children with it", () => {
      const [a, b] = pair(merged());
      const unlink = link(a, b);
      const rt = spyRuntime();
      const binding = bindSceneDoc(a, rt, engine);
      apply(b, { ops: [{ op: "reparent", refs: ["p"], parent: null }] }, bo, engine, {
        validate: "none",
      });
      expect(rt.load).toHaveBeenCalledTimes(1);
      const fresh = expandLenient(docToScene(a), engine).scene;
      expect(binding.scene()).toEqual(fresh);
      const updated = rt.update.mock.calls.flatMap((c) => c[0].map((e) => e.id)).sort();
      expect(updated).toContain("p");
      binding.destroy();
      unlink();
    });
  });

  it("expands instances as expandScene does, each with its node", () => {
    const prefabs = yardPrefabs();
    const ids = (s: ExpandedScene) => s.entities.map((e) => e.id).sort();
    const expanded = expandScene(engineYard(), engine, { prefabs });
    expect(ids(expandLenient(engineYard(), engine, prefabs).scene)).toEqual(ids(expanded));
    expect(ids(expanded)).toEqual(expect.arrayContaining(["gate-1", "post-1"]));
    const [a] = pair(engineYard());
    const binding = bindSceneDoc(a, spyRuntime(), engine, {
      prefabs: localPrefabSource(prefabs),
    });
    expect(binding.scene()).toEqual(expanded);
    binding.destroy();
  });

  it("follows remote writes to the layout 3 maps: assets, group turns, instance transforms, params and paint", () => {
    const game = createRegistry(testGame);
    const [a, b] = pair({
      v: 2,
      game: "test-game",
      name: "game-yard",
      bounds: [0, 0, 1000, 1000],
      settings: { grid: { kind: "square", cell: [32, 32] } },
      instances: [{ id: "room-1", prefab: "room", at: [200, 200] }],
      entities: [
        { id: "lamp", type: "lamp", at: [10, 0], parent: "g" },
        { id: "floor", type: "paint", at: [0, 640], cells: { "0,0": ["1*4"] } },
        { id: "g", type: "node", at: [100, 100] },
      ],
    });
    const prefabs = localPrefabSource(
      prefabLibrary([
        {
          kind: "prefab",
          v: 2,
          game: "test-game",
          id: "room",
          entities: [{ id: "light", type: "lamp", at: [10, 0] }],
        },
      ]),
    );
    const unlink = link(a, b);
    const rt = spyRuntime();
    const onChange = vi.fn();
    const binding = bindSceneDoc(a, rt, game, { prefabs, onChange });
    const updated = () => rt.update.mock.calls.at(-1)![0].map((e) => e.id);
    const remote = (batch: OpBatch) =>
      must(applyOpsToDoc(b, batch, bo, game, { prefabs: prefabs.library() }));

    remote({ ops: [{ op: "useAssets", add: ["hud"] }] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].assets).toEqual(["hud"]);

    remote({ ops: [{ op: "paintCells", ref: "floor", field: "cells", cells: [[2, 3, 2]] }] });
    expect(updated()).toEqual(["floor"]);

    remote({ ops: [{ op: "update", ref: "g", set: { rot: 90 } }] });
    expect(updated()).toEqual(["g", "lamp"]);
    expect(binding.scene().entities.find((e) => e.id === "lamp")!.at).toEqual([100, 110]);

    const updates = rt.update.mock.calls.length;
    remote({ ops: [{ op: "transform", refs: ["room-1"], flip: "x" }] });
    expect(rt.update.mock.calls.length).toBe(updates + 1);
    expect(updated()).toEqual(["room-1", "room-1/light"]);

    expect(rt.load).toHaveBeenCalledTimes(1);
    expect(rt.add).not.toHaveBeenCalled();
    expect(rt.remove).not.toHaveBeenCalled();
    binding.destroy();
    unlink();
  });

  describe("re-expands when a prefab the scene reaches changes", () => {
    const game = createRegistry(testGame);
    const prefab = (id: string, over: Partial<Prefab> = {}): Prefab => ({
      kind: "prefab",
      v: 4,
      game: "test-game",
      id,
      entities: [],
      ...over,
    });
    const library = () =>
      prefabLibrary([
        prefab("outer", { instances: [{ id: "m", prefab: "mid", at: [0, 0] }] }),
        prefab("mid", { instances: [{ id: "i", prefab: "inner", at: [0, 0] }] }),
        prefab("inner", { entities: [{ id: "light", type: "lamp", at: [1, 0] }] }),
        prefab("room", { entities: [{ id: "light", type: "lamp", at: [1, 0] }] }),
        prefab("red", { base: "room" }),
      ]);
    const scene = (prefabId: string): SceneDefinition => ({
      v: 4,
      game: "test-game",
      name: "reach",
      bounds: [0, 0, 1000, 1000],
      instances: [{ id: "o", prefab: prefabId, at: [100, 100] }],
      entities: [],
    });
    const moveLight = (prefabs: ReturnType<typeof localPrefabSource>, id: string) => {
      const doc = prefabs.docs().get(id)!;
      const cur = docToPrefab(doc);
      prefabPatch(doc, { ...cur, id, entities: [{ ...cur.entities[0]!, at: [4, 0] }] }, ada);
    };
    const lightAt = (scene: ExpandedScene) =>
      scene.entities.find((e) => e.id.endsWith("light"))!.at;

    it("follows an edit to a prefab nested two levels down", () => {
      const prefabs = localPrefabSource(library());
      const [a] = pair(scene("outer"));
      const rt = spyRuntime();
      const binding = bindSceneDoc(a, rt, game, { prefabs });
      expect(lightAt(binding.scene())).toEqual([101, 100]);
      moveLight(prefabs, "inner");
      expect(rt.update).toHaveBeenCalledTimes(1);
      expect(lightAt(binding.scene())).toEqual([104, 100]);
      binding.destroy();
    });

    it("follows an edit to a variant's base", () => {
      const prefabs = localPrefabSource(library());
      const [a] = pair(scene("red"));
      const rt = spyRuntime();
      const binding = bindSceneDoc(a, rt, game, { prefabs });
      expect(lightAt(binding.scene())).toEqual([101, 100]);
      moveLight(prefabs, "room");
      expect(rt.update).toHaveBeenCalledTimes(1);
      expect(lightAt(binding.scene())).toEqual([104, 100]);
      binding.destroy();
    });

    it("follows an edit to a variant's base in a prefab doc that nests the variant", () => {
      const prefabs = localPrefabSource(
        new Map([
          ...library(),
          ["hall", prefab("hall", { instances: [{ id: "r", prefab: "red", at: [0.5, 0.5] }] })],
        ]),
      );
      const rt = spyRuntime();
      const binding = bindSceneDoc(prefabs.docs().get("hall")!, rt, game, { prefabs });
      expect(lightAt(binding.scene())).toEqual([1.5, 0.5]);
      moveLight(prefabs, "room");
      expect(rt.update).toHaveBeenCalledTimes(1);
      expect(lightAt(binding.scene())).toEqual([4.5, 0.5]);
      binding.destroy();
    });

    it("ignores an edit to a prefab it doesn't reach", () => {
      const prefabs = localPrefabSource(library());
      const [a] = pair(scene("outer"));
      const rt = spyRuntime();
      const binding = bindSceneDoc(a, rt, game, { prefabs });
      moveLight(prefabs, "room");
      expect(rt.update).not.toHaveBeenCalled();
      expect(rt.load).toHaveBeenCalledTimes(1);
      binding.destroy();
    });
  });
});
