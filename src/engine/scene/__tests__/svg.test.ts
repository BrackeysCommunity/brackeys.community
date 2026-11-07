import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { ENGINE_YARD_EXPANDED } from "../../__tests__/fixtures/engine-yard.expanded";
import { generateScene } from "../../__tests__/fixtures/generate-scene";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { primitiveFields } from "../../game/primitives";
import { parseSceneOrThrow } from "../parse";
import { shapeOutline } from "../shape-outline";
import { renderSceneSvg, SCENE_SVG_MAX_SIZE, sceneViewport, svgPathData } from "../svg";
import type { SceneDefinition } from "../types";
import { engine, engineYardText } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);
const golden = new URL("./engine-yard.golden.svg", import.meta.url);

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
      at: [640, 900] as [number, number],
    },
  ],
  trail: {
    every: 4,
    pts: [
      [300, 940],
      [500, 940],
      [880, 930],
    ] as [number, number][],
    truncated: false,
  },
  events: [
    { tick: 3, type: "sensor:enter", entityId: "zone", other: "avatar", at: { x: 880, y: 930 } },
    { tick: 9, type: "landed", at: { x: 400, y: 940 } },
  ],
  outcome: { result: "won", tick: 90, at: { x: 880, y: 930 }, cause: "reached the goal" },
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

  it("overlays a playtest report: issues, trail, events and outcome", () => {
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

describe("the render's size", () => {
  it("is the region times the scale", () => {
    expect(size(renderSceneSvg(yard, { registry: engine }))).toEqual([1600, 800]);
    expect(size(renderSceneSvg(yard, { registry: engine, scale: 0.5 }))).toEqual([1000, 500]);
    expect(
      sceneViewport(yard, { registry: engine, region: [0, 0, 400, 300], scale: 2 }),
    ).toMatchObject({ region: [0, 0, 400, 300], width: 800, height: 600, scale: 2 });
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

  it("frames around an entity with a margin, path included", () => {
    const vp = sceneViewport(yard, { registry: engine, around: "lift", margin: 0 });
    expect(vp.region).toEqual([1640, 592, 1760, 908]);
    expect(sceneViewport(yard, { registry: engine, around: "~solid:1" }).region).toEqual([
      -128, -128, 168, 1128,
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
