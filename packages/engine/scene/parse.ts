import { z } from "zod";

import { isSpawnOnly, placeableTypes } from "../game/define";
import { gridFieldInfo, ID_PATTERN } from "../game/fields";
import type { Registry } from "../game/types";
import { closest } from "./did-you-mean";
import { bulkId } from "./expand";
import { withoutEmptyMaps } from "./format";
import { GRID_MAX_VALUE, gridProblems } from "./grid";
import { jsonPointer, lineAt, makeIssue } from "./issues";
import { migrate, type MigrateEnv } from "./migrate";
import {
  entitySchemaFor,
  fieldKind,
  sceneGameOf,
  sceneRegistry,
  sceneSchemaFor,
  spawnOnlyHint,
  spawnSchemaFor,
  spawnOnlyMessage,
  unknownGameIssue,
  unwrapSchema,
} from "./schema";
import {
  SCENE_FORMAT_VERSION,
  type EntityTypeName,
  type SceneDefinition,
  type SceneIssue,
} from "./types";

// ─── JSON positions ──────────────────────────────────────

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * Maps every JSON Pointer in `text` to the 1-based line its value starts on
 * (for object members, the line of the key). Throws `JsonSyntaxError` with
 * the offending offset on malformed JSON.
 */
export function pointerLines(text: string): Map<string, number> {
  const lines = new Map<string, number>();
  let i = 0;
  let line = 1;

  const ws = () => {
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\n") line++;
      else if (c !== " " && c !== "\t" && c !== "\r") break;
    }
  };
  const expect = (c: string) => {
    if (text[i] !== c)
      throw new JsonSyntaxError(
        `expected '${c}'${i < text.length ? ` but found '${text[i]}'` : " but the text ended"}`,
        i,
      );
    i++;
  };
  const str = (): string => {
    const start = i;
    expect('"');
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") i++;
      else if (c === '"') {
        i++;
        return JSON.parse(text.slice(start, i)) as string;
      } else if (c === "\n") throw new JsonSyntaxError("unterminated string", i);
    }
    throw new JsonSyntaxError("unterminated string", start);
  };
  const value = (pointer: string, recordAt?: number) => {
    ws();
    lines.set(pointer, recordAt ?? line);
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        const keyLine = line;
        const key = str();
        ws();
        expect(":");
        value(`${pointer}${jsonPointer([key])}`, keyLine);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("}");
        return;
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        value(`${pointer}/${n}`);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("]");
        return;
      }
    }
    if (c === '"') {
      str();
      return;
    }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
      text.slice(i, i + 64),
    );
    if (!m)
      throw new JsonSyntaxError(
        i < text.length ? `unexpected '${c}'` : "unexpected end of text",
        i,
      );
    i += m[0].length;
  };

  value("");
  ws();
  if (i < text.length) throw new JsonSyntaxError(`unexpected '${text[i]}' after the document`, i);
  return lines;
}

/** The 1-based line of `pointer` (or its nearest ancestor) in `text`. */
export function locatePointer(text: string, pointer: string): number | undefined {
  try {
    return lineAt(pointerLines(text), pointer);
  } catch {
    return undefined;
  }
}

function lineOfOffset(text: string, offset: number): number {
  let n = 1;
  for (let k = 0; k < offset && k < text.length; k++) if (text[k] === "\n") n++;
  return n;
}

function syntaxIssue(text: string, error: unknown): SceneIssue {
  let offset: number | undefined;
  let detail = error instanceof Error ? error.message : String(error);
  try {
    pointerLines(text);
  } catch (e) {
    if (e instanceof JsonSyntaxError) {
      offset = e.offset;
      detail = e.message;
    }
  }
  if (offset === undefined) {
    const m = /position (\d+)/.exec(detail);
    if (m) offset = Number(m[1]);
  }
  const line = offset === undefined ? undefined : lineOfOffset(text, offset);
  return makeIssue("schema", {
    message: `the scene isn't valid JSON: ${detail}${line ? ` (line ${line})` : ""}`,
    path: "",
    line,
    hint: "Fix the JSON syntax at that line; trailing commas and comments aren't allowed.",
  });
}

// ─── Zod issues to SceneIssue ────────────────────────────

/** The placeable type nearest to `word`, for "did you mean"; never a spawn-only type. */
export function suggestType(word: string, registry: Registry): EntityTypeName | undefined {
  return closest(word, placeableTypes(registry));
}

type MapContext = {
  raw: unknown;
  registry: Registry;
  scene: () => z.ZodObject;
  /** One entity's schema by its type; `entitySchemaFor` unless the entity is a spawn input. */
  entity?: (type: string) => z.ZodObject | undefined;
  /** Grid fields already reported, by pointer: one field's problems are reported together. */
  grids?: Set<string>;
};

function at(raw: unknown, segments: readonly PropertyKey[]): unknown {
  let cur = raw;
  for (const s of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[s];
  }
  return cur;
}

function describe(v: unknown): string {
  if (v === undefined) return "missing";
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return typeof v === "string" ? JSON.stringify(v) : typeof v;
}

const unwrap = (schema: z.core.$ZodType | undefined) => schema && unwrapSchema(schema);

function schemaAt(
  schema: z.core.$ZodType | undefined,
  segments: readonly PropertyKey[],
): z.core.$ZodType | undefined {
  let s = unwrap(schema);
  for (const seg of segments) {
    if (s instanceof z.ZodObject) s = s.shape[seg as string];
    else if (s instanceof z.ZodArray) s = s.element;
    else if (s instanceof z.ZodTuple) s = s.def.items[seg as number];
    else return undefined;
    s = unwrap(s);
  }
  return s;
}

const entitySchemaOf = (ctx: MapContext, type: string) =>
  ctx.entity ? ctx.entity(type) : entitySchemaFor(ctx.registry, type);

function knownKeysAt(ctx: MapContext, segments: readonly PropertyKey[]): readonly string[] {
  let target: z.core.$ZodType | undefined;
  if (segments[0] === "entities" && typeof segments[1] === "number") {
    const type = at(ctx.raw, [...segments.slice(0, 2), "type"]);
    const schema = typeof type === "string" ? entitySchemaOf(ctx, type) : undefined;
    target = schemaAt(schema, segments.slice(2));
  } else {
    target = schemaAt(ctx.scene(), segments);
  }
  return target instanceof z.ZodObject ? Object.keys(target.shape) : [];
}

function entityIdsAt(ctx: MapContext, segments: readonly PropertyKey[]): string[] {
  if (typeof segments[1] !== "number") return [];
  if (typeof segments[0] === "string" && ctx.registry.bulkKey(segments[0]))
    return [bulkId(segments[0], segments[1])];
  if (segments[0] !== "entities") return [];
  const id = at(ctx.raw, ["entities", segments[1], "id"]);
  return typeof id === "string" ? [id] : [];
}

const isEntity = (segments: readonly PropertyKey[]) =>
  segments.length === 2 && segments[0] === "entities" && typeof segments[1] === "number";

function unknownType(
  ctx: MapContext,
  segments: readonly PropertyKey[],
  entityIds: string[],
): SceneIssue {
  const entityPath = segments.slice(0, -1);
  const got = at(ctx.raw, segments);
  const legacy = got === undefined ? at(ctx.raw, [...entityPath, "b"]) : undefined;
  const names = placeableTypes(ctx.registry);
  const word = typeof got === "string" ? got : typeof legacy === "string" ? legacy : undefined;
  const suggestion = word === undefined ? undefined : suggestType(word, ctx.registry);
  const expected = names.join(" | ");
  if (legacy !== undefined) {
    const path = jsonPointer([...(entityPath as (string | number)[]), "b"]);
    return makeIssue("unknown-type", {
      message: `the entity at ${jsonPointer(entityPath as (string | number)[])} has "b" but no "type"; the discriminator is now "type"`,
      path,
      entityIds,
      expected,
      got: `b: ${describe(legacy)}`,
      hint: `Rename "b" to "type"${suggestion && suggestion !== legacy ? ` and use "${suggestion}"` : ""}.`,
    });
  }
  const path = jsonPointer(segments as (string | number)[]);
  if (typeof got === "string" && isSpawnOnly(ctx.registry, got))
    return makeIssue("unknown-type", {
      message: `${spawnOnlyMessage(got)} (${path})`,
      path,
      entityIds,
      expected,
      got: describe(got),
      hint: spawnOnlyHint(ctx.registry),
    });
  return makeIssue("unknown-type", {
    message: `unknown type ${describe(got)} at ${path}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
    path,
    entityIds,
    expected,
    got: describe(got),
    hint: suggestion
      ? `Use type: "${suggestion}".`
      : `type is one of ${names.join(", ")}; a game's own types need the scene's top-level "game" key.`,
  });
}

function badIdHint(got: unknown): string | undefined {
  if (typeof got !== "string") return undefined;
  const slug =
    got
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 48) || "entity";
  return `Try "${slug}".`;
}

/** The grid field of an entity that `segments` points into, with the largest value it takes. */
function gridFieldAt(
  ctx: MapContext,
  segments: readonly PropertyKey[],
): { field: (string | number)[]; max: number } | undefined {
  const [entities, index, field] = segments;
  if (entities !== "entities" || typeof index !== "number" || typeof field !== "string") return;
  const type = at(ctx.raw, ["entities", index, "type"]);
  const schema = typeof type === "string" ? entitySchemaOf(ctx, type) : undefined;
  const fieldSchema = schema?.shape[field] as z.core.$ZodType | undefined;
  if (!fieldSchema || fieldKind(fieldSchema) !== "grid") return;
  const max = gridFieldInfo(fieldSchema)?.max ?? GRID_MAX_VALUE;
  return { field: ["entities", index, field], max };
}

/** Every problem with one grid field, as `grid-invalid`; once per field however many Zod issues it raised. */
function gridIssues(
  issue: z.core.$ZodIssue,
  grid: { field: (string | number)[]; max: number },
  ctx: MapContext,
  entityIds: string[],
): SceneIssue[] {
  const fieldPath = jsonPointer(grid.field);
  ctx.grids ??= new Set();
  if (ctx.grids.has(fieldPath)) return [];
  ctx.grids.add(fieldPath);
  const owner = entityIds.length ? ` on ${entityIds[0]}` : "";
  const problems = gridProblems(at(ctx.raw, grid.field), grid.max);
  const found = problems.length
    ? problems
    : [
        {
          path: issue.path.slice(grid.field.length) as (string | number)[],
          message: issue.message,
        },
      ];
  return found.map((p) => {
    const path = jsonPointer([...grid.field, ...p.path]);
    return makeIssue("grid-invalid", {
      message: `${p.message}${owner} (${path})`,
      path,
      entityIds,
      got: "got" in p ? p.got : undefined,
    });
  });
}

function mapZodIssue(issue: z.core.$ZodIssue, ctx: MapContext): SceneIssue[] {
  const segments = issue.path;
  const path = jsonPointer(segments as (string | number)[]);
  const entityIds = entityIdsAt(ctx, segments);
  const where = path || "the document";

  const grid = gridFieldAt(ctx, segments);
  if (grid && segments.length > grid.field.length) return gridIssues(issue, grid, ctx, entityIds);
  if (grid && issue.code === "custom" && issue.params?.sceneCode === "grid-invalid")
    return gridIssues(issue, grid, ctx, entityIds);

  if (issue.code === "unrecognized_keys") {
    const known = knownKeysAt(ctx, segments);
    return issue.keys.map((key) => {
      const legacy = key === "b" && isEntity(segments);
      const suggestion = legacy ? undefined : closest(key, known);
      return makeIssue("unknown-key", {
        message: `unknown key "${key}" at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
        path: `${path}${jsonPointer([key])}`,
        entityIds,
        got: key,
        expected: known.length ? known.join(", ") : undefined,
        hint: legacy
          ? 'The discriminator is now "type"; remove "b".'
          : suggestion
            ? `Rename "${key}" to "${suggestion}".`
            : undefined,
      });
    });
  }

  if (
    issue.code === "invalid_union" &&
    "discriminator" in issue &&
    issue.discriminator === "type"
  ) {
    return [unknownType(ctx, segments, entityIds)];
  }

  if (issue.code === "custom" && issue.params?.sceneCode === "bad-shape") {
    const p = issue.params as { expected?: string; got?: string; hint?: string };
    const owner = entityIds.length ? ` on ${entityIds[0]}` : "";
    return [
      makeIssue("bad-shape", {
        message: `${issue.message}${owner} (${path})`,
        path,
        entityIds,
        expected: p.expected,
        got: p.got,
        hint: p.hint,
      }),
    ];
  }

  if (
    issue.code === "invalid_format" &&
    issue.format === "regex" &&
    "pattern" in issue &&
    issue.pattern === String(ID_PATTERN)
  ) {
    const last = segments[segments.length - 1];
    const got = at(ctx.raw, segments);
    return [
      makeIssue("bad-id", {
        message: `${typeof last === "string" ? `${last} ` : ""}${describe(got)} at ${path} must match ${ID_PATTERN.source}`,
        path,
        entityIds,
        expected: ID_PATTERN.source,
        got: describe(got),
        hint: badIdHint(got),
      }),
    ];
  }

  const got = at(ctx.raw, segments);
  const expected =
    "expected" in issue && typeof issue.expected === "string" ? issue.expected : undefined;
  return [
    makeIssue("schema", {
      message: `${where}: ${issue.message}`,
      path,
      entityIds,
      expected,
      got: describe(got),
    }),
  ];
}

const ENTITY_POINTER = /\/entities\/0((?:\/[^\s;:,)"]+)*)/g;

/**
 * Maps a schema failure of one entity checked on its own, as `parseScene`
 * would map it inside a document (did-you-mean for keys and types,
 * `expected` and `got`), with each pointer moved by `relocate` from the
 * entity-relative form (`""`, `/path/speed`). With `spawn`, `def` is a
 * `ctx.spawn` input judged by `spawnSchemaFor`.
 */
export function entityIssues(
  issues: readonly z.core.$ZodIssue[],
  def: unknown,
  relocate: (rel: string) => string,
  registry: Registry,
  opts: { spawn?: boolean } = {},
): SceneIssue[] {
  const ctx: MapContext = {
    raw: { entities: [def] },
    registry,
    scene: () => sceneSchemaFor(registry),
    ...(opts.spawn ? { entity: (type: string) => spawnSchemaFor(registry, type) } : {}),
  };
  const move = (text: string) => text.replace(ENTITY_POINTER, (_, rel: string) => relocate(rel));
  return issues.flatMap((issue) =>
    mapZodIssue({ ...issue, path: ["entities", 0, ...issue.path] } as z.core.$ZodIssue, ctx).map(
      (i) => ({
        ...i,
        message: move(i.message),
        path: i.path === undefined ? undefined : move(i.path),
      }),
    ),
  );
}

// ─── parseScene ──────────────────────────────────────────

export type ParseSceneResult =
  | { ok: true; def: SceneDefinition; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

/**
 * A scene without an empty `settings` and without its rows' empty nested
 * maps, so it reads as its canonical text does.
 */
function withoutEmptyRowMaps(def: SceneDefinition): SceneDefinition {
  const out: SceneDefinition = {
    ...def,
    ...(def.entities ? { entities: def.entities.map(withoutEmptyMaps) } : {}),
    ...(def.instances ? { instances: def.instances.map(withoutEmptyMaps) } : {}),
  };
  if (def.settings && Object.keys(def.settings).length === 0) delete out.settings;
  return out;
}

/** What the scene, prefab and fragment parsers take beside the registry. */
export type ParseOptions = { prefab?: MigrateEnv["prefab"] };

/** The migration env a parse passes: its registry and prefab lookup. */
export function migrateEnvOf(registry: Registry, opts: ParseOptions): MigrateEnv {
  return opts.prefab ? { registry, prefab: opts.prefab } : { registry };
}

/**
 * Parses a scene from JSON text or an already-parsed value: migrate, pick
 * the registry from the scene's `game` (`sceneRegistry`), then that
 * registry's schema. Never throws; every failure is a `SceneIssue` with a
 * JSON Pointer `path`, plus `line` when the input was text. Structural
 * checks (duplicate ids, geometry) are `validateScene`'s. `opts.prefab`
 * looks up the prefabs instances name, for migrations that need them.
 */
export function parseScene(
  input: unknown,
  registry: Registry,
  opts: ParseOptions = {},
): ParseSceneResult {
  let raw = input;
  let text: string | undefined;
  if (typeof input === "string") {
    text = input;
    try {
      raw = JSON.parse(input);
    } catch (error) {
      return { ok: false, issues: [syntaxIssue(input, error)] };
    }
  }
  let lines: Map<string, number> | undefined;
  const withLine = (issue: SceneIssue): SceneIssue => {
    if (text === undefined || issue.path === undefined || issue.line !== undefined) return issue;
    lines ??= pointerLines(text);
    const line = lineAt(lines, issue.path);
    return line === undefined ? issue : { ...issue, line };
  };

  const migrated = migrate(raw, undefined, undefined, migrateEnvOf(registry, opts));
  if (!migrated.ok) return { ok: false, issues: [withLine(migrated.issue)] };

  const declared = (migrated.raw as Record<string, unknown>).game;
  if (declared !== undefined && typeof declared !== "string") {
    const issue = makeIssue("schema", {
      message: `/game: expected a game id string; got ${describe(declared)}`,
      path: "/game",
      expected: "string",
      got: describe(declared),
    });
    return { ok: false, issues: [withLine(issue)] };
  }
  const game = sceneGameOf(migrated.raw);
  const judge = sceneRegistry(game, registry);
  if (!judge) return { ok: false, issues: [withLine(unknownGameIssue(game!, registry))] };

  let schema: z.ZodObject | undefined;
  const scene = () => (schema ??= sceneSchemaFor(judge));
  const result = scene().safeParse(migrated.raw);
  if (!result.success) {
    const ctx: MapContext = { raw: migrated.raw, registry: judge, scene };
    const issues = result.error.issues.flatMap((i) => mapZodIssue(i, ctx)).map(withLine);
    return { ok: false, issues };
  }
  const def = withoutEmptyRowMaps(result.data as SceneDefinition);
  return migrated.from === SCENE_FORMAT_VERSION
    ? { ok: true, def, issues: [] }
    : { ok: true, def, migratedFrom: migrated.from, issues: [] };
}

export class SceneParseError extends Error {
  constructor(readonly issues: SceneIssue[]) {
    super(
      issues.length === 1
        ? `scene failed to parse: ${issues[0]!.message}`
        : `scene failed to parse with ${issues.length} issues; first: ${issues[0]?.message ?? "unknown"}`,
    );
    this.name = "SceneParseError";
  }
}

export class SceneVersionError extends SceneParseError {
  constructor(issues: SceneIssue[]) {
    super(issues);
    this.name = "SceneVersionError";
    this.message = issues[0]?.message ?? "scene format is newer than this engine";
  }
}

export function parseSceneOrThrow(
  input: unknown,
  registry: Registry,
  opts: ParseOptions = {},
): SceneDefinition {
  const result = parseScene(input, registry, opts);
  if (result.ok) return result.def;
  if (result.issues.some((i) => i.code === "version-newer"))
    throw new SceneVersionError(result.issues);
  throw new SceneParseError(result.issues);
}
