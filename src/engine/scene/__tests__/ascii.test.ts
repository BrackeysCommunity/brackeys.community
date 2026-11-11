import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ENGINE_YARD_EXPANDED } from "../../__tests__/fixtures/engine-yard.expanded";
import { generateScene } from "../../__tests__/fixtures/generate-scene";
import { PAINT, testGame } from "../../__tests__/fixtures/test-game";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  RegistryError,
  withProject,
} from "../../game/define";
import { shapeField } from "../../game/fields";
import { primitiveFields } from "../../game/primitives";
import { projectView } from "../../project/view";
import {
  createProjectFileAdapter,
  readFileProject,
  readPrefabFiles,
} from "../../vite/project-files";
import { renderSceneAscii, sceneAsciiMap } from "../ascii";
import { parseScene, parseSceneOrThrow } from "../parse";
import { SCENE_GRID_MAX_CELLS } from "../svg";
import { SCENE_FORMAT_VERSION, type GridSettings, type SceneDefinition } from "../types";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);
const golden = new URL("./engine-yard.golden.txt", import.meta.url);

const legendOf = (map: { legend: { char: string; label: string }[] }) =>
  Object.fromEntries(map.legend.map((l) => [l.char, l.label]));

describe("renderSceneAscii", () => {
  it("matches the golden map of engine-yard (UPDATE_GOLDENS=1 regenerates)", () => {
    const text = renderSceneAscii(yard, { registry: engine });
    if (process.env.UPDATE_GOLDENS) writeFileSync(golden, text);
    expect(text).toBe(readFileSync(golden, "utf8"));
    expect(renderSceneAscii(ENGINE_YARD_EXPANDED, { registry: engine })).toBe(text);
  });

  it("puts each entity in its cells: solids, one-way, paths, tags and points", () => {
    const map = sceneAsciiMap(yard, { registry: engine });
    expect([map.cols, map.rows, map.cell]).toEqual([32, 16, 64]);
    const at = (x: number, y: number) => map.lines[Math.floor(y / 64)]![Math.floor(x / 64)];
    expect(at(1000, 980)).toBe("#");
    expect(at(1400, 800)).toBe("=");
    expect(at(1700, 700)).toBe("~");
    expect(at(1700, 900)).toBe("F");
    expect(at(900, 930)).toBe("G");
    expect(at(300, 960)).toBe("S");
    expect(at(1200, 940)).toBe("p");
    expect(at(600, 500)).toBe(".");
    expect(legendOf(map)).toEqual({
      "#": "solid",
      "~": "path",
      "=": "solid one-way",
      F: "follower",
      p: "prop",
      G: "sensor [goal]",
      S: "marker [spawn]",
    });
  });

  it("takes its characters from the types: the type's own, its base's, else its first letter", () => {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "fake",
      name: "fake-yard",
      bounds: [0, 0, 5.12, 1.28],
      pad: [["box", 0.32, 0.32, 0.3, 0.3]],
      flag: [[0.96, 0.32]],
      entities: [
        { id: "b", type: "button", shape: ["box", 1.6, 0.32, 0.3, 0.3] },
        { id: "d", type: "door", shape: ["box", 2.24, 0.32, 0.3, 0.3], speed: 1 },
        { id: "t", type: "button", shape: ["box", 2.88, 0.32, 0.3, 0.3], tags: ["hazard"] },
      ],
    };
    const map = sceneAsciiMap(def, { registry: fake });
    expect(map.lines[0]).toBe("#+sdx...");
    expect(legendOf(map)).toEqual({
      "#": "pad",
      "+": "flag",
      s: "button",
      d: "door",
      x: "button [hazard]",
    });
    expect(sceneAsciiMap(def, { registry: fake, tagChars: {} }).lines[0]).toBe("#+sds...");

    const game = defineGame({
      id: "lettered",
      types: [
        defineEntityType({
          type: "lava",
          description: "Lava.",
          base: "sensor",
          fields: (env) => primitiveFields("sensor", env),
          ascii: "~",
        }),
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const lettered = {
      ...def,
      game: "lettered",
      pad: undefined,
      flag: undefined,
      entities: [{ id: "l", type: "lava", shape: ["box", 0.32, 0.32, 0.3, 0.3] }],
    } as SceneDefinition;
    expect(sceneAsciiMap(lettered, { registry: createRegistry(game) }).lines[0]).toBe("~.......");
  });

  it("rejects a type whose ascii isn't one printable character", () => {
    const bad = (ascii: string) =>
      createRegistry(
        defineGame({
          id: "bad",
          types: [
            defineEntityType({
              type: "blob",
              description: "A blob.",
              base: "marker",
              fields: (env) => primitiveFields("marker", env),
              ascii,
            }),
          ],
          actions: [],
          createRuntime: () => ({ snapshot: () => null }),
        }),
      );
    expect(() => bad("ab")).toThrow(RegistryError);
    expect(() => bad(" ")).toThrow(/one printable ASCII character/);
    expect(() => bad("b")).not.toThrow();
  });

  it("frames a region (in metres) or an entity on cell lines (in world px), with spaces outside the scene", () => {
    const map = sceneAsciiMap(yard, { registry: engine, around: "lift" });
    expect(map.region).toEqual([1472, 448, 1920, 1088]);
    expect(map.lines.at(-1)).toBe("       ");
    expect(map.lines.at(-2)).toBe("#######");
    const region = sceneAsciiMap(yard, { registry: engine, region: [-1, 9, 3.3, 10] });
    expect(region.region).toEqual([-128, 896, 384, 1024]);
    expect(region.lines).toEqual(["  #...p.", "  ####S#"]);
  });

  it("grows its cells in steps of 64 to stay within maxCells", () => {
    const huge: SceneDefinition = { ...generateScene(2), bounds: [0, 0, 1000, 100] };
    const map = sceneAsciiMap(huge, { registry: engine });
    expect(map.cell).toBe(512);
    expect(map.cols).toBeLessThanOrEqual(200);
    expect(sceneAsciiMap(huge, { registry: engine, maxCells: 50 }).cell).toBe(2048);
  });

  it("marks a playtest's trail and outcome", () => {
    const map = sceneAsciiMap(yard, {
      registry: engine,
      overlay: {
        trail: {
          pts: [
            [3, 7],
            [7, 7],
          ],
        },
        outcome: { result: "won", at: { x: 7, y: 7 } },
      },
    });
    expect(map.lines[10]).toBe("#...******!...............~...##");
    expect(legendOf(map)).toMatchObject({ "*": "trail", "!": "outcome won" });
  });
});

describe("one-way solids", () => {
  const box = (x: number, oneWay?: unknown) => ({
    id: `b${x}`,
    type: "solid",
    shape: ["box", 0.32 + x * 0.64, 0.32, 0.3, 0.3],
    ...(oneWay === undefined ? {} : { oneWay }),
  });
  const def = {
    v: SCENE_FORMAT_VERSION,
    name: "sides",
    bounds: [0, 0, 5.12, 0.64],
    entities: [
      box(0, "up"),
      box(1, "right"),
      box(2, "down"),
      box(3, "left"),
      box(4, true),
      box(5, "sideways"),
      box(6),
    ],
  } as unknown as SceneDefinition;

  it("marks every side the way the edit overlay and the SVG do, and nothing else", () => {
    const map = sceneAsciiMap(def, { registry: engine });
    expect(map.lines[0]).toBe("=====##.");
    expect(legendOf(map)).toEqual({ "=": "solid one-way", "#": "solid" });
  });

  it("marks a type one-way through its metadata alone", () => {
    const ledges = createRegistry(
      defineGame({
        id: "ledges",
        types: [
          defineEntityType({
            type: "ledge",
            description: "A ledge its system makes one-way, with no oneWay field.",
            fields: { shape: shapeField("Ledge shape.") },
            system: () => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 }),
            oneWay: true,
            ascii: "L",
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const map = sceneAsciiMap(
      { ...def, game: "ledges", entities: [{ ...box(0), type: "ledge" }, box(1)] },
      { registry: ledges },
    );
    expect(map.lines[0]).toBe("=#......");
    expect(legendOf(map)).toEqual({ "=": "ledge one-way", "#": "solid" });
  });
});

describe("metres and px per metre", () => {
  it("maps a v3 scene migrated to metres as its v3 file mapped at 100 px per metre", () => {
    const text = readFileSync(new URL("./fixtures/v3/engine-yard.json", import.meta.url), "utf8");
    const migrated = parseScene(text, engine);
    expect(migrated.ok && migrated.migratedFrom).toBe(3);
    expect(renderSceneAscii(migrated.ok ? migrated.def : yard, { registry: engine })).toBe(
      readFileSync(golden, "utf8"),
    );
  });

  it("samples world metres at the game's px per metre, its cells and ruler in world px", () => {
    const registry = createRegistry(
      defineGame({
        id: "coarse",
        types: [],
        actions: [],
        world: { lengthUnit: 32 },
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const map = sceneAsciiMap(
      {
        v: SCENE_FORMAT_VERSION,
        game: "coarse",
        name: "metre",
        bounds: [0, 0, 10, 5],
        entities: [{ id: "block", type: "solid", shape: ["box", 3, 1, 1, 1] }],
      },
      { registry, cell: 32 },
    );
    expect(map).toMatchObject({ pxPerMetre: 32, cell: 32, cols: 10, rows: 5 });
    expect(map.region).toEqual([0, 0, 320, 160]);
    expect(map.lines[0]).toBe("..##......");
    expect(map.lines[1]).toBe("..##......");
    expect(map.lines[2]).toBe("..........");
  });
});

describe("grid fields", () => {
  const game = createRegistry(testGame);
  const paintScene = (
    cells: Record<string, string[]>,
    grid: GridSettings,
    at: [number, number],
    bounds: [number, number, number, number] = [0, 0, 10.24, 7.68],
  ): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    game: game.id,
    name: "paint",
    bounds,
    settings: { grid },
    entities: [{ id: "floor", type: PAINT.type, at, cells }],
  });
  const charOf = (map: { legend: { char: string; label: string }[] }) =>
    map.legend.find((l) => l.label.startsWith(PAINT.type))!.char;

  it("draws a painted entity's filled cells in its character, at its at", () => {
    const map = sceneAsciiMap(
      paintScene(
        { "0,0": ["1*3", "", "0,2"] },
        { kind: "square", cell: [0.64, 0.64] },
        [0.64, 5.76],
      ),
      { registry: game },
    );
    const t = charOf(map);
    expect(map.lines[9]!.slice(0, 5)).toBe(`.${t.repeat(3)}.`);
    expect(map.lines[10]!.slice(0, 5)).toBe(".....");
    expect(map.lines[11]!.slice(0, 5)).toBe(`..${t}..`);
  });

  it("marks the map cell under each grid cell smaller than a map cell", () => {
    const map = sceneAsciiMap(
      paintScene({ "0,0": ["0*5,1"] }, { kind: "square", cell: [0.16, 0.16] }, [0, 0]),
      { registry: game },
    );
    const t = charOf(map);
    // The point at [0, 0] and the cell at x 80..96.
    expect(map.lines[0]!.slice(0, 3)).toBe(`${t}${t}.`);
  });

  it(`stops at ${SCENE_GRID_MAX_CELLS} cells and marks the rest with "…"`, () => {
    const chunk = Array.from({ length: 32 }, () => "1*32");
    const edge = Array.from({ length: 32 }, () => "1*4");
    const cells: Record<string, string[]> = {};
    for (let cy = 0; cy < 4; cy++)
      for (let cx = 0; cx < 4; cx++) {
        const rows = cx === 3 ? edge : chunk;
        cells[`${cx},${cy}`] = cy === 3 ? rows.slice(0, 4) : rows;
      }
    const map = sceneAsciiMap(
      paintScene(cells, { kind: "square", cell: [0.08, 0.08] }, [0, 0], [0, 0, 8, 8]),
      { registry: game, cell: 8 },
    );
    const t = charOf(map);
    expect([map.cols, map.rows]).toEqual([100, 100]);
    const count = map.lines.join("").split(t).length - 1;
    expect(count).toBe(SCENE_GRID_MAX_CELLS);
    expect(map.lines[39]).toBe(t.repeat(100));
    expect(map.lines[40]).toBe(`${t.repeat(96)}…...`);
    expect(map.lines[41]).toBe(".".repeat(100));
    expect(legendOf(map)["…"]).toBe("5904 more grid cells, not drawn");
  });

  it("leaves the goldens alone: a scene without grid fields draws as before", () => {
    expect(renderSceneAscii(yard, { registry: engine })).toBe(readFileSync(golden, "utf8"));
  });
});

describe("sprite boxes", () => {
  const sprites = parseSceneOrThrow(
    readFileSync(new URL("./fixtures/sprites.json", import.meta.url), "utf8"),
    engine,
  );
  const spritesGolden = new URL("./sprites.golden.txt", import.meta.url);
  const at = (map: { lines: string[] }, col: number, row: number) => map.lines[row]![col];

  it("matches the golden map of the sprite fixture (UPDATE_GOLDENS=1 regenerates)", () => {
    const text = renderSceneAscii(sprites, { registry: engine, cell: 16 });
    if (process.env.UPDATE_GOLDENS) writeFileSync(spritesGolden, text);
    expect(text).toBe(readFileSync(spritesGolden, "utf8"));
  });

  it("marks a sprite's box with its entity type's character", () => {
    const map = sceneAsciiMap(sprites, { registry: engine, cell: 16 });
    // The tree's box (408..504, 160..288) is all marker; the point itself is one cell of it.
    expect(at(map, 26, 10)).toBe("+");
    expect(at(map, 31, 17)).toBe("+");
    expect(at(map, 24, 12)).toBe(".");
    expect(legendOf(map)["+"]).toBe("marker");
  });

  it("marks under bodies and points: a sprite never takes a cell from them", () => {
    const count = (def: SceneDefinition, char: string) =>
      sceneAsciiMap(def, { registry: engine, cell: 16 }).lines.join("").split(char).length - 1;
    const bare = structuredClone(sprites);
    bare.entities = bare.entities!.map(({ behaviors: _, ...e }) => e);
    expect(count(sprites, "+")).toBeGreaterThan(count(bare, "+") + 20);
    expect(count(sprites, "#")).toBe(count(bare, "#"));
    // The floor and the spawn keep their cells.
    const map = sceneAsciiMap(sprites, { registry: engine, cell: 16 });
    expect(at(map, 6, 18)).toBe("S");
    expect(map.lines[19]).toBe("#".repeat(40));
  });

  it("marks the cell under a sprite smaller than a cell", () => {
    const def = structuredClone(sprites);
    def.entities = [
      { id: "dot", type: "marker", at: [0.4, 0.4], behaviors: { sprite: { size: [0.04, 0.04] } } },
    ];
    const map = sceneAsciiMap(def, { registry: engine, cell: 64 });
    expect(at(map, 0, 0)).toBe("+");
  });
});

/** The engine project's kitchen sink with its prefabs, and the project view and registry it is drawn with. */
async function loadKitchenSink() {
  const dir = fileURLToPath(new URL("../../scenes/", import.meta.url));
  const cacheDir = await mkdtemp(join(tmpdir(), "kitchen-sink-render-"));
  try {
    const project = await readFileProject(dir, { cacheDir });
    const { state } = await createProjectFileAdapter(project).scan();
    const view = projectView(state, project.kinds);
    const values = new Map<string, unknown>();
    for (const entry of view.byId.values())
      if (entry.sha256 === undefined)
        values.set(entry.id, JSON.parse(await readFile(join(dir, entry.path), "utf8")));
    const registry = withProject(createRegistry(), view, values);
    const { prefabs } = await readPrefabFiles(dir, registry);
    const scene = parseSceneOrThrow(values.get("kitchen-sink"), registry, {
      prefab: (id) => prefabs.get(id),
    });
    return { scene, view, registry, prefabs };
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

describe("the kitchen sink", () => {
  const sinkGolden = new URL("./kitchen-sink.golden.txt", import.meta.url);
  let sink: Awaited<ReturnType<typeof loadKitchenSink>>;
  beforeAll(async () => {
    sink = await loadKitchenSink();
  });

  it("matches its golden map, sprites sized from the project (UPDATE_GOLDENS=1 regenerates)", () => {
    const opts = { registry: sink.registry, prefabs: sink.prefabs, project: sink.view, cell: 32 };
    const text = renderSceneAscii(sink.scene, opts);
    if (process.env.UPDATE_GOLDENS) writeFileSync(sinkGolden, text);
    expect(text).toBe(readFileSync(sinkGolden, "utf8"));
    expect(renderSceneAscii(sink.scene, opts)).toBe(text);
  });
});
