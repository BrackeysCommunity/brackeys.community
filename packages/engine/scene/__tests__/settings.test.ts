// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_GRAVITY } from "../../game/defaults";
import { createRegistry, defineGame } from "../../game/define";
import { resolveSettings } from "../expand";
import { parseScene } from "../parse";
import { SCENE_FORMAT_VERSION, type GridSettings, type SceneDefinition } from "../types";
import { validateScene } from "../validate";
import { engine } from "./fixtures/fake-game";

const DEFAULTS = {
  gravity: [...DEFAULT_GRAVITY],
  physics: "rapier",
  grid: null,
  view: { projection: "orthogonal" },
};

const square: GridSettings = { kind: "square", cell: [0.32, 0.32] };
const hex: GridSettings = {
  kind: "hex",
  cell: [0.32, 0.28],
  side: 0.16,
  stagger: "x",
  index: "odd",
  origin: [0.08, 0.08],
};

describe("resolveSettings", () => {
  it("fills the engine defaults and keeps a game's keys", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULTS);
    expect(resolveSettings({ lives: 3 })).toEqual({ ...DEFAULTS, lives: 3 });
    expect(resolveSettings({ gravity: [0, 9], grid: square, physics: "none" })).toEqual({
      ...DEFAULTS,
      gravity: [0, 9],
      grid: square,
      physics: "none",
    });
  });

  it("takes each engine key from the scene, then the project, then the game, then the engine", () => {
    const project = { gravity: [0, 5], physics: "none", unknown: 1 };
    const game = { gravity: [0, 1] as [number, number], physics: "rapier" as const, grid: hex };
    expect(resolveSettings({ gravity: [0, 9] }, { project, game })).toEqual({
      ...DEFAULTS,
      gravity: [0, 9],
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
    const settings = { gravity: [0, 9] as [number, number], grid: hex };
    const game = { view: { projection: "orthogonal" as const } };
    const out = resolveSettings(settings, { game });
    (out.gravity as number[])[1] = 0;
    (out.grid as { cell: number[] }).cell[0] = 0;
    (out.view as { projection: string }).projection = "x";
    expect(settings.gravity).toEqual([0, 9]);
    expect(hex.cell).toEqual([0.32, 0.28]);
    expect(game.view.projection).toBe("orthogonal");
    expect(resolveSettings(undefined).gravity).toEqual([...DEFAULT_GRAVITY]);
  });

  it("resolves every existing scene to its declared world model, else Rapier with no grid", () => {
    const dirs = [
      new URL("../../scenes/", import.meta.url),
      new URL("../../../../src/games/platformer/scenes/", import.meta.url),
    ];
    const files = dirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => new URL(f, dir)),
    );
    const scenes = files
      .map((url) => JSON.parse(readFileSync(url, "utf8")) as SceneDefinition)
      .filter((def) => Array.isArray(def.bounds));
    const resolved = scenes.map((def) => {
      const out = resolveSettings(def.settings);
      expect(out).toEqual({
        ...DEFAULTS,
        ...def.settings,
        physics: def.settings?.physics ?? "rapier",
        grid: def.settings?.grid ?? null,
        view: { projection: "orthogonal" },
      });
      return out;
    });
    const physical = resolved.filter((s) => s.physics === "rapier" && s.grid === null);
    expect(physical.length).toBeGreaterThanOrEqual(3);
    expect(resolved).toContainEqual(
      expect.objectContaining({
        physics: "none",
        grid: expect.objectContaining({ kind: "square" }),
      }),
    );
  });
});

describe("settings schema", () => {
  const scene = (settings: Record<string, unknown>) => ({
    v: SCENE_FORMAT_VERSION,
    name: "s",
    bounds: [0, 0, 1, 1],
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
      { grid: { kind: "tri", cell: [0.08, 0.08] } },
      { grid: { kind: "square", cell: [0.08] } },
      { grid: { kind: "hex", cell: [0.08, 0.08], stagger: "x", index: "odd" } },
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
      { ...hex, cell: [0, 0.28] },
      { ...hex, cell: [0.325, 0.28] },
      { ...hex, side: 0.4 },
      { ...hex, side: -0.01 },
      { ...hex, side: 0.165 },
      { ...hex, origin: [0.005, 0] },
    ]) {
      const r = parseScene(scene({ grid }), engine);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      const codes = validateScene(r.def, engine).map((i) => [i.code, i.path]);
      expect(codes).toContainEqual(["grid-invalid", expect.stringMatching(/^\/settings\/grid/)]);
    }
  });
});

describe("grid-invalid at the game's px per metre", () => {
  const at = (lengthUnit: number) =>
    createRegistry(
      defineGame({
        id: "grid-game",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        world: { lengthUnit },
      }),
    );
  const scene = (grid: GridSettings) => ({
    v: SCENE_FORMAT_VERSION,
    game: "grid-game",
    name: "s",
    bounds: [0, 0, 10, 10],
    settings: { grid },
  });
  const gridIssues = (grid: GridSettings, lengthUnit: number) => {
    const registry = at(lengthUnit);
    const r = parseScene(scene(grid), registry);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return validateScene(r.def, registry)
      .filter((i) => i.code === "grid-invalid")
      .map((i) => i.path);
  };

  it("takes cells, sides and origins on whole px at 100 px per metre, in metres", () => {
    expect(gridIssues(square, 100)).toEqual([]);
    expect(gridIssues(hex, 100)).toEqual([]);
    expect(gridIssues({ kind: "square", cell: [0.005, 0.32] }, 100)).toEqual([
      "/settings/grid/cell/0",
    ]);
    expect(gridIssues({ ...hex, side: 0.165, origin: [0.08, 0.085] }, 100)).toEqual([
      "/settings/grid/origin/1",
      "/settings/grid/side",
    ]);
  });

  it("judges whole px at 32 px per metre: 1 m is 32 px, 0.32 m isn't whole", () => {
    expect(gridIssues({ kind: "square", cell: [1, 0.5], origin: [0.03125, 0] }, 32)).toEqual([]);
    expect(gridIssues({ kind: "square", cell: [0.32, 1] }, 32)).toEqual(["/settings/grid/cell/0"]);
    expect(
      gridIssues(
        { kind: "hex", cell: [1, 0.875], side: 0.5, stagger: "x", index: "odd", origin: [0.01, 0] },
        32,
      ),
    ).toEqual(["/settings/grid/origin/0"]);
  });

  it("says metres and the px it wants", () => {
    const registry = at(32);
    const r = parseScene(scene({ kind: "square", cell: [0.32, 1] }), registry);
    if (!r.ok) throw new Error("refused");
    const [issue] = validateScene(r.def, registry).filter((i) => i.code === "grid-invalid");
    expect(issue?.message).toBe(
      "the grid's cell width is 0.32 m; it must be a positive whole number of px (1 px is 0.03125 m at 32 px per metre)",
    );
  });
});
