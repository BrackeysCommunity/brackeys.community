import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import type { Lexicon } from "./lexicon.ts";
import { editDue, LiveCards } from "./live.ts";
import { huntClosedCard, huntPostCard } from "./screens/hunt.ts";
import type { HuntPost } from "./world.ts";

/**
 * The hunt cards (GDD 7.6) in the events channel, or the game channel
 * where no events channel is set: one a hunt, posted when it opens, edited
 * on a timer at most once a world tick, and closed with its spoils table.
 * With neither channel set, nothing is posted.
 */

export const HUNT_POLL_MS = 10_000;

/**
 * A channel as a sink for cards: posted and edited in place. A post naming
 * a role mentions it and pings it alone; an edit shows the mention without
 * pinging anyone again.
 */
export interface ChannelSink {
  /** Posts a card; returns its message's id. */
  post(card: Card, mentionRole?: string): Promise<string>;
  /** Replaces a posted card; false when its message is gone. */
  edit(message: string, card: Card, mentionRole?: string): Promise<boolean>;
}

/** Runs poll again a fixed wait after each run ends, until stopped. */
export function pollEvery(
  ms: number,
  poll: () => Promise<unknown>,
  log: (line: string) => void,
  tag: string,
): () => void {
  let stopped = false;
  let t: ReturnType<typeof setTimeout>;
  const next = () => {
    t = setTimeout(async () => {
      await poll().catch((e: unknown) => log(`[${tag}] ${String(e)}`));
      if (!stopped) next();
    }, ms);
  };
  next();
  return () => {
    stopped = true;
    clearTimeout(t);
  };
}

interface Posted {
  /** The card's message; empty while it is being posted. */
  message: string;
  /** The world tick it was posted or last edited at. */
  tick: number;
  shown: string;
  closed?: boolean;
}

/** What a hunt's card shows, so an unchanged hunt is not edited again. */
export function huntShown(h: api.HuntCard): string {
  return JSON.stringify([
    h.health,
    h.ends,
    h.closed ?? false,
    h.slain ?? false,
    h.pressers.map((p) => [p.name, p.removed]),
  ]);
}

/** A hunt's card; context names the channel it is posted in where that is not the game channel. */
export function huntCardOf(h: HuntPost, lex: Lexicon, context?: string): Card {
  const card = h.closed ? huntClosedCard(h, lex) : huntPostCard(h, lex);
  return context ? { ...card, context } : card;
}

export class HuntPoster {
  private readonly cards: LiveCards<Posted>;

  constructor(
    private readonly world: { hunts(): Promise<api.HuntBoard> },
    private readonly lex: Lexicon,
    store: ForumStore,
    sink: ChannelSink,
    private readonly prefix = "mmo-bot:hunt:",
    private readonly log: (line: string) => void = console.log,
    private readonly context?: string,
  ) {
    this.cards = new LiveCards(store, sink, `${prefix}open`, log, "hunts");
  }

  /** Brings the channel level with the world's hunts; returns how many cards it posted or edited. */
  async poll(): Promise<number> {
    const b = await this.world.hunts();
    const before = await this.cards.open();
    const still = new Set<string>();
    let changed = 0;
    for (const h of b.hunts as HuntPost[]) {
      still.add(h.id);
      try {
        if (await this.show(h, b)) changed++;
      } catch (e) {
        this.log(`[hunts] ${h.id}: ${String(e)}`);
      }
    }
    // A hunt cleared from the world keeps its card as last edited.
    for (const id of before) if (!still.has(id)) await this.cards.drop(this.prefix + id);
    await this.cards.setOpen(still);
    return changed;
  }

  private async show(h: HuntPost, b: api.HuntBoard): Promise<boolean> {
    const key = this.prefix + h.id;
    const was = await this.cards.get(key);
    const shown = huntShown(h);
    const card = huntCardOf(h, this.lex, this.context);
    const next: Posted = { message: was?.message ?? "", tick: b.tick, shown, closed: h.closed };
    if (!was) {
      await this.cards.post(key, next, card);
      return true;
    }
    if (!was.message || was.closed || was.shown === shown) return false;
    if (!editDue(was.tick, b.tick, b.every)) return false;
    return this.cards.edit(key, was.message, card, next, undefined, { ...was, closed: true });
  }

  start(): () => void {
    return pollEvery(HUNT_POLL_MS, () => this.poll(), this.log, "hunts");
  }
}
