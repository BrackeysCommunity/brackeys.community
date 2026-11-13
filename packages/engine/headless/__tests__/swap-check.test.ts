// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { heldInput } from "../../__tests__/fixtures/held-project";
import { oneSceneVersion } from "../../__tests__/fixtures/live-version";
import { testGame } from "../../__tests__/fixtures/test-game";
import type { ExportInput } from "../../export/plan";
import { defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { LIVE_DEFAULTS } from "../../game/live";
import type { GameDefinition, SceneSystem } from "../../game/types";
import {
  ENGINE_DIR,
  ENGINE_PROJECT,
  readHeld,
} from "../../project/__tests__/fixtures/scene-version/held-files";
import { buildSceneVersion, readSceneVersion } from "../../project/scene-version";
import type { ChecksFile } from "../../scene/checks";
import { formatScene } from "../../scene/format";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type RuntimeEntity,
  type SceneDefinition,
  type SceneIssue,
} from "../../scene/types";
import type { RapierModule, StagedVersion } from "../../types";
import { swapCheck } from "../swap-check";

const GAME = "probe";
const HERO = "probe-hero";
const FLOOR = "probe-floor";
const BOMB = "probe-bomb";
const SCENE = "probe-yard";
const FLOORLESS = "probe/floorless";
/** Half a floor's width: a floor at x holds up x ± this. */
const FLOOR_REACH = 2;
const SCRIPT = { v: 1 as const, scene: SCENE, steps: [{ wait: 200 }] };

type Hero = RuntimeEntity<{ at: Pt; speed: number }>;
type Floor = RuntimeEntity<{ at: Pt }>;

/** A hero that walks right at its speed over floors; `live.check` reports a hero no floor holds up. */
function probeGame(opts: { onSwapThrows?: boolean; checked?: number[] } = {}): GameDefinition {
  return defineGame({
    id: GAME,
    world: { physics: "none" },
    actions: [],
    live: {
      timings: ["next-load", "boundary", "now"],
      check(ctx) {
        opts.checked?.push(ctx.tick);
        const issues: SceneIssue[] = [];
        const floors = ctx.query.select({ type: FLOOR }).map((id) => ctx.poses.get(id)!.x);
        for (const id of ctx.query.select({ type: HERO })) {
          const x = ctx.poses.get(id)!.x;
          if (floors.some((f) => Math.abs(f - x) <= FLOOR_REACH)) continue;
          issues.push({
            severity: "error",
            code: FLOORLESS,
            message: `${id} stands on no floor`,
            entityIds: [id],
          });
        }
        return issues;
      },
    },
    types: [
      {
        type: HERO,
        description: "A point that walks right.",
        fields: {
          at: pointField("Where it starts."),
          speed: z.number().default(0).describe("Metres a second."),
        },
        system: (ctx): SceneSystem<Hero> => {
          const heroes = new Map<string, { x: number; speed: number }>();
          return {
            spawn(e) {
              heroes.set(e.id, { x: e.at[0], speed: e.speed });
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void heroes.delete(id),
            clear: () => heroes.clear(),
            size: () => heroes.size,
            beforeStep(dtMs) {
              for (const [id, h] of heroes) {
                h.x += (h.speed * dtMs) / 1000;
                ctx.poses.set(id, h.x, ctx.poses.get(id)!.y, 0);
              }
            },
            save: (id) => {
              const h = heroes.get(id);
              return h ? { x: h.x } : undefined;
            },
            restore(id, state) {
              const h = heroes.get(id);
              if (h) h.x = (state as { x: number }).x;
            },
          };
        },
      },
      {
        type: FLOOR,
        description: "Ground four metres wide, centred on its point.",
        fields: { at: pointField("Its centre.") },
        system: (ctx): SceneSystem<Floor> => {
          const floors = new Set<string>();
          return {
            spawn(e) {
              floors.add(e.id);
              ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
            },
            despawn: (id) => void floors.delete(id),
            clear: () => floors.clear(),
            size: () => floors.size,
          };
        },
      },
      {
        type: BOMB,
        description: "Throws out of every step it is in.",
        fields: { at: pointField("Where it sits.") },
        system: (): SceneSystem<RuntimeEntity<{ at: Pt }>> => {
          const bombs = new Set<string>();
          return {
            spawn: (e) => void bombs.add(e.id),
            despawn: (id) => void bombs.delete(id),
            clear: () => bombs.clear(),
            size: () => bombs.size,
            beforeStep() {
              if (bombs.size > 0) throw new Error("the bomb went off");
            },
          };
        },
      },
    ],
    createRuntime() {
      return {
        snapshot: () => null,
        onSwap() {
          if (opts.onSwapThrows) throw new Error("onSwap broke");
        },
      };
    },
  });
}

function yard(edit: (entities: EntityDef[], def: SceneDefinition) => void = () => {}) {
  const entities: EntityDef[] = [
    { id: "hero", type: HERO, at: [1, 1] },
    { id: "floor-a", type: FLOOR, at: [1, 0] },
    { id: "floor-b", type: FLOOR, at: [10, 0] },
  ];
  const def: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: SCENE,
    game: GAME,
    bounds: [0, 0, 40, 10],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
  edit(entities, def);
  return def;
}

/** A version of the yard as a host fetched it. */
const versionOf = (def: SceneDefinition, game: GameDefinition) =>
  oneSceneVersion(def, game, { scene: SCENE, path: "scenes/probe-yard.json" });

const release = { def: yard(), prefabs: new Map() };
const scripts = [{ name: "stand", script: SCRIPT }];
const codes = (issues: readonly SceneIssue[]) => issues.map((i) => i.code);

describe("swapCheck", () => {
  it("reports through the game's live.check a version that removes the floor under the spawn", async () => {
    const game = probeGame();
    const to = await versionOf(
      yard((es) => void es.splice(1, 1)),
      game,
    );
    const report = swapCheck({ game, from: release, to, scripts });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([]);
    expect(report.runs.map((r) => [r.script, r.at, r.tick, r.strategy])).toEqual([
      ["stand", 0.25, 50, "reconcile"],
      ["stand", 0.5, 100, "reconcile"],
      ["stand", 0.75, 150, "reconcile"],
    ]);
    for (const run of report.runs) {
      expect(codes(run.issues)).toEqual([FLOORLESS]);
      expect(run.issues[0]!.entityIds).toEqual(["hero"]);
    }
  });

  it("runs live.check right after the swap and 60 ticks later", async () => {
    const checked: number[] = [];
    const game = probeGame({ checked });
    const to = await versionOf(
      yard((es) => void (es[2] = { ...es[2]!, at: [12, 0] })),
      game,
    );
    const report = swapCheck({ game, from: release, to, scripts, at: [0.5] });
    expect(report.ok).toBe(true);
    expect(checked).toEqual([100, 160]);
  });

  it("runs the second check at the run's end when afterTicks is under 60", async () => {
    const checked: number[] = [];
    const game = probeGame({ checked });
    const to = await versionOf(
      yard((es) => void (es[2] = { ...es[2]!, at: [12, 0] })),
      game,
    );
    swapCheck({ game, from: release, to, scripts, at: [0.5], afterTicks: 10 });
    expect(checked).toEqual([100, 110]);
  });

  it("reports live-swap-failed when onSwap throws", async () => {
    const game = probeGame({ onSwapThrows: true });
    const to = await versionOf(
      yard((es) => void (es[2] = { ...es[2]!, at: [12, 0] })),
      game,
    );
    const report = swapCheck({ game, from: release, to, scripts });
    expect(report.ok).toBe(false);
    expect(report.runs).toHaveLength(LIVE_DEFAULTS.checkAt.length);
    for (const run of report.runs) {
      expect(codes(run.issues)).toEqual(["live-swap-failed"]);
      expect(run.issues[0]!.hint).toBe("onSwap broke");
      expect(run.issues[0]!.detail).toEqual({ phase: "onSwap" });
    }
  });

  it("reports a step that throws after the swap", async () => {
    const game = probeGame();
    const to = await versionOf(
      yard((es) => void es.push({ id: "bomb", type: BOMB, at: [5, 5] })),
      game,
    );
    const report = swapCheck({ game, from: release, to, scripts, at: [0.5] });
    expect(report.ok).toBe(false);
    const [run] = report.runs;
    expect(run!.tick).toBe(100);
    expect(codes(run!.issues)).toEqual(["live-swap-failed"]);
    expect(run!.issues[0]!.hint).toBe("a step threw at tick 100: the bomb went off");
  });

  it("passes a harmless version, and runs the scene's checks against it", async () => {
    const game = probeGame();
    const to = await versionOf(
      yard((es) => void (es[2] = { ...es[2]!, at: [12, 0] })),
      game,
    );
    const checks: ChecksFile = { v: 3, checks: [{ id: "valid", kind: "valid" }] };
    const report = swapCheck({
      game,
      from: release,
      to,
      scripts,
      checks: { file: checks, readFile: () => "" },
    });
    expect(report.ok).toBe(true);
    expect(report.runs.every((r) => r.issues.length === 0 && r.strategy === "reconcile")).toBe(
      true,
    );
    expect(report.checks?.ok).toBe(true);
    expect(report.checks?.results.map((r) => [r.id, r.pass])).toEqual([["valid", true]]);
  });

  it("reloads a version whose header changed, and swaps from a staged version", async () => {
    const game = probeGame();
    const from = await versionOf(yard(), game);
    const to = await versionOf(
      yard((_es, def) => void (def.bounds = [0, 0, 60, 10])),
      game,
    );
    const report = swapCheck({ game, from, to, scripts, at: [0.25] });
    expect(report.ok).toBe(true);
    expect(report.runs.map((r) => r.strategy)).toEqual(["reload"]);
  });

  it("names a script that doesn't play on the scene and runs the others", async () => {
    const game = probeGame();
    const to = await versionOf(yard(), game);
    const report = swapCheck({
      game,
      from: release,
      to,
      at: [0.5],
      scripts: [{ name: "elsewhere", script: { ...SCRIPT, scene: "other" } }, ...scripts],
    });
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => [i.code, i.path])).toEqual([["schema", "/scene"]]);
    expect(report.issues[0]!.message).toMatch(/^elsewhere: /);
    expect(report.runs.map((r) => r.script)).toEqual(["stand"]);
  });

  it("is deterministic", async () => {
    const game = probeGame();
    const to = await versionOf(
      yard((es) => void es.splice(1, 1)),
      game,
    );
    const once = () => swapCheck({ game, from: release, to, scripts });
    expect(once()).toEqual(once());
  });
});

describe("swapCheck on the kitchen sink", () => {
  const SINK = "kitchen-sink";
  const SINK_PATH = "kitchen-sink.json";
  let rapier: RapierModule;
  let input: ExportInput;
  let moved: ExportInput;

  /** The sink's version built from the engine project's files, its definition edited first. */
  async function sinkVersion(from: ExportInput): Promise<StagedVersion> {
    const result = await buildSceneVersion({
      view: from.view,
      texts: from.texts,
      build: from.snapshot.build,
      game: from.game,
      registry: from.registry,
      scene: SINK,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    return { id: result.id, version: result.version, texts: result.texts };
  }

  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
    const held = readHeld(ENGINE_DIR);
    input = await heldInput(ENGINE_PROJECT, held, testGame);
    const def = JSON.parse(held.texts.get(SINK_PATH)!) as SceneDefinition;
    const lamp = def.entities!.find((e) => e.id === "lamp") as EntityDef & { at: Pt };
    lamp.at = [lamp.at[0] + 0.5, lamp.at[1]];
    const texts = new Map(held.texts);
    texts.set(SINK_PATH, formatScene(def).text);
    moved = await heldInput(
      ENGINE_PROJECT,
      {
        texts,
        files: held.files.map((f) => (f.path === SINK_PATH ? { path: f.path, json: def } : f)),
      },
      testGame,
    );
  });

  it("passes a version moving one entity, the sink's checks included", async () => {
    const from = await sinkVersion(input);
    const to = await sinkVersion(moved);
    expect(to.id).not.toBe(from.id);
    const read = readSceneVersion(to.version, to.texts, input.registry, testGame);
    expect(read.ok).toBe(true);
    const checks = JSON.parse(readFileSync(join(ENGINE_DIR, "kitchen-sink.checks.json"), "utf8"));
    const report = swapCheck({
      game: testGame,
      registry: input.registry,
      from,
      to,
      rapier,
      scripts: [{ name: "wait", script: { v: 1, scene: SINK, steps: [{ wait: 120 }] } }],
      checks: {
        file: checks as ChecksFile,
        readFile: (path) => readFileSync(join(ENGINE_DIR, path), "utf8"),
      },
    });
    expect(report.issues).toEqual([]);
    expect(report.runs.map((r) => [r.tick, r.strategy, r.issues])).toEqual([
      [30, "reconcile", []],
      [60, "reconcile", []],
      [90, "reconcile", []],
    ]);
    expect(report.checks?.results).toHaveLength(checks.checks.length);
    expect(report.checks?.results.filter((r) => !r.pass)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 60_000);
});
