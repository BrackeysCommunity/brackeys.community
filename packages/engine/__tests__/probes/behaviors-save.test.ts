// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { CHARACTER_SIDE_VIEW } from "../../game/behaviors/character-side-view";
import { CHARACTER_TOP_DOWN, type CharacterSystem } from "../../game/behaviors/character-top-down";
import { NAV_AGENT, type NavAgentSystem } from "../../game/behaviors/nav-agent";
import { PATH_FOLLOW, type PathFollowSystem } from "../../game/behaviors/path-follow";
import { SPAWNER, type SpawnerSystem } from "../../game/behaviors/spawner";
import { createRegistry } from "../../game/define";
import { formatSaveFile, parseSaveFile, type SaveFile } from "../../game/save-file";
import { createHeadlessRuntime } from "../../headless/headless";
import { captureSave, worldSaveBlockers } from "../../runtime/save-state";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import {
  ROOM_HEROES,
  ROOM_LIFT,
  ROOM_SCOUT,
  ROOM_SPAWNER,
  ROOM_WALKER,
  roomGame,
  roomScene,
  stepRoom,
} from "../genres/versus-behaviors.probe";

const registry = createRegistry(roomGame);
const expanded = expandScene(roomScene, registry);
const AFTER = 300;

const open = (fromSave?: SaveFile) =>
  createHeadlessRuntime({
    game: roomGame,
    registry,
    scene: structuredClone(expanded),
    ...(fromSave ? { fromSave } : {}),
  });

const side = (rt: SceneRuntimeHandle) =>
  rt.ctx.behavior<CharacterSystem>(CHARACTER_SIDE_VIEW.name)!;
const top = (rt: SceneRuntimeHandle) => rt.ctx.behavior<CharacterSystem>(CHARACTER_TOP_DOWN.name)!;
const spawner = (rt: SceneRuntimeHandle) => rt.ctx.behavior<SpawnerSystem>(SPAWNER.name)!;
const nav = (rt: SceneRuntimeHandle) => rt.ctx.behavior<NavAgentSystem>(NAV_AGENT.name)!;
const path = (rt: SceneRuntimeHandle) => rt.ctx.behavior<PathFollowSystem>(PATH_FOLLOW.name)!;

/** Steps `ticks` ticks of the room's stream, each frame's events, poses and velocities in the digest. */
function play(rt: SceneRuntimeHandle, ticks: number): string {
  const frames: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const { frame } = stepRoom(rt);
    const velocities = [
      ...ROOM_HEROES.map((id) => side(rt).velocity(id)),
      top(rt).velocity(ROOM_WALKER),
    ];
    frames.push(frame, JSON.stringify(velocities));
  }
  return hashText(frames.join("\n"));
}

/** The world save `rt` takes now, through its canonical text and back. */
function worldSave(rt: SceneRuntimeHandle): SaveFile {
  expect(worldSaveBlockers(rt)).toEqual([]);
  const captured = captureSave(rt, { depth: "world", slot: "mid", now: 0 });
  if (!captured.ok) throw new Error(captured.issue.message);
  const parsed = parseSaveFile(formatSaveFile(captured.file), roomGame);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.file;
}

type Moment = {
  name: string;
  at: number;
  /** What makes the tick the moment it names, in the run that saves. */
  holds: (rt: SceneRuntimeHandle) => void;
};

const MOMENTS: readonly Moment[] = [
  {
    name: "mid-jump",
    at: 18,
    holds(rt) {
      expect(side(rt).grounded(ROOM_HEROES[0])).toBe(false);
      expect(side(rt).velocity(ROOM_HEROES[0]).y).toBeLessThan(0);
    },
  },
  {
    name: "mid-path",
    at: 75,
    holds(rt) {
      const at = path(rt).position(ROOM_LIFT)!;
      expect(at.x).toBeGreaterThan(14);
      expect(at.x).toBeLessThan(19);
      expect(path(rt).frameDelta(ROOM_LIFT)).not.toEqual({ x: 0, y: 0 });
    },
  },
  {
    name: "mid-spawn",
    at: 140,
    holds(rt) {
      const live = spawner(rt).live(ROOM_SPAWNER);
      expect(live.length).toBeGreaterThan(0);
      expect(live.length).toBeLessThan(5);
    },
  },
  {
    name: "mid-walk",
    at: 200,
    holds(rt) {
      expect(nav(rt).path(ROOM_SCOUT)?.length).toBeGreaterThan(0);
    },
  },
];

describe("world saves of standard behaviors, on the geometry backend", () => {
  it.each(MOMENTS)(
    "a save $name restores into a fresh runtime to the same digest 300 ticks on",
    ({ at, holds }) => {
      const whole = open();
      play(whole, at);
      holds(whole);
      const save = worldSave(whole);
      expect(save.depth).toBe("world");
      const after = play(whole, AFTER);

      const resumed = open(save);
      expect(resumed.ctx.tick).toBe(at);
      holds(resumed);
      expect(play(resumed, AFTER)).toBe(after);
      expect(resumed.stats().behaviors).toEqual(whole.stats().behaviors);
      whole.destroy();
      resumed.destroy();
    },
    30_000,
  );

  it("holds each moving behavior's state in the save", () => {
    const rt = open();
    play(rt, 140);
    const systems = worldSave(rt).world!.systems;
    for (const id of ROOM_HEROES) expect(systems[id], id).toHaveProperty(CHARACTER_SIDE_VIEW.name);
    expect(Object.keys(systems[ROOM_WALKER] ?? {})).not.toEqual([]);
    expect(systems[ROOM_LIFT]).toHaveProperty(PATH_FOLLOW.name);
    expect(systems[ROOM_SPAWNER]).toHaveProperty(SPAWNER.name);
    expect(systems[ROOM_SCOUT]).toHaveProperty(NAV_AGENT.name);
    expect(systems["@random"]).toHaveProperty(`spawner:${ROOM_SPAWNER}`);
    rt.destroy();
  });
});
