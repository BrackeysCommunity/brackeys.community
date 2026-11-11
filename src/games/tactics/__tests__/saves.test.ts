// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  formatSaveFile,
  parseSaveFile,
  type EngineContext,
  type GameCommand,
  type GameDefinition,
  type LibraryScene,
  type SaveFile,
  type SceneLibrary,
} from "@jams/engine/game";
import {
  createHeadlessRuntime,
  loadHeadless,
  memorySaveStore,
  runPlaytest,
  type InputScriptV2,
} from "@jams/engine/headless";
import { sceneListFlow } from "@jams/engine/project";
import {
  createRegistry,
  expandScene,
  hashText,
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type Prefab,
} from "@jams/engine/scene";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { TACTICS_AUTOSAVE_SLOT, tacticsBoard, tacticsGame, type TacticsRunSnapshot } from "..";
import { legal } from "../rules";
import sceneList from "../scene-list.json";
import { tacticsProjectView } from "./pins";

// The board has no physics: no run here may initialise Rapier.
const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

afterAll(() => {
  expect(init).not.toHaveBeenCalled();
});

/**
 * Level 2's saves, headless over a memory store: a world save taken at a
 * turn start (or mid-walk, or while the red side acts) and restored in a
 * fresh runtime plays on exactly as the run that took it, and the
 * autosave the game asks for at each turn start never changes the run.
 */

const here = (path: string) => new URL(path, import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(here(path), "utf8"));
const FIXTURE = here("./fixtures/level-2.save.json");
const REPO = fileURLToPath(here("../../../../"));

const registry = createRegistry(tacticsGame);
const prefabs = prefabLibrary(
  ["../scenes/prefabs/knight.json", "../scenes/prefabs/archer.json"].map((path): Prefab => {
    const parsed = parsePrefab(json(path), registry);
    if (!parsed.ok) throw new Error(`${path} doesn't parse`);
    return parsed.prefab;
  }),
);

function library(): SceneLibrary {
  const { scenes: list } = sceneListFlow(sceneList);
  const scenes = new Map<string, LibraryScene>(
    list.map(({ scene }) => [
      scene,
      { def: parseSceneOrThrow(json(`../scenes/${scene}.json`), registry), prefabs },
    ]),
  );
  return { list, scenes };
}

const level2 = () =>
  expandScene(parseSceneOrThrow(json("../scenes/level-2.json"), registry), registry, { prefabs });

const KNIGHT = "blue-knight-2/unit";
const STAIR: [number, number] = [3, 5];
const STAIR_TURN = 2;

/**
 * Blue's orders for this tick, read from the snapshot alone so every run
 * gives the same ones: on turn 2 a knight takes the stair, opening the
 * cellar; otherwise the first legal attack, else the turn ends. Blue
 * holds out to turn 7.
 */
function blueOrders(s: TacticsRunSnapshot): GameCommand[] {
  if (s.screen || s.next || s.result !== null || s.side !== "blue" || s.phase !== "orders")
    return [];
  if (s.turn === STAIR_TURN && s.units[KNIGHT] && !s.units[KNIGHT].moved)
    return [{ name: "move", args: { unit: KNIGHT, to: STAIR } }];
  const attack = legal(s, s.classes, tacticsBoard(s.grid)).find((c) => c.name === "attack");
  return [attack ?? { name: "end-turn" }];
}

type Run = { rt: ReturnType<typeof createHeadlessRuntime>; frames: unknown[] };

/** One tick with blue's orders; the frame holds its tick, events, snapshot and every pose. */
function tick(run: Run): TacticsRunSnapshot {
  const { rt } = run;
  const commands = blueOrders(rt.snapshot() as TacticsRunSnapshot);
  const result = rt.step(rt.ctx.time.tickMs, [], commands);
  const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
    const p = rt.ctx.poses.get(id)!;
    return [id, p.x, p.y, p.rot];
  });
  run.frames.push([result.tick, result.events, result.game, poses]);
  return rt.snapshot() as TacticsRunSnapshot;
}

/** Ticks until `stop` holds of the snapshot, at most `max`. */
function until(run: Run, stop: (s: TacticsRunSnapshot) => boolean, max = 4000): void {
  for (let i = 0; i < max; i++) if (stop(tick(run))) return;
  throw new Error(`no stop within ${max} ticks: ${JSON.stringify(run.rt.snapshot())}`);
}

const turnStart = (turn: number) => (s: TacticsRunSnapshot) =>
  s.turn === turn && s.side === "blue" && s.phase === "orders";

const digest = (frames: readonly unknown[]) => hashText(JSON.stringify(frames));

function start(game: GameDefinition<TacticsRunSnapshot> = tacticsGame, fromSave?: SaveFile): Run {
  const rt = createHeadlessRuntime({
    game,
    registry: createRegistry(game),
    project: tacticsProjectView(),
    prefabs,
    flow: library(),
    ...(fromSave ? { fromSave } : { scene: level2() }),
  });
  return { rt, frames: [] };
}

/** The save as a memory store keeps it: written as text, read back and parsed. */
async function throughStore(file: SaveFile): Promise<SaveFile> {
  const store = memorySaveStore();
  const written = await store.write("tactics", file.slot, formatSaveFile(file));
  expect(written.ok).toBe(true);
  const text = await store.read("tactics", file.slot);
  const parsed = parseSaveFile(text!, tacticsGame);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.file;
}

/** The uninterrupted run from turn 4's start to turn 7's: its save, its frames after it, and its length. */
async function uninterrupted() {
  const run = start();
  until(run, turnStart(4));
  const saved = run.rt.save({ depth: "world", slot: "slot-1", now: 1762531200000 });
  if (!saved.ok) throw new Error(saved.issue.message);
  const at = run.rt.ctx.tick;
  run.frames = [];
  until(run, turnStart(7));
  const ticks = run.rt.ctx.tick - at;
  const final = run.rt.snapshot() as TacticsRunSnapshot;
  run.rt.destroy();
  return { file: await throughStore(saved.file), frames: run.frames, ticks, final };
}

describe("level 2's world saves", () => {
  it("restores turn 4's save in a fresh runtime, which digests as the run that took it 3 turns on", async () => {
    const a = await uninterrupted();
    expect(a.file).toMatchObject({ game: "tactics", gameVersion: 1, depth: "world" });
    expect(a.file.scene).toMatchObject({
      id: "level-2",
      sublevels: [{ label: "cellar", scene: "cellar" }],
    });
    expect(a.file.data).toMatchObject({ turn: 4, side: "blue", phase: "orders", result: null });
    expect(a.final).toMatchObject({ turn: 7, result: null });
    expect(Object.keys(a.final.units)).toContain("cellar:guard/unit");

    const b = start(tacticsGame, a.file);
    expect(b.rt.ctx.tick).toBe(a.file.world!.tick);
    expect(b.rt.snapshot()).toEqual(a.file.data);
    for (let i = 0; i < a.ticks; i++) tick(b);
    expect(b.rt.snapshot()).toEqual(a.final);
    expect(digest(b.frames)).toBe(digest(a.frames));
    b.rt.destroy();
  });

  it(
    "continues just as well from a save taken mid-walk or while the red side acts",
    { timeout: 30_000 },
    async () => {
      const ref = start();
      until(ref, turnStart(STAIR_TURN));
      const from = ref.rt.ctx.tick;
      ref.frames = [];
      until(ref, turnStart(STAIR_TURN + 1));
      const end = ref.rt.ctx.tick;
      const frames = ref.frames;
      ref.rt.destroy();

      // Every 5th tick of turn 2: the knight's walk onto the stair, the red side's waits and walks.
      const kinds = new Set<string>();
      for (let at = from + 1; at < end; at += 5) {
        const a = start();
        until(a, (s) => a.rt.ctx.tick === at && s !== null);
        const s = a.rt.snapshot() as TacticsRunSnapshot;
        if (s.walk) kinds.add(`walk:${s.side}`);
        if (s.ai) kinds.add("ai");
        const saved = a.rt.save({ depth: "world", slot: "mid", now: 0 });
        if (!saved.ok) throw new Error(saved.issue.message);
        a.rt.destroy();
        const b = start(tacticsGame, await throughStore(saved.file));
        expect(b.rt.snapshot(), `restored at ${at}`).toEqual(s);
        while (b.rt.ctx.tick < end) tick(b);
        expect(digest(b.frames), `saved at ${at}`).toBe(digest(frames.slice(at - from)));
        b.rt.destroy();
      }
      expect([...kinds].sort()).toEqual(["ai", "walk:blue", "walk:red"]);
    },
  );

  it("starts the level again from a progress save, which kept no board", async () => {
    const a = start();
    until(a, turnStart(4));
    const saved = a.rt.save({ depth: "progress", slot: "p", now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    a.rt.destroy();
    const fresh = start();
    const b = start(tacticsGame, saved.file);
    expect(b.rt.snapshot()).toEqual(fresh.rt.snapshot());
    b.rt.destroy();
    fresh.rt.destroy();
  });

  it("refuses data that isn't a tactics snapshot, leaving the level freshly loaded", async () => {
    const { file } = await uninterrupted();
    const bad = { ...file, data: { ...(file.data as object), turn: "four" } };
    expect(() => start(tacticsGame, bad as SaveFile)).toThrow(/not a tactics snapshot/);
  });
});

describe("the autosave", () => {
  /** The game with `ctx.saves.request` spied on (`through`) or turned off. */
  function spied(through: boolean) {
    const calls: { tick: number; slot: string; opts: unknown }[] = [];
    const game: GameDefinition<TacticsRunSnapshot> = {
      ...tacticsGame,
      createRuntime(ctx: EngineContext) {
        const request = ctx.saves.request.bind(ctx.saves);
        ctx.saves.request = (slot, opts) => {
          calls.push({ tick: ctx.tick, slot, opts });
          if (through) request(slot, opts);
        };
        return tacticsGame.createRuntime!(ctx);
      },
    };
    return { game, calls };
  }

  it("asks for a world save at each turn start but one its first tick already ordered, and saving it never changes a digest", async () => {
    const on = spied(true);
    const a = start(on.game);
    const store = memorySaveStore();
    const turns: number[] = [];
    let seen = 0;
    until(a, (s) => {
      if (on.calls.length > seen) {
        seen = on.calls.length;
        turns.push(s.turn);
        const saved = a.rt.save({ depth: "world", slot: TACTICS_AUTOSAVE_SLOT, now: 0 });
        if (!saved.ok) throw new Error(saved.issue.message);
        void store.write("tactics", TACTICS_AUTOSAVE_SLOT, formatSaveFile(saved.file));
      }
      return turnStart(7)(s);
    });
    expect(turns).toEqual([2, 3, 4, 5, 6, 7]);
    expect(on.calls[0]).toMatchObject({
      slot: TACTICS_AUTOSAVE_SLOT,
      opts: { depth: "world", title: "Turn 2" },
    });
    expect((await store.list("tactics")).map((s) => s.slot)).toEqual([TACTICS_AUTOSAVE_SLOT]);

    const off = spied(false);
    const b = start(off.game);
    until(b, turnStart(7));
    expect(off.calls).toHaveLength(6);
    expect(digest(b.frames)).toBe(digest(a.frames));
    a.rt.destroy();
    b.rt.destroy();
  });

  it("asks for turn 1's save on an idle first tick, before any order", () => {
    const on = spied(true);
    const { rt } = start(on.game);
    rt.step(rt.ctx.time.tickMs, [], []);
    expect(on.calls).toEqual([
      {
        tick: expect.any(Number),
        slot: TACTICS_AUTOSAVE_SLOT,
        opts: { depth: "world", title: "Turn 1" },
      },
    ]);
    const saved = rt.save({ depth: "world", slot: TACTICS_AUTOSAVE_SLOT, now: 0 });
    if (!saved.ok) throw new Error(saved.issue.message);
    const units = Object.values((saved.file.data as unknown as TacticsRunSnapshot).units);
    expect(units.every((u) => !u.moved && !u.acted)).toBe(true);
    rt.destroy();
  });

  it("is not asked for by a level loaded on its own, nor by the menu", async () => {
    const alone = spied(true);
    const rt = createHeadlessRuntime({
      game: alone.game,
      registry: createRegistry(alone.game),
      project: tacticsProjectView(),
      prefabs,
      scene: level2(),
    });
    const run = { rt, frames: [] };
    until(run, turnStart(2));
    rt.destroy();
    const menu = spied(true);
    const m = createHeadlessRuntime({
      game: menu.game,
      registry: createRegistry(menu.game),
      project: tacticsProjectView(),
      prefabs,
      flow: library(),
      scene: expandScene(parseSceneOrThrow(json("../scenes/menu.json"), registry), registry, {
        prefabs,
      }),
    });
    for (let i = 0; i < 5; i++) m.step(m.ctx.time.tickMs, []);
    m.destroy();
    expect([...alone.calls, ...menu.calls]).toEqual([]);
  });
});

describe("fixtures/level-2.save.json", () => {
  const text = () => readFileSync(FIXTURE, "utf8");

  it("is a world save of level 2 at turn 4's start", () => {
    const parsed = parseSaveFile(text(), tacticsGame);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.file).toMatchObject({ depth: "world", slot: "level-2", gameVersion: 1 });
    expect(parsed.file.scene.id).toBe("level-2");
    expect(parsed.file.data).toMatchObject({ turn: 4, side: "blue", phase: "orders" });
  });

  it("starts a playtest where it left off", async () => {
    const loaded = await loadHeadless(
      {
        files: { scene: json("../scenes/level-2.json"), prefabs: [...prefabs.values()] },
        registry,
        project: tacticsProjectView(),
      },
      { fromSave: text() },
    );
    const script: InputScriptV2 = {
      v: 2,
      seed: 1,
      steps: [{ command: "end-turn" }, { hold: [], max: 2000, until: { side: "blue" } }],
    };
    const run = runPlaytest<TacticsRunSnapshot>({
      ...loaded,
      rapier: null,
      game: tacticsGame,
      script,
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.final).toMatchObject({ turn: 5, side: "blue" });
    expect(run.recording.fromSave).toEqual({ slot: "level-2", sha256: loaded.fromSave!.sha256 });
  });

  it("loads with the scene CLI's --from-save", { timeout: 60_000 }, () => {
    const script = JSON.stringify({ v: 2, seed: 1, steps: [{ wait: 1 }] });
    const r = spawnSync(
      "bun",
      [
        "scripts/scene/cli.ts",
        "playtest",
        "level-2",
        "--project",
        "tactics",
        "--from-save",
        fileURLToPath(FIXTURE),
        "--script",
        "-",
        "--json",
      ],
      { cwd: REPO, encoding: "utf8", input: script },
    );
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const report = JSON.parse(r.stdout) as { final?: TacticsRunSnapshot };
    expect(report.final).toMatchObject({ turn: 4, side: "blue" });
  });
});
