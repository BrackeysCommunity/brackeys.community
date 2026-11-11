// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { GameCommand, ProjectRuntimeView } from "@jams/engine/game";
import { createHeadlessRuntime, loadHeadless, runChecks, runProbe } from "@jams/engine/headless";
import {
  createRegistry,
  createScene,
  expandScene,
  formatScene,
  inputScriptJsonSchema,
  parseChecks,
  parseScene,
  sceneJsonSchema,
  undescribedProperties,
  validateScene,
  type SceneDefinition,
} from "@jams/engine/scene";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  tacticsGame,
  TACTICS_HIT,
  TACTICS_REFUSED,
  TACTICS_SETTINGS,
  TACTICS_TURN,
  UNIT_CLASS_TABLE,
  WALK_TICKS,
  type TacticsRunSnapshot,
  type TacticsSlice,
} from "..";

// The board has no physics: loading Rapier at all is a failure.
vi.mock("@dimforge/rapier2d-compat", () => ({
  default: {
    init: () => {
      throw new Error("tactics must not load Rapier");
    },
  },
}));

const registry = createRegistry(tacticsGame);
const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;
const REPO = fileURLToPath(here("../../../../"));

const SCHEMA = here("../scene.schema.json");
const SCRIPT_SCHEMA = here("../input-script.schema.json");
const sceneText = () => read("../scenes/level-1.json");
const prefabTexts = () => [
  read("../scenes/prefabs/knight.json"),
  read("../scenes/prefabs/archer.json"),
];

/** What `EngineContext.project` holds for the project's own game settings and unit classes. */
function projectView(): ProjectRuntimeView {
  const settings = json("../game-settings.json");
  const rows = (json("../data/unit-classes.json").rows as { id: string }[]).map((r) =>
    Object.freeze(r),
  );
  return {
    settings: z.object(TACTICS_SETTINGS).parse(settings.game),
    engine: (settings.engine ?? {}) as Record<string, unknown>,
    table: (name) => (name === UNIT_CLASS_TABLE ? rows : []),
    asset: () => undefined,
    inputMap: null,
  };
}

async function load() {
  return loadHeadless({
    files: { scene: sceneText(), prefabs: prefabTexts() },
    registry,
    project: projectView(),
  });
}

function parsed(): SceneDefinition {
  const result = parseScene(sceneText(), registry);
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join("\n"));
  return result.def;
}

function cli(...args: string[]) {
  const r = spawnSync("bun", ["scripts/scene/cli.ts", ...args], { cwd: REPO, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("level-1.json", () => {
  it("is canonical and names tactics and its schema", () => {
    const def = parsed();
    expect(formatScene(def).text).toBe(sceneText());
    expect(def.game).toBe("tactics");
    expect(def.$schema).toBe("../scene.schema.json");
  });

  it("has no validation errors or warnings", async () => {
    const { scene, prefabs } = await load();
    expect(
      validateScene(scene, registry, { prefabs }).filter((i) => i.severity !== "info"),
    ).toEqual([]);
  });

  it("puts five units on a 12 × 8 board of walls and rough ground", async () => {
    const { scene, prefabs } = await load();
    const expanded = expandScene(scene, registry, { prefabs });
    const units = expanded.entities.filter((e) => e.type === "unit");
    expect(units.map((u) => `${u.side as string} ${u.class as string}`).sort()).toEqual([
      "blue archer",
      "blue knight",
      "blue knight",
      "red archer",
      "red knight",
    ]);
    expect(expanded.entities.some((e) => e.type === "solid")).toBe(true);
    expect(expanded.entities.some((e) => e.type === "rough")).toBe(true);
  });

  it("loads with no Rapier: blue to act on turn 1, every legal order listed", async () => {
    const loaded = await load();
    const report = runProbe<TacticsRunSnapshot>({
      game: tacticsGame,
      registry,
      scene: expandScene(loaded.scene, registry, { prefabs: loaded.prefabs }),
      project: loaded.project,
      ticks: 1,
    });
    expect(report.load.ok).toBe(true);
    const final = report.final!;
    expect(final.grid).toMatchObject({ cols: 12, rows: 8, cell: 1 });
    expect(final.grid.walls.length).toBeGreaterThan(0);
    expect(final.grid.costs.length).toBeGreaterThan(0);
    expect(Object.keys(final.classes).sort()).toEqual(["archer", "knight", "scout"]);
    expect(final).toMatchObject({ turn: 1, side: "blue", phase: "orders", result: null });
    const legal = tacticsGame.play!.commands!({
      tick: 0,
      snapshot: final,
      events: [],
      world: { exists: () => true, count: () => 0 },
    });
    expect(legal.at(-1)).toEqual({ name: "end-turn" });
    expect(legal.filter((c) => c.name === "wait")).toHaveLength(3);
  });

  it("passes its checks headless, the sides' spawns connected", async () => {
    const loaded = await load();
    const checks = parseChecks(read("../scenes/level-1.checks.json"), registry);
    if (!checks.ok) throw new Error(JSON.stringify(checks.issues));
    const report = runChecks({ ...loaded, checks: checks.file, readFile: read });
    expect(report.results.map((r) => [r.id, r.pass, r.skipped ?? null])).toEqual([
      ["valid", true, null],
      ["sides-connected", true, null],
    ]);
  });
});

describe("the runtime", () => {
  const KNIGHT = "blue-knight-1/unit";
  const DT = 1000 / 60;

  async function runtime() {
    const loaded = await load();
    const rt = createHeadlessRuntime({
      game: tacticsGame,
      registry,
      scene: expandScene(loaded.scene, registry, { prefabs: loaded.prefabs }),
      project: loaded.project,
    });
    const step = (commands: GameCommand[] = []) => rt.step(DT, [], commands);
    const snap = () => rt.snapshot() as TacticsRunSnapshot;
    const slice = () => rt.game!.storeSlice!() as TacticsSlice;
    return { rt, step, snap, slice };
  }

  it("walks a move one cell per 8 ticks through the unit's pose, busy until it stands", async () => {
    const { rt, step, snap } = await runtime();
    step([{ name: "move", args: { unit: KNIGHT, to: [3, 3] } }]);
    expect(snap().units[KNIGHT]!.cell).toEqual([3, 3]);
    expect(snap().phase).toBe("moving");
    // Three cells from [1, 2] to [3, 3], the first [2, 2].
    let ticks = 1;
    while (rt.busy()) {
      step();
      ticks++;
      if (ticks === 1 + WALK_TICKS) expect(rt.ctx.poses.get(KNIGHT)).toMatchObject({ x: 2.5 });
      expect(ticks).toBeLessThan(100);
    }
    // The command's own tick starts the walk; each cell then takes WALK_TICKS.
    expect(ticks).toBe(1 + 3 * WALK_TICKS);
    expect(rt.ctx.poses.get(KNIGHT)).toMatchObject({ x: 3.5, y: 3.5 });
    expect(rt.ctx.grid!.occupancy.at([3, 3])).toContain(KNIGHT);
    expect(snap().phase).toBe("orders");
    rt.destroy();
  });

  it("ignores and logs an illegal command, and keeps the slice until something changes", async () => {
    const { rt, step, slice } = await runtime();
    const before = slice();
    step();
    expect(slice()).toBe(before);
    const result = step([
      { name: "attack", args: { unit: KNIGHT, target: "red-knight/unit" } },
      { name: "launch" },
    ]);
    expect(result.events.filter((e) => e.type === TACTICS_REFUSED)).toHaveLength(2);
    const after = slice();
    expect(after).not.toBe(before);
    expect(after.log.filter((l) => l.startsWith("refused"))).toHaveLength(2);
    expect(after.units).toEqual(before.units);
    expect(after.classes.archer).toEqual({ move: 2, range: [2, 3] });
    rt.destroy();
  });

  it("plays the red side one unit per aiStepTicks after end-turn, then hands back", async () => {
    const { rt, step, snap } = await runtime();
    const aiStepTicks = projectView().settings.aiStepTicks as number;
    const events = step([{ name: "end-turn" }]).events.map((e) => e.type);
    expect(events).toContain(TACTICS_TURN);
    expect(snap()).toMatchObject({ side: "red", phase: "enemy" });
    expect(rt.busy()).toBe(true);
    const redCells = () =>
      ["red-knight/unit", "red-archer/unit"].map((id) => snap().units[id]!.cell);
    const start = redCells();
    for (let i = 1; i < aiStepTicks; i++) step();
    expect(redCells()).toEqual(start);
    step();
    expect(redCells()).not.toEqual(start);
    let ticks = aiStepTicks + 1;
    while (rt.busy()) {
      step();
      expect(++ticks).toBeLessThan(400);
    }
    expect(snap()).toMatchObject({ side: "blue", phase: "orders", turn: 2 });
    expect(redCells()).not.toEqual(start);
    // Blue's orders are refused while red acts; red's turn is the game's own.
    expect(
      tacticsGame.play!.commands!({
        tick: 0,
        snapshot: { ...snap(), side: "red" },
        events: [],
        world: { exists: () => true, count: () => 0 },
      }),
    ).toEqual([]);
    rt.destroy();
  });

  it("strikes and removes a unit that falls", async () => {
    const { rt, step, snap } = await runtime();
    // Walk the blue archer into range of the red knight over turns.
    const archer = "blue-archer/unit";
    const settle = () => {
      for (let i = 0; i < 400 && rt.busy(); i++) step();
    };
    const hits: string[] = [];
    for (let turn = 0; turn < 12 && snap().result === null; turn++) {
      const legal = tacticsGame.play!.commands!({
        tick: 0,
        snapshot: snap(),
        events: [],
        world: { exists: () => true, count: () => 0 },
      });
      const attack = legal.find((c) => c.name === "attack");
      const order = attack ??
        legal.find((c) => c.name === "move" && (c.args as { unit: string }).unit === archer) ?? {
          name: "end-turn",
        };
      const result = step([order]);
      hits.push(...result.events.filter((e) => e.type === TACTICS_HIT).map((e) => e.entityId!));
      settle();
      if (order.name !== "end-turn") {
        step([{ name: "end-turn" }]);
        settle();
      }
    }
    expect(hits.length).toBeGreaterThan(0);
    for (const id of Object.keys(snap().units)) expect(rt.ctx.exists(id)).toBe(true);
    const gone = [
      "red-knight/unit",
      "red-archer/unit",
      "blue-knight-1/unit",
      "blue-archer/unit",
      "blue-knight-2/unit",
    ].filter((id) => !snap().units[id]);
    for (const id of gone) expect(rt.ctx.exists(id)).toBe(false);
    rt.destroy();
  });
});

describe("the new-scene template", () => {
  it("parses, is canonical and validates clean", () => {
    const fresh = createScene("fresh", registry);
    expect(fresh.game).toBe("tactics");
    const result = parseScene(formatScene(fresh).text, registry);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    if (result.ok) expect(validateScene(result.def, registry)).toEqual([]);
  });
});

describe("scene.schema.json", () => {
  it("matches sceneJsonSchema for tactics (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = sceneJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA, "utf8"))).toEqual(fresh);
    expect(fresh.$id).toBe("urn:jams-engine:scene:tactics:v4");
  });
});

describe("input-script.schema.json", () => {
  it("matches inputScriptJsonSchema for tactics (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = inputScriptJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCRIPT_SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCRIPT_SCHEMA, "utf8"))).toEqual(fresh);
    expect(fresh.$id).toBe("urn:jams-engine:input-script:tactics:v2");
    expect(undescribedProperties(fresh)).toEqual([]);
  });
});

describe("the scene CLI", () => {
  it("validates level-1 clean", { timeout: 60_000 }, () => {
    const r = cli("validate", "level-1", "--project", "tactics");
    expect(r.status, r.out).toBe(0);
  });

  it("shows level-1 as physics none, no wasm, on a turns clock at 60", { timeout: 60_000 }, () => {
    const r = cli("show", "level-1", "--project", "tactics");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("physics none, no wasm");
    expect(r.out).toContain("time turns 60");
  });

  it("passes level-1's checks", { timeout: 60_000 }, () => {
    const r = cli("check", "level-1", "--project", "tactics");
    expect(r.status, r.out).toBe(0);
  });
});
