import type * as api from "../../../mmo-api/src/index.ts";
import { proseProblem } from "../check.ts";
import { namesBlock, properNames, systemPrompt, untrusted } from "../prompt.ts";
import type { CheckResult, JsonSchema, UseSpec } from "../types.ts";
import { memoryData, toldWho } from "./voice.ts";

export interface SummaryIn {
  /** The NPC's name. */
  npc: string;
  /** What the NPC folded away past its memory cap, by entry kind. */
  folded: api.TypeCount[];
  oldest: api.Memory[];
  names: Record<string, string>;
}

const GUILD_KEY = "guild:";

/** A summary is stored per NPC and shown to every viewer, so it is made only from what any viewer may read. */
function shared(i: SummaryIn): SummaryIn {
  const names = Object.fromEntries(
    Object.entries(i.names).filter(([k]) => !k.startsWith(GUILD_KEY)),
  );
  const oldest = i.oldest.map((m) => {
    const who = toldWho(m.who, names);
    return { ...m, who: who === "you" ? "a traveller" : who };
  });
  return { ...i, names, oldest };
}

export const SUMMARY_MAX_CHARS = 400;
export const SUMMARY_MAX_SENTENCES = 3;

const SENTENCE = /[^.!?]+(?:[.!?]+|$)/g;

const sentences = (s: string) => (s.match(SENTENCE) ?? []).filter((x) => x.trim());

const kindWords = (kind: string) => kind.replace(/[-_]/g, " ");

function allowedNames(i: SummaryIn): string[] {
  const things = i.oldest.map((m) => m.thing ?? "").filter(Boolean);
  const who = i.oldest.map((m) => toldWho(m.who, i.names)).filter(Boolean);
  return [...Object.values(i.names), i.npc, ...things, ...properNames([...things, ...who])];
}

function check(i: SummaryIn, reply: unknown): CheckResult<string> {
  const text = (reply as { summary?: unknown } | null)?.summary;
  if (typeof text !== "string") return { ok: false, reason: "schema", detail: "no summary" };
  const summary = text.trim();
  const p = proseProblem(summary, { names: allowedNames(i), maxChars: SUMMARY_MAX_CHARS });
  if (p) return { ok: false, ...p };
  const n = sentences(summary).length;
  if (n > SUMMARY_MAX_SENTENCES) {
    return {
      ok: false,
      reason: "bad-count",
      detail: `${n} sentences, at most ${SUMMARY_MAX_SENTENCES}`,
    };
  }
  return { ok: true, value: summary };
}

const RULES = `Sum up what this person remembers, from the oldest entries they keep and the kinds of things they have folded away, in at most ${SUMMARY_MAX_SENTENCES} sentences and ${SUMMARY_MAX_CHARS} characters in all. Speak of them in the third person, by name or as they. Say what weighs on them most, not every entry. No numbers at all, not even the counts. Return the text as summary.`;

const schema: JsonSchema = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};

/** An NPC's memory past its memory cap, summed up (GDD 15.2). The summary is context for the voice and shown on the talk card; it never reaches the world. */
export const summaryUse: UseSpec<SummaryIn, string> = {
  use: "summary",
  version: 2,
  input: (raw) => {
    const i = shared(raw);
    return {
      npc: i.npc,
      folded: i.folded.map((x) => ({ type: x.type, count: x.count })),
      oldest: i.oldest.map((m) => ({
        kind: m.kind,
        tick: m.tick,
        thing: m.thing ?? "",
        who: toldWho(m.who, i.names),
        n: m.n ?? 0,
        unit: m.unit ?? "",
      })),
      names: i.names,
    };
  },
  prompt: (raw) => {
    const i = shared(raw);
    return {
      system: systemPrompt("summary", RULES),
      user: [
        untrusted("person", i.npc),
        untrusted(
          "oldest",
          i.oldest.map((m) => `- ${memoryData(m, i.names)}`).join("\n") || "(none)",
        ),
        untrusted(
          "folded",
          i.folded.map((x) => `- ${kindWords(x.type)}: ${x.count}`).join("\n") || "(none)",
        ),
        namesBlock(i.names),
      ].join("\n\n"),
    };
  },
  schema,
  check: (i, reply) => check(shared(i), reply),
  stub: (raw) => ({
    summary: `${shared(raw).npc} remembers more than they can tell, the oldest of it best.`,
  }),
};
