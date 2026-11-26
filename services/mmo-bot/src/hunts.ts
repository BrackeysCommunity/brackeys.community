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
 * With neither channel set, nothing is posted. A server's staged hunt is
 * posted only in that server's channel (GDD 14.5).
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

/** Each guild's house as the bot holds it; null when the world serves none. */
export interface HouseReader {
  houseOf(guild: string): Promise<api.House | null>;
}

/** The server a channel belongs to, and the houses that say which staged things are its own. */
export interface Audience {
  server: string;
  houses: HouseReader;
}

/** An audience's house: null without an audience or when the world serves none, undefined when the read failed. */
export async function audienceHouse(
  audience: Audience | undefined,
  log: (line: string) => void,
  label: string,
): Promise<api.House | null | undefined> {
  if (!audience) return null;
  try {
    return await audience.houses.houseOf(audience.server);
  } catch (e) {
    log(`[${label}] house of ${audience.server}: ${String(e)}`);
    return undefined;
  }
}

/** Whether a staged hunt is this audience's: its stage is one of the server's own. */
export function ownStage(house: api.House | null | undefined, stage: string): boolean {
  return !!house?.stages.some((s) => s.id === stage);
}

/** Anything polled on a timer. */
export interface Poller {
  poll(): Promise<number>;
}

/**
 * A poster's store prefix in one guild's channel: the bare base for the
 * primary guild's own channel, whose stored marks use it, and
 * base<guild>:<channel>: for every other.
 */
export function posterPrefix(
  base: string,
  guild: string,
  channel: string,
  primary?: { guild: string; channel: string },
): string {
  return primary && primary.guild === guild && primary.channel === channel
    ? base
    : `${base}${guild}:${channel}:`;
}

/**
 * One poster for each guild's channel, made the first time the channel is
 * seen and polled together. The channel is read again each poll, so a
 * guild that maps another channel gets a new poster, which starts at the
 * present; a guild with no channel is skipped. The guilds follow the
 * servers the bot is in: one added starts at the present, one removed
 * drops its poster.
 */
export class GuildPosters<P extends Poller> implements Poller {
  private readonly made = new Map<string, { channel: string; poster: P }>();
  private readonly list: Set<string>;

  constructor(
    guilds: Iterable<string>,
    private readonly channelOf: (guild: string) => Promise<string | undefined>,
    private readonly make: (guild: string, channel: string) => P,
    private readonly log: (line: string) => void = console.log,
    private readonly tag = "guilds",
  ) {
    this.list = new Set(guilds);
  }

  /** Follows a guild; false when it was followed already. */
  add(guild: string): boolean {
    if (!guild || this.list.has(guild)) return false;
    this.list.add(guild);
    return true;
  }

  /** Stops following a guild and drops its poster; false when it was not followed. */
  remove(guild: string): boolean {
    this.made.delete(guild);
    return this.list.delete(guild);
  }

  /** The guilds followed, in the order they were added. */
  guilds(): string[] {
    return [...this.list];
  }

  /** A guild's poster, once its channel has been seen. */
  posterOf(guild: string): P | undefined {
    return this.made.get(guild)?.poster;
  }

  async poll(): Promise<number> {
    let n = 0;
    for (const guild of this.guilds()) {
      try {
        const channel = await this.channelOf(guild);
        // A guild removed while its channel was read gets no poster.
        if (!channel || !this.list.has(guild)) {
          this.made.delete(guild);
          continue;
        }
        let was = this.made.get(guild);
        if (was?.channel !== channel) {
          was = { channel, poster: this.make(guild, channel) };
          this.made.set(guild, was);
        }
        n += await was.poster.poll();
      } catch (e) {
        this.log(`[${this.tag}] ${guild}: ${String(e)}`);
      }
    }
    return n;
  }

  start(ms: number): () => void {
    return pollEvery(ms, () => this.poll(), this.log, this.tag);
  }
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
    private readonly audience?: Audience,
  ) {
    this.cards = new LiveCards(store, sink, `${prefix}open`, log, "hunts");
  }

  /** Brings the channel level with the world's hunts; returns how many cards it posted or edited. */
  async poll(): Promise<number> {
    const b = await this.world.hunts();
    const before = await this.cards.open();
    const still = new Set<string>();
    let changed = 0;
    const house = await this.house(b.hunts);
    for (const h of b.hunts as HuntPost[]) {
      if (h.stage && this.audience && !ownStage(house, h.stage)) {
        // Unread, a staged card already up is left as it is, so it is never posted twice.
        if (house === undefined && before.includes(h.id)) still.add(h.id);
        continue;
      }
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

  /**
   * This channel's house, read only when a staged hunt is open: null when
   * the world serves none, undefined when the read failed.
   */
  private async house(hunts: readonly api.HuntCard[]): Promise<api.House | null | undefined> {
    if (!hunts.some((h) => h.stage)) return null;
    return audienceHouse(this.audience, this.log, "hunts");
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
