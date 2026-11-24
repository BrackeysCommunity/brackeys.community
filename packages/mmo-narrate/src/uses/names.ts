import { proseProblem } from "../check.ts";
import { properNames, systemPrompt, untrusted } from "../prompt.ts";
import type { CheckResult, UseSpec } from "../types.ts";

/** What can be named at discovery: a crafted kind, a renamable promotion, a dungeon. */
export type NameSubject = "kind" | "promotion" | "dungeon";

export interface NamesIn {
  subject: NameSubject;
  /** The row: a kind id, a promotion id, or a dungeon's "q,r". */
  id: string;
  /** The name it has now, which every suggestion must differ from. */
  plain: string;
  /** What it is, in words: its process and method, a promotion's type, a dungeon's kind. */
  traits: string[];
  /** What it came from, in words: its materials, what a promotion is of. */
  lineage: string[];
  tier?: number;
}

export interface NamesOut {
  names: [string, string, string];
  description: string;
}

/** structural: three suggestions, as the naming card has three buttons for them. */
export const NAME_COUNT = 3;
export const NAME_LEAST = 2;
export const NAME_MOST_CHARS = 40;
export const DESCRIPTION_MOST = 240;
/** structural: "one or two sentences" (GDD 15.2). */
const DESCRIPTION_SENTENCES = 2;

const NAME_CHARS = /^[\p{L}' -]+$/u;
const LETTER = /\p{L}/u;

/** A name as a player would type it: trimmed, runs of spaces made one. */
export function tidyName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

const same = (a: string, b: string) => tidyName(a).toLowerCase() === tidyName(b).toLowerCase();

const fail = <O>(reason: "schema" | "bad-count" | "word" | "too-long", detail: string) =>
  ({ ok: false, reason, detail }) as CheckResult<O>;

function nameProblem(raw: unknown, i: NamesIn): CheckResult<string> {
  if (typeof raw !== "string") return fail("schema", "a name is not text");
  const n = tidyName(raw);
  if (n.length < NAME_LEAST) return fail("word", `"${n}" is too short`);
  if (n.length > NAME_MOST_CHARS) return fail("too-long", `"${n}" is over ${NAME_MOST_CHARS}`);
  if (!NAME_CHARS.test(n) || !LETTER.test(n.charAt(0))) {
    return fail("word", `"${n}" holds more than letters, spaces, apostrophes and hyphens`);
  }
  if (same(n, i.plain)) return fail("word", `"${n}" is the plain name`);
  const p = proseProblem(n, { names: [n], maxChars: NAME_MOST_CHARS });
  if (p) return { ok: false, reason: p.reason, detail: `"${n}": ${p.detail}` };
  return { ok: true, value: n };
}

function sentences(text: string): number {
  return text.split(/[.!?]+/).filter((s) => s.trim()).length;
}

/** The names a description may use: the plain name and what its traits and lineage name. */
function describable(i: NamesIn): string[] {
  return [i.plain, ...properNames([i.plain, ...i.traits, ...i.lineage])];
}

const RULES = `Return exactly three names and one description, as the schema asks.
- Each name is new: two to forty characters of letters, spaces, apostrophes and hyphens, with no digits and no number words. The three differ from each other and from the plain name.
- A name should sound like something scavengers would call it: from salvage, weather, machines or the land, plain and memorable. No jokes, no puns on the plain name, no real people or places.
- The new names are exempt from the rule on naming only what the facts name; the description is not.
- The description is one or two sentences, at most two hundred and forty characters, telling what the thing is from the facts given. It uses none of the three new names; it may use the plain name.`;

const SUBJECT_WORDS: Record<NameSubject, string> = {
  kind: "a kind of item nobody had made before",
  promotion: "something play made part of the world",
  dungeon: "a dungeon whose guardian has just fallen for the first time",
};

/** Names and a description at discovery, once per thing (GDD 9.10, 15.2). */
export const namesUse: UseSpec<NamesIn, NamesOut> = {
  use: "names",
  version: 1,
  input: (i) => ({
    subject: i.subject,
    id: i.id,
    plain: i.plain,
    traits: i.traits,
    lineage: i.lineage,
    tier: i.tier,
  }),
  prompt: (i) => {
    const lines = [
      `what: ${SUBJECT_WORDS[i.subject]}`,
      `plain name: ${i.plain}`,
      `traits: ${i.traits.join(", ") || "(none)"}`,
      `made of or from: ${i.lineage.join(", ") || "(none)"}`,
      ...(i.tier === undefined ? [] : [`tier: ${i.tier}`]),
    ];
    return {
      system: systemPrompt("names", RULES),
      user: untrusted("thing", lines.join("\n")),
    };
  },
  schema: {
    type: "object",
    properties: {
      names: { type: "array", items: { type: "string" } },
      description: { type: "string" },
    },
    required: ["names", "description"],
    additionalProperties: false,
  },
  check(i, reply) {
    if (typeof reply !== "object" || reply === null) return fail("schema", "not an object");
    const { names, description } = reply as { names?: unknown; description?: unknown };
    if (!Array.isArray(names)) return fail("schema", "no list of names");
    if (names.length !== NAME_COUNT) {
      return fail("bad-count", `${names.length} names, not ${NAME_COUNT}`);
    }
    const out: string[] = [];
    for (const raw of names) {
      const n = nameProblem(raw, i);
      if (!n.ok) return n as CheckResult<NamesOut>;
      if (out.some((o) => same(o, n.value))) return fail("word", `"${n.value}" is given twice`);
      out.push(n.value);
    }
    if (typeof description !== "string") return fail("schema", "no description");
    const d = description.trim();
    const p = proseProblem(d, { names: describable(i), maxChars: DESCRIPTION_MOST });
    if (p) return { ok: false, reason: p.reason, detail: `description: ${p.detail}` };
    if (sentences(d) > DESCRIPTION_SENTENCES) {
      return fail("bad-count", `the description is over ${DESCRIPTION_SENTENCES} sentences`);
    }
    if (out.some((n) => d.toLowerCase().includes(n.toLowerCase()))) {
      return fail("word", "the description uses a new name");
    }
    return { ok: true, value: { names: out as NamesOut["names"], description: d } };
  },
  stub: (i) => ({ names: stubNames(i), description: STUB_DESCRIPTIONS[i.subject] }),
};

const STUB_DESCRIPTIONS: Record<NameSubject, string> = {
  kind: "Nobody had made it before, and the record keeps its first maker.",
  promotion: "Play made it part of the world, and the chronicle keeps it.",
  dungeon: "Its guardian fell to the first party down, and the way in stands open.",
};

const STUB_WORDS = ["Rust", "Ash", "Signal", "Dust", "Salt", "Static", "Cinder"];

/** Three names built from the plain name with no model, as the check accepts them. */
function stubNames(i: NamesIn): string[] {
  const words = i.plain.match(/\p{L}+/gu) ?? [];
  const last = (words.at(-1) ?? "find").slice(0, 20);
  const head = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  let seed = 0;
  for (const ch of i.id) seed = (seed + ch.charCodeAt(0)) % STUB_WORDS.length;
  const out: string[] = [];
  for (let k = 0; out.length < NAME_COUNT && k < STUB_WORDS.length * 2; k++) {
    const w = STUB_WORDS[(seed + k) % STUB_WORDS.length]!;
    const n = k < STUB_WORDS.length ? `${w} ${head}` : `${head} of the ${w}`;
    if (!same(n, i.plain) && !out.some((o) => same(o, n))) out.push(n);
  }
  return out;
}
