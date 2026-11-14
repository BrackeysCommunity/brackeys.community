import { clipFrameAt, resolveClips } from "@jams/engine/game";
import { animationIssues } from "@jams/engine/project";

import { bladeMoves, bladeSheet } from "./blade-game";

/** The blade's clips at a tick rate: frame lengths in whole ticks, and where `cut` is after 4 ticks. */
export function clipsAt(rate: number) {
  const { clips, issues } = resolveClips({ animation: bladeMoves }, bladeSheet, { rate });
  const cut = clips.get("cut")!;
  return {
    issues: issues.map((i) => i.code),
    rest: clips.get("rest")!.frames.map((f) => f.ticks),
    cut: cut.frames.map((f) => [f.frame, f.ticks, f.events] as const),
    length: cut.length,
    afterFour: clipFrameAt(cut, 4),
  };
}

/** A clip naming a tag the sheet lacks, and a `next` naming no clip. */
export function brokenMoves(): string[] {
  const broken = {
    ...bladeMoves,
    clips: [
      { name: "rest", tag: "idle" },
      { name: "cut", frames: [{ frame: "cut-0" }], loop: "once" as const, next: "recover" },
    ],
  };
  return animationIssues(broken, bladeSheet).map((i) => i.code);
}
