import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ease } from "../anim/ease";
import { lerpChannel } from "../anim/tweens";
import type { SceneView } from "../context";
import { defineGame } from "../game/define";
import { EngineError, type SceneSystem } from "../game/types";
import { spriteViewId } from "../runtime/behaviors/sprite";
import { TWEEN_END } from "../runtime/behaviors/tween";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepEvent } from "../runtime/types";
import { hashText } from "../scene/hash";
import type { RuntimeEntity, ShapeObj } from "../scene/types";
import type { SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { recordingView } from "./fixtures/recording-view";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

/** The test game, with static colliders as well as bodies setting off sensors. */
const sensing = defineGame({
  ...testGame,
  collisionGroups: {
    dynamic: { collidesWith: ["sensor"] },
    static: { collidesWith: ["sensor"] },
  },
});

type Backend = "rapier" | "none";
const BACKENDS: Backend[] = ["rapier", "none"];

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});

function load(entities: RuntimeEntity[], physics: Backend, view: SceneView | null = null) {
  const rt = createSceneRuntime({ rapier, view, game: sensing });
  const report = rt.load({
    name: "poses",
    bounds: [-50, -50, 50, 50],
    settings: { gravity: [0, 0], physics, grid: null, view: { projection: "orthogonal" } },
    entities,
  });
  if (!report.ok) throw new Error(report.error);
  expect(rt.stats().backend).toBe(physics === "rapier" ? "rapier" : "geometry");
  const system = (type: string) => rt.ctx.system<SceneSystem>(type)!;
  const setPose = (id: string, type: string, x: number, y: number, rot = 0) =>
    system(type).setPose!(id, x, y, rot);
  const hits = (x: number, y: number) =>
    rt.ctx.space.pointAt({ x, y }, { sensors: true }).map((h) => h.tag.entityId);
  const sensorEvents = (n: number) => {
    const events: [string, string | undefined, string | undefined][] = [];
    for (let i = 0; i < n; i++) {
      for (const e of rt.step(DT, []).events) {
        if (e.type.startsWith("sensor:")) events.push([e.type, e.entityId, e.other]);
      }
    }
    return events;
  };
  return { rt, system, setPose, hits, sensorEvents };
}

describe.each(BACKENDS)("setPose on %s", (physics) => {
  const door: RuntimeEntity = { id: "door", type: "solid", shape: box(0, 0, 1, 0.5) };

  it("moves a solid's collider: a point query hits it at the new spot and not the old", () => {
    const { rt, setPose, hits } = load([door], physics);
    expect(hits(0, 0)).toEqual(["door"]);
    setPose("door", "solid", 5, 2);
    expect(hits(5, 2)).toEqual(["door"]);
    expect(hits(0, 0)).toEqual([]);
    rt.step(DT, []);
    expect(hits(5, 2)).toEqual(["door"]);
    expect(hits(0, 0)).toEqual([]);
    rt.destroy();
  });

  it("turns a solid's collider with its pose", () => {
    const { rt, setPose, hits } = load([door], physics);
    expect(hits(0.9, 0)).toEqual(["door"]);
    setPose("door", "solid", 0, 0, Math.PI / 2);
    expect(hits(0, 0.9)).toEqual(["door"]);
    expect(hits(0.9, 0)).toEqual([]);
    rt.destroy();
  });

  it("moves a polygon solid by its own pose, its centre where the pose index says", () => {
    const tri: RuntimeEntity = {
      id: "tri",
      type: "solid",
      shape: {
        type: "poly",
        pts: [
          [0, 0],
          [3, 0],
          [0, 3],
        ],
      },
    };
    const { rt, setPose, hits } = load([tri], physics);
    const spawn = rt.ctx.poses.get("tri")!;
    expect(hits(spawn.x, spawn.y)).toEqual(["tri"]);
    setPose("tri", "solid", spawn.x + 10, spawn.y);
    expect(hits(spawn.x + 10, spawn.y)).toEqual(["tri"]);
    expect(hits(spawn.x, spawn.y)).toEqual([]);
    rt.destroy();
  });

  it("writes the pose index without a snap, and the system reports the new position", () => {
    const { rt, system, setPose } = load([door], physics);
    rt.step(DT, []);
    setPose("door", "solid", 3, 1);
    expect(rt.ctx.poses.get("door")).toEqual({ x: 3, y: 1, rot: 0 });
    expect(rt.ctx.poses.prev("door")).toEqual({ x: 0, y: 0, rot: 0 });
    const solids = system("solid") as SceneSystem & { position(id: string): unknown };
    expect(solids.position("door")).toEqual({ x: 3, y: 1 });
    rt.destroy();
  });

  it("a solid moved while disabled comes back where it was moved to", () => {
    const { rt, setPose, hits } = load([door], physics);
    rt.ctx.system("solid")!.disable!("door");
    setPose("door", "solid", 4, 0);
    expect(hits(4, 0)).toEqual([]);
    rt.ctx.system("solid")!.enable!("door");
    expect(hits(4, 0)).toEqual(["door"]);
    expect(hits(0, 0)).toEqual([]);
    rt.destroy();
  });

  it("a hidden one-way solid stays out of the world when moved, and its gate shows it at the new spot", () => {
    const ledge: RuntimeEntity = { ...door, id: "ledge", oneWay: true };
    const { rt, system, setPose, hits } = load([ledge], physics);
    const solids = system("solid") as SolidSystem;
    // A gate moves a Rapier body, which its collider follows at the next step.
    solids.gateOneWay(100, false);
    rt.step(DT, []);
    expect(hits(0, 0)).toEqual([]);
    setPose("ledge", "solid", 5, 2);
    expect(hits(5, 2)).toEqual([]);
    rt.step(DT, []);
    expect(hits(5, 2)).toEqual([]);
    solids.gateOneWay(-100, false);
    rt.step(DT, []);
    expect(hits(5, 2)).toEqual(["ledge"]);
    expect(hits(0, 0)).toEqual([]);
    solids.gateOneWay(1.6, false);
    expect(solids.isHidden("ledge"), "gated by the box where it is now").toBe(true);
    rt.destroy();
  });

  it("a sensor's enters and exits follow its move", () => {
    // Fixed bodies never meet on Rapier, so there a resting prop is what the sensor finds.
    const other: RuntimeEntity =
      physics === "rapier"
        ? {
            id: "crate",
            type: "prop",
            shape: box(10, 0, 0.5, 0.5),
            density: 1,
            restitution: 0,
          }
        : { id: "crate", type: "solid", shape: box(10, 0, 0.5, 0.5) };
    const zone: RuntimeEntity = { id: "zone", type: "sensor", shape: box(0, 0, 1, 1) };
    const { rt, setPose, hits, sensorEvents } = load([zone, other], physics);
    expect(sensorEvents(3)).toEqual([]);
    setPose("zone", "sensor", 10, 0);
    expect(hits(10, 0)).toContain("zone");
    expect(sensorEvents(2)).toEqual([["sensor:enter", "zone", "crate"]]);
    setPose("zone", "sensor", 0, 0);
    expect(sensorEvents(2)).toEqual([["sensor:exit", "zone", "crate"]]);
    rt.destroy();
  });

  it("marker and decor write the pose index alone, without a snap", () => {
    const { rt, setPose } = load(
      [
        { id: "spot", type: "marker", at: [1, 1] },
        { id: "lamp", type: "decor", at: [2, 2] },
      ],
      physics,
    );
    rt.step(DT, []);
    setPose("spot", "marker", 4, 5, 0.5);
    setPose("lamp", "decor", 6, 7, 1);
    expect(rt.ctx.poses.get("spot")).toEqual({ x: 4, y: 5, rot: 0.5 });
    expect(rt.ctx.poses.prev("spot")).toEqual({ x: 1, y: 1, rot: 0 });
    expect(rt.ctx.poses.get("lamp")).toEqual({ x: 6, y: 7, rot: 1 });
    expect(rt.ctx.poses.prev("lamp")).toEqual({ x: 2, y: 2, rot: 0 });
    setPose("gone", "marker", 1, 1);
    setPose("gone", "decor", 1, 1);
    expect(rt.ctx.poses.has("gone")).toBe(false);
    rt.destroy();
  });
});

describe("setPose's place among the primitives", () => {
  it("solid, sensor, marker and decor have it; prop and follower don't", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: sensing });
    const scene = engineYard();
    scene.entities.push({ id: "lamp", type: "decor", at: [1, 1] });
    const report = rt.load(scene);
    if (!report.ok) throw new Error(report.error);
    const hook = (type: string) => typeof rt.ctx.system(type)?.setPose;
    for (const type of ["solid", "sensor", "marker", "decor"])
      expect(hook(type), type).toBe("function");
    for (const type of ["prop", "follower"]) expect(hook(type), type).toBe("undefined");
    rt.destroy();
  });

  it("shifts a moved solid's world-space drawing to its new pose, and keeps it there on a redraw", () => {
    const { view, live } = recordingView();
    const { rt, setPose } = load(
      [{ id: "door", type: "solid", shape: box(2, 1, 1, 0.5) }],
      "none",
      view,
    );
    setPose("door", "solid", 5, 1, Math.PI / 2);
    const shifted = live.get("door")!.pose;
    // The shift turns the drawn box about the view's origin, so its centre lands at the new pose.
    const c = Math.cos(shifted.rot);
    const s = Math.sin(shifted.rot);
    expect(shifted.rot).toBeCloseTo(Math.PI / 2, 12);
    expect(2 * c - 1 * s + shifted.x).toBeCloseTo(5, 12);
    expect(2 * s + 1 * c + shifted.y).toBeCloseTo(1, 12);
    rt.ctx.system("solid")!.disable!("door");
    rt.ctx.system("solid")!.enable!("door");
    expect(live.get("door")!.pose).toEqual(shifted);
    rt.destroy();
  });
});

const physicsFree = (entities: RuntimeEntity[]) => ({
  name: "tweens",
  bounds: [-50, -50, 50, 50] as [number, number, number, number],
  settings: {
    gravity: [0, 0] as [number, number],
    physics: "none" as const,
    grid: null,
    view: { projection: "orthogonal" as const },
  },
  entities,
});

/** A gameless runtime on a physics-free scene of `entities`. */
function tweening(entities: RuntimeEntity[], view: SceneView | null = null) {
  const rt = createSceneRuntime({ rapier, view });
  const report = rt.load(physicsFree(entities));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const pose = (rt: SceneRuntimeHandle, id: string) => rt.ctx.poses.get(id)!;

/** Steps `n` ticks, returning the step events of the given types. */
function stepFor(rt: SceneRuntimeHandle, n: number, types?: string[]): StepEvent[] {
  const out: StepEvent[] = [];
  for (let i = 0; i < n; i++)
    for (const e of rt.step(DT, []).events) if (!types || types.includes(e.type)) out.push(e);
  return out;
}

/** The value at tick `k` of a play over `d` ticks from `from` to `to`. */
const formula = (from: number, to: number, k: number, d: number, name = "linear" as const) =>
  k === d ? to : from + (to - from) * ease(name, k / d);

describe("tweens", () => {
  it("move an entity's channels tick by tick by the formula, from where it stands", () => {
    const rt = tweening([{ id: "spot", type: "marker", at: [1, 2] }]);
    rt.ctx.tweens.to("spot", { to: { x: 4, rot: 1 }, duration: 10, ease: "quadInOut" });
    expect(rt.ctx.tweens.size).toBe(1);
    for (let k = 1; k <= 10; k++) {
      rt.step(DT, []);
      const p = pose(rt, "spot");
      const e = ease("quadInOut", k / 10);
      expect(p.x).toBe(k === 10 ? 4 : 1 + (4 - 1) * e);
      expect(p.rot).toBe(k === 10 ? 1 : 0 + (1 - 0) * e);
      expect(p.y).toBe(2);
    }
    stepFor(rt, 5);
    expect(pose(rt, "spot")).toEqual({ x: 4, y: 2, rot: 1 });
    expect(rt.ctx.tweens.size).toBe(0);
    rt.destroy();
  });

  it("takes `from`, `delay` and a duration in ms, rounded to ticks once", () => {
    const rt = tweening([{ id: "spot", type: "marker", at: [0, 0] }]);
    rt.ctx.tweens.to("spot", { from: { y: 10 }, to: { y: 20 }, duration: { ms: 100 }, delay: 2 });
    stepFor(rt, 2);
    expect(pose(rt, "spot").y).toBe(0);
    const d = Math.round((100 * rt.ctx.time.rate) / 1000);
    for (let k = 1; k <= d; k++) {
      rt.step(DT, []);
      expect(pose(rt, "spot").y).toBe(formula(10, 20, k, d));
    }
    rt.destroy();
  });

  it("wait no ticks for a delay of { ms: 0 }, as for 0", () => {
    const rt = tweening([
      { id: "a", type: "marker", at: [0, 0] },
      { id: "b", type: "marker", at: [0, 0] },
    ]);
    rt.ctx.tweens.to("a", { to: { x: 3 }, duration: 3, delay: { ms: 0 } });
    rt.ctx.tweens.to("b", { to: { x: 3 }, duration: 3, delay: 0 });
    rt.step(DT, []);
    expect(pose(rt, "a").x).toBe(1);
    expect(pose(rt, "b").x).toBe(1);
    rt.destroy();
  });

  it("lerp a tint per colour channel", () => {
    expect(lerpChannel("tint", 0x000000, 0xff8000, 0.5)).toBe(0x804000);
    expect(lerpChannel("tint", 0x102030, 0x102030, 0.3)).toBe(0x102030);
    expect(lerpChannel("tint", 0x000000, 0xffffff, 1.4)).toBe(0xffffff);
    expect(lerpChannel("x", 0, 10, 0.25)).toBe(2.5);
  });

  it("repeat, with yoyo playing every other play backwards, and -1 forever", () => {
    const rt = tweening([
      { id: "a", type: "marker", at: [0, 0] },
      { id: "b", type: "marker", at: [0, 0] },
      { id: "c", type: "marker", at: [0, 0] },
    ]);
    rt.ctx.tweens.to("a", { to: { x: 8 }, duration: 4, repeat: 2, yoyo: true });
    rt.ctx.tweens.to("b", { to: { x: 8 }, duration: 4, repeat: 1 });
    rt.ctx.tweens.to("c", { to: { x: 8 }, duration: 4, repeat: -1, yoyo: true });
    const xs: Record<string, number[]> = { a: [], b: [] };
    const ends: string[] = [];
    for (let i = 0; i < 12; i++) {
      for (const e of rt.step(DT, []).events)
        if (e.type === TWEEN_END) ends.push(`${i}:${e.entityId}`);
      xs.a!.push(pose(rt, "a").x);
      xs.b!.push(pose(rt, "b").x);
    }
    expect(xs.a).toEqual([2, 4, 6, 8, 6, 4, 2, 0, 2, 4, 6, 8]);
    expect(xs.b).toEqual([2, 4, 6, 8, 2, 4, 6, 8, 8, 8, 8, 8]);
    expect(ends).toEqual(["7:b", "11:a"]);
    stepFor(rt, 100);
    expect(rt.ctx.tweens.size).toBe(1);
    rt.destroy();
  });

  it("a key replaces the entity's tween with that key, and only that entity's", () => {
    const rt = tweening([
      { id: "a", type: "marker", at: [0, 0] },
      { id: "b", type: "marker", at: [0, 0] },
    ]);
    rt.ctx.tweens.to("a", { to: { x: 10 }, duration: 10, key: "move" });
    rt.ctx.tweens.to("b", { to: { x: 10 }, duration: 10, key: "move" });
    rt.ctx.tweens.to("a", { to: { y: 10 }, duration: 10, key: "lift" });
    stepFor(rt, 2);
    rt.ctx.tweens.to("a", { to: { x: -2 }, duration: 2, key: "move" });
    expect(rt.ctx.tweens.size).toBe(3);
    stepFor(rt, 2);
    expect(pose(rt, "a").x).toBe(-2);
    expect(pose(rt, "b").x).toBe(4);
    expect(pose(rt, "a").y).toBe(4);
    rt.destroy();
  });

  it("cancel and cancelAll end tweens without an event", () => {
    const rt = tweening([{ id: "a", type: "marker", at: [0, 0] }]);
    const one = rt.ctx.tweens.to("a", { to: { x: 10 }, duration: 2 });
    rt.ctx.tweens.to("a", { to: { y: 10 }, duration: 2 });
    rt.ctx.tweens.cancel(one);
    expect(rt.ctx.tweens.size).toBe(1);
    rt.ctx.tweens.cancelAll("a");
    expect(stepFor(rt, 3, [TWEEN_END])).toEqual([]);
    expect(pose(rt, "a")).toEqual({ x: 0, y: 0, rot: 0 });
    rt.destroy();
  });

  it("are cancelled by their owner's destroy and paused while it is disabled, block or not", () => {
    const bobbing = { tween: { tweens: [{ to: { y: 4 }, duration: 4 }] } };
    const rt = tweening([
      { id: "a", type: "marker", at: [0, 0] },
      { id: "b", type: "marker", at: [0, 0], behaviors: bobbing },
      { id: "c", type: "marker", at: [0, 0] },
    ]);
    rt.ctx.tweens.to("a", { to: { x: 4 }, duration: 4 });
    rt.ctx.tweens.to("c", { to: { x: 4 }, duration: 4 });
    stepFor(rt, 1);
    rt.ctx.setEnabled("a", false);
    rt.ctx.setEnabled("b", false);
    rt.ctx.destroy("c");
    expect(rt.ctx.tweens.size).toBe(2);
    expect(stepFor(rt, 5, [TWEEN_END])).toEqual([]);
    rt.ctx.setEnabled("a", true);
    rt.ctx.setEnabled("b", true);
    expect(pose(rt, "a").x).toBe(1);
    expect(pose(rt, "b").y).toBe(1);
    const ends = stepFor(rt, 3, [TWEEN_END]).map((e) => e.entityId);
    // In the order they were started: the block's at the load, then code's.
    expect(ends).toEqual(["b", "a"]);
    expect(pose(rt, "a").x).toBe(4);
    expect(pose(rt, "b").y).toBe(4);
    rt.destroy();
  });

  it("raise tween:end at the owner, or the spec's emit in its place", () => {
    const rt = tweening([{ id: "a", type: "marker", at: [1, 1] }]);
    const plain = rt.ctx.tweens.to("a", { to: { x: 3 }, duration: 2, key: "slide" });
    rt.ctx.tweens.to("a", {
      to: { y: 5 },
      duration: 3,
      emit: { type: "door:open", data: { n: 1 } },
    });
    const events = stepFor(rt, 3, [TWEEN_END, "door:open"]);
    expect(
      events.map(({ tick, type, entityId, at, data }) => ({ tick, type, entityId, at, data })),
    ).toEqual([
      {
        tick: 1,
        type: TWEEN_END,
        entityId: "a",
        at: { x: 3, y: 1 + (5 - 1) * (1 / 3) },
        data: { id: plain, key: "slide" },
      },
      { tick: 2, type: "door:open", entityId: "a", at: { x: 3, y: 5 }, data: { n: 1 } },
    ]);
    rt.destroy();
  });

  it("value tweens run a number through callbacks", () => {
    const rt = tweening([]);
    const seen: number[] = [];
    let done = 0;
    rt.ctx.tweens.value(10, 20, {
      duration: 4,
      ease: "cubicOut",
      onUpdate: (v) => seen.push(v),
      onDone: () => void done++,
    });
    stepFor(rt, 6);
    expect(seen).toEqual([1, 2, 3, 4].map((k) => formula(10, 20, k, 4, "cubicOut" as never)));
    expect(done).toBe(1);
    rt.destroy();
  });

  it("are refused on a type that can't be posed, and visual channels without a sprite", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: sensing });
    const report = rt.load({
      ...physicsFree([
        { id: "crate", type: "prop", shape: box(0, 0, 0.5, 0.5), density: 1, restitution: 0 },
        { id: "spot", type: "marker", at: [0, 0] },
      ]),
      settings: { ...physicsFree([]).settings, physics: "rapier" },
    });
    if (!report.ok) throw new Error(report.error);
    const refusal = (f: () => unknown) => {
      try {
        f();
      } catch (err) {
        return err instanceof EngineError ? [err.code, err.message] : String(err);
      }
      return null;
    };
    expect(refusal(() => rt.ctx.tweens.to("crate", { to: { x: 1 }, duration: 5 }))).toEqual([
      "tween-target-invalid",
      `can't tween "crate": it is a prop, which can't be posed, so a tween can't move its x`,
    ]);
    expect(refusal(() => rt.ctx.tweens.to("spot", { to: { alpha: 0 }, duration: 5 }))).toEqual([
      "tween-target-invalid",
      `can't tween "spot": it has no sprite, so a tween can't animate its alpha`,
    ]);
    expect(refusal(() => rt.ctx.tweens.to("ghost", { to: { x: 1 }, duration: 5 }))?.[0]).toBe(
      "tween-target-invalid",
    );
    expect(refusal(() => rt.ctx.tweens.to("spot", { to: {}, duration: 5 }))?.[0]).toBe("schema");
    expect(rt.ctx.tweens.size).toBe(0);
    rt.destroy();

    const blocked = createSceneRuntime({ rapier, view: null, game: sensing });
    const refused = blocked.load({
      ...physicsFree([
        {
          id: "crate",
          type: "prop",
          shape: box(0, 0, 0.5, 0.5),
          density: 1,
          restitution: 0,
          behaviors: { tween: { tweens: [{ to: { rot: 1 }, duration: 5 }] } },
        },
      ]),
      settings: { ...physicsFree([]).settings, physics: "rapier" },
    });
    expect(refused.ok ? "" : refused.error).toContain("can't be posed");
    blocked.destroy();
  });

  it("a tween block runs from spawn, its entries side by side", () => {
    const rt = tweening([
      {
        id: "sign",
        type: "decor",
        at: [0, 0],
        behaviors: {
          tween: {
            tweens: [
              { to: { x: 5 }, duration: 5 },
              { to: { rot: 2 }, duration: 4, delay: 1 },
            ],
          },
        },
      },
    ]);
    for (let k = 1; k <= 5; k++) {
      rt.step(DT, []);
      expect(pose(rt, "sign").x).toBe(k);
      expect(pose(rt, "sign").rot).toBe(k === 1 ? 0 : formula(0, 2, k - 1, 4));
    }
    rt.destroy();
  });

  it("move a collider block with its entity's pose", () => {
    const rt = tweening([
      {
        id: "gate",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: ["box", 0, 0, 0.5, 0.5] } },
      },
    ]);
    const hits = (x: number, y: number) =>
      rt.ctx.space.pointAt({ x, y }).map((h) => h.tag.entityId);
    expect(hits(0, 0)).toEqual(["gate"]);
    rt.ctx.tweens.to("gate", { to: { x: 6 }, duration: 3 });
    stepFor(rt, 3);
    expect(hits(6, 0)).toEqual(["gate"]);
    expect(hits(0, 0)).toEqual([]);
    rt.destroy();
  });
});

describe("tweens and the view", () => {
  const lamp = (over: Partial<RuntimeEntity> = {}): RuntimeEntity => ({
    id: "lamp",
    type: "decor",
    at: [1, 1],
    behaviors: {
      sprite: { tint: 0x000000 },
      tween: { tweens: [{ to: { x: 4, alpha: 0.5, tint: 0xff8000, scale: 2 }, duration: 3 }] },
    },
    ...over,
  });

  it("pose a tweened decor's sprite in the tick its pose moved, and style it", () => {
    const { view, live } = recordingView({ sprites: true });
    const rt = tweening([lamp()], view);
    const sid = spriteViewId("lamp");
    const size = live.get(sid)!.sprite!.size;
    for (let k = 1; k <= 3; k++) {
      rt.step(DT, []);
      expect(live.get(sid)!.pose.x).toBe(pose(rt, "lamp").x);
      expect(pose(rt, "lamp").x).toBe(formula(1, 4, k, 3));
      const visual = live.get(sid)!.sprite!;
      expect(visual.alpha).toBe(formula(1, 0.5, k, 3));
      expect(visual.tint).toBe(lerpChannel("tint", 0, 0xff8000, k / 3));
      const scale = formula(1, 2, k, 3);
      expect(visual.size).toEqual([size[0] * scale, size[1] * scale]);
    }
    rt.destroy();
  });

  it("a run with a view and a headless run end on one digest", () => {
    const digestOf = (view: SceneView | null) => {
      const rt = tweening([lamp(), { id: "spot", type: "marker", at: [0, 0] }], view);
      rt.ctx.tweens.to("spot", {
        to: { y: 3 },
        duration: 7,
        ease: "bounceOut",
        repeat: 1,
        yoyo: true,
      });
      const frames: unknown[] = [];
      for (let i = 0; i < 20; i++) frames.push([rt.step(DT, []).events, poses(rt)]);
      rt.destroy();
      return hashText(JSON.stringify(frames));
    };
    expect(digestOf(recordingView({ sprites: true }).view)).toBe(digestOf(null));
  });
});

/** Every entity's pose, by id. */
const poses = (rt: SceneRuntimeHandle) =>
  [...rt.ctx.poses.ids()].sort().map((id) => {
    const p = rt.ctx.poses.get(id)!;
    return [id, p.x, p.y, p.rot];
  });

describe("tweens replay and save", () => {
  const entities = (): RuntimeEntity[] => [
    {
      id: "sign",
      type: "decor",
      at: [0, 0],
      behaviors: {
        tween: {
          tweens: [{ to: { rot: 1 }, duration: 9, ease: "sineInOut", repeat: -1, yoyo: true }],
        },
      },
    },
    {
      id: "flag",
      type: "marker",
      at: [2, 0],
      behaviors: {
        tween: { tweens: [{ to: { y: 3 }, duration: 30, delay: 10, emit: { type: "flag:up" } }] },
      },
    },
    {
      id: "door",
      type: "solid",
      shape: box(5, 0, 0.5, 1),
      behaviors: {
        tween: { tweens: [{ to: { y: 4 }, duration: 20, ease: "backOut", repeat: 2 }] },
      },
    },
    { id: "spot", type: "marker", at: [-2, 0] },
  ];

  /** Ticks `from` to `to`: each tick's events and every pose, hashed. Code starts a tween on `spot` at tick 5. */
  function play(rt: SceneRuntimeHandle, from: number, to: number): string {
    const frames: unknown[] = [];
    for (let t = from; t < to; t++) {
      if (t === 5) rt.ctx.tweens.to("spot", { to: { x: 2 }, duration: 40, ease: "elasticOut" });
      frames.push([rt.step(DT, []).events, poses(rt), rt.ctx.space.pointAt({ x: 5, y: 2 }).length]);
    }
    return hashText(JSON.stringify(frames));
  }

  it("a physics-free scene with tweens replays to one digest", () => {
    const a = tweening(entities());
    const b = tweening(entities());
    expect(play(a, 0, 80)).toBe(play(b, 0, 80));
    a.destroy();
    b.destroy();
  });

  it("its world save restores mid-tween and runs on to the same digest", () => {
    const AT = 20;
    const a = tweening(entities());
    play(a, 0, AT);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const saved = captured.file.world!.systems["@tweens"]!.run as { tweens: { owner: string }[] };
    expect(saved.tweens.map((t) => t.owner).sort()).toEqual(["door", "flag", "sign", "spot"]);
    const digest = play(a, AT, 90);
    a.destroy();

    const b = tweening(entities());
    const restored = restoreSave(b, captured.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(b.ctx.tweens.size).toBe(4);
    expect(play(b, AT, 90)).toBe(digest);
    b.destroy();
  });

  it("a save keeps the look finished tweens left, for the sprite and a later tween's start", () => {
    const lamp: RuntimeEntity = {
      id: "lamp",
      type: "decor",
      at: [0, 0],
      behaviors: { sprite: { tint: 0x000000 } },
    };
    const sid = spriteViewId("lamp");
    const fade = { to: { alpha: 0.25, tint: 0xff8000, scale: 2 }, duration: 3 };
    /** Ticks on from the save, starting a fade back up: the sprite's look each tick. */
    const rest = (rt: SceneRuntimeHandle, live: ReturnType<typeof recordingView>["live"]) => {
      const looks: unknown[] = [];
      rt.ctx.tweens.to("lamp", { to: { alpha: 1, scale: 1 }, duration: 4 });
      for (let i = 0; i < 5; i++) {
        rt.step(DT, []);
        const { alpha, tint, size } = live.get(sid)!.sprite!;
        looks.push([alpha, tint, size]);
      }
      return looks;
    };

    const a = recordingView({ sprites: true });
    const first = tweening([lamp], a.view);
    first.ctx.tweens.to("lamp", fade);
    stepFor(first, 5);
    expect(first.ctx.tweens.size).toBe(0);
    const captured = captureSave(first, { depth: "world", slot: "s", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const atSave = { ...a.live.get(sid)!.sprite! };
    expect(atSave.alpha).toBe(0.25);
    const looks = rest(first, a.live);
    expect(looks[0]).toEqual([formula(0.25, 1, 1, 4), 0xff8000, expect.anything()]);
    first.destroy();

    const b = recordingView({ sprites: true });
    const second = tweening([lamp], b.view);
    expect(b.live.get(sid)!.sprite!.alpha).not.toBe(atSave.alpha);
    const restored = restoreSave(second, captured.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    const { alpha, tint, size } = b.live.get(sid)!.sprite!;
    expect({ alpha, tint, size }).toEqual({
      alpha: atSave.alpha,
      tint: atSave.tint,
      size: atSave.size,
    });
    expect(rest(second, b.live)).toEqual(looks);
    second.destroy();
  });

  it("a save after tweens ended keeps them ended", () => {
    const a = tweening(entities());
    play(a, 0, 70);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const digest = play(a, 70, 100);
    a.destroy();
    const b = tweening(entities());
    const restored = restoreSave(b, captured.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(play(b, 70, 100)).toBe(digest);
    b.destroy();
  });
});
