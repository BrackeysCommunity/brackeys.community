import { createGame, localStorageSaveStore, type GameInstance, type SaveSlots } from "@jams/engine";
import {
  createRegistry,
  defineGame,
  effectiveSaveLimits,
  formatSaveFile,
  parseSaveFile,
  type EngineContext,
} from "@jams/engine/game";
import { createHeadlessRuntime, memorySaveStore } from "@jams/engine/headless";
import { expandScene, type SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export type HiveSnapshot = { nectar: number; bees: number };
type Honey = { honey: number };

/**
 * A physics-free hive: nectar comes in at a random rate, every 20 makes a
 * jar of honey (persistent), a timer hatches a bee every 10 ticks, and the
 * game asks for an autosave every 25 ticks.
 */
export const hiveGame = defineGame<HiveSnapshot>({
  id: "hive",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: {
    initial: () => ({ honey: 0 }),
    schema: z.strictObject({ honey: z.number().int().min(0) }),
  },
  saves: {
    version: 2,
    // Version 1 called the jars `jars`.
    migrations: {
      1: ({ persist, game }) => ({ persist: { honey: (persist as { jars: number }).jars }, game }),
    },
  },
  createRuntime(ctx: EngineContext) {
    let nectar = 0;
    let bees = 0;
    return {
      onLoad() {
        nectar = 0;
        bees = 0;
        ctx.timers.every(10, { emit: "hatch" });
      },
      beforeStep() {
        nectar += 1 + ctx.random.below(3);
        if (nectar >= 20) {
          nectar -= 20;
          ctx.persist.set({ honey: (ctx.persist.value as Honey).honey + 1 });
        }
        if (ctx.tick % 25 === 24) {
          ctx.saves.request("auto", { depth: "world", title: `Tick ${ctx.tick}` });
        }
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type !== "hatch") continue;
          bees++;
          ctx.spawn({ type: "marker", at: [ctx.random.below(4), 1] });
        }
      },
      snapshot: () => ({ nectar, bees }),
      // Without `restore` a world save is refused (`save-unsupported`).
      restore(s) {
        nectar = s.nectar;
        bees = s.bees;
      },
    };
  },
});

const registry = createRegistry(hiveGame);
const meadow: SceneDefinition = {
  v: 4,
  game: "hive",
  name: "meadow",
  bounds: [0, 0, 4, 2],
  entities: [{ id: "hive", type: "marker", at: [2, 1] }],
};

/**
 * Plays 60 ticks, honouring the game's autosave requests and saving
 * `slot-1` by hand at tick 30; then a fresh runtime resumes `slot-1` and
 * plays the same 30 ticks to the same state.
 */
export async function keepHive() {
  const store = memorySaveStore();
  const scene = expandScene(meadow, registry);
  const open = (saveText?: string) => {
    const parsed = saveText === undefined ? null : parseSaveFile(saveText, hiveGame);
    if (parsed && !parsed.ok) throw new Error(parsed.issues[0]!.message);
    return createHeadlessRuntime({
      game: hiveGame,
      registry,
      scene,
      ...(parsed ? { fromSave: parsed.file } : {}),
    });
  };
  const now = (tick: number) => 1_762_531_200_000 + tick * 1000;
  const state = (r: ReturnType<typeof open>) => JSON.stringify([r.snapshot(), r.ctx.persist.value]);

  const run = open();
  const { tickMs } = run.ctx.time;
  for (let tick = 0; tick < 60; tick++) {
    run.step(tickMs, []);
    // The host's half of `ctx.saves.request`: capture after the tick, then write.
    for (const req of run.takeRequests().saves) {
      const saved = run.save({ ...req, depth: req.depth ?? "progress", now: now(tick) });
      if (saved.ok) await store.write("hive", req.slot, formatSaveFile(saved.file));
    }
    if (tick === 29) {
      const saved = run.save({
        depth: "world",
        slot: "slot-1",
        title: "Before the swarm",
        now: now(tick),
      });
      if (!saved.ok) throw new Error(saved.issue.message);
      await store.write("hive", "slot-1", formatSaveFile(saved.file));
    }
  }
  const played = state(run);

  const resumed = open((await store.read("hive", "slot-1"))!);
  for (let tick = 30; tick < 60; tick++) resumed.step(tickMs, []);

  const progress = run.save({ depth: "progress", slot: "slot-2", now: now(60) });
  const file = run.save({ depth: "world", slot: "slot-3", now: now(60) });
  if (!progress.ok || !file.ok) throw new Error("the hive can't be saved");
  // An old save of the game's version 1, migrated on parse.
  const old = parseSaveFile(
    formatSaveFile({ ...file.file, gameVersion: 1, persist: { jars: 3 } }),
    hiveGame,
  );
  const newer = parseSaveFile(formatSaveFile({ ...file.file, gameVersion: 3 }), hiveGame);
  run.destroy();
  resumed.destroy();

  return {
    limits: effectiveSaveLimits(hiveGame, store),
    slots: (await store.list("hive")).map((s) => [s.slot, s.meta.title, s.meta.playTicks]),
    sameState: state(resumed) === played,
    honey: (resumed.ctx.persist.value as Honey).honey,
    progressHasWorld: "world" in progress.file,
    migrated: old.ok ? [old.migratedFrom, old.file.persist] : null,
    newer: newer.ok ? null : newer.issues.map((i) => i.code),
  };
}

/** A save menu's lines: where saves live, the slots in use, and the next free slot. */
export async function saveMenu(saves: Pick<SaveSlots, "store" | "limits" | "list">) {
  const held = await saves.list();
  const names = new Set(held.map((s) => s.slot));
  let free: string | null = null;
  for (let n = 1; n <= saves.limits.maxSlots && free === null; n++) {
    if (!names.has(`slot-${n}`)) free = `slot-${n}`;
  }
  return {
    where: saves.store.describe,
    rows: held.map((s) => `${s.meta.title ?? s.meta.scene} · ${Math.round(s.bytes / 1024)} KB`),
    free: held.length < saves.limits.maxSlots ? free : null,
  };
}

/** Continue: loads the save written last, through the instance's slots. */
export async function continueNewest(game: Pick<GameInstance, "saves">) {
  const held = await game.saves.list();
  const newest = held.reduce<(typeof held)[number] | null>(
    (best, s) => (best && best.meta.savedAt >= s.meta.savedAt ? best : s),
    null,
  );
  return newest ? game.saves.load(newest.slot) : null;
}

/** A host's own store: localStorage under its own prefix; the game's `saves.store` would win over it. */
export async function playHive(canvas: HTMLCanvasElement): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: hiveGame,
    saves: localStorageSaveStore({ prefix: "hive-demo:" }),
  });
  game.on("save:written", ({ slot, bytes }) => console.log(`saved ${slot} (${bytes} B)`));
  game.on("save:failed", ({ slot, issue }) => console.warn(`${slot}: ${issue.message}`));
  game.start();
  return game;
}
