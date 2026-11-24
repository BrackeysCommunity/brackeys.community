import type { CitedSentence } from "../check.ts";
import type { UseSpec } from "../types.ts";
import { type Told, type ToldCap, toldFacts, toldUse } from "./chronicle.ts";

export interface StageIn extends Told {
  /** The fact's kind: a stage, trouble or arc ended, or a season's finale or close. */
  kind: string;
}

export const STAGE_CAP: ToldCap = { sentences: 2, chars: 320 };

const STAGE_RULES = `You write the line the events channel shows under a card, for everyone in a Discord server to read. Fact #1 is what just happened: a stage of a story, a trouble at a settlement or a whole arc decided, or a season's finale or close. Any fact after it is what led to it.
Tell what happened first, then what led to it.`;

/** A stage ending, a trouble decided, an arc's end or a season's turn, retold with its cause (GDD 15.2). */
export const stageUse: UseSpec<StageIn, CitedSentence[]> = toldUse<StageIn>(
  "stage",
  1,
  STAGE_CAP,
  STAGE_RULES,
  (i) => ({ kind: i.kind, facts: toldFacts(i.facts), names: i.names }),
  () => [],
);
