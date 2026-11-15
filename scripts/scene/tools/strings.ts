import {
  byPathThenKey,
  docLookupOf,
  keyedItemPointer,
  localeTagProblem,
  mergedStrings,
  missingStringKeys,
  projectLocales,
  STRING_KEY_PATTERN,
  STRING_NOTE_FIELD,
  stringLocales,
  STRINGS_KIND,
  type AssetId,
  type DocLookup,
  type JsonEdit,
  type LocaleSettings,
  type ProjectOpBatch,
  type ProjectView,
  type StringKeyUse,
} from "@jams/engine/project";
import { closest, jsonPointer } from "@jams/engine/scene";

import {
  failure,
  hostedOptions,
  inScope,
  plural,
  readArg,
  scopeError,
  usage,
  UsageError,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { DEFAULT_PROJECT_URL, openLiveProject, readLiveValues } from "../project-client";
import type { ProjectHandle } from "../projects";
import { runProjectBatch, type WriterFlags } from "./assets-apply";
import { loadProject } from "./project-show";
import { liveFailure } from "./project-tree";

/** A field as RFC 4180 writes it: quoted, quotes doubled, when it holds a quote, comma or line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Records as CSV, each line ending in "\n". */
export function formatCsv(records: readonly (readonly string[])[]): string {
  return records.map((r) => `${r.map(csvField).join(",")}\n`).join("");
}

/**
 * The records of an RFC 4180 text: quoted fields may hold commas, line
 * breaks and doubled quotes; records end in CRLF or LF. A byte-order mark
 * and the last line break are dropped. Throws a `UsageError` naming the
 * line of an unclosed quote or of text after a closing one.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let line = 1;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' && field === "") {
      const start = line;
      i++;
      for (;;) {
        if (i >= src.length) throw new UsageError(`CSV line ${start}: a quoted field never closes`);
        const q = src[i]!;
        if (q === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (q === "\n") line++;
        field += q;
        i++;
      }
      const next = src[i];
      if (next !== undefined && next !== "," && next !== "\n" && next !== "\r")
        throw new UsageError(`CSV line ${line}: text after a closing quote`);
      continue;
    }
    if (c === ",") {
      endField();
      i++;
    } else if (c === "\r" && src[i + 1] === "\n") {
      endRecord();
      line++;
      i += 2;
    } else if (c === "\n") {
      endRecord();
      line++;
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

// ─── Reading a project's strings ─────────────────────────

type Strings = { project: ProjectHandle; lookup: DocLookup; locales: LocaleSettings };

/** A lookup over a project's parsed docs, each kind's ids in path order. */
const lookupOf = (view: ProjectView, values: ReadonlyMap<AssetId, unknown>): DocLookup =>
  docLookupOf([...view.byId.values()].sort(byPathThenKey), (e) => values.get(e.id));

const stringsOf = (project: ProjectHandle, lookup: DocLookup): Strings => ({
  project,
  lookup,
  locales: projectLocales(lookup),
});

async function fileStrings(project: ProjectHandle): Promise<Strings> {
  const loaded = await loadProject(project);
  return stringsOf(project, lookupOf(loaded.view, loaded.values));
}

/**
 * The one project an export or import is about: the `--project` one, the
 * only project in scope, or the only one holding strings files.
 */
async function oneProject(ctx: ToolContext, cmd: string): Promise<Strings | ToolResult> {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const projects = inScope(ctx);
  const [only] = projects;
  if (only && projects.length === 1) return fileStrings(only);
  const loaded = await Promise.all(projects.map(fileStrings));
  const holding = loaded.filter((s) => s.lookup.ids(STRINGS_KIND).length > 0);
  const [first] = holding;
  if (first && holding.length === 1) return first;
  const ids = (holding.length > 0 ? holding : loaded).map((s) => s.project.file.id);
  return usage(`${cmd} needs --project (projects: ${ids.join(", ") || "none"})`);
}

const isStrings = (v: Strings | ToolResult): v is Strings => "lookup" in v;

/** A note when `locale` is neither available nor a column the strings already hold. */
function unknownLocale(s: Strings, locale: string): string | null {
  const known = stringLocales(s.lookup, s.locales);
  if (known.includes(locale)) return null;
  const guess = closest(locale, known);
  return `"${locale}" isn't one of ${s.project.file.id}'s locales (${known.join(", ")})${guess ? `; did you mean "${guess}"?` : ""}`;
}

// ─── strings missing ─────────────────────────────────────

export type StringsMissingInput = { locale?: string };

type MissingKey = { key: string; uses: Omit<StringKeyUse, "key">[] };
type MissingLocale = { locale: string; default: boolean; missing: MissingKey[] };

/** Uses grouped by key, keys in the order they are first used. */
function byKey(uses: readonly StringKeyUse[]): MissingKey[] {
  const keys = new Map<string, MissingKey>();
  for (const { key, ...at } of uses) {
    const hit = keys.get(key) ?? { key, uses: [] };
    hit.uses.push(at);
    keys.set(key, hit);
  }
  return [...keys.values()];
}

function missingIn(s: Strings, locale: string): MissingLocale {
  return {
    locale,
    default: locale === s.locales.default,
    missing: byKey(missingStringKeys(s.lookup, s.locales, locale)),
  };
}

/**
 * The string keys each project's scenes, prefabs, dialogues and sounds name
 * with no text in a locale, through `missingStringKeys`: one locale with
 * `--locale`, else every locale the project's strings speak. Exit 1 when
 * the default locale misses a key; another locale's gaps are information.
 */
export const stringsMissing: Tool<StringsMissingInput> = async (input, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  const badLocale = input.locale === undefined ? null : localeTagProblem(input.locale);
  if (badLocale) return usage(`--locale ${badLocale}`);
  const all = await Promise.all(inScope(ctx).map(fileStrings));
  const lines: string[] = [];
  let defaultMisses = false;
  const projects = all.map((s) => {
    const locales =
      input.locale === undefined ? stringLocales(s.lookup, s.locales) : [input.locale];
    const report = locales.map((l) => missingIn(s, l));
    const note = input.locale === undefined ? null : unknownLocale(s, input.locale);
    if (report.some((r) => r.default && r.missing.length > 0)) defaultMisses = true;
    lines.push(
      `${s.project.file.id}: ${report
        .map((r) => `${r.locale}${r.default ? " (default)" : ""} ${r.missing.length} missing`)
        .join(", ")}`,
    );
    if (note) lines.push(`  ${note}`);
    for (const r of report)
      for (const m of r.missing)
        lines.push(
          `  ${r.locale}  ${m.key}  ${m.uses.map((u) => `${u.kind} ${u.id} ${u.pointer}`).join("; ")}`,
        );
    return {
      project: s.project.file.id,
      default: s.locales.default,
      locales: report,
      ...(note ? { note } : {}),
    };
  });
  return {
    exitCode: defaultMisses ? 1 : 0,
    data: { ok: !defaultMisses, projects },
    text: lines.join("\n") || "no projects",
  };
};

// ─── strings export ──────────────────────────────────────

export type StringsExportInput = { locale?: string; csv?: boolean };

export const STRINGS_EXPORT_USAGE = "strings export <locale> --csv [--project id]";

/** Every merged row as `key,<default>,<locale>,note`, in path then row order. */
export function stringsCsv(lookup: DocLookup, locales: LocaleSettings, locale: string): string {
  const records: string[][] = [["key", locales.default, locale, STRING_NOTE_FIELD]];
  for (const { row } of mergedStrings(lookup).values())
    records.push([row.key, row[locales.default] ?? "", row[locale] ?? "", row.note ?? ""]);
  return formatCsv(records);
}

/**
 * Every string key with its default-locale text, its own text in `locale`
 * (a fallback's never stands in) and its note, as CSV for a translator.
 * The text is the CSV; `--json` carries it in `csv`.
 */
export const stringsExport: Tool<StringsExportInput> = async (input, ctx) => {
  const { locale } = input;
  if (locale === undefined || input.csv !== true) return usage(STRINGS_EXPORT_USAGE);
  const badLocale = localeTagProblem(locale);
  if (badLocale) return usage(badLocale);
  const s = await oneProject(ctx, "strings export");
  if (!isStrings(s)) return s;
  if (locale === s.locales.default)
    return usage(`"${locale}" is ${s.project.file.id}'s default locale: export another one`);
  const csv = stringsCsv(s.lookup, s.locales, locale);
  const note = unknownLocale(s, locale);
  return {
    exitCode: 0,
    data: {
      ok: true,
      project: s.project.file.id,
      default: s.locales.default,
      locale,
      rows: mergedStrings(s.lookup).size,
      csv,
      ...(note ? { note } : {}),
    },
    text: csv.slice(0, -1),
  };
};

// ─── strings import ──────────────────────────────────────

export type StringsImportInput = WriterFlags & { file?: string };

/** Without the writer flags, which each caller spells its own way. */
export const STRINGS_IMPORT_USAGE = "strings import <file.csv>";

/** What a CSV changes: one `editAsset` per strings file, in path order, and the keys whose default text moved since the export. */
export type StringsImportPlan = {
  locale: string;
  ops: Extract<ProjectOpBatch["ops"][number], { op: "editAsset" }>[];
  changed: string[];
  stale: string[];
};

/**
 * The edits a translator's CSV makes: each key's `<locale>` text written to
 * the strings file that holds it. A blank cell, or the text the file
 * already has, changes nothing; the default and note columns are read only
 * to flag stale rows. Throws a `UsageError` for a header other than
 * `key,<default>,<locale>,note`, a malformed or repeated key, or a key no
 * strings file holds.
 */
export function stringsImportPlan(
  lookup: DocLookup,
  locales: LocaleSettings,
  csv: string,
): StringsImportPlan {
  const [header, ...records] = parseCsv(csv);
  const expected = `key,${locales.default},<locale>,${STRING_NOTE_FIELD}`;
  if (!header || header.length !== 4 || header[0] !== "key" || header[3] !== STRING_NOTE_FIELD)
    throw new UsageError(`the CSV's header must be ${expected}`);
  const [, source = "", locale = ""] = header;
  if (source !== locales.default)
    throw new UsageError(
      `the CSV's second column is ${JSON.stringify(source)}, but the default locale is "${locales.default}" (${expected})`,
    );
  const badLocale = localeTagProblem(locale);
  if (badLocale) throw new UsageError(`the CSV's third column: ${badLocale}`);
  if (locale === locales.default)
    throw new UsageError(
      `the CSV writes "${locale}", the default locale; only translations import`,
    );

  const rows = mergedStrings(lookup);
  const seen = new Set<string>();
  const edits = new Map<AssetId, JsonEdit[]>();
  const changed: string[] = [];
  const stale: string[] = [];
  records.forEach((record, i) => {
    const at = `CSV record ${i + 2}`;
    if (record.length !== 4)
      throw new UsageError(`${at}: ${plural(record.length, "field")}, expected 4 (${expected})`);
    const [key = "", sourceText = "", text = ""] = record;
    if (!STRING_KEY_PATTERN.test(key))
      throw new UsageError(`${at}: ${JSON.stringify(key)} isn't a string key`);
    if (seen.has(key)) throw new UsageError(`${at}: "${key}" is in the CSV twice`);
    seen.add(key);
    const merged = rows.get(key);
    if (!merged) {
      const guess = closest(key, [...rows.keys()]);
      throw new UsageError(
        `${at}: no strings file holds "${key}"${guess ? `; did you mean "${guess}"?` : ""}`,
      );
    }
    if ((merged.row[locales.default] ?? "") !== sourceText) stale.push(key);
    if (text === "" || merged.row[locale] === text) return;
    const ofFile = edits.get(merged.id) ?? [];
    ofFile.push({
      set: `${keyedItemPointer("/strings", key)}${jsonPointer([locale])}`,
      value: text,
    });
    edits.set(merged.id, ofFile);
    changed.push(key);
  });
  const ops = lookup
    .ids(STRINGS_KIND)
    .filter((id) => edits.has(id))
    .map((id) => ({ op: "editAsset" as const, id, edits: edits.get(id)! }));
  return { locale, ops, changed, stale };
}

async function liveStrings(
  ctx: ToolContext,
  input: StringsImportInput,
): Promise<Strings | ToolResult> {
  const url = input.url ?? DEFAULT_PROJECT_URL;
  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: ctx.project,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...hostedOptions(ctx, input.token),
    });
  } catch (e) {
    return liveFailure(e, url);
  }
  try {
    const { session } = live.client;
    return stringsOf(live.project, lookupOf(session.view(), await readLiveValues(session)));
  } finally {
    await live.client.close().catch(() => undefined);
  }
}

/**
 * Writes a translator's CSV (`strings export`'s columns) back into the
 * strings files that hold each key, as one batch with one `editAsset` per
 * file it changes, through the writer flags (`--dry-run`, `--live`).
 */
export const stringsImport: Tool<StringsImportInput> = async (input, ctx) => {
  if (!input.file) return usage(`${STRINGS_IMPORT_USAGE} [writer flags]`);
  const s = input.live ? await liveStrings(ctx, input) : await oneProject(ctx, "strings import");
  if (!isStrings(s)) return s;
  let text: string;
  try {
    text = await readArg(ctx, input.file);
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    return failure(`can't read ${input.file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let plan: StringsImportPlan;
  try {
    plan = stringsImportPlan(s.lookup, s.locales, text);
  } catch (e) {
    if (e instanceof UsageError) return usage(`${input.file}: ${e.message}`);
    throw e;
  }
  const project = s.project.file.id;
  const note = unknownLocale(s, plan.locale);
  const notes = [
    ...(note ? [note] : []),
    ...(plan.stale.length > 0
      ? [
          `${plural(plan.stale.length, "key")} changed in ${s.locales.default} since the export: ${plan.stale.join(", ")}`,
        ]
      : []),
  ];
  const extra = { locale: plan.locale, changed: plan.changed, stale: plan.stale };
  const [first] = plan.ops;
  if (!first)
    return {
      exitCode: 0,
      data: { ok: true, project, written: false, ...extra, ...(note ? { note } : {}) },
      text: [`${project}: nothing to write for ${plan.locale}`, ...notes].join("\n"),
    };
  const result = await runProjectBatch({ ...ctx, project }, input, {
    id: first.id,
    build: () => ({ v: 1, label: `strings import ${plan.locale}`, ops: plan.ops }),
  });
  const data = { ...(result.data as Record<string, unknown>), ...extra, ...(note ? { note } : {}) };
  return { ...result, data, text: [result.text, ...notes].join("\n") };
};
