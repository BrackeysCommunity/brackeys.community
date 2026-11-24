import { checkCited, NUMBER_WORDS, type CitedSentence } from "../check.ts";
import { factsBlock, namesBlock, type PromptFact, properNames, systemPrompt } from "../prompt.ts";
import type { CheckResult, JsonSchema, UseId, UseSpec } from "../types.ts";

/** What a told use shares: facts as the card shows them, and the names they may be told with. */
export interface Told {
  facts: PromptFact[];
  names: Record<string, string>;
}

export interface ChronicleIn extends Told {
  day: number;
  /** Where the season stands, in words; empty when none runs. */
  season: string;
  /** How many lighter facts the day held beyond these. */
  more: number;
}

/** The most a told use may write: sentences, and characters in all. */
export interface ToldCap {
  sentences: number;
  chars: number;
}

export const CHRONICLE_CAP: ToldCap = { sentences: 6, chars: 900 };

/** A reply is sentences, each with the numbers of the facts it tells. */
export const TOLD_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          facts: { type: "array", items: { type: "integer" } },
        },
        required: ["text", "facts"],
        additionalProperties: false,
      },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
};

/** The names a told use may write: the names map and the proper names its lines show. */
export function toldNames(i: Told): string[] {
  return [...Object.values(i.names), ...properNames(i.facts.map((f) => f.line))];
}

/** The fact list as the cache digest takes it: order, ids, kinds, lines and here flags. */
export function toldFacts(facts: readonly PromptFact[]): unknown[] {
  return facts.map((f) => ({ n: f.n, id: f.id, kind: f.kind, line: f.line, here: f.here }));
}

export function checkTold(i: Told, reply: unknown, cap: ToldCap): CheckResult<CitedSentence[]> {
  const sentences =
    typeof reply === "object" && reply !== null && !Array.isArray(reply)
      ? (reply as { sentences?: unknown }).sentences
      : undefined;
  return checkCited(
    sentences,
    i.facts.length,
    { names: toldNames(i), maxChars: cap.chars },
    cap.sentences,
  );
}

const DIGIT_ASIDE = /\s*\([^)]*\d[^)]*\)/g;
const DIGITS = /[+−-]?\d[\d,.]*\s*(%|×)?/g;
const MARKUP = /[@<>[\]*_`#|~\\]/g;
const WORDS = /[\p{L}][\p{L}'’-]*/gu;

const isNumberWord = (w: string) => {
  const l = w.toLowerCase().replace(/['’]s?$/u, "");
  return NUMBER_WORDS.has(l) || (l.endsWith("s") && NUMBER_WORDS.has(l.slice(0, -1)));
};

/** A template line with its numbers and markup taken out, so the stub's prose passes the check. */
export function numberless(line: string): string {
  const out = line
    .replace(DIGIT_ASIDE, "")
    .replace(DIGITS, "")
    .replace(MARKUP, "")
    .replace(/https?|www\./gi, "")
    .replace(WORDS, (w) => (w.split("-").some(isNumberWord) ? "" : w))
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=[,;:.!?])/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!/\p{L}/u.test(out)) return "";
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/** structural: what a stub sentence says when its line does not fit the cap. */
const PLAIN = "So the record runs.";

/**
 * Sentences any check accepts: the facts cut into at most `cap.sentences`
 * runs in their order, each told by its first line with the numbers taken
 * out, or plainly when the lines would not fit.
 */
export function stubTold(
  facts: readonly PromptFact[],
  cap: ToldCap,
): { sentences: CitedSentence[] } {
  if (!facts.length) return { sentences: [] };
  const groups = Math.min(facts.length, cap.sentences);
  const size = Math.ceil(facts.length / groups);
  const runs: PromptFact[][] = [];
  for (let i = 0; i < facts.length; i += size) runs.push(facts.slice(i, i + size));
  const told = runs.map((run) => ({
    text: numberless(run[0]!.line) || PLAIN,
    facts: run.map((f) => f.n),
  }));
  const fits = told.map((s) => s.text).join(" ").length <= cap.chars;
  return { sentences: fits ? told : told.map((s) => ({ ...s, text: PLAIN })) };
}

/** The rules every told use gives the model about its reply. */
export function toldRules(cap: ToldCap, own: string): string {
  return [
    own,
    `Write at most ${cap.sentences} sentences and at most ${cap.chars} characters in all.`,
    "Return the sentences in order. Give each one, in facts, the numbers of the listed facts it tells; a sentence may tell several. Together the sentences tell every listed fact, and no sentence tells anything else.",
  ].join("\n");
}

/** A told use: its own rules and cap, the shared schema, check and stub. */
export function toldUse<I extends Told>(
  use: UseId,
  version: number,
  cap: ToldCap,
  rules: string,
  input: (i: I) => unknown,
  user: (i: I) => string[],
): UseSpec<I, CitedSentence[]> {
  const system = systemPrompt(use, toldRules(cap, rules));
  return {
    use,
    version,
    input,
    prompt: (i) => ({
      system,
      user: [...user(i), factsBlock(i.facts), namesBlock(i.names)].join("\n\n"),
    }),
    schema: TOLD_SCHEMA,
    check: (i, reply) => checkTold(i, reply, cap),
    stub: (i) => stubTold(i.facts, cap),
  };
}

const CHRONICLE_RULES = `You write the chronicle channel's entry for one closed world day, for everyone in a Discord server to read. The facts are that day's heaviest, already ordered by weight.
Facts marked (here) happened at this server's own places: tell them first. Facts marked (elsewhere) happened in the wider world.
Only the heaviest facts are listed. Never say that others exist or how many there were.`;

/** The chronicle of a closed world day, retold (GDD 12.7, 15.2). */
export const chronicleUse: UseSpec<ChronicleIn, CitedSentence[]> = toldUse<ChronicleIn>(
  "chronicle",
  1,
  CHRONICLE_CAP,
  CHRONICLE_RULES,
  (i) => ({
    day: i.day,
    season: i.season,
    facts: toldFacts(i.facts),
    names: i.names,
    more: i.more,
  }),
  (i) => [
    i.season
      ? `The record of a closed world day. The season stands at: ${i.season}.`
      : "The record of a closed world day, while no season runs.",
  ],
);
