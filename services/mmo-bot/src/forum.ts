import type * as api from "./api.ts";
import { authorLine, type Card, COLOUR } from "./card.ts";
import type { Lexicon } from "./lexicon.ts";
import { banner } from "./screens/common.ts";
import { moverLine } from "./screens/market.ts";
import { num } from "./units.ts";

/**
 * The market forum (GDD 17.2): a post per settlement, and each world day
 * a reply with that day's notable trades and movers.
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
  /** Replies in a post; false when the post is gone. */
  reply(post: string, card: Card): Promise<boolean>;
}

export function forumCard(p: api.ForumPost, day: number, lex: Lexicon): Card {
  return {
    context: "Market forum · everyone in the server can see this",
    author: authorLine("Market", p.name),
    title: `Day ${num(day)}: the notable trades`,
    description: p.trades.length ? undefined : "Nothing changed hands worth noting.",
    picture: banner(p),
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
            value: p.movers.map((m) => moverLine(m, lex)).join("\n"),
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
    private readonly log: (line: string) => void = console.log,
  ) {}

  /** Posts the closed day where not yet posted; a settlement that fails is tried again next poll. */
  async poll(): Promise<number> {
    const f = await this.world.forum();
    if (f.day < 0) return 0;
    let posted = 0;
    for (const p of f.posts) {
      try {
        if (await this.post(p, f.day)) posted++;
      } catch (e) {
        this.log(`[forum] ${p.name}: ${String(e)}`);
      }
    }
    return posted;
  }

  private async post(p: api.ForumPost, day: number): Promise<boolean> {
    const dayKey = `${this.prefix}post:${p.settlement}:day`;
    const last = Number((await this.store.get(dayKey)) ?? -1);
    if (day <= last) return false;
    const card = forumCard(p, day, this.lex);
    const postKey = `${this.prefix}post:${p.settlement}`;
    const post = await this.store.get(postKey);
    // The day is marked before posting: a crash or a failed write after the
    // post must not post it twice in a public channel.
    await this.store.set(dayKey, String(day));
    let opened: string | undefined;
    try {
      if (!post || !(await this.sink.reply(post, card)))
        opened = await this.sink.open(`Market · ${p.name}`, card);
    } catch (e) {
      await this.store.set(dayKey, String(last));
      throw e;
    }
    if (opened) await this.store.set(postKey, opened);
    return true;
  }

  start(): () => void {
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(async () => {
        await this.poll().catch((e: unknown) => this.log(`[forum] ${String(e)}`));
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

/** A store in memory, for tests. */
export function memoryStore(): ForumStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
  };
}
