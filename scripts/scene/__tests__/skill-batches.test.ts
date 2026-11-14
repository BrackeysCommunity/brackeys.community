// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatPrefab,
  formatScene,
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
} from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { runCli } from "../commands";
import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import { tempProject } from "./fixtures";

/** The `scene-editing` skill's behavior batches and the script it plays them with, quoted there verbatim. */
const EXAMPLES = fileURLToPath(new URL("../examples/behaviors/", import.meta.url));
const BATCHES = {
  hero: join(EXAMPLES, "side-view-hero.json"),
  crate: join(EXAMPLES, "pushable-crate.json"),
  param: join(EXAMPLES, "runner-max-speed.json"),
  script: join(EXAMPLES, "run-to-crate.json"),
};

/** The skill's tree batches, run in order on `TREE_YARD`. */
const TREE_EXAMPLES = fileURLToPath(new URL("../examples/tree/", import.meta.url));
const TREE = {
  build: join(TREE_EXAMPLES, "build-turret.json"),
  reparent: join(TREE_EXAMPLES, "reparent-crate.json"),
  turn: join(TREE_EXAMPLES, "turn-tower.json"),
  nudge: join(TREE_EXAMPLES, "nudge-barrel.json"),
};

/** The floor's top: a hero 0.8 m tall stands at y 4.6, a 0.5 m crate at 4.75. */
const floor = { id: "floor", type: "solid", shape: ["box", 6, 5.2, 6, 0.2] };
const room = (name: string, entities: unknown[]): SceneDefinition =>
  ({
    v: SCENE_FORMAT_VERSION,
    name,
    bounds: [0, 0, 12, 6],
    settings: { physics: "rapier", gravity: [0, 20] },
    entities: [floor, ...entities],
  }) as SceneDefinition;

/** What the skill's batches start from: a marker where the hero goes, a crate, and a flag past it. */
const YARD = room("yard", [
  { id: "spawn", type: "marker", at: [1, 4.6] },
  { id: "crate", type: "marker", at: [4, 4.75] },
  { id: "flag", type: "marker", at: [7, 4.75] },
]);
const LANE = room("lane", []);
/** What the tree batches start from: a crate marker left of where the tower goes. */
const TREE_YARD = room("tree", [{ id: "crate", type: "marker", at: [6, 4.75] }]);
const RUNNER: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "runner",
  entities: [
    {
      id: "hero",
      type: "marker",
      at: [0, 0],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.2, 0.4] },
        "character-side-view": {},
        "player-input": {},
      },
    },
  ],
} as Prefab;

let root: string;
let dir: string;
let ctx: ToolContext;

type Step = { index: number; ticks: number; end: string };
type Report = { exitCode: number; steps: Step[]; ticks: number };

async function cli(argv: string[]): Promise<Record<string, unknown> & { exitCode: number }> {
  const r = await runCli([...argv, "--json"], ctx);
  const data = JSON.parse(r.stdout) as Record<string, unknown>;
  return { ...data, exitCode: r.exitCode };
}

const playtest = async (scene: string, script: string) =>
  (await cli(["playtest", scene, "--script", script])) as unknown as Report;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "skill-batches-"));
  dir = join(root, "skill-yard");
  await mkdir(join(dir, "prefabs"), { recursive: true });
  await writeFile(join(dir, "yard.json"), formatScene(YARD).text);
  await writeFile(join(dir, "lane.json"), formatScene(LANE).text);
  await writeFile(join(dir, "tree.json"), formatScene(TREE_YARD).text);
  await writeFile(join(dir, "prefabs", "runner.json"), formatPrefab(RUNNER));
  ctx = { projects: [await tempProject(dir, { id: "skill-yard" })], loadRapier: loadCompatRapier };
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the scene-editing skill's behavior batches", () => {
  it("are the files this test runs, every one", async () => {
    expect((await readdir(EXAMPLES)).sort()).toEqual(
      Object.values(BATCHES)
        .map((p) => p.slice(EXAMPLES.length))
        .sort(),
    );
  });

  it("make a marker a playable side-view hero, which the script runs to a near", async () => {
    const dry = await cli(["apply", "yard", "--ops", BATCHES.hero, "--dry-run"]);
    expect(dry.exitCode, JSON.stringify(dry)).toBe(0);
    expect((await cli(["apply", "yard", "--ops", BATCHES.hero])).exitCode).toBe(0);
    expect((await cli(["validate", "yard"])).exitCode).toBe(0);

    const run = await playtest("yard", BATCHES.script);
    expect(run.exitCode, JSON.stringify(run)).toBe(0);
    expect(run.steps[0]).toMatchObject({ end: "until" });
    // A marker with no body of its own: the hero runs through it and it stays put.
    expect(run.steps[1]).toMatchObject({ end: "max" });
  });

  it("give an entity a body the hero pushes, to a near the flag", async () => {
    expect((await cli(["apply", "yard", "--ops", BATCHES.crate, "--dry-run"])).exitCode).toBe(0);
    expect((await cli(["apply", "yard", "--ops", BATCHES.crate])).exitCode).toBe(0);
    const run = await playtest("yard", BATCHES.script);
    expect(run.exitCode, JSON.stringify(run)).toBe(0);
    expect(run.steps.map((s) => s.end)).toEqual(["until", "until"]);
  });

  it("expose a controller field as a prefab param that an instance sets", async () => {
    const param = ["assets", "apply", "--ops", BATCHES.param, "--project", "skill-yard"];
    expect((await cli([...param, "--dry-run"])).exitCode).toBe(0);
    expect((await cli(param)).exitCode).toBe(0);
    const prefab = JSON.parse(await readFile(join(dir, "prefabs", "runner.json"), "utf8"));
    expect(prefab.params.maxSpeed.targets).toEqual(["hero.behaviors.character-side-view.maxSpeed"]);

    const place = join(root, "place.json");
    await writeFile(
      place,
      JSON.stringify({
        ops: [
          {
            op: "instantiate",
            instance: { id: "runner-1", prefab: "runner", at: [1, 4.6], params: { maxSpeed: 2 } },
          },
        ],
      }),
    );
    expect((await cli(["apply", "lane", "--ops", place])).exitCode).toBe(0);
    const script = join(root, "lane-run.json");
    await writeFile(
      script,
      JSON.stringify({
        v: 2,
        steps: [
          {
            set: { move: [1, 0] },
            until: { near: { id: "runner-1/hero", to: [9, 4.6], within: 0.2 } },
            max: 600,
          },
        ],
      }),
    );
    const slow = await playtest("lane", script);
    expect(slow.steps[0], JSON.stringify(slow)).toMatchObject({ end: "until" });
    // 8 m at 2 m/s.
    expect(slow.ticks).toBeGreaterThan(230);

    const fast = join(root, "fast.json");
    await writeFile(
      fast,
      JSON.stringify({ ops: [{ op: "setParam", ref: "runner-1", name: "maxSpeed", value: 6 }] }),
    );
    expect((await cli(["apply", "lane", "--ops", fast])).exitCode).toBe(0);
    const quick = await playtest("lane", script);
    expect(quick.steps[0]).toMatchObject({ end: "until" });
    expect(quick.ticks).toBeLessThan(slow.ticks / 2);
  });
});

type Row = {
  ref: string;
  parent?: string;
  at?: [number, number];
  origin?: [number, number];
  transform?: { rot: number; flip: boolean };
  extra?: { rot?: number };
};

/** `show`'s rows by ref. */
async function rows(scene: string): Promise<Map<string, Row>> {
  const shown = await cli(["show", scene]);
  return new Map((shown.entities as Row[]).map((r) => [r.ref, r]));
}

/** A point entity's world position: its stored `at` placed by its row's frame. */
function world(row: Row): [number, number] {
  const [x, y] = row.at!;
  const [ox, oy] = row.origin ?? [0, 0];
  const turn = ((row.transform?.rot ?? 0) * Math.PI) / 180;
  return [
    ox + x * Math.cos(turn) - y * Math.sin(turn),
    oy + x * Math.sin(turn) + y * Math.cos(turn),
  ];
}

function expectNear(actual: [number, number], expected: [number, number]) {
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
}

describe("the scene-editing skill's tree batches", () => {
  const apply = async (file: string) => {
    const dry = await cli(["apply", "tree", "--ops", file, "--dry-run"]);
    expect(dry.exitCode, JSON.stringify(dry)).toBe(0);
    const done = await cli(["apply", "tree", "--ops", file]);
    expect(done.exitCode, JSON.stringify(done)).toBe(0);
    expect((await cli(["validate", "tree"])).exitCode).toBe(0);
  };

  it("are the files this test runs, every one", async () => {
    expect((await readdir(TREE_EXAMPLES)).sort()).toEqual(
      Object.values(TREE)
        .map((p) => p.slice(TREE_EXAMPLES.length))
        .sort(),
    );
  });

  it("build a turret from a node, a base under it and a barrel with a collider under the base", async () => {
    await apply(TREE.build);
    const r = await rows("tree");
    expect(r.get("tower")).toMatchObject({ at: [8, 5] });
    expect(r.get("tower")?.parent).toBeUndefined();
    expect(r.get("tower-base")).toMatchObject({ parent: "tower", origin: [8, 5] });
    expect(r.get("tower-barrel")).toMatchObject({ parent: "tower-base", at: [0.5, -0.35] });
    expectNear(world(r.get("tower-barrel")!), [8.5, 4.45]);
    const step = await cli(["step", "tree", "--ticks", "30"]);
    expect(step.exitCode, JSON.stringify(step)).toBe(0);
  });

  it("reparent the crate under the tower without moving it in the world", async () => {
    await apply(TREE.reparent);
    const r = await rows("tree");
    expect(r.get("crate")).toMatchObject({ parent: "tower", at: [-2, -0.25] });
    expectNear(world(r.get("crate")!), [6, 4.75]);
  });

  it("turn the tower by any angle with transform's rotate, what sits under it turning about its origin", async () => {
    await apply(TREE.turn);
    const r = await rows("tree");
    expect(r.get("tower")).toMatchObject({ at: [8, 5], extra: { rot: 30 } });
    expect(r.get("crate")).toMatchObject({ at: [-2, -0.25], transform: { rot: 30 } });
    const turn = Math.PI / 6;
    expectNear(world(r.get("crate")!), [
      8 - 2 * Math.cos(turn) + 0.25 * Math.sin(turn),
      5 - 2 * Math.sin(turn) - 0.25 * Math.cos(turn),
    ]);
  });

  it("move the barrel in its stored coordinates: along the turned parent's x, not the world's", async () => {
    const before = (await rows("tree")).get("tower-barrel")!;
    await apply(TREE.nudge);
    const after = (await rows("tree")).get("tower-barrel")!;
    expect(after.at).toEqual([0.7, -0.35]);
    const [x0, y0] = world(before);
    const [x1, y1] = world(after);
    expect(x1 - x0).toBeCloseTo(0.2 * Math.cos(Math.PI / 6), 5);
    expect(y1 - y0).toBeCloseTo(0.2 * Math.sin(Math.PI / 6), 5);
  });
});
