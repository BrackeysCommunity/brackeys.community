import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { ENGINE_CHECK_KINDS, type Registry } from "../game/types";
import type { InputScript, UntilClause } from "../headless/playtest-types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "./agent-surface";
import { closest } from "./did-you-mean";
import {
  DEFAULT_SCRIPT_MAX_TICKS,
  inputScriptSchemaFor,
  inputScriptSchemasFor,
  MAX_SCRIPT_TICKS,
} from "./input-script";
import { jsonPointer, lineAt } from "./issues";
import { schemaIdFor, toJsonSchema } from "./json-schema";
import { pointerLines } from "./parse";
import type { Pt, Ref } from "./types";

/** The `.checks.json` format version, the `v` every checks file carries. */
export const CHECKS_FORMAT_VERSION = 1;
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
  /** Inline, or a path relative to the checks file. */
  script: InputScript | string;
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

export type ChecksFile = { $schema?: string; v: 1; checks: SceneCheck[] };

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

function buildChecksSchemas(registry: Registry, strictScript: boolean) {
  const results = registry.runResults as [string, ...string[]];
  const script = strictScript
    ? z.union([
        z.string().min(1).describe("A script file, relative to the checks file."),
        inputScriptSchemaFor(registry),
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
        at: z
          .tuple([
            z.number().describe("x in world pixels."),
            z.number().describe("y in world pixels; y is down."),
          ])
          .optional()
          .describe("Play from here, over the script's own `at`."),
        expect: inputScriptSchemasFor(registry)
          .until.optional()
          .describe(
            "Conditions that must all hold on the run's last tick, keyed as a script step's `until` (`event`, `tick`, `exists`, `count` and the game's predicates); the verdict names the first that fails.",
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

const built = new WeakMap<Registry, { strict: ChecksSchemas; loose: ChecksSchemas }>();

function schemasFor(registry: Registry, strict: boolean): ChecksSchemas {
  let pair = built.get(registry);
  if (!pair) {
    pair = {
      strict: buildChecksSchemas(registry, true),
      loose: buildChecksSchemas(registry, false),
    };
    built.set(registry, pair);
  }
  return strict ? pair.strict : pair.loose;
}

/** The checks-file schema for `registry`: the engine's kinds and the game's. */
export function checksSchemaFor(registry: Registry): z.ZodType<ChecksFile> {
  return schemasFor(registry, true).file as unknown as z.ZodType<ChecksFile>;
}

/** `urn:jams-engine:checks:v1`, or `urn:jams-engine:checks:<game>:v1`. */
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
