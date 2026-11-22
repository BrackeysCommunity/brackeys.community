import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import { type ChannelSink, pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";
import { chronicleCard } from "./screens/story.ts";

/**
 * The chronicle channel (GDD 12.7): one post per closed world day per
 * server, its heaviest facts with the server's own places first. The day
 * is marked before it is posted, so a restart never posts it twice.
 */

export const CHRONICLE_POLL_MS = 60_000;

/** What the poster reads of the world. */
export interface ChronicleWorld {
  /** The last closed world day as a server reads it; null before any has closed. */
  chronicle(server: string): Promise<api.Chronicle | null>;
}

export class ChroniclePoster {
  private readonly card: (ch: api.Chronicle) => Card;

  constructor(
    private readonly world: ChronicleWorld,
    lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    private readonly server: string,
    private readonly prefix = "mmo-bot:chronicle:",
    private readonly log: (line: string) => void = console.log,
    card?: (ch: api.Chronicle) => Card,
  ) {
    this.card = card ?? ((ch) => chronicleCard(ch, lex, 0, true));
  }

  /** Posts the last closed day if this server has not had it; returns how many it posted. */
  async poll(): Promise<number> {
    const ch = await this.world.chronicle(this.server);
    if (!ch) return 0;
    const key = `${this.prefix}${this.server}:day`;
    const was = await this.store.get(key);
    if (was !== null && ch.day <= Number(was)) return 0;
    const card = this.card(ch);
    // Marked before posting: a crash or a failed write after the post must
    // not post the day twice in a public channel.
    await this.store.set(key, String(ch.day));
    try {
      await this.sink.post(card);
    } catch (e) {
      await (was === null ? this.store.del(key) : this.store.set(key, was));
      throw e;
    }
    return 1;
  }

  start(): () => void {
    return pollEvery(CHRONICLE_POLL_MS, () => this.poll(), this.log, "chronicle");
  }
}
