import { z } from "zod";

import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { ID_PATTERN } from "../game/fields";
import { MAX_TICK_RATE, MIN_TICK_RATE, type TimeKind } from "../game/time";
import type { DeviceId, JsonValue, Registry } from "../game/types";
import { scaleLengths } from "../game/units";
import { SHA256_PATTERN } from "../project/hash";
import type { AssetId, Sha256 } from "../project/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { deviceIdSchema } from "./device-id";
import { jsonPointer } from "./issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "./json-schema";
import { pxToMetres } from "./units";

/** The recording format version every recording is written in. */
export const RECORDING_VERSION = 2;

/** `urn:jams-engine:recording:v2`. Recordings are game-agnostic, so there is one schema. */
export const RECORDING_SCHEMA_ID = `${SCHEMA_ID_BASE}recording:v${RECORDING_VERSION}`;

/** A recording keeps the focus every this many ticks. */
export const RECORDING_TRAIL_EVERY = 4;

/** What `engine.physics` read in a v1 recording of a run without physics. */
const V1_NO_PHYSICS = "none";

/** The engine command a v2 recording holds as the system stream's `w` events. */
const ELAPSED_COMMAND = "@elapsed";

const pt = z
  .tuple([
    z.number().describe("x in world metres.").meta({ unit: "m" }),
    z.number().describe("y in world metres; y is down.").meta({ unit: "m" }),
  ])
  .meta({ id: "Pt" });

const tick = (description: string) => z.number().int().min(0).describe(description);
const index = (description: string) => z.number().int().min(0).describe(description);
const bit = (description: string) => z.union([z.literal(0), z.literal(1)]).describe(description);

const outcomeSchema = z
  .strictObject({
    result: z
      .string()
      .describe(
        "An engine result (`timeout`, `script-end`, `stuck`, `quit`, `flow`) or one the game declares.",
      ),
    tick: z.number().int().min(-1).describe("The last tick simulated."),
    at: pt.nullable().describe("The game's focus then; null without one."),
    cause: z.string().optional().describe("Why, in a sentence."),
    entityId: z.string().optional().describe("The entity the outcome names."),
  })
  .describe("How the run ended.");

const markersSchema = z
  .array(
    z
      .strictObject({
        tick: tick("The tick that raised it."),
        type: z.string().describe("The event type."),
        at: pt.describe("Where."),
        entityId: z.string().optional().describe("The entity it names."),
        other: z.string().optional().describe("The other entity it names."),
      })
      .describe("An event worth showing on the ghost."),
  )
  .describe(
    "Events the game marks (`play.markers`; every event but `entity:*` when it names none), capped.",
  );

const trailSchema = z
  .strictObject({
    every: z.literal(RECORDING_TRAIL_EVERY).describe("Ticks between samples."),
    pts: z
      .array(pt)
      .describe("The focus after ticks 0, 4, 8, …; a tick without a focus is left out."),
    truncated: z.boolean().describe("True when the cap cut the trail short."),
  })
  .optional()
  .describe("The game's focus over the run, for the ghost.");

const startShape = {
  at: pt
    .optional()
    .describe(
      "Where play was asked to start, before the cast onto the ground; omitted for the game's spawn.",
    ),
  timeOffsetMs: z
    .number()
    .min(0)
    .optional()
    .describe("Time-driven entities (followers) were advanced by this much before tick 0."),
  game: z
    .unknown()
    .optional()
    .describe("The game's play options, as its `play.options` schema defines them."),
};

const sharedHeader = {
  $schema: z.string().optional().describe("The recording JSON Schema this file follows."),
  scene: z.string().describe("The scene's `name`."),
  sceneHash: z
    .string()
    .describe(
      "The scene's canonical hash when recorded; shown beside a replay, and judges staleness for a recording migrated from v1.",
    ),
  game: z.string().nullable().describe("The game's id; null for an engine-only registry."),
  configHash: z
    .string()
    .describe(
      "What the run depends on besides the scene: engine version, tick rate, the game and its tuning.",
    ),
};

/** Format v1 (key edges only), kept to read and migrate v1 files; nothing writes it. */
export const runRecordingV1Schema = z
  .strictObject({
    ...sharedHeader,
    v: z.literal(1).describe("Recording format version."),
    engine: z
      .strictObject({
        version: z.string().describe("The engine version that recorded it."),
        physics: z.string().describe("The physics build, e.g. `rapier 0.19.3`, or `none`."),
      })
      .describe("What recorded it; a replay on another version or build warns."),
    tickRate: z.number().int().min(MIN_TICK_RATE).max(MAX_TICK_RATE).describe("Ticks per second."),
    start: z
      .strictObject({
        ...startShape,
        seed: z
          .union([z.number(), z.string()])
          .optional()
          .describe(
            "The seed `EngineContext.random` was given; omitted when the run named none and used the default for its game and scene.",
          ),
      })
      .describe("How the play world started."),
    actions: z
      .array(z.string())
      .describe("The action names `inputs` index into, in the order they were first used."),
    inputs: z
      .array(
        z
          .tuple([
            tick("The tick the edge is stepped on."),
            index("Index into `actions`."),
            bit("1 for down, 0 for up."),
          ])
          .describe("One input edge, in the order the runtime stepped it."),
      )
      .describe("Every input edge played, oldest first."),
    commands: z
      .array(
        z
          .tuple([
            tick("The tick the command is stepped on."),
            z
              .string()
              .describe("The command's name: the game's, or an engine one such as `@elapsed`."),
            z.unknown().optional().describe("Its arguments, as parsed; absent for none."),
          ])
          .meta({ minItems: 2, maxItems: 3 })
          .describe("One command, in the order the runtime stepped it."),
      )
      .optional()
      .describe("Every command stepped, oldest first; omitted when there were none."),
    ticks: tick("Ticks simulated."),
    outcome: outcomeSchema,
    markers: markersSchema,
    trail: trailSchema,
    end: z
      .string()
      .describe(
        "A digest of the game's snapshot after the last tick, which a replay must reproduce.",
      ),
  })
  .describe("A recorded run in format v1: key edges and commands only.");

export type RunRecordingV1 = z.infer<typeof runRecordingV1Schema>;
export type RecordingMarker = RunRecordingV1["markers"][number];
/** A command stamped with the tick that stepped it: `[tick, name, args?]`. */
export type RecordingCommand = NonNullable<RunRecordingV1["commands"]>[number];

// ─── Recording v2 ────────────────────────────────────────

/**
 * One seat's input event. `t` is the tick, or the tick plus a sub-tick
 * fraction in thousandths (`120.375`) when the game records offsets.
 * Analog values and vector components are ints × 1000; pointer x and y
 * are world metres × 10,000, as ints.
 */
export type SeatEvent =
  | [t: number, kind: "b", action: number, down: 0 | 1]
  | [t: number, kind: "a", action: number, value: number]
  | [t: number, kind: "v", action: number, x: number, y: number]
  | [t: number, kind: "p", x: number, y: number, buttons: number, over: 0 | 1]
  | [t: number, kind: "c", command: number, args?: unknown];

/** The system stream: `w` is `@elapsed`, `j` and `l` a seat's join and leave. */
export type SystemEvent =
  | [t: number, kind: "w", ms: number]
  | [t: number, kind: "j", player: number, device: DeviceId]
  | [t: number, kind: "l", player: number, device: DeviceId];

/** Where a recording was made; `flavour` names the Rapier package, null without one. */
export type RecordingPlatform = { arch: string; runtime: string; flavour: string | null };

/**
 * A v2 recording: one input stream per seat plus a system stream, merged
 * per tick system first, then seats in order, each in stream order.
 */
export type RunRecordingV2 = {
  $schema?: string;
  v: 2;
  /** `physics` is null for a run without physics. */
  engine: { version: string; physics: string | null };
  platform: RecordingPlatform;
  game: string | null;
  scene: string;
  sceneHash: string;
  /**
   * What the run ran (the expanded scene, the clock and the project's data);
   * a replay is stale when it differs. Empty for a recording migrated from
   * v1, whose staleness is judged on `sceneHash`.
   */
  runHash: string;
  /** Null for a run without a project; `snapshot` is the project snapshot's hash, when the host knew it. */
  project: { id: string; snapshot: string | null } | null;
  configHash: string;
  time: { kind: TimeKind; rate: number };
  /** Always written: the default seed when the run named none. */
  seed: number | string;
  start: {
    at?: [x: number, y: number];
    timeOffsetMs?: number;
    game?: unknown;
    /** `EngineContext.persist` as the scene loaded; written when the game declares `persist`. */
    persist?: JsonValue;
    /** The entry the flow request that loaded this scene named (`EngineContext.flow.entry`). */
    entry?: string;
  };
  players: { index: number; devices: DeviceId[] }[];
  /** Names `inputs` index into. */
  actions: string[];
  commands: string[];
  /** Per seat. */
  inputs: SeatEvent[][];
  system: SystemEvent[];
  ticks: number;
  outcome: RunRecordingV1["outcome"];
  markers: RecordingMarker[];
  trail?: RunRecordingV1["trail"];
  end: string;
  /** The flow request that ended this scene's run; a replay ends here without following it. */
  next?: { scene: AssetId; entry?: string };
  /** The save the run began from: its slot and the save file's hash. */
  fromSave?: { slot: string; sha256: Sha256 };
};

/** A recording in the current format. */
export type RunRecording = RunRecordingV2;

/** The parts of a v2 recording that hold its input. */
export type RecordingStream = Pick<RunRecordingV2, "actions" | "commands" | "inputs" | "system">;

const eventTime = z
  .number()
  .min(0)
  .describe(
    "The tick, or the tick plus a sub-tick fraction in thousandths (`120.375`) when the game records offsets.",
  );
const milli = (description: string) => z.number().int().min(-1000).max(1000).describe(description);
const tenThousandths = (description: string) =>
  z.number().int().describe(description).meta({ unit: "m/10000" });
const kind = <K extends string>(k: K, description: string) => z.literal(k).describe(description);

const seatEventSchema = z
  .union([
    z
      .tuple([
        eventTime,
        kind("b", "A button edge."),
        index("Index into `actions`."),
        bit("1 for down, 0 for up."),
      ])
      .describe("A button went down or up."),
    z
      .tuple([
        eventTime,
        kind("a", "An axis value."),
        index("Index into `actions`."),
        milli("The axis value × 1000, −1000…1000."),
      ])
      .describe("An axis changed."),
    z
      .tuple([
        eventTime,
        kind("v", "A vector value."),
        index("Index into `actions`."),
        milli("x × 1000, in the unit disc."),
        milli("y × 1000, in the unit disc; y is down."),
      ])
      .describe("A vector changed."),
    z
      .tuple([
        eventTime,
        kind("p", "A pointer sample."),
        tenThousandths("x in world metres × 10,000."),
        tenThousandths("y in world metres × 10,000; y is down."),
        z.number().int().min(0).describe("The buttons held: bit 0 primary, 1 secondary, 2 middle."),
        bit("1 while the pointer is over the game, 0 after it left."),
      ])
      .describe("The seat's pointer, written only when it changed."),
    z
      .tuple([
        eventTime,
        kind("c", "A command."),
        index("Index into `commands`."),
        z.unknown().optional().describe("Its arguments, as parsed; absent for none."),
      ])
      .meta({ minItems: 3, maxItems: 4 })
      .describe("A command the seat stepped."),
  ])
  .describe("One seat input event.");

const systemEventSchema = z
  .union([
    z
      .tuple([
        eventTime,
        kind("w", "Wall time away (`@elapsed`)."),
        z.number().int().min(0).describe("The ms that passed."),
      ])
      .describe("Time passed while the game wasn't running."),
    z
      .tuple([
        eventTime,
        kind("j", "A join."),
        index("The seat."),
        deviceIdSchema.describe("The device it took."),
      ])
      .describe("A seat took a device."),
    z
      .tuple([
        eventTime,
        kind("l", "A leave."),
        index("The seat."),
        deviceIdSchema.describe("The device it gave up."),
      ])
      .describe("A seat gave up a device."),
  ])
  .describe("One system event.");

/** The zod schema `recording.schema.json` is generated from; `parseRecording` checks v2 files with it. */
export const runRecordingSchema = z
  .strictObject({
    $schema: sharedHeader.$schema,
    v: z.literal(RECORDING_VERSION).describe("Recording format version."),
    engine: z
      .strictObject({
        version: z.string().describe("The engine version that recorded it."),
        physics: z
          .string()
          .nullable()
          .describe("The physics build, e.g. `rapier 0.19.3`; null for a run without physics."),
      })
      .describe("What recorded it; a replay on another version or build warns."),
    platform: z
      .strictObject({
        arch: z
          .string()
          .describe("The CPU architecture (`arm64`, `x64`), or `unknown`, which never warns."),
        runtime: z.string().describe("The JavaScript runtime and its version, or `unknown`."),
        flavour: z
          .string()
          .nullable()
          .describe("The Rapier package (`rapier2d-compat`, …); null without one."),
      })
      .describe("Where it was recorded."),
    game: sharedHeader.game,
    scene: sharedHeader.scene,
    sceneHash: sharedHeader.sceneHash,
    runHash: z
      .string()
      .describe(
        "A hash of what the run ran: the expanded scene, the clock and the project's data. A replay is stale when it differs; empty for a recording migrated from v1.",
      ),
    project: z
      .strictObject({
        id: z.string().describe("The project's id."),
        snapshot: z
          .string()
          .nullable()
          .describe(
            "The project snapshot's hash when recorded; null when the host didn't know it.",
          ),
      })
      .nullable()
      .describe("The project the run was played in; null without one."),
    configHash: sharedHeader.configHash,
    time: z
      .strictObject({
        kind: z.enum(["fixed", "turns", "event"]).describe("The game's time model."),
        rate: z.number().int().min(MIN_TICK_RATE).max(MAX_TICK_RATE).describe("Ticks per second."),
      })
      .describe("The clock the run stepped on."),
    seed: z
      .union([z.number(), z.string()])
      .describe(
        "The seed `EngineContext.random` was given: the run's own, or the default for its game and scene.",
      ),
    start: z
      .strictObject({
        ...startShape,
        persist: z
          .json()
          .optional()
          .describe(
            "`EngineContext.persist` as the scene loaded, set before the load on replay; written when the game declares `persist`.",
          ),
        entry: z
          .string()
          .optional()
          .describe(
            "The entry the flow request that loaded this scene named, read in `onLoad` as `EngineContext.flow.entry`.",
          ),
      })
      .describe("How the play world started."),
    players: z
      .array(
        z
          .strictObject({
            index: index("The seat."),
            devices: z.array(deviceIdSchema).describe("The devices it held."),
          })
          .describe("A seat that played."),
      )
      .describe("The seats that played and their devices."),
    actions: z
      .array(z.string())
      .describe("The action names seat events index into, in the order they were first used."),
    commands: z
      .array(z.string())
      .describe("The command names `c` events index into, in the order they were first used."),
    inputs: z
      .array(z.array(seatEventSchema).describe("One seat's events, oldest first."))
      .describe("Per seat, by seat index."),
    system: z
      .array(systemEventSchema)
      .describe("Wall time away, joins and leaves, oldest first; merged before the seats."),
    ticks: tick("Ticks simulated."),
    outcome: outcomeSchema,
    markers: markersSchema,
    trail: trailSchema,
    end: z
      .string()
      .describe(
        "A digest of the game's snapshot after the last tick, which a replay must reproduce.",
      ),
    next: z
      .strictObject({
        scene: z.string().regex(ID_PATTERN).describe("The scene the request went to."),
        entry: z.string().optional().describe("The entry it named."),
      })
      .optional()
      .describe(
        "The flow request that ended this scene's part of a run, whose next scene has its own recording; a replay ends here without following it.",
      ),
    fromSave: z
      .strictObject({
        slot: z.string().describe("The save's slot."),
        sha256: z
          .string()
          .regex(SHA256_PATTERN)
          .describe("The save file's hash; a replay needs the fixture with this hash."),
      })
      .optional()
      .describe("The save the run began by loading, instead of the scene's fresh load."),
  })
  .describe(
    "A recorded run: how it started and every seat's input, enough to replay it tick for tick, " +
      "plus what the ghost draws (trail and markers) and how it ended.",
  );

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesType: Same<z.infer<typeof runRecordingSchema>, RunRecordingV2> = true;
void schemaMatchesType;

/** What reading a recording takes from the registry: the time kind, and for a v1 file the game and commands. */
export type RecordingRegistry = Pick<Registry, "time"> &
  Partial<Pick<Registry, "game" | "commands">>;

/** A recording that didn't parse: a JSON Pointer into it and one sentence per problem. */
export type RecordingIssue = { path: string; message: string };

export type ParseRecordingResult =
  | {
      ok: true;
      recording: RunRecording;
      /** The format version read, when it was migrated to the current one. */
      migratedFrom?: 1;
    }
  | { ok: false; issues: RecordingIssue[] };

/**
 * A v1 recording in format v2, losslessly: key edges become seat 0's `b`
 * events and commands its `c` events, except an `@elapsed` that leads its
 * tick, which becomes a system `w` event (the system stream merges first,
 * so the tick's order is kept); `tickRate` becomes `time` with the
 * registry's time kind, else `fixed`. v1 ran in world px, so its lengths
 * become metres at the registry's px per metre (`world.lengthUnit`, else the
 * default), by the input-script rule: positions (`start.at`, the outcome's
 * `at`, markers and trail) always, and the play options and each command's
 * args wherever the registry's schemas declare a length unit. The platform
 * is unknown, the project null and `runHash` empty, so a replay judges
 * staleness on `sceneHash`. Without a seed the run used its default one,
 * written as the text the default is hashed from, which seeds the
 * generator identically.
 */
export function migrateRecordingV1(
  v1: RunRecordingV1,
  registry?: RecordingRegistry,
): RunRecordingV2 {
  const pxPerMetre = registry?.game?.world?.lengthUnit ?? DEFAULT_LENGTH_UNIT;
  const metres = ([x, y]: readonly [number, number]): [number, number] => [
    pxToMetres(x, pxPerMetre),
    pxToMetres(y, pxPerMetre),
  ];

  const argsOf = (name: string, args: unknown): unknown => {
    const schema = registry?.commands?.get(name)?.args;
    return schema ? scaleLengths(structuredClone(args), schema, pxPerMetre) : structuredClone(args);
  };
  const commandNames: string[] = [];
  const commandIndex = (name: string): number => {
    let i = commandNames.indexOf(name);
    if (i < 0) i = commandNames.push(name) - 1;
    return i;
  };

  const seat: { t: number; order: number; seq: number; event: SeatEvent }[] = [];
  const system: SystemEvent[] = [];
  v1.inputs.forEach(([t, action, down], seq) => {
    seat.push({ t, order: 0, seq, event: [t, "b", action, down] });
  });
  let gameCommandTick = -1;
  (v1.commands ?? []).forEach(([t, name, args], seq) => {
    const ms = name === ELAPSED_COMMAND ? elapsedMs(args) : null;
    if (ms !== null && gameCommandTick !== t) {
      system.push([t, "w", ms]);
      return;
    }
    gameCommandTick = t;
    const event: SeatEvent =
      args === undefined
        ? [t, "c", commandIndex(name)]
        : [t, "c", commandIndex(name), argsOf(name, args)];
    seat.push({ t, order: 1, seq, event });
  });
  seat.sort((a, b) => a.t - b.t || a.order - b.order || a.seq - b.seq);

  const { at, timeOffsetMs, game, seed } = v1.start;
  const start: RunRecordingV2["start"] = {};
  if (at !== undefined) start.at = metres(at);
  if (timeOffsetMs !== undefined) start.timeOffsetMs = timeOffsetMs;
  const options = registry?.game?.play?.options;
  if (game !== undefined)
    start.game = options
      ? scaleLengths(structuredClone(game), options, pxPerMetre)
      : structuredClone(game);

  const out: RunRecordingV2 = {
    v: 2,
    engine: {
      version: v1.engine.version,
      physics: v1.engine.physics === V1_NO_PHYSICS ? null : v1.engine.physics,
    },
    platform: { arch: "unknown", runtime: "unknown", flavour: null },
    game: v1.game,
    scene: v1.scene,
    sceneHash: v1.sceneHash,
    runHash: "",
    project: null,
    configHash: v1.configHash,
    time: { kind: registry?.time.kind ?? "fixed", rate: v1.tickRate },
    seed: seed ?? `${v1.game ?? "engine"}:${v1.scene}`,
    start,
    players: [{ index: 0, devices: ["keyboard"] }],
    actions: [...v1.actions],
    commands: commandNames,
    inputs: [seat.map((s) => s.event)],
    system,
    ticks: v1.ticks,
    outcome: { ...structuredClone(v1.outcome), at: v1.outcome.at && metres(v1.outcome.at) },
    markers: v1.markers.map((m) => ({ ...structuredClone(m), at: metres(m.at) })),
    end: v1.end,
  };
  if (v1.trail) out.trail = { ...v1.trail, pts: v1.trail.pts.map(metres) };
  return out;
}

/** `@elapsed`'s ms when its args are the ones the engine command takes, else null. */
function elapsedMs(args: unknown): number | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const keys = Object.keys(args);
  const ms = (args as { ms?: unknown }).ms;
  return keys.length === 1 && typeof ms === "number" && Number.isInteger(ms) && ms >= 0 ? ms : null;
}

const zodIssues = (error: z.ZodError): RecordingIssue[] =>
  error.issues.map((i) => ({
    path: jsonPointer(i.path.filter((p): p is string | number => typeof p !== "symbol")),
    message: i.message,
  }));

const fail = (path: (string | number)[], message: string): ParseRecordingResult => ({
  ok: false,
  issues: [{ path: jsonPointer(path), message }],
});

function v1Problem(rec: RunRecordingV1): ParseRecordingResult | null {
  const { actions, inputs } = rec;
  const bad = inputs.findIndex(([, a]) => a >= actions.length);
  if (bad >= 0)
    return fail(
      ["inputs", bad, 1],
      `action index ${inputs[bad]![1]} is outside \`actions\` (${actions.length} names)`,
    );
  const commands = rec.commands ?? [];
  const late = commands.findIndex(([t], i) => i > 0 && t < commands[i - 1]![0]);
  if (late >= 0)
    return fail(
      ["commands", late, 0],
      `commands are oldest first, but tick ${commands[late]![0]} follows tick ${commands[late - 1]![0]}`,
    );
  return null;
}

function v2Problem(rec: RunRecordingV2): ParseRecordingResult | null {
  const streams: [path: (string | number)[], events: (SeatEvent | SystemEvent)[]][] = [
    ...rec.inputs.map((events, p): [(string | number)[], SeatEvent[]] => [["inputs", p], events]),
    [["system"], rec.system],
  ];
  for (const [path, events] of streams) {
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const previous = events[i - 1];
      if (previous && event[0] < previous[0])
        return fail(
          [...path, i, 0],
          `events are oldest first, but ${event[0]} follows ${previous[0]}`,
        );
      const [, k, n] = event;
      if ((k === "b" || k === "a" || k === "v") && n >= rec.actions.length)
        return fail(
          [...path, i, 2],
          `action index ${n} is outside \`actions\` (${rec.actions.length} names)`,
        );
      if (k === "c" && n >= rec.commands.length)
        return fail(
          [...path, i, 2],
          `command index ${n} is outside \`commands\` (${rec.commands.length} names)`,
        );
    }
  }
  return null;
}

/**
 * Parses a recording from JSON text or a parsed value, v1 or v2; a v1 file
 * is migrated (`migratedFrom: 1`), its time kind and px per metre taken
 * from `registry` when given. Never throws.
 */
export function parseRecording(input: unknown, registry?: RecordingRegistry): ParseRecordingResult {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [{ path: "", message: `the text isn't valid JSON: ${detail}` }] };
    }
  }
  const v = raw !== null && typeof raw === "object" ? (raw as { v?: unknown }).v : undefined;
  if (v === 1) {
    const parsed = runRecordingV1Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
    const problem = v1Problem(parsed.data);
    if (problem) return problem;
    return { ok: true, recording: migrateRecordingV1(parsed.data, registry), migratedFrom: 1 };
  }
  if (v !== RECORDING_VERSION) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return fail([], "a recording is a JSON object");
    return fail(["v"], `the format version must be 1 or 2, got ${JSON.stringify(v) ?? "none"}`);
  }
  const parsed = runRecordingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  return v2Problem(parsed.data) ?? { ok: true, recording: parsed.data };
}

/** The draft 2020-12 JSON Schema of recordings. */
export function recordingJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(runRecordingSchema);
  return {
    $schema,
    $id: RECORDING_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine run recording, format v${RECORDING_VERSION}`,
    ...rest,
  };
}
