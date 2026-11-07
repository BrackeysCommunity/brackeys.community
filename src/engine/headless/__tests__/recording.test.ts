// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { GOAL_EVENT, testGame, type TestGameSnapshot } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
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
