import { proseProblem } from "../check.ts";
import { systemPrompt, untrusted } from "../prompt.ts";
import type { CheckReason, CheckResult, UseSpec } from "../types.ts";

/** The lines a pool holds for each key (GDD 15.2). */
export const POOL_LINES = 6;
/** The longest pool line, slots unfilled. */
export const POOL_LINE_MAX = 160;

export interface PoolIn {
  /** The beat kind, a fights.beats row. */
  beat: string;
  /** The archetype id, for a key of its own ("kind:archetype"). */
  archetype?: string;
  /** The archetype's tags, and the beat's flags. */
  tags: string[];
  /** The lines the pool holds for the key now; the new ones must differ. */
  have: string[];
  /** The pack's names for the beat and the creature: context only, never written out. */
  beatName?: string;
  creatureName?: string;
}

/** The pool key a request fills. */
export const poolKey = (i: Pick<PoolIn, "beat" | "archetype">): string =>
  i.archetype ? `${i.beat}:${i.archetype}` : i.beat;

const SLOTS = new Set(["creature", "place"]);
const BRACED = /\{([^{}]*)\}/g;
const SECOND_PERSON = /\b(you|your|yours|yourself|yourselves)\b/i;

/**
 * Why a pool line may not be committed, or null. Slots stand in for the
 * only names a line may hold, so the prose check runs with those names.
 */
export function poolLineProblem(line: string): { reason: CheckReason; detail: string } | null {
  if (line.trim() !== line) return { reason: "markup", detail: "space at an end" };
  if (line.length > POOL_LINE_MAX) {
    return { reason: "too-long", detail: `${line.length} characters, at most ${POOL_LINE_MAX}` };
  }
  for (const m of line.matchAll(BRACED)) {
    if (!SLOTS.has(m[1] ?? "")) return { reason: "markup", detail: `unknown slot ${m[0]}` };
  }
  const filled = line.replace(BRACED, (_m, slot: string) =>
    slot === "creature" ? "Creature" : "Place",
  );
  if (/[{}]/.test(filled)) return { reason: "markup", detail: "a stray brace" };
  const you = filled.match(SECOND_PERSON);
  if (you) return { reason: "word", detail: `speaks to the reader: ${you[0]}` };
  return proseProblem(filled, { names: ["Creature", "Place"], maxChars: POOL_LINE_MAX });
}

/** Every problem of a whole pool file, as "key: line: reason"; empty when it may be committed. */
export function poolProblems(pool: {
  pack?: unknown;
  version?: unknown;
  lines?: unknown;
}): string[] {
  const out: string[] = [];
  if (typeof pool.pack !== "string" || !pool.pack) out.push("no pack");
  if (!Number.isInteger(pool.version) || (pool.version as number) < 1) out.push("no version");
  if (typeof pool.lines !== "object" || pool.lines === null) return [...out, "no lines"];
  for (const [key, lines] of Object.entries(pool.lines as Record<string, unknown>)) {
    if (!Array.isArray(lines) || lines.length !== POOL_LINES) {
      out.push(
        `${key}: holds ${Array.isArray(lines) ? lines.length : "no"} lines, not ${POOL_LINES}`,
      );
      continue;
    }
    const seen = new Set<string>();
    for (const l of lines) {
      if (typeof l !== "string") {
        out.push(`${key}: a line that is not text`);
        continue;
      }
      const p = poolLineProblem(l);
      if (p) out.push(`${key}: ${l}: ${p.reason} (${p.detail})`);
      if (seen.has(l)) out.push(`${key}: ${l}: repeated`);
      seen.add(l);
    }
  }
  return out;
}

const POOL_RULES = `You write encounter lines: the opening line a fight card shows for a beat, to the person fighting it. Each line sets the scene of the beat as it happens, in the present tense, in one or two short sentences.
- Write exactly ${POOL_LINES} lines for the beat in the request, each at most ${POOL_LINE_MAX} characters.
- Write the creature as {creature} and the place as {place}, with the braces, and name nothing else. A line may leave either out. Write "the {creature}" with a lowercase article mid-sentence and "The {creature}" to open one; never put an article before {place}.
- Tell only the situation: never who wins, the odds, a reward, an outcome or what anyone should do.
- Never speak to the reader: no "you" or "your".
- Every line differs from the others and from the lines already held, and does not just reword them.
- The creature's name and tags are context for what it is like; never write them out.`;

const lit = (i: PoolIn) =>
  [
    `beat: ${i.beat}${i.beatName ? ` (shown as ${i.beatName})` : ""}`,
    i.archetype
      ? `creature: ${i.archetype}${i.creatureName ? ` (shown as ${i.creatureName})` : ""}`
      : "creature: any of the setting's creatures",
    `tags: ${i.tags.length ? [...i.tags].sort().join(", ") : "(none)"}`,
  ].join("\n");

/** Generic lines the stub writes, so a stub run passes the check without a model. */
const STUB = [
  "The {creature} turns, and the moment tightens.",
  "Grit hisses across the ground as the {creature} moves.",
  "The {creature} waits among the wreckage, alert.",
  "Wind drags ash past the {creature} and on into the dark.",
  "The {creature} makes a low sound like a motor catching.",
  "Somewhere near {place}, metal groans under the {creature}.",
  "The {creature} keeps to the shadow of a dead pylon.",
  "Old wire sings in the wind as the {creature} draws near.",
  "The {creature} shakes off a coat of dust and looks up.",
  "A relay clicks somewhere, and the {creature} goes still.",
  "The {creature} scrapes along a rusted hull, unhurried.",
  "Cold light flickers across {place} as the {creature} stirs.",
];

const schema = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

const fail = (reason: CheckReason, detail: string): CheckResult<string[]> => ({
  ok: false,
  reason,
  detail,
});

/** Six new encounter lines for a beat kind or a creature's beat, written offline with the largest model. */
export const poolUse: UseSpec<PoolIn, string[]> = {
  use: "pool",
  version: 1,
  input: (i) => ({
    beat: i.beat,
    archetype: i.archetype,
    tags: [...i.tags].sort(),
    have: i.have,
    beatName: i.beatName,
    creatureName: i.creatureName,
  }),
  prompt: (i) => ({
    system: systemPrompt("pool", POOL_RULES),
    user: `${untrusted("beat", lit(i))}\n\n${untrusted("held", i.have.length ? i.have.join("\n") : "(none)")}`,
  }),
  schema,
  check: (i, reply) => {
    const lines = (reply as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) {
      return fail("schema", "not a list of lines");
    }
    if (lines.length !== POOL_LINES) {
      return fail("bad-count", `${lines.length} lines, not ${POOL_LINES}`);
    }
    const held = new Set(i.have.map((l) => l.toLowerCase()));
    const seen = new Set<string>();
    for (const [n, raw] of (lines as string[]).entries()) {
      const at = `line ${n + 1}`;
      const p = poolLineProblem(raw);
      if (p) return fail(p.reason, `${at}: ${p.detail}`);
      const l = raw.toLowerCase();
      if (held.has(l)) return fail("word", `${at} repeats a held line`);
      if (seen.has(l)) return fail("word", `${at} repeats another`);
      seen.add(l);
    }
    return { ok: true, value: lines as string[] };
  },
  stub: (i) => {
    const held = new Set(i.have.map((l) => l.toLowerCase()));
    return { lines: STUB.filter((l) => !held.has(l.toLowerCase())).slice(0, POOL_LINES) };
  },
};
