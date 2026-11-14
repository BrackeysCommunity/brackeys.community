import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import type { GameTableDef, Registry } from "../../game/types";
import { pxPerMetreOf, scaleLengths } from "../../game/units";
import { closest } from "../../scene/did-you-mean";
import { jsonPointer, makeIssue, unitsRefusal } from "../../scene/issues";
import type { MigrateEnv } from "../../scene/migrate";
import type { SceneIssue } from "../../scene/types";
import { schemaRefSites, type RefSite } from "../refs";
import type { AssetEntry, AssetId, ProjectView } from "../types";
import { byCodeUnit, byPathThenKey, defineAssetKind, isPlainObject, type KindEnv } from "./define";

export const DATA_TABLE_KIND = "data-table";
export const DATA_TABLE_VERSION = 2;
export const DATA_TABLE_SCHEMA_ID = `urn:jams-engine:data-table:v${DATA_TABLE_VERSION}`;

export type DataTableRow = Record<string, unknown> & { id: string };
export type DataTableFile = {
  $schema?: string;
  kind: typeof DATA_TABLE_KIND;
  v: typeof DATA_TABLE_VERSION;
  table: string;
  rows: DataTableRow[];
};

const rowId = z
  .string()
  .regex(ID_PATTERN)
  .describe("The row's id, unique across every asset of its table.");

const header = () => ({
  $schema: z.string().optional().describe("The data-table JSON Schema this file follows."),
  kind: z.literal(DATA_TABLE_KIND).describe('Always "data-table".'),
  v: z.literal(DATA_TABLE_VERSION).describe("Data-table format version."),
});

const tablesOf = (registry: Registry): Readonly<Record<string, GameTableDef>> =>
  registry.game?.tables ?? {};

/** A table's row: its schema's fields plus `id`. */
export function rowSchemaOf(def: GameTableDef): z.ZodObject {
  return z.strictObject({ id: rowId, ...def.row }).describe(def.description);
}

/**
 * A table's name must be one of the game's `tables` (else `asset-kind`);
 * then the file is judged by that table's row schema. A game without
 * tables refuses every name. A project with no game runs its scenes under
 * the game a run names, which judges the rows when it reads them (rows
 * that don't fit are left out), so without a game any table name is taken
 * and rows need only ids.
 */
function dataTableSchema(registry: Registry): z.ZodType<DataTableFile> {
  const tables = tablesOf(registry);
  const names = Object.keys(tables);
  const known = z
    .looseObject({ table: z.string().describe("The table these rows belong to.") })
    .superRefine((value, ctx) => {
      if (!registry.game || Object.hasOwn(tables, value.table)) return;
      const guess = closest(value.table, names);
      ctx.addIssue({
        code: "custom",
        path: ["table"],
        message:
          names.length === 0
            ? `no table "${value.table}": the ${registry.id} game declares no tables`
            : `no table "${value.table}"${guess ? `; did you mean "${guess}"?` : ""} (tables: ${names.join(", ")})`,
        params: {
          issue: "asset-kind",
          got: value.table,
          ...(names.length > 0 ? { expected: names.join(" | ") } : {}),
          hint: "Use a table the game declares in its `tables`.",
        },
        input: value.table,
      });
    });
  const variant = (table: z.ZodType, rows: z.ZodType, description: string) =>
    z.strictObject({ ...header(), table, rows }).describe(description);
  const body =
    names.length === 0
      ? variant(
          z.string().regex(ID_PATTERN).describe("The game table these rows belong to."),
          z
            .array(z.looseObject({ id: rowId }).describe("One row: its id and the table's fields."))
            .describe("The rows, in order."),
          "Rows of one of the game's data tables. Several files may hold rows of one table; game code reads them merged in path order.",
        )
      : z.discriminatedUnion(
          "table",
          names.map((name) => {
            const def = tables[name]!;
            return variant(
              z.literal(name).describe(def.description),
              z.array(rowSchemaOf(def)).describe("The rows, in order."),
              `Rows of the "${name}" table. Several files may hold rows of one table; game code reads them merged in path order.`,
            );
          }) as unknown as [z.ZodObject, ...z.ZodObject[]],
        );
  return (known as z.ZodType).pipe(body as z.ZodType) as unknown as z.ZodType<DataTableFile>;
}

/** One table's assets in path order, with the rows each holds. */
export function tableAssets(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  table: string,
): { entry: AssetEntry; rows: readonly unknown[] }[] {
  return [...view.byId.values()]
    .filter((e) => e.kind === DATA_TABLE_KIND)
    .sort(byPathThenKey)
    .flatMap((entry) => {
      const value = values.get(entry.id);
      if (!isPlainObject(value) || value.table !== table || !Array.isArray(value.rows)) return [];
      return [{ entry, rows: value.rows }];
    });
}

/**
 * `dup-id` for a row whose id an earlier asset of its table (in path order)
 * already holds, `path` into the later asset and `detail` naming the table
 * and the earlier asset's key. Repeats inside one asset are that asset's
 * own `dup-id`.
 */
export function dataTableIssues(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
): SceneIssue[] {
  const tables = new Set<string>();
  for (const entry of view.byId.values()) {
    const value = values.get(entry.id);
    if (entry.kind === DATA_TABLE_KIND && isPlainObject(value) && typeof value.table === "string")
      tables.add(value.table);
  }
  const issues: SceneIssue[] = [];
  for (const table of [...tables].sort(byCodeUnit)) {
    const owner = new Map<string, AssetEntry>();
    for (const { entry, rows } of tableAssets(view, values, table)) {
      const own = new Set<string>();
      rows.forEach((row, i) => {
        const id = isPlainObject(row) ? row.id : undefined;
        if (typeof id !== "string" || own.has(id)) return;
        own.add(id);
        const first = owner.get(id);
        if (!first) owner.set(id, entry);
        else
          issues.push(
            makeIssue("dup-id", {
              message: `row "${id}" of table "${table}" is in "${first.id}" (${first.path}) and "${entry.id}" (${entry.path})`,
              path: jsonPointer(["rows", i, "id"]),
              entityIds: [entry.key, id],
              detail: { table, first: first.key },
              hint: `Give the row in "${entry.id}" a new id, e.g. "${id}-2".`,
            }),
          );
      });
    }
  }
  return issues;
}

/**
 * v1 → v2: lengths become metres. Each row's length fields (its table's
 * row schema, by `meta.unit`) are divided by the game's px per metre; a
 * table the game doesn't declare keeps its rows as they are.
 */
function dataTableV1ToV2(raw: unknown, env: MigrateEnv): unknown {
  const registry = env.registry;
  if (!registry) return unitsRefusal("data-table");
  const doc = raw as Record<string, unknown>;
  const tables = tablesOf(registry);
  const name = doc.table;
  const def = typeof name === "string" && Object.hasOwn(tables, name) ? tables[name] : undefined;
  if (!def || !Array.isArray(doc.rows)) return { ...doc, v: 2 };
  const row = rowSchemaOf(def);
  const ppm = pxPerMetreOf(registry);
  return { ...doc, v: 2, rows: doc.rows.map((r) => scaleLengths(r, row, ppm)) };
}

/** Rows of one of the game's data tables; several assets may hold rows of one table. */
export const dataTableKind = defineAssetKind({
  kind: DATA_TABLE_KIND,
  title: "Data table",
  description:
    "Rows of one of the game's data tables (cards, items, waves), merged across assets in path order.",
  match: { jsonKind: DATA_TABLE_KIND },
  defaultFolder: () => "data",
  storage: "doc",
  runtime: "sim",
  version: DATA_TABLE_VERSION,
  migrations: { 1: dataTableV1ToV2 },
  schemaId: DATA_TABLE_SCHEMA_ID,
  schema: (env: KindEnv) => dataTableSchema(env.registry),
  layout: {
    as: "map",
    fields: {
      table: { as: "atomic" },
      rows: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
    },
  },
  refs(file: DataTableFile, env: KindEnv): RefSite[] {
    const tables = tablesOf(env.registry);
    if (!Object.hasOwn(tables, file.table) || !Array.isArray(file.rows)) return [];
    const shape = rowSchemaOf(tables[file.table]!).shape;
    return file.rows.flatMap((row, i) =>
      schemaRefSites(shape, row, `/rows/${typeof row?.id === "string" ? `@${row.id}` : i}`),
    );
  },
  empty: (env: KindEnv, { id }): DataTableFile => ({
    kind: DATA_TABLE_KIND,
    v: DATA_TABLE_VERSION,
    table: Object.keys(tablesOf(env.registry))[0] ?? id,
    rows: [],
  }),
});
