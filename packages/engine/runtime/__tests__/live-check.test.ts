import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { LIVE_CHECK_AGAIN_TICKS, type LiveDeclaration } from "../../game/live";
import type { EngineContext } from "../../game/types";
import { makeIssue } from "../../scene/issues";
import type { SceneIssue } from "../../scene/types";
import {
  afterSwapWords,
  LIVE_CHECK_RIGHT_AFTER,
  liveRecheckAt,
  mergeIssues,
  runLiveCheck,
} from "../live-check";

const registry = createRegistry();
const ctx = { tick: 7 } as unknown as EngineContext;
const issue = (message: string): SceneIssue =>
  makeIssue("live-swap-failed", { message, entityIds: [] });

describe("the shared live check", () => {
  it("returns the game's check issues, and none for a game without a check", () => {
    const seen: number[] = [];
    const declared: LiveDeclaration = {
      timings: ["now"],
      check: (c) => {
        seen.push(c.tick);
        return [issue("hazard")];
      },
    };
    expect(runLiveCheck(declared, ctx, LIVE_CHECK_RIGHT_AFTER, "hall", registry)).toEqual([
      issue("hazard"),
    ]);
    expect(seen).toEqual([7]);
    expect(
      runLiveCheck({ timings: ["now"] }, ctx, LIVE_CHECK_RIGHT_AFTER, "hall", registry),
    ).toEqual([]);
    expect(runLiveCheck(undefined, ctx, LIVE_CHECK_RIGHT_AFTER, "hall", registry)).toEqual([]);
  });

  it("turns a throwing check into one issue saying when it threw", () => {
    const declared: LiveDeclaration = {
      timings: ["now"],
      check: () => {
        throw new Error("no spawn to check");
      },
    };
    const [threw, ...rest] = runLiveCheck(declared, ctx, afterSwapWords(60), "hall", registry);
    expect(rest).toEqual([]);
    expect(threw).toMatchObject({
      code: "live-swap-failed",
      hint: "live.check threw 60 ticks after the swap: no spawn to check",
      detail: { phase: "after" },
    });
  });

  it("merges issues keeping each once, in the order first seen", () => {
    const a = issue("a");
    const b = issue("b");
    expect(mergeIssues([a], [{ ...a }, b, { ...b }])).toEqual([a, b]);
    expect(mergeIssues([], [])).toEqual([]);
  });

  it("runs the second check LIVE_CHECK_AGAIN_TICKS after the swap", () => {
    expect(liveRecheckAt(10)).toBe(10 + LIVE_CHECK_AGAIN_TICKS);
    expect(LIVE_CHECK_RIGHT_AFTER).toBe("right after the swap");
    expect(afterSwapWords(3)).toBe("3 ticks after the swap");
  });
});
