import { existsSync, readFileSync } from "node:fs";

import { defineGame, flowIssue } from "@jams/engine/game";
import { heldProject, parseSidecar } from "@jams/engine/project";
import { createRegistry } from "@jams/engine/scene";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  gameCodeChanged,
  hostedGame,
  hostedGames,
  hostedGamesFrom,
  type HostedGame,
  type HostedGameGlobs,
} from "../hosted-games";

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const boardGame = defineGame({
  id: "board",
  types: [],
  projectSettings: { speed: z.number().default(1) },
  tables: { piece: { description: "Pieces.", row: { value: z.number() } } },
  actions: [{ action: "confirm", keys: ["Enter"], description: "Confirm." }],
  createRuntime: () => ({ snapshot: () => null }),
});
const mountBoardHud = () => ({ destroy() {} });

const project = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "project",
  v: 1,
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  game: { module: "./index.ts", export: `${id}Game` },
  ...extra,
});

/**
 * The view the tactics golden pin builds (`src/games/tactics/__tests__/pins.ts`),
 * from the same files read off disk, since a site test may not import a game's tests.
 */
function tacticsPinnedView(game: Parameters<typeof createRegistry>[0]) {
  const dir = "src/games/tactics";
  const sidecar = (path: string) => {
    const parsed = parseSidecar(json(`${dir}/${path}.asset.json`));
    if (!parsed.ok) throw new Error(`${path}'s sidecar doesn't parse`);
    return parsed.sidecar;
  };
  const doc = (path: string) => ({ path, json: json(`${dir}/${path}`), sidecar: sidecar(path) });
  const binary = (path: string) => ({ path, sidecar: sidecar(path) });
  const meta = json(`${dir}/jams.project.json`) as { id: string; name: string };
  return heldProject(
    [
      doc("game-settings.json"),
      doc("input-map.json"),
      doc("data/unit-classes.json"),
      binary("art/tile-marsh.png"),
      binary("art/tile-thicket.png"),
      binary("art/tile-wall.png"),
      binary("art/tiles.png"),
      binary("art/units.png"),
      binary("art/units.json"),
    ],
    createRegistry(game),
    { projectId: meta.id, name: meta.name },
  ).runtime;
}

/** The platformer from its real files and a fixture board game, each loader a spy. */
function globs(patch: Partial<HostedGameGlobs> = {}) {
  const loaders = {
    platformer: vi.fn(() => import("@/games/platformer")),
    board: vi.fn(async () => ({ boardGame })),
    boardUi: vi.fn(async () => ({ mountBoardHud })),
    testYard: vi.fn(async () => ({ default: json("src/games/platformer/scenes/test-yard.json") })),
    platformerList: vi.fn(async () => ({ default: json("src/games/platformer/scene-list.json") })),
    boardSidecar: vi.fn(async () => ({
      default: { kind: "asset-sidecar", v: 1, key: "abc", id: "level-1" },
    })),
    boardChecks: vi.fn(async () => ({ default: { v: 3, checks: [] } })),
    boardLevel: vi.fn(async () => ({ default: { v: 4, name: "level-1", bounds: [0, 0, 8, 8] } })),
    boardLevel2: vi.fn(async () => ({ default: { v: 4, name: "level-2", bounds: [0, 0, 8, 8] } })),
    boardList: vi.fn(async () => ({
      default: {
        kind: "scene-list",
        v: 1,
        start: "level-1",
        scenes: [{ scene: "level-1", title: "Level 1" }, { scene: "missing" }],
      },
    })),
    boardSettings: vi.fn(async () => ({
      default: { kind: "game-settings", v: 2, engine: { tickRate: 30 }, game: { speed: 3 } },
    })),
    boardPieces: vi.fn(async () => ({
      default: {
        kind: "data-table",
        v: 2,
        table: "piece",
        rows: [
          { id: "pawn", value: 1 },
          { id: "rook", value: "five" },
        ],
      },
    })),
    boardPrefab: vi.fn(async () => ({
      default: {
        kind: "prefab",
        v: 4,
        id: "crate",
        entities: [{ id: "mark", type: "marker", at: [0, 0] }],
      },
    })),
  };
  const maps: HostedGameGlobs = {
    projects: {
      "/src/games/platformer/jams.project.json": json("src/games/platformer/jams.project.json"),
      "/src/games/board/jams.project.json": project("board", {
        ui: { module: "./ui/index.ts", export: "mountBoardHud" },
      }),
    },
    games: {
      "/src/games/platformer/index.ts": loaders.platformer,
      "/src/games/board/index.ts": loaders.board,
    },
    uis: { "/src/games/board/ui/index.ts": loaders.boardUi },
    scenes: {
      "/src/games/platformer/scenes/test-yard.json": loaders.testYard,
      "/src/games/board/scenes/level-1.json.asset.json": loaders.boardSidecar,
      "/src/games/board/scenes/level-2.json": loaders.boardLevel2,
      "/src/games/board/scenes/level-1.json": loaders.boardLevel,
      "/src/games/board/scenes/level-1.checks.json": loaders.boardChecks,
    },
    prefabs: { "/src/games/board/scenes/prefabs/crate.json": loaders.boardPrefab },
    docs: {
      "/src/games/platformer/scene-list.json": loaders.platformerList,
      "/src/games/board/game-settings.json": loaders.boardSettings,
      "/src/games/board/scene-list.json": loaders.boardList,
      "/src/games/board/data/pieces.json": loaders.boardPieces,
    },
    sidecars: {
      "/src/games/board/scenes/level-1.json.asset.json": loaders.boardSidecar,
    },
    ...patch,
  };
  return { maps, loaders };
}

describe("hostedGamesFrom", () => {
  it("finds the platformer and a fixture project by their project files, in path order", () => {
    const warn = vi.fn();
    const { maps } = globs();
    expect(hostedGamesFrom(maps, warn).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "board", name: "Board" },
      { id: "platformer", name: "Platformer" },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("loads no game, UI, scene or prefab until load", async () => {
    const { maps, loaders } = globs();
    const [board] = hostedGamesFrom(maps, vi.fn());
    for (const loader of Object.values(loaders)) expect(loader).not.toHaveBeenCalled();

    const loaded = await board!.load();
    expect(loaded.game).toBe(boardGame);
    expect(loaded.registry.game).toBe(boardGame);
    expect(loaded.ui).toBe(mountBoardHud);
    expect([...loaded.prefabs.keys()]).toEqual(["crate"]);
    expect(loaders.boardChecks).not.toHaveBeenCalled();
    expect(loaded.project.settings).toEqual({ speed: 3 });
    expect(loaded.project.engine).toEqual({ tickRate: 30 });
    expect(loaded.project.table("piece")).toEqual([{ id: "pawn", value: 1 }]);
    expect(loaded.project.inputMap).toBeNull();
    expect(loaders.platformer).not.toHaveBeenCalled();
    expect(loaders.testYard).not.toHaveBeenCalled();
    expect(await board!.load()).toBe(loaded);
    expect(loaders.board).toHaveBeenCalledOnce();
  });

  it("resolves the platformer with no UI and its scene list's start", async () => {
    const { maps } = globs();
    const platformer = hostedGamesFrom(maps, vi.fn()).find((g) => g.id === "platformer")!;
    const { game, ui, flow, prefabs } = await platformer.load();
    const { platformerGame } = await import("@/games/platformer");
    expect(game).toBe(platformerGame);
    expect(ui).toBeNull();
    expect(flow.start()).toBe("test-yard");
    expect(flow.list()).toEqual([{ scene: "test-yard" }]);
    expect(flow.scene("test-yard")?.def.name).toBe("test-yard");
    expect(flow.scene("test-yard")?.prefabs).toBe(prefabs);
  });

  it("holds every listed scene by the id its sidecar gives, and only listed ones", async () => {
    const { maps, loaders } = globs();
    const [board] = hostedGamesFrom(maps, vi.fn());
    const { flow, prefabs } = await board!.load();
    expect(flow.start()).toBe("level-1");
    expect(flow.list()).toEqual([{ scene: "level-1", title: "Level 1" }, { scene: "missing" }]);
    expect(flow.scene("level-1")?.def.name).toBe("level-1");
    expect(flow.scene("level-1")?.prefabs).toBe(prefabs);
    expect(flow.scene("level-2")).toBeNull();
    expect(flow.scene("missing")).toBeNull();
    expect(flowIssue(flow.list(), flow.start(), "start")).toBeNull();
    expect(loaders.boardChecks).not.toHaveBeenCalled();

    const { maps: listed } = globs({
      sidecars: {
        "/src/games/board/scenes/level-1.json.asset.json": vi.fn(async () => ({
          default: { kind: "asset-sidecar", v: 1, key: "abc", id: "first" },
        })),
      },
      docs: {
        "/src/games/board/scene-list.json": vi.fn(async () => ({
          default: { kind: "scene-list", v: 1, start: "first", scenes: [{ scene: "first" }] },
        })),
      },
    });
    const [again] = hostedGamesFrom(listed, vi.fn());
    const loaded = await again!.load();
    expect(loaded.flow.scene("first")?.def.name).toBe("level-1");
    expect(loaded.flow.scene("level-1")).toBeNull();
  });

  it("gives a project without a scene list no start, which flow refuses as start-scene-missing", async () => {
    const { maps } = globs({ docs: {} });
    const [board] = hostedGamesFrom(maps, vi.fn());
    const { flow } = await board!.load();
    expect(flow.start()).toBeNull();
    expect(flow.list()).toEqual([]);
    expect(flowIssue(flow.list(), flow.start(), "start")?.code).toBe("start-scene-missing");
  });

  it("fails load when a listed scene doesn't parse", async () => {
    const { maps } = globs({
      scenes: {
        "/src/games/board/scenes/level-2.json": vi.fn(async () => ({
          default: { v: 4, name: "level-2", bounds: "wide" },
        })),
      },
      docs: {
        "/src/games/board/scene-list.json": vi.fn(async () => ({
          default: { kind: "scene-list", v: 1, start: "level-2", scenes: [{ scene: "level-2" }] },
        })),
      },
    });
    const [board] = hostedGamesFrom(maps, vi.fn());
    await expect(board!.load()).rejects.toThrow();
  });

  it("starts each site game at the start its own scene list names", async () => {
    const games = hostedGames();
    expect(games.map((g) => g.id)).toEqual(expect.arrayContaining(["platformer", "tactics"]));
    for (const hosted of games) {
      const file = `src/games/${hosted.id}/scene-list.json`;
      expect(existsSync(file), file).toBe(true);
      const { start } = json(file) as { start: string };
      const { flow } = await hosted.load();
      expect(flow.start(), hosted.id).toBe(start);
      expect(flow.scene(start)?.def, hosted.id).toBeDefined();
    }
    expect((await hostedGame("platformer")!.load()).flow.start()).toBe("test-yard");
  });

  it("warns about and skips a project whose game or UI module isn't at the standard path", () => {
    const warn = vi.fn();
    const { maps } = globs({
      projects: {
        "/src/games/elsewhere/jams.project.json": project("elsewhere", {
          game: { module: "./src/game.ts", export: "elsewhereGame" },
        }),
        "/src/games/oddui/jams.project.json": project("oddui", {
          ui: { module: "./hud.ts", export: "mountHud" },
        }),
        "/src/games/missing/jams.project.json": project("missing"),
        "/src/games/broken/jams.project.json": { kind: "project", v: 1 },
        "/src/games/gameless/jams.project.json": project("gameless", { game: null }),
      },
      games: {
        "/src/games/elsewhere/index.ts": vi.fn(),
        "/src/games/oddui/index.ts": vi.fn(),
      },
    });
    expect(hostedGamesFrom(maps, warn)).toEqual([]);
    const said = warn.mock.calls.map(([m]) => m as string);
    expect(said).toHaveLength(4);
    expect(said.find((m) => m.includes('"elsewhere"'))).toContain("./src/game.ts");
    expect(said.find((m) => m.includes('"oddui"'))).toContain("./hud.ts");
    expect(said.some((m) => m.includes('"missing"'))).toBe(true);
    expect(said.some((m) => m.includes("broken/jams.project.json"))).toBe(true);
  });

  it("fails load when the game module lacks the named export, and loads again after", async () => {
    const { maps, loaders } = globs();
    loaders.board.mockResolvedValueOnce({} as never);
    const [board] = hostedGamesFrom(maps, vi.fn());
    await expect(board!.load()).rejects.toThrow('exports no "boardGame"');
    expect((await board!.load()).game).toBe(boardGame);
  });

  it("gives a project without docs its game's defaults", async () => {
    const { maps } = globs({ docs: {} });
    const [board] = hostedGamesFrom(maps, vi.fn());
    const { project } = await board!.load();
    expect(project.settings).toEqual({ speed: 1 });
    expect(project.table("piece")).toEqual([]);
  });

  it("loads tactics with its unit classes, game settings and input map from its own files", async () => {
    const { UNIT_CLASS_TABLE } = await import("@/games/tactics");
    const { project } = await hostedGame("tactics")!.load();
    const classes = json("src/games/tactics/data/unit-classes.json") as { rows: { id: string }[] };
    expect(project.table(UNIT_CLASS_TABLE).map((r) => r.id)).toEqual(classes.rows.map((r) => r.id));
    expect(project.settings).toMatchObject({ aiStepTicks: 20, critChance: 0.1 });
    expect(project.inputMap?.deadzone).toBe(0.3);
  });

  it("reads a binary from its sidecar and serves a texture at the build's URL", async () => {
    const texture = {
      kind: "asset-sidecar",
      v: 1,
      key: "k-board",
      id: "board-art",
      sha256: "a".repeat(64),
      bytes: 10,
      import: { filter: "nearest" },
      meta: { format: "png", width: 32, height: 16 },
    };
    const sidecar = (value: unknown) => vi.fn(async () => ({ default: value }));
    const { maps } = globs({
      sidecars: {
        "/src/games/board/art/board.png.asset.json": sidecar(texture),
        "/src/games/board/art/gone.png.asset.json": sidecar({
          ...texture,
          key: "k-gone",
          id: "gone",
          sha256: "b".repeat(64),
        }),
        "/src/games/board/game-settings.json.asset.json": sidecar({
          kind: "asset-sidecar",
          v: 1,
          id: "board-settings",
        }),
      },
      urls: { "/src/games/board/art/board.png": "/assets/board-123.png" },
    });
    const [board] = hostedGamesFrom(maps, vi.fn());
    const { project, assets } = await board!.load();
    expect(assets).not.toBeNull();
    const entry = assets!.view.byId.get("board-art")!;
    expect(entry).toMatchObject({
      kind: "texture",
      path: "art/board.png",
      import: { filter: "nearest" },
    });
    expect(
      assets!.url("board", { id: "board-art", kind: "texture", sha256: entry.sha256!, bytes: 10 }),
    ).toBe("/assets/board-123.png");
    expect(assets!.view.byId.has("gone")).toBe(false);
    expect(assets!.view.byId.get("board-settings")?.path).toBe("game-settings.json");
    expect(assets!.kinds.get("texture")).toBeDefined();
    expect(project.asset("board-art")).toMatchObject({ size: [32, 16], filter: "nearest" });
    expect(project.settings).toEqual({ speed: 3 });
  });

  it("gives a project with no textures no assets to fetch", async () => {
    const { maps } = globs();
    const [board] = hostedGamesFrom(maps, vi.fn());
    expect((await board!.load()).assets).toBeNull();
  });

  it("serves tactics' sprites and tiles, and reads its project as its golden pin does", async () => {
    const { tacticsGame, UNIT_CLASS_TABLE } = await import("@/games/tactics");
    const { project, assets } = await hostedGame("tactics")!.load();
    expect(assets).not.toBeNull();
    const textures = [...assets!.view.byId.values()].filter((e) => e.kind === "texture");
    expect(textures.map((e) => e.id)).toEqual(expect.arrayContaining(["units-texture", "tiles"]));
    for (const e of textures) {
      const url = assets!.url("tactics", {
        id: e.id,
        kind: e.kind,
        sha256: e.sha256!,
        bytes: e.bytes!,
      });
      expect(url, e.id).toMatch(/\.png(?:\?|$)/);
    }
    expect(project.asset("units", "knight-blue")).toMatchObject({ texture: "units-texture" });

    const pinned = tacticsPinnedView(tacticsGame);
    expect(pinned.settings).toEqual(project.settings);
    expect(pinned.engine).toEqual(project.engine);
    expect(pinned.inputMap).toEqual(project.inputMap);
    expect(pinned.table(UNIT_CLASS_TABLE)).toEqual(project.table(UNIT_CLASS_TABLE));
    for (const id of assets!.view.byId.keys())
      expect(pinned.asset(id), id).toEqual(project.asset(id));
  });

  it("finds the site's own games from the real globs, the platformer among them", () => {
    expect(hostedGames().map((g) => g.id)).toContain("platformer");
    expect(hostedGame("platformer")?.name).toBe("Platformer");
    expect(hostedGame("no-such-game")).toBeNull();
  });
});

describe("gameCodeChanged", () => {
  const game = (id: string, load: HostedGame["load"]): HostedGame => ({
    id,
    name: id,
    load,
    debugLayers: async () => [],
  });

  it("is false when every loaded game loads the same game and UI again", async () => {
    const { maps } = globs();
    const [board] = hostedGamesFrom(maps, vi.fn());
    const { game: g, ui } = await board!.load();
    const again = hostedGamesFrom(globs().maps, vi.fn());
    const find = (id: string) => again.find((h) => h.id === id) ?? null;
    expect(await gameCodeChanged(new Map([["board", { game: g, ui }]]), find)).toBe(false);
  });

  it("is true when a loaded game now loads another game, or none, or fails", async () => {
    const was = new Map([["board", { game: boardGame, ui: null }]]);
    const other = defineGame({
      id: "board",
      types: [],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const loading = (value: unknown) => () => game("board", async () => value as never);
    expect(await gameCodeChanged(was, loading({ game: other, ui: null }))).toBe(true);
    expect(await gameCodeChanged(was, () => null)).toBe(true);
    expect(
      await gameCodeChanged(was, () => game("board", () => Promise.reject(new Error("syntax")))),
    ).toBe(true);
    expect(await gameCodeChanged(new Map(), () => null)).toBe(false);
  });
});
