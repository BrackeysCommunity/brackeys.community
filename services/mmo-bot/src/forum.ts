import type * as api from "./api.ts";
import { authorLine, type Card, COLOUR } from "./card.ts";
import type { Lexicon } from "./lexicon.ts";
import { banner } from "./screens/common.ts";
import { goalFields, goalSummary } from "./screens/goals.ts";
import { moverLine } from "./screens/market.ts";
import { num } from "./units.ts";

/**
 * The forums (GDD 17.2). The market forum: a post per settlement, and
 * each world day a reply with that day's notable trades and movers. The
 * notice-board forum: a post per public goal, edited as it progresses;
 * its thread is where people coordinate.
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
  /** Replaces a post's first card; false when the post is gone. */
  edit(post: string, card: Card): Promise<boolean>;
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
    return every(FORUM_POLL_MS, () => this.poll(), this.log);
  }
}

/** Runs poll again a fixed wait after each run ends, until stopped. */
function every(ms: number, poll: () => Promise<unknown>, log: (line: string) => void): () => void {
  let stopped = false;
  let t: ReturnType<typeof setTimeout>;
  const next = () => {
    t = setTimeout(async () => {
      await poll().catch((e: unknown) => log(`[forum] ${String(e)}`));
      if (!stopped) next();
    }, ms);
  };
  next();
  return () => {
    stopped = true;
    clearTimeout(t);
  };
}

const BOARD_CONTEXT = "Notice-board forum · everyone in the server can see this";

/** A public goal as its forum post. */
export function boardPostCard(p: api.BoardPost, lex: Lexicon): Card {
  return {
    context: BOARD_CONTEXT,
    author: authorLine("Notice board", p.name),
    title: p.goal.title,
    description: goalSummary(p.goal),
    picture: banner(p, ", over its notice board"),
    fields: goalFields(p.goal, lex),
    footer: "Open /goals in the settlement to take it up; plan it in this thread.",
    rows: [],
    colour: COLOUR.signal,
  };
}

/** What the poster remembers of a goal's post, to edit it and to close it. */
interface Posted {
  post: string;
  /** The goal's state as last shown: an unchanged goal is not edited again. */
  shown: string;
  /** The world tick it was last opened or edited at. */
  at: number;
  title: string;
  name: string;
  banner: string;
}

function closedCard(p: Posted): Card {
  return {
    context: BOARD_CONTEXT,
    author: authorLine("Notice board", p.name),
    title: `Off the board: ${p.title}`,
    description: "Met, expired or withdrawn. /goals shows what is posted now.",
    picture: banner(p, ", over its notice board"),
    footer: "A goal is met by recorded facts; nobody judges.",
    rows: [],
    colour: COLOUR.ash,
  };
}

/** Keeps one forum post per public goal: opened when posted, edited as it moves, closed when it leaves the board. */
export class BoardPoster {
  constructor(
    private readonly world: { board(): Promise<api.Board> },
    private readonly lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ForumSink,
    private readonly prefix = "mmo-bot:board:",
    private readonly log: (line: string) => void = console.log,
  ) {}

  /** Brings the forum level with the board; returns how many posts it opened, edited or closed. */
  async poll(): Promise<number> {
    const b = await this.world.board();
    const openKey = `${this.prefix}open`;
    const before: string[] = JSON.parse((await this.store.get(openKey)) ?? "[]");
    const live = new Set(b.posts.map((p) => p.goal.id));
    const still = new Set<string>();
    let changed = 0;
    for (const p of b.posts) {
      try {
        if (await this.show(p, b)) changed++;
        still.add(p.goal.id);
      } catch (e) {
        this.log(`[board] ${p.goal.id}: ${String(e)}`);
        if (before.includes(p.goal.id)) still.add(p.goal.id);
      }
    }
    for (const id of before) {
      if (live.has(id)) continue;
      try {
        await this.close(id);
        changed++;
      } catch (e) {
        this.log(`[board] ${id}: ${String(e)}`);
        still.add(id);
      }
    }
    await this.store.set(openKey, JSON.stringify([...still].sort()));
    return changed;
  }

  private async posted(id: string): Promise<Posted | null> {
    const raw = await this.store.get(`${this.prefix}goal:${id}`);
    return raw ? (JSON.parse(raw) as Posted) : null;
  }

  private async show(p: api.BoardPost, b: api.Board): Promise<boolean> {
    const g = p.goal;
    const shown = [g.state, g.progress, g.claims, g.pledged ?? 0, g.left ?? 0, g.hauler ?? ""].join(
      "|",
    );
    const was = await this.posted(g.id);
    if (was?.shown === shown) return false;
    // A post is edited no more often than the board allows; the next poll catches up.
    if (was && b.tick - was.at < b.every) return false;
    const card = boardPostCard(p, this.lex);
    const post =
      was && (await this.sink.edit(was.post, card))
        ? was.post
        : await this.sink.open(`${p.name} · ${g.title}`.slice(0, 100), card);
    const now: Posted = { post, shown, at: b.tick, title: g.title, name: p.name, banner: p.banner };
    await this.store.set(`${this.prefix}goal:${g.id}`, JSON.stringify(now));
    return true;
  }

  private async close(id: string): Promise<void> {
    const was = await this.posted(id);
    if (was) await this.sink.reply(was.post, closedCard(was));
  }

  start(): () => void {
    return every(FORUM_POLL_MS, () => this.poll(), this.log);
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
