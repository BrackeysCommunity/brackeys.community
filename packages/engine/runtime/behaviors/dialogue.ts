/**
 * The runtime's dialogue system: the one active conversation behind
 * `ctx.dialogue`. Not a behavior, since no block carries it; the runtime
 * builds it and hands it each tick's dialogue commands before the game's
 * `beforeStep`. Dialogue is simulation: only those recorded commands move
 * it, and its state joins world saves under `SAVE_DIALOGUE_KEY`.
 */
import { createDialogueRunner, type DialogueRunner } from "../../dialogue/runner";
import { persistVars, type DialogueVars } from "../../dialogue/vars";
import { DIALOGUE_ADVANCE_COMMAND, isDialogueCommand } from "../../game/commands";
import type { DialogueContext, EngineContext, GameCommand, JsonValue } from "../../game/types";
import { isPlainObject } from "../../project/kinds/define";
import {
  DIALOGUE_KIND,
  dialogueNodes,
  type DialogueFile,
  type DialogueNode,
} from "../../project/kinds/dialogue";
import type { AssetId } from "../../project/types";
import { errorText } from "../../scene/issues";
import { DIALOGUE_END, DIALOGUE_LINE, type DialogueLineEvent } from "../types";

/** The `world.systems` key a world save keeps the active conversation under; `@` can't begin an entity id. */
export const SAVE_DIALOGUE_KEY = "@dialogue";

/** The presentation key a dialogue line's voice plays under, so the next line can stop it. */
export const DIALOGUE_VOICE_KEY = "dialogue-voice";

/** Where the dialogue system lives on its runtime's context, kept off the public `EngineContext`. */
export const DIALOGUE_SYSTEM: unique symbol = Symbol("dialogue system");

/** What the dialogue system reads and writes in its runtime. */
export type DialogueHost = Pick<EngineContext, "project" | "persist" | "emit" | "present">;

export type DialogueSystem = DialogueContext & {
  /** The tick's commands; the dialogue's own are applied, the rest left alone. */
  commands(commands: readonly GameCommand[]): void;
  /** True while the active conversation reads variables a save can't carry (given to `start`). */
  unsaveable(): boolean;
  /** The active conversation's state for a world save; undefined with none. */
  save(): JsonValue | undefined;
  /**
   * Puts a saved conversation back, raising no event: why it couldn't, else
   * null. Undefined, a save without one, ends whatever conversation the
   * fresh load started and cuts its voice.
   */
  restore(state: JsonValue | undefined): string | null;
  /** Ends any conversation silently, as an unload does. */
  clear(): void;
};

/** The dialogue system of the runtime whose context is `ctx`. */
export const dialogueSystemOf = (ctx: EngineContext): DialogueSystem | undefined =>
  (ctx as EngineContext & { [DIALOGUE_SYSTEM]?: DialogueSystem })[DIALOGUE_SYSTEM];

type Active = {
  id: AssetId;
  runner: DialogueRunner;
  /** The variables came from `start`'s `vars`, not `persist`. */
  custom: boolean;
};

type SavedDialogue = { dialogue: AssetId; runner: JsonValue; voiced?: true };

export function createDialogueSystem(opts: {
  dev: boolean;
  /** The runtime's context, read lazily: the system is built before it. */
  ctx: () => DialogueHost;
}): DialogueSystem {
  const warn = (message: string) => {
    if (opts.dev) console.warn(`[dialogue] ${message}`);
  };
  let active: Active | null = null;
  /** A line's voice may still be playing under `DIALOGUE_VOICE_KEY`. */
  let voiced = false;
  /** While a saved conversation is rebuilt, its runner's effects and events go nowhere. */
  let quiet = false;

  const fileOf = (id: AssetId): DialogueFile | undefined =>
    opts.ctx().project?.doc?.<DialogueFile>(DIALOGUE_KIND, id);

  function quietVars(vars: DialogueVars): DialogueVars {
    return {
      get: (pointer) => vars.get(pointer),
      set: (pointer, value) => {
        if (!quiet) vars.set(pointer, value);
      },
    };
  }

  function stopVoice(): void {
    if (voiced) opts.ctx().present.audio.stop(DIALOGUE_VOICE_KEY);
    voiced = false;
  }

  /** A shown line cuts the last line's voice and plays its own, captioned by its text key. */
  function voiceLine(nodes: ReadonlyMap<string, DialogueNode>, shown: DialogueLineEvent): void {
    stopVoice();
    const line = nodes.get(shown.node)?.lines[shown.line];
    if (line?.voice === undefined) return;
    opts.ctx().present.audio.play(line.voice, {
      key: DIALOGUE_VOICE_KEY,
      ...(line.text !== undefined ? { caption: line.text } : {}),
    });
    voiced = true;
  }

  function build(
    id: AssetId,
    file: DialogueFile,
    vars: DialogueVars,
    node: string | undefined,
  ): DialogueRunner {
    const nodes = dialogueNodes(file);
    const emit = (type: string, data?: JsonValue) => {
      if (quiet) return;
      if (type === DIALOGUE_LINE) voiceLine(nodes, data as DialogueLineEvent);
      else if (type === DIALOGUE_END) stopVoice();
      opts.ctx().emit({ type, at: { x: 0, y: 0 }, ...(data !== undefined ? { data } : {}) });
    };
    return createDialogueRunner(
      file,
      id,
      quietVars(vars),
      emit,
      node !== undefined ? { node } : undefined,
    );
  }

  /** An ended conversation is no longer active. */
  function settle(): void {
    if (active && active.runner.view().ended !== null) active = null;
  }

  function start(id: AssetId, startOpts: Parameters<DialogueContext["start"]>[1] = {}): void {
    const file = fileOf(id);
    if (!file) {
      warn(`start("${id}") ignored: the project has no dialogue "${id}"`);
      return;
    }
    if (active) {
      warn(`start("${id}") replaces the running dialogue "${active.id}"`);
      active = null;
      stopVoice();
    }
    const custom = startOpts.vars !== undefined;
    const vars = startOpts.vars ?? persistVars(opts.ctx());
    active = { id, runner: build(id, file, vars, startOpts.node), custom };
    settle();
  }

  function apply(command: GameCommand): void {
    const conv = active;
    if (!conv) {
      warn(`${command.name} ignored: no dialogue is running`);
      return;
    }
    if (command.name === DIALOGUE_ADVANCE_COMMAND) {
      if (conv.runner.advance()) settle();
      else warn(`${command.name} ignored: "${conv.id}" has no next line to show`);
      return;
    }
    const choice = (command.args as { choice?: unknown } | undefined)?.choice;
    if (typeof choice === "number" && conv.runner.choose(choice)) {
      settle();
      return;
    }
    warn(
      `${command.name} ignored: ${JSON.stringify(choice)} isn't a visible, enabled choice of "${conv.id}"`,
    );
  }

  return {
    start,
    view: () => active?.runner.view() ?? null,
    stop() {
      if (!active) {
        warn("stop() ignored: no dialogue is running");
        return;
      }
      active = null;
      stopVoice();
    },
    commands(commands) {
      for (const c of commands) if (isDialogueCommand(c.name)) apply(c);
    },
    unsaveable: () => active?.custom ?? false,
    save() {
      if (!active) return undefined;
      const saved: SavedDialogue = {
        dialogue: active.id,
        runner: active.runner.save(),
        ...(voiced ? { voiced: true as const } : {}),
      };
      return saved as unknown as JsonValue;
    },
    restore(state) {
      active = null;
      if (state === undefined) {
        stopVoice();
        return null;
      }
      voiced = false;
      if (!isPlainObject(state) || typeof state.dialogue !== "string" || !("runner" in state)) {
        return "the saved conversation isn't a dialogue system's state";
      }
      const saved = state as unknown as SavedDialogue;
      const file = fileOf(saved.dialogue);
      if (!file) return `the project has no dialogue "${saved.dialogue}" to continue`;
      quiet = true;
      try {
        const runner = build(saved.dialogue, file, persistVars(opts.ctx()), undefined);
        runner.restore(saved.runner);
        active = { id: saved.dialogue, runner, custom: false };
      } catch (err) {
        return `the saved conversation of "${saved.dialogue}" couldn't be put back: ${errorText(err)}`;
      } finally {
        quiet = false;
      }
      voiced = saved.voiced === true;
      return null;
    },
    clear() {
      active = null;
      voiced = false;
    },
  };
}
