import type {
  CitedSentence,
  NarrateCtx,
  Narrator,
  PromptFact,
  UseSpec,
} from "../../../../packages/mmo-narrate/src/index.ts";
import { RECAP_AWAY_HOURS } from "../../../../packages/mmo-narrate/src/index.ts";
import {
  type ChronicleIn,
  chronicleUse,
} from "../../../../packages/mmo-narrate/src/uses/chronicle.ts";
import { type RecapIn, recapUse } from "../../../../packages/mmo-narrate/src/uses/recap.ts";
import { type StageIn, stageUse } from "../../../../packages/mmo-narrate/src/uses/stage.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";
import { type CausedEvent, TOLD_WITH_CAUSES } from "../events.ts";
import type { Lexicon } from "../lexicon.ts";
import { storyLine } from "../screens/common.ts";
import { recapLine } from "../screens/hub.ts";
import { chronicleLines, refsOf } from "../screens/story.ts";
import { withProse } from "./card.ts";
import { type DayClock, dayClock, type Narration } from "./hooks.ts";

/** The causes a stage ending is told with: its heaviest. */
const STAGE_CAUSES = 1;

/** The facts as the prompt numbers them, from #1 in the card's order. */
function numbered(lines: { fact: api.Fact; line: string; here?: boolean }[]): PromptFact[] {
  return lines.map((l, i) => ({
    n: i + 1,
    id: l.fact.id,
    kind: l.fact.kind,
    line: l.line,
    ...(l.here === undefined ? {} : { here: l.here }),
  }));
}

const prose = (s: readonly CitedSentence[]) => s.map((x) => x.text).join(" ");

/** A season's standing in words, with no numbers for the prose to repeat. */
const seasonWords = (s: api.Season) => (s.days ? s.band : "");

/** The chronicle's prompt: its lines as the post shows them, with the server's places marked. */
export function chronicleInput(ch: api.Chronicle, lex: Lexicon): ChronicleIn {
  return {
    day: ch.day,
    season: seasonWords(ch.season),
    facts: numbered(
      chronicleLines(ch, lex).map(({ line, text }) => ({
        fact: line.fact,
        line: text,
        here: !!line.here,
      })),
    ),
    names: { ...ch.names },
    more: ch.more,
  };
}

/** A told event's prompt: the fact, then its heaviest cause, with the names of both. */
export function stageInput(ev: CausedEvent, lex: Lexicon): StageIn {
  const names = { ...ev.causes?.names, ...ev.names };
  const refs = refsOf(names);
  const causes = [...(ev.causes?.causes ?? [])]
    .filter((f) => f.id !== ev.fact.id)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, STAGE_CAUSES);
  return {
    kind: ev.fact.kind,
    facts: numbered(
      [ev.fact, ...causes].map((fact) => ({ fact, line: storyLine(fact, lex, refs) })),
    ),
    names,
  };
}

/** The recap's prompt: its fact lines as the card shows them. A wish for a word stays on the card alone. */
export function recapInput(r: api.Recap, lex: Lexicon): RecapIn {
  const refs = refsOf(r.names);
  const lines = r.lines
    .filter((l) => !l.npc && l.fact)
    .map((l) => ({ fact: l.fact!, line: recapLine(l, lex, new Map(), refs) }));
  return { day: r.day, facts: numbered(lines), names: { ...r.names }, more: r.more };
}

/** Whether a return is told in prose: after hours enough away, with something to tell. */
export function recapTold(r: api.Recap): boolean {
  return r.awayHours >= RECAP_AWAY_HOURS && r.lines.some((l) => !l.npc && l.fact);
}

/**
 * The chronicle, stage endings and since you left told in prose. Every prompt line is the line
 * the template card shows, and those lines stay on the card under "The record". clock gives the
 * world day a stage ending is counted under, since an event carries none.
 */
export function storyNarration(
  narrator: Narrator,
  lex: Lexicon,
  clock: DayClock = dayClock(),
): Pick<Narration, "chronicle" | "event" | "recap"> {
  const told = async <I>(
    spec: UseSpec<I, CitedSentence[]>,
    input: I,
    ctx: NarrateCtx,
    card: Card,
  ): Promise<Card> => {
    const r = await narrator.narrate(spec, input, ctx);
    return r.ok ? withProse(card, prose(r.value)) : card;
  };
  return {
    async chronicle(ch, server, mode, template) {
      const card = template();
      if (ch.day < 0 || !ch.lines.length) return card;
      return told(
        chronicleUse,
        chronicleInput(ch, lex),
        { day: ch.day, server, mode: mode === "cached" ? "cached" : "call" },
        card,
      );
    },

    async event(e, server, mode, template) {
      const card = template();
      if (!TOLD_WITH_CAUSES.has(e.fact.kind)) return card;
      return told(
        stageUse,
        stageInput(e, lex),
        { day: clock.today(), server, mode: mode === "cached" ? "cached" : "call" },
        card,
      );
    },

    async recap(r, user, server, template) {
      const card = template();
      if (!recapTold(r)) return card;
      return told(recapUse, recapInput(r, lex), { day: r.day, server, player: user }, card);
    },
  };
}
