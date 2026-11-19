import type * as api from "./api.ts";
import { type Card, COLOUR } from "./card.ts";
import type { Lexicon } from "./lexicon.ts";
import { amount, num } from "./units.ts";

/**
 * The market forum (GDD 17.2): a post per settlement, and each world day
 * a reply with that day's notable trades and movers. The poster asks the
 * world once a poll for the day just closed, and posts a day once.
 */

export const FORUM_POLL_MS = 60_000;

/** Where the poster keeps a settlement's post and the last day it posted. */
export interface ForumStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Posting a card: into a settlement's post, opening it on the first day. */
export interface ForumSink {
  /** Opens a settlement's post with its first card; returns the post's id. */
  open(title: string, card: Card): Promise<string>;
  reply(post: string, card: Card): Promise<void>;
}

export function forumCard(p: api.ForumPost, day: number, lex: Lexicon): Card {
  return {
    context: "Market forum · everyone in the server can see this",
    author: `Market · ${p.name}`.slice(0, 59),
    title: `Day ${num(day)}: the notable trades`,
    description: p.trades.length ? undefined : "Nothing changed hands worth noting.",
    picture: { media: p.banner, alt: `Banner of ${p.name}` },
    table: p.trades.length
      ? {
          header: ["What", "Units (goods)", "Price (coin each)", "Total (coin)"],
          rows: p.trades.map((t) => [t.what.slice(0, 26), num(t.units), num(t.price), num(t.coin)]),
        }
      : undefined,
    fields: p.movers.length
      ? [
          {
            name: "Movers",
            value: p.movers
              .map(
                (m) =>
                  `${lex.material(m.material)}: ${m.change >= 0 ? "+" : "−"}${num(Math.abs(m.change))}% to ${amount(m.last, "coin")}${m.cause ? `, after ${m.cause}` : ""}`,
              )
              .join("\n"),
          },
        ]
      : undefined,
    footer: "Open /market in the settlement to trade.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** Posts each closed world day once, per settlement. */
export class ForumPoster {
  constructor(
    private readonly world: { forum(): Promise<api.Forum> },
    private readonly lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ForumSink,
    private readonly prefix = "mmo-bot:forum:",
  ) {}

  async poll(): Promise<number> {
    const f = await this.world.forum();
    if (f.day < 0) return 0;
    const last = Number((await this.store.get(this.prefix + "day")) ?? -1);
    if (f.day <= last) return 0;
    let posted = 0;
    for (const p of f.posts) {
      const card = forumCard(p, f.day, this.lex);
      const key = `${this.prefix}post:${p.settlement}`;
      const post = await this.store.get(key);
      if (post) await this.sink.reply(post, card);
      else await this.store.set(key, await this.sink.open(`Market · ${p.name}`, card));
      posted++;
    }
    await this.store.set(this.prefix + "day", String(f.day));
    return posted;
  }

  start(log: (line: string) => void = console.log): () => void {
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(async () => {
        await this.poll().catch((e: unknown) => log(`[forum] ${String(e)}`));
        if (!stopped) next();
      }, FORUM_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }
}

/** A store in memory, for a bot without Redis. */
export function memoryStore(): ForumStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
  };
}
