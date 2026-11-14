import { describe, expect, it } from "vite-plus/test";

import { LIFETIME } from "../game/behaviors/lifetime";
import type { Entity } from "../game/entity";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import { testGame } from "./fixtures/test-game";
import { engineError, marker } from "./fixtures/tree-rig";

const life = (ticks: number) => ({ behaviors: { lifetime: { ticks } } });

/**
 * base ─┬─ arm ── hand
 *       └─ leg
 * loose
 */
const TREE = (): RuntimeEntity[] => [
  marker("base", [1, 1], life(600)),
  marker("arm", [3, 1], { parent: "base" }),
  marker("hand", [4, 1], { parent: "arm", ...life(300) }),
  marker("leg", [1, 3], { parent: "base", ...life(200) }),
  marker("loose", [-5, -5]),
];

function setup(entities: RuntimeEntity[] = TREE()) {
  const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
  const scene: ExpandedScene = {
    name: "entity-tree",
    bounds: [-20, -20, 20, 20],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
  expect(rt.load(scene)).toMatchObject({ ok: true });
  const get = (id: string): Entity => {
    const e = rt.ctx.entity(id);
    if (!e) throw new Error(`no entity ${id}`);
    return e;
  };
  return { rt, ctx: rt.ctx, get };
}

const ids = (list: readonly Entity[]) => list.map((e) => e.id);
const ticksOf = (handle: { fields: unknown } | undefined) =>
  (handle?.fields as { ticks?: number } | undefined)?.ticks;

describe("Entity in the scene tree", () => {
  it("answers parent, children and root as handles", () => {
    const { get } = setup();
    const [base, arm, hand, leg, loose] = ["base", "arm", "hand", "leg", "loose"].map(get);
    expect(base!.parent).toBeNull();
    expect(arm!.parent).toBe(base);
    expect(hand!.parent).toBe(arm);
    expect(ids(base!.children)).toEqual(["arm", "leg"]);
    expect(ids(arm!.children)).toEqual(["hand"]);
    expect(hand!.children).toEqual([]);
    expect(hand!.root).toBe(base);
    expect(leg!.root).toBe(base);
    expect(base!.root).toBe(base);
    expect(loose!.root).toBe(loose);
    expect(loose!.parent).toBeNull();
  });

  it("reads and writes the pose in the parent's frame", () => {
    const { get } = setup();
    const base = get("base");
    const arm = get("arm");
    const offset = { x: arm.pose.x - base.pose.x, y: arm.pose.y - base.pose.y };
    expect(arm.localPose.x).toBeCloseTo(offset.x);
    expect(arm.localPose.y).toBeCloseTo(offset.y);
    expect(base.localPose).toEqual(base.pose);

    arm.setLocalPose(offset.x / 2, 0);
    expect(arm.pose.x).toBeCloseTo(base.pose.x + offset.x / 2);
    expect(arm.pose.y).toBeCloseTo(base.pose.y);
    expect(arm.localPose.x).toBeCloseTo(offset.x / 2);
  });

  it("setParent takes a handle, an id or null and keeps the world pose", () => {
    const { get } = setup();
    const hand = get("hand");
    const leg = get("leg");
    const before = { ...hand.pose };

    hand.setParent(leg);
    expect(hand.parent).toBe(leg);
    expect(ids(leg.children)).toEqual(["hand"]);
    expect(get("arm").children).toEqual([]);
    expect(hand.pose.x).toBeCloseTo(before.x);
    expect(hand.pose.y).toBeCloseTo(before.y);

    hand.setParent("loose");
    expect(hand.parent).toBe(get("loose"));
    expect(hand.root).toBe(get("loose"));

    hand.setParent(null);
    expect(hand.parent).toBeNull();
    expect(hand.root).toBe(hand);
    expect(hand.pose.x).toBeCloseTo(before.x);
    expect(hand.pose.y).toBeCloseTo(before.y);
  });

  it("setParent under its own subtree refuses with parent-cycle", () => {
    const { get } = setup();
    expect(engineError(() => get("base").setParent(get("hand"))).code).toBe("parent-cycle");
    expect(engineError(() => get("base").setParent("base")).code).toBe("parent-cycle");
    expect(get("base").parent).toBeNull();
  });

  it("find walks child ids", () => {
    const { get } = setup();
    expect(get("base").find("arm/hand")).toBe(get("hand"));
    expect(get("base").find("leg")).toBe(get("leg"));
    expect(get("arm").find("hand")).toBe(get("hand"));
    expect(get("base").find("hand")).toBeUndefined();
    expect(get("base").find("arm/nothing")).toBeUndefined();
    expect(get("base").find("loose")).toBeUndefined();
    expect(get("base").find("")).toBeUndefined();
    expect(get("base").find("arm/")).toBeUndefined();
  });

  it("the InChildren lookups start at the entity and go depth first in child order", () => {
    const { get } = setup();
    expect(ticksOf(get("base").getBehaviorInChildren(LIFETIME))).toBe(600);
    expect(ticksOf(get("arm").getBehaviorInChildren(LIFETIME))).toBe(300);
    expect(get("base").getBehaviorsInChildren(LIFETIME).map(ticksOf)).toEqual([600, 300, 200]);
    expect(get("arm").getBehaviorsInChildren("lifetime").map(ticksOf)).toEqual([300]);
    expect(get("loose").getBehaviorInChildren(LIFETIME)).toBeUndefined();
    expect(get("loose").getBehaviorsInChildren(LIFETIME)).toEqual([]);
  });

  it("follows child order after a reparent", () => {
    const { get } = setup();
    get("leg").setParent("arm");
    expect(ids(get("arm").children)).toEqual(["hand", "leg"]);
    expect(get("arm").getBehaviorsInChildren(LIFETIME).map(ticksOf)).toEqual([300, 200]);
  });

  it("the InChildren lookups skip disabled entities", () => {
    const { get } = setup();
    get("arm").setEnabled(false);
    expect(get("base").getBehaviorsInChildren(LIFETIME).map(ticksOf)).toEqual([600, 200]);
    get("base").setEnabled(false);
    expect(get("base").getBehaviorInChildren(LIFETIME)).toBeUndefined();
  });

  it("getBehaviorInParent starts at the entity and walks up to the root", () => {
    const { get } = setup();
    expect(ticksOf(get("hand").getBehaviorInParent(LIFETIME))).toBe(300);
    expect(ticksOf(get("arm").getBehaviorInParent(LIFETIME))).toBe(600);
    expect(ticksOf(get("leg").getBehaviorInParent("lifetime"))).toBe(200);
    expect(get("loose").getBehaviorInParent(LIFETIME)).toBeUndefined();
  });

  it("enabledSelf is the entity's own switch; enabled also needs every ancestor on", () => {
    const { get } = setup();
    const [base, arm, hand] = ["base", "arm", "hand"].map(get);

    base!.setEnabled(false);
    expect([base!.enabled, base!.enabledSelf]).toEqual([false, false]);
    expect([arm!.enabled, arm!.enabledSelf]).toEqual([false, true]);
    expect([hand!.enabled, hand!.enabledSelf]).toEqual([false, true]);

    arm!.setEnabled(false);
    base!.setEnabled(true);
    expect([base!.enabled, base!.enabledSelf]).toEqual([true, true]);
    expect([arm!.enabled, arm!.enabledSelf]).toEqual([false, false]);
    expect([hand!.enabled, hand!.enabledSelf]).toEqual([false, true]);

    arm!.setEnabled(true);
    expect([hand!.enabled, hand!.enabledSelf]).toEqual([true, true]);
  });

  it("find walks an instance node's children by the last segment of each id", () => {
    const { get } = setup([
      { id: "room-1", type: "node", at: [2, 2] },
      { id: "room-1/door-1", type: "node", at: [3, 2], parent: "room-1" },
      marker("room-1/door-1/panel", [3, 3], { parent: "room-1/door-1", ...life(90) }),
      marker("room-1/lamp", [2, 4], { parent: "room-1" }),
    ]);
    const room = get("room-1");
    expect(room.find("door-1/panel")).toBe(get("room-1/door-1/panel"));
    expect(room.find("door-1")).toBe(get("room-1/door-1"));
    expect(room.find("lamp")).toBe(get("room-1/lamp"));
    expect(room.find("room-1/door-1")).toBeUndefined();
    expect(get("room-1/door-1/panel").root).toBe(room);
    expect(ticksOf(room.getBehaviorInChildren(LIFETIME))).toBe(90);
  });

  it("after a destroy, every member throws entity-gone", () => {
    const { ctx, get } = setup();
    const hand = get("hand");
    const leg = get("leg");
    ctx.destroy("hand");
    expect(hand.alive).toBe(false);
    const members: ReadonlyArray<(e: Entity) => unknown> = [
      (e) => e.parent,
      (e) => e.children,
      (e) => e.root,
      (e) => e.localPose,
      (e) => e.setLocalPose(0, 0),
      (e) => e.setParent(null),
      (e) => e.setParent(leg),
      (e) => e.find("x"),
      (e) => e.getBehaviorInChildren(LIFETIME),
      (e) => e.getBehaviorsInChildren(LIFETIME),
      (e) => e.getBehaviorInParent(LIFETIME),
      (e) => e.enabledSelf,
    ];
    for (const member of members) expect(engineError(() => member(hand)).code).toBe("entity-gone");
    expect(get("arm").children).toEqual([]);
    expect(get("base").find("arm/hand")).toBeUndefined();
  });

  it("destroying a parent takes its subtree, and their handles go with it", () => {
    const { ctx, get } = setup();
    const [arm, hand] = ["arm", "hand"].map(get);
    ctx.destroy("arm");
    expect([arm!.alive, hand!.alive]).toEqual([false, false]);
    expect(ids(get("base").children)).toEqual(["leg"]);
  });
});
