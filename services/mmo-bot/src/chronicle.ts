import * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import { type ChannelSink, pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";
import { postOnce } from "./live.ts";
import { chronicleCard } from "./screens/story.ts";
import type { WorldReply } from "./world.ts";

/**
 * The chronicle channel (GDD 12.7): one post per closed world day per
 * server, its heaviest facts with the server's own places first. The card
 * is made, narrated or not, before the day is marked, and the day is marked
 * before it is posted, so a restart never posts it twice.
 */

export const CHRONICLE_POLL_MS = 60_000;

/** What the poster reads of the world. */
export interface ChronicleWorld {
  /** The last closed world day as a server reads it; null before any has closed. */
  chronicle(server: string): Promise<api.Chronicle | null>;
}

/** A world's chronicle call as the poster reads it: not-found means no world day has closed yet. */
export function chronicleSource(
  fetch: (server: string) => Promise<WorldReply<api.Chronicle>>,
): ChronicleWorld {
  return {
    async chronicle(server) {
      const r = await fetch(server);
      if (r.ok) return r.reply;
      if (r.refusal.code === api.CodeNotFound) return null;
      throw new Error(`chronicle refused: ${r.refusal.code} ${r.refusal.message ?? ""}`);
    },
  };
}

/** A closed day's card; template is the poster's own. */
export type ChronicleCard = (ch: api.Chronicle, template: () => Card) => Card | Promise<Card>;

export class ChroniclePoster {
  private readonly card: ChronicleCard;
  private readonly template: (ch: api.Chronicle) => Card;

  constructor(
    private readonly world: ChronicleWorld,
    lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    private readonly server: string,
    private readonly prefix = "mmo-bot:chronicle:",
    private readonly log: (line: string) => void = console.log,
    card?: ChronicleCard,
    /** Called with the last closed day + 1 on every poll that reads one, posted or not, so the day clock keeps up. */
    private readonly onDay?: (day: number) => void,
  ) {
    this.template = (ch) => chronicleCard(ch, lex, 0, true);
    this.card = card ?? this.template;
  }

  /** Posts the last closed day if this server has not had it; returns how many it posted. */
  async poll(): Promise<number> {
    const ch = await this.world.chronicle(this.server);
    if (!ch) return 0;
    this.onDay?.(ch.day + 1);
    const key = `${this.prefix}${this.server}:day`;
    const was = await this.store.get(key);
    if (was !== null && ch.day <= Number(was)) return 0;
    const card = await this.card(ch, () => this.template(ch));
    await postOnce(
      this.store,
      key,
      String(ch.day),
      () => this.sink.post(card),
      () => (was === null ? this.store.del(key) : this.store.set(key, was)),
    );
    return 1;
  }

  start(): () => void {
    return pollEvery(CHRONICLE_POLL_MS, () => this.poll(), this.log, "chronicle");
  }
}
