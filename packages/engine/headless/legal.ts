import type { DialogueView } from "../dialogue/runner";
import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../game/commands";
import type { GameCommand, GamePlayDef, PlayState } from "../game/types";
import { playWorld } from "../runtime/play-session";
import type { SceneRuntimeHandle } from "../runtime/types";

/** The most legal commands a report carries; `legalTruncated` marks a longer list. */
export const LEGAL_LIMIT = 64;

/** The legal-command fields of a step or playtest report. */
export type LegalCommands = {
  legal: GameCommand[];
  /** Present, and true, only when the game listed more than the limit. */
  legalTruncated?: true;
};

/**
 * The dialogue's commands legal now: each enabled `@dialogue-choose` once
 * the conversation offers choices, else `@dialogue-advance`; none with no
 * conversation running.
 */
export function dialogueCommands(view: Readonly<DialogueView> | null | undefined): GameCommand[] {
  if (!view || view.ended !== null) return [];
  if (!view.choices) return [{ name: DIALOGUE_ADVANCE_COMMAND }];
  return view.choices
    .filter((c) => c.enabled)
    .map((c) => ({ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: c.index } }));
}

/**
 * The commands a run may send now: the dialogue's (`dialogueCommands`),
 * then the game's (`GamePlayDef.commands`) in its order, cut at `limit`
 * (default `LEGAL_LIMIT`) with `legalTruncated` beyond; null when the game
 * lists none and no conversation takes a command. Every report, fuzz and
 * the CLI read the list through this.
 */
export function legalCommands<S>(
  play: GamePlayDef<S> | null | undefined,
  state: PlayState<S>,
  limit: number = LEGAL_LIMIT,
): LegalCommands | null {
  const talk = dialogueCommands(state.dialogue);
  if (!play?.commands && talk.length === 0) return null;
  const all = play?.commands ? [...talk, ...play.commands(state)] : talk;
  const legal = all.slice(0, limit);
  return all.length > limit ? { legal, legalTruncated: true } : { legal };
}

/** A just-loaded run's state, before its first tick: tick −1, no events. */
export function startState(runtime: SceneRuntimeHandle): PlayState {
  return {
    tick: -1,
    snapshot: runtime.snapshot(),
    events: [],
    world: playWorld(runtime.ctx),
    dialogue: runtime.ctx.dialogue.view(),
  };
}
