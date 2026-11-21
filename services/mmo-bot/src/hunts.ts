import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import type { Lexicon } from "./lexicon.ts";
import { huntClosedCard, huntPostCard } from "./screens/hunt.ts";
import type { HuntPost } from "./world.ts";

/**
 * The hunt cards in the game channel (GDD 7.6): one a hunt, posted when
 * it opens, edited on a timer at most once a world tick, and closed with
 * its spoils table. With no game channel set, nothing is posted.
 */

export const HUNT_POLL_MS = 10_000;

/** A channel as a sink for cards: posted and edited in place. */
export interface ChannelSink {
  /** Posts a card; returns its message's id. */
  post(card: Card): Promise<string>;
  /** Replaces a posted card; false when its message is gone. */
  edit(message: string, card: Card): Promise<boolean>;
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

export function huntCardOf(h: HuntPost, lex: Lexicon): Card {
  return h.closed ? huntClosedCard(h, lex) : huntPostCard(h, lex);
}

export class HuntPoster {
  constructor(
    private readonly world: { hunts(): Promise<api.HuntBoard> },
    private readonly lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    private readonly prefix = "mmo-bot:hunt:",
    private readonly log: (line: string) => void = console.log,
  ) {}

  private async posted(id: string): Promise<Posted | null> {
    const raw = await this.store.get(this.prefix + id);
    return raw ? (JSON.parse(raw) as Posted) : null;
  }

  /** Brings the channel level with the world's hunts; returns how many cards it posted or edited. */
  async poll(): Promise<number> {
    const b = await this.world.hunts();
    const openKey = `${this.prefix}open`;
    const before: string[] = JSON.parse((await this.store.get(openKey)) ?? "[]");
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
    for (const id of before) if (!still.has(id)) await this.store.del(this.prefix + id);
    await this.store.set(openKey, JSON.stringify([...still].sort()));
    return changed;
  }

  private async show(h: HuntPost, b: api.HuntBoard): Promise<boolean> {
    const key = this.prefix + h.id;
    const was = await this.posted(h.id);
    const shown = huntShown(h);
    const card = huntCardOf(h, this.lex);
    if (!was) {
      // Marked posting first: a crash or a failed write after the post
      // must not post it twice in a public channel.
      await this.store.set(key, JSON.stringify({ message: "", tick: b.tick, shown }));
      let message: string;
      try {
        message = await this.sink.post(card);
      } catch (e) {
        await this.store.del(key);
        throw e;
      }
      await this.store.set(key, JSON.stringify({ message, tick: b.tick, shown, closed: h.closed }));
      return true;
    }
    if (!was.message || was.closed || was.shown === shown) return false;
    if (b.tick - was.tick < Math.max(1, b.every)) return false;
    if (!(await this.sink.edit(was.message, card))) {
      await this.store.set(key, JSON.stringify({ ...was, closed: true }));
      return false;
    }
    await this.store.set(
      key,
      JSON.stringify({ message: was.message, tick: b.tick, shown, closed: h.closed }),
    );
    return true;
  }

  start(): () => void {
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(async () => {
        await this.poll().catch((e: unknown) => this.log(`[hunts] ${String(e)}`));
        if (!stopped) next();
      }, HUNT_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }
}
