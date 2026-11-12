import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import {
  EngineError,
  type EngineContext,
  type GameDefinition,
  type SceneSystem,
} from "../game/types";
import { createEventBus, EVENT_PASS_LIMIT } from "../runtime/events";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DESTROYED, type StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";

const DT = 1000 / 60;

type Hook = ((ctx: EngineContext) => void) | null;

/**
 * A game whose `dot` system and runtime hooks run whatever a test sets for
 * the next step, logging each phase to one list.
 */
function hookGame() {
  const log: string[] = [];
  const hooks: { systemAfter: Hook; gameAfter: Hook; onLoad: Hook } = {
    systemAfter: null,
    gameAfter: null,
    onLoad: null,
  };
  const dot = defineEntityType({
    type: "dot",
    description: "A point whose system runs a test's hook after the physics step.",
    fields: { at: pointField("Where it stands.") },
    system: (ctx): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void live.add(e.id),
        despawn: (id) => void live.delete(id),
        clear: () => live.clear(),
        size: () => live.size,
        afterStep() {
          if (!hooks.systemAfter) return;
          log.push("system afterStep");
          hooks.systemAfter(ctx);
        },
      };
    },
  });
  const game: GameDefinition = defineGame({
    id: "events-bus",
    types: [dot],
    actions: [],
    createRuntime: (ctx) => ({
      onLoad: () => hooks.onLoad?.(ctx),
      afterStep() {
        log.push("game afterStep");
        hooks.gameAfter?.(ctx);
      },
      snapshot: () => null,
    }),
  });
  return { game, log, hooks };
}

function scene(entities: RuntimeEntity[] = []): ExpandedScene {
  return {
    name: "events-bus",
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

function setup(entities: RuntimeEntity[] = [{ id: "a", type: "dot", at: [0, 0] }]) {
  const parts = hookGame();
  const rt = createSceneRuntime({ rapier: undefined, view: null, game: parts.game });
  expect(rt.load(scene(entities))).toMatchObject({ ok: true });
  const step = () => rt.step(DT, []);
  return { rt, step, ctx: rt.ctx, ...parts };
}

const at = { x: 0, y: 0 };

afterEach(() => vi.restoreAllMocks());

describe("dispatch points", () => {
  it("deliver the tick's events before the game's afterStep, and afterStep's and the flush's after the flush", () => {
    const { ctx, step, log, hooks, rt } = setup();
    for (const type of ["ping", "pong", ENTITY_DESTROYED]) {
      ctx.events.on(type, (e) => void log.push(`${e.type} at tick ${e.tick}`));
    }
    hooks.systemAfter = (c) => c.emit({ type: "ping", at });
    hooks.gameAfter = (c) => {
      c.emit({ type: "pong", at });
      c.destroy("a");
    };
    const result = step();
    expect(log).toEqual([
      "system afterStep",
      "ping at tick 0",
      "game afterStep",
      "pong at tick 0",
      "entity:destroyed at tick 0",
    ]);
    // Dispatch follows raise order; the result keeps the engine's events ahead of the game's.
    expect(result.events.map((e) => e.type)).toEqual(["ping", ENTITY_DESTROYED, "pong"]);
    rt.destroy();
  });

  it("deliver nothing outside a step, and each event once", () => {
    const { ctx, step, hooks, rt } = setup();
    const heard: string[] = [];
    ctx.events.on(ENTITY_DESTROYED, (e) => void heard.push(`destroyed ${e.entityId}`));
    ctx.events.on("ping", (e) => void heard.push(`ping ${e.tick}`));
    ctx.destroy("a");
    ctx.spawn({ type: "dot", at: [1, 1] });
    expect(heard).toEqual([]);
    hooks.systemAfter = (c) => {
      c.emit({ type: "ping", at });
      hooks.systemAfter = null;
    };
    step();
    step();
    expect(heard).toEqual(["ping 0"]);
    rt.destroy();
  });
});

describe("subscription order", () => {
  it("runs handlers in subscription order per event, events in raise order", () => {
    const { ctx, step, log, hooks, rt } = setup();
    ctx.events.on("b", () => void log.push("b first"));
    ctx.events.on("a", () => void log.push("a first"));
    ctx.events.on("b", () => void log.push("b second"));
    ctx.events.on("a", () => void log.push("a second"));
    hooks.systemAfter = (c) => {
      c.emit({ type: "a", at });
      c.emit({ type: "b", at });
      c.emit({ type: "a", at });
    };
    step();
    expect(log.slice(1, -1)).toEqual([
      "a first",
      "a second",
      "b first",
      "b second",
      "a first",
      "a second",
    ]);
    rt.destroy();
  });

  it("returns the unsubscribe; once runs for the first event only", () => {
    const { ctx, step, log, hooks, rt } = setup();
    const off = ctx.events.on("tick", () => void log.push("on"));
    const offOnce = ctx.events.once("tick", () => void log.push("once"));
    hooks.systemAfter = (c) => {
      c.emit({ type: "tick", at });
      c.emit({ type: "tick", at });
    };
    step();
    expect(log.filter((l) => l !== "system afterStep" && l !== "game afterStep")).toEqual([
      "on",
      "once",
      "on",
    ]);
    off();
    off();
    offOnce();
    log.length = 0;
    step();
    expect(log).toEqual(["system afterStep", "game afterStep"]);
    rt.destroy();
  });

  it("a handler unsubscribed by an earlier one misses the event; one subscribed mid-event waits for the next", () => {
    const { ctx, step, log, hooks, rt } = setup();
    let offSecond = () => {};
    ctx.events.on("e", (e) => {
      log.push(`first ${String(e.data)}`);
      offSecond();
      if (e.data === 1) ctx.events.on("e", (later) => void log.push(`late ${String(later.data)}`));
    });
    offSecond = ctx.events.on("e", () => void log.push("second"));
    hooks.systemAfter = (c) => {
      c.emit({ type: "e", at, data: 1 });
      c.emit({ type: "e", at, data: 2 });
    };
    step();
    expect(log.slice(1, -1)).toEqual(["first 1", "first 2", "late 2"]);
    rt.destroy();
  });
});

describe("entity and owner", () => {
  it("entity matches entityId or other, and the children of an instance id", () => {
    const { ctx, step, hooks, rt } = setup();
    const seen: StepEvent[] = [];
    ctx.events.on("hit", (e) => void seen.push(e), { entity: "gate#1" });
    hooks.systemAfter = (c) => {
      c.emit({ type: "hit", at, entityId: "gate#1", data: "self" });
      c.emit({ type: "hit", at, other: "gate#1", data: "other" });
      c.emit({ type: "hit", at, entityId: "gate#1/door", data: "child" });
      c.emit({ type: "hit", at, entityId: "gate#10", data: "a longer id" });
      c.emit({ type: "hit", at, entityId: "gate#2", other: "rock", data: "unrelated" });
      c.emit({ type: "hit", at, data: "no entity" });
    };
    step();
    expect(seen.map((e) => e.data)).toEqual(["self", "other", "child"]);
    rt.destroy();
  });

  it("owner subscriptions end when their owner is destroyed", () => {
    const { ctx, step, log, hooks, rt } = setup([
      { id: "a", type: "dot", at: [0, 0] },
      { id: "b", type: "dot", at: [0, 0] },
    ]);
    ctx.events.on("ping", () => void log.push("owned by a"), { owner: "a" });
    ctx.events.on("ping", () => void log.push("owned by b"), { owner: "b" });
    ctx.events.on(ENTITY_DESTROYED, (e) => void log.push(`a sees ${e.entityId}`), { owner: "a" });
    hooks.systemAfter = (c) => c.emit({ type: "ping", at });
    hooks.gameAfter = (c) => c.destroy("a");
    step();
    expect(log.filter((l) => !l.includes("afterStep"))).toEqual(["owned by a", "owned by b"]);
    log.length = 0;
    hooks.systemAfter = (c) => c.emit({ type: "ping", at });
    hooks.gameAfter = (c) => c.destroy("b");
    step();
    expect(log.filter((l) => !l.includes("afterStep"))).toEqual(["owned by b"]);
    rt.destroy();
  });
});

describe("handler-raised events", () => {
  it("join the same pass, after the events already raised", () => {
    const { ctx, step, log, hooks, rt } = setup();
    ctx.events.on("first", () => {
      log.push("first");
      ctx.emit({ type: "chained", at });
    });
    ctx.events.on("second", () => void log.push("second"));
    ctx.events.on("chained", () => void log.push("chained"));
    hooks.systemAfter = (c) => {
      c.emit({ type: "first", at });
      c.emit({ type: "second", at });
    };
    const result = step();
    expect(log).toEqual(["system afterStep", "first", "second", "chained", "game afterStep"]);
    expect(result.events.map((e) => e.type)).toEqual(["first", "second", "chained"]);
    rt.destroy();
  });

  it("raised at the second point join that pass", () => {
    const { ctx, step, log, hooks, rt } = setup([
      { id: "a", type: "dot", at: [0, 0] },
      { id: "b", type: "dot", at: [0, 0] },
    ]);
    ctx.events.on(ENTITY_DESTROYED, (e) => {
      log.push(`destroyed ${e.entityId}`);
      if (e.entityId === "a") ctx.emit({ type: "after-a", at });
    });
    ctx.events.on("after-a", () => void log.push("after-a"));
    hooks.gameAfter = (c) => {
      c.destroy("a");
      c.destroy("b");
    };
    step();
    expect(log).toEqual(["game afterStep", "destroyed a", "destroyed b", "after-a"]);
    rt.destroy();
  });

  it("a destroy from a second-point handler flushes and delivers in the same tick", () => {
    const { ctx, step, log, hooks, rt } = setup([
      { id: "boss", type: "dot", at: [0, 0] },
      { id: "minion", type: "dot", at: [0, 0] },
      { id: "pet", type: "dot", at: [0, 0] },
    ]);
    ctx.events.on(ENTITY_DESTROYED, (e) => {
      log.push(`destroyed ${e.entityId} at tick ${e.tick}`);
      if (e.entityId === "boss") ctx.destroy("minion");
      if (e.entityId === "minion") ctx.destroy("pet");
    });
    hooks.gameAfter = (c) => {
      c.destroy("boss");
      hooks.gameAfter = null;
    };
    const result = step();
    expect(log).toEqual([
      "game afterStep",
      "destroyed boss at tick 0",
      "destroyed minion at tick 0",
      "destroyed pet at tick 0",
    ]);
    expect(result.events.map((e) => [e.type, e.entityId])).toEqual([
      [ENTITY_DESTROYED, "boss"],
      [ENTITY_DESTROYED, "minion"],
      [ENTITY_DESTROYED, "pet"],
    ]);
    for (const id of ["boss", "minion", "pet"]) expect(ctx.exists(id)).toBe(false);
    expect(rt.stats().entities).toBe(0);
    rt.destroy();
  });
});

describe("the loop guard", () => {
  it("throws event-loop when one pass delivers more than the limit", () => {
    const { ctx, step, hooks, rt } = setup();
    let handled = 0;
    ctx.events.on("echo", () => {
      handled++;
      ctx.emit({ type: "echo", at });
    });
    hooks.systemAfter = (c) => c.emit({ type: "echo", at });
    let caught: unknown;
    try {
      step();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).code).toBe("event-loop");
    expect(handled).toBe(EVENT_PASS_LIMIT);
    rt.destroy();
  });

  it("throws event-loop when second-point handlers keep destroying what they spawn", () => {
    const { ctx, step, hooks, rt } = setup();
    let handled = 0;
    ctx.events.on(ENTITY_DESTROYED, () => {
      handled++;
      ctx.destroy(ctx.spawn({ type: "dot", at: [0, 0] }).id);
    });
    hooks.gameAfter = (c) => {
      c.destroy("a");
      hooks.gameAfter = null;
    };
    let caught: unknown;
    try {
      step();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).code).toBe("event-loop");
    expect(handled).toBe(EVENT_PASS_LIMIT);
    rt.destroy();
  });

  it("counts the second point's deliveries across its flushes as one pass", () => {
    const { ctx, step, hooks, rt } = setup();
    let delivered = 0;
    ctx.events.on("noise", () => void delivered++);
    ctx.events.on(ENTITY_DESTROYED, () => {
      delivered++;
      for (let i = 0; i < 64; i++) ctx.emit({ type: "noise", at });
      ctx.destroy(ctx.spawn({ type: "dot", at: [0, 0] }).id);
    });
    hooks.gameAfter = (c) => {
      c.destroy("a");
      hooks.gameAfter = null;
    };
    let caught: unknown;
    try {
      step();
    } catch (err) {
      caught = err;
    }
    expect((caught as EngineError).code).toBe("event-loop");
    expect(delivered).toBe(EVENT_PASS_LIMIT);
    rt.destroy();
  });

  it("counts deliveries, so a pass of events nobody hears passes", () => {
    const { ctx, step, hooks, rt } = setup();
    let heard = 0;
    ctx.events.on("heard", () => void heard++);
    hooks.systemAfter = (c) => {
      for (let i = 0; i < EVENT_PASS_LIMIT * 2; i++) c.emit({ type: "unheard", at });
      for (let i = 0; i < EVENT_PASS_LIMIT; i++) c.emit({ type: "heard", at });
    };
    expect(step().events).toHaveLength(EVENT_PASS_LIMIT * 3);
    expect(heard).toBe(EVENT_PASS_LIMIT);
    rt.destroy();
  });
});

describe("subscription lifetime", () => {
  it("ends every subscription at unload; onLoad's live for the load", () => {
    const { ctx, step, log, hooks, rt } = setup();
    ctx.events.on("ping", () => void log.push("old"));
    hooks.onLoad = (c) => void c.events.on("ping", () => void log.push("new"));
    expect(rt.load(scene([{ id: "a", type: "dot", at: [0, 0] }])).ok).toBe(true);
    hooks.systemAfter = (c) => c.emit({ type: "ping", at });
    step();
    expect(log.filter((l) => !l.includes("afterStep"))).toEqual(["new"]);
    rt.destroy();
  });

  it("warns in dev about a subscription made before the first load", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = createEventBus({ dev: true });
    bus.on("ping", () => {});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"ping"');
    bus.clear();
    bus.once("ping", () => {});
    expect(warn).toHaveBeenCalledTimes(1);

    createEventBus().on("ping", () => {});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a bus with nothing subscribed passes every event through untouched", () => {
    const bus = createEventBus();
    const raised: StepEvent[] = [
      { tick: 0, type: "a", at },
      { tick: 0, type: "b", at },
    ];
    expect(bus.dispatch(raised, 0)).toBe(2);
    expect(bus.dispatch(raised, 2)).toBe(2);
  });
});
