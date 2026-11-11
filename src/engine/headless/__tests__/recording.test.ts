// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import {
  CARD_TABLE,
  GOAL_EVENT,
  NUDGE,
  testGame,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { isRuntimeId } from "../../game/runtime-ids";
import type { GameDefinition, Registry } from "../../game/types";
import type { PointerState } from "../../input/state";
import type { TickInput } from "../../input/stream";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { createSessionRecording } from "../../runtime/play-session";
import { createRunRecorder, REPLAY_ACROSS_PLATFORMS } from "../../runtime/recorder";
import { defaultSeed } from "../../runtime/seed";
import { ENTITY_DESTROYED, ENTITY_SPAWNED } from "../../runtime/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { parseSceneOrThrow } from "../../scene/parse";
import { prefabLibrary } from "../../scene/prefab";
import {
  parseRecording,
  RECORDING_SCHEMA_ID,
  recordingJsonSchema,
  type RunRecording,
} from "../../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import type { FollowerSystem } from "../../systems/path-follower";
import type { InputAction, RapierModule } from "../../types";
import { prepareRun, runLoop, startRun } from "../play-loop";
import { runPlaytest } from "../playtest";
import type { InputScript, PlaytestReport } from "../playtest-types";
import {
  platformIssues,
  replayRecording,
  type ReplayOptions,
  type ReplayReport,
} from "../recording";
import { V1_FIXTURES } from "./fixtures/recordings/v1";
import { readV1Recording, v1Run } from "./fixtures/recordings/v1/runs";

const registry = createRegistry(testGame);
const text = readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8");
const yard: SceneDefinition = parseSceneOrThrow(text, registry);
const SCHEMA_FILE = new URL("../../scene/recording.schema.json", import.meta.url);
const V1_TIMEOUT_MS = 120_000;

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function played(
  script: InputScript,
  extra: Pick<
    Parameters<typeof runPlaytest>[0],
    "project" | "library" | "platform" | "projectRef"
  > = {},
): PlaytestReport<TestGameSnapshot> {
  const run = runPlaytest<TestGameSnapshot>({
    rapier,
    game: testGame,
    registry,
    scene: yard,
    script,
    ...extra,
  });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run as PlaytestReport<TestGameSnapshot>;
}

function replayed(
  recording: unknown,
  scene = yard,
  extra: Pick<ReplayOptions, "project" | "library" | "platform" | "projectRef"> = {},
): ReplayReport<TestGameSnapshot> {
  const run = replayRecording<TestGameSnapshot>({
    rapier,
    game: testGame,
    registry,
    scene,
    recording,
    ...extra,
  });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run;
}

const view = (rows: Record<string, unknown>[] = [], settings = {}): ProjectRuntimeView => ({
  settings,
  engine: {},
  table: (name) => (name === CARD_TABLE ? (rows as never) : []),
  asset: () => undefined,
  inputMap: null,
});

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
  it("a playtest carries a v2 one: seat 0's stream, the clock, every seed and the platform", () => {
    const r = played(toGoal);
    const rec = r.recording;
    expect(rec).toMatchObject({
      v: 2,
      engine: { physics: expect.stringMatching(/^rapier/) },
      platform: {
        arch: process.arch,
        runtime: expect.stringMatching(/^(node|bun|deno) /),
        flavour: null,
      },
      scene: "engine-yard",
      sceneHash: r.sceneHash,
      runHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      project: null,
      configHash: r.configHash,
      game: "test-game",
      time: { kind: "fixed", rate: 60 },
      seed: defaultSeed("test-game", "engine-yard"),
      players: [{ index: 0, devices: ["keyboard", "pointer", "touch"] }],
      actions: ["right"],
      commands: [],
      system: [],
      ticks: r.ticks,
      outcome: { result: "won", entityId: "zone" },
    });
    expect(rec.inputs).toEqual([r.inputs.map(([t, a, p]) => [t, "b", rec.actions.indexOf(a), p])]);
    expect(r.stream).toEqual({
      actions: rec.actions,
      commands: rec.commands,
      inputs: rec.inputs,
      system: rec.system,
    });
    expect(rec.trail!.pts).toEqual(r.trail.pts);
    expect(rec.markers.some((m) => m.type === GOAL_EVENT)).toBe(true);
    expect(parseRecording(JSON.parse(JSON.stringify(rec)))).toEqual({ ok: true, recording: rec });
  });

  it("names the host's flavour and project, which a replay carries on", () => {
    const host = {
      platform: { flavour: "rapier2d" },
      projectRef: { id: "yard", snapshot: "9f".repeat(32) },
    };
    const rec = played(toGoal, host).recording;
    expect(rec.platform.flavour).toBe("rapier2d");
    expect(rec.project).toEqual(host.projectRef);
    const again = replayed(rec, yard, host);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording).toEqual(rec);
    expect(replayed(rec).recording.project).toBeNull();
  });

  it("replays twice to the same end state as the run it recorded", () => {
    for (const script of [toGoal, wander]) {
      const rec = played(script).recording;
      const a = replayed(rec);
      const b = replayed(JSON.stringify(rec));
      expect(a.matches, a.divergence ?? "").toBe(true);
      expect(a.warnings).toEqual([]);
      expect(a.issues).toEqual([]);
      expect(a.stale).toBe(false);
      expect(a).not.toHaveProperty("migratedFrom");
      expect(a.recording).toEqual(rec);
      expect(b.recording).toEqual(rec);
      expect(b.final).toEqual(a.final);
    }
  });

  it("replays a recording made in a project that sets engine.tickRate without a tuning warning", () => {
    const project: ProjectRuntimeView = { ...view(), engine: { tickRate: 30 } };
    const run = played(wander, { project });
    const rec = run.recording;
    expect(rec.time).toEqual({ kind: "fixed", rate: 30 });
    expect(rec.configHash).toBe(run.configHash);

    const here = replayed(rec, yard, { project });
    expect(here.warnings).toEqual([]);
    expect(here.matches, here.divergence ?? "").toBe(true);

    const elsewhere = replayed(rec);
    expect(elsewhere.stale).toBe(true);
    expect(elsewhere.warnings).toEqual([
      expect.stringMatching(/^stale: what the run runs changed/),
      "recorded at 30 ticks a second, replayed at 60",
    ]);
  });

  it("refuses a recording that doesn't parse or names an action the game lacks", () => {
    const rec = played(toGoal).recording;
    expect(
      replayRecording({
        rapier,
        game: testGame,
        registry,
        scene: yard,
        recording: { ...rec, v: 3 },
      }),
    ).toMatchObject({ blocked: true, stage: "script" });
    const run = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      recording: { ...rec, actions: ["rigth"] },
    });
    expect(run.blocked && run.scriptIssues[0]).toMatchObject({
      path: "/actions/0",
      message: expect.stringContaining('unknown action "rigth"'),
    });
  });
});

describe("staleness by runHash", () => {
  it("goes stale when the scene changes, and says how the replay diverged", () => {
    const rec = played(toGoal).recording;
    const moved = structuredClone(yard);
    const zone = moved.entities!.find((e) => e.id === "zone")!;
    zone.shape = ["box", 13, 9.3, 0.4, 0.3];
    const r = replayed(rec, moved);
    expect(r.stale).toBe(true);
    expect(r.warnings[0]).toMatch(/^stale: what the run runs changed since it was recorded/);
    expect(r.matches).toBe(false);
    expect(r.divergence).toMatch(/ended as timeout, not won/);
  });

  it("stays fresh through a re-format that leaves the expanded scene equal", () => {
    const rec = played(toGoal).recording;
    // Settings written out at their defaults: other file text, the same run.
    const spelled: SceneDefinition = {
      ...yard,
      settings: { ...yard.settings, physics: "rapier", view: { projection: "orthogonal" } },
    };
    const r = replayed(rec, spelled);
    expect(r.recording.sceneHash).not.toBe(rec.sceneHash);
    expect(r.recording.runHash).toBe(rec.runHash);
    expect(r.stale).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.matches, r.divergence ?? "").toBe(true);

    // The frozen v3 (px) file of the same yard migrates to the same run.
    const v3Text = readFileSync(
      new URL("../../scene/__tests__/fixtures/v3/engine-yard.json", import.meta.url),
      "utf8",
    );
    const v3 = replayed(rec, parseSceneOrThrow(v3Text, registry));
    expect(v3.stale).toBe(false);
    expect(v3.matches, v3.divergence ?? "").toBe(true);
  });

  it("goes stale when a data table the game declares changes, though the scene didn't", () => {
    const cards = [{ id: "ace", cost: 1, damage: 3 }];
    const rec = played(toGoal, { project: view(cards) }).recording;
    expect(replayed(rec, yard, { project: view(cards) }).stale).toBe(false);
    const changed = replayed(rec, yard, { project: view([{ ...cards[0], damage: 4 }]) });
    expect(changed.stale).toBe(true);
    expect(changed.recording.sceneHash).toBe(rec.sceneHash);
    expect(changed.matches).toBe(true);
    expect(replayed(rec, yard, { project: view(cards, { title: "renamed" }) }).stale).toBe(true);
  });

  it("goes stale when a prefab only ctx.instantiate places changes", () => {
    const prefab = (x: number): Prefab => ({
      v: SCENE_FORMAT_VERSION,
      kind: "prefab",
      id: "beacon",
      entities: [{ id: "post", type: "marker", at: [x, 0] }],
    });
    const rec = played(toGoal, { library: prefabLibrary([prefab(0)]) }).recording;
    expect(replayed(rec, yard, { library: prefabLibrary([prefab(0)]) }).stale).toBe(false);
    expect(replayed(rec, yard, { library: prefabLibrary([prefab(1)]) }).stale).toBe(true);
  });
});

describe("recordings from another platform", () => {
  const rec = { engine: { version: "0.11.0", physics: "rapier 0.19.3" }, platform: {} } as const;
  const on = (arch: string, physics: string | null = rec.engine.physics) => ({
    engine: { ...rec.engine, physics },
    platform: { arch, runtime: "node 24.11.0", flavour: null },
  });

  it("replays across platforms without a warning while Rapier steps the same on them", () => {
    expect(REPLAY_ACROSS_PLATFORMS).toBe(true);
    expect(platformIssues(on("x64"), { arch: "arm64" })).toEqual([]);
  });

  it("warns recording-other-platform for a Rapier run from another known arch when it doesn't", () => {
    expect(platformIssues(on("x64"), { arch: "arm64" }, false)).toEqual([
      expect.objectContaining({
        code: "recording-other-platform",
        severity: "warn",
        message: expect.stringContaining("recorded on x64"),
      }),
    ]);
    expect(platformIssues(on("arm64"), { arch: "arm64" }, false)).toEqual([]);
    expect(platformIssues(on("unknown"), { arch: "arm64" }, false)).toEqual([]);
    expect(platformIssues(on("x64"), { arch: "unknown" }, false)).toEqual([]);
    expect(platformIssues(on("x64", null), { arch: "arm64" }, false)).toEqual([]);
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

  it("records a playtest's commands as seat 0's c events, and replays them to the same digest", () => {
    const r = played(nudged);
    const expected = [
      [10, NUDGE, { dx: 40 }],
      [16, NUDGE, { dx: -15 }],
      [17, NUDGE, { dx: 5 }],
    ];
    expect(r.commands).toEqual(expected);
    expect(r.recording.commands).toEqual([NUDGE]);
    expect(r.recording.inputs[0]!.filter((e) => e[1] === "c")).toEqual(
      expected.map(([t, , args]) => [t, "c", 0, args]),
    );
    const plain = played({
      ...nudged,
      steps: nudged.steps.map((s) => ("command" in s ? { wait: 1 } : s)),
    });
    expect(plain.recording.end).not.toBe(r.recording.end);
    expect(plain.recording.commands).toEqual([]);

    const text = JSON.parse(JSON.stringify(r.recording));
    expect(parseRecording(text)).toEqual({ ok: true, recording: r.recording });
    const again = replayed(text);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording).toEqual(r.recording);
    expect(again.final).toEqual(r.final);
  });

  it("migrates the frozen v1 recording made before commands existed", () => {
    const frozen = readFileSync(
      new URL("../../project/__tests__/fixtures/run.recording.json", import.meta.url),
      "utf8",
    );
    const parsed = parseRecording(frozen, registry);
    expect(parsed).toMatchObject({ ok: true, migratedFrom: 1, recording: { v: 2, commands: [] } });
  });

  it("refuses unknown commands and bad args where their events sit", () => {
    const rec = played(nudged).recording;
    const at = rec.inputs[0]!.findIndex((e) => e[1] === "c");
    const replay = (recording: RunRecording) =>
      replayRecording({ rapier, game: testGame, registry, scene: yard, recording });
    const unknown = replay({ ...rec, commands: ["nudg"] });
    expect(unknown.blocked && unknown.scriptIssues[0]).toEqual({
      path: `/inputs/0/${at}/2`,
      message: 'unknown command "nudg"; did you mean "nudge"? (commands: @elapsed, nudge)',
    });
    const inputs = structuredClone(rec.inputs);
    inputs[0]![at] = [inputs[0]![at]![0], "c", 0, { dx: "far" }];
    const bad = replay({ ...rec, inputs });
    expect(bad.blocked && bad.scriptIssues[0]).toMatchObject({
      path: `/inputs/0/${at}/3`,
      message: expect.stringMatching(/^bad args for nudge/),
    });
  });

  it("puts @elapsed on the system stream and replays it first in its tick", () => {
    const catchUp: GameDefinition = {
      ...testGame,
      time: { kind: "fixed", catchUp: { maxMs: 10_000 } },
    };
    const catchUpRegistry = createRegistry(catchUp);
    const run = runPlaytest({
      rapier,
      game: catchUp,
      registry: catchUpRegistry,
      scene: yard,
      script: { v: 1, steps: [{ hold: ["right"], for: 4 }, { elapse: 500 }, { wait: 3 }] },
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    expect(run.recording.system).toEqual([[4, "w", 500]]);
    expect(run.recording.commands).toEqual([]);
    const again = replayRecording({
      rapier,
      game: catchUp,
      registry: catchUpRegistry,
      scene: yard,
      recording: run.recording,
    });
    if (again.blocked) throw new Error(JSON.stringify(again));
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording).toEqual(run.recording);
  });

  it("a browser session records the input it stepped, and a replay feeds the recorded input instead", () => {
    const rec = played(nudged).recording;
    const opts = {
      rapier,
      game: testGame,
      scene: "engine-yard",
      sceneHash: rec.sceneHash,
      runHash: rec.runHash,
      start: {},
      world: { exists: () => false, count: () => 0 },
    };
    const live = createSessionRecording(opts);
    const tick0: TickInput = {
      tick: 0,
      actions: [],
      commands: [{ name: NUDGE, args: { dx: 3 } }],
      pointers: [{ x: 1.25, y: 2, buttons: 1, over: true }],
      joins: [],
    };
    expect(live.input(0, tick0)).toBe(tick0);
    live.stepped({ tick: 0, game: null, events: [] }, tick0, null);
    const done = live.stop()!;
    expect(done.commands).toEqual([NUDGE]);
    expect(done.inputs).toEqual([
      [
        [0, "p", 12_500, 20_000, 1, 1],
        [0, "c", 0, { dx: 3 }],
      ],
    ]);

    const replay = createSessionRecording({ ...opts, replay: rec });
    expect(replay.input(10, tick0).commands).toEqual([{ name: NUDGE, args: { dx: 40 } }]);
    expect(replay.input(12, tick0)).toEqual({
      tick: 12,
      actions: [],
      commands: [],
      pointers: [],
      joins: [],
    });
    expect(replay.input(0, tick0).actions).toEqual([
      { action: "right", pressed: true, tick: 0, timestamp: 0 },
    ]);
    expect(replay.input(17, tick0).commands).toEqual([{ name: NUDGE, args: { dx: 5 } }]);
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
    expect(run.recording.time).toEqual({ kind: "turns", rate: 60 });
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

// ─── Every event kind, two seats ─────────────────────────

type ArenaSnapshot = { log: string[] };

/**
 * A physics-free game of two host-seated players with a button, an axis, a
 * vector, the pointer and a command; its snapshot logs what each tick gave
 * the game and what `ctx.input` read, so a replay's digest covers it all.
 */
function arenaGame(subTick = false): GameDefinition<ArenaSnapshot> {
  return defineGame<ArenaSnapshot>({
    id: "arena",
    types: [],
    world: { physics: "none" },
    time: { kind: "fixed", catchUp: { maxMs: 10_000 } },
    input: { players: { max: 2, join: "host" }, subTick },
    actions: [
      { action: "fire", bindings: [{ device: "key", code: "Space" }], description: "Fire." },
      {
        action: "throttle",
        kind: "axis",
        bindings: [{ device: "pad", axis: "rt" }],
        description: "Throttle.",
      },
      {
        action: "move",
        kind: "vector",
        bindings: [{ device: "pad", stick: "left" }],
        description: "Move.",
      },
    ],
    commands: {
      ping: { description: "A ping.", args: z.strictObject({ n: z.number().int() }) },
    },
    createRuntime(ctx) {
      const log: string[] = [];
      const seat = (p: number) => {
        const v = ctx.input.vector("move", p);
        const ptr = ctx.input.pointer(p);
        const at = ptr ? `${ptr.x},${ptr.y},${ptr.buttons},${ptr.over ? 1 : 0}` : "-";
        return `${p}:${ctx.input.held("fire", p) ? 1 : 0},${ctx.input.value("throttle", p)},${v.x},${v.y},${at}`;
      };
      return {
        beforeStep(_dtMs, actions, commands) {
          const acted = actions.map((a) => `${a.player ?? 0}${a.action}@${a.offset ?? "-"}`);
          const sent = commands.map((c) => `${c.player ?? 0}${c.name}${JSON.stringify(c.args)}`);
          const seats = ctx.input
            .players()
            .map((p) => p.devices.join("+"))
            .join("/");
          log.push(`${acted.join(" ")}|${sent.join(" ")}|${seat(0)};${seat(1)}|${seats}`);
        },
        snapshot: () => ({ log: [...log] }),
      };
    },
  });
}

const arenaScene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "arena",
  game: "arena",
  bounds: [0, 0, 20, 20],
  entities: [],
};

const pointer = (x: number, y: number, buttons = 0): PointerState => ({
  x,
  y,
  buttons,
  over: true,
});
const act = (action: string, extra: Partial<InputAction> = {}): InputAction => ({
  action,
  pressed: true,
  tick: 0,
  timestamp: 0,
  ...extra,
});

/** A session of both seats: sticks, the pointer pressed and moved, a command, a join and a leave. */
const SESSION: Record<number, Partial<TickInput>> = {
  0: {
    joins: [
      { player: 0, device: "keyboard", joined: true },
      { player: 1, device: "pad:0", joined: true },
    ],
    pointers: [pointer(1.5, 2.25)],
  },
  1: { actions: [act("move", { x: 0.707, y: -0.707, player: 1 }), act("fire")] },
  2: { actions: [act("throttle", { value: 0.5 })], pointers: [pointer(1.5, 2.25, 1)] },
  3: { pointers: [pointer(1.5, 2.25, 1)] },
  4: {
    pointers: [pointer(3.1234, 4)],
    commands: [
      { name: "ping", args: { n: 2 }, player: 1 },
      { name: "@elapsed", args: { ms: 250 } },
    ],
  },
  5: {
    actions: [
      act("fire", { pressed: false }),
      act("move", { pressed: false, x: 0, y: 0, player: 1 }),
      act("throttle", { pressed: false, value: 0 }),
    ],
  },
  6: { joins: [{ player: 1, device: "pad:0", joined: false }] },
};

/** Records `session` headless from TickInputs, the way a live run feeds them. */
function recordSession(
  game: GameDefinition,
  session: Record<number, Partial<TickInput>>,
  ticks = 10,
): { recording: RunRecording; registry: Registry } {
  const reg = createRegistry(game);
  const prepared = prepareRun(arenaScene, reg);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.blocked));
  const started = startRun({ game, registry: reg, scene: prepared.scene, play: {} });
  if (!started.ok) throw new Error(JSON.stringify(started.load));
  const { runtime } = started;
  try {
    const recorder = createRunRecorder({
      rapier: null,
      game,
      scene: arenaScene.name,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: {},
      time: runtime.ctx.time,
      players: runtime.ctx.input.players(),
    });
    const end = runLoop({
      runtime,
      game,
      maxTicks: ticks,
      input: {
        done: () => false,
        tick: (slot) => ({
          tick: slot,
          actions: [],
          commands: [],
          pointers: [],
          joins: [],
          ...structuredClone(session[slot] ?? {}),
        }),
      },
      onTick: (state, focus, _edges, _commands, input) => recorder.tick(state, input, focus),
    });
    return { recording: recorder.finish(end, runtime.snapshot()), registry: reg };
  } finally {
    runtime.destroy();
  }
}

function replayArena(game: GameDefinition, reg: Registry, recording: unknown) {
  const run = replayRecording<ArenaSnapshot>({
    game: game as GameDefinition<ArenaSnapshot>,
    registry: reg,
    scene: arenaScene,
    recording,
  });
  if (run.blocked) throw new Error(JSON.stringify(run));
  return run;
}

describe("the input stream, every event kind", () => {
  const game = arenaGame();
  const { recording: rec, registry: reg } = recordSession(game, SESSION);

  it("writes each seat's stream and the system stream as tuples", () => {
    expect(rec.actions).toEqual(["fire", "move", "throttle"]);
    expect(rec.commands).toEqual(["ping"]);
    expect(rec.inputs).toEqual([
      [
        [0, "p", 15_000, 22_500, 0, 1],
        [1, "b", 0, 1],
        [2, "a", 2, 500],
        [2, "p", 15_000, 22_500, 1, 1],
        [4, "p", 31_234, 40_000, 0, 1],
        [5, "b", 0, 0],
        [5, "a", 2, 0],
      ],
      [
        [1, "v", 1, 707, -707],
        [4, "c", 0, { n: 2 }],
        [5, "v", 1, 0, 0],
      ],
    ]);
    expect(rec.system).toEqual([
      [0, "j", 0, "keyboard"],
      [0, "j", 1, "pad:0"],
      [4, "w", 250],
      [6, "l", 1, "pad:0"],
    ]);
    expect(rec.players).toEqual([
      { index: 0, devices: ["keyboard"] },
      { index: 1, devices: ["pad:0"] },
    ]);
    expect(rec.engine.physics).toBeNull();
    expect(rec.platform.flavour).toBeNull();
  });

  it("writes a pointer sample only when it changed", () => {
    const samples = rec.inputs[0]!.filter((e) => e[1] === "p").map((e) => e[0]);
    expect(samples).toEqual([0, 2, 4]);
  });

  it("merges a tick system first, then seats in order, live and in replay alike", () => {
    const log = replayArena(game, reg, rec).final!.log;
    expect(log[1]).toMatch(/^0fire@- 1move@-\|/);
    expect(log[4]).toMatch(/^\|0@elapsed\{"ms":250\} 1ping\{"n":2\}\|/);
    expect(log[0]).toMatch(/keyboard\/pad:0$/);
    expect(log[6]).toMatch(/keyboard\/$/);
  });

  it("replays sticks, pointer clicks, a command and two seats headless to the same digest", () => {
    for (const recording of [rec, JSON.stringify(rec), JSON.parse(JSON.stringify(rec))]) {
      const again = replayArena(game, reg, recording);
      expect(again.matches, again.divergence ?? "").toBe(true);
      expect(again.stale).toBe(false);
      expect(again.recording).toEqual(rec);
    }
    const other = recordSession(game, { ...SESSION, 4: { ...SESSION[4], pointers: [] } });
    expect(other.recording.end).not.toBe(rec.end);
  });

  it("records sub-tick offsets as the tick's thousandths only when the game opts in", () => {
    const timed: Record<number, Partial<TickInput>> = {
      1: { actions: [act("fire", { offset: 0.375 })] },
      2: { actions: [act("fire", { pressed: false, offset: 0.9999 })] },
      3: { actions: [act("fire")] },
    };
    const sub = arenaGame(true);
    const withOffsets = recordSession(sub, timed, 5);
    expect(withOffsets.recording.inputs[0]).toEqual([
      [1.375, "b", 0, 1],
      [2.999, "b", 0, 0],
      [3, "b", 0, 1],
    ]);
    const again = replayArena(sub, withOffsets.registry, withOffsets.recording);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.final!.log.slice(1, 4).map((l) => l.split("|")[0])).toEqual([
      "0fire@0.375",
      "0fire@0.999",
      "0fire@0",
    ]);

    const plain = recordSession(game, timed, 5);
    expect(plain.recording.inputs[0]!.map((e) => e[0])).toEqual([1, 2, 3]);
    const replay = replayArena(game, plain.registry, plain.recording);
    expect(replay.matches, replay.divergence ?? "").toBe(true);
    expect(replay.final!.log[1]).toMatch(/^0fire@-\|/);
  });
});

describe("v1 recordings", () => {
  for (const fixture of V1_FIXTURES) {
    it(
      `${fixture.file} migrates, replays as it ran, and its re-recording is a fresh v2`,
      async () => {
        const run = await v1Run(fixture, rapier);
        const raw = readV1Recording(fixture);
        const parsed = parseRecording(raw, run.registry);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
        expect(parsed.migratedFrom).toBe(1);

        const replay = replayRecording({ ...run, recording: raw });
        if (replay.blocked) throw new Error(`blocked: ${JSON.stringify(replay)}`);
        expect(replay.migratedFrom).toBe(1);
        expect(replay.matches, replay.divergence ?? "").toBe(true);
        expect(replay.stale).toBe(false);
        expect(replay.recording.v).toBe(2);
        expect(replay.recording.end).toBe(parsed.recording.end);

        const again = replayRecording({ ...run, recording: replay.recording });
        if (again.blocked) throw new Error(`blocked: ${JSON.stringify(again)}`);
        expect(again).not.toHaveProperty("migratedFrom");
        expect(again.matches, again.divergence ?? "").toBe(true);
        expect(again.stale).toBe(false);
      },
      V1_TIMEOUT_MS,
    );
  }
});

describe("seeded runs", () => {
  type DrawSnapshot = TestGameSnapshot & { draw: number };
  /** The test game with one draw from `ctx.random` at load, kept in its snapshot. */
  const drawGame: GameDefinition = {
    ...testGame,
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      let draw = 0;
      return {
        ...base,
        onLoad(scene) {
          base.onLoad?.(scene);
          draw = ctx.random.nextU32();
        },
        snapshot() {
          const snap = base.snapshot?.();
          return snap ? { ...snap, draw } : null;
        },
      };
    },
  };
  const drawRegistry = createRegistry(drawGame);
  const script = (seed?: number | string): InputScript => ({
    v: 1,
    ...(seed === undefined ? {} : { seed }),
    steps: [{ hold: ["right"], for: 30 }],
  });
  const play = (s: InputScript) => {
    const run = runPlaytest({
      rapier,
      game: drawGame,
      registry: drawRegistry,
      scene: yard,
      script: s,
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    return run;
  };
  const drawOf = (run: { final: unknown }) => (run.final as DrawSnapshot).draw;
  const replay = (recording: unknown) => {
    const run = replayRecording({
      rapier,
      game: drawGame,
      registry: drawRegistry,
      scene: yard,
      recording,
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    return run;
  };

  it("records every seed: the script's, else the default for its game and scene", () => {
    for (const seed of [7, "seven"]) {
      const rec = play(script(seed)).recording;
      expect(rec.seed).toBe(seed);
      expect(rec.start).not.toHaveProperty("seed");
      const text = JSON.parse(JSON.stringify(rec));
      expect(parseRecording(text)).toEqual({ ok: true, recording: rec });
    }
    expect(play(script()).recording.seed).toBe(defaultSeed("test-game", "engine-yard"));
  });

  it("seeds ctx.random from the script, and two replays of a seeded run match it", () => {
    const seeded = play(script(7));
    const other = play(script(8));
    const unseeded = play(script());
    expect(drawOf(seeded)).not.toBe(drawOf(other));
    expect(drawOf(seeded)).not.toBe(drawOf(unseeded));
    expect(seeded.recording.end).not.toBe(other.recording.end);

    const a = replay(seeded.recording);
    const b = replay(JSON.stringify(seeded.recording));
    for (const r of [a, b]) {
      expect(r.matches, r.divergence ?? "").toBe(true);
      expect(r.recording).toEqual(seeded.recording);
      expect(drawOf(r)).toBe(drawOf(seeded));
    }
  });

  it("replays an unseeded run on the default seed it recorded", () => {
    const rec = play(script()).recording;
    const r = replay(rec);
    expect(r.matches, r.divergence ?? "").toBe(true);
    expect(drawOf(r)).toBe(drawOf(play(script())));
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
    expect(liftAt(0).at).toEqual({ x: 17, y: 9 });
  });
});

describe("markers in a spawning game", () => {
  const PER_TICK = 10;
  const TICKS = 100;
  /** The test game spawning ten markers a tick and destroying the last tick's. */
  const spawning = (markers?: readonly string[]): GameDefinition => ({
    ...testGame,
    play: { ...testGame.play, ...(markers ? { markers } : {}) },
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      let last: string[] = [];
      return {
        ...base,
        beforeStep(dtMs, actions, commands) {
          base.beforeStep?.(dtMs, actions, commands);
          for (const id of last) ctx.destroy(id);
          last = [];
          if (ctx.tick >= TICKS) return;
          for (let i = 0; i < PER_TICK; i++)
            last.push(ctx.spawn({ type: "plain", at: [100 + i * 10, 100] }).id);
        },
      };
    },
  });
  const play = (game: GameDefinition) => {
    const run = runPlaytest({
      rapier,
      game,
      registry: createRegistry(game),
      scene: yard,
      script: { v: 1, steps: [{ hold: ["right"], for: TICKS + 5 }] },
      maxEvents: 5000,
    });
    if (run.blocked) throw new Error(JSON.stringify(run));
    return run;
  };

  it("leaves a thousand spawns out of the markers, though the report lists them", () => {
    const run = play(spawning());
    const spawned = run.events.filter((e) => e.type === ENTITY_SPAWNED);
    expect(spawned).toHaveLength(PER_TICK * TICKS);
    expect(run.events.filter((e) => e.type === ENTITY_DESTROYED)).toHaveLength(PER_TICK * TICKS);
    expect(spawned.every((e) => isRuntimeId(e.entityId!))).toBe(true);
    expect(run.recording.markers.filter((m) => m.type.startsWith("entity:"))).toEqual([]);
    expect(run.recording.markers).toEqual(
      played({ v: 1, steps: [{ hold: ["right"], for: TICKS + 5 }] }).recording.markers,
    );
  });

  it("marks lifecycle events a game names in play.markers, and only those", () => {
    const run = play(spawning([ENTITY_SPAWNED]));
    expect(run.recording.markers).toHaveLength(PER_TICK * TICKS);
    expect(run.recording.markers.every((m) => m.type === ENTITY_SPAWNED)).toBe(true);
    expect(run.recording.markers[0]).toMatchObject({ tick: 0, entityId: "plain#1" });
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
    expect(schema.$id).toBe("urn:jams-engine:recording:v2");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });
});

describe("replayRecording when a step throws", () => {
  it("ends blocked at 'run' on an EngineError, its code in issues", () => {
    const rec = played(toGoal).recording;
    const boom: GameDefinition<TestGameSnapshot> = {
      ...testGame,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        let tick = 0;
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            base.beforeStep?.(dtMs, actions, commands);
            if (tick++ === 3) ctx.spawn({ type: "plain", id: "plain#7", at: [0, 0] });
          },
        };
      },
    };
    const run = replayRecording<TestGameSnapshot>({
      rapier,
      game: boom,
      registry: createRegistry(boom),
      scene: yard,
      recording: rec,
    });
    expect(run).toMatchObject({ blocked: true, stage: "run", scene: "engine-yard" });
    if (!run.blocked) throw new Error("expected a blocked replay");
    expect(run.issues.at(-1)).toMatchObject({ severity: "error", code: "spawn-id-invalid" });
  });
});
