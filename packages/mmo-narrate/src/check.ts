import type { CheckReason, CheckResult } from "./types.ts";

export interface ProseRules {
  /** Names the text may use: the names map's values and the proper names the template shows. */
  names: readonly string[];
  maxChars: number;
  /** When set, a number may appear if the same digits or number word appear here. */
  numbersFrom?: string;
}

/** Words that state a count; "a", "an", "first" and "last" are allowed and not listed. */
export const NUMBER_WORDS: ReadonlySet<string> = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "dozen",
  "half",
  "twice",
  "thrice",
]);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;
const CAPITAL = /^\p{Lu}/u;
const MENTION = /@|discord\.gg/i;
const MARKUP = /[<>[\]*_`#|~\\]|http|www\./i;
const DIGITS = /\d+/g;
const SENTENCE_END = new Set([".", "!", "?", ":", "\n"]);
const OPENERS = new Set(['"', "“", "‘", "'", "(", "—", "–"]);

export interface ProseWord {
  /** The word, a possessive ending dropped. */
  text: string;
  /** It opens a sentence or a line. */
  start: boolean;
}

const bare = (w: string) => w.replace(/['’]s?$/u, "");

/** The words of a text, each marked where it opens a sentence. */
export function proseWords(text: string): ProseWord[] {
  const out: ProseWord[] = [];
  for (const m of text.matchAll(WORD)) {
    let i = (m.index ?? 0) - 1;
    while (
      i >= 0 &&
      (text.charAt(i) === " " || text.charAt(i) === "\t" || OPENERS.has(text.charAt(i)))
    ) {
      i--;
    }
    out.push({ text: bare(m[0]), start: i < 0 || SENTENCE_END.has(text.charAt(i)) });
  }
  return out;
}

const isNumberWord = (w: string) => {
  const l = w.toLowerCase();
  return NUMBER_WORDS.has(l) || (l.endsWith("s") && NUMBER_WORDS.has(l.slice(0, -1)));
};

function allowedWords(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    for (const m of n.matchAll(WORD)) {
      const w = bare(m[0]);
      out.add(w);
      for (const part of w.split("-")) if (part) out.add(part);
    }
  }
  return out;
}

function numberProblem(text: string, from: string | undefined): string | null {
  const allowedDigits = new Set(from?.match(DIGITS) ?? []);
  for (const d of text.match(DIGITS) ?? []) if (!allowedDigits.has(d)) return d;
  const allowedWords = new Set(
    proseWords(from ?? "")
      .flatMap((w) => w.text.toLowerCase().split("-"))
      .filter(isNumberWord),
  );
  for (const w of proseWords(text)) {
    for (const part of w.text.split("-")) {
      if (isNumberWord(part) && !allowedWords.has(part.toLowerCase())) return part;
    }
  }
  return null;
}

function nameProblem(text: string, names: readonly string[]): string | null {
  const allowed = allowedWords(names);
  for (const w of proseWords(text)) {
    if (w.start || /^I(['’]|$)/u.test(w.text) || !CAPITAL.test(w.text) || allowed.has(w.text)) {
      continue;
    }
    const parts = w.text.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every((p) => !CAPITAL.test(p) || allowed.has(p))) continue;
    return w.text;
  }
  return null;
}

/**
 * The first reason a piece of prose may not be shown, or null. Any doubt
 * falls back to the template, which is always safe (GDD 15.3).
 */
export function proseProblem(
  text: string,
  rules: ProseRules,
): { reason: CheckReason; detail: string } | null {
  if (text.trim() === "") return { reason: "empty", detail: "no text" };
  if (text.length > rules.maxChars) {
    return { reason: "too-long", detail: `${text.length} characters, at most ${rules.maxChars}` };
  }
  const mention = text.match(MENTION);
  if (mention) return { reason: "mention", detail: mention[0] };
  const markup = text.match(MARKUP);
  if (markup) return { reason: "markup", detail: markup[0] };
  const number = numberProblem(text, rules.numbersFrom);
  if (number !== null) return { reason: "number", detail: number };
  const name = nameProblem(text, rules.names);
  if (name !== null) return { reason: "name", detail: name };
  return null;
}

export interface CitedSentence {
  text: string;
  facts: number[];
}

const fail = <O>(reason: CheckReason, detail: string): CheckResult<O> => ({
  ok: false,
  reason,
  detail,
});

/**
 * Sentences that each cite one or more of facts #1..n, together citing every
 * one of them: the mechanical test that the prose adds no event and drops
 * none. `rules.maxChars` caps the sentences joined by spaces.
 */
export function checkCited(
  sentences: unknown,
  n: number,
  rules: ProseRules,
  maxSentences: number,
): CheckResult<CitedSentence[]> {
  if (!Array.isArray(sentences)) return fail("schema", "not a list of sentences");
  if (sentences.length === 0) return fail("empty", "no sentences");
  if (sentences.length > maxSentences) {
    return fail("bad-count", `${sentences.length} sentences, at most ${maxSentences}`);
  }
  const out: CitedSentence[] = [];
  const cited = new Set<number>();
  const each = { ...rules, maxChars: Number.POSITIVE_INFINITY };
  for (const [i, s] of sentences.entries()) {
    const at = `sentence ${i + 1}`;
    if (typeof s !== "object" || s === null) return fail("schema", `${at} is not an object`);
    const { text, facts } = s as { text?: unknown; facts?: unknown };
    if (typeof text !== "string") return fail("schema", `${at} has no text`);
    if (!Array.isArray(facts) || !facts.every((f) => Number.isInteger(f))) {
      return fail("schema", `${at} has no fact list`);
    }
    if (facts.length === 0) return fail("uncited", `${at} cites no fact`);
    for (const f of facts as number[]) {
      if (f < 1 || f > n) return fail("unknown-fact", `${at} cites #${f}`);
      cited.add(f);
    }
    const problem = proseProblem(text, each);
    if (problem) return fail(problem.reason, `${at}: ${problem.detail}`);
    out.push({ text: text.trim(), facts: [...new Set(facts as number[])] });
  }
  for (let f = 1; f <= n; f++) if (!cited.has(f)) return fail("missing-fact", `#${f} is not told`);
  const joined = out.map((s) => s.text).join(" ");
  if (joined.length > rules.maxChars) {
    return fail("too-long", `${joined.length} characters, at most ${rules.maxChars}`);
  }
  return { ok: true, value: out };
}
