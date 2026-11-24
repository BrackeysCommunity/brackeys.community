import type { CitedSentence } from "../check.ts";
import type { UseSpec } from "../types.ts";
import { type Told, type ToldCap, toldFacts, toldUse } from "./chronicle.ts";

export interface RecapIn extends Told {
  /** The world day now. */
  day: number;
  /** How many lighter lines there were beyond these. */
  more: number;
}

export const RECAP_CAP: ToldCap = { sentences: 5, chars: 700 };

const RECAP_RULES = `You write "since you left" for one player coming back to the game, shown only to them. Each fact is something that happened to their character, or near them, while they were away; what cost them comes first, then what paid them, then the world near them.
Tell it as the card does, about their own character as "you". That is the only way you speak to the reader: you still give no advice and urge nothing.
Only the heaviest lines are listed. Never say that others exist or how many there were.`;

/** Since you left, retold on a return after hours away (GDD 15.2). */
export const recapUse: UseSpec<RecapIn, CitedSentence[]> = toldUse<RecapIn>(
  "recap",
  1,
  RECAP_CAP,
  RECAP_RULES,
  (i) => ({ day: i.day, facts: toldFacts(i.facts), names: i.names, more: i.more }),
  () => [],
);
