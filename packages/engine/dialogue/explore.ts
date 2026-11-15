/** Every ending a conversation can reach, by walking its choices. Pure. */
import type { JsonValue } from "../game/types";
import { stableJson } from "../project/canonical";
import { dialogueNodes, type DialogueFile } from "../project/kinds/dialogue";
import { DIALOGUE_CHOICES, DIALOGUE_LINE } from "../runtime/types";
import { createDialogueRunner, type DialogueRunner } from "./runner";
import { memoryVars } from "./vars";

/** One ending a walk reached, and the choice indices that reach it from `start`. */
export type DialogueEnding = { ending: string; path: readonly number[]; nodes: readonly string[] };

/** What a breadth-first walk of every choice found. */
export type DialogueExploration = {
  endings: readonly DialogueEnding[];
  /** True when `maxDepth`, the state cap, or a loop of lines with no choice cut a path short. */
  truncated: boolean;
};

const DEFAULT_MAX_DEPTH = 32;
/** The most distinct conversation states one walk opens. */
const MAX_STATES = 10_000;
/** The most lines one path shows: past it, the path is a loop with no choice in it. */
const MAX_ADVANCES = 10_000;

type Walk = { runner: DialogueRunner; vars: { readonly value: JsonValue }; nodes: string[] };

/** Plays `path` from `start` on fresh variables, advancing through lines; null when it never comes to rest. */
function replay(file: DialogueFile, vars: JsonValue, path: readonly number[]): Walk | null {
  const host = memoryVars(vars);
  const nodes: string[] = [];
  const note = (node: string) => {
    if (nodes.at(-1) !== node) nodes.push(node);
  };
  const runner = createDialogueRunner(file, file.start, host, (type, data) => {
    if (type === DIALOGUE_LINE || type === DIALOGUE_CHOICES) note((data as { node: string }).node);
  });
  let budget = MAX_ADVANCES;
  const rest = () => {
    for (;;) {
      const view = runner.view();
      if (view.ended !== null || view.choices !== null) return true;
      if (budget-- === 0) return false;
      if (!runner.advance()) return true;
    }
  };
  if (!rest()) return null;
  for (const choice of path) {
    runner.choose(choice);
    if (!rest()) return null;
  }
  const view = runner.view();
  if (view.ended !== null) note(view.node);
  return { runner, vars: host, nodes };
}

/** What two paths share when they stand at the same choices with the same history and variables. */
function stateKey(walk: Walk): string {
  const saved = walk.runner.save() as { visited?: string[] };
  const view = walk.runner.view();
  return stableJson({
    node: view.node,
    line: view.line,
    choices: view.choices,
    visited: [...(saved.visited ?? [])].sort(),
    vars: walk.vars.value,
  });
}

/**
 * Walks every choice breadth-first from `start` with the given variables
 * (default `{}`), through the dialogue runner, so conditions, effects and
 * `visited` decide what is offered as they do in play. Returns each
 * reachable ending once, with the shortest choice path (indices into the
 * node's `choices`) and the nodes it passes, in the order the walk found
 * them. A path stops at `maxDepth` choices (default 32); paths that reach
 * the same choices with the same history and variables are walked once.
 */
export function exploreDialogue(
  file: DialogueFile,
  opts?: { vars?: JsonValue; maxDepth?: number },
): DialogueExploration {
  const vars = opts?.vars ?? {};
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const endings = new Map<string, DialogueEnding>();
  let truncated = false;
  if (!dialogueNodes(file).has(file.start)) return { endings: [], truncated };
  const seen = new Set<string>();
  const queue: (readonly number[])[] = [[]];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i]!;
    const walk = replay(file, vars, path);
    if (!walk) {
      truncated = true;
      continue;
    }
    const view = walk.runner.view();
    if (view.ended !== null) {
      if (!endings.has(view.ended))
        endings.set(view.ended, { ending: view.ended, path, nodes: walk.nodes });
      continue;
    }
    const enabled = view.choices?.filter((c) => c.enabled) ?? [];
    if (enabled.length === 0) continue;
    const key = stateKey(walk);
    if (seen.has(key)) continue;
    if (path.length >= maxDepth || seen.size >= MAX_STATES) {
      truncated = true;
      continue;
    }
    seen.add(key);
    for (const choice of enabled) queue.push([...path, choice.index]);
  }
  return { endings: [...endings.values()], truncated };
}
