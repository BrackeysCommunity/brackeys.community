// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { createRegistry, defineGame } from "../game/define";
import { EngineError, type GameDefinition, type JsonValue } from "../game/types";
import { createHeadlessRuntime, runProbe } from "../headless/headless";
import { runPlaytest } from "../headless/playtest";
import { createPersistCell, gamePersistCell, plainJsonProblem } from "../runtime/persist";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

type Vault = { coins: number; visited: string[] };
const SPOIL = "spoil";

/** A physics-free game counting a coin a tick and the scenes it loaded, in `ctx.persist`. */
function vaultGame(initialCoins = 0): GameDefinition<{ ticks: number }> {
  return defineGame<{ ticks: number }>({
    id: "vault",
    types: [],
    actions: [{ action: "go", keys: [" "], description: "Go." }],
    world: { physics: "none" },
    persist: {
      initial: () => ({ coins: initialCoins, visited: [] }),
      schema: z.strictObject({ coins: z.number().int().min(0), visited: z.array(z.string()) }),
    },
    commands: {
      [SPOIL]: {
        description: "Sets a value the schema refuses, or one that isn't plain JSON.",
        args: z.strictObject({ how: z.enum(["schema", "json"]).describe("Which check fails.") }),
      },
    },
    play: {
      results: ["rich"],
      outcome: ({ persist }) =>
        ((persist as Vault | undefined)?.coins ?? 0) >= 40 ? { result: "rich" } : null,
    },
    createRuntime(ctx) {
      let ticks = 0;
      const vault = () => ctx.persist.value as Vault;
      return {
        onLoad(scene) {
          ticks = 0;
          ctx.persist.set({ ...vault(), visited: [...vault().visited, scene.name] });
        },
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) {
            if (c.name !== SPOIL) continue;
            const how = (c.args as { how: string }).how;
            ctx.persist.set(
              how === "schema" ? { coins: -1, visited: [] } : { coins: NaN, visited: [] },
            );
          }
        },
        afterStep() {
          ticks++;
          ctx.persist.set({ ...vault(), coins: vault().coins + 1 });
        },
        snapshot: () => ({ ticks }),
      };
    },
  });
}

const vault = vaultGame();
const registry = createRegistry(vault);

const scene = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "vault",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
});

const step = (rt: SceneRuntimeHandle, n: number) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("PersistCell", () => {
  it("holds one deep-frozen copy, the same object until set", () => {
    const cell = createPersistCell(() => ({ a: { b: [1, 2] } }), { check: true });
    const first = cell.value;
    expect(cell.value).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    const inner = (first as { a: { b: number[] } }).a;
    expect(Object.isFrozen(inner) && Object.isFrozen(inner.b)).toBe(true);
    expect(() => inner.b.push(3)).toThrow(TypeError);

    const next = { a: { b: [3] } };
    cell.set(next);
    expect(cell.value).not.toBe(first);
    expect(cell.value).toEqual(next);
    expect(Object.isFrozen(next)).toBe(false);
    next.a.b.push(4);
    expect(cell.value).toEqual({ a: { b: [3] } });
  });

  it("reset goes back to a fresh initial()", () => {
    let calls = 0;
    const cell = createPersistCell(() => ({ n: ++calls }));
    expect(cell.value).toEqual({ n: 1 });
    cell.set({ n: 99 });
    cell.reset();
    expect(cell.value).toEqual({ n: 2 });
  });

  it("checks plain JSON and the schema when checking, and trusts the value when not", () => {
    const schema = z.strictObject({ n: z.number().min(0) });
    const checked = createPersistCell(() => ({ n: 0 }), { check: true, schema });
    expect(() => checked.set({ n: -1 })).toThrow(/persist schema: n: /);
    const err = (() => {
      try {
        checked.set({ n: Infinity });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("schema");
    expect((err as Error).message).toMatch(/isn't plain JSON: \/n: Infinity/);
    expect(checked.value).toEqual({ n: 0 });

    const trusted = createPersistCell(() => ({ n: 0 }), { schema });
    trusted.set({ n: -1 });
    expect(trusted.value).toEqual({ n: -1 });
  });

  it("names where a value stops being plain JSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(plainJsonProblem({ a: [1, { b: "x" }], c: null, d: true })).toBeNull();
    expect(plainJsonProblem({ a: [1, undefined] })).toMatch(/^\/a\/1: /);
    expect(plainJsonProblem({ "a/b": { c: undefined } })).toMatch(/^\/a~1b\/c: undefined/);
    expect(plainJsonProblem({ when: new Date(0) })).toMatch(/^\/when: a Date instance/);
    expect(plainJsonProblem({ f: () => 1 })).toMatch(/^\/f: a function/);
    expect(plainJsonProblem(cyclic)).toMatch(/^\/self: a cycle/);
    const holey: number[] = [];
    holey[1] = 1;
    expect(plainJsonProblem(holey)).toMatch(/^\/0: a hole/);
    const shared = { x: 1 };
    expect(plainJsonProblem({ a: shared, b: shared })).toBeNull();
  });

  it("is null for a game that declares no persist", () => {
    expect(gamePersistCell(null, true).value).toBeNull();
    expect(gamePersistCell({ ...vault, persist: undefined }, true).value).toBeNull();
  });
});

describe("persistent state headless", () => {
  it("survives every load of one runtime, and runtimes sharing a cell", () => {
    const rt = createHeadlessRuntime({ registry, scene: expandScene(scene("one"), registry) });
    step(rt, 3);
    expect(rt.ctx.persist.value).toEqual({ coins: 3, visited: ["one"] });
    expect(rt.load(expandScene(scene("two"), registry)).ok).toBe(true);
    step(rt, 2);
    expect(rt.ctx.persist.value).toEqual({ coins: 5, visited: ["one", "two"] });
    rt.destroy();

    const shared = gamePersistCell(vault, true);
    const a = createHeadlessRuntime({
      registry,
      scene: expandScene(scene("a"), registry),
      persist: shared,
    });
    step(a, 4);
    a.destroy();
    const b = createHeadlessRuntime({
      registry,
      scene: expandScene(scene("b"), registry),
      persist: shared,
    });
    expect(b.ctx.persist.value).toEqual({ coins: 4, visited: ["a", "b"] });
    b.destroy();
  });

  it("checks what the game sets, dev or not", () => {
    const rt = createHeadlessRuntime({ registry, scene: expandScene(scene("one"), registry) });
    expect(() =>
      rt.step(rt.ctx.time.tickMs, [], [{ name: SPOIL, args: { how: "schema" } }]),
    ).toThrow(/doesn't match the game's persist schema: coins: /);
    rt.destroy();

    const run = runPlaytest({
      registry,
      scene: scene("one"),
      script: {
        v: 2,
        steps: [{ wait: 2 }, { command: SPOIL, args: { how: "json" } }, { wait: 2 }],
      },
    });
    expect(run.blocked).toBe(true);
    expect(run.blocked && run.issues.at(-1)).toMatchObject({
      code: "schema",
      message: expect.stringMatching(/isn't plain JSON: \/coins: NaN/),
    });
  });

  it("is in PlayState: the game's outcome reads it", () => {
    const probe = runProbe({ registry, scene: expandScene(scene("one"), registry), ticks: 60 });
    expect(probe.outcome).toEqual({ result: "rich", tick: 39 });
  });

  it("ends a playtest step on an until persist predicate", () => {
    const at = (until: Record<string, unknown>) => {
      const run = runPlaytest({
        registry,
        scene: scene("hall"),
        script: { v: 2, steps: [{ hold: [], until, max: 30 }] },
      });
      if (run.blocked) throw new Error(JSON.stringify(run));
      return run;
    };
    const gte = at({ persist: { pointer: "/coins", gte: 5 } });
    expect(gte.outcome).toMatchObject({ result: "script-end", tick: 4 });
    expect(gte.steps).toEqual([expect.objectContaining({ end: "until", ticks: 5 })]);
    expect(at({ persist: { pointer: "/visited/0", eq: "hall" } }).outcome.tick).toBe(0);
    expect(at({ persist: { pointer: "", eq: { visited: ["hall"], coins: 3 } } }).outcome.tick).toBe(
      2,
    );
    expect(at({ persist: { pointer: "/coins", gte: 3, lte: 2 } }).steps[0]).toMatchObject({
      end: "max",
    });
    expect(at({ persist: { pointer: "/visited", gte: 0 } }).steps[0]).toMatchObject({ end: "max" });
    expect(at({ persist: { pointer: "/nothing", eq: null } }).steps[0]).toMatchObject({
      end: "max",
    });
  });

  it("is in no digest by itself", () => {
    const end = (game: GameDefinition) => {
      const run = runPlaytest({
        game,
        scene: scene("one"),
        script: { v: 2, steps: [{ wait: 10 }] },
      });
      if (run.blocked) throw new Error(JSON.stringify(run));
      return run.recording.end;
    };
    expect(end(vaultGame(0))).toBe(end(vaultGame(7)));
  });
});

describe("persistent state in the shell", () => {
  async function shell(dev: boolean) {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    return createGame(canvas, {
      game: vault,
      registry,
      rapier: async () => {
        throw new Error("no Rapier");
      },
      dev,
      scene: scene("one"),
    });
  }
  const valueOf = (rt: unknown) => (rt as SceneRuntimeHandle).ctx.persist.value as JsonValue;

  it("survives loadScene and Play-from-here", async () => {
    const game = await shell(true);
    try {
      game.start();
      game.step(3);
      expect(valueOf(game.runtime())).toEqual({ coins: 3, visited: ["one"] });
      expect(game.loadScene(scene("two")).ok).toBe(true);
      game.step(2);
      expect(valueOf(game.runtime())).toEqual({ coins: 5, visited: ["one", "two"] });
      expect(game.play(scene("three")).ok).toBe(true);
      game.step(1);
      expect(valueOf(game.runtime())).toEqual({ coins: 6, visited: ["one", "two", "three"] });
      expect(Object.isFrozen(valueOf(game.runtime()))).toBe(true);
    } finally {
      game.destroy();
    }
  });

  it("checks set in dev and trusts it in production", async () => {
    const dev = await shell(true);
    try {
      dev.start();
      const rt = dev.runtime() as SceneRuntimeHandle;
      expect(() => rt.ctx.persist.set({ coins: -1, visited: [] })).toThrow(/persist schema/);
    } finally {
      dev.destroy();
    }
    const prod = await shell(false);
    try {
      prod.start();
      const rt = prod.runtime() as SceneRuntimeHandle;
      rt.ctx.persist.set({ coins: -1, visited: [] });
      expect(rt.ctx.persist.value).toEqual({ coins: -1, visited: [] });
    } finally {
      prod.destroy();
    }
  });
});
