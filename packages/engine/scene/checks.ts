import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { ENGINE_CHECK_KINDS, type PlayersDef, type Registry } from "../game/types";
import { pxPerMetreOf, scaleLengths } from "../game/units";
import type { InputScript, InputScriptV2, UntilClause } from "../headless/playtest-types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { closest } from "./did-you-mean";
import {
  DEFAULT_SCRIPT_MAX_TICKS,
  INPUT_SCRIPT_VERSION,
  inputScriptSchemaFor,
  inputScriptSchemasFor,
  MAX_SCRIPT_TICKS,
  migrateInputScript,
  scriptSeatLimit,
  worldPointSchema,
} from "./input-script";
import { jsonPointer, lineAt, makeIssue, unitsRefusal } from "./issues";
import { schemaIdFor, toJsonSchema } from "./json-schema";
import { migrate, type MigrateEnv, type Migration } from "./migrate";
import { pointerLines } from "./parse";
import type { Pt, Ref } from "./types";

/** The `.checks.json` format version, the `v` every checks file carries. */
export const CHECKS_FORMAT_VERSION = 3;
/** A scene's checks sit beside it as `<scene>.checks.json`, outside the scene's hash. */
export const CHECKS_SUFFIX = ".checks.json";

/** `touches` defaults, the same as `fuzz`'s. */
export const DEFAULT_TOUCH_ROLLOUTS = 100;
export const MAX_TOUCH_ROLLOUTS = 10_000;
export const DEFAULT_TOUCH_SEED = 1;
export const DEFAULT_TOUCH_TICKS = 600;

type CheckHead = { id: string; kind: string; skip?: string };

/** No issues at or above `max` (default `error`) from `validateScene`, plus `validatePhysical` with `physical`. */
export type ValidCheck = CheckHead & {
  kind: "valid";
  physical?: boolean;
  max?: "error" | "warn";
};
/** An input script's playtest ends with `result` (and `expect` holds then); a blocked run fails. */
export type ReachesCheck = CheckHead & {
  kind: "reaches";
  /** Inline, or a path relative to the checks file; a parsed file's inline script is the current format. */
  script: InputScriptV2 | InputScript | string;
  result: string;
  /** Play from here, over the script's own `at`. */
  at?: Pt;
  /** Every key must hold on the run's last tick, judged as a script step's `until` is. */
  expect?: UntilClause;
};
/** Seeded fuzz rollouts touch `entity` in at least `atLeast` of them. */
export type TouchesCheck = CheckHead & {
  kind: "touches";
  entity: Ref;
  atLeast: number;
  rollouts?: number;
  seed?: string | number;
  ticks?: number;
};
/** A grid cell, `[col, row]`. */
export type CheckCell = [col: number, row: number];
/** An entity ref (its cell holds its geometry's centre) or a cell. */
export type CheckPlace = Ref | CheckCell;
/** A path on the scene's grid joins `from` to each of `to`; walls are the `blockedBy` types' cells. */
export type ConnectedCheck = CheckHead & {
  kind: "connected";
  from: CheckPlace;
  to: CheckPlace[];
  diagonals?: boolean;
  /** Entity types whose shapes wall cells off; default `["solid"]`, `[]` for none. */
  blockedBy?: string[];
};
/** The types a `connected` check walls with when it names none. */
export const DEFAULT_BLOCKED_BY: readonly string[] = ["solid"];
/** A game's kind (`<game>/<kind>`), with the fields its `arg` schema defines. */
export type GameCheck = CheckHead & { [field: string]: unknown };

export type SceneCheck = ValidCheck | ReachesCheck | TouchesCheck | ConnectedCheck | GameCheck;

export type ChecksFile = {
  $schema?: string;
  v: typeof CHECKS_FORMAT_VERSION;
  checks: SceneCheck[];
};

/** A problem in a checks file: a JSON Pointer into it, its line, and one sentence. */
export type ChecksIssue = {
  path: string;
  line?: number;
  message: string;
  expected?: string;
  got?: string;
  hint?: string;
};

export type ParseChecksResult =
  | { ok: true; file: ChecksFile }
  | { ok: false; issues: ChecksIssue[] };

/** `<dir>/<scene>.json` → `<dir>/<scene>.checks.json`. */
export function checksPathOf(sceneFile: string): string {
  return sceneFile.replace(/\.json$/, "") + CHECKS_SUFFIX;
}

/** A `reaches` check's `at`: world metres. */
const ReachesAtSchema = worldPointSchema();

/**
 * v1 → v2: lengths become metres. A `reaches` check's `at` and every
 * length field of a game check's `arg` (by its `meta.unit`) are divided by
 * the game's px per metre; nothing else changes. Inline scripts keep their
 * own format here; v2 → v3 lifts them.
 */
function checksV1ToV2(raw: unknown, env: MigrateEnv): unknown {
  const registry = env.registry;
  if (!registry) return unitsRefusal("checks");
  const ppm = pxPerMetreOf(registry);
  const doc = raw as Record<string, unknown>;
  const games = registry.game?.checks ?? {};
  const checks = Array.isArray(doc.checks)
    ? doc.checks.map((check) => {
        if (!isRecord(check)) return check;
        if (check.kind === "reaches") {
          const out = { ...check };
          if (check.at !== undefined) out.at = scaleLengths(check.at, ReachesAtSchema, ppm);
          if (check.expect !== undefined)
            out.expect = scaleLengths(check.expect, inputScriptSchemasFor(registry).until, ppm);
          return out;
        }
        const game = typeof check.kind === "string" ? games[check.kind] : undefined;
        return game ? scaleLengths(check, game.arg, ppm) : check;
      })
    : doc.checks;
  return { ...doc, v: 2, checks };
}

/**
 * v2 → v3: every inline script is lifted to the current input-script
 * format through the script migrations (its lengths in metres); scripts
 * given by path are files of their own and migrate when read.
 */
function checksV2ToV3(raw: unknown, env: MigrateEnv): unknown {
  const registry = env.registry;
  if (!registry) return unitsRefusal("checks");
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.checks)) return { ...doc, v: 3 };
  const checks: unknown[] = [];
  for (const [i, check] of doc.checks.entries()) {
    const script = isRecord(check) ? check.script : undefined;
    if (!isRecord(script) || !(typeof script.v === "number" && script.v < INPUT_SCRIPT_VERSION)) {
      checks.push(check);
      continue;
    }
    const lifted = migrateInputScript(script, registry);
    if (!lifted.ok) {
      const { path, message, expected, got, hint } = lifted.issue;
      return {
        refused: makeIssue("migration-unresolved", {
          message: `check ${JSON.stringify((check as Record<string, unknown>).id)}'s script: ${message}`,
          path: `${jsonPointer(["checks", i, "script"])}${path}`,
          ...(expected !== undefined && { expected }),
          ...(got !== undefined && { got }),
          ...(hint !== undefined && { hint }),
        }),
      };
    }
    checks.push({ ...(check as Record<string, unknown>), script: lifted.script });
  }
  return { ...doc, v: 3, checks };
}

/** `CHECKS_MIGRATIONS[n]` lifts a v`n` checks file to v`n + 1`; every reader goes through them. */
export const CHECKS_MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: checksV1ToV2,
  2: checksV2ToV3,
});

const head = (kind: z.ZodType) => ({
  id: z
    .string()
    .regex(ID_PATTERN)
    .describe("Names the check in reports and `check --only`; unique in the file, an id pattern."),
  kind,
  skip: z
    .string()
    .min(1)
    .optional()
    .describe("Why the check is off for now; it is reported as skipped, not run."),
});

function buildChecksSchemas(registry: Registry, strictScript: boolean, players?: PlayersDef) {
  const results = registry.runResults as [string, ...string[]];
  const script = strictScript
    ? z.union([
        z.string().min(1).describe("A script file, relative to the checks file."),
        inputScriptSchemaFor(registry, players),
      ])
    : z.union([z.string().min(1), z.record(z.string(), z.unknown())]);

  const kinds: Record<string, z.ZodType> = {
    valid: z
      .strictObject({
        ...head(z.literal("valid").describe("The scene validates.")),
        physical: z
          .boolean()
          .optional()
          .describe("Also run the physical checks (`validate --physical`)."),
        max: z
          .enum(["error", "warn"])
          .optional()
          .describe("Fail on issues at this severity or above; default `error`."),
      })
      .describe("Passes when the scene has no issues at or above `max`."),
    reaches: z
      .strictObject({
        ...head(z.literal("reaches").describe("A playtest ends with a given result.")),
        script: script.describe("The input script: inline, or a file relative to the checks file."),
        result: z
          .enum(results)
          .describe(`The run result the playtest must end with: ${results.join(", ")}.`),
        at: ReachesAtSchema.optional().describe(
          "Play from here, in world metres, over the script's own `at`.",
        ),
        expect: inputScriptSchemasFor(registry)
          .until.optional()
          .describe(
            "Conditions that must all hold on the run's last tick, keyed as a script step's `until` (`event`, `tick`, `exists`, `count`, `near` and the game's predicates); the verdict names the first that fails.",
          ),
      })
      .describe(
        `Passes when the script's playtest ends with \`result\` and every key of \`expect\` holds on its last tick; a blocked run fails. Runs time out after the script's \`maxTicks\` (default ${DEFAULT_SCRIPT_MAX_TICKS}).`,
      ),
    touches: z
      .strictObject({
        ...head(z.literal("touches").describe("Fuzz rollouts touch an entity.")),
        entity: z.string().min(1).describe("The entity's id, or a bulk reference `~key:index`."),
        atLeast: z
          .number()
          .int()
          .min(1)
          .describe("How many rollouts must touch it (an event names it)."),
        rollouts: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOUCH_ROLLOUTS)
          .optional()
          .describe(`Rollouts to run; default ${DEFAULT_TOUCH_ROLLOUTS}.`),
        seed: z
          .union([z.number().int(), z.string().min(1)])
          .optional()
          .describe(`The fuzz seed; default ${DEFAULT_TOUCH_SEED}.`),
        ticks: z
          .number()
          .int()
          .min(1)
          .max(MAX_SCRIPT_TICKS)
          .optional()
          .describe(`Ticks per rollout; default ${DEFAULT_TOUCH_TICKS}.`),
      })
      .refine((c) => c.atLeast <= (c.rollouts ?? DEFAULT_TOUCH_ROLLOUTS), {
        message: "atLeast can't be more than the rollouts",
        path: ["atLeast"],
      })
      .describe("Passes when at least `atLeast` seeded fuzz rollouts touch `entity`."),
  };

  const typeNames = [...registry.types.keys()] as [string, ...string[]];
  const place = z.union([
    z.string().min(1).describe("An entity's id, or a bulk reference `~key:index`."),
    z
      .tuple([z.number().int().describe("Column."), z.number().int().describe("Row.")])
      .describe("A grid cell, `[col, row]`."),
  ]);
  kinds.connected = z
    .strictObject({
      ...head(z.literal("connected").describe("A grid path joins two places.")),
      from: place.describe(
        "Where paths start: an entity (the cell holding its geometry's centre) or a `[col, row]` cell.",
      ),
      to: z
        .array(place)
        .min(1)
        .describe("The places each path must reach, as entities or `[col, row]` cells."),
      diagonals: z
        .boolean()
        .optional()
        .describe("Square grids: also step diagonally, never past a wall's corner; default false."),
      blockedBy: z
        .array(z.enum(typeNames))
        .optional()
        .describe(
          `Entity types whose shapes wall off the cells whose centres they hold; default ${JSON.stringify(DEFAULT_BLOCKED_BY)}, [] for none.`,
        ),
    })
    .describe(
      "Passes when a path on the scene's grid reaches every `to` from `from`; needs `settings.grid`, and no physics.",
    );

  for (const [kind, def] of Object.entries(registry.game?.checks ?? {})) {
    const own = head(z.literal(kind).describe(def.description));
    kinds[kind] = (
      def.arg instanceof z.ZodObject ? def.arg.extend(own) : z.intersection(z.object(own), def.arg)
    ).describe(def.description);
  }

  const options = Object.values(kinds) as [z.ZodType, ...z.ZodType[]];
  const file = z
    .strictObject({
      $schema: z.string().optional().describe("The checks JSON Schema this file follows."),
      v: z.literal(CHECKS_FORMAT_VERSION).describe("Checks format version."),
      checks: z
        .array(z.union(options).describe("One check; `kind` picks its fields."))
        .describe("The checks, run in order."),
    })
    .describe(
      "Checks for the scene beside this file (`<scene>.checks.json`), run by `vp run scene check`. " +
        `Kinds: ${registry.checkKinds.join(", ")}.`,
    );
  const headOnly = z.strictObject({
    $schema: z.string().optional(),
    v: z.literal(CHECKS_FORMAT_VERSION),
    checks: z.array(z.unknown()),
  });
  return { file, kinds, headOnly };
}

type ChecksSchemas = ReturnType<typeof buildChecksSchemas>;

const built = new WeakMap<
  Registry,
  { strict: Map<number, ChecksSchemas>; loose: ChecksSchemas | undefined }
>();

/**
 * The checks schemas for `registry`, built once per registry and, for the
 * strict ones that judge inline scripts in full, once per seat limit.
 */
function schemasFor(
  registry: Registry,
  strict: boolean,
  players?: PlayersDef | null,
): ChecksSchemas {
  let cached = built.get(registry);
  if (!cached) {
    cached = { strict: new Map(), loose: undefined };
    built.set(registry, cached);
  }
  if (!strict) return (cached.loose ??= buildChecksSchemas(registry, false));
  const seats = scriptSeatLimit(registry, players);
  let schemas = cached.strict.get(seats);
  if (!schemas) {
    schemas = buildChecksSchemas(registry, true, players ?? undefined);
    cached.strict.set(seats, schemas);
  }
  return schemas;
}

/**
 * The checks-file schema for `registry`: the engine's kinds and the game's.
 * An inline script's seats are judged by `players` (the project input map's,
 * `kindInputMap`) over the game's, as the playtest that runs it judges them.
 */
export function checksSchemaFor(
  registry: Registry,
  players?: PlayersDef | null,
): z.ZodType<ChecksFile> {
  return schemasFor(registry, true, players).file as unknown as z.ZodType<ChecksFile>;
}

/** `urn:jams-engine:checks:v3`, or `urn:jams-engine:checks:<game>:v3`. */
export function checksSchemaId(registry: Registry): string {
  return schemaIdFor(registry, "checks", CHECKS_FORMAT_VERSION);
}

/** The draft 2020-12 JSON Schema of checks files for `registry`. */
export function checksJsonSchema(registry: Registry): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(schemasFor(registry, true).file);
  const of = registry.game ? ` for ${registry.id}` : "";
  return {
    $schema,
    $id: checksSchemaId(registry),
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine scene checks${of}, format v${CHECKS_FORMAT_VERSION}`,
    ...rest,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function zodIssues(error: z.ZodError, base: (string | number)[]): ChecksIssue[] {
  return error.issues.flatMap((issue): ChecksIssue[] => {
    const path = [...base, ...(issue.path as (string | number)[])];
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: jsonPointer([...path, key]),
        message: `unknown key ${JSON.stringify(key)}`,
        got: JSON.stringify(key),
      }));
    }
    return [{ path: jsonPointer(path), message: issue.message }];
  });
}

/**
 * Parses a `.checks.json` file for `registry`: the header, then each check
 * by its `kind`, so a mistake is reported against the fields it was meant
 * to have. Ids must be unique. An inline input script is only checked to be
 * an object here; the playtest compiles it. A `reaches` check's `expect`
 * keeps the order it was written in, so a verdict names the first key that
 * fails. Issues carry lines.
 */
export function parseChecks(text: string, registry: Registry): ParseChecksResult {
  let raw: unknown;
  let lines: Map<string, number> | undefined;
  try {
    raw = JSON.parse(text);
    lines = pointerLines(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ path: "", message: `the checks file is not JSON: ${message}` }],
    };
  }

  const { kinds, headOnly } = schemasFor(registry, false);
  const issues: ChecksIssue[] = [];
  const checks: SceneCheck[] = [];
  if (isRecord(raw) && typeof raw.v === "number" && raw.v < CHECKS_FORMAT_VERSION) {
    const lifted = migrate(raw, CHECKS_MIGRATIONS, CHECKS_FORMAT_VERSION, { registry });
    if (!lifted.ok) {
      const { path = "", message, expected, got, hint } = lifted.issue;
      const issue: ChecksIssue = { path, message, expected, got, hint };
      for (const key of ["expected", "got", "hint"] as const)
        if (issue[key] === undefined) delete issue[key];
      return { ok: false, issues: [issue] };
    }
    raw = lifted.raw;
  }
  const parsedHead = headOnly.safeParse(raw);
  if (!parsedHead.success) issues.push(...zodIssues(parsedHead.error, []));
  else {
    const seen = new Set<string>();
    parsedHead.data.checks.forEach((check, i) => {
      if (!isRecord(check) || typeof check.kind !== "string") {
        issues.push({
          path: jsonPointer(["checks", i, ...(isRecord(check) ? ["kind"] : [])]),
          message: "a check needs a string `kind`",
          expected: registry.checkKinds.map((k) => JSON.stringify(k)).join(" | "),
        });
        return;
      }
      const schema = kinds[check.kind];
      if (!schema) {
        const guess = closest(check.kind, registry.checkKinds);
        issues.push({
          path: jsonPointer(["checks", i, "kind"]),
          message: `unknown check kind ${JSON.stringify(check.kind)}${guess ? `; did you mean "${guess}"?` : ""}`,
          expected: registry.checkKinds.map((k) => JSON.stringify(k)).join(" | "),
          got: JSON.stringify(check.kind),
          hint: (ENGINE_CHECK_KINDS as readonly string[]).includes(check.kind)
            ? undefined
            : "A game's kinds are `<game>/<kind>` and need its registry: pass `--game` for a scene without a `game` key.",
        });
        return;
      }
      const parsed = schema.safeParse(check);
      if (!parsed.success) {
        issues.push(...zodIssues(parsed.error, ["checks", i]));
        return;
      }
      const value = parsed.data as SceneCheck;
      if (value.kind === "reaches" && isRecord(check.expect)) {
        const out = (value as ReachesCheck).expect as Record<string, unknown>;
        (value as ReachesCheck).expect = Object.fromEntries(
          Object.keys(check.expect).map((key) => [key, out[key]]),
        );
      }
      if (seen.has(value.id)) {
        issues.push({
          path: jsonPointer(["checks", i, "id"]),
          message: `two checks have the id ${JSON.stringify(value.id)}`,
          hint: `Give the later one a new id, e.g. "${value.id}-2".`,
        });
        return;
      }
      seen.add(value.id);
      checks.push(value);
    });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues: issues.map((issue) => {
        const line = lines && lineAt(lines, issue.path);
        const out = line === undefined ? issue : { ...issue, line };
        if (out.hint === undefined) delete out.hint;
        return out;
      }),
    };
  }
  const { $schema, v } = parsedHead.data!;
  return { ok: true, file: { ...($schema !== undefined && { $schema }), v, checks } };
}
