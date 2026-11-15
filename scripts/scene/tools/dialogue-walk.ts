import type { JsonValue } from "@jams/engine/game";
import { exploreDialogue, type DialogueEnding } from "@jams/engine/headless";
import { DIALOGUE_KIND, isPlainObject, projectView, type DialogueFile } from "@jams/engine/project";

import { failure, isToolResult, plural, usage, type Tool, type ToolResult } from "../context";
import { locateInProjects, scanProject } from "../projects";
import { loadProject } from "./project-show";

export const DIALOGUE_WALK_USAGE = "dialogue walk <id> [--vars json] [--project id]";

/** What `walkDialogue` found from the conversation's start with the given variables. */
export type DialogueWalk = {
  start: string;
  vars: JsonValue;
  endings: readonly DialogueEnding[];
  /** Endings the file's nodes name that no walked path reached, in node order. */
  unreached: readonly string[];
  truncated: boolean;
};

/**
 * Every ending a dialogue reaches from its start with `vars` (default
 * `{}`), through `exploreDialogue`: each with its choice path, the text key
 * of each choice and the nodes it passes, then the endings no path reached.
 */
export function walkDialogue(
  file: DialogueFile,
  opts: { vars?: JsonValue; maxDepth?: number } = {},
): DialogueWalk {
  const vars = opts.vars ?? {};
  const explored = exploreDialogue(file, {
    vars,
    ...(opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth }),
  });
  const { endings } = explored;
  const reached = new Set(endings.map((e) => e.ending));
  const named = file.nodes.flatMap((n) => (n.end === undefined ? [] : [n.end]));
  return {
    start: file.start,
    vars,
    endings,
    unreached: [...new Set(named.filter((end) => !reached.has(end)))],
    truncated: explored.truncated,
  };
}

/** `paid  choices 0 gate.pay  nodes gate > through`. */
function endingLine(e: DialogueEnding, width: number): string {
  const choices =
    e.path.length === 0
      ? "no choices"
      : `choices ${e.path.map((i, n) => `${i} ${e.choices[n] ?? "(no text)"}`).join(", ")}`;
  return `  ${e.ending.padEnd(width)}  ${choices}  nodes ${e.nodes.join(" > ")}`;
}

export function walkText(id: string, walk: DialogueWalk, maxDepth: number | undefined): string[] {
  const width = Math.max(0, ...walk.endings.map((e) => e.ending.length));
  return [
    `${id}: ${plural(walk.endings.length, "ending")} from ${walk.start}, vars ${JSON.stringify(walk.vars)}`,
    ...walk.endings.map((e) => endingLine(e, width)),
    ...(walk.unreached.length > 0 ? [`  not reached: ${walk.unreached.join(", ")}`] : []),
    ...(walk.truncated
      ? [
          `  truncated: a path ran past ${maxDepth === undefined ? "the depth limit" : plural(maxDepth, "choice")}, the walk's state cap or a loop of lines with no choice`,
        ]
      : []),
  ];
}

/** `--vars` as the variables a walk starts with: a JSON object, given as text or already parsed. */
function varsArg(vars: string | JsonValue | undefined): { vars: JsonValue } | ToolResult {
  if (vars === undefined) return { vars: {} };
  let parsed: unknown = vars;
  if (typeof vars === "string")
    try {
      parsed = JSON.parse(vars);
    } catch (e) {
      return usage(`--vars isn't JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  return isPlainObject(parsed)
    ? { vars: parsed as JsonValue }
    : usage('--vars takes a JSON object of the variables the walk starts with, e.g. {"gold":3}');
}

export type DialogueWalkInput = {
  id?: string;
  /** A JSON object, as text from the command line or parsed from an MCP call. */
  vars?: string | JsonValue;
  /** The most choices one path takes; `exploreDialogue`'s default when left out. */
  maxDepth?: number;
};

/**
 * `dialogue walk`: the dialogue `id` (looked up across projects,
 * `--project` picking one) walked by `walkDialogue`. An id that isn't a
 * dialogue, or one whose file doesn't parse, is a failure; vars that aren't
 * a JSON object are a usage error.
 */
export const dialogueWalk: Tool<DialogueWalkInput> = async (input, ctx) => {
  const { id, maxDepth } = input;
  if (id === undefined) return usage(DIALOGUE_WALK_USAGE);
  const read = varsArg(input.vars);
  if (isToolResult(read)) return read;
  const { vars } = read;
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0))
    return usage(`maxDepth takes a whole number of choices, 0 or more; got ${maxDepth}`);
  const found = await locateInProjects(
    ctx.projects,
    id,
    async (p) => projectView((await scanProject(p)).state, p.kinds).byId.has(id),
    ctx.project,
  );
  if (!found.ok)
    return found.exitCode === 2 ? usage(found.message) : failure(found.message, { id });
  const loaded = await loadProject(found.project);
  const project = found.project.file.id;
  const entry = loaded.view.byId.get(id);
  if (entry?.kind !== DIALOGUE_KIND)
    return failure(`"${id}" is a ${entry?.kind ?? "missing"} asset, not a ${DIALOGUE_KIND}`, {
      project,
      id,
    });
  const file = loaded.values.get(id) as DialogueFile | undefined;
  if (file === undefined)
    return failure(`${entry.path} doesn't parse as a ${DIALOGUE_KIND}; run validate`, {
      project,
      id,
    });
  const walk = walkDialogue(file, { vars, ...(maxDepth === undefined ? {} : { maxDepth }) });
  return {
    exitCode: 0,
    data: { ok: true, project, id, path: entry.path, ...walk },
    text: walkText(id, walk, maxDepth).join("\n"),
  };
};
