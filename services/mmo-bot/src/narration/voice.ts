import {
  KEY_PREFIX,
  type NarrationStore,
  type Narrator,
  type Switch,
  USE_CONFIG,
} from "../../../../packages/mmo-narrate/src/index.ts";
import { summaryUse } from "../../../../packages/mmo-narrate/src/uses/summary.ts";
import { type Voiced, voiceUse } from "../../../../packages/mmo-narrate/src/uses/voice.ts";
import { memoryLines } from "../../../../packages/mmo-words/src/memory.ts";
import type * as api from "../api.ts";
import type { Lexicon } from "../lexicon.ts";
import type { Narration } from "./hooks.ts";
import { redisSwitch } from "./switch.ts";

const DAY = 86_400;
/** A voiced last line is kept while the world may still say the line it replaced. */
export const LAST_TTL_SECONDS = 90 * DAY;
const summaryTtl = USE_CONFIG.summary.ttlSeconds;
if (summaryTtl === null) throw new Error("the summary use keeps no ttl");
export const SUMMARY_TTL_SECONDS = summaryTtl;

/** How an NPC voiced the line it said to a player last time: `{template, voiced}`. */
export const lastKey = (npc: string, user: string) => `${KEY_PREFIX}last:${npc}:${user}`;
/** An NPC's memory summary. */
export const summaryKey = (npc: string) => `${KEY_PREFIX}summary:${npc}`;
/** Marks the world day an NPC's summary was asked for. */
export const summaryDayKey = (npc: string, day: number) => `${KEY_PREFIX}summary-day:${npc}:${day}`;

interface LastLine {
  template: string;
  voiced: string;
}

function parseLast(raw: string | null): LastLine | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastLine>;
    return typeof v.template === "string" && typeof v.voiced === "string"
      ? { template: v.template, voiced: v.voiced }
      : null;
  } catch {
    return null;
  }
}

/** The world's conversation with the voiced lines in, the picked topics in the model's order. */
function voicedConv(conv: api.Conversation, v: Voiced, last: string | undefined): api.Conversation {
  const byId = new Map(conv.topics.map((t) => [t.id, t]));
  const topics: api.Topic[] = [];
  for (const vt of v.topics) {
    const t = byId.get(vt.id);
    if (!t) continue;
    const said = new Map(vt.choices.map((c) => [c.id, c.line]));
    topics.push({
      ...t,
      line: vt.line,
      choices: t.choices.map((c) => ({ ...c, line: said.get(c.id) ?? c.line })),
    });
  }
  return { ...conv, topics, ...(conv.last ? { last: last ?? conv.last } : {}) };
}

/** The summary prompt's input: the NPC's name, its oldest entries with their names, and its folded counts. */
export function summaryInput(conv: Pick<api.Conversation, "npc">, d: api.Dossier) {
  return { npc: conv.npc.name, folded: d.folded ?? [], oldest: d.oldest, names: d.names };
}

export type VoiceNarration = Pick<Narration, "talk" | "wantsDossier"> & {
  /** Resolves once every background summary has been made and stored. */
  idle(): Promise<void>;
};

/**
 * The voice of notables and saved NPCs (GDD 4.18): the world's conversation
 * voiced, or unchanged on a fallback. While the summary use is on, an NPC past
 * its memory cap is summarised in the background at most once a world day.
 */
export function voiceNarration(
  narrator: Narrator,
  store: NarrationStore,
  lex: Lexicon,
  sw: Switch = redisSwitch(store, true),
): VoiceNarration {
  const pending = new Set<Promise<void>>();
  const read = async (key: string) => {
    try {
      return await store.get(key);
    } catch {
      return null;
    }
  };
  const write = async (key: string, value: string, ttl: number) => {
    try {
      await store.set(key, value, ttl);
      return true;
    } catch {
      return false;
    }
  };
  const claim = async (key: string) => {
    try {
      return await store.claim(key, SUMMARY_TTL_SECONDS);
    } catch {
      return false;
    }
  };

  const summarise = async (conv: api.Conversation, d: api.Dossier, server: string) => {
    const npc = conv.npc.id;
    if (!(await claim(summaryDayKey(npc, d.day)))) return;
    const job = narrator
      .narrate(summaryUse, summaryInput(conv, d), { day: d.day, server, npc })
      .then(async (r) => {
        if (r.ok) await write(summaryKey(npc), r.value, SUMMARY_TTL_SECONDS);
      })
      // The narrator logs its own fallbacks; a lost summary is asked for again tomorrow.
      .catch(() => {});
    pending.add(job);
    void job.finally(() => pending.delete(job));
  };

  return {
    wantsDossier: (_user, server) => sw.on("voice", server),

    async talk(conv, user, server) {
      const d = conv.dossier;
      if (!d) return { conv };
      const npc = conv.npc.id;
      const remembering = d.foldedTotal > 0;
      const summaryOn = remembering && (await sw.on("summary", server).catch(() => false));
      const [stored, summary] = await Promise.all([
        read(lastKey(npc, user)).then(parseLast),
        summaryOn ? read(summaryKey(npc)) : null,
      ]);
      if (summaryOn) await summarise(conv, d, server);

      const last = stored && conv.last && stored.template === conv.last ? stored.voiced : undefined;
      let out = conv;
      if (conv.topics.length || conv.last) {
        const r = await narrator.narrate(
          voiceUse,
          { conv, dossier: d, summary: summary ?? undefined, last },
          { day: d.day, server, player: user, npc },
        );
        if (r.ok) {
          const fresh = last === undefined && conv.last ? r.value.last : undefined;
          if (fresh && conv.last) {
            const line: LastLine = { template: conv.last, voiced: fresh };
            await write(lastKey(npc, user), JSON.stringify(line), LAST_TTL_SECONDS);
          }
          out = voicedConv(conv, r.value, last ?? fresh);
        }
      }
      if (!remembering) return { conv: out };
      const remembers = summary || memoryLines(d, lex).join("\n");
      return remembers ? { conv: out, remembers } : { conv: out };
    },

    async idle() {
      while (pending.size) await Promise.all(pending);
    },
  };
}
