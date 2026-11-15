/** One conversation over a dialogue file and a variable host. Pure. */
import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../game/commands";
import type { GameCommand, JsonValue } from "../game/types";
import { cloneJson, sameValue } from "../project/canonical";
import { isPlainObject } from "../project/kinds/define";
import {
  dialogueNodes,
  type DialogueCondition,
  type DialogueEffect,
  type DialogueFile,
  type DialogueLine,
  type DialogueNode,
} from "../project/kinds/dialogue";
import type { AssetId } from "../project/types";
import { DIALOGUE_CHOICES, DIALOGUE_END, DIALOGUE_LINE } from "../runtime/types";
import type { DialogueVars } from "./vars";

/** How many lines `DialogueView.log` keeps. */
export const DIALOGUE_LOG_MAX = 200;

/** One choice as the player sees it; `index` is its place in the node's `choices`. */
export type DialogueViewChoice = { index: number; text?: string; say?: string; enabled: boolean };

/** One line shown so far in a conversation. */
export type DialogueLogEntry = {
  node: string;
  line: number;
  /** The speaker's name, a string key, as `current.speakerName`. */
  speaker?: string;
  text?: string;
  say?: string;
  /** The line's `{name}` values when it was shown, as `current.vars`. */
  vars?: Readonly<Record<string, string>>;
};

/** Where a conversation stands, as the store and the DOM helpers read it. */
export type DialogueView = {
  dialogue: AssetId;
  node: string;
  /** The line index in the node; -1 while the node has shown none. */
  line: number;
  /**
   * The line on screen, `{}` before any. `speakerName` is the speaker's
   * name (a string key); `portrait` falls back to the speaker's; `vars`
   * holds each `{name}`'s value as text, read when the line was shown.
   */
  current: DialogueLine & { speakerName?: string };
  /** Present after the node's last line, when it has choices. */
  choices: readonly DialogueViewChoice[] | null;
  /** Lines shown so far in this conversation, oldest first, at most 200. */
  log: readonly DialogueLogEntry[];
  ended: string | null;
  /** Stopped where the file gives no way on (a dead end, a missing node, a failed `if` with no `else`): it takes no command. */
  stuck?: true;
};

export interface DialogueRunner {
  view(): DialogueView;
  /** False when there was no next line to show. */
  advance(): boolean;
  /** False for a choice that isn't visible and enabled. */
  choose(index: number): boolean;
  save(): JsonValue;
  restore(state: JsonValue): void;
}

type RunnerState = {
  view: DialogueView;
  /** Nodes entered, first visit order, the saved history first. */
  visited: string[];
};

const SAVE_VERSION = 1;

function truthy(v: JsonValue | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== "";
}

const asText = (v: JsonValue): string => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * Starts a conversation at `opts.node` (default `start`) and shows its first
 * line; `emit` gets the effects' events and the runner's `dialogue:*`
 * events. `opts.visited` is the saved history `visited` conditions see.
 * With no way on, it stops with `stuck` set and `advance` answers false;
 * the kind's `dialogue-dead-end` check reports where that can happen.
 */
export function createDialogueRunner(
  file: DialogueFile,
  id: AssetId,
  vars: DialogueVars,
  emit: (type: string, data?: JsonValue) => void,
  opts?: { node?: string; visited?: readonly string[] },
): DialogueRunner {
  const nodes = dialogueNodes(file);
  const speakers = new Map((file.speakers ?? []).map((s) => [s.id, s]));
  let state: RunnerState = {
    view: {
      dialogue: id,
      node: opts?.node ?? file.start,
      line: -1,
      current: {},
      choices: null,
      log: [],
      ended: null,
    },
    visited: [...new Set(opts?.visited ?? [])],
  };

  const holds = (c: DialogueCondition): boolean => {
    if ("all" in c) return c.all.every(holds);
    if ("any" in c) return c.any.some(holds);
    if ("not" in c) return !holds(c.not);
    if ("visited" in c) return state.visited.includes(c.visited);
    const v = vars.get(c.var);
    const num = typeof v === "number" ? v : undefined;
    if (c.eq !== undefined && !sameValue(v, c.eq)) return false;
    if (c.ne !== undefined && sameValue(v, c.ne)) return false;
    if (c.gt !== undefined && !(num !== undefined && num > c.gt)) return false;
    if (c.gte !== undefined && !(num !== undefined && num >= c.gte)) return false;
    if (c.lt !== undefined && !(num !== undefined && num < c.lt)) return false;
    if (c.lte !== undefined && !(num !== undefined && num <= c.lte)) return false;
    if (c.truthy !== undefined && truthy(v) !== c.truthy) return false;
    return true;
  };

  const apply = (effects: readonly DialogueEffect[] | undefined) => {
    for (const e of effects ?? []) {
      if ("set" in e) vars.set(e.set, e.to);
      else if ("add" in e) {
        const v = vars.get(e.add);
        vars.set(e.add, (typeof v === "number" ? v : 0) + e.by);
      } else if ("push" in e) {
        const v = vars.get(e.push);
        vars.set(e.push, Array.isArray(v) ? [...v, e.value] : [e.value]);
      } else emit(e.emit, e.data);
    }
  };

  const nextLine = (node: DialogueNode, after: number): number => {
    for (let i = after + 1; i < node.lines.length; i++) {
      const cond = node.lines[i]!.if;
      if (!cond || holds(cond)) return i;
    }
    return -1;
  };

  const set = (patch: Partial<DialogueView>) => {
    state.view = { ...state.view, ...patch };
  };

  /** A choice of `node` the player could take now; without one its `next` or `end` goes on. */
  const canChoose = (node: DialogueNode): boolean =>
    node.choices?.some((c) => !c.if || holds(c.if)) ?? false;

  const offerChoices = (node: DialogueNode) => {
    const choices: DialogueViewChoice[] = [];
    node.choices?.forEach((choice, index) => {
      const ok = !choice.if || holds(choice.if);
      if (!ok && (choice.hidden ?? "hide") === "hide") return;
      choices.push({
        index,
        ...(choice.text !== undefined && { text: choice.text }),
        ...(choice.say !== undefined && { say: choice.say }),
        enabled: ok,
      });
    });
    set({ choices });
    emit(DIALOGUE_CHOICES, { dialogue: id, node: node.id, count: choices.length });
  };

  const show = (node: DialogueNode, index: number) => {
    const line = node.lines[index]!;
    const speaker = line.speaker === undefined ? undefined : speakers.get(line.speaker);
    let filled: Record<string, string> | undefined;
    if (line.vars) {
      filled = {};
      for (const [name, pointer] of Object.entries(line.vars)) {
        const v = vars.get(pointer);
        if (v !== undefined) filled[name] = asText(v);
      }
    }
    const portrait = line.portrait ?? speaker?.portrait;
    const current: DialogueView["current"] = {
      ...line,
      ...(speaker && { speakerName: speaker.name }),
      ...(portrait && { portrait }),
      ...(filled && { vars: filled }),
    };
    const entry: DialogueLogEntry = {
      node: node.id,
      line: index,
      ...(speaker && { speaker: speaker.name }),
      ...(line.text !== undefined && { text: line.text }),
      ...(line.say !== undefined && { say: line.say }),
      ...(filled && { vars: filled }),
    };
    const log = [...state.view.log, entry];
    if (log.length > DIALOGUE_LOG_MAX) log.splice(0, log.length - DIALOGUE_LOG_MAX);
    set({ node: node.id, line: index, current, log });
    emit(DIALOGUE_LINE, { dialogue: id, node: node.id, line: index });
    if (nextLine(node, index) < 0 && canChoose(node)) offerChoices(node);
  };

  /** Goes on from `node` after its last line: its choices while one can be taken, else `next` or `end`. */
  const leave = (node: DialogueNode, hops: number): boolean => {
    if (canChoose(node)) {
      offerChoices(node);
      return true;
    }
    if (node.next !== undefined) return enter(node.next, hops);
    if (node.end !== undefined) {
      set({ ended: node.end });
      emit(DIALOGUE_END, { dialogue: id, ending: node.end });
      return true;
    }
    set({ stuck: true });
    return false;
  };

  /**
   * Enters node `target` (through `else` when its `if` fails) and shows its
   * first line, passing through nodes that show none. A chain longer than
   * the file has nodes is a loop of lineless nodes, which stops it.
   */
  const enter = (target: string, hops = 0): boolean => {
    let to = target;
    for (; hops <= nodes.size; hops++) {
      const node = nodes.get(to);
      if (!node) break;
      if (node.if && !holds(node.if)) {
        if (node.else === undefined) break;
        to = node.else;
        continue;
      }
      if (!state.visited.includes(node.id)) state.visited.push(node.id);
      set({ node: node.id, line: -1, current: {}, choices: null });
      apply(node.do);
      const first = nextLine(node, -1);
      if (first >= 0) {
        show(node, first);
        return true;
      }
      return leave(node, hops + 1);
    }
    set({ node: to, line: -1, current: {}, choices: null, stuck: true });
    return false;
  };

  enter(state.view.node);

  return {
    view: () => state.view,
    advance() {
      const { view } = state;
      if (view.stuck || view.ended !== null || view.choices !== null) return false;
      const node = nodes.get(view.node);
      if (!node) return false;
      const next = nextLine(node, view.line);
      if (next >= 0) {
        show(node, next);
        return true;
      }
      return leave(node, 0);
    },
    choose(index) {
      const { view } = state;
      if (view.stuck || view.ended !== null) return false;
      if (!view.choices?.some((c) => c.index === index && c.enabled)) return false;
      const choice = nodes.get(view.node)?.choices?.[index];
      if (!choice) return false;
      set({ choices: null });
      apply(choice.do);
      enter(choice.to);
      return true;
    },
    save() {
      const { stuck, ...view } = state.view;
      return cloneJson({
        v: SAVE_VERSION,
        view,
        visited: state.visited,
        stuck: stuck === true,
      }) as unknown as JsonValue;
    },
    restore(saved) {
      state = parseSave(saved, id, nodes);
    },
  };
}

/**
 * Moves `runner` by `@dialogue-advance` or `@dialogue-choose`; false for any
 * other command and for one the runner refused (no next line, a choice that
 * isn't visible and enabled).
 */
export function applyDialogueCommand(runner: DialogueRunner, command: GameCommand): boolean {
  if (command.name === DIALOGUE_ADVANCE_COMMAND) return runner.advance();
  if (command.name !== DIALOGUE_CHOOSE_COMMAND) return false;
  const choice = (command.args as { choice?: unknown } | undefined)?.choice;
  return typeof choice === "number" && runner.choose(choice);
}

function parseSave(
  saved: JsonValue,
  id: AssetId,
  nodes: ReadonlyMap<string, DialogueNode>,
): RunnerState {
  function fail(why: string): never {
    throw new Error(`dialogue "${id}": can't restore this save: ${why}`);
  }
  if (!isPlainObject(saved) || saved.v !== SAVE_VERSION)
    fail(`it isn't a v${SAVE_VERSION} runner save`);
  const { view, visited, stuck } = saved as { view?: unknown; visited?: unknown; stuck?: unknown };
  if (!isPlainObject(view) || typeof view.node !== "string" || typeof view.line !== "number")
    fail("it holds no view");
  if (view.dialogue !== id) fail(`it is dialogue "${String(view.dialogue)}"'s`);
  if (!Array.isArray(view.log) || !isPlainObject(view.current)) fail("its view is malformed");
  if (!Array.isArray(visited) || !visited.every((v) => typeof v === "string"))
    fail("its visited list is malformed");
  if (stuck !== true && !nodes.has(view.node)) fail(`the dialogue has no node "${view.node}"`);
  const { stuck: _, ...shown } = cloneJson(view as unknown as DialogueView);
  return {
    view: stuck === true ? { ...shown, stuck: true } : shown,
    visited: [...(visited as string[])],
  };
}
