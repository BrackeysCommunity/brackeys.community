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
 * The commands the game says a run may send now (`GamePlayDef.commands`),
 * in its order, cut at `limit` (default `LEGAL_LIMIT`) with
 * `legalTruncated` beyond; null when the game lists none. Every report,
 * fuzz and the CLI read the list through this.
 */
export function legalCommands<S>(
  play: GamePlayDef<S> | null | undefined,
  state: PlayState<S>,
  limit: number = LEGAL_LIMIT,
): LegalCommands | null {
  if (!play?.commands) return null;
  const all = play.commands(state);
  const legal = all.slice(0, limit);
  return all.length > limit ? { legal, legalTruncated: true } : { legal };
}

/** A just-loaded run's state, before its first tick: tick −1, no events. */
export function startState(runtime: SceneRuntimeHandle): PlayState {
  return { tick: -1, snapshot: runtime.snapshot(), events: [], world: playWorld(runtime.ctx) };
}
