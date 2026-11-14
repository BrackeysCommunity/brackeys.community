// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_ACTIONS } from "../game/defaults";
import { createRegistry, defineGame } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import {
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_ENABLED,
  ENTITY_SPAWNED,
} from "../runtime/types";
import { expandScene } from "../scene/expand";
import { prefabLibrary } from "../scene/prefab";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type RuntimeEntity,
  type SceneDefinition,
} from "../scene/types";
import { marker, stepEvents } from "./fixtures/tree-rig";

const game = defineGame({
  id: "cascades",
  types: [],
  actions: [...DEFAULT_ACTIONS],
  input: { players: { max: 1, join: "auto" } },
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

/** `hub` holds a lamp (which holds a bulb) and a post; `stone` stands alone. */
const ENTITIES: EntityDef[] = [
  { id: "hub", type: "node", at: [0, 0] } as EntityDef,
  marker("lamp", [1, 0]),
  marker("bulb", [1, 1]),
  marker("post", [0, 2]),
  marker("stone", [9, 9]),
];
const PARENTS: Record<string, string> = { lamp: "hub", bulb: "lamp", post: "hub" };
const TREE = ["hub", "lamp", "bulb", "post"];

const LANTERN: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lantern",
  entities: [marker("glass", [0, 0]), marker("wick", [1, 0])],
};

function load() {
  const scene: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "cascades",
    name: "cascades",
    bounds: [-60, -60, 60, 60],
    settings: { physics: "none", gravity: [0, 0] },
    entities: ENTITIES,
  };
  const expanded = expandScene(scene, registry);
  expanded.entities = expanded.entities.map((e) =>
    PARENTS[e.id] ? { ...e, parent: PARENTS[e.id] } : e,
  );
  const rt = createSceneRuntime({
    rapier: null,
    view: null,
    game,
    prefabs: prefabLibrary([LANTERN]),
  });
  const report = rt.load(expanded);
  if (!report.ok) throw new Error(report.error);
  /** One tick that runs `act` from a timer, and the entity events it raised. */
  const tickWith = (act: () => void): string[] => {
    rt.ctx.timers.after(0, act);
    return stepEvents(rt, 1)
      .filter((e) => e.type.startsWith("entity:"))
      .map((e) => `${e.type} ${e.entityId}`);
  };
  return { rt, tickWith };
}

const enabled = (rt: ReturnType<typeof load>["rt"], ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, rt.ctx.enabled(id)]));

describe("destroying a parent", () => {
  it("takes its subtree, children first in reverse child order", () => {
    const { rt, tickWith } = load();
    expect(tickWith(() => rt.ctx.destroy("hub"))).toEqual([
      `${ENTITY_DESTROYED} post`,
      `${ENTITY_DESTROYED} bulb`,
      `${ENTITY_DESTROYED} lamp`,
      `${ENTITY_DESTROYED} hub`,
    ]);
    for (const id of TREE) expect(rt.ctx.exists(id), id).toBe(false);
    expect(rt.ctx.exists("stone")).toBe(true);
    rt.destroy();
  });

  it("outside a step, at once; a child alone leaves its parent", () => {
    const { rt } = load();
    rt.ctx.destroy("lamp");
    expect(TREE.map((id) => rt.ctx.exists(id))).toEqual([true, false, false, true]);
    rt.ctx.destroy("hub");
    expect(rt.ctx.exists("post")).toBe(false);
    rt.destroy();
  });
});

describe("switching a parent off and on", () => {
  it("disables its subtree children first, and enables it parents first", () => {
    const { rt, tickWith } = load();
    expect(tickWith(() => rt.ctx.setEnabled("hub", false))).toEqual([
      `${ENTITY_DISABLED} post`,
      `${ENTITY_DISABLED} bulb`,
      `${ENTITY_DISABLED} lamp`,
      `${ENTITY_DISABLED} hub`,
    ]);
    expect(enabled(rt, TREE)).toEqual({ hub: false, lamp: false, bulb: false, post: false });
    expect(rt.ctx.query.select({ type: "marker" })).toEqual(["stone"]);
    expect(tickWith(() => rt.ctx.setEnabled("hub", true))).toEqual([
      `${ENTITY_ENABLED} hub`,
      `${ENTITY_ENABLED} lamp`,
      `${ENTITY_ENABLED} bulb`,
      `${ENTITY_ENABLED} post`,
    ]);
    expect(enabled(rt, TREE)).toEqual({ hub: true, lamp: true, bulb: true, post: true });
    rt.destroy();
  });

  it("brings back only what was on by its own switch", () => {
    const { rt } = load();
    rt.ctx.setEnabled("lamp", false);
    rt.ctx.setEnabled("hub", false);
    rt.ctx.setEnabled("hub", true);
    expect(enabled(rt, TREE)).toEqual({ hub: true, lamp: false, bulb: false, post: true });
    rt.ctx.setEnabled("lamp", true);
    expect(enabled(rt, TREE)).toEqual({ hub: true, lamp: true, bulb: true, post: true });
    rt.destroy();
  });

  it("an own switch flipped under a parent that is off waits for the parent", () => {
    const { rt } = load();
    rt.ctx.setEnabled("hub", false);
    rt.ctx.setEnabled("bulb", false);
    rt.ctx.setEnabled("bulb", true);
    expect(rt.ctx.enabled("bulb")).toBe(false);
    rt.ctx.setEnabled("hub", true);
    expect(rt.ctx.enabled("bulb")).toBe(true);
    rt.destroy();
  });

  it("after an enable, drives each child to where its parent puts it", () => {
    const { rt } = load();
    rt.ctx.setEnabled("hub", false);
    rt.ctx.setPose("hub", 0, 10);
    expect(rt.ctx.poses.get("lamp")).toMatchObject({ x: 1, y: 0 });
    rt.ctx.setEnabled("hub", true);
    expect(rt.ctx.poses.get("hub")).toMatchObject({ x: 0, y: 10 });
    expect(rt.ctx.poses.get("lamp")).toMatchObject({ x: 1, y: 10 });
    expect(rt.ctx.poses.get("bulb")).toMatchObject({ x: 1, y: 11 });
    expect(rt.ctx.poses.prev("bulb")).toMatchObject({ x: 1, y: 11 });
    rt.destroy();
  });

  it("a child that joins under a parent that is off starts off", () => {
    const { rt } = load();
    rt.ctx.setEnabled("hub", false);
    const late: RuntimeEntity = { id: "late", type: "marker", at: [3, 0], parent: "hub" };
    expect(rt.add([late]).ok).toBe(true);
    expect(rt.ctx.exists("late")).toBe(true);
    expect(rt.ctx.enabled("late")).toBe(false);
    rt.ctx.setEnabled("hub", true);
    expect(rt.ctx.enabled("late")).toBe(true);
    rt.destroy();
  });
});

describe("an instance's node", () => {
  it("is spawned and announced, while the result lists only its children", () => {
    const { rt, tickWith } = load();
    let result: { id: string; entities: readonly string[] } | undefined;
    const events = tickWith(() => (result = rt.ctx.instantiate("lantern", [4, 0])));
    expect(result).toEqual({ id: "lantern#1", entities: ["lantern#1/glass", "lantern#1/wick"] });
    expect(events).toEqual([
      `${ENTITY_SPAWNED} lantern#1`,
      `${ENTITY_SPAWNED} lantern#1/glass`,
      `${ENTITY_SPAWNED} lantern#1/wick`,
    ]);
    rt.destroy();
  });

  it("switches and destroys the whole instance through its id", () => {
    const { rt } = load();
    const { id, entities } = rt.ctx.instantiate("lantern", [4, 0]);
    rt.ctx.setEnabled(id, false);
    expect([id, ...entities].map((e) => rt.ctx.enabled(e))).toEqual([false, false, false]);
    rt.ctx.setEnabled(id, true);
    expect([id, ...entities].map((e) => rt.ctx.enabled(e))).toEqual([true, true, true]);
    rt.ctx.setPose(id, 4, 6);
    expect(rt.ctx.poses.get("lantern#1/wick")).toMatchObject({ x: 5, y: 6 });
    rt.ctx.destroy(id);
    expect([id, ...entities].map((e) => rt.ctx.exists(e))).toEqual([false, false, false]);
    rt.destroy();
  });
});
