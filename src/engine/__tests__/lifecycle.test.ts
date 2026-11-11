import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../game/behaviors";
import { defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import type { EngineContext, GameDefinition, SceneSystem } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DISABLED, ENTITY_ENABLED } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";

const DT = 1000 / 60;
const FIRST = "life/first";
const SECOND = "life/second";

/**
 * Two types and two behaviors logging to one list. `hooked` and `first`
 * have every lifecycle hook; `bare` and `second` have none, so the runtime
 * and the host fall back to despawn and spawn, detach and attach.
 */
function loggingGame() {
  const log: string[] = [];
  /** Run by the game's `beforeStep`, so a test can act inside a step. */
  const during: { run: ((ctx: EngineContext) => void) | null } = { run: null };

  const hooked = defineEntityType({
    type: "hooked",
    description: "A point whose system has every lifecycle hook.",
    fields: { at: pointField("Where it stands.") },
    system: (ctx): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void (log.push(`spawn hooked ${e.id}`), live.add(e.id)),
        despawn: (id) => void (live.delete(id) && log.push(`despawn hooked ${id}`)),
        clear: () => live.clear(),
        size: () => live.size,
        ready: (ids) => void log.push(`ready hooked ${ids.join(",")}`),
        disable: (id) => void log.push(`disable hooked ${id}`),
        enable: (id) => void log.push(`enable hooked ${id} pose=${ctx.poses.get(id)?.x}`),
      };
    },
  });

  /** Counts its spawns, so a respawn from the record shows as state reset. */
  const bare = defineEntityType({
    type: "bare",
    description: "A point whose system has no lifecycle hooks.",
    fields: { at: pointField("Where it stands.") },
    system: (ctx): SceneSystem => {
      const live = new Map<string, number>();
      return {
        spawn(e) {
          log.push(`spawn bare ${e.id}`);
          live.set(e.id, 0);
        },
        despawn: (id) => void (live.delete(id) && log.push(`despawn bare ${id}`)),
        clear: () => live.clear(),
        size: () => live.size,
        afterStep() {
          for (const [id, n] of live) {
            live.set(id, n + 1);
            const p = ctx.poses.get(id)!;
            ctx.poses.set(id, p.x + 1, p.y);
          }
        },
      };
    },
  });

  const behavior = (name: string, hooks: boolean) =>
    defineBehavior({
      name,
      description: hooks ? "Logs every hook." : "Logs attach and detach only.",
      fields: { n: z.number().default(0).describe("A number.") },
      system: (): BehaviorSystem => {
        const short = name.slice("life/".length);
        const live = new Set<string>();
        const system: BehaviorSystem = {
          attach: (id) => void (log.push(`attach ${short} ${id}`), live.add(id)),
          detach: (id) => void (live.delete(id) && log.push(`detach ${short} ${id}`)),
          clear: () => live.clear(),
          size: () => live.size,
        };
        if (hooks) {
          system.ready = (ids) => void log.push(`ready ${short} ${ids.join(",")}`);
          system.disable = (id) => void log.push(`disable ${short} ${id}`);
          system.enable = (id) => void log.push(`enable ${short} ${id}`);
        }
        return system;
      },
    });

  const game: GameDefinition = defineGame({
    id: "life",
    types: [hooked, bare],
    behaviors: [behavior(FIRST, true), behavior(SECOND, false)],
    actions: [],
    createRuntime: (ctx) => ({
      beforeStep() {
        during.run?.(ctx);
        during.run = null;
      },
      snapshot: () => null,
    }),
  });
  return { game, log, during };
}

const both = { [FIRST]: {}, [SECOND]: {} };

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "life",
    bounds: [-100, -100, 100, 100],
    settings: {
      gravity: [0, 0],
      physics: "none",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

const entity = (
  id: string,
  type: "hooked" | "bare",
  behaviors?: Record<string, Record<string, unknown>>,
  at: [number, number] = [10, 20],
): RuntimeEntity => ({ id, type, at, ...(behaviors ? { behaviors } : {}) });

/** A runtime with the seams' lifecycle notifications logged too. */
function setup(entities: RuntimeEntity[]) {
  const { game, log, during } = loggingGame();
  const rt = createSceneRuntime({ rapier: undefined, view: null, game });
  const seams = rt.ctx as unknown as {
    query: { enabledChanged(id: string, on: boolean): void };
    timers: { pauseOwner(id: string, paused: boolean): void };
    contacts: { forget(id: string): void };
  };
  seams.query.enabledChanged = (id, on) => void log.push(`query ${id} ${on}`);
  seams.timers.pauseOwner = (id, paused) => void log.push(`timers ${id} paused=${paused}`);
  seams.contacts.forget = (id) => void log.push(`contacts forget ${id}`);
  const report = rt.load(scene(entities));
  expect(report).toMatchObject({ ok: true });
  return { rt, log, during };
}

describe("lifecycle hooks", () => {
  it("runs systems' ready in spawn-group order, then behaviors' in registration order, at load", () => {
    const { rt, log } = setup([
      entity("b1", "bare", { [SECOND]: {} }),
      entity("h1", "hooked", both),
      entity("b2", "bare", both),
      entity("h2", "hooked"),
    ]);
    expect(log).toEqual([
      "spawn hooked h1",
      "attach first h1",
      "attach second h1",
      "spawn hooked h2",
      "spawn bare b1",
      "attach second b1",
      "spawn bare b2",
      "attach first b2",
      "attach second b2",
      "ready hooked h1,h2",
      "ready first h1,b2",
    ]);
    rt.destroy();
  });

  it("calls ready for entities a reconcile adds, with only their ids", () => {
    const { rt, log } = setup([entity("h1", "hooked", both)]);
    log.length = 0;
    expect(rt.add([entity("h2", "hooked", both), entity("b1", "bare")])).toEqual({ ok: true });
    expect(log.filter((l) => l.startsWith("ready"))).toEqual(["ready hooked h2", "ready first h2"]);
    rt.destroy();
  });

  it("disables behaviors in reverse, then the system, then the seams, and enables in order", () => {
    const { rt, log, during } = setup([entity("h1", "hooked", both)]);
    log.length = 0;
    during.run = (ctx) => ctx.setEnabled("h1", false);
    const off = rt.step(DT, []);
    expect(log).toEqual([
      "detach second h1",
      "disable first h1",
      "disable hooked h1",
      "query h1 false",
      "timers h1 paused=true",
      "contacts forget h1",
    ]);
    expect(rt.ctx.enabled("h1")).toBe(false);
    expect(rt.ctx.exists("h1")).toBe(true);
    expect(off.events).toEqual([
      {
        tick: 0,
        type: ENTITY_DISABLED,
        entityId: "h1",
        at: { x: 10, y: 20 },
        data: { type: "hooked" },
      },
    ]);

    log.length = 0;
    during.run = (ctx) => ctx.setEnabled("h1", true);
    const on = rt.step(DT, []);
    expect(log).toEqual([
      "enable hooked h1 pose=10",
      "enable first h1",
      "attach second h1",
      "query h1 true",
      "timers h1 paused=false",
    ]);
    expect(rt.ctx.enabled("h1")).toBe(true);
    expect(on.events.map((e) => [e.type, e.entityId, e.data])).toEqual([
      [ENTITY_ENABLED, "h1", { type: "hooked" }],
    ]);
    rt.destroy();
  });

  it("despawns a system without disable keeping its record, and spawns it again on enable", () => {
    const { rt, log } = setup([entity("b1", "bare", { [SECOND]: {} }, [0, 5])]);
    for (let i = 0; i < 3; i++) rt.step(DT, []);
    expect(rt.ctx.poses.get("b1")).toMatchObject({ x: 3, y: 5 });
    log.length = 0;

    rt.ctx.setEnabled("b1", false);
    expect(log).toEqual([
      "detach second b1",
      "despawn bare b1",
      "query b1 false",
      "timers b1 paused=true",
      "contacts forget b1",
    ]);
    expect(rt.ctx.get("b1")).toMatchObject({ id: "b1", type: "bare" });
    expect(rt.stats()).toMatchObject({ entities: 1, perType: {} });
    // Despawned, so its system no longer moves it; the pose stays where it was.
    rt.step(DT, []);
    expect(rt.ctx.poses.get("b1")).toMatchObject({ x: 3, y: 5 });

    log.length = 0;
    rt.ctx.setEnabled("b1", true);
    expect(log).toEqual([
      "spawn bare b1",
      "attach second b1",
      "query b1 true",
      "timers b1 paused=false",
    ]);
    // Spawned again from the record: back at its spawn pose.
    expect(rt.ctx.poses.get("b1")).toMatchObject({ x: 0, y: 5 });
    expect(rt.stats().perType).toEqual({ bare: 1 });
    rt.destroy();
  });

  it("raises no event outside a step", () => {
    const { rt, during } = setup([entity("h1", "hooked")]);
    rt.ctx.setEnabled("h1", false);
    rt.ctx.setEnabled("h1", true);
    during.run = null;
    expect(rt.step(DT, []).events).toEqual([]);
    rt.destroy();
  });

  it("ignores unknown ids and a flag already set", () => {
    const { rt, log } = setup([entity("h1", "hooked", both)]);
    log.length = 0;
    rt.ctx.setEnabled("nope", false);
    rt.ctx.setEnabled("h1", true);
    expect(log).toEqual([]);
    expect(rt.ctx.enabled("nope")).toBe(false);
    rt.ctx.setEnabled("h1", false);
    log.length = 0;
    rt.ctx.setEnabled("h1", false);
    expect(log).toEqual([]);
    expect(rt.ctx.enabled("h1")).toBe(false);
    rt.destroy();
  });

  it("forgets the flag when the entity leaves, and at the next load", () => {
    const { rt, log } = setup([entity("h1", "hooked", both), entity("b1", "bare")]);
    rt.ctx.setEnabled("h1", false);
    rt.ctx.setEnabled("b1", false);
    log.length = 0;
    rt.remove(["h1"]);
    expect(log).toEqual(["detach first h1", "despawn hooked h1", "contacts forget h1"]);
    expect(rt.ctx.enabled("h1")).toBe(false);
    expect(rt.add([entity("h1", "hooked")])).toEqual({ ok: true });
    expect(rt.ctx.enabled("h1")).toBe(true);
    expect(rt.load(scene([entity("b1", "bare")]))).toMatchObject({ ok: true });
    expect(rt.ctx.enabled("b1")).toBe(true);
    rt.destroy();
  });

  it("keeps marker, decor and nav records while disabled", () => {
    const { game } = loggingGame();
    const rt = createSceneRuntime({ rapier: undefined, view: null, game });
    const square = {
      type: "poly",
      pts: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    };
    expect(
      rt.load(
        scene([
          { id: "m", type: "marker", at: [1, 1] },
          { id: "d", type: "decor", at: [2, 2] },
          { id: "n", type: "nav", shape: square },
        ] as RuntimeEntity[]),
      ),
    ).toMatchObject({ ok: true });
    const before = rt.stats().perType;
    for (const id of ["m", "d", "n"]) rt.ctx.setEnabled(id, false);
    expect(rt.stats().perType).toEqual(before);
    expect(["m", "d", "n"].map((id) => rt.ctx.enabled(id))).toEqual([false, false, false]);
    for (const id of ["m", "d", "n"]) rt.ctx.setEnabled(id, true);
    expect(rt.stats().perType).toEqual(before);
    rt.destroy();
  });
});
