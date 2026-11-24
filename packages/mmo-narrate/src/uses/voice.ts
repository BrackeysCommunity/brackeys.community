import type * as api from "../../../mmo-api/src/index.ts";
import { toldWho } from "../../../mmo-words/src/memory.ts";
import { idWords } from "../../../mmo-words/src/units.ts";
import { proseProblem } from "../check.ts";
import { digestOf } from "../digest.ts";
import { namesBlock, properNames, systemPrompt, untrusted } from "../prompt.ts";
import type { CheckReason, CheckResult, JsonSchema, UseSpec } from "../types.ts";

/** One remembered entry, as the world's dossier carries it. */
export type VoiceMemory = api.Memory;

/** What an NPC brings to a conversation beyond its topics (GDD 4.18). */
export type VoiceDossier = api.Dossier;

export interface VoiceChoice {
  id: string;
  line: string;
}

export interface VoiceTopic {
  id: string;
  line: string;
  choices: VoiceChoice[];
}

/** The world's conversation, as much of api.Conversation as the voice reads. */
export interface VoiceConv {
  npc: { id: string; name: string; role: string; traits: string[] };
  topics: VoiceTopic[];
  last?: string;
  met: number;
  digest: string;
}

export interface VoiceIn {
  conv: VoiceConv;
  dossier: VoiceDossier;
  /** What the NPC's memory summary says, when one was made. */
  summary?: string;
  /** How the NPC already voiced conv.last, when it did. */
  last?: string;
}

/** The picked topics in the model's order, each with every one of its choices in the world's order. */
export interface Voiced {
  topics: VoiceTopic[];
  last?: string;
}

/** A topic line, and the voiced form of what the NPC said last time. */
export const VOICE_LINE_MAX = 300;
/** A choice is a button label: Discord's 80 characters, less room for the effect it shows. */
export const VOICE_CHOICE_MAX = 60;
/** Topics the voice picks among the shown ones, unless fewer than the least are shown. */
export const VOICE_PICK_MIN = 2;
export const VOICE_PICK_MAX = 3;

export { toldWho };

/** A memory as one line of data. */
export function memoryData(m: VoiceMemory, names: Readonly<Record<string, string>>): string {
  const who = toldWho(m.who, names);
  const parts = [idWords(m.kind)];
  if (who) parts.push(`by ${who}`);
  if (m.thing) parts.push(`(${m.thing})`);
  if (m.n && m.unit) parts.push(`for ${m.n} ${m.unit}`);
  return parts.join(" ");
}

/** The words of the dossier the voice may name things with. */
function allowedNames(i: VoiceIn): string[] {
  const d = i.dossier;
  const memories = [...d.about, ...d.world, ...d.oldest];
  const said = [
    ...i.conv.topics.flatMap((t) => [t.line, ...t.choices.map((c) => c.line)]),
    i.conv.last ?? "",
    ...memories.map((m) => m.thing ?? ""),
    ...memories.map((m) => toldWho(m.who, d.names)),
  ].filter(Boolean);
  return [
    ...Object.values(d.names),
    i.conv.npc.name,
    d.place,
    d.faction ?? "",
    ...d.traits,
    ...memories.map((m) => m.thing ?? ""),
    ...properNames(said),
  ].filter(Boolean);
}

/** Why a voiced line may not replace its template line: the prose rules, which hold it to exactly the template's numbers. */
function lineProblem(
  text: string,
  template: string,
  names: readonly string[],
  maxChars: number,
): { reason: CheckReason; detail: string } | null {
  return proseProblem(text, { names, maxChars, numbersFrom: template });
}

const fail = (reason: CheckReason, detail: string): CheckResult<Voiced> => ({
  ok: false,
  reason,
  detail,
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function check(i: VoiceIn, reply: unknown): CheckResult<Voiced> {
  if (!isObject(reply) || !Array.isArray(reply.topics)) return fail("schema", "no topic list");
  const shown = i.conv.topics;
  const byId = new Map(shown.map((t) => [t.id, t]));
  const n = reply.topics.length;
  const most = Math.min(VOICE_PICK_MAX, shown.length);
  if (shown.length < VOICE_PICK_MIN ? n !== shown.length : n < VOICE_PICK_MIN || n > most) {
    return fail("bad-count", `${n} topics of ${shown.length} shown`);
  }
  const names = allowedNames(i);
  const picked = new Set<string>();
  const topics: VoiceTopic[] = [];
  for (const [k, t] of reply.topics.entries()) {
    const at = `topic ${k + 1}`;
    if (!isObject(t) || typeof t.id !== "string" || typeof t.line !== "string") {
      return fail("schema", `${at} has no id or line`);
    }
    if (!Array.isArray(t.choices)) return fail("schema", `${at} has no choices`);
    const tpl = byId.get(t.id);
    if (!tpl) return fail("bad-id", `${t.id} was not shown`);
    if (picked.has(t.id)) return fail("bad-id", `${t.id} is picked twice`);
    picked.add(t.id);
    const line = t.line.trim();
    const lp = lineProblem(line, tpl.line, names, VOICE_LINE_MAX);
    if (lp) return fail(lp.reason, `${t.id}: ${lp.detail}`);

    const voiced = new Map<string, string>();
    for (const c of t.choices) {
      if (!isObject(c) || typeof c.id !== "string" || typeof c.line !== "string") {
        return fail("schema", `${t.id} has a choice with no id or line`);
      }
      if (voiced.has(c.id)) return fail("bad-id", `${t.id}/${c.id} is given twice`);
      voiced.set(c.id, c.line.trim());
    }
    const choices: VoiceChoice[] = [];
    for (const c of tpl.choices) {
      const said = voiced.get(c.id);
      if (said === undefined) return fail("bad-id", `${t.id} drops ${c.id}`);
      const cp = lineProblem(said, c.line, names, VOICE_CHOICE_MAX);
      if (cp) return fail(cp.reason, `${t.id}/${c.id}: ${cp.detail}`);
      choices.push({ id: c.id, line: said });
    }
    if (voiced.size !== tpl.choices.length) {
      const extra = [...voiced.keys()].find((id) => !tpl.choices.some((c) => c.id === id));
      return fail("bad-id", `${t.id} adds ${extra}`);
    }
    topics.push({ id: t.id, line, choices });
  }

  if (reply.last !== undefined && typeof reply.last !== "string") return fail("schema", "last");
  const last = typeof reply.last === "string" ? reply.last.trim() : "";
  if (!last) return { ok: true, value: { topics } };
  if (!i.conv.last) return fail("schema", "a last line with nothing to replace");
  const p = lineProblem(last, i.conv.last, names, VOICE_LINE_MAX);
  if (p) return fail(p.reason, `last: ${p.detail}`);
  return { ok: true, value: { topics, last } };
}

const RULES = `This person is talking with a traveller. The topics block lists what the world lets them bring up, each with the traveller's possible replies. Return:
- topics: pick ${VOICE_PICK_MIN} or ${VOICE_PICK_MAX} of the listed topics, or every one when fewer than ${VOICE_PICK_MIN} are listed, best first. Keep each topic's id. Write its line as this person would say it, in their voice and with their traits; you may frame it as the template does ("Ada says ..."). Keep every fact the template line states and add none. At most ${VOICE_LINE_MAX} characters a line.
- For each picked topic, every one of its choices with its id, none dropped and none added, each worded as the traveller's reply in the second person, as the template is ("You ask what is new."). At most ${VOICE_CHOICE_MAX} characters a choice: it is a button.
- last: when a last-time line is given and is not already voiced, that line as this person said it, at most ${VOICE_LINE_MAX} characters. Otherwise an empty string.
The one exception to the rule on numbers: a line may keep a number its own template line has, as the same digits followed by the same word. Use the memories and the summary only for tone and for what this person would bring up first; tell nothing from them that the topics do not say.`;

const prompt = (i: VoiceIn) => {
  const { conv, dossier: d } = i;
  const npc = [
    `name: ${conv.npc.name}`,
    `role: ${d.role || conv.npc.role}`,
    `traits: ${(d.traits.length ? d.traits : conv.npc.traits).join(", ") || "none"}`,
    `home: ${d.place}`,
    d.faction ? `held by: ${d.faction}` : "",
    `meeting: ${conv.met > 1 ? "they have met before" : "a first meeting"}`,
  ].filter(Boolean);
  const mem = (label: string, ms: VoiceMemory[]) =>
    ms.length ? [`${label}:`, ...ms.map((m) => `- ${memoryData(m, d.names)}`)] : [];
  const memories = [
    ...mem("about the traveller", d.about),
    ...mem("about the world", d.world),
    ...mem("the oldest kept", d.oldest),
    ...(d.folded?.length
      ? [`folded away: ${d.folded.map((x) => `${x.type} ${x.count}`).join(", ")}`]
      : []),
  ];
  const topics = conv.topics.flatMap((t) => [
    `topic ${t.id}: ${t.line}`,
    ...t.choices.map((c) => `  choice ${c.id}: ${c.line}`),
  ]);
  const last = conv.last
    ? [`template: ${conv.last}`, ...(i.last ? [`already voiced as: ${i.last}`] : [])]
    : ["(none)"];
  const blocks = [
    untrusted("person", npc.join("\n")),
    untrusted("memories", memories.join("\n") || "(none)"),
    ...(i.summary ? [untrusted("summary", i.summary)] : []),
    namesBlock(d.names),
    untrusted("topics", topics.join("\n") || "(none)"),
    untrusted("last-time", last.join("\n")),
  ];
  return { system: systemPrompt("voice", RULES), user: blocks.join("\n\n") };
};

const schema: JsonSchema = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          line: { type: "string" },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, line: { type: "string" } },
              required: ["id", "line"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "line", "choices"],
        additionalProperties: false,
      },
    },
    last: { type: "string" },
  },
  required: ["topics", "last"],
  additionalProperties: false,
};

/**
 * A notable's or saved NPC's voice (GDD 4.18 step 3): the model picks
 * among the topics the world showed, words each one and its choices, and
 * may voice the line it said last time. Ids and choices come from rules,
 * so the press that follows is the world's own.
 *
 * The cache key holds the world's conversation digest (NPC, player, world
 * day and topics) and the dossier's digest, but not the summary or the
 * voiced last line: those arrive during a day, and asking again the same
 * day must give the same conversation.
 */
export const voiceUse: UseSpec<VoiceIn, Voiced> = {
  use: "voice",
  version: 1,
  input: (i) => ({
    conv: i.conv.digest,
    npc: { id: i.conv.npc.id, name: i.conv.npc.name, role: i.conv.npc.role },
    topics: i.conv.topics.map((t) => ({
      id: t.id,
      line: t.line,
      choices: t.choices.map((c) => ({ id: c.id, line: c.line })),
    })),
    last: i.conv.last ?? null,
    met: i.conv.met > 1,
    dossier: digestOf(i.dossier),
  }),
  prompt,
  schema,
  check,
  stub: (i) => ({
    topics: i.conv.topics.slice(0, VOICE_PICK_MAX).map((t) => ({
      id: t.id,
      line: t.line,
      choices: t.choices.map((c) => ({ id: c.id, line: c.line })),
    })),
    last: i.last ? "" : (i.conv.last ?? ""),
  }),
};
