import { describe, expect, it } from "vite-plus/test";

import { OCCUPANT } from "../game/behaviors/occupant";
import { createRegistry, defineGame } from "../game/define";
import type { EngineContext, JsonValue } from "../game/types";
import {
  SAVE_REGISTRY,
  createMotionBody,
  saveRegistryOf,
  type SaveEntry,
  type SaveRegistry,
} from "../motion/body";
import { createGridStepper, type GridStepper } from "../motion/grid-step";
import { createTopDownController, type TopDownController } from "../motion/top-down";
import { createSceneRuntime } from "../runtime/runtime";
import {
  SENSOR_ENTER,
  SENSOR_EXIT,
  type SceneRuntimeHandle,
  type StepEvent,
} from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { SolidSystem } from "../systems/bodies";
import type { Vec2 } from "../types";
import { testGame } from "./fixtures/test-game";

const DT = 1000 / 60;
/** Where the first run saves. */
const AT = 52;
/** How long both runs go on after it. */
const AFTER = 120;

/** The hero's intent at tick `n` of a run: right, then down, then left, then up. */
function intentAt(n: number): Vec2 {
  if (n < 60) return { x: 1, y: 0 };
  if (n < 100) return { x: 0, y: 1 };
  if (n < 140) return { x: -1, y: 0 };
  return { x: 0, y: -1 };
}

/** The unit walks clockwise round the cells (1..5, 5..7). */
function nextCell([c, r]: readonly [number, number]): [number, number] {
  if (r === 5 && c < 5) return [c + 1, r];
  if (c === 5 && r < 7) return [c, r + 1];
  if (r === 7 && c > 1) return [c - 1, r];
  return [c, r - 1];
}

/** The tick the run is on, set by the driver before each step. */
let tickOfRun = 0;

/** The test game's types and groups, with game code that makes a motion body and a grid stepper. */
const game = defineGame({
  ...testGame,
  createRuntime(ctx: EngineContext) {
    let hero: TopDownController | null = null;
    let unit: GridStepper | null = null;
    return {
      onLoad() {
        const shape = { type: "box", cx: 0, cy: 0, hw: 0.2, hh: 0.2, rotDeg: 0 } as const;
        const body = createMotionBody(
          ctx,
          { id: "hero", type: "marker" },
          { x: 1, y: 2 },
          { shape, group: "dynamic" },
        );
        hero = createTopDownController(body, { maxSpeed: 2, accel: 6, decel: 4 });
        unit = createGridStepper(ctx, "unit", { start: [1, 5], msPerStep: 250, occupy: true });
      },
      onUnload() {
        hero = null;
        unit = null;
      },
      beforeStep(dtMs: number) {
        hero?.step(dtMs, intentAt(tickOfRun));
        if (unit && !unit.moving()) unit.step(nextCell(unit.cell()));
        unit?.update(dtMs);
      },
      snapshot: () => null,
    };
  },
});
const registry = createRegistry(game);

const DEF: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "test-game",
  name: "saves",
  bounds: [0, 0, 12, 8],
  settings: { physics: "none", gravity: [0, 0], grid: { kind: "square", cell: [1, 1] } },
  entities: [
    { id: "hero", type: "marker", at: [1, 2] },
    { id: "unit", type: "marker", at: [1.5, 5.5] },
    { id: "zone", type: "sensor", shape: ["box", 2.5, 2, 0.6, 0.6] },
    { id: "lane", type: "sensor", shape: ["box", 2.5, 3.6, 2, 0.3] },
    { id: "gate", type: "solid", oneWay: "up", shape: ["box", 8, 6, 1, 0.1] },
    {
      id: "cart",
      type: "follower",
      shape: ["box", 0, 0, 0.3, 0.3],
      path: {
        pts: [
          [6.5, 1.5],
          [10.5, 1.5],
          [10.5, 3.5],
        ],
        mode: "loop",
        speed: 1.5,
        pauseMs: 200,
      },
      behaviors: { [OCCUPANT.name]: {} },
    },
  ] as EntityDef[],
};

/**
 * The entries game code registers with the runtime's save registry, seen
 * through its `register` (or through a registry like it, on a context
 * without one).
 */
function installRegistry(ctx: EngineContext): Map<string, Map<string, SaveEntry>> {
  const entries = new Map<string, Map<string, SaveEntry>>();
  const own = saveRegistryOf(ctx);
  const inner = own ? own.register.bind(own) : null;
  const register: SaveRegistry["register"] = (entityId, owner, entry) => {
    let owners = entries.get(entityId);
    if (!owners) entries.set(entityId, (owners = new Map()));
    owners.set(owner, entry);
    const off = inner?.(entityId, owner, entry);
    return () => {
      off?.();
      if (entries.get(entityId)?.get(owner) === entry) entries.get(entityId)?.delete(owner);
    };
  };
  if (own) own.register = register;
  else (ctx as EngineContext & { [SAVE_REGISTRY]: SaveRegistry })[SAVE_REGISTRY] = { register };
  return entries;
}

type Run = { rt: SceneRuntimeHandle; entries: Map<string, Map<string, SaveEntry>> };

function fresh(): Run {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  const entries = installRegistry(rt.ctx);
  expect(rt.load(expandScene(DEF, registry))).toMatchObject({ ok: true });
  return { rt, entries };
}

type Saved = {
  poses: Record<string, [number, number, number]>;
  systems: Record<string, Record<string, JsonValue>>;
};

const IDS = ["hero", "unit", "zone", "lane", "gate", "cart"];

/** What a world save keeps of these systems: poses, then each owner's `save` by entity id. */
function capture({ rt, entries }: Run): Saved {
  const saved: Saved = { poses: {}, systems: {} };
  const put = (id: string, owner: string, value: JsonValue | undefined) => {
    if (value === undefined) return;
    (saved.systems[id] ??= {})[owner] = JSON.parse(JSON.stringify(value)) as JsonValue;
  };
  for (const e of rt.scene()!.entities) {
    const pose = rt.ctx.poses.get(e.id);
    if (pose) saved.poses[e.id] = [pose.x, pose.y, pose.rot];
    put(e.id, e.type, rt.ctx.system(e.type)?.save?.(e.id));
    for (const name of Object.keys(e.behaviors ?? {}))
      put(e.id, name, rt.ctx.behavior(name)?.save?.(e.id));
  }
  for (const [id, owners] of entries)
    for (const [owner, entry] of owners) put(id, owner, entry.save());
  return JSON.parse(JSON.stringify(saved)) as Saved;
}

/** Into a freshly loaded runtime: poses, then each system's and behavior's `restore`, then the registry's. */
function restore(run: Run, saved: Saved, skip: ReadonlySet<string> = new Set()): void {
  const { rt, entries } = run;
  for (const [id, [x, y, rot]] of Object.entries(saved.poses))
    rt.ctx.poses.set(id, x, y, rot, { snap: true });
  for (const e of rt.scene()!.entities) {
    const owners = saved.systems[e.id] ?? {};
    for (const [owner, state] of Object.entries(owners)) {
      if (skip.has(owner)) continue;
      if (owner === e.type) rt.ctx.system(e.type)?.restore?.(e.id, state);
      else if (e.behaviors && owner in e.behaviors) rt.ctx.behavior(owner)?.restore?.(e.id, state);
      else entries.get(e.id)?.get(owner)?.restore(state);
    }
  }
}

type Frame = {
  poses: Record<string, [number, number, number] | null>;
  cells: Record<string, readonly number[] | null>;
  events: Omit<StepEvent, "tick">[];
};

function frameOf(rt: SceneRuntimeHandle, events: StepEvent[] = []): Frame {
  const poses: Frame["poses"] = {};
  for (const id of IDS) {
    const p = rt.ctx.poses.get(id);
    poses[id] = p ? [p.x, p.y, p.rot] : null;
  }
  const occ = rt.ctx.grid!.occupancy;
  const cells: Frame["cells"] = {
    unit: occ.cellOf("unit") ?? null,
    cart: occ.cellOf("cart") ?? null,
  };
  return { poses, cells, events: events.map(({ tick: _tick, ...rest }) => rest) };
}

function stepRun(rt: SceneRuntimeHandle, n: number): Frame {
  tickOfRun = n;
  return frameOf(rt, rt.step(DT, []).events);
}

/** The uninterrupted run: its save at `AT`, its frame there, and the next `AFTER` frames. */
function original() {
  const run = fresh();
  for (let n = 0; n < AT; n++) stepRun(run.rt, n);
  const saved = capture(run);
  const atSave = frameOf(run.rt);
  const frames: Frame[] = [];
  for (let n = AT; n < AT + AFTER; n++) frames.push(stepRun(run.rt, n));
  run.rt.destroy();
  return { saved, atSave, frames };
}

function resumed(saved: Saved, skip?: ReadonlySet<string>) {
  const run = fresh();
  restore(run, saved, skip);
  const atRestore = frameOf(run.rt);
  const frames: Frame[] = [];
  for (let n = AT; n < AT + AFTER; n++) frames.push(stepRun(run.rt, n));
  run.rt.destroy();
  return { atRestore, frames };
}

describe("systems that hold state, saved mid-motion and restored into a fresh runtime", () => {
  it("continue exactly as the uninterrupted run: poses, cells and events", () => {
    const a = original();
    const b = resumed(a.saved);
    expect(b.atRestore).toEqual(a.atSave);
    expect(b.frames).toEqual(a.frames);
  });

  it("saves under the owners that hold the state, mid-motion", () => {
    const { saved } = original();
    expect(Object.keys(saved.systems.hero ?? {})).toEqual(["motion"]);
    expect(saved.systems.hero?.motion).toMatchObject({ v: [expect.any(Number), 0] });
    expect(saved.systems.unit?.["grid-step"]).toMatchObject({ step: { done: expect.any(Number) } });
    expect(saved.systems.zone?.sensor).toEqual({ inside: [["hero", 0]] });
    expect(saved.systems.cart?.follower).toBeDefined();
    expect(saved.systems.cart?.[OCCUPANT.name]).toEqual(expect.any(Array));
  });

  it("raises no sensor:enter for what was already inside: its first event is the exit", () => {
    const { frames } = original();
    const zone = frames.flatMap((f) => f.events).filter((e) => e.entityId === "zone");
    expect(zone.map((e) => e.type)[0]).toBe(SENSOR_EXIT);
    const lane = frames.flatMap((f) => f.events).filter((e) => e.entityId === "lane");
    expect(lane.map((e) => e.type)).toContain(SENSOR_ENTER);
  });

  it.each([
    ["motion", "hero's velocity"],
    ["grid-step", "the unit's step"],
    ["sensor", "the zone's inside set"],
    ["follower", "the cart's path clock"],
    [OCCUPANT.name, "the cart's cell"],
  ])("diverges without the %s state (%s), so each restore is what keeps the run", (owner) => {
    const a = original();
    const b = resumed(a.saved, new Set([owner]));
    expect({ at: b.atRestore, frames: b.frames }).not.toEqual({ at: a.atSave, frames: a.frames });
  });
});

describe("a one-way solid's gate", () => {
  it("is saved while it lets actors through and restored hidden", () => {
    const a = fresh();
    const solids = a.rt.ctx.system("solid") as SolidSystem;
    expect(solids.save?.("gate")).toBeUndefined();
    solids.gateOneWay(5, true);
    expect(solids.isHidden("gate")).toBe(true);
    const state = solids.save?.("gate");
    expect(state).toEqual({ hidden: true });
    expect(a.rt.ctx.space.pointAt({ x: 8, y: 6 })).toEqual([]);

    const b = fresh();
    const restored = b.rt.ctx.system("solid") as SolidSystem;
    restored.restore?.("gate", state!);
    expect(restored.isHidden("gate")).toBe(true);
    expect(b.rt.ctx.space.pointAt({ x: 8, y: 6 })).toEqual([]);
    a.rt.destroy();
    b.rt.destroy();
  });
});
