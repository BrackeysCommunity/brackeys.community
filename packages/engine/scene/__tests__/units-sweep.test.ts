import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { checkedTestGame, testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { fieldMeta } from "../../game/fields";
import type { Registry } from "../../game/types";
import { dataTableKind } from "../../project/kinds/data-table";
import { gameSettingsKind } from "../../project/kinds/game-settings";
import { materialSchema } from "../../project/kinds/material";
import { checksSchemaFor } from "../checks";
import { fragmentSchemaFor } from "../fragment";
import { opBatchSchemaFor } from "../ops-schema";
import { prefabSchemaFor } from "../prefab";
import { sceneSchemaFor } from "../schema";
import { LENGTH_UNITS } from "../units";

/**
 * A description that names a length: a unit after a number or a comma
 * ("x, m.", "in px/s"), or the words metres and pixels. `ms`, `deg` and
 * `kg/m²` don't count.
 */
const NAMES_LENGTH =
  /(?:^|[\s,(])(?:m|m\/s|m\/s²|px|px\/s|px\/s²)(?=$|[\s.,;:)])|\b(?:metres?|meters?|pixels?)\b/i;

/** Units no field may declare: the simulation's speeds and accelerations are metric. */
const PX_RATES = ["px/s", "px/s²"];

type Def = {
  type: string;
  innerType?: z.core.$ZodType;
  in?: z.core.$ZodType;
  out?: z.core.$ZodType;
  getter?: () => z.core.$ZodType;
  shape?: Record<string, z.core.$ZodType>;
  catchall?: z.core.$ZodType;
  keyType?: z.core.$ZodType;
  valueType?: z.core.$ZodType;
  items?: readonly z.core.$ZodType[];
  rest?: z.core.$ZodType | null;
  element?: z.core.$ZodType;
  options?: readonly z.core.$ZodType[];
  left?: z.core.$ZodType;
  right?: z.core.$ZodType;
};

const own = (schema: z.core.$ZodType, key: string): unknown => z.globalRegistry.get(schema)?.[key];

/**
 * Every number field under `root` whose description names a length but
 * carries no `meta.unit` (on itself, a wrapper, or the tuple or array that
 * holds it), and every field declaring a px rate, as `<where>: <path>`.
 */
function unitProblems(where: string, root: z.core.$ZodType): string[] {
  const out: string[] = [];
  const seen = new Set<z.core.$ZodType>();
  const visit = (
    schema: z.core.$ZodType,
    path: string,
    description: string | undefined,
    unit: unknown,
  ): void => {
    const desc = (own(schema, "description") as string | undefined) ?? description;
    const declared = own(schema, "unit") ?? unit;
    if (typeof own(schema, "unit") === "string" && PX_RATES.includes(own(schema, "unit") as string))
      out.push(`${where}: ${path || "/"} declares ${String(own(schema, "unit"))}`);
    const def = schema._zod.def as unknown as Def;
    if (def.type === "number") {
      if (desc && NAMES_LENGTH.test(desc) && declared === undefined)
        out.push(`${where}: ${path || "/"} (${JSON.stringify(desc)})`);
      return;
    }
    if (seen.has(schema)) return;
    seen.add(schema);
    const inner = def.innerType ?? def.in ?? def.getter?.();
    if (inner) {
      visit(inner, path, desc, declared);
      if (def.type === "pipe" && def.out) visit(def.out, path, desc, declared);
      return;
    }
    switch (def.type) {
      case "object":
        for (const [key, field] of Object.entries(def.shape ?? {}))
          visit(field, `${path}/${key}`, undefined, undefined);
        if (def.catchall) visit(def.catchall, `${path}/*`, undefined, undefined);
        return;
      case "record":
        if (def.valueType) visit(def.valueType, `${path}/*`, undefined, undefined);
        return;
      case "tuple":
        (def.items ?? []).forEach((item, i) => visit(item, `${path}/${i}`, desc, declared));
        if (def.rest) visit(def.rest, `${path}/…`, desc, declared);
        return;
      case "array":
        if (def.element) visit(def.element, `${path}/*`, desc, declared);
        return;
      case "union":
        (def.options ?? []).forEach((option, i) =>
          visit(option, `${path}|${i}`, undefined, undefined),
        );
        return;
      case "intersection":
        if (def.left) visit(def.left, path, undefined, undefined);
        if (def.right) visit(def.right, path, undefined, undefined);
        return;
      default:
        return;
    }
  };
  visit(root, "", undefined, undefined);
  return out;
}

/** Every schema a registry's documents, ops and game hooks are judged by. */
function registrySchemas(registry: Registry): [string, z.core.$ZodType][] {
  const env = { registry, project: null };
  const game = registry.game;
  const out: [string, z.core.$ZodType][] = [
    ["scene", sceneSchemaFor(registry)],
    ["prefab", prefabSchemaFor(registry)],
    ["fragment", fragmentSchemaFor(registry)],
    ["ops", opBatchSchemaFor(registry)],
    ["checks", checksSchemaFor(registry)],
    ["material", materialSchema],
    ["game-settings", gameSettingsKind.schema(env)],
    ["data-table", dataTableKind.schema(env)],
    ["settings", z.object(registry.settings)],
    ["prefabContract", z.object(registry.prefabContract)],
  ];
  for (const [name, type] of registry.types) out.push([`type ${name}`, z.object(type.shape)]);
  for (const [name, behavior] of registry.behaviors)
    out.push([`behavior ${name}`, z.object(behavior.shape)]);
  for (const [name, command] of registry.commands)
    if (command.args) out.push([`command ${name}`, command.args]);
  for (const [name, table] of Object.entries(game?.tables ?? {}))
    out.push([`table ${name}`, z.object(table.row)]);
  out.push(["projectSettings", z.object(game?.projectSettings ?? {})]);
  for (const [name, predicate] of Object.entries(game?.play?.predicates ?? {}))
    if (predicate.arg) out.push([`predicate ${name}`, predicate.arg]);
  for (const [name, check] of Object.entries(game?.checks ?? {}))
    out.push([`check ${name}`, check.arg]);
  return out;
}

/** Input scripts migrate with their own format, so their fields aren't swept here. */
const outsideScripts = (problem: string) => !/\/script(?:\||\/|$| )/.test(problem);

function sweep(registry: Registry): string[] {
  return registrySchemas(registry)
    .flatMap(([where, schema]) => unitProblems(where, schema))
    .filter(outsideScripts);
}

describe("length units on every length field", () => {
  it("the engine's registry: every number that names a length declares its unit", () => {
    expect(sweep(createRegistry())).toEqual([]);
  });

  it("the test game's registry, its checks included", () => {
    expect(sweep(createRegistry(testGame))).toEqual([]);
    expect(sweep(createRegistry(checkedTestGame))).toEqual([]);
  });

  it("refuses a game's number field that names a length without meta.unit, and a px rate", () => {
    const sloppy = createRegistry(
      defineGame({
        id: "sloppy",
        types: [],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
        projectSettings: {
          reach: z.number().optional().describe("How far it reaches, px."),
          speed: z.number().optional().describe("Run speed, m/s.").meta({ unit: "px/s" }),
          lives: z.number().int().optional().describe("Lives, at most 9."),
          spot: z
            .tuple([z.number(), z.number()])
            .optional()
            .describe("Where it starts, in world metres."),
          ok: z.number().optional().describe("How far, m.").meta({ unit: "m" }),
          pause: z.number().optional().describe("How long it waits, ms."),
        },
      }),
    );
    expect(unitProblems("projectSettings", z.object(sloppy.game!.projectSettings!))).toEqual([
      'projectSettings: /reach ("How far it reaches, px.")',
      "projectSettings: /speed declares px/s",
      'projectSettings: /spot/0 ("Where it starts, in world metres.")',
      'projectSettings: /spot/1 ("Where it starts, in world metres.")',
    ]);
  });

  it("every length unit the engine declares is one of LENGTH_UNITS, else px on the drawing side", () => {
    const units = new Set<unknown>();
    const collect = (schema: z.core.$ZodType, seen = new Set<z.core.$ZodType>()): void => {
      if (seen.has(schema)) return;
      seen.add(schema);
      const unit = fieldMeta(schema, "unit");
      if (unit !== undefined) units.add(unit);
      const def = schema._zod.def as unknown as Def;
      for (const next of [
        def.innerType,
        def.in,
        def.out,
        def.element,
        def.valueType,
        def.catchall,
        def.rest ?? undefined,
        def.left,
        def.right,
        ...(def.items ?? []),
        ...(def.options ?? []),
        ...Object.values(def.shape ?? {}),
      ])
        if (next) collect(next, seen);
    };
    for (const [, schema] of registrySchemas(createRegistry(testGame))) collect(schema);
    for (const unit of units)
      expect([...LENGTH_UNITS, "px", "deg", "ms"]).toContain(unit as string);
    expect([...units]).toEqual(expect.arrayContaining(["m", "m/s", "m/s²", "px"]));
  });
});
