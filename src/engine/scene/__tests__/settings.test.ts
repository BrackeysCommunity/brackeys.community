// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { resolveSettings } from "../expand";
import { parseScene } from "../parse";
import { SCENE_FORMAT_VERSION, type GridSettings, type SceneDefinition } from "../types";
import { validateScene } from "../validate";
import { engine } from "./fixtures/fake-game";

const DEFAULTS = {
  gravity: [0, 1200],
  physics: "rapier",
  grid: null,
  view: { projection: "orthogonal" },
};

const square: GridSettings = { kind: "square", cell: [32, 32] };
const hex: GridSettings = {
  kind: "hex",
  cell: [32, 28],
  side: 16,
  stagger: "x",
  index: "odd",
  origin: [8, 8],
};

describe("resolveSettings", () => {
  it("fills the engine defaults and keeps a game's keys", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULTS);
    expect(resolveSettings({ lives: 3 })).toEqual({ ...DEFAULTS, lives: 3 });
    expect(resolveSettings({ gravity: [0, 900], grid: square, physics: "none" })).toEqual({
      ...DEFAULTS,
      gravity: [0, 900],
      grid: square,
      physics: "none",
    });
  });

  it("takes each engine key from the scene, then the project, then the game, then the engine", () => {
    const project = { gravity: [0, 500], physics: "none", unknown: 1 };
    const game = { gravity: [0, 100] as [number, number], physics: "rapier" as const, grid: hex };
    expect(resolveSettings({ gravity: [0, 900] }, { project, game })).toEqual({
      ...DEFAULTS,
      gravity: [0, 900],
      physics: "none",
      grid: hex,
    });
    expect(resolveSettings({}, { game })).toEqual({ ...DEFAULTS, ...game });
    expect(resolveSettings({ grid: square }, { project: { grid: hex }, game })).toMatchObject({
      grid: square,
    });
    expect(resolveSettings(undefined, { project: {}, game: {} })).toEqual(DEFAULTS);
  });

  it("does not alias its sources", () => {
    const settings = { gravity: [0, 900] as [number, number], grid: hex };
    const game = { view: { projection: "orthogonal" as const } };
    const out = resolveSettings(settings, { game });
    (out.gravity as number[])[1] = 0;
    (out.grid as { cell: number[] }).cell[0] = 0;
    (out.view as { projection: string }).projection = "x";
    expect(settings.gravity).toEqual([0, 900]);
    expect(hex.cell).toEqual([32, 28]);
    expect(game.view.projection).toBe("orthogonal");
    expect(resolveSettings(undefined).gravity).toEqual([0, 1200]);
  });

  it("resolves every existing scene to Rapier, no grid and the orthogonal view", () => {
    const dirs = [
      new URL("../../scenes/", import.meta.url),
      new URL("../../../games/platformer/scenes/", import.meta.url),
    ];
    const files = dirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => new URL(f, dir)),
    );
    const scenes = files
      .map((url) => JSON.parse(readFileSync(url, "utf8")) as SceneDefinition)
      .filter((def) => Array.isArray(def.bounds));
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    for (const def of scenes) {
      expect(resolveSettings(def.settings)).toMatchObject({
        physics: "rapier",
        grid: null,
        view: { projection: "orthogonal" },
      });
    }
  });
});

describe("settings schema", () => {
  const scene = (settings: Record<string, unknown>) => ({
    v: SCENE_FORMAT_VERSION,
    name: "s",
    bounds: [0, 0, 100, 100],
    settings,
  });

  it("accepts the engine keys", () => {
    for (const settings of [{ physics: "none" }, { grid: square }, { grid: hex }]) {
      expect(parseScene(scene(settings), engine).ok).toBe(true);
    }
    expect(parseScene(scene({ view: { projection: "orthogonal" } }), engine).ok).toBe(true);
  });

  it("refuses a malformed grid or view as schema", () => {
    for (const settings of [
      { physics: "box2d" },
      { grid: { kind: "tri", cell: [8, 8] } },
      { grid: { kind: "square", cell: [8] } },
      { grid: { kind: "hex", cell: [8, 8], stagger: "x", index: "odd" } },
      { grid: { ...hex, stagger: "z" } },
      { view: { projection: "isometric" } },
    ]) {
      const r = parseScene(scene(settings), engine);
      expect(r.ok).toBe(false);
      expect(r.issues.map((i) => i.code)).toContain("schema");
    }
  });

  it("lets bad hex values through the schema as grid-invalid", () => {
    for (const grid of [
      { ...hex, cell: [0, 28] },
      { ...hex, cell: [32.5, 28] },
      { ...hex, side: 40 },
      { ...hex, side: -1 },
      { ...hex, origin: [0.5, 0] },
    ]) {
      const r = parseScene(scene({ grid }), engine);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      const codes = validateScene(r.def, engine).map((i) => [i.code, i.path]);
      expect(codes).toContainEqual(["grid-invalid", expect.stringMatching(/^\/settings\/grid/)]);
    }
  });
});
