// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import type { LibraryScene, SceneLibrary } from "../../game/flow";
import type { GameDefinition } from "../../game/types";
import { expandScene } from "../../scene/expand";
import { parseRecording, type RunRecording } from "../../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { createHeadlessRuntime } from "../headless";
import { runPlaytest } from "../playtest";
import type { InputScript, PlaytestReport, PlaytestRun } from "../playtest-types";
import { replayRecording } from "../recording";

type Snap = {
  scene: string | null;
  entry: string | null;
  x: number;
  ticks: number;
  trips: number;
  won: boolean;
};
type Trips = { trips: number };

const GO = "go";
const WIN_AND_GO = "win-and-go";
/** The result scene sends the run back to the menu on its own after this many ticks. */
const RESULT_TICKS = 5;

/**
 * A physics-free game that walks scenes: `go` requests one, the result
 * scene requests the menu by itself, holding `right` counts up `x`, and
 * every request bumps the persistent trip count.
 */
const flowGame: GameDefinition<Snap> = defineGame<Snap>({
  id: "flow-walk",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Walks right." }],
  world: { physics: "none" },
  persist: {
    initial: () => ({ trips: 0 }),
    schema: z.strictObject({ trips: z.number().int().min(0) }),
  },
  commands: {
    [GO]: {
      description: "Requests a scene.",
      args: z.strictObject({
        to: z.string().describe("The scene."),
        entry: z.string().optional().describe("Where to arrive."),
      }),
    },
    [WIN_AND_GO]: { description: "Wins and requests the menu in one tick." },
  },
  play: {
    outcome: ({ snapshot }) => (snapshot.won ? { result: "won" } : null),
    results: ["won"],
  },
  createRuntime(ctx) {
    let x = 0;
    let ticks = 0;
    let won = false;
    const trips = () => (ctx.persist.value as Trips).trips;
    const request = (to: string, entry?: string) =>
      ctx.flow.request({ to, ...(entry ? { entry } : {}), persist: { trips: trips() + 1 } });
    return {
      onLoad() {
        x = 0;
        ticks = 0;
        won = false;
      },
      beforeStep(_dt, _actions, commands) {
        if (ctx.input.held("right")) x++;
        for (const c of commands) {
          const args = c.args as { to: string; entry?: string } | undefined;
          if (c.name === GO) request(args!.to, args!.entry);
          if (c.name === WIN_AND_GO) {
            won = true;
            request("menu");
          }
        }
      },
      afterStep() {
        ticks++;
        if (ctx.flow.scene === "result" && ticks === RESULT_TICKS) request("menu");
      },
      snapshot: () => ({
        scene: ctx.flow.scene,
        entry: ctx.flow.entry,
        x,
        ticks,
        trips: trips(),
        won,
      }),
    };
  },
});

const scene = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "flow-walk",
  bounds: [0, 0, 10, 10],
  entities: [
    { id: "start", type: "marker", at: [1, 1] },
    { id: "podium", type: "marker", at: [5, 1] },
  ],
});

const listed = (id: string): LibraryScene => ({ def: scene(id), prefabs: new Map() });

const library: SceneLibrary = {
  list: [
    { scene: "menu", title: "Menu" },
    { scene: "level", title: "Level 1" },
    { scene: "result", title: "Result" },
    { scene: "cellar", sublevel: true },
  ],
  scenes: new Map([
    ["menu", listed("menu")],
    ["level", listed("level")],
    ["result", listed("result")],
    ["cellar", listed("cellar")],
  ]),
};
const menu = library.scenes.get("menu")!.def;

/** Menu → level → result → menu on one script, `right` held across the level's end. */
const tour: InputScript = {
  v: 1,
  steps: [
    { command: GO, args: { to: "level" } },
    { hold: ["right"], for: 10 },
    { command: GO, args: { to: "result", entry: "podium" } },
    { hold: ["right"], until: { scene: "menu" }, max: 100 },
    { hold: ["right"], for: 3 },
  ],
};

function report(run: PlaytestRun<Snap>): PlaytestReport<Snap> {
  if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run)}`);
  return run;
}

const play = (script: InputScript, flow: SceneLibrary | null = library) =>
  runPlaytest<Snap>({ game: flowGame, scene: menu, script, ...(flow ? { flow } : {}) });

const replay = (rec: RunRecording) => {
  const def = library.scenes.get(rec.scene)!.def;
  const run = replayRecording<Snap>({ game: flowGame, scene: def, recording: rec, flow: library });
  if (run.blocked) throw new Error(`replay blocked: ${JSON.stringify(run)}`);
  return run;
};

describe("a headless playtest that follows flow requests", () => {
  it("goes menu → level → result → menu on one script, one segment per scene", () => {
    const r = report(play(tour));
    expect(r.segments!.map((s) => s.scene)).toEqual(["menu", "level", "result", "menu"]);
    expect(r.segments!.map((s) => s.ticks)).toEqual([1, 11, RESULT_TICKS, 4]);
    expect(r.segments!.map((s) => s.end)).toEqual([
      { result: "flow", tick: 0, to: "level" },
      { result: "flow", tick: 10, to: "result", entry: "podium" },
      { result: "flow", tick: RESULT_TICKS - 1, to: "menu" },
      { result: "script-end", tick: 3 },
    ]);
    expect(r.ticks).toBe(1 + 11 + RESULT_TICKS + 4);
    expect(r.outcome).toMatchObject({ result: "script-end", tick: r.ticks - 1 });
    expect(r.steps.map((s) => s.end)).toEqual(["done", "done", "done", "until", "done"]);
    expect(r.steps[3]).toMatchObject({ start: 12, ticks: RESULT_TICKS + 1 });
    expect(r.commands.map(([tick]) => tick)).toEqual([0, 11]);
    expect(r.final).toEqual({
      scene: "menu",
      entry: null,
      x: 4,
      ticks: 4,
      trips: 3,
      won: false,
    });
    expect(r.recording).toBe(r.segments![0]!.recording);
    expect(r.scene).toBe("menu");
  });

  it("records each scene on its own: persist and entry at its start, the request that ended it as next", () => {
    const [m, level, result, back] = report(play(tour)).segments!.map((s) => s.recording);
    expect(m!.start).toEqual({ persist: { trips: 0 } });
    expect(m!.next).toEqual({ scene: "level" });
    expect(level!.start).toEqual({ persist: { trips: 1 } });
    expect(level!.next).toEqual({ scene: "result", entry: "podium" });
    expect(result!.start).toEqual({ persist: { trips: 2 }, entry: "podium" });
    expect(result!.next).toEqual({ scene: "menu" });
    expect(back!.start).toEqual({ persist: { trips: 3 } });
    expect(back).not.toHaveProperty("next");
    expect(result!.inputs[0]![0]).toEqual([0, "b", 0, 1]);
    for (const rec of [m, level, result, back])
      expect(parseRecording(JSON.stringify(rec))).toEqual({ ok: true, recording: rec });
  });

  it("replays each segment's recording alone to its segment's digest, ending at next without following it", () => {
    const r = report(play(tour));
    const finals = r.segments!.map((seg) => {
      const again = replay(seg.recording);
      expect(again.matches, again.divergence ?? "").toBe(true);
      expect(again.recording.end).toBe(seg.recording.end);
      expect(again.recording.ticks).toBe(seg.ticks);
      expect(again.recording.next).toEqual(seg.recording.next);
      expect(again.stale).toBe(false);
      return again.final;
    });
    expect(finals.map((f) => [f!.scene, f!.entry, f!.x, f!.trips])).toEqual([
      ["menu", null, 0, 0],
      ["level", null, 11, 1],
      ["result", "podium", RESULT_TICKS, 2],
      ["menu", null, 4, 3],
    ]);
  });

  it("is deterministic: the same script gives the same report", () => {
    expect(JSON.stringify(report(play(tour)))).toBe(JSON.stringify(report(play(tour))));
  });

  it("without flow, a request ends the run as flow with the scene it went to", () => {
    const r = report(play(tour, null));
    expect(r.outcome).toMatchObject({ result: "flow", tick: 0, to: "level" });
    expect(r.ticks).toBe(1);
    expect(r.recording.outcome.result).toBe("flow");
    expect(r.recording.next).toEqual({ scene: "level" });
    expect(r).not.toHaveProperty("segments");
    expect(r.final!.scene).toBeNull();
  });

  it("ends on the game's outcome even with a request pending", () => {
    const r = report(play({ v: 1, steps: [{ command: WIN_AND_GO }, { wait: 5 }] }));
    expect(r.outcome).toMatchObject({ result: "won", tick: 0 });
    expect(r.segments!.map((s) => s.end)).toEqual([{ result: "won", tick: 0 }]);
    expect(r.recording).not.toHaveProperty("next");
  });

  it("refuses a request to a scene that isn't a main scene of the list", () => {
    for (const [to, code] of [
      ["nowhere", "scene-unlisted"],
      ["cellar", "scene-unlisted"],
    ] as const) {
      const run = play({ v: 1, steps: [{ command: GO, args: { to } }, { wait: 2 }] });
      expect(run.blocked).toBe(true);
      if (!run.blocked) continue;
      expect(run.stage).toBe("run");
      expect(run.issues.map((i) => i.code)).toContain(code);
    }
    const missing: SceneLibrary = {
      list: [...library.list, { scene: "credits" }],
      scenes: library.scenes,
    };
    const run = play({ v: 1, steps: [{ command: GO, args: { to: "credits" } }] }, missing);
    expect(run.blocked && run.issues.map((i) => i.code)).toContain("asset-missing");
  });

  it("counts until.tick and maxTicks from the run's start, across scenes", () => {
    const r = report(
      play({
        v: 1,
        maxTicks: 8,
        steps: [
          { command: GO, args: { to: "level" } },
          { hold: ["right"], until: { tick: 5 } },
        ],
      }),
    );
    expect(r.steps[1]).toMatchObject({ start: 1, end: "until", ticks: 5 });
    const capped = report(
      play({ v: 1, maxTicks: 8, steps: [{ command: GO, args: { to: "level" } }, { wait: 50 }] }),
    );
    expect(capped.outcome.result).toBe("timeout");
    expect(capped.ticks).toBe(8);
    expect(capped.segments!.map((s) => s.ticks)).toEqual([1, 7]);
  });
});

describe("a headless runtime with flow", () => {
  it("applies a request after the step that made it, with the request's entry and persist", () => {
    const registry = createRegistry(flowGame);
    const runtime = createHeadlessRuntime({
      game: flowGame,
      registry,
      scene: expandScene(menu, registry),
      flow: library,
    });
    try {
      expect(runtime.ctx.flow.scene).toBe("menu");
      runtime.step(1000 / 60, [], [{ name: GO, args: { to: "result", entry: "podium" } }]);
      expect(runtime.ctx.flow.scene).toBe("result");
      expect(runtime.ctx.flow.entry).toBe("podium");
      expect(runtime.ctx.persist.value).toEqual({ trips: 1 });
      expect(runtime.snapshot()).toMatchObject({ scene: "result", ticks: 0 });
    } finally {
      runtime.destroy();
    }
  });
});
