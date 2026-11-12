// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { createRegistry, defineGame } from "../game/define";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import { formatSaveFile, parseSaveFile, type SaveFile } from "../game/save-file";
import type { EngineContext, GameDefinition, GameRuntime } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { loadHeadless } from "../headless/load";
import { sha256 } from "../project/hash";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave, worldSaveBlockers } from "../runtime/save-state";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { memorySaveStore } from "../saves/store";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SceneParseError } from "../scene/parse";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type SceneDefinition,
} from "../scene/types";
import type { Rng } from "../sim-kit/rng";
import type { GameInstance, InputAction, RapierModule, SceneSource } from "../types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

type VaultSnap = { score: number; rolls: number[]; held: number; pulses: number };

const lamp: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lamp",
  entities: [
    { id: "bulb", type: "marker", at: [0, 0] },
    { id: "wick", type: "marker", at: [0.5, 0] },
  ],
};

/**
 * A physics-free game whose run leans on everything a world save holds: it
 * spawns markers and lamps (counter ids), destroys some and an instance's
 * child, switches markers off and on, sets emit timers (one owned by a
 * marker it disables), draws from `ctx.random` and a fork, attaches a
 * sublevel at load, watches a contact, and scores a held action.
 */
function vaultGame(over: Partial<GameDefinition<VaultSnap>> = {}): GameDefinition<VaultSnap> {
  return defineGame<VaultSnap>({
    id: "vault",
    types: [],
    actions: [{ action: "use", keys: ["e"], description: "Use." }],
    world: { physics: "none" },
    createRuntime(ctx: EngineContext): GameRuntime<VaultSnap> {
      let score = 0;
      let rolls: number[] = [];
      let held = 0;
      let pulses = 0;
      let loot: Rng = ctx.random.fork("loot");
      const markers = () =>
        ctx.query.select({ type: "marker" }).filter((id) => id.includes("#") && !id.includes("/"));
      return {
        onLoad() {
          score = 0;
          rolls = [];
          held = 0;
          pulses = 0;
          loot = ctx.random.fork("loot");
          ctx.timers.every(5, { emit: "pulse", data: { n: 1 } });
          ctx.contacts.watch("slab-a", "slab-b");
          if (ctx.flow.scene !== null) ctx.flow.attach("cellar", { label: "cellar", at: [4, 0] });
        },
        beforeStep() {
          const t = ctx.tick;
          if (ctx.input.held("use")) held++;
          if (t % 7 === 3) ctx.spawn({ type: "marker", at: [ctx.random.below(8), 1] });
          if (t === 20) ctx.destroy("post");
          if (t % 17 === 6) ctx.instantiate("lamp", [ctx.random.below(4), 2]);
          if (t % 17 === 12) {
            const lit = ctx.query.select({ type: "marker" }).find((id) => id.endsWith("/wick"));
            if (lit) ctx.destroy(lit);
          }
          if (t % 11 === 5) {
            const all = markers();
            const id = all[ctx.random.below(Math.max(1, all.length))];
            if (id) {
              ctx.setEnabled(id, !ctx.enabled(id));
              ctx.timers.after(9, { emit: "late", entityId: id, data: { t } }, { owner: id });
            }
            ctx.timers.every(4, { emit: "late", data: { t } }, { times: 3 });
          }
          if (t % 13 === 12) {
            const first = markers()[0];
            if (first) ctx.destroy(first);
          }
          rolls = [...rolls, loot.below(100)].slice(-4);
        },
        afterStep(_dt, events) {
          for (const e of events) {
            if (e.type === "pulse") pulses++;
            if (e.type === "late") score += 3;
            if (e.type === "contact:start") score += 100;
          }
          score += rolls.at(-1) ?? 0;
        },
        snapshot: () => ({ score, rolls: [...rolls], held, pulses }),
        restore(s) {
          score = s.score;
          rolls = [...s.rolls];
          held = s.held;
          pulses = s.pulses;
        },
      };
    },
    ...over,
  });
}

function hall(extra: EntityDef[] = [], physics: "none" | "rapier" = "none"): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "hall",
    game: "vault",
    bounds: [0, 0, 8, 4],
    settings: { physics, gravity: [0, physics === "rapier" ? 9.8 : 0] },
    entities: [
      { id: "start", type: "marker", at: [0.5, 0.5] },
      { id: "post", type: "marker", at: [1.5, 0.5] },
      { id: "slab-a", type: "solid", shape: ["box", 3, 3, 0.5, 0.5] },
      { id: "slab-b", type: "solid", shape: ["box", 3.5, 3, 0.5, 0.5] },
      ...extra,
    ],
  };
}

const cellar: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "cellar",
  game: "vault",
  bounds: [0, 0, 4, 4],
  settings: { physics: "none", gravity: [0, 0] },
  entities: [
    { id: "door", type: "marker", at: [0.5, 0.5] },
    { id: "crate", type: "marker", at: [1.5, 1.5] },
  ],
};

const listed = (def: SceneDefinition): LibraryScene => ({
  def,
  prefabs: new Map([["lamp", lamp]]),
});

function library(over: Partial<Record<string, SceneDefinition>> = {}): SceneLibrary {
  return {
    list: [{ scene: "hall" }, { scene: "two" }, { scene: "cellar", sublevel: true }],
    scenes: new Map<string, LibraryScene>([
      ["hall", listed(over.hall ?? hall())],
      ["two", listed(over.two ?? { ...hall(), name: "two" })],
      ["cellar", listed(cellar)],
    ]),
  };
}

function runtime(game = vaultGame(), lib = library()): SceneRuntimeHandle {
  return createSceneRuntime({
    rapier,
    view: null,
    game,
    scenes: lib,
    prefabs: new Map([["lamp", lamp]]),
  });
}

const use = (pressed: boolean, tick: number): InputAction => ({
  action: "use",
  pressed,
  tick,
  timestamp: 0,
});

/** One tick's input: `use` goes down at tick 2 and up at tick 40, so it is held across an early save. */
function inputAt(tick: number): InputAction[] {
  if (tick === 2) return [use(true, tick)];
  if (tick === 40) return [use(false, tick)];
  return [];
}

/** What a tick shows: its events, the game's snapshot, and every entity's id, flag and pose. */
function frame(rt: SceneRuntimeHandle, result: StepResult): unknown {
  const entities = [...rt.ctx.poses.ids()].sort().map((id) => {
    const p = rt.ctx.poses.get(id)!;
    return [id, rt.ctx.enabled(id), p.x, p.y, p.rot];
  });
  return [result.tick, result.events, result.game, entities];
}

function run(rt: SceneRuntimeHandle, from: number, ticks: number): string {
  const frames: unknown[] = [];
  for (let t = from; t < from + ticks; t++) {
    const result = rt.step(rt.ctx.time.tickMs, inputAt(t));
    frames.push(frame(rt, result));
  }
  return hashText(JSON.stringify(frames));
}

/** The save's canonical text read back, as a store or a fixture gives it. */
function roundTrip(file: SaveFile, game: GameDefinition<VaultSnap>): SaveFile {
  const parsed = parseSaveFile(formatSaveFile(file), game);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.file;
}

const AT = 30;
const MORE = 90;

describe("world saves continue to the same digest", () => {
  it("a run saved at N and continued M digests as a fresh runtime that restored it and ran M", () => {
    const game = vaultGame();
    const a = runtime(game);
    expect(loadListed(a, "hall").ok).toBe(true);
    run(a, 0, AT);
    const captured = captureSave(a, { depth: "world", slot: "s", now: 5 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const digestA = run(a, AT, MORE);
    const finalA = a.snapshot();
    a.destroy();

    const file = roundTrip(captured.file, game);
    const world = file.world!;
    expect(world.tick).toBe(AT);
    expect(world.spawned.map((s) => s.id)).toEqual(["marker#1", "lamp#1", "lamp#2", "marker#4"]);
    expect(world.spawned.find((s) => s.id === "lamp#1")).toMatchObject({
      input: { type: "lamp" },
      instance: { prefab: "lamp" },
    });
    expect(world.destroyed).toEqual(expect.arrayContaining(["post", "lamp#1/wick"]));
    expect(Object.keys(world.enabled).length).toBeGreaterThan(0);
    expect(world.timers.map((t) => t.emit)).toEqual(expect.arrayContaining(["pulse", "late"]));
    expect(world.counters).toMatchObject({ marker: 4, lamp: 2 });
    expect(world.systems["@random"]).toHaveProperty("loot");
    expect(world.systems["@contacts"]).toBeDefined();
    expect(world.systems["@input"]).toEqual({ 0: { actions: { use: [1] } } });
    expect(world.seats).toEqual([{ player: 0, devices: ["keyboard", "pointer", "touch"] }]);
    expect(file.scene.sublevels).toEqual([{ label: "cellar", scene: "cellar", at: [4, 0] }]);

    const b = runtime(game);
    const restored = restoreSave(b, file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(restored.issues).toEqual([]);
    expect(b.ctx.tick).toBe(AT);
    expect(b.ctx.flow.scene).toBe("hall");
    expect(run(b, AT, MORE)).toBe(digestA);
    expect(b.snapshot()).toEqual(finalA);
    b.destroy();
  }, 20_000);

  it("restores outside a step: no event reaches the next tick that the run didn't raise", () => {
    const game = vaultGame();
    const a = runtime(game);
    loadListed(a, "hall");
    run(a, 0, AT);
    const file = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    const next = a.step(a.ctx.time.tickMs, inputAt(AT));
    const b = runtime(game);
    restoreSave(b, file.file);
    expect(b.step(b.ctx.time.tickMs, inputAt(AT)).events).toEqual(next.events);
    a.destroy();
    b.destroy();
  });

  it("a scene changed since the save loads with an info issue", () => {
    const game = vaultGame();
    const a = runtime(game);
    loadListed(a, "hall");
    run(a, 0, 4);
    const file = captureSave(a, { depth: "progress", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    a.destroy();
    const edited = library({ hall: hall([{ id: "extra", type: "marker", at: [6, 1] }]) });
    const b = runtime(game, edited);
    const restored = restoreSave(b, file.file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(restored.issues.map((i) => [i.code, i.severity])).toEqual([["hash-mismatch", "info"]]);
    expect(b.get("extra")).toBeDefined();
    b.destroy();
  });
});

describe("what a save carries across scenes", () => {
  it("meta.playTicks counts every scene played, and a restore seeds it", () => {
    const game = vaultGame();
    const a = runtime(game);
    loadListed(a, "hall");
    run(a, 0, 20);
    loadListed(a, "two");
    run(a, 0, 10);
    const file = captureSave(a, { depth: "progress", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    expect(a.ctx.tick).toBe(10);
    expect(file.file.meta.playTicks).toBe(30);
    a.destroy();

    const b = runtime(game);
    expect(restoreSave(b, roundTrip(file.file, game)).ok).toBe(true);
    run(b, 0, 5);
    const again = captureSave(b, { depth: "progress", slot: "s", now: 0 });
    expect(again.ok ? again.file.meta.playTicks : null).toBe(35);
    b.destroy();
  });

  it("keeps the entry the scene was reached through", () => {
    const game = vaultGame();
    const a = runtime(game);
    loadListed(a, "two", { entry: "start" });
    run(a, 0, 3);
    const file = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    expect(file.file.scene.entry).toBe("start");
    a.destroy();

    const b = runtime(game);
    expect(restoreSave(b, roundTrip(file.file, game)).ok).toBe(true);
    expect(b.ctx.flow.entry).toBe("start");
    b.destroy();
  });

  it("saves every fork of one label and restores them in the order they were made", () => {
    type Pair = { a: number; b: number };
    const game = defineGame<Pair>({
      id: "vault",
      types: [],
      actions: [],
      world: { physics: "none" },
      createRuntime(ctx) {
        let first: Rng = ctx.random.fork("unit");
        let second: Rng = ctx.random.fork("unit");
        let pair: Pair = { a: 0, b: 0 };
        return {
          onLoad() {
            first = ctx.random.fork("unit");
            second = ctx.random.fork("unit");
            pair = { a: 0, b: 0 };
          },
          beforeStep() {
            pair = { a: first.below(1000), b: second.below(1000) + second.below(1000) };
          },
          snapshot: () => ({ ...pair }),
          restore(s) {
            pair = { ...s };
          },
        };
      },
    });
    const a = runtime(game as unknown as GameDefinition<VaultSnap>);
    loadListed(a, "hall");
    run(a, 0, 12);
    const file = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    expect(Object.keys(file.file.world!.systems["@random"] ?? {}).sort()).toEqual([
      "unit",
      "unit#2",
    ]);
    const digestA = run(a, 12, 20);
    a.destroy();

    const b = runtime(game as unknown as GameDefinition<VaultSnap>);
    expect(restoreSave(b, file.file).ok).toBe(true);
    expect(run(b, 12, 20)).toBe(digestA);
    b.destroy();
  });
});

describe("progress saves", () => {
  it("restore a Rapier scene fresh, with the game's data and persist", () => {
    const game = vaultGame({
      world: { physics: "rapier" },
      persist: { initial: () => ({ cleared: [] as string[] }) },
    });
    const lib = library({ hall: hall([], "rapier") });
    const a = runtime(game, lib);
    expect(loadListed(a, "hall").ok).toBe(true);
    a.ctx.persist.set({ cleared: ["level-1"] });
    run(a, 0, 20);
    const saved = a.snapshot();
    const file = captureSave(a, { depth: "progress", slot: "p", now: 9 });
    if (!file.ok) throw new Error(file.issue.message);
    expect(file.file.world).toBeUndefined();
    expect(file.file.meta).toEqual({ scene: "hall", savedAt: 9, playTicks: 20 });
    a.destroy();

    const b = runtime(game, lib);
    const restored = restoreSave(b, roundTrip(file.file, game));
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(b.ctx.tick).toBe(0);
    expect(b.ctx.settings.physics).toBe("rapier");
    expect(b.snapshot()).toEqual(saved);
    expect(b.ctx.persist.value).toEqual({ cleared: ["level-1"] });
    expect(b.ctx.query.select({ type: "marker" }).some((id) => id.includes("#"))).toBe(false);
    b.destroy();
  });
});

describe("world saves refused", () => {
  const causes = (r: ReturnType<typeof captureSave>) =>
    r.ok ? [] : (r.issue.detail as { causes: { cause: string }[] }).causes.map((c) => c.cause);

  it("on Rapier, naming physics and pointing at a progress save", () => {
    const game = vaultGame({ world: { physics: "rapier" } });
    const rt = runtime(game, library({ hall: hall([], "rapier") }));
    loadListed(rt, "hall");
    const r = captureSave(rt, { depth: "world", slot: "s", now: 0 });
    expect(r.ok ? null : [r.issue.code, r.issue.severity]).toEqual(["save-unsupported", "error"]);
    expect(causes(r)).toEqual(["physics"]);
    expect(r.ok ? "" : r.issue.message).toContain("use a progress save");
    expect(captureSave(rt, { depth: "progress", slot: "s", now: 0 }).ok).toBe(true);
    rt.destroy();
  });

  it("with a function timer or a coroutine pending, named by owner", () => {
    const rt = runtime();
    loadListed(rt, "hall");
    rt.ctx.timers.after(50, () => {}, { owner: "post" });
    rt.ctx.timers.start(function* () {
      yield 100;
    });
    const r = captureSave(rt, { depth: "world", slot: "s", now: 0 });
    expect(causes(r)).toEqual(["timer", "coroutine"]);
    expect(r.ok ? [] : r.issue.entityIds).toEqual(["post"]);
    expect(r.ok ? "" : r.issue.message).toContain('owned by "post"');
    expect(worldSaveBlockers(rt).map((b) => b.cause)).toEqual(["timer", "coroutine"]);
    rt.destroy();
  });

  it("for a game without restore", () => {
    const rt = runtime(
      vaultGame({
        createRuntime: () => ({ snapshot: () => ({ score: 0, rolls: [], held: 0, pulses: 0 }) }),
      }),
    );
    loadListed(rt, "hall");
    expect(causes(captureSave(rt, { depth: "world", slot: "s", now: 0 }))).toEqual(["restore"]);
    expect(captureSave(rt, { depth: "progress", slot: "s", now: 0 }).ok).toBe(true);
    rt.destroy();
  });
});

describe("headless", () => {
  it("HeadlessRuntime.save captures, and fromSave starts where it left off", () => {
    const game = vaultGame();
    const flow = library();
    const prefabs = new Map([["lamp", lamp]]);
    const a = createHeadlessRuntime({ game, flow, prefabs });
    expect(loadListed(a, "hall").ok).toBe(true);
    run(a, 0, AT);
    const saved = a.save({ depth: "world", slot: "h", now: 77 });
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(saved.file.meta.savedAt).toBe(77);
    const digestA = run(a, AT, 30);
    a.destroy();

    const b = createHeadlessRuntime({ game, flow, prefabs, fromSave: saved.file });
    expect(b.ctx.tick).toBe(AT);
    expect(run(b, AT, 30)).toBe(digestA);
    b.destroy();
  });

  it("loadHeadless reads fromSave beside the scene, and refuses another scene's", async () => {
    const game = vaultGame();
    const registry = createRegistry(game);
    const a = runtime(game);
    loadListed(a, "hall");
    run(a, 0, 3);
    const file = captureSave(a, { depth: "progress", slot: "h", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    a.destroy();
    const text = formatSaveFile(file.file);
    const loaded = await loadHeadless(
      { registry, files: { scene: hall(), prefabs: [lamp] } },
      { fromSave: text },
    );
    expect(loaded.fromSave?.file).toEqual(file.file);
    expect(loaded.fromSave?.sha256).toBe(await sha256(text));
    const elsewhere = { ...file.file, scene: { ...file.file.scene, id: "two" } };
    await expect(
      loadHeadless({ registry, files: { scene: hall() } }, { fromSave: elsewhere }),
    ).rejects.toBeInstanceOf(SceneParseError);

    const rt = createHeadlessRuntime({
      game,
      registry,
      scene: undefined,
      flow: library(),
      ...(loaded.fromSave ? { fromSave: loaded.fromSave.file } : {}),
    });
    expect(rt.snapshot()).toEqual(file.file.data);
    rt.destroy();
  });

  it("a runtime without a scene list restores the scene it has loaded, and refuses another", () => {
    const game = vaultGame();
    const registry = createRegistry(game);
    const prefabs = new Map([["lamp", lamp]]);
    const make = (def: SceneDefinition) => {
      const rt = createSceneRuntime({ rapier, view: null, game, registry, prefabs });
      expect(rt.load(expandScene(def, registry, { prefabs })).ok).toBe(true);
      return rt;
    };
    const a = make(hall());
    run(a, 0, AT);
    const file = captureSave(a, { depth: "world", slot: "s", now: 0 });
    if (!file.ok) throw new Error(file.issue.message);
    expect(file.file.scene).toMatchObject({ id: "hall", sublevels: [] });
    const digestA = run(a, AT, 30);
    a.destroy();

    const b = make(hall());
    const restored = restoreSave(b, file.file);
    expect(restored.ok).toBe(true);
    expect(run(b, AT, 30)).toBe(digestA);
    b.destroy();

    const other = make({ ...hall(), name: "two" });
    const refused = restoreSave(other, file.file);
    expect(refused.ok ? null : refused.issue.code).toBe("scene-unlisted");
    other.destroy();
  });
});

// ─── The shell ──────────────────────────────────────────

const SHELL_SCENES = library();
const source: SceneSource = {
  list: () => SHELL_SCENES.list,
  start: () => "hall",
  scene: (id) => SHELL_SCENES.scenes.get(id) ?? null,
};

const instances: GameInstance[] = [];
afterEach(() => {
  for (const g of instances.splice(0)) g.destroy();
});

async function shell(game: GameDefinition<VaultSnap>, store = memorySaveStore()) {
  const instance = await createGame(document.createElement("canvas"), {
    game,
    registry: createRegistry(game),
    rapier: async () => {
      throw new Error("no Rapier");
    },
    scene: SHELL_SCENES.scenes.get("hall")!.def,
    prefabs: new Map([["lamp", lamp]]),
    flow: { source },
    saves: store,
  });
  instances.push(instance);
  return instance;
}

describe("the shell's load path", () => {
  it("saves a world in level 2 and a new instance loads it paused, restored, then running on to the same end", async () => {
    const pausedAtRestore: boolean[] = [];
    let current: GameInstance | null = null;
    const base = vaultGame();
    const game = vaultGame({
      createRuntime(ctx) {
        const inner = base.createRuntime(ctx);
        return {
          ...inner,
          restore(s) {
            if (current) pausedAtRestore.push(current.getStore().state.sim.paused);
            inner.restore!(s);
          },
        };
      },
    });
    const store = memorySaveStore();
    const first = await shell(game, store);
    first.start();
    expect((await first.flow.go("two")).ok).toBe(true);
    first.step(AT);
    const saved = await first.saves.save("slot-1", { depth: "world", title: "Two" });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    first.step(40);
    const endA = (first.runtime() as SceneRuntimeHandle).snapshot();
    const tickA = (first.runtime() as SceneRuntimeHandle).ctx.tick;
    first.destroy();

    const second = await shell(game, store);
    current = second;
    second.start();
    const changes: unknown[] = [];
    second.on("flow:change", (e) => changes.push(e));
    const loaded = await second.saves.load("slot-1");
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    expect(pausedAtRestore).toEqual([true]);
    expect(second.getStore().state.sim.paused).toBe(false);
    expect(changes).toMatchObject([{ to: "two", entry: null }]);
    const rt = second.runtime() as SceneRuntimeHandle;
    expect(rt.ctx.flow.scene).toBe("two");
    expect(rt.ctx.tick).toBe(AT);
    second.step(40);
    expect(rt.ctx.tick).toBe(tickA);
    expect(rt.snapshot()).toEqual(endA);
  }, 20_000);

  it("seats a saved pad that isn't connected only once it connects", async () => {
    const game = vaultGame({ input: { players: { max: 2, join: "host" } } });
    const store = memorySaveStore();
    const first = await shell(game, store);
    first.start();
    first.input.assign("keyboard", 0);
    first.input.assign("pad:0", 1);
    first.step(3);
    const rtA = first.runtime() as SceneRuntimeHandle;
    expect(rtA.ctx.input.players()[1]?.devices).toEqual(["pad:0"]);
    expect((await first.saves.save("pads", { depth: "world" })).ok).toBe(true);
    first.destroy();

    const second = await shell(game, store);
    second.start();
    expect((await second.saves.load("pads")).ok).toBe(true);
    const rt = second.runtime() as SceneRuntimeHandle;
    expect(rt.ctx.input.players().map((p) => p.devices)).toEqual([["keyboard"], []]);
    const joined: StepResult["events"] = [];
    second.on("scene:step", (r) =>
      joined.push(...r.events.filter((e) => e.type === "player:joined")),
    );
    second.step(1);
    expect(joined).toEqual([]);
    window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: { index: 0 } }));
    second.step(1);
    expect(joined.map((e) => [e.player, e.data])).toEqual([[1, { device: "pad:0" }]]);
    expect(rt.ctx.input.players()[1]?.devices).toEqual(["pad:0"]);
  });

  it("refuses a save whose persist the game's schema rejects, outside dev too", async () => {
    const store = memorySaveStore();
    const game = vaultGame({
      persist: {
        initial: () => ({ cleared: [] }),
        schema: z.strictObject({ cleared: z.array(z.string()) }),
      },
    });
    const first = await shell(game, store);
    first.start();
    first.step(3);
    expect((await first.saves.save("ok")).ok).toBe(true);
    const parsed = parseSaveFile((await store.read("vault", "ok"))!);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const bad = { ...parsed.file, persist: { cleared: 7 } } as SaveFile;
    await store.write("vault", "bad", formatSaveFile(bad));

    const before = first.runtime();
    const loaded = await first.saves.load("bad");
    expect(loaded.ok ? null : [loaded.issue.code, loaded.issue.path]).toEqual([
      "schema",
      "/persist",
    ]);
    expect(loaded.ok ? "" : loaded.issue.message).toContain("persist schema");
    expect(first.runtime()).toBe(before);
    expect((first.runtime() as SceneRuntimeHandle).ctx.persist.value).toEqual({ cleared: [] });
    expect((await first.saves.load("ok")).ok).toBe(true);
  });

  it("refuses a save holding a persistent value for a game that declares none", async () => {
    const store = memorySaveStore();
    const game = vaultGame();
    const first = await shell(game, store);
    first.start();
    first.step(3);
    expect((await first.saves.save("ok")).ok).toBe(true);
    const parsed = parseSaveFile((await store.read("vault", "ok"))!);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.file.persist).toBeNull();
    await store.write("vault", "bad", formatSaveFile({ ...parsed.file, persist: { cleared: [] } }));

    const before = first.runtime();
    const loaded = await first.saves.load("bad");
    expect(loaded.ok ? null : [loaded.issue.code, loaded.issue.path]).toEqual([
      "schema",
      "/persist",
    ]);
    expect(loaded.ok ? "" : loaded.issue.message).toContain('"vault" declares no persist');
    expect(first.runtime()).toBe(before);
    expect((first.runtime() as SceneRuntimeHandle).ctx.persist.value).toBeNull();
    expect((await first.saves.load("ok")).ok).toBe(true);
  });

  it("keeps the scene it had when the save can't be restored", async () => {
    const store = memorySaveStore();
    const game = vaultGame();
    const instance = await shell(game, store);
    instance.start();
    const broken: SaveFile = {
      kind: "save",
      v: 1,
      game: "vault",
      gameVersion: 1,
      engine: "0.13.0",
      release: null,
      project: null,
      slot: "bad",
      meta: { scene: "two", savedAt: 0, playTicks: 0 },
      depth: "world",
      persist: null,
      scene: { id: "two", runHash: "", sublevels: [{ label: "x", scene: "nowhere", at: [0, 0] }] },
      data: { score: 0, rolls: [], held: 0, pulses: 0 },
      world: {
        tick: 3,
        counters: {},
        random: [1, 2, 3, 4],
        timers: [],
        enabled: {},
        destroyed: [],
        spawned: [],
        poses: {},
        systems: {},
        seats: [],
      },
    };
    await store.write("vault", "bad", formatSaveFile(broken));
    const before = instance.runtime();
    const loaded = await instance.saves.load("bad");
    expect(loaded.ok).toBe(false);
    expect(instance.runtime()).toBe(before);
    expect(instance.getStore().state.sim.paused).toBe(false);
  });
});
