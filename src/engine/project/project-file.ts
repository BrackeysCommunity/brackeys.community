import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { jsonPointer, makeIssue } from "../scene/issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import type { SceneIssue } from "../scene/types";
import { isPlainObject } from "./kinds/define";
import { PROJECT_FILE, type ProjectFile } from "./types";

/** The project file format version, the `v` every `jams.project.json` carries. */
export const PROJECT_FILE_VERSION = 1;

/** `urn:jams-engine:project:v1`. The project file is game-agnostic, so there is one schema. */
export const PROJECT_SCHEMA_ID = `${SCHEMA_ID_BASE}project:v${PROJECT_FILE_VERSION}`;

/** What an omitted `assets` or `code` means. */
export const PROJECT_FILE_DEFAULTS = {
  assets: ["**"],
  code: ["**/*.ts", "**/*.tsx"],
} as const satisfies Pick<Required<ProjectFile>, "assets" | "code">;

/**
 * A project file's globs with the defaults filled in. `ignore` is the
 * file's own; the fixed excludes are `isSkippedAssetPath`'s.
 */
export function projectGlobs(file: ProjectFile): {
  assets: string[];
  code: string[];
  ignore: string[];
} {
  return {
    assets: [...(file.assets ?? PROJECT_FILE_DEFAULTS.assets)],
    code: [...(file.code ?? PROJECT_FILE_DEFAULTS.code)],
    ignore: [...(file.ignore ?? [])],
  };
}

const glob = z
  .string()
  .min(1, { abort: true })
  .refine(
    (g) => {
      const body = g.startsWith("!") ? g.slice(1) : g;
      return (
        body.length > 0 &&
        !body.startsWith("/") &&
        !body.includes("\\") &&
        !body.split("/").includes("..")
      );
    },
    { message: 'a glob relative to the project root: no leading "/", no "\\", no ".." segment' },
  )
  .describe('A POSIX glob relative to the project root; a leading "!" excludes.');

const globs = (description: string) => z.array(glob).describe(description);

/** A module the project file names: a path relative to the file and an export name. */
const moduleRef = (example: string, what: string) =>
  z.strictObject({
    module: z
      .string()
      .regex(/^\.\.?\/[^\\]+$/)
      .describe(`The module, relative to this file ("${example}").`),
    export: z
      .string()
      .regex(/^[A-Za-z_$][\w$]*$/)
      .describe(`The name the module exports ${what} under.`),
  });

/** The zod schema `project.schema.json` is generated from; `parseProjectFile` checks with it. */
export const projectFileSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The project JSON Schema this file follows."),
    kind: z.literal("project").describe('Always "project".'),
    v: z.literal(PROJECT_FILE_VERSION).describe("Project file format version."),
    id: z
      .string()
      .regex(ID_PATTERN)
      .describe(
        "The project's id: the first half of its scene and asset doc names, unique on the site.",
      ),
    name: z.string().min(1).describe("The project's display name."),
    game: moduleRef("./index.ts", "the GameDefinition")
      .nullable()
      .describe("The module that exports the game's definition; null for an engine-only project."),
    ui: moduleRef("./ui/index.ts", "the MountUi function")
      .optional()
      .describe(
        "The module that exports the game's DOM UI (a MountUi), mounted over the canvas by hosts; the CLI never imports it.",
      ),
    assets: globs("Globs of files that may be assets.")
      .optional()
      .meta({ default: [...PROJECT_FILE_DEFAULTS.assets] }),
    code: globs("Globs of code modules the project tree lists read-only.")
      .optional()
      .meta({ default: [...PROJECT_FILE_DEFAULTS.code] }),
    ignore: globs(
      `Extra excludes beside the fixed ones: *.schema.json, *.asset.json, ${PROJECT_FILE}, __tests__, node_modules and dist.`,
    ).optional(),
  })
  .describe(
    `A project's root file (${PROJECT_FILE}): its id, its game and UI modules and which files are assets and code. Kept in git, never co-edited.`,
  );

/** The draft 2020-12 JSON Schema of `jams.project.json`. */
export function projectJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(projectFileSchema);
  return {
    $schema,
    $id: PROJECT_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine project file, format v${PROJECT_FILE_VERSION}`,
    ...rest,
  };
}

// ─── Shared by the engine's small JSON files ─────────────

/**
 * The parsed value of a small JSON file, or the issues that refuse it: bad
 * JSON, a wrong `kind`, or a `v` newer than `version`.
 */
export function readJsonDocument(
  input: unknown,
  kind: string,
  version: number,
  what: string,
): { ok: true; raw: Record<string, unknown> } | { ok: false; issues: SceneIssue[] } {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        issues: [makeIssue("schema", { message: `${what} isn't valid JSON: ${detail}`, path: "" })],
      };
    }
  }
  if (!isPlainObject(raw) || raw.kind !== kind) {
    return {
      ok: false,
      issues: [
        makeIssue("schema", {
          message: `expected ${what}, an object with "kind": "${kind}"`,
          path: isPlainObject(raw) ? "/kind" : "",
          expected: `"${kind}"`,
          got: isPlainObject(raw)
            ? JSON.stringify(raw.kind)
            : Array.isArray(raw)
              ? "array"
              : typeof raw,
        }),
      ],
    };
  }
  if (typeof raw.v === "number" && Number.isInteger(raw.v) && raw.v > version) {
    return {
      ok: false,
      issues: [
        makeIssue("version-newer", {
          message: `${what} is format v${raw.v}; this engine reads up to v${version}`,
          path: "/v",
          expected: String(version),
          got: String(raw.v),
        }),
      ],
    };
  }
  return { ok: true, raw };
}

/** Zod issues as SceneIssues: `unknown-key` for extra keys, `bad-id` for the id fields named, `schema` otherwise. */
export function zodSceneIssues(error: z.ZodError, idFields: readonly string[] = []): SceneIssue[] {
  return error.issues.flatMap((issue) => {
    const segments = issue.path.filter((p): p is string | number => typeof p !== "symbol");
    const path = jsonPointer(segments);
    const where = path || "the document";
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) =>
        makeIssue("unknown-key", {
          message: `unknown key "${key}" at ${where}`,
          path: `${path}${jsonPointer([key])}`,
          got: key,
        }),
      );
    }
    const field = segments.length === 1 ? String(segments[0]) : undefined;
    if (field !== undefined && idFields.includes(field) && issue.code === "invalid_format") {
      return [
        makeIssue("bad-id", {
          message: `${field} must match ${ID_PATTERN.source}`,
          path,
          expected: ID_PATTERN.source,
        }),
      ];
    }
    return [makeIssue("schema", { message: `${where}: ${issue.message}`, path })];
  });
}

/** `value`'s own keys in `order` first, then the rest sorted; undefined values dropped. */
export function orderKeys(
  value: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rest = Object.keys(value)
    .filter((k) => !order.includes(k))
    .sort();
  for (const k of [...order, ...rest]) if (value[k] !== undefined) out[k] = value[k];
  return out;
}

/** Every object key sorted, at every depth: free-form records have no declared order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort())
    if (value[k] !== undefined) out[k] = sortKeysDeep(value[k]);
  return out;
}

const PRINT_WIDTH = 100;
const INDENT = "  ";

const isPair = (v: unknown) =>
  (Array.isArray(v) && v.length > 1) || (isPlainObject(v) && Object.keys(v).length > 1);

/** JSON number text as the repo formatter writes it: `3e21`, not `3e+21`. */
const num = (n: number) => (JSON.stringify(n) ?? "null").replace("e+", "e");

function flat(value: unknown): string {
  if (typeof value === "number") return num(value);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(flat).join(", ")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    return keys.length === 0
      ? "{}"
      : `{ ${keys.map((k) => `${JSON.stringify(k)}: ${flat(value[k])}`).join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `value` printed at column `col` with `tail` characters after it on the line. */
function print(value: unknown, indent: string, col: number, tail: number): string {
  const inline = flat(value);
  const forceBreak =
    Array.isArray(value) &&
    value.length > 1 &&
    value.every((v) => isPair(v) && Array.isArray(v) === Array.isArray(value[0]));
  if ((!Array.isArray(value) && !isPlainObject(value)) || inline.length <= 2) return inline;
  if (!forceBreak && col + inline.length + tail <= PRINT_WIDTH) return inline;
  const inner = indent + INDENT;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number")) {
      const lines: string[] = [];
      let line = "";
      value.forEach((v, i) => {
        const item = `${num(v as number)}${i < value.length - 1 ? "," : ""}`;
        if (line && inner.length + line.length + 1 + item.length > PRINT_WIDTH) {
          lines.push(line);
          line = item;
        } else line = line ? `${line} ${item}` : item;
      });
      lines.push(line);
      return `[\n${lines.map((l) => inner + l).join("\n")}\n${indent}]`;
    }
    const items = value.map((v, i) => print(v, inner, inner.length, i < value.length - 1 ? 1 : 0));
    return `[\n${items.map((s) => inner + s).join(",\n")}\n${indent}]`;
  }
  return printObject(value as Record<string, unknown>, indent);
}

function printObject(value: Record<string, unknown>, indent: string): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const inner = indent + INDENT;
  const lines = keys.map((k, i) => {
    const head = `${inner}${JSON.stringify(k)}: `;
    return head + print(value[k], inner, head.length, i < keys.length - 1 ? 1 : 0);
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/**
 * The text of a small JSON file: the top level one key per line, nested
 * values on one line when they fit in 100 columns, and a trailing newline.
 * It is the repo formatter's output for the same value, so `vp fmt` leaves
 * the file alone.
 */
export function formatJsonDocument(value: Record<string, unknown>): string {
  return `${printObject(value, "")}\n`;
}

// ─── The project file ────────────────────────────────────

export type ParseProjectFileResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; issues: SceneIssue[] };

/** Parses `jams.project.json` from text or a parsed value. Omitted globs stay omitted; `projectGlobs` fills them. Never throws. */
export function parseProjectFile(input: unknown): ParseProjectFileResult {
  const read = readJsonDocument(input, "project", PROJECT_FILE_VERSION, "the project file");
  if (!read.ok) return read;
  const parsed = projectFileSchema.safeParse(read.raw);
  if (!parsed.success) return { ok: false, issues: zodSceneIssues(parsed.error, ["id"]) };
  return { ok: true, file: parsed.data as ProjectFile };
}

const PROJECT_KEYS = [
  "$schema",
  "kind",
  "v",
  "id",
  "name",
  "game",
  "ui",
  "assets",
  "code",
  "ignore",
];

/** The canonical text of a project file: keys in the schema's order, a trailing newline. */
export function formatProjectFile(file: ProjectFile): string {
  const value = orderKeys(file as Record<string, unknown>, PROJECT_KEYS);
  if (file.game) value.game = { module: file.game.module, export: file.game.export };
  if (file.ui) value.ui = { module: file.ui.module, export: file.ui.export };
  return formatJsonDocument(value);
}
