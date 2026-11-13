// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

import { CHARACTER_SIDE_VIEW } from "../../game/behaviors/character-side-view";
import type { CharacterSystem } from "../../game/behaviors/character-top-down";
import { NAV_AGENT, type NavAgentSystem } from "../../game/behaviors/nav-agent";
import { SPAWNER, type SpawnerSystem } from "../../game/behaviors/spawner";
import { createRegistry, defineGame } from "../../game/define";
import type { SaveFile } from "../../game/save-file";
import { createHeadlessRuntime } from "../../headless/headless";
import { captureSave, restoreSave } from "../../runtime/save-state";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import { runGenreProbe, type GenreProbe } from "../genres/harness";
import {
  ROOM_HEROES,
  roomGame,
  roomScene,
  stepRoom,
  versusBehaviorsProbe,
} from "../genres/versus-behaviors.probe";

const registry = createRegistry(roomGame);
/** Where the rollback starts: seat 1's two streams part on the next tick. */
const N = 60;
const WINDOW = 12;

function loaded(): SceneRuntimeHandle {
  return createHeadlessRuntime({
    game: roomGame,
    registry,
    scene: expandScene(roomScene, registry),
  });
}

const run = (rt: SceneRuntimeHandle, stream: "a" | "b") =>
  Array.from({ length: WINDOW }, () => stepRoom(rt, stream).frame);

/** Puts `save` back into `rt` in place, as a rollback does, counting what it raised. */
function rollBack(rt: SceneRuntimeHandle, save: SaveFile): number {
  const emit = vi.spyOn(rt.ctx, "emit");
  try {
    const restored = restoreSave(rt, save);
    if (!restored.ok) throw new Error(restored.issue.message);
    return emit.mock.calls.length;
  } finally {
    emit.mockRestore();
  }
}

describe("restore and re-simulate, on the geometry backend", () => {
  it(`rolls back ${WINDOW} ticks, re-simulates another seat-1 stream, and repeats the first tick for tick`, () => {
    const rt = loaded();
    for (let i = 0; i < N; i++) stepRoom(rt);
    expect(rt.ctx.tick).toBe(N);
    const captured = captureSave(rt, { depth: "world", slot: "rollback", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    const save = captured.file;

    const first = run(rt, "a");
    expect(rollBack(rt, save)).toBe(0);
    expect(rt.ctx.tick).toBe(N);
    const other = run(rt, "b");
    expect(rollBack(rt, save)).toBe(0);
    // The same spy sees what the re-simulated ticks raise.
    const emit = vi.spyOn(rt.ctx, "emit");
    const third = run(rt, "a");
    expect(emit.mock.calls.length).toBeGreaterThan(0);
    emit.mockRestore();

    expect(third).toStrictEqual(first);
    const parted = first.findIndex((frame, i) => frame !== other[i]);
    expect(parted).toBeGreaterThanOrEqual(0);
    expect(parted).toBeLessThan(WINDOW);
    rt.destroy();
  });

  it("leaves seat 0's character on the same path whichever stream seat 1 plays", () => {
    const poses = (stream: "a" | "b") => {
      const rt = loaded();
      for (let i = 0; i < N + WINDOW; i++) stepRoom(rt, stream);
      const sys = rt.ctx.behavior<CharacterSystem>(CHARACTER_SIDE_VIEW.name)!;
      const out = ROOM_HEROES.map((id) => [rt.ctx.poses.get(id), sys.velocity(id)]);
      rt.destroy();
      return out;
    };
    const [a, b] = [poses("a"), poses("b")];
    expect(b[0]).toStrictEqual(a[0]);
    expect(b[1]).not.toStrictEqual(a[1]);
  });
});

describe("two seats on standard behaviors", () => {
  it("stops a character whose seat leaves mid-run, and replays the recorded two-seat input", async () => {
    const probe = versusBehaviorsProbe as GenreProbe;
    const played = await runGenreProbe(probe);
    expect(played.report.outcome.result).toBe("seat-0-wins");
    expect(played.report.recording.inputs).toHaveLength(2);
    expect(played.report.events.map((e) => e.type)).toContain("player:left");
    expect(played.replay.matches).toBe(true);
    const final = played.report.final as Record<string, [number, number, number]>;
    const left = played.report.events.find((e) => e.type === "player:left")!;
    expect(left.tick).toBeLessThan(played.report.outcome.tick);
    // It stopped short of the updraft and stayed there.
    expect(final["hero-1"]![0]).toBeGreaterThan(9);
    expect(final["hero-1"]![0]).toBeLessThan(13.9);
  });
});

describe("rollback of streams and staggers made after the save", () => {
  const game = defineGame({
    id: "rollback-late",
    types: [],
    actions: [],
    time: { kind: "fixed", rate: 60 },
    createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
  });
  const lateRegistry = createRegistry(game);
  const room = (x0: number, y0: number, x1: number, y1: number) => ({
    type: "poly" as const,
    pts: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as [number, number][],
  });
  const scene = (entities: RuntimeEntity[]): ExpandedScene => ({
    name: "rollback-late",
    bounds: [-20, -20, 40, 40],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities,
  });
  const open = (entities: RuntimeEntity[]) =>
    createHeadlessRuntime({ game, registry: lateRegistry, scene: scene(entities) });

  /** Steps `ticks`, running `each(i)` before each, and digests every pose and event. */
  function digest(rt: SceneRuntimeHandle, ticks: number, each?: (i: number) => void): string {
    const frames: string[] = [];
    for (let i = 0; i < ticks; i++) {
      each?.(i);
      const { events } = rt.step(rt.ctx.time.tickMs, []);
      const poses = [...rt.ctx.poses.ids()].map((id) => [id, rt.ctx.poses.get(id)]);
      frames.push(JSON.stringify([events.map((e) => [e.type, e.entityId, e.other]), poses]));
    }
    return hashText(frames.join("\n"));
  }

  function saveOf(rt: SceneRuntimeHandle): SaveFile {
    const captured = captureSave(rt, { depth: "world", slot: "late", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    return captured.file;
  }

  it("repeats a spread spawner's offsets when the save came before its first draw", () => {
    const rt = open([
      {
        id: "spawner",
        type: "marker",
        at: [5, 5],
        behaviors: { spawner: { type: "marker", rate: 4, cap: 6, spread: 2 } },
      },
    ]);
    const save = saveOf(rt);
    const first = digest(rt, 100);
    expect(rt.ctx.behavior<SpawnerSystem>(SPAWNER.name)!.live("spawner").length).toBe(6);
    expect(rollBack(rt, save)).toBe(0);
    expect(digest(rt, 100)).toBe(first);
    rt.destroy();
  });

  it("repaths an agent spawned after the save on the ticks it did, in place and in a fresh runtime", () => {
    const entities: RuntimeEntity[] = [
      { id: "floor", type: "nav", shape: room(0, 0, 12, 10) },
      { id: "goal", type: "marker", at: [11, 9] },
      { id: "lead", type: "marker", at: [1, 1], behaviors: { "nav-agent": { repathTicks: 17 } } },
    ];
    const agent = { "nav-agent": { repathTicks: 17 } };
    const rt = open(entities);
    // A spawn gone before the save, and one that outlives it.
    rt.ctx.destroy(rt.ctx.spawn({ type: "marker", at: [2, 2], behaviors: agent }).id);
    const early = rt.ctx.spawn({ type: "marker", at: [1.2, 1.1], behaviors: agent }).id;
    digest(rt, 3);
    const save = saveOf(rt);
    const run = (on: SceneRuntimeHandle) => {
      const out = digest(on, 120, (i) => {
        // A target on the move, so when each agent plans again shows in where it walks.
        on.ctx.poses.set("goal", 11 - i * 0.05, 9 - i * 0.02);
        if (i !== 5) return;
        const late = on.ctx.spawn({ type: "marker", at: [1.1, 1.3], behaviors: agent }).id;
        const nav = on.ctx.behavior<NavAgentSystem>(NAV_AGENT.name)!;
        for (const id of ["lead", early, late]) nav.setDestination(id, "goal");
      });
      return [out, JSON.stringify(saveOf(on).world!.systems)];
    };
    const first = run(rt);
    expect(rollBack(rt, save)).toBe(0);
    expect(run(rt)).toStrictEqual(first);
    rt.destroy();

    const fresh = createHeadlessRuntime({
      game,
      registry: lateRegistry,
      scene: scene(entities),
      fromSave: save,
    });
    expect(run(fresh)).toStrictEqual(first);
    fresh.destroy();
  });
});
