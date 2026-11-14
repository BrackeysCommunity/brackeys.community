import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ENGINE_YARD_EXPANDED } from "../../__tests__/fixtures/engine-yard.expanded";
import { generateScene } from "../../__tests__/fixtures/generate-scene";
import { PAINT, testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineEntityType, defineGame, withProject } from "../../game/define";
import { shapeField } from "../../game/fields";
import { primitiveFields } from "../../game/primitives";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import { createDataSystem } from "../../systems/data";
import {
  createProjectFileAdapter,
  readFileProject,
  readPrefabFiles,
} from "../../vite/project-files";
import { parseScene, parseSceneOrThrow } from "../parse";
import { drawnEntities, expandedOf, oneWayEdges } from "../render-geometry";
import { shapeOutline } from "../shape-outline";
import {
  renderSceneSvg,
  SCENE_GRID_MAX_CELLS,
  SCENE_SVG_MAX_SIZE,
  sceneViewport,
  svgPathData,
} from "../svg";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type GridSettings,
  type Prefab,
  type SceneDefinition,
} from "../types";
import { roundLength } from "../units";
import { engine, engineYardText } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);
const golden = new URL("./engine-yard.golden.svg", import.meta.url);

const roundBox = (b: Aabb): Aabb => ({
  minX: roundLength(b.minX),
  minY: roundLength(b.minY),
  maxX: roundLength(b.maxX),
  maxY: roundLength(b.maxY),
});

const size = (svg: string) => {
  const m = /<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** A `PlaytestReport`'s overlay fields, as the playtest would write them. */
const report = {
  issues: [
    {
      severity: "warn" as const,
      code: "out-of-bounds" as const,
      entityIds: ["crate"],
      message: "x",
    },
    {
      severity: "error" as const,
      code: "test/pit" as const,
      message: "y",
      entityIds: [],
      at: [6.4, 9] as [number, number],
    },
  ],
  trail: {
    every: 4,
    pts: [
      [3, 9.4],
      [5, 9.4],
      [8.8, 9.3],
    ] as [number, number][],
    truncated: false,
  },
  events: [
    { tick: 3, type: "sensor:enter", entityId: "zone", other: "avatar", at: { x: 8.8, y: 9.3 } },
    { tick: 9, type: "landed", at: { x: 4, y: 9.4 } },
  ],
  outcome: { result: "won", tick: 90, at: { x: 8.8, y: 9.3 }, cause: "reached the goal" },
};

describe("renderSceneSvg", () => {
  it("matches the golden render of engine-yard (UPDATE_GOLDENS=1 regenerates)", () => {
    const svg = renderSceneSvg(yard, { registry: engine });
    if (process.env.UPDATE_GOLDENS) writeFileSync(golden, svg);
    expect(svg).toBe(readFileSync(golden, "utf8"));
  });

  it("draws the same from a document and from its expansion, every time", () => {
    const a = renderSceneSvg(yard, { registry: engine, labels: "all" });
    expect(renderSceneSvg(ENGINE_YARD_EXPANDED, { registry: engine, labels: "all" })).toBe(a);
    expect(renderSceneSvg(structuredClone(yard), { registry: engine, labels: "all" })).toBe(a);
    expect(a).not.toMatch(/NaN|Infinity|\de[-+]\d/);
  });

  it("draws every entity through its outline in its type's colors", () => {
    const svg = renderSceneSvg(yard, { registry: engine });
    for (const id of ["~solid:0", "ledge", "avatar", "crate", "lift", "zone", "start"]) {
      expect(svg).toContain(`data-ref="${id}"`);
    }
    expect(svg).not.toContain(`data-ref="readme"`);
    expect(svg).toMatch(
      /data-ref="ledge" data-type="solid" d="M1280 790L1520 790L1520 810L1280 810Z" fill="#445566"/,
    );
    expect(svg).toMatch(/data-ref="zone"[^>]*fill="#44cc88" fill-opacity="0.3"/);
    expect(svg).toMatch(/data-ref="crate"[^>]*d="M1220 940A20 20 0 0 1/);
    expect(svg).toContain(`class="spawn"`);
  });

  it("lets a material's style win over its type's", () => {
    const game = defineGame({
      id: "styled",
      types: [
        defineEntityType({
          type: "slab",
          description: "A slab.",
          base: "solid",
          fields: (env) => primitiveFields("solid", env),
          style: { fill: 0x112233, stroke: 0x445566 },
        }),
      ],
      actions: [],
      materials: {
        ice: { friction: 0, restitution: 0, description: "Ice.", style: { fill: 0x88ddff } },
      },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const registry = createRegistry(game);
    const def: SceneDefinition = {
      v: 1,
      game: "styled",
      name: "slabs",
      bounds: [0, 0, 400, 200],
      entities: [
        { id: "plain", type: "slab", shape: ["box", 100, 100, 50, 10] },
        { id: "icy", type: "slab", shape: ["box", 300, 100, 50, 10], material: "ice" },
      ],
    };
    const svg = renderSceneSvg(def, { registry });
    expect(svg).toMatch(/data-ref="plain"[^>]*fill="#112233"[^>]*stroke="#445566"/);
    expect(svg).toMatch(/data-ref="icy"[^>]*fill="#88ddff"[^>]*stroke="#445566"/);
  });

  it("labels entities with ids, adds bulk refs with all, and nothing with none", () => {
    const labelled = (labels: "entities" | "all" | "none") => {
      const svg = renderSceneSvg(yard, { registry: engine, labels });
      const group = /<g id="labels"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
      return [...group.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
    };
    expect(labelled("entities")).toEqual(["ledge", "zone", "start", "avatar", "crate", "lift"]);
    expect(labelled("all")).toEqual(["~solid:0", "~solid:1", "~solid:2", ...labelled("entities")]);
    expect(labelled("none")).toEqual([]);
  });

  it("draws axis ticks every 64 or 128px at readable sizes, and more widely on big scenes", () => {
    const at = (scale: number) => sceneViewport(yard, { registry: engine, scale }).tick;
    expect(at(1)).toBe(64);
    expect(at(0.5)).toBe(128);
    expect(at(0.1)).toBe(512);
    const svg = renderSceneSvg(yard, { registry: engine });
    const ticks = /<g id="ticks"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
    expect(ticks).toContain(">512</text>");
    expect(ticks).toContain(">640</text>");
  });

  it("draws path waypoints with numbered ghosts, unless paths is false", () => {
    const svg = renderSceneSvg(yard, { registry: engine });
    const path = /<g data-path="lift"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
    expect(path).toContain("M1700 900L1700 600");
    expect(path).toContain("M1640 592L1760 592L1760 608L1640 608Z");
    expect([...path.matchAll(/>(\d+)<\/text>/g)].map((m) => m[1])).toEqual(["0", "1"]);
    expect(renderSceneSvg(yard, { registry: engine, paths: false })).not.toContain("data-path");
  });

  it("overlays a playtest report (in metres): issues, trail, events and outcome", () => {
    const svg = renderSceneSvg(yard, { registry: engine, overlay: report });
    expect(svg).toContain(`<g id="trail"><path d="M300 940L500 940L880 930"`);
    expect(svg).toMatch(/<circle cx="880" cy="930"[^>]*data-event="sensor:enter" data-tick="3"/);
    expect(svg).toContain("landed ×1");
    expect(svg).toMatch(/<g id="outcome" data-result="won">[\s\S]*won @90 reached the goal/);
    expect(svg).toMatch(/data-issue="out-of-bounds" data-severity="warn"><rect x="1172.5"/);
    expect(svg).toMatch(/data-issue="test\/pit" data-severity="error"><circle cx="640" cy="900"/);
    expect(renderSceneSvg(yard, { registry: engine })).not.toContain(`id="overlay"`);
  });
});

/** One box per landing side, a plain `true`, a value that isn't a side, and a two-way box. */
const sidesScene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "sides",
  bounds: [0, 0, 8, 2],
  entities: [
    { id: "up", type: "solid", shape: ["box", 1, 1, 0.5, 0.25], oneWay: "up" },
    { id: "right", type: "solid", shape: ["box", 2, 1, 0.25, 0.5], oneWay: "right" },
    { id: "down", type: "solid", shape: ["box", 3, 1, 0.5, 0.25], oneWay: "down" },
    { id: "left", type: "solid", shape: ["box", 4, 1, 0.25, 0.5], oneWay: "left" },
    { id: "plain", type: "solid", shape: ["box", 5, 1, 0.5, 0.25], oneWay: true },
    { id: "odd", type: "solid", shape: ["box", 6, 1, 0.5, 0.25], oneWay: "sideways" },
    { id: "two-way", type: "solid", shape: ["box", 7, 1, 0.5, 0.25] },
  ],
} as unknown as SceneDefinition;

describe("one-way landing faces", () => {
  const svg = renderSceneSvg(sidesScene, { registry: engine });
  const face = (id: string) =>
    new RegExp(`<path data-one-way="${id}" data-side="(\\w+)" d="([^"]+)"/>`).exec(svg);

  it.each([
    ["up", "up", "M50 75L150 75"],
    ["right", "right", "M225 50L225 150"],
    ["down", "down", "M350 125L250 125"],
    ["left", "left", "M375 150L375 50"],
    ["plain", "up", "M450 75L550 75"],
  ])("draws %s's landing face on its %s side, where the edit overlay marks it", (id, side, d) => {
    const m = face(id);
    expect(m?.[1]).toBe(side);
    expect(m?.[2]).toBe(d);
    const drawn = drawnEntities(expandedOf(sidesScene, engine), engine);
    const edge = oneWayEdges(drawn).find((e) => e.entity.id === id)!;
    expect(edge.side).toBe(side);
  });

  it("draws no face for a value that isn't a side or a two-way solid", () => {
    expect(face("odd")).toBeNull();
    expect(face("two-way")).toBeNull();
    expect(svg.match(/data-one-way=/g)).toHaveLength(5);
  });

  it("draws the faces over the entities and draws none without one-way solids", () => {
    expect(svg.indexOf(`<g id="one-way"`)).toBeGreaterThan(svg.indexOf(`<g id="entities"`));
    const twoWay = { ...sidesScene, entities: (sidesScene.entities ?? []).slice(-1) };
    expect(renderSceneSvg(twoWay, { registry: engine })).not.toContain(`id="one-way"`);
  });
});

describe("one-way types", () => {
  const ledges = createRegistry(
    defineGame({
      id: "ledges",
      types: [
        defineEntityType({
          type: "ledge",
          description: "A ledge its system makes one-way, with no oneWay field.",
          fields: { shape: shapeField("Ledge shape.") },
          system: createDataSystem,
          oneWay: "right",
        }),
      ],
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const def = {
    v: SCENE_FORMAT_VERSION,
    game: "ledges",
    name: "ledges",
    bounds: [0, 0, 4, 2],
    entities: [{ id: "l", type: "ledge", shape: ["box", 2, 1, 0.25, 0.5] }],
  } as unknown as SceneDefinition;

  it("draws a type's landing face from its metadata alone", () => {
    expect(renderSceneSvg(def, { registry: ledges })).toContain(
      `<path data-one-way="l" data-side="right" d="M225 50L225 150"/>`,
    );
  });
});

describe("metres and px per metre", () => {
  const fixture = (v: 3 | 4) =>
    readFileSync(new URL(`./fixtures/v${v}/engine-yard.json`, import.meta.url), "utf8");

  it("draws a v3 scene migrated to metres as its v3 file drew at 100 px per metre", () => {
    const migrated = parseScene(fixture(3), engine);
    expect(migrated.ok && migrated.migratedFrom).toBe(3);
    const v4 = parseSceneOrThrow(fixture(4), engine);
    expect(migrated.ok && migrated.def).toEqual(v4);
    expect(renderSceneSvg(v4, { registry: engine })).toBe(readFileSync(golden, "utf8"));
  });

  it("draws world metres at the game's px per metre, and reports the region in metres", () => {
    const game = defineGame({
      id: "coarse",
      types: [],
      actions: [],
      world: { lengthUnit: 32 },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const registry = createRegistry(game);
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "coarse",
      name: "metre",
      bounds: [0, 0, 10, 5],
      entities: [{ id: "block", type: "solid", shape: ["box", 1, 1, 0.5, 0.5] }],
    };
    const svg = renderSceneSvg(def, { registry });
    expect(svg).toContain(`viewBox="0 0 320 160"`);
    expect(svg).toMatch(/data-ref="block" data-type="solid" d="M16 16L48 16L48 48L16 48Z"/);
    expect(sceneViewport(def, { registry, around: "block", margin: 0.5 })).toMatchObject({
      region: [0, 0, 2, 2],
      pxPerMetre: 32,
    });
  });
});

describe("camera regions", () => {
  it("draws the box a turned region frames, dashed and unfilled, not its turned outline", () => {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "regions",
      bounds: [0, 0, 8, 8],
      entities: [
        { id: "hall", type: "camera-region", shape: ["box", 4, 4, 2, 2, 45] },
        { id: "room", type: "camera-region", shape: ["box", 4, 4, 2, 1] },
      ],
    };
    const svg = renderSceneSvg(def, { registry: createRegistry() });
    expect(svg).toMatch(
      /data-ref="hall" data-type="camera-region" stroke-dasharray="[^"]+" d="M117\.16 117\.16L682\.84 117\.16L682\.84 682\.84L117\.16 682\.84Z" fill="none"/,
    );
    expect(svg).toMatch(/data-ref="room" [^>]* d="M200 300L600 300L600 500L200 500Z" fill="none"/);
  });
});

describe("the render's size", () => {
  it("is the region times the scale", () => {
    expect(size(renderSceneSvg(yard, { registry: engine }))).toEqual([1600, 800]);
    expect(size(renderSceneSvg(yard, { registry: engine, scale: 0.5 }))).toEqual([1000, 500]);
    expect(sceneViewport(yard, { registry: engine, region: [0, 0, 4, 3], scale: 2 })).toMatchObject(
      { region: [0, 0, 4, 3], pxPerMetre: 100, width: 800, height: 600, scale: 2 },
    );
  });

  it(`never passes ${SCENE_SVG_MAX_SIZE}px on its longest side, however big the scene`, () => {
    const huge: SceneDefinition = {
      ...generateScene(3),
      name: "huge",
      bounds: [-50_000, 0, 150_000, 40_000],
    };
    const svg = renderSceneSvg(huge, { registry: engine, scale: 4 });
    expect(size(svg)).toEqual([1600, 320]);
    const tall = { ...huge, bounds: [0, 0, 300, 90_000] as SceneDefinition["bounds"] };
    expect(size(renderSceneSvg(tall, { registry: engine }))).toEqual([5, 1600]);
    expect(Math.max(...size(renderSceneSvg(generateScene(1), { registry: engine }))!)).toBe(1600);
  });

  it("frames around an entity with a margin in metres, path included", () => {
    const vp = sceneViewport(yard, { registry: engine, around: "lift", margin: 0 });
    expect(vp.region).toEqual([16.4, 5.92, 17.6, 9.08]);
    expect(sceneViewport(yard, { registry: engine, around: "~solid:1" }).region).toEqual([
      -1.28, -1.28, 1.68, 11.28,
    ]);
    expect(() => renderSceneSvg(yard, { registry: engine, around: "lifft" })).toThrow(
      'no entity "lifft" to frame; did you mean "lift"?',
    );
    expect(() => renderSceneSvg(yard, { registry: engine, region: [10, 0, 0, 10] })).toThrow(
      /x1 > x0/,
    );
  });
});

describe("svgPathData", () => {
  it("splits a full circle into quarter arcs that close where they start", () => {
    const d = svgPathData(shapeOutline({ type: "circle", cx: 0, cy: 0, r: 10 }));
    expect(d).toBe("M10 0A10 10 0 0 1 0 10A10 10 0 0 1 -10 0A10 10 0 0 1 0 -10A10 10 0 0 1 10 0Z");
  });
});

describe("grid fields", () => {
  const game = createRegistry(testGame);
  const square: GridSettings = { kind: "square", cell: [0.32, 0.32] };
  const paintScene = (
    cells: Record<string, string[]>,
    grid: GridSettings = square,
    extra: Partial<SceneDefinition> = {},
  ): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    game: game.id,
    name: "paint",
    bounds: [0, 0, 10.24, 7.68],
    settings: { grid },
    entities: [{ id: "floor", type: PAINT.type, at: [0.64, 6.4], cells }],
    ...extra,
  });
  const cellsOf = (svg: string) =>
    [...svg.matchAll(/data-cell="(-?\d+),(-?\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it("draws a painted entity's filled cells one by one at its at, sized by the scene's grid", () => {
    const svg = renderSceneSvg(paintScene({ "0,0": ["1*3", "", "0,2"] }), { registry: game });
    expect(svg).toContain(`<g data-ref="floor" data-type="${PAINT.type}" data-field="cells"`);
    expect(cellsOf(svg)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 2],
    ]);
    expect(svg).toMatch(
      /data-cell="0,0" data-v="1" fill="#[0-9a-f]{6}" x="64" y="640" width="32" height="32"/,
    );
    expect(svg).toMatch(/data-cell="1,2" data-v="2" [^>]*x="96" y="704" width="32" height="32"/);
    expect(svg).not.toContain("grid-more");
  });

  it("places negative chunks before the entity's at", () => {
    const svg = renderSceneSvg(paintScene({ "-1,0": ["0*31,3"] }), { registry: game });
    expect(cellsOf(svg)).toEqual([[-1, 0]]);
    expect(svg).toMatch(/data-cell="-1,0" data-v="3" [^>]*x="32" y="640"/);
  });

  it("draws hex cells as hexagons, staggered as Tiled's", () => {
    const hexGrid: GridSettings = {
      kind: "hex",
      cell: [0.32, 0.32],
      side: 0.16,
      stagger: "y",
      index: "odd",
    };
    const svg = renderSceneSvg(
      paintScene({ "0,0": ["", "1"] }, hexGrid, {
        entities: [{ id: "floor", type: PAINT.type, at: [0, 0], cells: { "0,0": ["", "1"] } }],
      }),
      { registry: game },
    );
    expect(svg).toContain(
      `data-cell="0,1" data-v="1" fill="#4dd0e1" d="M32 24L48 32L48 48L32 56L16 48L16 32Z"`,
    );
  });

  it(`stops at ${SCENE_GRID_MAX_CELLS} cells and marks the rest with "…"`, () => {
    // 100 × 100 cells, 10,000 in all.
    const chunk = Array.from({ length: 32 }, () => "1*32");
    const edge = Array.from({ length: 32 }, () => "1*4");
    const cells: Record<string, string[]> = {};
    for (let cy = 0; cy < 4; cy++)
      for (let cx = 0; cx < 4; cx++) {
        const rows = cx === 3 ? edge : chunk;
        cells[`${cx},${cy}`] = cy === 3 ? rows.slice(0, 4) : rows;
      }
    const scene = paintScene(
      cells,
      { kind: "square", cell: [0.04, 0.04] },
      {
        entities: [{ id: "floor", type: PAINT.type, at: [0, 0], cells }],
      },
    );
    const svg = renderSceneSvg(scene, { registry: game });
    const drawn = cellsOf(svg);
    expect(drawn).toHaveLength(SCENE_GRID_MAX_CELLS);
    expect(drawn.at(-1)).toEqual([95, 40]);
    expect(svg).toMatch(/<text class="grid-more" data-more="5904" x="386" y="166"[^>]*>…<\/text>/);

    // A region draws only the cells in it, so a part of a big map is whole.
    const part = renderSceneSvg(scene, { registry: game, region: [0, 0, 0.4, 0.4] });
    expect(cellsOf(part)).toHaveLength(100);
    expect(part).not.toContain("grid-more");
  });

  it("frames around a painted entity over its cells", () => {
    const scene = paintScene({ "0,0": ["1*4"] });
    const vp = sceneViewport(scene, { registry: game, around: "floor", margin: 0 });
    expect(vp.region).toEqual([0.64, 6.4, 1.92, 6.72]);
  });

  it("gives a painted entity a box over its filled cells, and none past its at without a grid", () => {
    const boxOf = (scene: SceneDefinition) => {
      const box = drawnEntities(expandedOf(scene, game), game).find((d) => d.id === "floor")?.box;
      return box && roundBox(box);
    };
    expect(boxOf(paintScene({ "-1,0": ["0*31,1"], "0,0": ["", "", "1*3"] }))).toEqual({
      minX: 0.32,
      minY: 6.4,
      maxX: 1.6,
      maxY: 7.36,
    });
    const hexGrid: GridSettings = {
      kind: "hex",
      cell: [0.32, 0.32],
      side: 0.16,
      stagger: "y",
      index: "odd",
    };
    expect(boxOf(paintScene({ "0,0": ["1", "1"] }, hexGrid))).toEqual({
      minX: 0.64,
      minY: 6.4,
      maxX: 1.12,
      maxY: 6.96,
    });
    const { settings: _, ...gridless } = paintScene({ "0,0": ["1*4"] });
    expect(boxOf(gridless)).toEqual({ minX: 0.64, minY: 6.4, maxX: 0.64, maxY: 6.4 });
  });

  it("draws nothing for cells in a scene without a grid", () => {
    const { settings: _, ...scene } = paintScene({ "0,0": ["1*4"] });
    expect(renderSceneSvg(scene, { registry: game })).not.toContain("grid-cells");
  });

  it("draws a turned or flipped instance's cells through the resolved view", () => {
    const prefab: Prefab = {
      kind: PREFAB_KIND,
      v: SCENE_FORMAT_VERSION,
      game: game.id,
      id: "strip",
      entities: [{ id: "floor", type: PAINT.type, at: [0, 0], cells: { "0,0": ["1*2"] } }],
    };
    const prefabs = new Map([[prefab.id, prefab]]);
    const scene = (inst: { rot?: 1 | 2 | 3; flip?: true }): SceneDefinition =>
      paintScene({}, square, {
        entities: [],
        instances: [{ id: "a", prefab: "strip", at: [3.2, 3.2], ...inst }],
      });
    const turned = renderSceneSvg(scene({ rot: 1 }), { registry: game, prefabs });
    expect(turned).toContain(`data-ref="a/floor"`);
    expect(cellsOf(turned)).toEqual([
      [-1, 0],
      [-1, 1],
    ]);
    expect(turned).toMatch(/data-cell="-1,1" [^>]*x="288" y="352"/);
    const flipped = renderSceneSvg(scene({ flip: true }), { registry: game, prefabs });
    expect(cellsOf(flipped)).toEqual([
      [-2, 0],
      [-1, 0],
    ]);
  });
});

describe("sprite boxes", () => {
  const sprites = parseSceneOrThrow(
    readFileSync(new URL("./fixtures/sprites.json", import.meta.url), "utf8"),
    engine,
  );
  const spritesGolden = new URL("./sprites.golden.svg", import.meta.url);
  const project = spriteProject();
  const spriteEl = (svg: string, ref: string) =>
    new RegExp(`<path data-sprite="${ref}"[^>]*>`).exec(svg)?.[0];

  it("matches the golden render of the sprite fixture (UPDATE_GOLDENS=1 regenerates)", () => {
    const svg = renderSceneSvg(sprites, { registry: engine });
    if (process.env.UPDATE_GOLDENS) writeFileSync(spritesGolden, svg);
    expect(svg).toBe(readFileSync(spritesGolden, "utf8"));
  });

  it("draws each sprite's box, labelled asset[:frame], on props and point entities alike", () => {
    const svg = renderSceneSvg(sprites, { registry: engine });
    expect(spriteEl(svg, "hero")).toContain('data-asset="hero-sheet" data-frame="idle-0"');
    // Without a project, an atlas frame's box is the 32×32 fallback at the body's centre.
    expect(spriteEl(svg, "hero")).toContain('d="M80 240L112 240L112 272L80 272Z"');
    expect(spriteEl(svg, "lamp")).toContain('d="M308 224L332 224L332 288L308 288Z"');
    expect(svg).toContain(">hero-sheet:idle-0</text>");
    expect(svg).toContain(">lamp</text>");
    expect(svg).toContain(">(no asset)</text>");
    expect(spriteEl(svg, "start")).toBeUndefined();
  });

  it("turns a sprite with its body and mirrors one with its group", () => {
    const svg = renderSceneSvg(sprites, { registry: engine });
    // The crate's 64px box turned 45° about its centre.
    expect(spriteEl(svg, "crate")).toContain('d="M208 210.75L253.25 256L208 301.25L162.75 256Z"');
    // The banner's top-left anchor and offset mirror under the group's flip: its box hangs left of the point.
    expect(spriteEl(svg, "banner")).toContain('d="M520 136L552 136L552 184L520 184Z"');
  });

  it("sizes boxes from the project's asset info when given one", () => {
    const svg = renderSceneSvg(sprites, { registry: engine, project });
    // The frame's 24×40 at its bottom-centre pivot.
    expect(spriteEl(svg, "hero")).toContain('d="M84 216L108 216L108 256L84 256Z"');
    // A block's own size still wins.
    expect(spriteEl(svg, "lamp")).toContain('d="M308 224L332 224L332 288L308 288Z"');
  });

  it("frames a region around a sprite's box and leaves its label out with labels none", () => {
    const view = sceneViewport(sprites, { registry: engine, around: "tree", margin: 0 });
    expect(view.region).toEqual([4.08, 1.6, 5.04, 2.88]);
    const bare = renderSceneSvg(sprites, { registry: engine, labels: "none" });
    expect(spriteEl(bare, "tree")).toBeDefined();
    expect(bare).not.toContain("(no asset)");
  });

  it("draws drawnEntities' sprite boxes, which grow the entity's box", () => {
    const tree = drawnEntities(expandedOf(sprites, engine), engine).find((d) => d.id === "tree");
    expect(tree?.sprite).toMatchObject({ label: "(no asset)", size: [0.96, 1.28] });
    expect(roundBox(tree!.box)).toEqual({ minX: 4.08, minY: 1.6, maxX: 5.04, maxY: 2.88 });
  });
});

/** A project holding the fixture's art: an atlas whose frame has a pivot, and textures. */
function spriteProject() {
  const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
    key: `k-${id}`,
    id,
    kind,
    path: `${id}.${kind}`,
    created: { at: 0, by: "t" },
    ...extra,
  });
  const texture = (id: string, width: number, height: number) =>
    entry(id, "texture", { sha256: "a".repeat(64), meta: { format: "png", width, height } });
  return projectView({
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: Object.fromEntries(
      [
        texture("sheet", 64, 64),
        texture("crate", 64, 64),
        texture("lamp", 20, 50),
        texture("banner", 30, 30),
        entry("hero-sheet", "atlas", {
          sha256: "b".repeat(64),
          meta: {
            tool: "aseprite",
            frames: { "idle-0": { x: 0, y: 0, w: 24, h: 40, pivot: [0.5, 1] } },
            tags: [],
            slices: [],
            order: ["idle-0"],
          },
          import: { texture: "sheet" },
        }),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  });
}

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
  const sinkGolden = new URL("./kitchen-sink.golden.svg", import.meta.url);
  let sink: Awaited<ReturnType<typeof loadKitchenSink>>;
  beforeAll(async () => {
    sink = await loadKitchenSink();
  });
  const render = () =>
    renderSceneSvg(sink.scene, {
      registry: sink.registry,
      prefabs: sink.prefabs,
      project: sink.view,
    });

  it("matches its golden render, sprites sized from the project (UPDATE_GOLDENS=1 regenerates)", () => {
    const svg = render();
    if (process.env.UPDATE_GOLDENS) writeFileSync(sinkGolden, svg);
    expect(svg).toBe(readFileSync(sinkGolden, "utf8"));
    expect(render()).toBe(svg);
  });

  it("labels each sprite with its asset and frame", () => {
    const svg = render();
    expect(svg).toMatch(/<path data-sprite="crate" [^>]*data-asset="crates" data-frame="crate-0"/);
    expect(svg).toMatch(/<path data-sprite="ball" [^>]*data-asset="crates" data-frame="crate-1"/);
    expect(svg).toMatch(/<path data-sprite="ledge" [^>]*data-asset="hero" data-frame="hero-1"/);
    expect(svg).toMatch(/<path data-sprite="lamp" [^>]*data-asset="backdrop"/);
  });
});
