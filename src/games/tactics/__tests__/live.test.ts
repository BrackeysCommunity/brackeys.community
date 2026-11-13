// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { StagedVersion } from "@jams/engine";
import {
  cellKey,
  withProject,
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
import {
  buildSceneVersion,
  heldProject,
  parseSidecar,
  sceneListFlow,
  snapshotProject,
  type HeldFile,
  type ProjectSnapshot,
  type ProjectView,
} from "@jams/engine/project";
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
/** The project's asset folders and files, as `jams.project.json` lists them. */
const ASSET_ROOTS = [
  "scenes",
  "data",
  "art",
  "game-settings.json",
  "input-map.json",
  "scene-list.json",
];

type ProjectInput = {
  view: ProjectView;
  /** Each doc's text, by asset id. */
  texts: Map<string, string>;
  snapshot: ProjectSnapshot;
  game: GameDefinition<TacticsRunSnapshot>;
  registry: ReturnType<typeof createRegistry>;
};

/** The game's project as the scene CLI reads it from disk: its docs, and its binaries by sidecar. */
async function readProject(): Promise<ProjectInput> {
  const files: HeldFile[] = [];
  const byPath = new Map<string, string>();
  const add = (path: string) => {
    if (path.endsWith(".asset.json")) return;
    const car = `${join(GAME_DIR, path)}.asset.json`;
    const parsed = existsSync(car) ? parseSidecar(JSON.parse(readFileSync(car, "utf8"))) : null;
    const sidecar = parsed?.ok ? parsed.sidecar : null;
    if (sidecar?.sha256 !== undefined) files.push({ path, sidecar });
    else if (path.endsWith(".json")) {
      const text = readFileSync(join(GAME_DIR, path), "utf8");
      byPath.set(path, text);
      files.push({ path, json: JSON.parse(text), sidecar });
    }
  };
  const walk = (path: string) => {
    const full = join(GAME_DIR, path);
    if (!statSync(full).isDirectory()) return add(path);
    for (const name of readdirSync(full).sort())
      walk(relative(GAME_DIR, join(full, name)).split("\\").join("/"));
  };
  for (const root of ASSET_ROOTS) walk(root);
  const held = heldProject(files, registry, { projectId: "tactics", name: "Tactics" });
  const texts = new Map<string, string>();
  const values = new Map<string, unknown>();
  for (const entry of held.view.byId.values()) {
    const text = byPath.get(entry.path);
    if (text === undefined) continue;
    texts.set(entry.id, text);
    values.set(entry.id, JSON.parse(text));
  }
  return {
    view: held.view,
    texts,
    snapshot: await snapshotProject(held.view, texts, held.view.state.build),
    game: tacticsGame,
    registry: withProject(createRegistry(tacticsGame), held.view, values),
  };
}

let input: ProjectInput;

/** Level 1 with `add` appended to its entities, built into a version from the project's files. */
async function versionWith(add: readonly EntityDef[]): Promise<StagedVersion> {
  const texts = new Map(input.texts);
  if (add.length > 0) {
    const def = JSON.parse(input.texts.get(SCENE)!) as SceneDefinition;
    texts.set(SCENE, formatScene({ ...def, entities: [...(def.entities ?? []), ...add] }).text);
  }
  const built = await buildSceneVersion({
    view: input.view,
    texts,
    build: input.snapshot.build,
    game: input.game,
    registry: input.registry,
    scene: SCENE,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
  return { id: built.id, version: built.version, texts: built.texts };
}

/** A one-cell wall like the fixture's, on `cell`. */
const wallOn = (cell: Cell): EntityDef => ({
  ...EDIT.add[0]!,
  id: `wall-${cell.join("-")}`,
  shape: ["box", cell[0] + 0.5, cell[1] + 0.5, 0.5, 0.5],
});

beforeAll(async () => {
  input = await readProject();
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
    const level = JSON.parse(input.texts.get(SCENE)!) as SceneDefinition;
    const moved = {
      ...level,
      instances: (level.instances ?? []).map((i) =>
        i.id === "blue-archer" ? { ...i, at: [2.5, 4.5] as [number, number] } : i,
      ),
    } as SceneDefinition;
    const placed = {
      id: "red-scout",
      prefab: "knight",
      at: [9.5, 1.5] as [number, number],
      params: { side: "red" },
    };
    const texts = new Map(input.texts);
    texts.set(
      SCENE,
      formatScene({ ...moved, instances: [...(moved.instances ?? []), placed] } as SceneDefinition)
        .text,
    );
    const built = await buildSceneVersion({
      view: input.view,
      texts,
      build: input.snapshot.build,
      game: input.game,
      registry: input.registry,
      scene: SCENE,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
    const rt = start(anyTick);
    try {
      rt.live.stage({ id: built.id, version: built.version, texts: built.texts });
      rt.live.activate(SCENE, built.id, "now");
      const s = step(rt);
      expect(rt.ctx.live.version).toBe(built.id);
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
    const from = await versionWith([]);
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
