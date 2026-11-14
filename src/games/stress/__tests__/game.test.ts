// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import type { GameCommand, ProjectRuntimeView } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import {
  applyOps,
  createRegistry,
  expandScene,
  inputScriptJsonSchema,
  parsePrefab,
  parseScene,
  prefabLibrary,
  sceneJsonSchema,
  validateScene,
  type OpBatch,
  type SceneDefinition,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { stressGame } from "..";
import { PREFABS, stressScenes, type StressScene } from "../tools/make-scenes";
import { AGENT, PELLET, REFUSED, type Snapshot } from "../types";

const registry = createRegistry(stressGame);
const file = (path: string) => new URL(`../${path}`, import.meta.url);
const read = (path: string) => readFileSync(file(path), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

const prefabs = prefabLibrary(
  PREFABS.map((doc) => {
    const parsed = parsePrefab(doc, registry);
    if (!parsed.ok) throw new Error(`prefab ${doc.id}: ${JSON.stringify(parsed.issues)}`);
    return parsed.prefab;
  }),
);

/** A generated scene's batch applied to an empty scene, as the generator's CLI run fills it. */
function filled(scene: StressScene): SceneDefinition {
  const empty = {
    $schema: "../scene.schema.json",
    v: 5,
    game: "stress",
    name: scene.id,
    bounds: scene.bounds,
    entities: [],
  };
  const result = applyOps(empty as SceneDefinition, { ops: scene.ops } as OpBatch, registry, {
    prefabs,
  });
  if (!result.ok) throw new Error(`${scene.id}: ${result.issue.message}`);
  return result.def;
}

const COMMITTED = stressScenes();
/** Every scene a twentieth the size: a bay or two each, quick to step. */
const SMALL = new Map(stressScenes(0.05).map((s) => [s.id, s]));

const view = (
  settings: Record<string, unknown> = {},
  scenes: string[] = [],
): ProjectRuntimeView => ({
  settings,
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  flow: { start: scenes[0] ?? null, scenes: scenes.map((scene) => ({ scene })) },
});

async function load(id: string, project: ProjectRuntimeView | null = null) {
  const rt = createHeadlessRuntime({
    rapier: await import("@dimforge/rapier2d"),
    game: stressGame,
    registry,
    scene: expandScene(filled(SMALL.get(id)!), registry, { prefabs }),
    project,
  });
  const snap = () => rt.snapshot() as Snapshot;
  const step = (ticks: number, commands: GameCommand[] = []) => {
    const events = [];
    for (let i = 0; i < ticks; i++)
      events.push(...rt.step(rt.ctx.time.tickMs, [], i === 0 ? commands : []).events);
    return events;
  };
  return { rt, snap, step };
}

/** A generated file equals what its generator gives now; `UPDATE_SCHEMAS=1` rewrites it (then `vp fmt` it). */
function expectCurrent(path: string, fresh: Record<string, unknown>) {
  if (process.env.UPDATE_SCHEMAS) writeFileSync(file(path), `${JSON.stringify(fresh, null, 2)}\n`);
  expect(json(path)).toEqual(fresh);
}

describe("generated schemas", () => {
  it("scene.schema.json is sceneJsonSchema's (UPDATE_SCHEMAS=1 regenerates)", () => {
    expectCurrent("scene.schema.json", sceneJsonSchema(registry));
  });

  it("input-script.schema.json is inputScriptJsonSchema's (UPDATE_SCHEMAS=1 regenerates)", () => {
    expectCurrent("input-script.schema.json", inputScriptJsonSchema(registry));
  });
});

describe("the scene generator", () => {
  it("gives the same batches every time, and bigger ones at a bigger scale", () => {
    expect(JSON.stringify(stressScenes())).toBe(JSON.stringify(COMMITTED));
    const ops = (scenes: StressScene[]) => scenes.reduce((n, s) => n + s.ops.length, 0);
    expect(ops(stressScenes(2))).toBeGreaterThan(ops(COMMITTED));
  });

  it("names the scenes the project lists, in order, starting at combined", () => {
    const list = json("scene-list.json") as { start: string; scenes: { scene: string }[] };
    expect(list.scenes.map((s) => s.scene)).toEqual(COMMITTED.map((s) => s.id));
    expect(list.start).toBe("combined");
  });

  it.each(PREFABS.map((p) => p.id))("prefab %s is the committed one", (id) => {
    const parsed = parsePrefab(read(`scenes/prefabs/${id}.json`), registry);
    expect(parsed.ok && parsed.prefab).toEqual(prefabs.get(id));
  });

  it.each(COMMITTED.map((s) => [s.id, s] as const))(
    "%s holds what its batch adds, with the generator's checks",
    (id, scene) => {
      const committed = json(`scenes/${id}.json`);
      const adds = (op: string) => scene.ops.filter((o) => o.op === op);
      const settings = adds("setSettings")[0] as { set: unknown };
      const shapes = adds("addBulk").reduce((n, o) => n + (o.shapes as unknown[]).length, 0);
      expect(committed.bounds).toEqual(scene.bounds);
      expect(committed.settings).toEqual(settings.set);
      expect((committed.entities as unknown[]).length).toBe(adds("add").length);
      expect(((committed.instances as unknown[] | undefined) ?? []).length).toBe(
        adds("instantiate").length,
      );
      expect(((committed.solid as unknown[] | undefined) ?? []).length).toBe(shapes);
      expect(json(`scenes/${id}.checks.json`).checks).toEqual(scene.checks);
    },
  );

  // The big scenes are judged by `vp run scene list` and `check`; these three are small enough to rebuild here.
  it.each(["churn", "crowd", "field"])(
    "%s is exactly its batch on an empty scene, and valid",
    (id) => {
      const parsed = parseScene(read(`scenes/${id}.json`), registry);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      expect(parsed.def).toEqual(filled(COMMITTED.find((s) => s.id === id)!));
      expect(
        validateScene(parsed.def, registry, { prefabs }).filter((i) => i.severity !== "info"),
      ).toEqual([]);
    },
    20_000,
  );
});

describe("the game", () => {
  it("spawners emit pellets up to their cap and lifetimes destroy them", async () => {
    const { rt, snap, step } = await load("churn");
    const spawners = rt.ctx.query.count({ type: "spawner" });
    expect(spawners).toBeGreaterThan(0);
    step(300);
    // 60 a second for 4 s lives: about 240 alive each, and a second's worth gone after five.
    const each = (n: number) => n / spawners;
    expect(each(snap().pellets)).toBeGreaterThan(235);
    expect(each(snap().pellets)).toBeLessThanOrEqual(240);
    expect(rt.ctx.query.count({ type: PELLET })).toBe(snap().pellets);
    expect(each(snap().spawned)).toBeGreaterThan(295);
    expect(each(snap().destroyed)).toBeGreaterThan(55);
    expect(snap().spawned - snap().destroyed).toBe(snap().pellets);
  });

  it("spawn-rate and spawn-cap scale every spawner while it runs", async () => {
    const { rt, snap, step } = await load("churn");
    const spawners = rt.ctx.query.count({ type: "spawner" });
    step(60, [{ name: "spawn-rate", args: { scale: 0 } }]);
    expect(snap().spawned).toBe(0);
    step(60, [
      { name: "spawn-rate", args: { scale: 4 } },
      { name: "spawn-cap", args: { scale: 0.25 } },
    ]);
    expect(snap().pellets).toBe(spawners * 60);
  });

  it("the project's scales multiply the scene's load", async () => {
    const project = view({ crowdScale: 0.5, spawnRateScale: 2, spawnCapScale: 1 });
    const crowd = await load("crowd");
    const halved = await load("crowd", project);
    expect(halved.snap().agents).toBe(Math.round(crowd.snap().agents / 2));
    const churn = await load("churn", project);
    churn.step(60);
    expect(churn.snap().spawned).toBe(churn.rt.ctx.query.count({ type: "spawner" }) * 120);
  });

  it("props crossing sensors raise enters and exits the game tallies", async () => {
    const { snap, step } = await load("field");
    step(300);
    expect(snap().enters).toBeGreaterThan(50);
    expect(snap().exits).toBeGreaterThan(50);
    expect(snap().occupied).toBeLessThanOrEqual(snap().enters - snap().exits);
  });

  it("the crowd walks the walk area, the same way every run", async () => {
    const { rt, snap, step } = await load("crowd");
    const agents = snap().agents;
    expect(agents).toBeGreaterThan(10);
    expect(rt.ctx.query.count({ type: AGENT })).toBe(agents);
    step(240);
    expect(snap().walked).toBeGreaterThan(agents * 1000);
    for (const id of rt.ctx.query.byType(AGENT)) {
      const pose = rt.ctx.poses.get(id)!;
      expect(rt.ctx.nav!.contains(pose), id).toBe(true);
    }
    const again = await load("crowd");
    again.step(240);
    expect(again.snap()).toEqual(snap());
  });

  it("the crowd command grows and shrinks the crowd; a scene with no walk area refuses it", async () => {
    const { snap, step } = await load("crowd");
    step(2, [{ name: "crowd", args: { count: 80 } }]);
    expect(snap().agents).toBe(80);
    step(2, [{ name: "crowd", args: { count: 5 } }]);
    expect(snap().agents).toBe(5);

    const pile = await load("pile");
    const events = pile.step(1, [{ name: "crowd", args: { count: 5 } }]);
    expect(events.filter((e) => e.type === REFUSED)).toHaveLength(1);
    expect(pile.snap().agents).toBe(0);
  });

  it("goto asks for a listed scene and refuses any other", async () => {
    const { rt, step } = await load("wall", view({}, ["wall", "pile"]));
    expect(step(1, [{ name: "goto", args: { scene: "pile" } }])).toEqual([]);
    expect(rt.takeRequests().flow).toEqual({ to: "pile" });
    const events = step(1, [{ name: "goto", args: { scene: "nowhere" } }]);
    expect(events.map((e) => e.type)).toEqual([REFUSED]);
    expect(rt.takeRequests().flow).toBeNull();
  });

  it.each([...SMALL.keys()])("%s steps at a twentieth of its size", async (id) => {
    const { rt, step } = await load(id);
    step(30);
    expect(rt.stats().entities).toBeGreaterThan(0);
  });
});
