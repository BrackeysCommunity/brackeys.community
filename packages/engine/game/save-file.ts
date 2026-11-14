/**
 * The save file (`save:v1`): the engine's envelope around a game's own
 * data, at one of two depths. Zod and game/ and project/ only, so the
 * canvas-sync image and a server's save route can read one.
 */
import { z } from "zod";

import { canonicalJson } from "../project/canonical";
import { SHA256_PATTERN } from "../project/hash";
import type { DocLayout } from "../project/kinds/define";
import { readJsonDocument, zodSceneIssues } from "../project/project-file";
import type { AssetId, ProjectId, Sha256 } from "../project/types";
import { makeIssue, parentCycleMessage } from "../scene/issues";
import { locatePointer } from "../scene/parse";
import type { SceneIssue } from "../scene/types";
import type { RngState } from "../sim-kit/rng";
import { ID_PATTERN } from "./fields";
import type { SublevelInfo } from "./flow";
import type { DeviceId, GameDefinition, InstantiateOptions, JsonValue, SpawnInput } from "./types";

export const SAVE_VERSION = 1;
export const SAVE_SCHEMA_ID = `urn:jams-engine:save:v${SAVE_VERSION}`;
/** The longest slot name, in characters. */
export const SLOT_MAX_LENGTH = 32;
/** What a slot name is, in the words every message about one uses. */
export const SLOT_RULE = `lowercase letters, digits and dashes, 1–${SLOT_MAX_LENGTH} characters, starting with a letter or digit`;
/** A slot name, as `SLOT_RULE` words it. */
export const SLOT_PATTERN = new RegExp(`^[a-z0-9][a-z0-9-]{0,${SLOT_MAX_LENGTH - 1}}$`);

/** A `schema` issue at `/slot` when `slot` isn't a slot name, else null. */
export function slotNameIssue(slot: string): SceneIssue | null {
  return SLOT_PATTERN.test(slot)
    ? null
    : makeIssue("schema", {
        message: `"${slot}" isn't a slot name: use ${SLOT_RULE}`,
        path: "/slot",
        got: slot,
      });
}

/** `progress`: the scene, persist and the game's snapshot. `world`: everything a run needs to continue exactly. */
export type SaveDepth = "progress" | "world";

export type SaveMeta = {
  title?: string;
  /** The main scene it was saved in. */
  scene: AssetId;
  /** The host's clock when saved, ms since the epoch; never read inside the simulation. */
  savedAt: number;
  playTicks: number;
};

/** What a game's save migrations take and return. */
export type SaveGameData = { persist: JsonValue; game: JsonValue };

/**
 * Each entity's saved state by owner (a type system, a behavior, `motion`,
 * `grid-step`), written only for an owner whose `save` returned a value.
 * The `@random` key holds `ctx.random`'s forks by label.
 */
export type SavedSystems = Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;

/** The `world.systems` key of `ctx.random`'s forks; `@` can't begin an entity id. */
export const SAVE_RANDOM_KEY = "@random";
/** The owner name a motion body saves under in `world.systems`. */
export const MOTION_SAVE_OWNER = "motion";
/** The owner name a grid stepper saves under in `world.systems`. */
export const GRID_STEP_SAVE_OWNER = "grid-step";

export type SavedTimer = {
  id: number;
  due: number;
  period?: number;
  times?: number;
  emit: string;
  entityId?: string;
  data?: JsonValue;
  owner?: string;
};

export type WorldState = {
  tick: number;
  /** Runtime id counters by name. */
  counters: Readonly<Record<string, number>>;
  random: RngState;
  /** Pending emit-form timers. */
  timers: readonly SavedTimer[];
  /** Entities whose own switch is off, by id; one under a disabled parent is off without a line here. */
  enabled: Readonly<Record<string, false>>;
  /**
   * Each live entity whose parent differs from the one its load or spawn
   * gave it: the parent's id, or null for a root. Absent when none differs.
   */
  parents?: Readonly<Record<string, string | null>>;
  /** Scene entities destroyed since the load. */
  destroyed: readonly string[];
  spawned: readonly {
    id: string;
    input: SpawnInput;
    instance?: InstantiateOptions & { prefab: AssetId };
  }[];
  /** `[x, y, angle]`, metres and radians. */
  poses: Readonly<Record<string, readonly [number, number, number]>>;
  systems: SavedSystems;
  seats: readonly { player: number; devices: readonly DeviceId[] }[];
};

export type SaveFile = {
  $schema?: string;
  kind: "save";
  v: typeof SAVE_VERSION;
  game: string;
  gameVersion: number;
  engine: string;
  release: Sha256 | null;
  project: { id: ProjectId; snapshot: Sha256 } | null;
  slot: string;
  meta: SaveMeta;
  depth: SaveDepth;
  persist: JsonValue;
  scene: {
    id: AssetId;
    runHash: string;
    /** The scene's `ctx.flow.entry` when saved; absent for none. */
    entry?: string;
    sublevels: readonly SublevelInfo[];
  };
  /** The game's own data, its `snapshot()`; `game` is the game's id. */
  data: JsonValue;
  /** Depth `world` only. */
  world?: WorldState;
};

export type SaveLimits = { maxBytes: number; maxSlots: number };

/** 64 KiB per save and 8 slots per game, unless the game sets its own. */
export const DEFAULT_SAVE_LIMITS: SaveLimits = Object.freeze({ maxBytes: 65_536, maxSlots: 8 });
/** The most a game may raise its limits to in the browser's stores. */
export const MAX_BROWSER_SAVE_LIMITS: SaveLimits = Object.freeze({
  maxBytes: 1_048_576,
  maxSlots: 64,
});

/** What a save read returns: the file, migrated up to the game's version, or why it can't load. */
export type ParseSaveResult =
  | { ok: true; file: SaveFile; migratedFrom?: number }
  | { ok: false; issues: SceneIssue[] };

/** The store fields the limits read: its kind and its own, possibly stricter, limits. */
export type SaveLimitsStore = { kind: string; limits?: Partial<SaveLimits> };

const SAVE_KIND = "save";

const count = z.number().int().min(0);
const assetId = z.string().regex(ID_PATTERN);
const sha256 = z.string().regex(SHA256_PATTERN);
const uint32 = z.number().int().min(0).max(0xffff_ffff).describe("A 32-bit state word.");
const metres = (what: string) => z.number().describe(`${what}, metres.`);

const jsonValueSchema: z.ZodType<JsonValue> = z
  .json()
  .meta({ id: "JsonValue" })
  .describe("Any JSON value.") as z.ZodType<JsonValue>;

/** A `DeviceId`; the save file reads no scene schema module. */
const DEVICE_PATTERN = /^(?:keyboard|pointer|touch|pad:\d+)$/;
const deviceSchema = z
  .string()
  .regex(DEVICE_PATTERN, "a device is `keyboard`, `pointer`, `touch` or `pad:<n>`")
  .describe("A device: `keyboard`, `pointer`, `touch` or `pad:<n>`.") as z.ZodType<DeviceId>;

const metaSchema = z
  .strictObject({
    title: z.string().optional().describe("What a save menu shows for it."),
    scene: assetId.describe("The main scene it was saved in."),
    savedAt: count.describe("The host's clock when saved, ms since the epoch."),
    playTicks: count.describe("Ticks played in the run that saved it."),
  })
  .describe("What a save menu lists it by.");

const sublevelSchema = z
  .strictObject({
    label: z.string().regex(ID_PATTERN).describe("The sublevel's label, its entities' id prefix."),
    scene: assetId.describe("The scene attached."),
    at: z
      .tuple([metres("x"), metres("y")])
      .describe("Where its origin sits in the main scene, metres."),
  })
  .describe("A sublevel attached when it was saved.");

const timerSchema = z
  .strictObject({
    id: count.describe("The timer's id."),
    due: count.describe("The tick it fires on."),
    period: z.number().int().min(1).optional().describe("Ticks between repeats."),
    times: z.number().int().min(1).optional().describe("Repeats left."),
    emit: z.string().min(1).describe("The event it emits."),
    entityId: z.string().optional().describe("The entity the event names."),
    data: jsonValueSchema.optional().describe("The event's data."),
    owner: z.string().optional().describe("The system or behavior that set it."),
  })
  .describe("A pending emit-form timer.");

const spawnInputSchema = z
  .looseObject({
    type: z.string().min(1).describe("The entity type."),
    id: z.string().optional().describe("The id it asked for."),
    sublevel: z.string().optional().describe("The sublevel it belongs to."),
    parent: z.string().min(1).optional().describe("The live entity it spawned under."),
    local: z.boolean().optional().describe("Its geometry fields are in the parent's frame."),
  })
  .describe("The spawn's input, the type's own fields beside these.");

const instanceSchema = z
  .strictObject({
    prefab: assetId.describe("The prefab instantiated."),
    rot: z
      .number()
      .optional()
      .describe(
        "Degrees clockwise; a save from an engine before 0.16.0 holds quarter turns 0–3, read as 90 × k.",
      ),
    parent: z.string().min(1).optional().describe("The live entity its node spawned under."),
    local: z.boolean().optional().describe("`at` is in the parent's frame."),
    flip: z.boolean().optional().describe("Mirrored on x."),
    z: z.number().optional().describe("Draw order."),
    layer: z.string().optional().describe("The layer it was placed on."),
    params: z.record(z.string(), z.unknown()).optional().describe("The prefab's params."),
    overrides: z.record(z.string(), z.unknown()).optional().describe("Overrides by path."),
  })
  .describe("The prefab instance a spawn came from.");

const worldSchema = z
  .strictObject({
    tick: count.describe("The tick it was saved at."),
    counters: z.record(z.string(), count).describe("Runtime id counters by name."),
    random: z.tuple([uint32, uint32, uint32, uint32]).describe("`ctx.random`'s state."),
    timers: z.array(timerSchema).describe("Pending emit-form timers."),
    enabled: z
      .record(z.string(), z.literal(false))
      .describe("Entities whose own switch is off, by id."),
    parents: z
      .record(
        z.string(),
        z.string().min(1).nullable().describe("The parent's id, or null for a root."),
      )
      .optional()
      .describe("Entities whose parent differs from the one their load or spawn gave them, by id."),
    destroyed: z.array(z.string()).describe("Scene entities destroyed since the load."),
    spawned: z
      .array(
        z
          .strictObject({
            id: z.string().min(1).describe("The id it was given."),
            input: spawnInputSchema,
            instance: instanceSchema.optional(),
          })
          .describe("An entity spawned at run time."),
      )
      .describe("Entities spawned at run time, in spawn order."),
    poses: z
      .record(
        z.string(),
        z.tuple([metres("x"), metres("y"), z.number().describe("The angle, radians.")]),
      )
      .describe("`[x, y, angle]` by entity id, metres and radians."),
    systems: z
      .record(z.string(), z.record(z.string(), jsonValueSchema))
      .describe("Each entity's saved state by owner; `@random` holds the random forks."),
    seats: z
      .array(
        z
          .strictObject({
            player: count.describe("The seat."),
            devices: z.array(deviceSchema).describe("The devices it held."),
          })
          .describe("An input seat."),
      )
      .describe("Input seats and their devices."),
  })
  .describe("Everything a run needs to continue exactly; depth `world` only.");

/** The strict `save:v1` schema. */
export const saveFileSchema: z.ZodType<SaveFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The JSON Schema this file follows."),
    kind: z.literal(SAVE_KIND).describe("Always `save`."),
    v: z.literal(SAVE_VERSION).describe("The save format version."),
    game: z.string().regex(ID_PATTERN).describe("The id of the game that wrote it."),
    gameVersion: z
      .number()
      .int()
      .min(1)
      .describe("The game's `saves.version` when it was written."),
    engine: z.string().min(1).describe("The engine version that wrote it."),
    release: sha256.nullable().describe("The release it was played in; null outside one."),
    project: z
      .strictObject({
        id: z.string().regex(ID_PATTERN).describe("The project's id."),
        snapshot: sha256.describe("The project snapshot's hash."),
      })
      .nullable()
      .describe("The project snapshot it was played from; null without one."),
    slot: z
      .string()
      .regex(SLOT_PATTERN, `a slot is ${SLOT_RULE}`)
      .describe("The slot it was saved to."),
    meta: metaSchema,
    depth: z.enum(["progress", "world"]).describe("`progress`, or `world` to continue exactly."),
    persist: jsonValueSchema.describe("The game's persistent state."),
    scene: z
      .strictObject({
        id: assetId.describe("The main scene."),
        runHash: z
          .string()
          .describe("The run hash it was saved under; a different one loads with a note."),
        entry: z
          .string()
          .optional()
          .describe("The entry the scene was reached through, its `ctx.flow.entry`."),
        sublevels: z.array(sublevelSchema).describe("Sublevels attached, in attach order."),
      })
      .describe("The scene it was saved in."),
    data: jsonValueSchema.describe("The game's own data, its `snapshot()`."),
    world: worldSchema.optional(),
  })
  .superRefine((file, ctx) => {
    if (file.depth === "world" && file.world === undefined)
      ctx.addIssue({ code: "custom", path: ["world"], message: "a world save holds `world`" });
    for (const [id, parent] of Object.entries(file.world?.parents ?? {})) {
      if (parent === id)
        ctx.addIssue({
          code: "custom",
          path: ["world", "parents", id],
          message: parentCycleMessage(id, parent),
        });
    }
    if (file.depth === "progress" && file.world !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["world"],
        message: "a progress save holds no `world`",
      });
  })
  .describe(
    "A save:v1 file: the engine's envelope around a game's own data.",
  ) as z.ZodType<SaveFile>;

const LIST: DocLayout = { as: "list", item: { as: "atomic" } };
const OPEN_MAP: DocLayout = { as: "map", rest: { as: "atomic" } };

/** Key order and line breaks of a save's text; every key a layout leaves out sorts by code unit. */
const SAVE_TEXT_LAYOUT: DocLayout = {
  as: "map",
  fields: {
    $schema: { as: "atomic" },
    kind: { as: "atomic" },
    v: { as: "atomic" },
    game: { as: "atomic" },
    gameVersion: { as: "atomic" },
    engine: { as: "atomic" },
    release: { as: "atomic" },
    project: { as: "atomic" },
    slot: { as: "atomic" },
    meta: { as: "atomic" },
    depth: { as: "atomic" },
    persist: OPEN_MAP,
    scene: {
      as: "map",
      fields: {
        id: { as: "atomic" },
        runHash: { as: "atomic" },
        entry: { as: "atomic" },
        sublevels: LIST,
      },
    },
    data: OPEN_MAP,
    world: {
      as: "map",
      fields: {
        tick: { as: "atomic" },
        counters: { as: "atomic" },
        random: { as: "atomic" },
        timers: LIST,
        enabled: OPEN_MAP,
        parents: OPEN_MAP,
        destroyed: { as: "atomic" },
        spawned: LIST,
        poses: OPEN_MAP,
        systems: OPEN_MAP,
        seats: LIST,
      },
    },
  },
};

/** Canonical JSON with a trailing newline; a save's size is the UTF-8 length of this text. */
export function formatSaveFile(file: SaveFile): string {
  return canonicalJson(file, SAVE_TEXT_LAYOUT);
}

/** A save's size: the UTF-8 length of its canonical text, what every limit is judged on. */
export function saveFileBytes(file: SaveFile): number {
  return new TextEncoder().encode(formatSaveFile(file)).length;
}

/** Parses, checks the envelope, then migrates `{ persist, game }` from `gameVersion` up with the game's migrations. */
export function parseSaveFile(
  text: string,
  game?: Pick<GameDefinition, "id" | "saves">,
): ParseSaveResult {
  const result = readSaveFile(text, game);
  if (result.ok) return result;
  const withLine = (issue: SceneIssue): SceneIssue => {
    if (issue.path === undefined || issue.line !== undefined) return issue;
    const line = locatePointer(text, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };
  return { ...result, issues: result.issues.map(withLine) };
}

function readSaveFile(text: string, game?: Pick<GameDefinition, "id" | "saves">): ParseSaveResult {
  const read = readJsonDocument(text, SAVE_KIND, SAVE_VERSION, "a save file");
  if (!read.ok) return read;
  const parsed = saveFileSchema.safeParse(read.raw);
  if (!parsed.success) return { ok: false, issues: zodSceneIssues(parsed.error, ["game"]) };
  const lifted = liftQuarterTurns(parsed.data);
  if (!lifted.ok) return lifted;
  const { file } = lifted;
  if (!game) return { ok: true, file };
  if (file.game !== game.id) {
    return {
      ok: false,
      issues: [
        makeIssue("schema", {
          message: `this save is for the game "${file.game}", not "${game.id}"`,
          path: "/game",
          expected: game.id,
          got: file.game,
        }),
      ],
    };
  }
  return migrateSave(file, game.saves?.version ?? 1, game.saves?.migrations ?? {});
}

/** The engine version whose saves hold an instance's `rot` in degrees; older ones hold quarter turns. */
const DEGREE_TURNS_SINCE = "0.16.0";

/** Whether the version `engine` names is older than `than`; false when either isn't `major.minor.patch`. */
function engineOlder(engine: string, than: string): boolean {
  const parts = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const [a, b] = [parts(engine), parts(than)];
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/**
 * A world save from an engine before degree turns, each instance record's
 * quarter turns `k` read as `90 × k` degrees; when any turned, `engine` is
 * set to the first version that writes degrees, so it isn't lifted twice.
 */
function liftQuarterTurns(
  file: SaveFile,
): { ok: true; file: SaveFile } | Extract<ParseSaveResult, { ok: false }> {
  const world = file.world;
  if (!world || !engineOlder(file.engine, DEGREE_TURNS_SINCE)) return { ok: true, file };
  const issues: SceneIssue[] = [];
  const spawned = world.spawned.map((rec, i) => {
    const rot = rec.instance?.rot;
    if (!rot || !rec.instance) return rec;
    if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) {
      issues.push(
        makeIssue("schema", {
          message: `a save from engine ${file.engine} counts an instance's turns in quarter turns, 0–3`,
          path: `/world/spawned/${i}/instance/rot`,
          expected: "0, 1, 2 or 3",
          got: String(rot),
        }),
      );
      return rec;
    }
    return { ...rec, instance: { ...rec.instance, rot: rot * 90 } };
  });
  if (issues.length > 0) return { ok: false, issues };
  if (spawned.every((rec, i) => rec === world.spawned[i])) return { ok: true, file };
  return { ok: true, file: { ...file, engine: DEGREE_TURNS_SINCE, world: { ...world, spawned } } };
}

function migrateSave(
  file: SaveFile,
  target: number,
  migrations: Readonly<Record<number, (data: SaveGameData) => SaveGameData>>,
): ParseSaveResult {
  const from = file.gameVersion;
  if (from > target) {
    return {
      ok: false,
      issues: [
        makeIssue("save-version-newer", {
          message: `this save is game version ${from}; this build reads up to ${target}`,
          path: "/gameVersion",
          expected: String(target),
          got: String(from),
        }),
      ],
    };
  }
  if (from === target) return { ok: true, file };
  let data: SaveGameData = { persist: file.persist, game: file.data };
  for (let version = from; version < target; version++) {
    const step = Object.hasOwn(migrations, version) ? migrations[version] : undefined;
    if (!step) {
      return {
        ok: false,
        issues: [
          makeIssue("save-version-newer", {
            message: `no migration from ${version} to ${version + 1}`,
            path: "/gameVersion",
            detail: { from: version, to: version + 1 },
          }),
        ],
      };
    }
    try {
      data = step(data);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [migrationFailed(version, why)] };
    }
    const checked = z
      .strictObject({ persist: jsonValueSchema, game: jsonValueSchema })
      .safeParse(data);
    if (!checked.success)
      return {
        ok: false,
        issues: [migrationFailed(version, "it didn't return `{ persist, game }` as JSON")],
      };
  }
  return {
    ok: true,
    file: { ...file, gameVersion: target, persist: data.persist, data: data.game },
    migratedFrom: from,
  };
}

const migrationFailed = (version: number, why: string) =>
  makeIssue("schema", {
    message: `the game's save migration from ${version} to ${version + 1} failed: ${why}`,
    path: "/gameVersion",
    detail: { from: version, to: version + 1 },
  });

const positiveInt = (n: number | undefined): n is number =>
  n !== undefined && Number.isInteger(n) && n > 0;

function capLimits(limits: SaveLimits, cap: Partial<SaveLimits> | undefined): SaveLimits {
  return {
    maxBytes: positiveInt(cap?.maxBytes)
      ? Math.min(limits.maxBytes, cap.maxBytes)
      : limits.maxBytes,
    maxSlots: positiveInt(cap?.maxSlots)
      ? Math.min(limits.maxSlots, cap.maxSlots)
      : limits.maxSlots,
  };
}

/** min(the game's limits or the defaults, `MAX_BROWSER_SAVE_LIMITS` for a browser store, the store's own). */
export function effectiveSaveLimits(
  game: Pick<GameDefinition, "saves"> | null,
  store?: SaveLimitsStore,
): SaveLimits {
  const own = game?.saves?.limits;
  let limits: SaveLimits = {
    maxBytes: positiveInt(own?.maxBytes) ? own.maxBytes : DEFAULT_SAVE_LIMITS.maxBytes,
    maxSlots: positiveInt(own?.maxSlots) ? own.maxSlots : DEFAULT_SAVE_LIMITS.maxSlots,
  };
  if (store?.kind === "browser") limits = capLimits(limits, MAX_BROWSER_SAVE_LIMITS);
  return capLimits(limits, store?.limits);
}
