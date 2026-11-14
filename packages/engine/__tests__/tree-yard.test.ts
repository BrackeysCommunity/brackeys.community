// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import type { Registry } from "../game/types";
import { runChecks } from "../headless/run-checks";
import { composePose, relativePose, type Pose } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import { SENSOR_ENTER, type SceneRuntimeHandle, type StepEvent } from "../runtime/types";
import { parseChecks, type ChecksFile } from "../scene/checks";
import { expandScene } from "../scene/expand";
import { parseScene } from "../scene/parse";
import type { PrefabLibrary, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { readPrefabFiles } from "../vite/project-files";
import { testGame } from "./fixtures/test-game";

const scenesDir = new URL("../scenes/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, scenesDir), "utf8");

const engine = createRegistry(null);
const game = createRegistry(testGame);

let rapier: RapierModule;
let scene: SceneDefinition;
let prefabs: PrefabLibrary;
let gamePrefabs: PrefabLibrary;
let checks: ChecksFile;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  const parsed = parseScene(read("tree-yard.json"), engine);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  scene = parsed.def;
  const files = await readPrefabFiles(fileURLToPath(scenesDir), engine);
  expect(files.problems).toEqual([]);
  prefabs = files.prefabs;
  gamePrefabs = (await readPrefabFiles(fileURLToPath(scenesDir), game)).prefabs;
  const parsedChecks = parseChecks(read("tree-yard.checks.json"), engine);
  if (!parsedChecks.ok) throw new Error(JSON.stringify(parsedChecks.issues));
  checks = parsedChecks.file;
});

/** The scene loaded under `registry` (the test game's when sensor events matter). */
function load(registry: Registry = engine): SceneRuntimeHandle {
  const def = registry === engine ? scene : { ...scene, game: testGame.id };
  const library = registry === engine ? prefabs : gamePrefabs;
  const rt = createSceneRuntime({ rapier, view: null, registry, prefabs: library });
  const report = rt.load(expandScene(def, registry, { prefabs: library }));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

function steps(rt: SceneRuntimeHandle, n: number): StepEvent[] {
  const events: StepEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...rt.step(rt.ctx.time.tickMs, []).events);
  return events;
}

const pose = (rt: SceneRuntimeHandle, id: string): Pose => {
  const p = rt.ctx.poses.get(id);
  if (!p) throw new Error(`no pose for ${id}`);
  return { x: p.x, y: p.y, rot: p.rot };
};

const bodyOf = (rt: SceneRuntimeHandle, id: string) => {
  const [handle] = rt.ctx.tags.handlesOf(id);
  if (handle === undefined) throw new Error(`no collider for ${id}`);
  return rt.ctx.physics!.world.getCollider(handle)!.parent()!.handle;
};

/** `digits` 5 where a pose comes from the file's geometry, which is stored to the micrometre. */
function expectPose(actual: Pose, expected: Pose, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.rot).toBeCloseTo(expected.rot, digits);
}

const TURRET_PARTS = ["base", "barrel", "sight"] as const;

describe("tree-yard.json", () => {
  it("names no game and validates clean under the gameless engine registry", () => {
    expect(scene.game ?? null).toBeNull();
    const issues = validateScene(scene, engine, { prefabs });
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("passes every check headless, none skipped", () => {
    const report = runChecks({ rapier, scene, prefabs, registry: engine, checks, readFile: read });
    expect(report.results.map((r) => [r.id, r.kind])).toEqual([
      ["valid", "valid"],
      ["rider-carried", "reaches"],
      ["room-stands", "reaches"],
      ["room-expires", "reaches"],
      ["plain-tree", "reaches"],
    ]);
    for (const r of report.results) {
      expect(r.skipped, r.id).toBeUndefined();
      expect(r.pass, `${r.id}: ${r.message}`).toBe(true);
    }
  });

  it("plays its input script, holding nothing, until the lift has carried the rider to lift-stop", () => {
    const script = JSON.parse(read("tree-yard.script.json")) as {
      steps: { hold?: string[]; until?: unknown }[];
    };
    expect(script.steps).toEqual([
      expect.objectContaining({
        hold: [],
        until: { near: { id: "rider/hero", to: "lift-stop", within: 0.3 } },
      }),
    ]);
    const carried = checks.checks.find((c) => c.id === "rider-carried")!;
    expect(carried).toMatchObject({ script: "tree-yard.script.json", result: "script-end" });
    const still = { ...scene, entities: scene.entities?.filter((e) => e.id !== "lift") };
    const report = runChecks({
      rapier,
      scene: { ...still, entities: still.entities?.filter((e) => e.id !== "deck") },
      prefabs,
      registry: engine,
      checks: { ...checks, checks: [carried] },
      readFile: read,
    });
    expect(report.results[0]?.pass, "with no lift the rider stays put").toBe(false);
  });
});

describe("the turret", () => {
  it("is base, barrel and a sight sensor under the instance's node, moving and turning with it", () => {
    const rt = load();
    const { tree } = rt.ctx;
    expect(tree.parent("turret-a")).toBeNull();
    expect(tree.children("turret-a")).toEqual(TURRET_PARTS.map((p) => `turret-a/${p}`));
    const node = pose(rt, "turret-a");
    const locals = TURRET_PARTS.map((p) => relativePose(pose(rt, `turret-a/${p}`), node));
    rt.ctx.setPose("turret-a", 4, 9, Math.PI / 6);
    steps(rt, 1);
    TURRET_PARTS.forEach((p, i) =>
      expectPose(pose(rt, `turret-a/${p}`), composePose(4, 9, Math.PI / 6, locals[i]!)),
    );
    rt.destroy();
  });

  it("spawned at runtime under the tweening carrier, swings with it", () => {
    const rt = load();
    const placed = rt.ctx.instantiate("turret", [0, 0.8], { parent: "carrier", local: true });
    expect(rt.ctx.tree.parent(placed.id)).toBe("carrier");
    expect(placed.entities).toEqual(TURRET_PARTS.map((p) => `${placed.id}/${p}`));
    const start = pose(rt, "carrier");
    const seen: Pose[] = [];
    for (let i = 0; i < 4; i++) {
      steps(rt, 30);
      const carrier = pose(rt, "carrier");
      seen.push(carrier);
      expectPose(
        pose(rt, placed.id),
        composePose(carrier.x, carrier.y, carrier.rot, { x: 0, y: 0.8, rot: 0 }),
      );
      expectPose(
        pose(rt, `${placed.id}/barrel`),
        composePose(carrier.x, carrier.y, carrier.rot, { x: 0.5, y: 0.8 - 0.55, rot: 0 }),
      );
    }
    expect(seen.at(-1)!.x).toBeGreaterThan(start.x + 1);
    expect(seen.at(-1)!.rot).toBeGreaterThan(0.2);
    rt.destroy();
  });
});

describe("the turret built from plain entities", () => {
  it("is a node, a base under it and a barrel with a collider under the base, laid out as the prefab's", () => {
    const rt = load();
    const { tree } = rt.ctx;
    expect(tree.parent("tower")).toBeNull();
    expect(tree.children("tower")).toEqual(["tower-base"]);
    expect(tree.children("tower-base")).toEqual(["tower-barrel"]);
    expect(tree.subtree("tower")).toEqual(["tower", "tower-base", "tower-barrel"]);
    expect(rt.ctx.tags.handlesOf("tower-barrel").length).toBe(1);
    const node = pose(rt, "tower");
    const prefab = pose(rt, "turret-a");
    for (const part of ["base", "barrel"]) {
      expectPose(
        relativePose(pose(rt, `tower-${part}`), node),
        relativePose(pose(rt, `turret-a/${part}`), prefab),
      );
    }
    rt.destroy();
  });

  it("moves and turns as one when its node does", () => {
    const rt = load();
    const node = pose(rt, "tower");
    const locals = ["tower-base", "tower-barrel"].map((id) => relativePose(pose(rt, id), node));
    rt.ctx.setPose("tower", 8, 10, -Math.PI / 4);
    steps(rt, 1);
    expectPose(pose(rt, "tower-base"), composePose(8, 10, -Math.PI / 4, locals[0]!));
    expectPose(pose(rt, "tower-barrel"), composePose(8, 10, -Math.PI / 4, locals[1]!));
    rt.destroy();
  });
});

describe("the tilted turret", () => {
  it("is a turret instance under a node at 30 degrees, leaning with it", () => {
    const rt = load();
    expect(rt.ctx.tree.parent("tilt-turret")).toBe("tilt");
    expect(rt.ctx.tree.children("tilt-turret")).toEqual(
      TURRET_PARTS.map((p) => `tilt-turret/${p}`),
    );
    const tilt = pose(rt, "tilt");
    expect(tilt.rot).toBeCloseTo(Math.PI / 6, 9);
    expectPose(pose(rt, "tilt-turret"), tilt);
    const upright = pose(rt, "turret-a");
    for (const part of TURRET_PARTS) {
      const local = relativePose(pose(rt, `turret-a/${part}`), upright);
      expectPose(pose(rt, `tilt-turret/${part}`), composePose(tilt.x, tilt.y, tilt.rot, local), 5);
    }
    const sight = pose(rt, "tilt-turret/sight");
    expect(sight.y).toBeGreaterThan(tilt.y + 0.4);
    rt.destroy();
  });
});

describe("the three-level chain", () => {
  it("follows its swinging root, each level turned 30 degrees past the one above", () => {
    const rt = load();
    const { tree } = rt.ctx;
    expect(tree.parent("forearm")).toBe("arm");
    expect(tree.parent("hand")).toBe("forearm");
    expect(tree.subtree("arm")).toEqual(["arm", "forearm", "hand"]);
    const turns: number[] = [];
    for (let i = 0; i < 4; i++) {
      const arm = pose(rt, "arm");
      turns.push(arm.rot);
      const forearm = composePose(arm.x, arm.y, arm.rot, { x: 1, y: 0, rot: Math.PI / 6 });
      expectPose(pose(rt, "forearm"), forearm, 5);
      expectPose(
        pose(rt, "hand"),
        composePose(forearm.x, forearm.y, forearm.rot, { x: 1, y: 0, rot: 0 }),
        5,
      );
      steps(rt, 20);
    }
    expect(turns[0]).toBeCloseTo(Math.PI / 6, 6);
    expect(Math.max(...turns)).toBeGreaterThan(turns[0]! + 0.1);
    rt.destroy();
  });
});

describe("the crate", () => {
  it("carries crate-eye's collider on its own body, one body for the two", () => {
    const rt = load();
    expect(rt.ctx.tree.parent("crate-eye")).toBe("crate");
    expect(bodyOf(rt, "crate-eye")).toBe(bodyOf(rt, "crate"));
    const offset = relativePose(pose(rt, "crate-eye"), pose(rt, "crate"));
    steps(rt, 90);
    const crate = pose(rt, "crate");
    expect(crate.y).toBeGreaterThan(10.5);
    expectPose(pose(rt, "crate-eye"), composePose(crate.x, crate.y, crate.rot, offset));
    rt.destroy();
  });

  it("raises the eye's sensor:enter, under a game, when the crate carries it onto the deck", () => {
    const rt = load(game);
    rt.ctx.setPose("crate", 18, 10, 0);
    const events = steps(rt, 10);
    expect(
      events.some((e) => e.type === SENSOR_ENTER && e.entityId === "crate-eye"),
      JSON.stringify(events.filter((e) => e.type === SENSOR_ENTER)),
    ).toBe(true);
    rt.destroy();
  });
});

describe("the lift", () => {
  it("carries deck, its attached solid, and the rider standing on it", () => {
    const rt = load();
    expect(rt.ctx.tree.parent("deck")).toBe("lift");
    const deck0 = pose(rt, "deck");
    const lift0 = pose(rt, "lift");
    steps(rt, 120);
    const lift = pose(rt, "lift");
    expect(lift.x).toBeGreaterThan(lift0.x + 2);
    expect(pose(rt, "deck").x - lift.x).toBeCloseTo(deck0.x - lift0.x, 6);
    const hero = pose(rt, "rider/hero");
    expect(hero.y).toBeLessThan(pose(rt, "deck").y);
    const gap = hero.x - lift.x;
    steps(rt, 60);
    expect(pose(rt, "lift").x).toBeGreaterThan(lift.x + 1);
    expect(pose(rt, "rider/hero").x - pose(rt, "lift").x).toBeCloseTo(gap, 2);
    rt.destroy();
  });
});

describe("the room the spawner places", () => {
  it("goes with its root when its lifetime ends, nested prefabs and all, children first", () => {
    const rt = load();
    const first = steps(rt, 1);
    const spawned = first.filter((e) => e.type === "entity:spawned").map((e) => e.entityId);
    expect(spawned).toContain("room#1");
    expect(rt.ctx.tree.parent("room#1/door-1/latch")).toBe("room#1/door-1");
    expect(rt.ctx.tree.parent("room#1/door-1")).toBe("room#1");
    const subtree = rt.ctx.tree.subtree("room#1");
    expect(subtree).toContain("room#1/door-1/latch/trigger");
    const later = steps(rt, 150);
    const gone = later.filter((e) => e.type === "entity:destroyed").map((e) => e.entityId);
    expect(new Set(gone)).toEqual(new Set(subtree));
    expect(gone.at(-1)).toBe("room#1");
    expect(gone.indexOf("room#1/door-1/latch")).toBeLessThan(gone.indexOf("room#1/door-1"));
    for (const id of subtree) expect(rt.ctx.exists(id), id).toBe(false);
    rt.destroy();
  });
});
