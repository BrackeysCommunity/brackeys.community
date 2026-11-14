import { z } from "zod";

import {
  actionProblem,
  bindingProblems,
  playersProblems,
  uiActionEnumJson,
  type BindingProblem,
} from "../../game/input-bindings";
import type { ActionKind, Binding, PlayersDef, Registry } from "../../game/types";
import type { SceneIssue } from "../../scene/types";
import type { AssetEntry, ProjectView } from "../types";
import {
  defineAssetKind,
  isPlainObject,
  perProjectEntries,
  perProjectIssues,
  type KindEnv,
} from "./define";

export const INPUT_MAP_KIND = "input-map";
export const INPUT_MAP_VERSION = 1;
export const INPUT_MAP_SCHEMA_ID = `urn:jams-engine:input-map:v${INPUT_MAP_VERSION}`;

/** An on-screen control as the input map declares it; `at` and `radius` are fractions of the canvas's shorter side. */
export type InputMapTouchControl = {
  id: string;
  kind: "button" | "stick" | "dpad";
  action: string;
  at: [x: number, y: number];
  radius: number;
  label?: string;
};

/** The project's input map: one per project, merged per action and binding. */
export type InputMapFile = {
  $schema?: string;
  kind: typeof INPUT_MAP_KIND;
  v: typeof INPUT_MAP_VERSION;
  players?: PlayersDef;
  /** Radial stick deadzone, 0…1. */
  deadzone?: number;
  /** Each replaces the game's bindings for its action whole; actions it omits keep the game's. */
  actions?: { action: string; kind?: ActionKind; bindings: Binding[] }[];
  touch?: InputMapTouchControl[];
};

/** One thing wrong with an input map; `at` is the JSON path of the offending value inside the file. */
export type InputMapProblem = Omit<BindingProblem, "path"> & { at: (string | number)[] };

const fraction = (description: string) => z.number().describe(description);

/** An action name; for a game with UI-only actions, the JSON Schema lists its actions with those marked `x-ui`. */
const actionField = (description: string, registry?: Registry) => {
  const field = z.string();
  const names = registry ? uiActionEnumJson(registry) : null;
  return (names ? field.meta(names) : field).describe(description);
};

const shapeFieldsFor = (registry?: Registry) => ({
  $schema: z.string().optional().describe("The input-map JSON Schema this file follows."),
  kind: z.literal(INPUT_MAP_KIND).describe('Always "input-map".'),
  v: z.literal(INPUT_MAP_VERSION).describe("Input-map format version."),
  players: z
    .strictObject({
      max: z.number().describe("Seats, a whole number from 1 to 8."),
      join: z
        .enum(["auto", "press", "host"])
        .describe(
          "auto: seat 0 owns keyboard, pointer and touch, and pads take free seats in connection order; press: a device's first press takes the lowest free seat; host: the host assigns devices.",
        ),
    })
    .optional()
    .describe("The project's seats and how devices take them; omitted: the game's."),
  deadzone: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Radial stick deadzone, 0…1; omitted: the game's."),
  actions: z
    .array(
      z
        .strictObject({
          action: actionField("One of the game's actions.", registry),
          kind: z
            .enum(["button", "axis", "vector"])
            .optional()
            .describe("The action's kind as the game declares it; omitted: the game's."),
          bindings: z
            .array(
              z
                .looseObject({
                  device: z.string().describe('"key", "pad", "pointer" or "touch".'),
                })
                .describe(
                  'One binding: a key by `KeyboardEvent.code` ({ device: "key", code, axis?, value?, player? }), a pad button, stick or axis, a pointer button, or a touch control by id.',
                ),
            )
            .describe("Every binding of the action; replaces the game's whole."),
        })
        .describe("One action's bindings."),
    )
    .optional()
    .describe("Bindings per action; an action the map omits keeps the game's."),
  touch: z
    .array(
      z
        .strictObject({
          id: z.string().describe("The control's id, which touch bindings name."),
          kind: z.enum(["button", "stick", "dpad"]).describe("What the control is."),
          action: actionField("The game action it drives.", registry),
          at: z
            .tuple([
              fraction("x, a fraction of the canvas's shorter side from its left edge."),
              fraction("y, a fraction of the canvas's shorter side from its top edge."),
            ])
            .describe(
              "Where its centre sits, in fractions of the canvas's shorter side from its top-left corner.",
            ),
          radius: z
            .number()
            .positive()
            .describe("Its radius, a fraction of the canvas's shorter side."),
          label: z.string().optional().describe("Text drawn on a button."),
        })
        .describe("One on-screen control."),
    )
    .optional()
    .describe("On-screen controls for touch devices."),
});

/** The file's shape alone: what every reader of an input map checks before its bindings. */
const shapeSchema = z.strictObject(shapeFieldsFor());

const pathOf = (pointer: string): string[] => (pointer === "" ? [] : pointer.slice(1).split("/"));

/**
 * What's wrong with an input map against the game it runs under: its
 * seats (`player-unknown`), each action the game doesn't declare or whose
 * kind differs from the game's, every binding `bindingProblems` refuses
 * (judged by the game's kind for its action, the map's seats, else the
 * game's, and the map's touch controls), and each touch control on an
 * action the game doesn't declare (`binding-unknown`).
 */
export function inputMapProblems(file: InputMapFile, registry: Registry): InputMapProblem[] {
  const out: InputMapProblem[] = [];
  const declared = new Map(registry.actions.map((a) => [a.action, a]));
  const names = registry.actionNames;
  const unknownAction = (at: (string | number)[], name: string) => {
    const problem = actionProblem(name, names);
    if (!problem) return;
    const { path: _path, ...rest } = problem;
    out.push({
      ...rest,
      ...(names.length === 0
        ? { message: `no action "${name}": the ${registry.id} registry declares no actions` }
        : {}),
      hint:
        problem.hint ??
        "Bind one of the game's actions; an action the map omits keeps the game's bindings.",
      at,
    });
  };

  const players = file.players ? playersProblems(file.players) : [];
  for (const p of players) out.push({ ...p, at: ["players", ...pathOf(p.path)] });
  const max =
    file.players && players.length === 0
      ? file.players.max
      : (registry.game?.input?.players?.max ?? 1);
  const controls = (file.touch ?? []).map((t) => t.id);

  (file.actions ?? []).forEach((entry, i) => {
    const def = declared.get(entry.action);
    if (!def) return unknownAction(["actions", i, "action"], entry.action);
    const kind = def.kind ?? "button";
    if (entry.kind !== undefined && entry.kind !== kind)
      out.push({
        code: "binding-unknown",
        message: `"${entry.action}" is a ${kind} action in the game, not a ${entry.kind} action`,
        expected: `"${kind}"`,
        got: `"${entry.kind}"`,
        hint: "Drop `kind` or set the game's; a map can't change an action's kind.",
        at: ["actions", i, "kind"],
      });
    entry.bindings.forEach((binding, j) => {
      for (const p of bindingProblems(binding, { kind, max, controls }))
        out.push({ ...p, at: ["actions", i, "bindings", j, ...pathOf(p.path)] });
    });
  });

  (file.touch ?? []).forEach((control, i) => {
    if (!declared.has(control.action)) unknownAction(["touch", i, "action"], control.action);
  });
  return out;
}

function inputMapSchema(registry: Registry): z.ZodType<InputMapFile> {
  return z
    .strictObject(shapeFieldsFor(registry))
    .superRefine((value, ctx) => {
      for (const p of inputMapProblems(value as InputMapFile, registry))
        ctx.addIssue({
          code: "custom",
          path: p.at,
          message: p.message,
          params: {
            issue: p.code,
            ...(p.hint ? { hint: p.hint } : {}),
            ...(p.expected ? { expected: p.expected } : {}),
            ...(p.got ? { got: p.got } : {}),
          },
          input: value,
        });
    })
    .describe(
      "The project's input map, at most one file per project: seats, stick deadzone, bindings per action and on-screen controls. Each action listed replaces the game's bindings for it whole.",
    ) as unknown as z.ZodType<InputMapFile>;
}

/**
 * The parts of a file a run uses: null when it isn't an input map's
 * shape; else the map without its seats, an action or a touch control that
 * `inputMapProblems` refuses, so those keep the game's.
 */
export function usableInputMap(raw: unknown, registry: Registry): InputMapFile | null {
  if (!isPlainObject(raw)) return null;
  const shape = shapeSchema.safeParse(raw);
  if (!shape.success) return null;
  const file = shape.data as InputMapFile;
  const problems = inputMapProblems(file, registry);
  const bad = (part: string) =>
    new Set(problems.filter((p) => p.at[0] === part).map((p) => p.at[1]));
  const out: InputMapFile = { ...file };
  if (bad("players").size > 0) delete out.players;
  const actions = bad("actions");
  if (file.actions) out.actions = file.actions.filter((_, i) => !actions.has(i));
  const touch = bad("touch");
  if (file.touch) out.touch = file.touch.filter((_, i) => !touch.has(i));
  return out;
}

/** The project's live input-map entries, the one in effect (first by path) first. */
export function inputMapEntries(view: ProjectView): AssetEntry[] {
  return perProjectEntries(view, INPUT_MAP_KIND);
}

/** `asset-kind` for every live input-map asset after the first by path: a project has at most one. */
export function inputMapIssues(view: ProjectView): SceneIssue[] {
  return perProjectIssues(view, inputMapKind);
}

/** Seats, deadzone, bindings per action and on-screen controls, co-edited per action and binding. */
export const inputMapKind = defineAssetKind({
  kind: INPUT_MAP_KIND,
  title: "Input map",
  description:
    "The project's bindings per action, its seats, stick deadzone and on-screen controls. At most one per project.",
  match: { jsonKind: INPUT_MAP_KIND },
  defaultFolder: () => "",
  storage: "doc",
  runtime: "sim",
  perProject: 1,
  perProjectWords: { noun: "input map", contents: "bindings" },
  version: INPUT_MAP_VERSION,
  schemaId: INPUT_MAP_SCHEMA_ID,
  schema: (env: KindEnv) => inputMapSchema(env.registry),
  layout: {
    as: "map",
    fields: {
      players: { as: "map", rest: { as: "atomic" } },
      actions: {
        as: "keyed",
        id: "action",
        item: {
          as: "map",
          fields: { bindings: { as: "list", item: { as: "atomic" } } },
          rest: { as: "atomic" },
        },
      },
      touch: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 262_144 },
  empty: (): InputMapFile => ({ kind: INPUT_MAP_KIND, v: INPUT_MAP_VERSION }),
});
