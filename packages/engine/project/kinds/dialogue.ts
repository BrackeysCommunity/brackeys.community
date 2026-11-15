/**
 * The `dialogue` kind's file: a conversation's nodes, lines by string key,
 * choices, conditions over JSON values and effects. Simulation data: a
 * dialogue joins its run's hash, and only recorded commands advance it.
 * The graph checks (dead ends, reachability) live here, so the runner's
 * explorer reuses them. Zod, game/, scene/ and project/ only (all in the
 * hosted service's image).
 */
import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import type { JsonValue } from "../../game/types";
import { didYouMean } from "../../scene/did-you-mean";
import { jsonPointer, makeIssue } from "../../scene/issues";
import type { SceneIssue } from "../../scene/types";
import type { RefSite } from "../refs";
import type { AssetId } from "../types";
import { ATLAS_KIND } from "./atlas";
import { AUDIO_KIND } from "./audio";
import { defineAssetKind, folderOf, type DocLookup } from "./define";
import { SOUND_KIND } from "./sound";
import { docStringKeyIssues, STRING_KEY_PATTERN } from "./strings";
import { TEXTURE_KIND } from "./texture";

export const DIALOGUE_KIND = "dialogue";
export const DIALOGUE_VERSION = 1;
export const DIALOGUE_SCHEMA_ID = `urn:jams-engine:dialogue:v${DIALOGUE_VERSION}`;

/** Conditions over the dialogue's variables (JSON pointers into the host's value). */
export type DialogueCondition =
  | {
      var: string;
      eq?: JsonValue;
      ne?: JsonValue;
      gt?: number;
      gte?: number;
      lt?: number;
      lte?: number;
      truthy?: boolean;
    }
  | { all: readonly DialogueCondition[] }
  | { any: readonly DialogueCondition[] }
  | { not: DialogueCondition }
  /** A node id seen in this conversation or saved history. */
  | { visited: string };

export type DialogueEffect =
  | { set: string; to: JsonValue }
  | { add: string; by: number }
  | { push: string; value: JsonValue }
  /** A step event game code handles. */
  | { emit: string; data?: JsonValue };

/** An atlas frame or a texture a speaker or a line shows. */
export type DialoguePortrait = { asset: AssetId; frame?: string };

export type DialogueLine = {
  speaker?: string;
  /** A string key; `say` is literal text for prototypes. */
  text?: string;
  say?: string;
  voice?: AssetId;
  portrait?: DialoguePortrait;
  if?: DialogueCondition;
  /** `{name}` → a JSON pointer into the variables. */
  vars?: Readonly<Record<string, string>>;
};

export type DialogueChoice = {
  text?: string;
  say?: string;
  to: string;
  if?: DialogueCondition;
  do?: readonly DialogueEffect[];
  /** What a choice whose `if` fails does: hidden, or shown disabled. Default hide. */
  hidden?: "hide" | "disable";
};

export type DialogueNode = {
  id: string;
  lines: readonly DialogueLine[];
  choices?: readonly DialogueChoice[];
  /** Without choices: the next node. */
  next?: string;
  /** Effects when the node is entered. */
  do?: readonly DialogueEffect[];
  /** Entering a node whose `if` fails goes to `else`. */
  if?: DialogueCondition;
  else?: string;
  /** Ends the conversation with this ending's name. */
  end?: string;
};

export type DialogueSpeaker = { id: string; name: string; portrait?: DialoguePortrait };

/** A `dialogue:v1` file. */
export type DialogueFile = {
  $schema?: string;
  kind: typeof DIALOGUE_KIND;
  v: typeof DIALOGUE_VERSION;
  start: string;
  speakers?: DialogueSpeaker[];
  nodes: DialogueNode[];
};

/** A JSON Pointer into the dialogue's variables, e.g. `/gold` or `/flags/gate-open`. */
const POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)+$/;

const jsonValue = z.json().describe("Any JSON value.") as z.ZodType<JsonValue>;
const pointer = (description: string) =>
  z
    .string()
    .regex(POINTER_PATTERN, {
      error: 'a variable is a JSON Pointer, such as "/gold" or "/flags/gate-open"',
    })
    .describe(description);
const nodeId = (description: string) => z.string().regex(ID_PATTERN).describe(description);
const stringKey = (description: string) =>
  z.string().regex(STRING_KEY_PATTERN).describe(description);

const conditionSchema: z.ZodType<DialogueCondition> = z
  .lazy(() =>
    z.union([
      z
        .strictObject({
          var: pointer("The variable it reads, a JSON Pointer."),
          eq: jsonValue.optional().describe("True when the value equals this."),
          ne: jsonValue.optional().describe("True when the value differs from this."),
          gt: z.number().optional().describe("True when the value is a number above this."),
          gte: z.number().optional().describe("True when the value is a number at or above this."),
          lt: z.number().optional().describe("True when the value is a number below this."),
          lte: z.number().optional().describe("True when the value is a number at or below this."),
          truthy: z
            .boolean()
            .optional()
            .describe("True when the value is (or, with false, isn't) truthy."),
        })
        .describe("A test of one variable; every bound given must hold."),
      z
        .strictObject({ all: z.array(conditionSchema).describe("Every one must hold.") })
        .describe("All of several conditions."),
      z
        .strictObject({ any: z.array(conditionSchema).describe("At least one must hold.") })
        .describe("Any of several conditions."),
      z.strictObject({ not: conditionSchema }).describe("The opposite of a condition."),
      z
        .strictObject({ visited: nodeId("A node seen in this conversation or saved history.") })
        .describe("Whether a node was seen."),
    ]),
  )
  .describe("A condition over the dialogue's variables.")
  .meta({ id: "DialogueCondition" }) as unknown as z.ZodType<DialogueCondition>;

const effectSchema: z.ZodType<DialogueEffect> = z
  .union([
    z
      .strictObject({
        set: pointer("The variable it sets."),
        to: jsonValue.describe("Its new value."),
      })
      .describe("Sets a variable."),
    z
      .strictObject({
        add: pointer("The number variable it adds to."),
        by: z.number().describe("What it adds; negative subtracts."),
      })
      .describe("Adds to a number variable."),
    z
      .strictObject({
        push: pointer("The list variable it appends to."),
        value: jsonValue.describe("What it appends."),
      })
      .describe("Appends to a list variable."),
    z
      .strictObject({
        emit: z.string().min(1).describe("The step event's type."),
        data: jsonValue.optional().describe("The event's data."),
      })
      .describe("Raises a step event game code handles."),
  ])
  .describe("An effect on the dialogue's variables, or a step event.")
  .meta({ id: "DialogueEffect" }) as unknown as z.ZodType<DialogueEffect>;

const portraitSchema = z
  .strictObject({
    asset: z.string().regex(ID_PATTERN).describe("A texture or an atlas."),
    frame: z.string().optional().describe("With an atlas: the frame it shows."),
  })
  .describe("A portrait: a texture, or an atlas frame.");

const lineSchema = z
  .strictObject({
    speaker: nodeId("A speaker's id.").optional(),
    text: stringKey("A string key for the line's text.").optional(),
    say: z.string().optional().describe("Literal text, for prototypes; `text` wins."),
    voice: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe("A sound or clip played with the line."),
    portrait: portraitSchema.optional(),
    if: conditionSchema.optional().describe("The line shows only when this holds."),
    vars: z
      .record(z.string(), pointer("The variable it fills in."))
      .optional()
      .describe("`{name}` placeholders and the variables that fill them."),
  })
  .describe("One line of a node.");

const choiceSchema = z
  .strictObject({
    text: stringKey("A string key for the choice's text.").optional(),
    say: z.string().optional().describe("Literal text, for prototypes; `text` wins."),
    to: nodeId("The node it leads to."),
    if: conditionSchema.optional().describe("The choice is offered only when this holds."),
    do: z.array(effectSchema).optional().describe("Effects when it is picked."),
    hidden: z
      .enum(["hide", "disable"])
      .optional()
      .describe("When its `if` fails: hidden, or shown disabled. Default hide."),
  })
  .describe("One choice after a node's last line.");

const nodeSchema = z
  .strictObject({
    id: nodeId("The node's id, which `start`, `to`, `next` and `else` name."),
    lines: z.array(lineSchema).describe("Its lines, shown in order."),
    choices: z.array(choiceSchema).optional().describe("Offered after its last line."),
    next: nodeId("Without choices: the next node.").optional(),
    do: z.array(effectSchema).optional().describe("Effects when the node is entered."),
    if: conditionSchema.optional().describe("Entering a node whose `if` fails goes to `else`."),
    else: nodeId("Where a failed `if` goes.").optional(),
    end: z
      .string()
      .min(1)
      .optional()
      .describe("Ends the conversation after its lines, with this ending's name."),
  })
  .describe("One node of the conversation.");

const dialogueSchema: z.ZodType<DialogueFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The dialogue JSON Schema this file follows."),
    kind: z.literal(DIALOGUE_KIND).describe('Always "dialogue".'),
    v: z.literal(DIALOGUE_VERSION).describe("Dialogue format version."),
    start: nodeId("The node it starts at."),
    speakers: z
      .array(
        z
          .strictObject({
            id: nodeId("The id lines name."),
            name: stringKey("A string key for the speaker's name."),
            portrait: portraitSchema.optional(),
          })
          .describe("One speaker."),
      )
      .optional()
      .describe("Who speaks, by id."),
    nodes: z.array(nodeSchema).describe("The conversation's nodes, by id."),
  })
  .describe(
    "A conversation: nodes of lines by string key, choices, conditions and effects over JSON variables. Advanced only by recorded commands.",
  ) as unknown as z.ZodType<DialogueFile>;

/** One way out of a node: the node `to` names, and the pointer segments of the field naming it. */
export type DialogueExit = { to: string; at: readonly (string | number)[] };

const PORTRAIT_KINDS = [ATLAS_KIND, TEXTURE_KIND];
const VOICE_KINDS = [SOUND_KIND, AUDIO_KIND];

/** A pointer into a node by id, as refs and the string checks give it. */
const nodeAt = (id: string, ...rest: (string | number)[]) =>
  jsonPointer(["nodes", `@${id}`, ...rest]);
/** A pointer into a node by index, which the file's text locates a line for. */
const nodeIndexAt = (index: number, ...rest: (string | number)[]) =>
  jsonPointer(["nodes", index, ...rest]);

/** The nodes a node can go to, in order: its choices' `to`, then `next`, then `else`. */
export function dialogueExits(node: DialogueNode): DialogueExit[] {
  const out: DialogueExit[] = [];
  node.choices?.forEach((choice, i) => out.push({ to: choice.to, at: ["choices", i, "to"] }));
  if (node.next !== undefined) out.push({ to: node.next, at: ["next"] });
  if (node.else !== undefined) out.push({ to: node.else, at: ["else"] });
  return out;
}

/** The file's nodes by id; of two nodes with one id, the first. */
export function dialogueNodes(file: DialogueFile): Map<string, DialogueNode> {
  const out = new Map<string, DialogueNode>();
  for (const node of file.nodes) if (!out.has(node.id)) out.set(node.id, node);
  return out;
}

/** Every node a path from `start` reaches, `start` first, breadth-first; empty when `start` names no node. */
export function reachableNodes(file: DialogueFile): Set<string> {
  const nodes = dialogueNodes(file);
  const seen = new Set<string>();
  if (!nodes.has(file.start)) return seen;
  const queue = [file.start];
  seen.add(file.start);
  for (let i = 0; i < queue.length; i++) {
    const node = nodes.get(queue[i]!);
    for (const { to } of node ? dialogueExits(node) : [])
      if (nodes.has(to) && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
  }
  return seen;
}

/**
 * How a node can stall. "none": it has no choices, no `next` and no `end`,
 * so the conversation stops with no ending. "guarded": it has only
 * choices, and every one has an `if`, so with all of them failing nothing
 * is offered. A choice without `if`, or the node's `next` or `end`, is the
 * fallback. Null when it can't stall.
 */
export function dialogueDeadEnd(node: DialogueNode): "none" | "guarded" | null {
  if (node.next !== undefined || node.end !== undefined) return null;
  const choices = node.choices ?? [];
  if (choices.length === 0) return "none";
  return choices.every((c) => c.if !== undefined) ? "guarded" : null;
}

/**
 * Where the runner goes from `node` without showing a line or waiting on
 * the player: `else` when its `if` fails, and `next` when it may show no
 * line and offer no choice.
 */
function quietExits(node: DialogueNode): string[] {
  const out: string[] = [];
  if (node.if && node.else !== undefined) out.push(node.else);
  const silent = node.lines.every((l) => l.if !== undefined);
  const noChoice = (node.choices ?? []).every((c) => c.if !== undefined);
  if (silent && noChoice && node.next !== undefined) out.push(node.next);
  return out;
}

/**
 * The loops the runner can go round without showing a line or offering a
 * choice, each as its nodes in file order. "certain": every node in it has
 * no `if`, no lines and no choices, so entering it always stalls.
 */
function quietLoops(file: DialogueFile): { nodes: string[]; certain: boolean }[] {
  const nodes = dialogueNodes(file);
  const reach = new Map<string, Set<string>>();
  const reachOf = (from: string): Set<string> => {
    let seen = reach.get(from);
    if (seen) return seen;
    seen = new Set<string>();
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const node = nodes.get(queue[i]!);
      for (const to of node ? quietExits(node) : [])
        if (nodes.has(to) && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
    }
    reach.set(from, seen);
    return seen;
  };
  const placed = new Set<string>();
  const out: { nodes: string[]; certain: boolean }[] = [];
  for (const id of nodes.keys()) {
    if (placed.has(id) || !reachOf(id).has(id)) continue;
    const loop = [...nodes.keys()].filter((m) => reachOf(id).has(m) && reachOf(m).has(id));
    for (const m of loop) placed.add(m);
    const certain = loop.every((m) => {
      const n = nodes.get(m)!;
      return !n.if && n.lines.length === 0 && (n.choices ?? []).length === 0;
    });
    out.push({ nodes: loop, certain });
  }
  return out;
}

/**
 * A dialogue's graph checks, which need no other doc: `asset-missing`
 * (`detail.kind: "node"`) for a `start`, `to`, `next` or `else` naming no
 * node; `dialogue-dead-end` for a node that can stall (an error, or a
 * warning when only conditions can strand it: its choices' `if`s, its own
 * `if` with no `else`, or a loop of nodes that may show nothing);
 * `dialogue-unreachable` for a node no path from `start` reaches. Paths
 * point into the file by node index. Never throws.
 */
export function dialogueIssues(file: DialogueFile): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const nodes = dialogueNodes(file);
  const ids = [...nodes.keys()];
  const missing = (to: string, path: string, who: string) =>
    issues.push(
      makeIssue("asset-missing", {
        message: `${who} names node "${to}", which the dialogue doesn't have${didYouMean(to, ids)}`,
        path,
        got: to,
        detail: { kind: "node" },
      }),
    );
  if (!nodes.has(file.start)) missing(file.start, "/start", "`start`");
  const reached = nodes.has(file.start) ? reachableNodes(file) : null;
  file.nodes.forEach((node, n) => {
    for (const exit of dialogueExits(node))
      if (!nodes.has(exit.to)) missing(exit.to, nodeIndexAt(n, ...exit.at), `node "${node.id}"`);
    const dead = dialogueDeadEnd(node);
    if (dead === "none")
      issues.push(
        makeIssue("dialogue-dead-end", {
          message: `node "${node.id}" has no choices, no \`next\` and no \`end\`, so the conversation stops there without an ending`,
          path: nodeIndexAt(n),
        }),
      );
    else if (dead === "guarded")
      issues.push(
        makeIssue("dialogue-dead-end", {
          severity: "warn",
          message: `every choice of node "${node.id}" has an \`if\`, so when they all fail nothing is offered`,
          path: nodeIndexAt(n, "choices"),
          hint: "Give one choice no `if`, or give the node a `next` or an `end` to fall back on.",
        }),
      );
    if (node.if && node.else === undefined)
      issues.push(
        makeIssue("dialogue-dead-end", {
          severity: "warn",
          message: `node "${node.id}" has an \`if\` and no \`else\`, so entering it when the \`if\` fails stops the conversation`,
          path: nodeIndexAt(n, "if"),
          hint: "Give the node an `else`, or put the condition on the choices that lead to it.",
        }),
      );
    if (reached && !reached.has(node.id))
      issues.push(
        makeIssue("dialogue-unreachable", {
          message: `no path from \`start\` ("${file.start}") reaches node "${node.id}"`,
          path: nodeIndexAt(n),
        }),
      );
  });
  const index = new Map<string, number>();
  file.nodes.forEach((node, n) => {
    if (!index.has(node.id)) index.set(node.id, n);
  });
  for (const loop of quietLoops(file)) {
    const named = loop.nodes.map((id) => `"${id}"`).join(", ");
    const message =
      loop.nodes.length === 1
        ? `node ${named} can pass back to itself without showing a line or offering a choice, so the conversation stops there`
        : `nodes ${named} can pass on round each other without showing a line or offering a choice, so the conversation stops there`;
    issues.push(
      makeIssue("dialogue-dead-end", {
        ...(!loop.certain && { severity: "warn" as const }),
        message,
        path: nodeIndexAt(index.get(loop.nodes[0]!)!),
        hint: "Give one of them a line, a choice without `if`, or an `end` in place of `next`.",
      }),
    );
  }
  return issues;
}

/**
 * A dialogue's string checks over the project: `string-key-missing` for a
 * line's, a choice's or a speaker's key with no text in a locale (along its
 * fallback chain) through the shared `docStringKeyIssues`, an error for the
 * default locale and info for the others; and a warning for a line or
 * choice that shows literal `say` text with no key, which no locale
 * translates.
 */
export function dialogueStringIssues(file: DialogueFile, lookup: DocLookup): SceneIssue[] {
  const issues = docStringKeyIssues(DIALOGUE_KIND, file, lookup);
  file.nodes.forEach((node, index) => {
    const literal = (
      item: { text?: string; say?: string },
      at: (string | number)[],
      who: string,
    ) => {
      if (item.say !== undefined && item.text === undefined)
        issues.push(
          makeIssue("string-key-missing", {
            severity: "warn",
            message: `${who} of node "${node.id}" shows literal \`say\` text, which no locale translates`,
            path: nodeIndexAt(index, ...at, "say"),
            hint: "Move the text to a strings file and name its key in `text`.",
          }),
        );
    };
    node.lines.forEach((line, i) => literal(line, ["lines", i], `line ${i}`));
    node.choices?.forEach((choice, i) => literal(choice, ["choices", i], `choice ${i}`));
  });
  return issues;
}

/** Portraits (a speaker's or a line's) name an atlas or a texture; a line's voice, a sound or an audio clip. */
export function dialogueRefs(file: DialogueFile): RefSite[] {
  const out: RefSite[] = [];
  for (const speaker of file.speakers ?? [])
    if (speaker.portrait)
      out.push({
        pointer: jsonPointer(["speakers", `@${speaker.id}`, "portrait", "asset"]),
        id: speaker.portrait.asset,
        kinds: PORTRAIT_KINDS,
      });
  for (const node of file.nodes)
    node.lines.forEach((line, i) => {
      if (line.portrait)
        out.push({
          pointer: nodeAt(node.id, "lines", i, "portrait", "asset"),
          id: line.portrait.asset,
          kinds: PORTRAIT_KINDS,
        });
      if (line.voice !== undefined)
        out.push({
          pointer: nodeAt(node.id, "lines", i, "voice"),
          id: line.voice,
          kinds: VOICE_KINDS,
        });
    });
  return out;
}

/** Conversations the dialogue runner plays; simulation data. */
export const dialogueKind = defineAssetKind({
  kind: DIALOGUE_KIND,
  title: "Dialogue",
  description:
    "A conversation: nodes of lines by string key, choices, conditions and effects, advanced only by recorded commands.",
  match: { jsonKind: DIALOGUE_KIND },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "doc",
  runtime: "sim",
  version: DIALOGUE_VERSION,
  schemaId: DIALOGUE_SCHEMA_ID,
  schema: () => dialogueSchema,
  layout: {
    as: "map",
    fields: {
      speakers: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } },
      nodes: {
        as: "keyed",
        item: {
          as: "map",
          fields: {
            lines: { as: "list", item: { as: "atomic" } },
            choices: { as: "list", item: { as: "atomic" } },
          },
          rest: { as: "atomic" },
        },
      },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 524_288, maxItems: 4_096 },
  validate: (file: DialogueFile): SceneIssue[] => dialogueIssues(file),
  crossValidate: (file: DialogueFile, lookup: DocLookup): SceneIssue[] =>
    dialogueStringIssues(file, lookup),
  refs: (file: DialogueFile): RefSite[] => dialogueRefs(file),
  /** One node that ends at once. */
  empty: (): DialogueFile => ({
    kind: DIALOGUE_KIND,
    v: DIALOGUE_VERSION,
    start: "start",
    nodes: [{ id: "start", lines: [], end: "done" }],
  }),
});
