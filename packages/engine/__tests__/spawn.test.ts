import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import {
  EngineError,
  type EngineContext,
  type GameDefinition,
  type SceneSystem,
} from "../game/types";
import { createBehaviorHost } from "../runtime/behaviors";
import { EntityTable } from "../runtime/entity-table";
import { createLifecycle } from "../runtime/lifecycle";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DESTROYED, ENTITY_SPAWNED, type StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";

const DT = 1000 / 60;
const TAG = "spawn/tag";

/**
 * A game logging to one list: `crate` and `ghost` systems log spawn and
 * despawn and record what their `afterStep` iterates; `crate` throws on
 * spawn when its `boom` field is set. The `spawn/tag` behavior logs attach
 * and detach and throws on attach when its block says so.
 */
function loggingGame() {
  const log: string[] = [];
  const during: { before: ((ctx: EngineContext) => void) | null } = { before: null };
  const afterStep: { run: ((ctx: EngineContext) => void) | null } = { run: null };
  const seen: string[][] = [];

  const pointSystem =
    (name: string, iterate: boolean) =>
    (ctx: EngineContext): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn(e) {
          if (e.boom) throw new Error(`${e.id} went boom`);
          log.push(`spawn ${name} ${e.id}`);
          live.add(e.id);
        },
        despawn: (id) => void (live.delete(id) && log.push(`despawn ${name} ${id}`)),
        clear: () => live.clear(),
        size: () => live.size,
        ready: (ids) => void log.push(`ready ${name} ${ids.join(",")}`),
        afterStep: iterate
          ? () => void seen.push([...live].filter((id) => ctx.exists(id)))
          : undefined,
      };
    };

  const crate = defineEntityType({
    type: "crate",
    description: "A point that may refuse to spawn.",
    fields: {
      at: pointField("Where it stands."),
      boom: z.boolean().optional().describe("Throw on spawn."),
    },
    system: pointSystem("crate", false),
  });
  const ghost = defineEntityType({
    type: "ghost",
    description: "A point whose system records what it iterates.",
    fields: { at: pointField("Where it stands.") },
    system: pointSystem("ghost", true),
  });
  const shell = defineEntityType({
    type: "shell",
    description: "Spawned by game code only.",
    base: "marker",
    fields: { at: pointField("Where it starts.") },
    spawnOnly: true,
  });

  const tag = defineBehavior({
    name: TAG,
    description: "Logs attach and detach.",
    fields: { fail: z.boolean().default(false).describe("Throw on attach.") },
    system: (): BehaviorSystem => {
      const live = new Set<string>();
      return {
        attach(id, block) {
          if (block.fail) throw new Error(`${id} refused the tag`);
          log.push(`attach tag ${id}`);
          live.add(id);
        },
        detach: (id) => void (live.delete(id) && log.push(`detach tag ${id}`)),
        clear: () => live.clear(),
        size: () => live.size,
      };
    },
  });

  const game: GameDefinition = defineGame({
    id: "spawn",
    types: [crate, ghost, shell],
    behaviors: [tag],
    actions: [],
    createRuntime: (ctx) => ({
      beforeStep() {
        during.before?.(ctx);
        during.before = null;
      },
      afterStep() {
        log.push("game afterStep");
        afterStep.run?.(ctx);
        afterStep.run = null;
      },
      snapshot: () => null,
    }),
  });
  return { game, log, during, afterStep, seen };
}

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "spawn",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

/** A loaded runtime with the seams' destroy notifications logged. */
function setup(entities: RuntimeEntity[] = []) {
  const parts = loggingGame();
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: parts.game });
  const seams = rt.ctx as unknown as {
    query: { removed(id: string): void };
    timers: { cancelOwner(id: string): void };
    events: { dropOwner(id: string): void };
    contacts: { forget(id: string): void };
  };
  seams.timers.cancelOwner = (id) => void parts.log.push(`timers cancel ${id}`);
  seams.events.dropOwner = (id) => void parts.log.push(`events drop ${id}`);
  seams.query.removed = (id) => void parts.log.push(`query removed ${id}`);
  seams.contacts.forget = (id) => void parts.log.push(`contacts forget ${id}`);
  expect(rt.load(scene(entities))).toMatchObject({ ok: true });
  parts.log.length = 0;
  return { rt, ...parts };
}

const ghostAt = (id: string, at: [number, number] = [0, 0]): RuntimeEntity => ({
  id,
  type: "ghost",
  at,
});

function refusal(run: () => unknown): EngineError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error("expected an EngineError");
}

describe("runtime ids", () => {
  it("count per name from 1, and start again at each load", () => {
    const { rt } = setup();
    const ids = [
      rt.ctx.spawn({ type: "crate", at: [0, 0] }).id,
      rt.ctx.spawn({ type: "ghost", at: [0, 0] }).id,
      rt.ctx.spawn({ type: "crate", at: [0, 0] }).id,
      rt.ctx.spawn({ type: "shell", at: [0, 0] }).id,
    ];
    expect(ids).toEqual(["crate#1", "ghost#1", "crate#2", "shell#1"]);
    expect(rt.load(scene([])).ok).toBe(true);
    expect(rt.ctx.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#1");
    rt.destroy();
  });

  it("a type and a prefab named alike share one counter", () => {
    const { game } = loggingGame();
    const registry = createRegistry(game);
    const rt = createSceneRuntime({ rapier: undefined, view: null, game });
    expect(rt.load(scene([])).ok).toBe(true);
    const entities = new EntityTable();
    const system = rt.ctx.system("crate")!;
    const lifecycle = createLifecycle({
      ctx: rt.ctx,
      registry,
      systems: new Map([["crate", system]]),
      behaviors: createBehaviorHost(rt.ctx, registry),
      entities,
      events: rt.ctx.events as never,
      timers: rt.ctx.timers as never,
      query: rt.ctx.query as never,
      contacts: rt.ctx.contacts as never,
      stepping: () => false,
      changed: () => {},
      settled: () => {},
    });
    expect(lifecycle.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#1");
    expect(lifecycle.claimId("crate")).toBe("crate#2");
    expect(lifecycle.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#3");
    expect(lifecycle.claimId("gate")).toBe("gate#1");
    entities.set("gate#east/door", { id: "gate#east/door", type: "crate" });
    expect(refusal(() => lifecycle.claimId("gate", "gate#east")).message).toContain("already live");
    expect(lifecycle.claimId("gate", "gate#west")).toBe("gate#west");
    rt.destroy();
  });

  it("take an explicit <name>#<label> that is free and not all digits", () => {
    const { rt } = setup([ghostAt("g")]);
    expect(rt.ctx.spawn({ type: "crate", id: "crate#boss", at: [0, 0] }).id).toBe("crate#boss");
    expect(rt.ctx.exists("crate#boss")).toBe(true);
    for (const id of [
      "crate#boss",
      "crate#7",
      "ghost#x",
      "crate",
      "crate#",
      "Crate#a",
      "crate#a/b",
    ]) {
      const err = refusal(() => rt.ctx.spawn({ type: "crate", id, at: [0, 0] }));
      expect(err.code, id).toBe("spawn-id-invalid");
    }
    expect(rt.ctx.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#1");
    rt.destroy();
  });

  it("skip ids a loaded-back scene already holds", () => {
    const { game } = loggingGame();
    const spawnsOnLoad = defineGame({
      ...game,
      createRuntime: (ctx) => ({
        onLoad: () => void ctx.spawn({ type: "shell", at: [0, 0] }),
        snapshot: () => null,
      }),
    });
    const rt = createSceneRuntime({ rapier: undefined, view: null, game: spawnsOnLoad });
    expect(rt.load(scene([ghostAt("g1")])).ok).toBe(true);
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["g1", "shell#1"]);

    expect(rt.load(rt.scene()!).ok).toBe(true);
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["g1", "shell#1", "shell#2"]);
    expect(rt.ctx.query.byType("shell")).toEqual(["shell#1", "shell#2"]);
    expect(rt.ctx.spawn({ type: "shell", at: [0, 0] }).id).toBe("shell#3");
    rt.destroy();
  });

  it("skip a live counter id however it arrived, and an instance's children", () => {
    const { rt } = setup([
      { id: "crate#2", type: "crate", at: [0, 0] },
      { id: "crate#3/lid", type: "crate", at: [0, 0] },
    ]);
    const ids = [0, 1].map(() => rt.ctx.spawn({ type: "crate", at: [0, 0] }).id);
    expect(ids).toEqual(["crate#1", "crate#4"]);
    expect(rt.add([{ id: "crate#5", type: "crate", at: [0, 0] }])).toEqual({ ok: true });
    expect(rt.ctx.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#6");
    rt.ctx.destroy("crate#1");
    expect(rt.ctx.spawn({ type: "crate", at: [0, 0] }).id).toBe("crate#7");
    rt.destroy();
  });
});

describe("ctx.spawn", () => {
  it("returns the entity live: spawned, posed, attached, in the table and ready", () => {
    const { rt, log } = setup();
    const e = rt.ctx.spawn({ type: "crate", at: [12, -4], behaviors: { [TAG]: {} } });
    expect(e).toEqual({
      id: "crate#1",
      type: "crate",
      at: [12, -4],
      behaviors: { [TAG]: { fail: false } },
    });
    expect(log).toEqual(["spawn crate crate#1", "attach tag crate#1", "ready crate crate#1"]);
    expect(rt.ctx.get("crate#1")).toBe(e);
    expect(rt.get("crate#1")).toBe(e);
    expect(rt.ctx.poses.get("crate#1")).toMatchObject({ x: 12, y: -4 });
    expect(rt.ctx.enabled("crate#1")).toBe(true);
    rt.destroy();
  });

  it("refuses an unknown or non-loading type and a schema mismatch, headless", () => {
    const { rt } = setup();
    expect(refusal(() => rt.ctx.spawn({ type: "nope" })).code).toBe("unknown-type");
    expect(refusal(() => rt.ctx.spawn({ type: "note", at: [0, 0] })).code).toBe("unknown-type");
    const bad = refusal(() => rt.ctx.spawn({ type: "crate", at: "here" }));
    expect(bad.code).toBe("schema");
    expect(rt.stats().entities).toBe(0);
    rt.destroy();
  });

  it("rolls back a throwing system, behavior or ready, and rethrows as an EngineError", () => {
    const { rt, log } = setup();
    const before = rt.stats();

    const boom = refusal(() => rt.ctx.spawn({ type: "crate", at: [0, 0], boom: true }));
    expect(boom).toMatchObject({ code: "schema", entityId: "crate#1" });
    expect(boom.message).toContain("went boom");

    const tagged = refusal(() =>
      rt.ctx.spawn({ type: "crate", at: [0, 0], behaviors: { [TAG]: { fail: true } } }),
    );
    expect(tagged.message).toContain("refused the tag");

    const system = rt.ctx.system("ghost")!;
    system.ready = () => {
      throw new EngineError("schema", "not ready");
    };
    const unready = refusal(() => rt.ctx.spawn({ type: "ghost", at: [0, 0] }));
    expect(unready.message).toBe("not ready");

    for (const id of ["crate#1", "crate#2", "ghost#1"]) {
      expect(rt.ctx.exists(id)).toBe(false);
      expect(rt.ctx.poses.has(id)).toBe(false);
    }
    expect(rt.stats()).toEqual(before);
    expect(log.filter((l) => l.startsWith("spawn") || l.startsWith("despawn"))).toEqual([
      "spawn crate crate#2",
      "despawn crate crate#2",
      "spawn ghost ghost#1",
      "despawn ghost ghost#1",
    ]);
    rt.destroy();
  });

  it("raises entity:spawned with its type at the spawn pose, inside a step only", () => {
    const { rt, during } = setup();
    rt.ctx.spawn({ type: "crate", at: [1, 2] });
    expect(rt.step(DT, []).events).toEqual([]);
    during.before = (ctx) => void ctx.spawn({ type: "ghost", at: [5, 6] });
    expect(rt.step(DT, []).events).toEqual([
      {
        tick: 1,
        type: ENTITY_SPAWNED,
        entityId: "ghost#1",
        at: { x: 5, y: 6 },
        data: { type: "ghost" },
      },
    ]);
    rt.destroy();
  });
});

describe("ctx.destroy", () => {
  it("outside a step is immediate and raises nothing", () => {
    const { rt, log } = setup([ghostAt("g1")]);
    rt.ctx.destroy("g1");
    expect(rt.ctx.exists("g1")).toBe(false);
    expect(rt.ctx.poses.has("g1")).toBe(false);
    expect(log).toEqual([
      "timers cancel g1",
      "events drop g1",
      "despawn ghost g1",
      "query removed g1",
      "contacts forget g1",
    ]);
    expect(rt.step(DT, []).events).toEqual([]);
    rt.ctx.destroy("g1");
    rt.ctx.destroy("never");
    rt.destroy();
  });

  it("inside a step waits for the flush after the game's afterStep, in the destroy order", () => {
    const { rt, log, during } = setup([
      { ...ghostAt("g1", [3, 4]), behaviors: { [TAG]: {} } },
      ghostAt("g2"),
    ]);
    during.before = (ctx) => {
      ctx.destroy("g1");
      ctx.destroy("g1");
      ctx.destroy("never");
      expect(ctx.exists("g1")).toBe(true);
    };
    const result = rt.step(DT, []);
    expect(log).toEqual([
      "game afterStep",
      "detach tag g1",
      "timers cancel g1",
      "events drop g1",
      "despawn ghost g1",
      "query removed g1",
      "contacts forget g1",
    ]);
    expect(result.events).toEqual([
      {
        tick: 0,
        type: ENTITY_DESTROYED,
        entityId: "g1",
        at: { x: 3, y: 4 },
        data: { type: "ghost" },
      },
    ]);
    expect(rt.ctx.exists("g1")).toBe(false);
    expect(rt.ctx.exists("g2")).toBe(true);
    rt.destroy();
  });

  it("an instance id destroys its live children in reverse spawn order", () => {
    const { rt, log, during } = setup([
      ghostAt("gate/frame"),
      ghostAt("gate/door"),
      ghostAt("gate/door/knob"),
      ghostAt("gatehouse"),
    ]);
    rt.ctx.destroy("gate/door/knob");
    log.length = 0;
    during.before = (ctx) => ctx.destroy("gate");
    const events = rt.step(DT, []).events as StepEvent[];
    expect(log.filter((l) => l.startsWith("despawn"))).toEqual([
      "despawn ghost gate/door",
      "despawn ghost gate/frame",
    ]);
    expect(events.map((e) => e.entityId)).toEqual(["gate/door", "gate/frame"]);
    expect(rt.ctx.exists("gatehouse")).toBe(true);
    rt.destroy();
  });

  it("exists and enabled answer for an instance id through its live children", () => {
    const { rt } = setup([ghostAt("gate/frame"), ghostAt("gate/door"), ghostAt("gatehouse")]);
    const { ctx } = rt;
    expect(ctx.exists("gate")).toBe(true);
    expect(ctx.enabled("gate")).toBe(true);
    ctx.setEnabled("gate/frame", false);
    expect(ctx.enabled("gate")).toBe(true);
    ctx.setEnabled("gate/door", false);
    expect(ctx.exists("gate")).toBe(true);
    expect(ctx.enabled("gate")).toBe(false);
    ctx.destroy("gate");
    expect(ctx.exists("gate")).toBe(false);
    expect(ctx.exists("gatehouse")).toBe(true);
    expect(ctx.exists("gat")).toBe(false);
    rt.destroy();
  });

  it("flushes ids queued during the flush in the same pass", () => {
    const { rt, during } = setup([ghostAt("a"), ghostAt("b"), ghostAt("c")]);
    const system = rt.ctx.system("ghost")!;
    const despawn = system.despawn.bind(system);
    system.despawn = (id) => {
      despawn(id);
      if (id === "a") rt.ctx.destroy("c");
    };
    during.before = (ctx) => ctx.destroy("a");
    const events = rt.step(DT, []).events;
    expect(events.map((e) => e.entityId)).toEqual(["a", "c"]);
    expect(rt.ctx.exists("b")).toBe(true);
    expect(rt.ctx.exists("c")).toBe(false);
    rt.destroy();
  });

  it("a system iterating its entities sees each one another destroys until the flush", () => {
    const { rt, during, seen } = setup([ghostAt("g1"), ghostAt("g2")]);
    during.before = (ctx) => {
      ctx.destroy("g1");
      ctx.destroy("g2");
    };
    rt.step(DT, []);
    rt.step(DT, []);
    expect(seen).toEqual([["g1", "g2"], []]);
    rt.destroy();
  });

  it("a destroy in the game's afterStep still flushes this tick", () => {
    const { rt, afterStep } = setup([ghostAt("g1")]);
    afterStep.run = (ctx) => ctx.destroy("g1");
    expect(rt.step(DT, []).events.map((e) => e.type)).toEqual([ENTITY_DESTROYED]);
    expect(rt.ctx.exists("g1")).toBe(false);
    rt.destroy();
  });
});

describe("an edit to a disabled entity", () => {
  it("keeps it disabled, with its timers paused, when the edit respawns it", () => {
    const { rt } = setup([ghostAt("g1")]);
    const { ctx } = rt;
    let fired = 0;
    ctx.timers.every(1, () => void fired++, { owner: "g1" });
    ctx.setEnabled("g1", false);
    expect(rt.update([{ id: "g1", type: "crate", at: [5, 5] }])).toEqual({ ok: true });
    expect(ctx.exists("g1")).toBe(true);
    expect(ctx.enabled("g1")).toBe(false);
    rt.step(DT, []);
    rt.step(DT, []);
    expect(fired).toBe(0);
    ctx.setEnabled("g1", true);
    for (let i = 0; i < 3; i++) rt.step(DT, []);
    expect(fired).toBeGreaterThan(0);
    rt.destroy();
  });

  it("stays disabled when the edit rolls back", () => {
    const { rt } = setup([ghostAt("g1")]);
    rt.ctx.setEnabled("g1", false);
    const report = rt.update([{ id: "g1", type: "crate", at: [0, 0], boom: true }]);
    expect(report).toMatchObject({ ok: false, entityId: "g1" });
    expect(rt.ctx.exists("g1")).toBe(true);
    expect(rt.ctx.enabled("g1")).toBe(false);
    rt.destroy();
  });
});

describe("spawned entities in scene() and stats()", () => {
  it("include spawned entities and drop destroyed ones", () => {
    const { rt } = setup([ghostAt("g1")]);
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["g1"]);
    rt.ctx.spawn({ type: "crate", at: [0, 0] });
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["g1", "crate#1"]);
    expect(rt.stats()).toMatchObject({ entities: 2, perType: { ghost: 1, crate: 1 } });
    rt.ctx.destroy("g1");
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["crate#1"]);
    expect(rt.stats()).toMatchObject({ entities: 1, perType: { crate: 1 } });
    rt.destroy();
  });

  it("includes what onLoad spawned", () => {
    const { game } = loggingGame();
    const onLoad = defineGame({
      ...game,
      createRuntime: (ctx) => ({
        onLoad: () => void ctx.spawn({ type: "shell", at: [0, 0] }),
        snapshot: () => null,
      }),
    });
    const rt = createSceneRuntime({ rapier: undefined, view: null, game: onLoad });
    expect(rt.load(scene([ghostAt("g1")])).ok).toBe(true);
    expect(rt.scene()!.entities.map((e) => e.id)).toEqual(["g1", "shell#1"]);
    rt.destroy();
  });
});
