import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import { type ChannelSink, pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";
import { postOnce } from "./live.ts";
import { promotionCard } from "./screens/emergence.ts";

/**
 * Promotions in the chronicle channel (GDD 12.7, 17.2): each thing play
 * made part of the world, a legend laid, a custom held and what a season
 * added, posted once as it happens, in the order the world wrote it. The
 * mark is kept apart from the events channel's, so either channel may be
 * set alone.
 */

export const PROMOTIONS_POLL_MS = 15_000;

/** Pages read in one poll; the rest wait for the next. */
const PAGES = 10;

/** What the poster reads of the world. */
export interface PromotionsWorld {
  /** The promotions after a fact id. */
  storyPromotions(after: number): Promise<api.StoryEvents>;
}

export class PromotionsPoster {
  private readonly card: (ev: api.StoryEvent) => Card | null;

  constructor(
    private readonly world: PromotionsWorld,
    lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    /** Called after each post, before the next card is drawn: the lexicon's refresh. */
    private readonly posted: () => Promise<void> = async () => {},
    private readonly prefix = "mmo-bot:promotions:",
    private readonly log: (line: string) => void = console.log,
    card?: (ev: api.StoryEvent) => Card | null,
  ) {
    this.card = card ?? ((ev) => promotionCard(ev, lex));
  }

  private get lastKey(): string {
    return `${this.prefix}last`;
  }

  /** Posts the promotions not yet posted; returns how many it posted. */
  async poll(): Promise<number> {
    const mark = await this.store.get(this.lastKey);
    // A channel new to the poster starts at the present: the daily chronicle kept the past.
    if (mark === null) {
      await this.store.set(this.lastKey, String(await this.present()));
      return 0;
    }
    return this.post(Number(mark));
  }

  /** The last promotion id the world holds. */
  private async present(): Promise<number> {
    let after = 0;
    for (;;) {
      const page = await this.world.storyPromotions(after);
      if (page.last <= after) return after;
      after = page.last;
    }
  }

  private async post(last: number): Promise<number> {
    let posted = 0;
    for (let i = 0; i < PAGES; i++) {
      const from = last;
      const page = await this.world.storyPromotions(last);
      for (const ev of page.events) {
        if (ev.fact.id <= last) continue;
        let card: Card | null;
        try {
          card = this.card(ev);
        } catch (e) {
          this.log(`[promotions] ${ev.fact.kind} ${ev.fact.id}: ${String(e)}`);
          card = null;
        }
        if (card) {
          const prev = String(last);
          const shown = card;
          await postOnce(
            this.store,
            this.lastKey,
            String(ev.fact.id),
            () => this.sink.post(shown),
            () => this.store.set(this.lastKey, prev),
          );
          posted++;
          await this.posted().catch((e: unknown) => this.log(`[promotions] ${String(e)}`));
        } else {
          await this.store.set(this.lastKey, String(ev.fact.id));
        }
        last = ev.fact.id;
      }
      if (page.last > last) {
        last = page.last;
        await this.store.set(this.lastKey, String(last));
      }
      if (last === from) break;
    }
    return posted;
  }

  start(): () => void {
    return pollEvery(PROMOTIONS_POLL_MS, () => this.poll(), this.log, "promotions");
  }
}
