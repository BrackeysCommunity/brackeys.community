import type { z } from "zod";

import { closest } from "./did-you-mean";
import { bulkId } from "./expand";
import { jsonPointer, lineAt, makeIssue } from "./issues";
import { migrate } from "./migrate";
import { SCENE_KEYS, SceneV1, entitySchemaFor } from "./schema";
import {
  BEHAVIORS,
  BULK_KEYS,
  SCENE_FORMAT_VERSION,
  type Behavior,
  type BulkKey,
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

const B_ALIASES: Record<string, Behavior> = {
  platform: "mover",
  "moving-platform": "mover",
  moving_platform: "mover",
  ground: "solid",
  wall: "solid",
  static: "solid",
  oneway: "cloud",
  "one-way": "cloud",
  trigger: "sensor",
  goal: "sensor",
  hazard: "sensor",
  dynamic: "prop",
  grapple: "anchor",
  comment: "note",
};

export function suggestBehavior(word: string): Behavior | undefined {
  const hit = closest(word, [...BEHAVIORS, ...Object.keys(B_ALIASES)]);
  if (hit === undefined) return undefined;
  return (BEHAVIORS as readonly string[]).includes(hit) ? (hit as Behavior) : B_ALIASES[hit];
}

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

function knownKeysAt(raw: unknown, segments: readonly PropertyKey[]): readonly string[] {
  if (segments.length === 0) return SCENE_KEYS;
  if (segments.length === 2 && segments[0] === "entities") {
    const b = at(raw, [...segments, "b"]);
    if (typeof b === "string" && (BEHAVIORS as readonly string[]).includes(b)) {
      return Object.keys(entitySchemaFor(b as Behavior).shape);
    }
  }
  if (segments.length === 3 && segments[0] === "entities" && segments[2] === "path") {
    return ["pts", "mode", "speed", "pauseMs"];
  }
  return [];
}

function entityIdsAt(raw: unknown, segments: readonly PropertyKey[]): string[] {
  if (typeof segments[1] !== "number") return [];
  if ((BULK_KEYS as readonly PropertyKey[]).includes(segments[0]))
    return [bulkId(segments[0] as BulkKey, segments[1])];
  if (segments[0] !== "entities") return [];
  const id = at(raw, ["entities", segments[1], "id"]);
  return typeof id === "string" ? [id] : [];
}

function mapZodIssue(issue: z.core.$ZodIssue, raw: unknown): SceneIssue[] {
  const segments = issue.path;
  const path = jsonPointer(segments as (string | number)[]);
  const entityIds = entityIdsAt(raw, segments);
  const where = path || "the document";

  if (issue.code === "unrecognized_keys") {
    const known = knownKeysAt(raw, segments);
    return issue.keys.map((key) => {
      const suggestion = closest(key, known);
      return makeIssue("unknown-key", {
        message: `unknown key "${key}" at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
        path: `${path}${jsonPointer([key])}`,
        entityIds,
        got: key,
        expected: known.length ? known.join(", ") : undefined,
        hint: suggestion ? `Rename "${key}" to "${suggestion}".` : undefined,
      });
    });
  }

  if (issue.code === "invalid_union" && "discriminator" in issue && issue.discriminator === "b") {
    const got = at(raw, segments);
    const suggestion = typeof got === "string" ? suggestBehavior(got) : undefined;
    return [
      makeIssue("schema", {
        message: `unknown behavior b: ${describe(got)} at ${path}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
        path,
        entityIds,
        expected: BEHAVIORS.join(" | "),
        got: describe(got),
        hint: suggestion
          ? `Use b: "${suggestion}"${suggestion === "mover" ? ' (a static platform is "solid")' : ""}.`
          : `b is one of ${BEHAVIORS.join(", ")}.`,
      }),
    ];
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

  const last = segments[segments.length - 1];
  if (
    issue.code === "invalid_format" &&
    (last === "id" || last === "group" || (segments.length === 1 && last === "name"))
  ) {
    const got = at(raw, segments);
    return [
      makeIssue("bad-id", {
        message: `${String(last)} ${describe(got)} at ${path} must match ^[a-z0-9][a-z0-9-]{0,47}$`,
        path,
        entityIds,
        expected: "^[a-z0-9][a-z0-9-]{0,47}$",
        got: describe(got),
        hint:
          typeof got === "string"
            ? `Try "${
                got
                  .toLowerCase()
                  .replace(/[^a-z0-9-]+/g, "-")
                  .replace(/^-+/, "")
                  .slice(0, 48) || "entity"
              }".`
            : undefined,
      }),
    ];
  }

  const got = at(raw, segments);
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
 * would map it inside a document (did-you-mean for keys and behaviors,
 * `expected` and `got`), with each pointer moved by `relocate` from the
 * entity-relative form (`""`, `/path/speed`).
 */
export function entityIssues(
  issues: readonly z.core.$ZodIssue[],
  def: unknown,
  relocate: (rel: string) => string,
): SceneIssue[] {
  const raw = { entities: [def] };
  const move = (text: string) => text.replace(ENTITY_POINTER, (_, rel: string) => relocate(rel));
  return issues.flatMap((issue) =>
    mapZodIssue({ ...issue, path: ["entities", 0, ...issue.path] } as z.core.$ZodIssue, raw).map(
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
 * Parses a scene from JSON text or an already-parsed value: migrate, then
 * the schema. Never throws; every failure is a `SceneIssue` with a JSON
 * Pointer `path`, plus `line` when the input was text. Structural checks
 * (duplicate ids, geometry) are `validateScene`'s.
 */
export function parseScene(input: unknown): ParseSceneResult {
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

  const migrated = migrate(raw);
  if (!migrated.ok) return { ok: false, issues: [withLine(migrated.issue)] };

  const result = SceneV1.safeParse(migrated.raw);
  if (!result.success) {
    const issues = result.error.issues.flatMap((i) => mapZodIssue(i, migrated.raw)).map(withLine);
    return { ok: false, issues };
  }
  const def = result.data as SceneDefinition;
  return migrated.from === SCENE_FORMAT_VERSION
    ? { ok: true, def, issues: [] }
    : { ok: true, def, migratedFrom: migrated.from, issues: [] };
}

export class SceneParseError extends Error {
  constructor(readonly issues: SceneIssue[]) {
    super(
      issues.length === 1
        ? `scene failed to parse: ${issues[0].message}`
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

export function parseSceneOrThrow(input: unknown): SceneDefinition {
  const result = parseScene(input);
  if (result.ok) return result.def;
  if (result.issues.some((i) => i.code === "version-newer"))
    throw new SceneVersionError(result.issues);
  throw new SceneParseError(result.issues);
}
