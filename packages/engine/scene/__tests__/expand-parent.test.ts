// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { degToRad } from "../../physics";
import { spawnPose } from "../../runtime/spawn-pose";
import { expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import {
  entityFrame,
  instanceFrame,
  placedFrame,
  resolveSceneDetailed,
  sceneFrames,
} from "../resolve";
import { asFrame, compose, composeFrames, IDENTITY_2D } from "../transform";
import type { Prefab, RuntimeEntity, SceneDefinition } from "../types";

const engine = createRegistry();

const scene = (over: Partial<SceneDefinition>): SceneDefinition => ({
  v: 4,
  name: "tree",
  bounds: [-100, -100, 100, 100],
  ...over,
});

const prefab = (id: string, body: Partial<Prefab>): Prefab => ({
  kind: "prefab",
  v: 4,
  id,
  entities: [],
  ...body,
});

const byId = (entities: readonly RuntimeEntity[]) => new Map(entities.map((e) => [e.id, e]));

describe("expandScene with parents", () => {
  it("writes each entity's parent and its frame's angle and flip", () => {
    const out = byId(
      expandScene(
        scene({
          entities: [
            { id: "pivot", type: "node", at: [4, 4], rot: 30 },
            { id: "eye", type: "marker", at: [1, 0], parent: "pivot" },
            { id: "arm", type: "node", at: [0, 1], rot: 60, flip: true, parent: "pivot" },
            { id: "tip", type: "solid", shape: ["box", 1, 0, 0.5, 0.5], parent: "arm" },
          ],
        }),
        engine,
      ).entities,
    );
    expect(out.get("pivot")).not.toHaveProperty("parent");
    expect(out.get("pivot")).not.toHaveProperty("transform");
    expect(out.get("eye")).toMatchObject({
      parent: "pivot",
      transform: { rot: 30, flip: false },
    });
    expect(out.get("arm")).toMatchObject({
      parent: "pivot",
      rot: 90,
      flip: true,
      transform: { rot: 30, flip: false },
    });
    expect(out.get("tip")).toMatchObject({
      parent: "arm",
      transform: { rot: 90, flip: true },
    });
  });

  it("drops what sits under an off parent, however deep", () => {
    const lib = prefabLibrary([
      prefab("pair", { entities: [{ id: "m", type: "marker", at: [0, 0] }] }),
    ]);
    const out = expandScene(
      scene({
        entities: [
          { id: "n", type: "node", at: [0, 0], off: true },
          { id: "c", type: "marker", at: [1, 1], parent: "n" },
          { id: "g", type: "marker", at: [1, 1], parent: "c" },
          { id: "keep", type: "marker", at: [1, 1] },
        ],
        instances: [{ id: "i", prefab: "pair", at: [2, 2], parent: "c" }],
      }),
      engine,
      { prefabs: lib },
    );
    expect(out.entities.map((e) => e.id)).toEqual(["keep"]);
  });

  it("drops a link to something that doesn't load", () => {
    const out = byId(
      expandScene(
        scene({
          entities: [
            { id: "memo", type: "note", at: [0, 0], text: "here" },
            { id: "m", type: "marker", at: [1, 1], parent: "memo" },
          ],
        }),
        engine,
      ).entities,
    );
    expect(out.get("m")).toBeDefined();
    expect(out.get("m")).not.toHaveProperty("parent");
  });

  it("puts an instance's node under its parent and its children through the parent's frame", () => {
    const lib = prefabLibrary([
      prefab("pad", { entities: [{ id: "top", type: "marker", at: [1, 0] }] }),
    ]);
    const out = byId(
      expandScene(
        scene({
          entities: [{ id: "arm", type: "node", at: [3, 3], rot: 90 }],
          instances: [{ id: "p", prefab: "pad", at: [1, 0], parent: "arm" }],
        }),
        engine,
        { prefabs: lib },
      ).entities,
    );
    expect(out.get("p")).toMatchObject({
      type: "node",
      at: [3, 4],
      rot: 90,
      parent: "arm",
      transform: { rot: 90, flip: false },
    });
    expect(out.get("p/top")).toMatchObject({ at: [3, 5], parent: "p" });
  });

  it("links a prefab's inner tree, a nested instance under its parent included", () => {
    const lib = prefabLibrary([
      prefab("leaf", { entities: [{ id: "pin", type: "marker", at: [0, 0] }] }),
      prefab("tree", {
        entities: [
          { id: "pivot", type: "node", at: [2, 0], rot: 90 },
          { id: "arm", type: "marker", at: [1, 0], parent: "pivot" },
        ],
        instances: [{ id: "l", prefab: "leaf", at: [1, 0], parent: "pivot" }],
      }),
    ]);
    const def = scene({ instances: [{ id: "t", prefab: "tree", at: [10, 0] }] });
    const out = byId(expandScene(def, engine, { prefabs: lib }).entities);
    expect(out.get("t")).toMatchObject({ type: "node", at: [10, 0] });
    expect(out.get("t")).not.toHaveProperty("parent");
    expect(out.get("t/pivot")).toMatchObject({ parent: "t" });
    expect(out.get("t/arm")).toMatchObject({ at: [12, 1], parent: "t/pivot" });
    expect(out.get("t/l")).toMatchObject({ type: "node", at: [12, 1], parent: "t/pivot" });
    expect(out.get("t/l/pin")).toMatchObject({ at: [12, 1], parent: "t/l" });
    // placed twice, each copy links within itself
    const twice = scene({
      instances: [
        { id: "t", prefab: "tree", at: [10, 0] },
        { id: "u", prefab: "tree", at: [-10, 0], flip: true },
      ],
    });
    const both = byId(expandScene(twice, engine, { prefabs: lib }).entities);
    expect(both.get("u/arm")).toMatchObject({ at: [-12, 1], parent: "u/pivot" });
    expect(both.get("u/l")).toMatchObject({ parent: "u/pivot" });
    expect(both.get("t/arm")).toMatchObject({ at: [12, 1], parent: "t/pivot" });
  });
});

describe("entityFrame against spawnPose", () => {
  const dir = new URL("../../scenes/", import.meta.url);
  const read = (url: URL) => JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
  const prefabs = prefabLibrary(
    readdirSync(new URL("prefabs/", dir))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".asset.json"))
      .map((f) => read(new URL(`prefabs/${f}`, dir)) as unknown as Prefab),
  );
  const scenes = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".asset.json"))
    .map((f) => read(new URL(f, dir)))
    .filter((doc) => Array.isArray(doc.bounds) && doc.kind === undefined) as SceneDefinition[];

  it("finds the engine's scenes", () => {
    expect(scenes.map((s) => s.name)).toEqual(
      expect.arrayContaining(["engine-yard", "kitchen-sink", "tree-yard"]),
    );
  });

  for (const def of scenes) {
    it(`${def.name}: every entity's world frame is where it spawns`, () => {
      const expanded = byId(expandScene(def, engine, { prefabs }).entities);
      const { def: resolved, origins } = resolveSceneDetailed(def, engine, prefabs);
      const frames = sceneFrames(def, engine, prefabs);
      let checked = 0;
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      const sameRad = (a: number, b: number) =>
        near(Math.cos(a), Math.cos(b)) && near(Math.sin(a), Math.sin(b));
      resolved.entities?.forEach((e, i) => {
        const runtime = expanded.get(e.id);
        if (!runtime) return;
        const origin = origins[i]!;
        const world = placedFrame(engine, e, origin.transform);
        const pose = spawnPose(runtime, engine);
        expect([pose.x, pose.y], e.id).toEqual(world.at);
        // A node's own angle is its system's, from `rot`; spawnPose reads only the frames above it.
        if (e.type !== "node") expect(sameRad(pose.rot, degToRad(world.rot)), e.id).toBe(true);
        else
          expect(
            sameRad(degToRad((runtime.rot as number | undefined) ?? 0), degToRad(world.rot)),
          ).toBe(true);
        // The same frame by the chain: the stored frame under every step above it.
        if (origin.kind === "entity") {
          const own = def.entities![origin.index]!;
          const steps = frames.stepsFor(own);
          const above = asFrame(steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D));
          const chained = composeFrames(above, entityFrame(engine, own));
          expect(near(chained.at[0], world.at[0]) && near(chained.at[1], world.at[1]), e.id).toBe(
            true,
          );
          expect(sameRad(degToRad(chained.rot), degToRad(world.rot)), e.id).toBe(true);
        }
        checked++;
      });
      for (const inst of def.instances ?? []) {
        const node = expanded.get(inst.id);
        if (!node) continue;
        const steps = frames.stepsFor(inst);
        const above = asFrame(steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D));
        const world = composeFrames(above, instanceFrame(inst));
        const pose = spawnPose(node, engine);
        expect([pose.x, pose.y], inst.id).toEqual(world.at);
        expect(sameRad(pose.rot, degToRad(world.rot)), inst.id).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
