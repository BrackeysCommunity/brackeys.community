// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  GOAL_EVENT,
  NUDGE,
  testGame,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { createSessionRecording } from "../../runtime/play-session";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { formatScene } from "../../scene/format";
import { hashText } from "../../scene/hash";
import { undescribedProperties } from "../../scene/json-schema";
import { parseSceneOrThrow } from "../../scene/parse";
import {
  parseRecording,
  RECORDING_SCHEMA_ID,
  recordingJsonSchema,
  type RunRecording,
} from "../../scene/recording-schema";
import type { SceneDefinition } from "../../scene/types";
import type { FollowerSystem } from "../../systems/path-follower";
import type { RapierModule } from "../../types";
import { prepareRun, startRun } from "../play-loop";
import { runPlaytest } from "../playtest";
import type { InputScript, PlaytestReport } from "../playtest-types";
import { replayRecording, type ReplayReport } from "../recording";

const registry = createRegistry(testGame);
const text = readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8");
const yard: SceneDefinition = parseSceneOrThrow(text, registry);
const SCHEMA_FILE = new URL("../../scene/recording.schema.json", import.meta.url);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function played(script: InputScript): PlaytestReport<TestGameSnapshot> {
  const run = runPlaytest<TestGameSnapshot>({
    rapier,
    game: testGame,
    registry,
    scene: yard,
    script,
  });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run as PlaytestReport<TestGameSnapshot>;
}

function replayed(recording: unknown, scene = yard): ReplayReport<TestGameSnapshot> {
  const run = replayRecording<TestGameSnapshot>({
    rapier,
    game: testGame,
    registry,
    scene,
    recording,
  });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run;
}

const toGoal: InputScript = {
  v: 1,
  scene: "engine-yard",
  steps: [{ hold: ["right"], until: { event: GOAL_EVENT }, max: 600 }],
};

const wander: InputScript = {
  v: 1,
  timeOffsetMs: 1500,
  steps: [
    { hold: ["right"], for: 40 },
    { press: "push" },
    { hold: ["left", "push"], for: 30 },
    { wait: 20 },
    { hold: ["right"], for: 90 },
  ],
};

describe("RunRecording", () => {
  it("a playtest carries one: the action table, every edge, the trail and the end digest", () => {
    const r = played(toGoal);
    const rec = r.recording;
    expect(rec).toMatchObject({
      v: 1,
      scene: "engine-yard",
      sceneHash: r.sceneHash,
      configHash: r.configHash,
      game: "test-game",
      tickRate: 60,
      actions: ["right"],
      ticks: r.ticks,
      outcome: { result: "won", entityId: "zone" },
    });
    expect(rec.inputs).toEqual(r.inputs.map(([t, a, p]) => [t, rec.actions.indexOf(a), p]));
    expect(rec.trail!.pts).toEqual(r.trail.pts);
    expect(rec.markers.some((m) => m.type === GOAL_EVENT)).toBe(true);
    expect(parseRecording(JSON.parse(JSON.stringify(rec)))).toEqual({ ok: true, recording: rec });
  });

  it("replays twice to the same end state as the run it recorded", () => {
    for (const script of [toGoal, wander]) {
      const rec = played(script).recording;
      const a = replayed(rec);
      const b = replayed(JSON.stringify(rec));
      expect(a.matches, a.divergence ?? "").toBe(true);
      expect(a.warnings).toEqual([]);
      expect(a.stale).toBe(false);
      expect(a.recording).toEqual(rec);
      expect(b.recording).toEqual(rec);
      expect(b.final).toEqual(a.final);
    }
  });

  it("replays a recording made in a project that sets engine.tickRate without a tuning warning", () => {
    const project: ProjectRuntimeView = {
      settings: {},
      engine: { tickRate: 30 },
      table: () => [],
      asset: () => undefined,
    };
    const run = runPlaytest<TestGameSnapshot>({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      script: wander,
      project,
    });
    if (run.blocked) throw new Error("blocked");
    const rec = run.recording;
    expect(rec.tickRate).toBe(30);
    expect(rec.configHash).toBe(run.configHash);

    const here = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      recording: rec,
      project,
    });
    if (here.blocked) throw new Error("replay blocked");
    expect(here.warnings).toEqual([]);
    expect(here.matches, here.divergence ?? "").toBe(true);

    const elsewhere = replayed(rec);
    expect(elsewhere.warnings).toEqual(["recorded at 30 ticks a second, replayed at 60"]);
  });

  it("warns that a recording of a changed scene is stale, and says how it diverged", () => {
    const rec = played(toGoal).recording;
    const moved = structuredClone(yard);
    const zone = moved.entities!.find((e) => e.id === "zone")!;
    zone.shape = ["box", 1300, 930, 40, 30];
    const r = replayed(rec, moved);
    expect(r.stale).toBe(true);
    expect(r.warnings[0]).toMatch(/^stale: the scene changed/);
    expect(r.matches).toBe(false);
    expect(r.divergence).toMatch(/ended as timeout, not won/);
  });

  it("replays a recording of a v2 scene stale once, since the migrated scene hashes as v3", () => {
    const v2Text = text.replace(/"v": \d+/, '"v": 2');
    expect(parseSceneOrThrow(v2Text, registry)).toEqual(yard);
    const rec = played(toGoal).recording;
    const old: RunRecording = {
      ...rec,
      sceneHash: hashText(formatScene({ ...yard, v: 2 } as SceneDefinition).text),
    };
    const r = replayed(old);
    expect(r.stale).toBe(true);
    expect(r.warnings).toEqual([expect.stringMatching(/^stale: the scene changed/)]);
    expect(r.matches, r.divergence ?? "").toBe(true);
    expect(r.recording.sceneHash).toBe(rec.sceneHash);
    const again = replayed(r.recording);
    expect(again.stale).toBe(false);
    expect(again.warnings).toEqual([]);
  });

  it("refuses a recording that doesn't parse or names an action the game lacks", () => {
    const rec = played(toGoal).recording;
    const bad = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      recording: { ...rec, v: 2 },
    });
    expect(bad).toMatchObject({ blocked: true, stage: "script" });
    const renamed: RunRecording = { ...rec, actions: ["rigth"] };
    const run = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      recording: renamed,
    });
    expect(run.blocked && run.scriptIssues[0]).toMatchObject({
      path: "/actions/0",
      message: expect.stringContaining('unknown action "rigth"'),
    });
    expect(parseRecording({ ...rec, inputs: [[0, 5, 1]] })).toMatchObject({
      ok: false,
      issues: [{ path: "/inputs/0/1" }],
    });
  });
});

describe("commands in recordings", () => {
  const nudged: InputScript = {
    v: 1,
    steps: [
      { hold: ["right"], for: 10 },
      { command: NUDGE, args: { dx: 40 } },
      { hold: [], for: 5 },
      { command: NUDGE, args: { dx: -15 } },
      { command: NUDGE, args: { dx: 5 } },
      { wait: 10 },
    ],
  };

  it("a playtest with command steps records them, and its recording replays to the same digest", () => {
    const r = played(nudged);
    const expected = [
      [10, NUDGE, { dx: 40 }],
      [16, NUDGE, { dx: -15 }],
      [17, NUDGE, { dx: 5 }],
    ];
    expect(r.commands).toEqual(expected);
    expect(r.recording.commands).toEqual(expected);
    expect(Object.keys(r.recording).indexOf("commands")).toBe(
      Object.keys(r.recording).indexOf("inputs") + 1,
    );
    const plain = played({
      ...nudged,
      steps: nudged.steps.map((s) => ("command" in s ? { wait: 1 } : s)),
    });
    expect(plain.recording.end).not.toBe(r.recording.end);

    const text = JSON.parse(JSON.stringify(r.recording));
    expect(parseRecording(text)).toEqual({ ok: true, recording: r.recording });
    const again = replayed(text);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording).toEqual(r.recording);
    expect(again.final).toEqual(r.final);
  });

  it("leaves `commands` out of a run that sent none, so older recordings stay as they were", () => {
    const rec = played(toGoal).recording;
    expect(rec).not.toHaveProperty("commands");
    expect(played(toGoal).commands).toEqual([]);
  });

  it("parses a recording made before commands existed", () => {
    const frozen = readFileSync(
      new URL("../../project/__tests__/fixtures/run.recording.json", import.meta.url),
      "utf8",
    );
    const parsed = parseRecording(frozen);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.recording).not.toHaveProperty("commands");
  });

  it("refuses commands out of order, unknown commands and bad args", () => {
    const rec = played(nudged).recording;
    expect(
      parseRecording({
        ...rec,
        commands: [
          [5, NUDGE, { dx: 1 }],
          [4, NUDGE, { dx: 1 }],
        ],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "/commands/1/0" }] });
    const replay = (commands: unknown) =>
      replayRecording({
        rapier,
        game: testGame,
        registry,
        scene: yard,
        recording: { ...rec, commands },
      });
    const unknown = replay([[10, "nudg", { dx: 1 }]]);
    expect(unknown.blocked && unknown.scriptIssues).toEqual([
      {
        path: "/commands/0/1",
        message: 'unknown command "nudg"; did you mean "nudge"? (commands: @elapsed, nudge)',
      },
    ]);
    const bad = replay([[10, NUDGE, { dx: "far" }]]);
    expect(bad.blocked && bad.scriptIssues[0]).toMatchObject({
      path: "/commands/0/2",
      message: expect.stringMatching(/^bad args for nudge/),
    });
  });

  it("a browser session records the commands it stepped, and a replay feeds its own instead", () => {
    const rec = played(nudged).recording;
    const opts = {
      rapier,
      game: testGame,
      scene: "engine-yard",
      sceneHash: rec.sceneHash,
      start: {},
    };
    const live = createSessionRecording(opts);
    const queued = [{ name: NUDGE, args: { dx: 3 } }];
    expect(live.commands(0, queued)).toBe(queued);
    live.stepped({ tick: 0, game: null, events: [] }, [], null, queued);
    expect(live.stop()!.commands).toEqual([[0, NUDGE, { dx: 3 }]]);

    const replay = createSessionRecording({ ...opts, replay: rec });
    expect(replay.commands(10, queued)).toEqual([{ name: NUDGE, args: { dx: 40 } }]);
    expect(replay.commands(11, queued)).toEqual([]);
    expect(replay.commands(17, [])).toEqual([{ name: NUDGE, args: { dx: 5 } }]);
  });

  it("replays a turns game's recording tick for tick, though its idle slots simulated nothing", () => {
    const turns = { ...testGame, time: { kind: "turns" as const } };
    const turnsRegistry = createRegistry(turns);
    const run = runPlaytest<TestGameSnapshot>({
      rapier,
      game: turns,
      registry: turnsRegistry,
      scene: yard,
      script: nudged,
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.ticks).toBe(3);
    expect(run.slots).toBe(28);
    expect(run.commands).toEqual([
      [0, NUDGE, { dx: 40 }],
      [1, NUDGE, { dx: -15 }],
      [2, NUDGE, { dx: 5 }],
    ]);
    const again = replayRecording<TestGameSnapshot>({
      rapier,
      game: turns,
      registry: turnsRegistry,
      scene: yard,
      recording: run.recording,
    });
    if (again.blocked) throw new Error(JSON.stringify(again));
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording).toEqual(run.recording);
  });
});

describe("timeOffsetMs", () => {
  const liftAt = (timeOffsetMs?: number) => {
    const prepared = prepareRun(yard, registry);
    if (!prepared.ok) throw new Error("blocked");
    const started = startRun({
      rapier,
      game: testGame,
      registry,
      scene: prepared.scene,
      play: timeOffsetMs === undefined ? {} : { timeOffsetMs },
    });
    if (!started.ok) throw new Error(JSON.stringify(started.load));
    const followers = started.runtime.ctx.system<FollowerSystem>("follower")!;
    const at = followers.position("lift");
    return { at, runtime: started.runtime, followers };
  };

  it("starts followers where stepping that long would have put them", () => {
    const stepped = liftAt();
    for (let i = 0; i < 90; i++) stepped.runtime.step(1000 / 60, []);
    const expected = stepped.followers.position("lift");
    stepped.runtime.destroy();
    const seeked = liftAt(1500);
    expect(seeked.at).toEqual(expected);
    expect(seeked.followers.frameDelta("lift")).toEqual({ x: 0, y: 0 });
    seeked.runtime.destroy();
    expect(liftAt(0).at).toEqual({ x: 1700, y: 900 });
  });
});

describe("recording.schema.json", () => {
  it("matches recordingJsonSchema (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = recordingJsonSchema();
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCHEMA_FILE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA_FILE, "utf8"))).toEqual(fresh);
  });

  it("has its URN id and the agent surface version, and describes every property", () => {
    const schema = recordingJsonSchema();
    expect(schema.$id).toBe(RECORDING_SCHEMA_ID);
    expect(schema.$id).toBe("urn:jams-engine:recording:v1");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });
});
