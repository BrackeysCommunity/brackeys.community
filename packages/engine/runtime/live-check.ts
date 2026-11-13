import { LIVE_CHECK_AGAIN_TICKS, type LiveDeclaration } from "../game/live";
import type { EngineContext, Registry } from "../game/types";
import { stableJson } from "../project/canonical";
import type { AssetId } from "../project/types";
import type { SceneIssue } from "../scene/types";
import { liveCheckThrew } from "./live";

/** When the first live check runs, as its issues word it. */
export const LIVE_CHECK_RIGHT_AFTER = "right after the swap";

/** When a later live check runs, as its issues word it: `60 ticks after the swap`. */
export const afterSwapWords = (ticks: number): string => `${ticks} ticks after the swap`;

/** The tick at which the game's live check runs again after a swap at `swapTick`. */
export const liveRecheckAt = (swapTick: number): number => swapTick + LIVE_CHECK_AGAIN_TICKS;

/**
 * The game's `live.check` issues against `ctx`, run `when` (`right after the
 * swap`, `60 ticks after the swap`). A throwing check is one issue saying so;
 * a game that declares no check has none.
 */
export function runLiveCheck(
  declared: LiveDeclaration | null | undefined,
  ctx: EngineContext,
  when: string,
  scene: AssetId,
  registry: Registry,
): SceneIssue[] {
  if (!declared?.check) return [];
  try {
    return [...declared.check(ctx)];
  } catch (err) {
    return [liveCheckThrew(err, when, scene, registry)];
  }
}

/** `into` with each issue of `more` it doesn't hold yet, each kept once. */
export function mergeIssues(
  into: readonly SceneIssue[],
  more: readonly SceneIssue[],
): SceneIssue[] {
  const seen = new Set(into.map((i) => stableJson(i)));
  const out = [...into];
  for (const issue of more) {
    const key = stableJson(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
