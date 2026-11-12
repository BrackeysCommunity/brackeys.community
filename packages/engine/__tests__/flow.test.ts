import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { defineGame } from "../game/define";
import type { FlowRequest, LibraryScene, SceneLibrary } from "../game/flow";
import type { GameDefinition, JsonValue } from "../game/types";
import { applyFlowRequest, flowLoaderOf, loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { ENTITY_DESTROYED } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../scene/types";

type Loaded = { name: string; scene: string | null; entry: string | null; persist: JsonValue };
type Trip = { trips: number };

const GO = "go";
const TWICE = "twice";
const LEAVE = "leave";

/**
 * A physics-free game driven by commands: `go` requests a scene, `twice`
 * requests two in one tick, `leave` destroys the crate and requests in the
 * same tick. Each load is logged with what flow told it.
 */
function flowGame(log: Loaded[]): GameDefinition<{ ticks: number }> {
  const request = z.strictObject({
    to: z.string().describe("The scene."),
    entry: z.string().optional().describe("Where to arrive."),
  });
  return defineGame<{ ticks: number }>({
    id: "flowy",
    types: [],
    actions: [{ action: "jump", keys: [" "], description: "Jump." }],
    world: { physics: "none" },
    persist: {
      initial: () => ({ trips: 0 }),
      schema: z.strictObject({ trips: z.number().int().min(0) }),
    },
    commands: {
      [GO]: { description: "Requests a scene.", args: request },
      [TWICE]: {
        description: "Requests two scenes in one tick.",
        args: z.strictObject({
          first: z.string().describe("Requested first."),
          second: z.string().describe("Requested second."),
        }),
      },
      [LEAVE]: { description: "Destroys the crate and requests a scene.", args: request },
    },
    createRuntime(ctx) {
      let ticks = 0;
      let leaving: FlowRequest | null = null;
      return {
        onLoad(scene) {
          ticks = 0;
          log.push({
            name: scene.name,
            scene: ctx.flow.scene,
            entry: ctx.flow.entry,
            persist: ctx.persist.value,
          });
        },
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) {
            const args = c.args as Record<string, string>;
            if (c.name === GO) {
              const trips = (ctx.persist.value as Trip).trips + 1;
              ctx.flow.request({
                to: args.to!,
                ...(args.entry ? { entry: args.entry } : {}),
                persist: { trips },
              });
            }
            if (c.name === TWICE) {
              ctx.flow.request({ to: args.first! });
              ctx.flow.request({ to: args.second! });
            }
            if (c.name === LEAVE) leaving = { to: args.to! };
          }
        },
        afterStep() {
          ticks++;
          if (leaving) {
            ctx.destroy("crate");
            ctx.flow.request(leaving);
            leaving = null;
          }
        },
        snapshot: () => ({ ticks }),
      };
    },
  });
}

const scene = (name: string, extra: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "flowy",
  bounds: [0, 0, 10, 10],
  entities: [
    { id: "start", type: "marker", at: [1, 1], tags: ["spawn"] },
    { id: "crate", type: "marker", at: [2, 1] },
    { id: "door", type: "marker", at: [8, 1] },
  ],
  ...extra,
});

const lamp: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lamp",
  entities: [{ id: "bulb", type: "marker", at: [0, 0] }],
};

function library(over: Partial<Record<string, LibraryScene>> = {}): SceneLibrary {
  const scenes = new Map<string, LibraryScene>([
    ["menu", { def: scene("menu"), prefabs: new Map() }],
    [
      "level",
      {
        def: scene("level", { instances: [{ id: "lamp-1", prefab: "lamp", at: [5, 5] }] }),
        prefabs: new Map([["lamp", lamp]]),
      },
    ],
    ["cellar", { def: scene("cellar"), prefabs: new Map() }],
    ["heavy", { def: scene("heavy", { settings: { physics: "rapier" } }), prefabs: new Map() }],
  ]);
  for (const [id, s] of Object.entries(over)) if (s) scenes.set(id, s);
  return {
    list: [
      { scene: "menu", title: "Menu" },
      { scene: "level", title: "Level 1" },
      { scene: "cellar", sublevel: true },
      { scene: "heavy" },
      { scene: "ghost" },
    ],
    scenes,
  };
}

/** A viewless runtime given a scene library, as hosts build one. */
const runtimeWith = (
  game: GameDefinition<{ ticks: number }>,
  scenes: () => SceneLibrary,
  dev = false,
): SceneRuntimeHandle => createSceneRuntime({ rapier: null, view: null, game, dev, scenes });

function setup(opts: { dev?: boolean } = {}) {
  const log: Loaded[] = [];
  const game = flowGame(log);
  const lib = library();
  return { log, game, lib, rt: runtimeWith(game, () => lib, opts.dev) };
}

const step = (rt: SceneRuntimeHandle, commands: { name: string; args: unknown }[] = []) =>
  rt.step(rt.ctx.time.tickMs, [], commands as never);

/** Steps once and applies the tick's flow request, as a host does after the tick. */
function tickThenApply(
  rt: SceneRuntimeHandle,
  commands: { name: string; args: unknown }[] = [],
): StepResult {
  const result = step(rt, commands);
  const { flow } = rt.takeRequests();
  if (flow) {
    const applied = applyFlowRequest(rt, flow);
    if (!applied.ok) throw new Error(applied.issue.message);
  }
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe("flow requests", () => {
  it("keeps the first request in a tick and drops later ones with a dev warning", () => {
    const { rt } = setup({ dev: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadListed(rt, "menu").ok).toBe(true);
    step(rt, [{ name: TWICE, args: { first: "level", second: "menu" } }]);
    expect(rt.takeRequests().flow).toEqual({ to: "level" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      'dropped the request for "menu": "level" was requested first',
    );
    expect(rt.takeRequests().flow).toBeNull();
    rt.destroy();
  });

  it("drops later requests without a warning outside dev", () => {
    const { rt } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadListed(rt, "menu");
    step(rt, [{ name: TWICE, args: { first: "level", second: "menu" } }]);
    expect(rt.takeRequests().flow).toEqual({ to: "level" });
    expect(warn).not.toHaveBeenCalled();
    rt.destroy();
  });

  it("warns in dev when a request names a scene flow will refuse", () => {
    const { rt } = setup({ dev: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadListed(rt, "menu");
    step(rt, [{ name: GO, args: { to: "nowhere" } }]);
    expect(String(warn.mock.calls[0]![0])).toContain("will be refused");
    const { flow } = rt.takeRequests();
    const applied = applyFlowRequest(rt, flow!);
    expect(applied.ok).toBe(false);
    if (!applied.ok)
      expect(applied.issue).toMatchObject({ code: "scene-unlisted", severity: "error" });
    expect(rt.ctx.flow.scene).toBe("menu");
    rt.destroy();
  });

  it("applies a request after the tick, once its destroy flush ran", () => {
    const { rt, log } = setup();
    loadListed(rt, "menu");
    const result = step(rt, [{ name: LEAVE, args: { to: "level" } }]);
    // The tick finished in the old scene: the crate's destroy flushed and was reported.
    expect(result.events.filter((e) => e.type === ENTITY_DESTROYED).map((e) => e.entityId)).toEqual(
      ["crate"],
    );
    expect(rt.ctx.flow.scene).toBe("menu");
    expect(rt.get("crate")).toBeUndefined();
    expect(log.map((l) => l.name)).toEqual(["menu"]);

    const { flow } = rt.takeRequests();
    expect(applyFlowRequest(rt, flow!)).toMatchObject({ ok: true, scene: "level" });
    expect(rt.ctx.flow.scene).toBe("level");
    expect(rt.get("crate")).toBeDefined();
    expect(rt.ctx.tick).toBe(0);
    rt.destroy();
  });

  it("refuses to load inside a step", () => {
    const log: Loaded[] = [];
    const base = flowGame(log);
    let handle: SceneRuntimeHandle | null = null;
    let thrown: unknown = null;
    const game = defineGame<{ ticks: number }>({
      ...base,
      createRuntime(ctx) {
        const inner = base.createRuntime(ctx);
        return {
          ...inner,
          afterStep(dt, events) {
            try {
              loadListed(handle!, "level");
            } catch (err) {
              thrown = err;
            }
            inner.afterStep?.(dt, events);
          },
        };
      },
    });
    const lib = library();
    handle = runtimeWith(game, () => lib, false);
    loadListed(handle, "menu");
    step(handle);
    expect(String(thrown)).toContain("between ticks");
    expect(handle.ctx.flow.scene).toBe("menu");
    handle.destroy();
  });
});

describe("loading from the library", () => {
  it("gives onLoad the request's entry and its persist", () => {
    const { rt, log } = setup();
    loadListed(rt, "menu");
    tickThenApply(rt, [{ name: GO, args: { to: "level", entry: "door" } }]);
    expect(log.at(-1)).toEqual({
      name: "level",
      scene: "level",
      entry: "door",
      persist: { trips: 1 },
    });
    tickThenApply(rt, [{ name: GO, args: { to: "menu" } }]);
    expect(log.at(-1)).toEqual({ name: "menu", scene: "menu", entry: null, persist: { trips: 2 } });
    rt.destroy();
  });

  it("follows each load in ctx.flow.scene, and a plain load is outside flow", () => {
    const { rt, lib } = setup();
    expect(rt.ctx.flow.scene).toBeNull();
    loadListed(rt, "menu");
    expect(rt.ctx.flow.scene).toBe("menu");
    tickThenApply(rt, [{ name: GO, args: { to: "level", entry: "door" } }]);
    expect([rt.ctx.flow.scene, rt.ctx.flow.entry]).toEqual(["level", "door"]);
    tickThenApply(rt, [{ name: GO, args: { to: "menu" } }]);
    expect([rt.ctx.flow.scene, rt.ctx.flow.entry]).toEqual(["menu", null]);

    const plain = expandScene(lib.scenes.get("level")!.def, rt.ctx.registry);
    expect(rt.load(plain).ok).toBe(true);
    expect([rt.ctx.flow.scene, rt.ctx.flow.entry]).toEqual([null, null]);
    rt.unload();
    expect(rt.ctx.flow.scene).toBeNull();
    rt.destroy();
  });

  it("expands the listed scene with its own prefabs", () => {
    const { rt } = setup();
    expect(loadListed(rt, "level").ok).toBe(true);
    expect(rt.get("lamp-1/bulb")).toBeDefined();
    rt.destroy();
  });

  it("refuses unlisted scenes, sublevels and listed scenes without text through the one rule", () => {
    const { rt } = setup();
    loadListed(rt, "menu");
    const unlisted = loadListed(rt, "attic");
    const sublevel = loadListed(rt, "cellar");
    const missing = loadListed(rt, "ghost");
    expect(unlisted).toMatchObject({
      ok: false,
      issue: { code: "scene-unlisted", severity: "error" },
    });
    expect(sublevel).toMatchObject({
      ok: false,
      issue: { code: "scene-unlisted", severity: "error" },
    });
    expect(missing).toMatchObject({ ok: false, issue: { code: "asset-missing" } });
    expect(rt.ctx.flow.scene).toBe("menu");
    rt.destroy();
  });

  it("refuses a flow load without a scene list", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: flowGame([]) });
    expect(loadListed(rt, "menu")).toMatchObject({
      ok: false,
      issue: { code: "scene-unlisted", severity: "error" },
    });
    rt.destroy();
  });

  it("puts persist back when the load itself is refused", () => {
    const { rt } = setup();
    loadListed(rt, "menu");
    const refused = loadListed(rt, "heavy", { persist: { trips: 9 } });
    expect(refused).toMatchObject({
      ok: false,
      issue: { code: "physics-required" },
      report: { reason: "physics-not-loaded" },
    });
    expect(rt.ctx.persist.value).toEqual({ trips: 0 });
    expect(rt.ctx.flow.scene).toBe("menu");
    rt.destroy();
  });

  it("reads the library at each load and keeps it for the run", () => {
    let lib = library();
    const log: Loaded[] = [];
    const rt = runtimeWith(flowGame(log), () => lib, false);
    loadListed(rt, "menu");
    lib = {
      list: [...lib.list, { scene: "annex" }],
      scenes: new Map([...lib.scenes, ["annex", { def: scene("annex"), prefabs: new Map() }]]),
    };
    expect(loadListed(rt, "annex")).toMatchObject({ ok: true, scene: "annex" });
    const run = flowLoaderOf(rt.ctx)!.current()!;
    (lib.list as { scene: string }[]).length = 0;
    (lib.scenes as Map<string, LibraryScene>).clear();
    expect(run.list.map((e) => e.scene)).toContain("annex");
    expect(run.scenes.has("annex")).toBe(true);
    expect(Object.isFrozen(run.list)).toBe(true);
    expect(rt.ctx.flow.scene).toBe("annex");
    rt.destroy();
  });

  it("runs a multi-scene command stream the same way every time", () => {
    const run = () => {
      const { rt, log } = setup();
      loadListed(rt, "menu");
      const plan: Record<number, { name: string; args: unknown }[]> = {
        2: [{ name: GO, args: { to: "level", entry: "door" } }],
        5: [{ name: LEAVE, args: { to: "menu" } }],
        7: [{ name: GO, args: { to: "level" } }],
      };
      const results: unknown[] = [];
      for (let t = 0; t < 10; t++) {
        results.push({ scene: rt.ctx.flow.scene, ...tickThenApply(rt, plan[t]) });
      }
      rt.destroy();
      return { results, log };
    };
    const a = run();
    expect(JSON.stringify(run())).toBe(JSON.stringify(a));
    expect(a.log.map((l) => l.name)).toEqual(["menu", "level", "menu", "level"]);
  });
});
