import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import { defaultSeed } from "../../runtime/seed";
import { Rng } from "../../sim-kit/rng";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import { undescribedProperties } from "../json-schema";
import {
  migrateRecordingV1,
  parseRecording,
  RECORDING_SCHEMA_ID,
  RECORDING_VERSION,
  recordingJsonSchema,
  runRecordingSchema,
  runRecordingV1Schema,
  type RecordingCommand,
  type RunRecordingV1,
  type RunRecordingV2,
} from "../recording-schema";

const V1_DIR = new URL("../../headless/__tests__/fixtures/recordings/v1/", import.meta.url);
const v1Fixtures = readdirSync(V1_DIR)
  .filter((name) => name.endsWith(".recording.json"))
  .sort();
const readV1 = (name: string): RunRecordingV1 =>
  JSON.parse(readFileSync(new URL(name, V1_DIR), "utf8"));

/** §5's example, its pointer sample in metres × 10,000. */
const v2Example = (): RunRecordingV2 => ({
  $schema: "./recording.schema.json",
  v: 2,
  engine: { version: "0.11.0", physics: "rapier 0.19.3" },
  platform: { arch: "arm64", runtime: "node 24.11.0", flavour: "rapier2d-compat" },
  game: "tactics",
  scene: "level-1",
  sceneHash: "5f1c09a2b7e3d4c8",
  runHash: "a90e44d1c2b3f507",
  project: { id: "tactics", snapshot: "9f2c".padEnd(64, "0") },
  configHash: "1d2e3f4a5b6c7d8e",
  time: { kind: "turns", rate: 60 },
  seed: 1234567,
  start: { at: [1.2, 0.4] },
  players: [
    { index: 0, devices: ["keyboard", "pointer"] },
    { index: 1, devices: ["pad:0"] },
  ],
  actions: ["move", "fire"],
  commands: ["move-unit", "end-turn"],
  inputs: [
    [
      [0, "b", 1, 1],
      [3, "v", 0, 707, -707],
      [3.375, "a", 0, -250],
      [10, "p", 41250, 22000, 1, 1],
      [12, "c", 0, { unit: "u1", to: [3, 4] }],
      [13, "c", 1],
    ],
    [[5, "b", 1, 1]],
  ],
  system: [
    [0, "j", 1, "pad:0"],
    [600, "l", 1, "pad:0"],
    [900, "w", 3600000],
  ],
  ticks: 1200,
  outcome: { result: "won", tick: 1199, at: null },
  markers: [],
  trail: { every: 4, pts: [], truncated: false },
  end: "c0ffee1234567890",
});

/** A v1 file with every field v1 has, `@elapsed` both leading a tick and following a game command. */
const v1Full = (): RunRecordingV1 => ({
  $schema: "./recording.schema.json",
  v: 1,
  engine: { version: "0.10.0", physics: "rapier 0.19.3" },
  scene: "arena",
  sceneHash: "0011223344556677",
  game: "tactics",
  configHash: "8899aabbccddeeff",
  tickRate: 30,
  start: { at: [1.5, -2], timeOffsetMs: 250, game: { mode: "hard" }, seed: "daily-7" },
  actions: ["left", "jump"],
  inputs: [
    [0, 0, 1],
    [4, 1, 1],
    [4, 0, 0],
    [9, 1, 0],
  ],
  commands: [
    [0, "@elapsed", { ms: 5000 }],
    [4, "end-turn"],
    [4, "@elapsed", { ms: 20 }],
    [6, "move", { unit: "a", to: [1, 2] }],
    [6, "end-turn"],
    [8, "@elapsed", { ms: 7 }],
    [8, "@elapsed", { ms: 9 }],
  ],
  ticks: 12,
  outcome: { result: "timeout", tick: 11, at: [3, 4], cause: "out of time", entityId: "hero" },
  markers: [{ tick: 4, type: "touch", at: [1, 1], entityId: "hero", other: "coin" }],
  trail: {
    every: 4,
    pts: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    truncated: false,
  },
  end: "deadbeefdeadbeef",
});

/** Seat 0's events and the system stream read back into v1's edges and commands. */
function backToV1(rec: RunRecordingV2) {
  const seat = rec.inputs[0] ?? [];
  const inputs = seat.flatMap((e) => (e[1] === "b" ? [[e[0], e[2], e[3]] as const] : []));
  const byTick = new Map<number, RecordingCommand[]>();
  const push = (t: number, c: RecordingCommand) => byTick.set(t, [...(byTick.get(t) ?? []), c]);
  for (const e of rec.system) if (e[1] === "w") push(e[0], [e[0], "@elapsed", { ms: e[2] }]);
  for (const e of seat) {
    if (e[1] !== "c") continue;
    const name = rec.commands[e[2]]!;
    push(e[0], e.length > 3 ? [e[0], name, e[3]] : [e[0], name]);
  }
  const commands = [...byTick.keys()].sort((a, b) => a - b).flatMap((t) => byTick.get(t)!);
  return { inputs, commands };
}

const ok = (input: unknown, registry?: Parameters<typeof parseRecording>[1]) => {
  const parsed = parseRecording(input, registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed;
};

const issuesOf = (input: unknown) => {
  const parsed = parseRecording(input);
  if (parsed.ok) throw new Error("expected the recording to be refused");
  return parsed.issues;
};

describe("recording v2", () => {
  it("is format 2 under urn:jams-engine:recording:v2", () => {
    expect(RECORDING_VERSION).toBe(2);
    expect(RECORDING_SCHEMA_ID).toBe("urn:jams-engine:recording:v2");
  });

  it("parses §5's example as it is, with no migration", () => {
    const parsed = ok(v2Example());
    expect(parsed.migratedFrom).toBeUndefined();
    expect(parsed.recording).toEqual(v2Example());
    expect(ok(JSON.stringify(v2Example())).recording).toEqual(v2Example());
  });

  it("takes a run without physics, a project or a trail", () => {
    const rec = { ...v2Example(), engine: { version: "0.11.0", physics: null }, project: null };
    delete rec.trail;
    expect(ok(rec).recording).toEqual(rec);
  });

  it.each([
    ["a missing runHash", (r: any) => delete r.runHash, "/runHash"],
    ["a missing platform", (r: any) => delete r.platform, "/platform"],
    ["an unknown time kind", (r: any) => (r.time.kind = "realtime"), "/time/kind"],
    ["a fractional pointer coordinate", (r: any) => (r.inputs[0][3][2] = 41250.5), "/inputs/0/3"],
    ["an analog value past 1000", (r: any) => (r.inputs[0][2][3] = 1001), "/inputs/0/2/3"],
    ["an unknown device", (r: any) => (r.system[0][3] = "joystick"), "/system/0"],
    ["a negative pad", (r: any) => (r.players[1].devices = ["pad:-1"]), "/players/1/devices/0"],
    ["an unknown event kind", (r: any) => (r.inputs[1][0][1] = "x"), "/inputs/1/0"],
    ["v1's start.seed", (r: any) => (r.start.seed = 3), "/start"],
  ])("refuses %s, saying where", (_, change, path) => {
    const rec = v2Example();
    change(rec);
    expect(issuesOf(rec).map((i) => i.path)).toContain(path);
  });

  it("refuses an action or command index outside its table", () => {
    const action = v2Example();
    action.inputs[1]!.push([6, "b", 2, 0]);
    expect(issuesOf(action)).toEqual([
      { path: "/inputs/1/1/2", message: "action index 2 is outside `actions` (2 names)" },
    ]);
    const command = v2Example();
    command.inputs[0]!.push([20, "c", 2]);
    expect(issuesOf(command)).toEqual([
      { path: "/inputs/0/6/2", message: "command index 2 is outside `commands` (2 names)" },
    ]);
  });

  it("refuses a stream that isn't oldest first", () => {
    const seat = v2Example();
    seat.inputs[0]!.push([12.5, "b", 0, 0]);
    expect(issuesOf(seat)).toEqual([
      { path: "/inputs/0/6/0", message: "events are oldest first, but 12.5 follows 13" },
    ]);
    const system = v2Example();
    system.system.push([100, "w", 1]);
    expect(issuesOf(system)[0]!.path).toBe("/system/3/0");
  });

  it("refuses another format version, and text that isn't JSON", () => {
    expect(issuesOf({ ...v2Example(), v: 3 })).toEqual([
      { path: "/v", message: "the format version must be 1 or 2, got 3" },
    ]);
    expect(issuesOf({})[0]!.path).toBe("/v");
    expect(issuesOf("[1]")).toEqual([{ path: "", message: "a recording is a JSON object" }]);
    expect(issuesOf("{")[0]!.message).toMatch(/isn't valid JSON/);
  });

  describe("a live run's keys", () => {
    const SHA = "ab".repeat(32);
    const swap = {
      tick: 240,
      version: SHA,
      strategy: "reconcile" as const,
      timing: "now" as const,
      sceneHash: "5f1c09a2b7e3d4c9",
      runHash: "a90e44d1c2b3f508",
    };
    const live = (): RunRecordingV2 => ({
      ...v2Example(),
      sceneVersion: SHA,
      swaps: [
        { ...swap },
        { ...swap, tick: 600, version: null, strategy: "reload", timing: "boundary" },
      ],
    });

    it("takes sceneVersion and swaps together or alone, as they are", () => {
      expect(ok(live()).recording).toEqual(live());
      const { swaps: _, ...started } = live();
      expect(ok(started).recording).toEqual(started);
      const { sceneVersion: __, ...swapped } = live();
      expect(ok(swapped).recording).toEqual(swapped);
      expect(ok(v2Example()).recording).not.toHaveProperty("swaps");
    });

    it.each([
      [
        "a sceneVersion that isn't a SHA-256",
        (r: any) => (r.sceneVersion = "abc"),
        "/sceneVersion",
      ],
      [
        "a swap to a version that isn't one",
        (r: any) => (r.swaps[0].version = "abc"),
        "/swaps/0/version",
      ],
      ["an unknown strategy", (r: any) => (r.swaps[0].strategy = "patch"), "/swaps/0/strategy"],
      ["an unknown timing", (r: any) => (r.swaps[1].timing = "later"), "/swaps/1/timing"],
      ["a negative tick", (r: any) => (r.swaps[0].tick = -1), "/swaps/0/tick"],
      ["a swap without its runHash", (r: any) => delete r.swaps[0].runHash, "/swaps/0/runHash"],
      ["a key a swap doesn't have", (r: any) => (r.swaps[0].scene = "level-1"), "/swaps/0"],
      ["swaps out of tick order", (r: any) => (r.swaps[1].tick = 239), "/swaps/1/tick"],
      [
        "a swap later than right after the run's last tick",
        (r: any) => (r.swaps[1].tick = r.ticks + 1),
        "/swaps/1/tick",
      ],
      ["a swap past the run's end", (r: any) => (r.swaps[0].tick = r.ticks + 5), "/swaps/0/tick"],
    ])("refuses %s, saying where", (_, change, path) => {
      const rec = live();
      change(rec);
      expect(issuesOf(rec).map((i) => i.path)).toContain(path);
    });

    it("takes swaps sharing a tick, and one right after the last tick simulated", () => {
      const rec = live();
      rec.swaps![1]!.tick = 240;
      expect(ok(rec).recording.swaps).toHaveLength(2);
      rec.swaps![1]!.tick = rec.ticks - 1;
      expect(ok(rec).recording.swaps).toHaveLength(2);
      rec.swaps![1]!.tick = rec.ticks;
      expect(ok(rec).recording.swaps).toHaveLength(2);
      expect(issuesOf({ ...rec, ticks: 239 })[0]?.message).toBe(
        "a swap runs at most right after the run's last tick, but 240 is past `ticks` (239)",
      );
    });

    it("migrates a v1 file to neither key", () => {
      const parsed = ok(v1Full());
      expect(parsed.migratedFrom).toBe(1);
      expect(parsed.recording).not.toHaveProperty("sceneVersion");
      expect(parsed.recording).not.toHaveProperty("swaps");
      for (const name of v1Fixtures) {
        const fixture = ok(readV1(name)).recording;
        expect(fixture, name).not.toHaveProperty("sceneVersion");
        expect(fixture, name).not.toHaveProperty("swaps");
      }
    });

    it("describes both keys in the published schema", () => {
      const props = recordingJsonSchema().properties as Record<string, { description?: string }>;
      expect(props.sceneVersion?.description).toMatch(/live scene version/);
      expect(props.swaps?.description).toMatch(/swap/);
      expect(runRecordingSchema.safeParse(live()).success).toBe(true);
    });
  });

  it("publishes a described JSON Schema with the agent surface version", () => {
    const schema = recordingJsonSchema();
    expect(schema.$id).toBe(RECORDING_SCHEMA_ID);
    expect(schema.title).toBe("jams engine run recording, format v2");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    expect(runRecordingSchema.safeParse(v2Example()).success).toBe(true);
  });
});

describe("the v1 → v2 migration", () => {
  it("reports migratedFrom: 1", () => {
    expect(ok(v1Full()).migratedFrom).toBe(1);
  });

  it("carries the header across unchanged", () => {
    const v1 = v1Full();
    const v2 = ok(v1).recording;
    expect(v2.v).toBe(2);
    expect(v2.engine).toEqual(v1.engine);
    expect(v2.game).toBe(v1.game);
    expect(v2.scene).toBe(v1.scene);
    expect(v2.sceneHash).toBe(v1.sceneHash);
    expect(v2.configHash).toBe(v1.configHash);
    expect(v2.ticks).toBe(v1.ticks);
    expect(v2.end).toBe(v1.end);
    expect(v2.actions).toEqual(v1.actions);
    expect(v2).not.toHaveProperty("$schema");
  });

  it("moves v1's world px to metres at the default px per metre without a game", () => {
    const v2 = ok(v1Full()).recording;
    expect(v2.outcome).toEqual({ ...v1Full().outcome, at: [0.03, 0.04] });
    expect(v2.markers).toEqual([{ ...v1Full().markers[0]!, at: [0.01, 0.01] }]);
    expect(v2.trail).toEqual({
      ...v1Full().trail!,
      pts: [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ],
    });
  });

  it("scales by the game's px per metre, and its options and command args where their schemas hold lengths", () => {
    const game = defineGame({
      id: "tactics",
      types: [],
      actions: [{ action: "left", keys: ["a"], description: "Left." }],
      world: { lengthUnit: 50 },
      commands: {
        move: {
          description: "Move a unit.",
          args: z.strictObject({
            unit: z.string(),
            to: z.tuple([z.number(), z.number()]).meta({ unit: "m" }),
          }),
        },
        "end-turn": { description: "End the turn." },
      },
      play: {
        options: z.strictObject({ mode: z.string(), reach: z.number().meta({ unit: "m" }) }),
      },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const v1 = { ...v1Full(), start: { at: [100, 50], game: { mode: "hard", reach: 25 } } };
    const v2 = ok(v1, createRegistry(game)).recording;
    expect(v2.start).toEqual({ at: [2, 1], game: { mode: "hard", reach: 0.5 } });
    expect(v2.markers[0]!.at).toEqual([0.02, 0.02]);
    expect(v2.inputs[0]!.find((e) => e[1] === "c" && e[2] === 2)).toEqual([
      6,
      "c",
      2,
      { unit: "a", to: [0.02, 0.04] },
    ]);
  });

  it("writes physics `none` as null", () => {
    const v1 = { ...v1Full(), engine: { version: "0.10.0", physics: "none" } };
    expect(ok(v1).recording.engine).toEqual({ version: "0.10.0", physics: null });
  });

  it("moves start.seed to seed and keeps the rest of the start", () => {
    const v2 = ok(v1Full()).recording;
    expect(v2.seed).toBe("daily-7");
    expect(v2.start).toEqual({ at: [0.015, -0.02], timeOffsetMs: 250, game: { mode: "hard" } });
    const bare = { ...v1Full(), start: {} };
    expect(ok(bare).recording.start).toEqual({});
  });

  it("writes the default seed when the run named none, seeding the generator the same", () => {
    for (const game of ["tactics", null]) {
      const v1 = { ...v1Full(), game, start: {} };
      const { seed } = ok(v1).recording;
      const draws = (rng: Rng) => Array.from({ length: 4 }, () => rng.nextU32());
      expect(draws(Rng.from(seed))).toEqual(draws(Rng.from(defaultSeed(game, v1.scene))));
    }
  });

  it("gives tickRate the registry's time kind, else fixed", () => {
    expect(ok(v1Full()).recording.time).toEqual({ kind: "fixed", rate: 30 });
    expect(ok(v1Full(), createRegistry()).recording.time).toEqual({ kind: "fixed", rate: 30 });
    expect(ok(v1Full(), { time: { kind: "turns" } }).recording.time).toEqual({
      kind: "turns",
      rate: 30,
    });
  });

  it("knows no platform, project or runHash, and gives seat 0 the keyboard", () => {
    const v2 = ok(v1Full()).recording;
    expect(v2.platform).toEqual({ arch: "unknown", runtime: "unknown", flavour: null });
    expect(v2.project).toBeNull();
    expect(v2.runHash).toBe("");
    expect(v2.players).toEqual([{ index: 0, devices: ["keyboard"] }]);
  });

  it("writes key edges as seat 0's b events and commands as c events, a tick's edges first", () => {
    const v2 = ok(v1Full()).recording;
    expect(v2.commands).toEqual(["end-turn", "@elapsed", "move"]);
    expect(v2.inputs).toEqual([
      [
        [0, "b", 0, 1],
        [4, "b", 1, 1],
        [4, "b", 0, 0],
        [4, "c", 0],
        [4, "c", 1, { ms: 20 }],
        [6, "c", 2, { unit: "a", to: [1, 2] }],
        [6, "c", 0],
        [9, "b", 1, 0],
      ],
    ]);
  });

  it("writes an @elapsed that leads its tick as a system w event", () => {
    expect(ok(v1Full()).recording.system).toEqual([
      [0, "w", 5000],
      [8, "w", 7],
      [8, "w", 9],
    ]);
  });

  it("is lossless: the v2 streams read back as v1's edges and commands", () => {
    const v1 = v1Full();
    const v2 = ok(v1).recording;
    expect(backToV1(v2)).toEqual({ inputs: v1.inputs, commands: v1.commands });
    expect(runRecordingSchema.safeParse(v2).success).toBe(true);
    expect(ok(JSON.stringify(v2))).toEqual({ ok: true, recording: v2 });
  });

  it("doesn't share objects with the v1 it was given", () => {
    const v1 = v1Full();
    const v2 = migrateRecordingV1(v1);
    (v1.commands![3]![2] as { unit: string }).unit = "changed";
    v1.markers[0]!.type = "changed";
    expect(v2.inputs[0]![5]).toEqual([6, "c", 2, { unit: "a", to: [1, 2] }]);
    expect(v2.markers[0]!.type).toBe("touch");
  });

  it("still refuses a v1 file the v1 rules refuse", () => {
    expect(issuesOf({ ...v1Full(), inputs: [[0, 2, 1]] })).toEqual([
      { path: "/inputs/0/1", message: "action index 2 is outside `actions` (2 names)" },
    ]);
    expect(
      issuesOf({
        ...v1Full(),
        commands: [
          [3, "move"],
          [2, "move"],
        ],
      })[0]!.path,
    ).toBe("/commands/1/0");
    expect(issuesOf({ ...v1Full(), tickRate: 0 })[0]!.path).toBe("/tickRate");
  });

  it.each(v1Fixtures)("migrates the frozen %s losslessly", (name) => {
    const v1 = readV1(name);
    expect(runRecordingV1Schema.safeParse(v1).success).toBe(true);
    const parsed = ok(v1);
    expect(parsed.migratedFrom).toBe(1);
    const v2 = parsed.recording;
    expect(backToV1(v2)).toEqual({ inputs: v1.inputs, commands: v1.commands ?? [] });
    expect(v2.seed).toEqual(v1.start.seed ?? `${v1.game ?? "engine"}:${v1.scene}`);
    expect(v2.time.rate).toBe(v1.tickRate);
    expect(v2.end).toBe(v1.end);
    expect(runRecordingSchema.safeParse(v2).success).toBe(true);
  });
});
