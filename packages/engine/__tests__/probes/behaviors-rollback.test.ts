// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

import { CHARACTER_SIDE_VIEW } from "../../game/behaviors/character-side-view";
import type { CharacterSystem } from "../../game/behaviors/character-top-down";
import { createRegistry } from "../../game/define";
import type { SaveFile } from "../../game/save-file";
import { createHeadlessRuntime } from "../../headless/headless";
import { captureSave, restoreSave } from "../../runtime/save-state";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
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
