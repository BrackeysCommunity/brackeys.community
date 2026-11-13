// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps, toSourceBatch } from "../ops";
import { prefabLibrary } from "../prefab";
import { resolveScene } from "../resolve";
import type { OpBatch, Prefab, SceneDefinition } from "../types";

const registry = createRegistry();

const heroSide: Prefab = {
  kind: "prefab",
  v: 4,
  id: "hero-side",
  params: {
    jumpHeight: { description: "", targets: ["hero.behaviors.character-side-view.jumpHeight"] },
    maxSpeed: { description: "", targets: ["hero.behaviors.character-side-view.maxSpeed"] },
  },
  entities: [
    {
      id: "hero",
      type: "marker",
      at: [0, 0],
      behaviors: {
        "character-side-view": {},
        collider: { shape: ["box", 0, 0, 0.2, 0.4] },
        "player-input": {},
      },
    },
  ],
} as Prefab;

const prefabs = prefabLibrary([heroSide]);

const scene = (overrides?: Record<string, unknown>): SceneDefinition => ({
  v: 4,
  name: "runner",
  bounds: [0, 0, 20, 20],
  instances: [
    {
      id: "runner",
      prefab: "hero-side",
      at: [4, 4],
      params: { jumpHeight: 2 },
      ...(overrides ? { overrides } : {}),
    },
  ],
});

function source(def: SceneDefinition, batch: OpBatch): OpBatch {
  const r = toSourceBatch(def, batch, registry, prefabs);
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.batch;
}

function applied(def: SceneDefinition, batch: OpBatch): SceneDefinition {
  const r = applyOps(def, batch, registry, { prefabs, validate: "none" });
  if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
  return r.def;
}

const hero = (def: SceneDefinition) =>
  resolveScene(def, registry, prefabs).entities!.find((e) => e.id === "runner/hero")!;

describe("toSourceBatch: behavior fields on an instance child", () => {
  it("overrides only the behavior field it changes, leaving the params in effect", () => {
    const def = scene();
    const batch = source(def, {
      ops: [
        {
          op: "update",
          ref: "runner/hero",
          set: { "behaviors.character-side-view.maxSpeed": 5 },
        },
      ],
    });
    expect(batch.ops).toEqual([
      {
        op: "override",
        ref: "runner",
        set: { "hero.behaviors.character-side-view.maxSpeed": 5 },
      },
    ]);
    const after = applied(def, batch);
    expect(hero(after).behaviors).toMatchObject({
      "character-side-view": { jumpHeight: 2, maxSpeed: 5 },
    });
    const raised = applied(after, {
      ops: [{ op: "update", ref: "runner", set: { "params.jumpHeight": 3 } }],
    });
    expect(hero(raised).behaviors).toMatchObject({
      "character-side-view": { jumpHeight: 3, maxSpeed: 5 },
    });
  });

  it("overrides a param's target with one deep key and reverts it on the param's value", () => {
    const def = scene();
    const batch = source(def, {
      ops: [
        {
          op: "update",
          ref: "runner/hero",
          set: { "behaviors.character-side-view.jumpHeight": 1 },
        },
      ],
    });
    expect(batch.ops).toEqual([
      {
        op: "override",
        ref: "runner",
        set: { "hero.behaviors.character-side-view.jumpHeight": 1 },
      },
    ]);
    const after = applied(def, batch);
    const back = source(after, {
      ops: [
        {
          op: "update",
          ref: "runner/hero",
          set: { "behaviors.character-side-view.jumpHeight": 2 },
        },
      ],
    });
    expect(back.ops).toEqual([
      {
        op: "revertOverride",
        ref: "runner",
        paths: ["hero.behaviors.character-side-view.jumpHeight"],
      },
    ]);
  });

  it("adds a block the prefab lacks as one key", () => {
    const batch = source(scene(), {
      ops: [{ op: "update", ref: "runner/hero", set: { "behaviors.camera-target": {} } }],
    });
    expect(batch.ops).toEqual([
      { op: "override", ref: "runner", set: { "hero.behaviors.camera-target": {} } },
    ]);
  });

  it("overrides the whole map when a prefab block is dropped", () => {
    const batch = source(scene(), {
      ops: [{ op: "update", ref: "runner/hero", unset: ["behaviors.player-input"] }],
    });
    expect(batch.ops).toEqual([
      {
        op: "override",
        ref: "runner",
        set: {
          "hero.behaviors": {
            "character-side-view": { jumpHeight: 2 },
            collider: { shape: ["box", 0, 0, 0.2, 0.4] },
          },
        },
      },
    ]);
  });

  it("keeps writing a field an existing override covers whole at that override's level", () => {
    const def = scene({ "hero.behaviors.character-side-view": { maxSpeed: 4 } });
    const batch = source(def, {
      ops: [
        {
          op: "update",
          ref: "runner/hero",
          set: { "behaviors.character-side-view.maxSpeed": 6 },
        },
      ],
    });
    expect(batch.ops).toEqual([
      {
        op: "override",
        ref: "runner",
        set: { "hero.behaviors.character-side-view": { maxSpeed: 6 } },
      },
    ]);
  });
});
