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
