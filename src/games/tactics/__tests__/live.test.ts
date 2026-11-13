// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { StagedVersion } from "@jams/engine";
import { projectInput } from "@jams/engine-testing";
import type { ExportInput } from "@jams/engine/export";
import {
  cellKey,
  type Cell,
  type GameCommand,
  type GameDefinition,
  type LibraryScene,
  type SceneLibrary,
} from "@jams/engine/game";
import {
  createHeadlessRuntime,
  playWorld,
  swapCheck,
  type InputScriptV2,
} from "@jams/engine/headless";
import { buildSceneVersion, sceneListFlow, sceneVersionOptions } from "@jams/engine/project";
import {
  createRegistry,
  expandScene,
  formatScene,
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type EntityDef,
  type Prefab,
  type SceneDefinition,
} from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { tacticsGame, worldBoard, type TacticsRunSnapshot } from "..";
import sceneList from "../scene-list.json";
import { tacticsProjectView } from "./pins";

const here = (path: string) => new URL(path, import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(here(path), "utf8"));

const SCENE = "level-1";
const KNIGHT = "blue-knight-1/unit";
/** Where the edit's wall stands: the end of the knight's first move. */
const WALL: Cell = [4, 2];

type LiveEdit = { scene: string; add: EntityDef[] };
const EDIT = json("./fixtures/live/level-1.edit.json") as LiveEdit;

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

/** The game as Live in Play and the swap check drive it: a swap may land mid-turn. */
const anyTick: GameDefinition<TacticsRunSnapshot> = {
  ...tacticsGame,
  live: { timings: ["next-load", "boundary", "now"] },
};

function start(game: GameDefinition<TacticsRunSnapshot>) {
  return createHeadlessRuntime({
    game,
    registry: createRegistry(game),
    project: tacticsProjectView(),
    prefabs,
    flow: library(),
    scene: expandScene(parseSceneOrThrow(json(`../scenes/${SCENE}.json`), registry), registry, {
      prefabs,
    }),
  });
}

type Run = ReturnType<typeof start>;

function step(rt: Run, commands: GameCommand[] = []): TacticsRunSnapshot {
  rt.step(rt.ctx.time.tickMs, [], commands);
  return rt.snapshot() as TacticsRunSnapshot;
}

const walls = (rt: Run) => worldBoard(playWorld(rt.ctx)).grid.walls;

const poseCell = (rt: Run, id: string): Cell => {
  const pose = rt.ctx.poses.get(id)!;
  return [Math.floor(pose.x), Math.floor(pose.y)];
};

const GAME_DIR = fileURLToPath(here("../"));

let input: ExportInput;

/** Level 1 as `level` (as committed when omitted), built into a version from the project's files. */
async function versionOf(level?: SceneDefinition): Promise<StagedVersion> {
  const texts = new Map(input.texts);
  if (level) texts.set(SCENE, formatScene(level).text);
  const built = await buildSceneVersion(sceneVersionOptions(input, SCENE, { texts }));
  if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
  return built;
}

const level1 = () => JSON.parse(input.texts.get(SCENE)!) as SceneDefinition;

/** Level 1 with `add` appended to its entities. */
function versionWith(add: readonly EntityDef[]): Promise<StagedVersion> {
  const def = level1();
  return versionOf({ ...def, entities: [...(def.entities ?? []), ...add] });
}

/** A one-cell wall like the fixture's, on `cell`. */
const wallOn = (cell: Cell): EntityDef => ({
  ...EDIT.add[0]!,
  id: `wall-${cell.join("-")}`,
  shape: ["box", cell[0] + 0.5, cell[1] + 0.5, 0.5, 0.5],
});

beforeAll(async () => {
  ({ input } = await projectInput(GAME_DIR, tacticsGame));
});

describe("tactics live levels", () => {
  it("declares next-load and boundary only", () => {
    expect(tacticsGame.live).toEqual({ timings: ["next-load", "boundary"] });
  });

  it("drops the move into a cell made impassable: the walk stops short of it", async () => {
    const version = await versionWith(EDIT.add);
    const rt = start(anyTick);
    try {
      let s = step(rt, [{ name: "move", args: { unit: KNIGHT, to: WALL } }]);
      expect(s.walk?.path).toEqual([[3, 2], WALL]);
      expect(rt.live.stage(version)).toEqual({ ok: true });
      expect(rt.live.activate(SCENE, version.id, "now")).toEqual({
        timing: "now",
        clamped: false,
      });
      s = step(rt);
      expect(rt.ctx.live.version).toBe(version.id);
      expect(walls(rt)).toContain(cellKey(WALL));
      expect(s.units[KNIGHT]!.cell).toEqual([3, 2]);
      expect(s.walk?.path).toEqual([[3, 2]]);
      for (let i = 0; i < 64 && s.walk; i++) s = step(rt);
      expect(s.walk).toBeUndefined();
      expect(s.phase).toBe("orders");
      expect(s.units[KNIGHT]).toMatchObject({ cell: [3, 2], moved: true });
      expect(poseCell(rt, KNIGHT)).toEqual([3, 2]);
    } finally {
      rt.destroy();
    }
  });

  it("sends a step walking into a cell made impassable back to the cell it left", async () => {
    const version = await versionWith([wallOn([2, 2])]);
    const rt = start(anyTick);
    try {
      let s = step(rt, [{ name: "move", args: { unit: KNIGHT, to: WALL } }]);
      expect(s.walk?.on).toEqual([2, 2]);
      rt.live.stage(version);
      rt.live.activate(SCENE, version.id, "now");
      s = step(rt);
      expect(rt.ctx.live.version).toBe(version.id);
      expect(s.walk).toBeUndefined();
      expect(s.phase).toBe("orders");
      expect(s.units[KNIGHT]).toMatchObject({ cell: [1, 2], moved: true });
      expect(poseCell(rt, KNIGHT)).toEqual([1, 2]);
    } finally {
      rt.destroy();
    }
  });

  it("re-indexes a unit the new version moves, and adds one it places", async () => {
    const level = level1();
    const placed = {
      id: "red-scout",
      prefab: "knight",
      at: [9.5, 1.5] as [number, number],
      params: { side: "red" },
    };
    const version = await versionOf({
      ...level,
      instances: [
        ...(level.instances ?? []).map((i) =>
          i.id === "blue-archer" ? { ...i, at: [2.5, 4.5] as [number, number] } : i,
        ),
        placed,
      ],
    } as SceneDefinition);
    const rt = start(anyTick);
    try {
      rt.live.stage(version);
      rt.live.activate(SCENE, version.id, "now");
      const s = step(rt);
      expect(rt.ctx.live.version).toBe(version.id);
      expect(s.units["blue-archer/unit"]!.cell).toEqual(poseCell(rt, "blue-archer/unit"));
      expect(s.units["red-scout/unit"]).toMatchObject({
        side: "red",
        class: "knight",
        cell: [9, 1],
      });
    } finally {
      rt.destroy();
    }
  });

  it("takes a version at the end of a full round, not before", async () => {
    const version = await versionWith(EDIT.add);
    const rt = start(tacticsGame);
    try {
      expect(rt.live.stage(version)).toEqual({ ok: true });
      const activated = rt.live.activate(SCENE, version.id, "now");
      expect(activated).toMatchObject({ timing: "boundary", clamped: true });
      expect(activated.issue?.code).toBe("live-timing-unsupported");
      let s = step(rt, [{ name: "end-turn" }]);
      expect(s.side).toBe("red");
      for (let i = 0; i < 4000 && s.side === "red"; i++) {
        expect(rt.ctx.live.version).toBeNull();
        s = step(rt);
      }
      expect(s).toMatchObject({ side: "blue", turn: 2, phase: "orders" });
      expect(rt.ctx.live.version).toBe(version.id);
      expect(walls(rt)).toContain(cellKey(WALL));
      expect(rt.live.pending()).toEqual([]);
    } finally {
      rt.destroy();
    }
  });

  it("passes the swap check on the fixture version", async () => {
    const from = await versionOf();
    const to = await versionWith(EDIT.add);
    expect(to.id).not.toBe(from.id);
    const report = swapCheck({
      game: tacticsGame,
      registry: input.registry,
      from,
      to,
      project: tacticsProjectView(),
      scripts: [{ name: SCENE, script: json(`../scenes/${SCENE}.script.json`) as InputScriptV2 }],
    });
    expect(report.issues).toEqual([]);
    expect(report.runs.map((r) => [r.at, r.strategy, r.issues])).toEqual([
      [0.25, "reconcile", []],
      [0.5, "reconcile", []],
      [0.75, "reconcile", []],
    ]);
    expect(report.ok).toBe(true);
  }, 60_000);
});
