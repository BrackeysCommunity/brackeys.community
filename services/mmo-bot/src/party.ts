import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import type { Lexicon } from "./lexicon.ts";
import type { ThreadBudget } from "./publish.ts";
import { threadCard, threadEndedCard, type ThreadPicture } from "./screens/party.ts";

/**
 * Party threads (GDD 7.5, 17.2). A party plays in a private thread under
 * the channel where /party or the hub's Party button was pressed, with its
 * members added (a public thread where a private one is refused). The
 * thread keeps one card, who has picked and never what, edited at most
 * every two seconds and polled from the world; the thread is archived
 * when the party ends. Past the server's thread budget the party plays on
 * in ephemeral cards until a thread can open. The thread and its card are
 * the bot's own bookkeeping, kept under mmo-bot:party:<id>.
 */

export const PARTY_POLL_MS = 5_000;
/** One edit of a thread's card in this many ms at most (spike D rule 2). */
export const PARTY_EDIT_MS = 2_000;
/** A thread marked opening for this long without its id is taken as never opened. */
export const OPENING_STALE_MS = 60_000;

/** What a press tells the poster of a party. */
export interface PartyNote {
  party: string;
  /** The members' Discord users, to add to the thread. */
  members: string[];
  channel?: string;
  server?: string;
  picture?: ThreadPicture;
  /** A card to post in the thread, such as a beat resolved. */
  post?: Card;
}

/** How a party plays after a note: in its thread, or in ephemeral cards until one opens. */
export type PartyMode = "thread" | "soon" | "none";

/** A channel's threads as a sink for one party's cards. */
export interface ThreadSink {
  /** Opens a thread under a channel, private where it may be, with the members in it and the card as its first message. */
  open(
    channel: string,
    name: string,
    card: Card,
    members: string[],
  ): Promise<{ thread: string; card: string }>;
  /** Adds members; false when the thread is gone. */
  add(thread: string, members: string[]): Promise<boolean>;
  /** Replaces the thread's card; false when the thread or the card is gone. */
  edit(thread: string, card: string, c: Card): Promise<boolean>;
  /** Posts a card in the thread; false when the thread is gone. */
  post(thread: string, c: Card): Promise<boolean>;
  archive(thread: string): Promise<void>;
}

interface Kept {
  party: string;
  state: "opening" | "soon" | "open";
  /** When the thread was marked opening, or its card last edited, in ms. */
  at: number;
  channel: string;
  server: string;
  members: string[];
  thread?: string;
  card?: string;
  shown?: string;
  picture?: ThreadPicture;
}

/** What a thread card shows, so an unchanged party is not edited again. */
export function shownOf(b: api.PartyBoard): string {
  return JSON.stringify([
    b.members.map((m) => [m.name, m.picked, m.chose, m.down]),
    b.beat && [b.beat.beat, b.beat.kind, b.beat.picked, b.beat.present, b.beat.waiting],
    b.fork && [b.fork.floor, b.fork.ways.map((w) => [w.id, w.open, w.votes])],
    b.due ?? 0,
  ]);
}

export class PartyPoster {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly world: { parties(): Promise<api.Parties> },
    private readonly lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ThreadSink,
    private readonly budget: ThreadBudget,
    private readonly opts: {
      prefix?: string;
      now?: () => number;
      log?: (line: string) => void;
      editMs?: number;
    } = {},
  ) {}

  private get prefix() {
    return this.opts.prefix ?? "mmo-bot:party:";
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }
  private log(line: string) {
    (this.opts.log ?? console.log)(line);
  }
  private get editMs() {
    return this.opts.editMs ?? PARTY_EDIT_MS;
  }

  /** One party's work at a time, in the order asked. */
  private serial<T>(party: string, f: () => Promise<T>): Promise<T> {
    const run = (this.chains.get(party) ?? Promise.resolve()).then(f, f);
    this.chains.set(
      party,
      run.catch(() => {}),
    );
    return run;
  }

  private async kept(party: string): Promise<Kept | null> {
    const raw = await this.store.get(this.prefix + party);
    return raw ? (JSON.parse(raw) as Kept) : null;
  }
  private keep(k: Kept) {
    return this.store.set(this.prefix + k.party, JSON.stringify(k));
  }
  private async index(): Promise<string[]> {
    return JSON.parse((await this.store.get(`${this.prefix}open`)) ?? "[]") as string[];
  }
  private async indexed(party: string, on: boolean) {
    const ids = new Set(await this.index());
    if (on === ids.has(party)) return;
    if (on) ids.add(party);
    else ids.delete(party);
    await this.store.set(`${this.prefix}open`, JSON.stringify([...ids].sort()));
  }

  private async board(party: string): Promise<api.PartyBoard | undefined> {
    return (await this.world.parties()).parties.find((p) => p.id === party);
  }

  /** A press about a party: open its thread if it has none, add new members, post the card it brings, and bring the thread card up to date. */
  note(n: PartyNote): Promise<PartyMode> {
    return this.serial(n.party, async () => {
      const was = await this.kept(n.party);
      if (!was) {
        if (!n.channel || !n.server) return "none";
        return this.open(
          {
            party: n.party,
            state: "soon",
            at: 0,
            channel: n.channel,
            server: n.server,
            members: [],
            picture: n.picture,
          },
          n.members,
        );
      }
      const k: Kept = {
        ...was,
        picture: n.picture ?? was.picture,
        channel: was.channel || n.channel || "",
      };
      if (k.state === "opening" && this.now() - k.at < OPENING_STALE_MS) return "thread";
      if (k.state !== "open") return this.open(k, n.members);
      const added = n.members.filter((m) => !k.members.includes(m));
      if (added.length) {
        if (!(await this.sink.add(k.thread!, added))) return this.gone(k, n.members);
        k.members.push(...added);
      }
      await this.keep(k);
      if (n.post && !(await this.sink.post(k.thread!, n.post))) return this.gone(k, n.members);
      await this.refresh(k);
      return "thread";
    });
  }

  /** A thread someone deleted: it is opened again. */
  private async gone(k: Kept, members: string[]): Promise<PartyMode> {
    this.budget.closed(k.server);
    return this.open(
      { ...k, state: "soon", thread: undefined, card: undefined, shown: undefined, members: [] },
      members,
    );
  }

  /** Opens a party's thread, marking it opening first so a crash or a second press never opens two. */
  private async open(k: Kept, members: string[]): Promise<PartyMode> {
    const b = await this.board(k.party);
    if (!b || b.ended) {
      await this.forget(k.party);
      return "none";
    }
    if (!this.budget.take(k.server)) {
      await this.keep({ ...k, state: "soon" });
      await this.indexed(k.party, true);
      return "soon";
    }
    const all = [...new Set([...members, ...b.members.map((m) => m.discordId).filter(Boolean)])];
    await this.keep({ ...k, state: "opening", at: this.now() });
    await this.indexed(k.party, true);
    const card = threadCard(b, this.lex, k.picture);
    try {
      const opened = await this.sink.open(k.channel, threadName(b), card, all);
      await this.keep({
        ...k,
        state: "open",
        at: this.now(),
        members: all,
        thread: opened.thread,
        card: opened.card,
        shown: shownOf(b),
      });
      return "thread";
    } catch (e) {
      // Forgotten rather than retried: a channel that takes no threads never
      // will, and the next press may come from one that does.
      this.budget.closed(k.server);
      await this.forget(k.party);
      this.log(`[party] ${k.party}: the thread would not open in ${k.channel}: ${String(e)}`);
      return "none";
    }
  }

  /** Edits the thread's card when what it shows has changed, no sooner than the edit rule allows. */
  private async refresh(k: Kept, given?: api.PartyBoard): Promise<void> {
    const b = given ?? (await this.board(k.party));
    if (!b || b.ended) return this.close(k);
    const shown = shownOf(b);
    if (shown === k.shown) return;
    const wait = k.at + this.editMs - this.now();
    if (wait > 0) {
      this.later(k.party, wait);
      return;
    }
    if (!(await this.sink.edit(k.thread!, k.card!, threadCard(b, this.lex, k.picture)))) {
      await this.gone(k, k.members);
      return;
    }
    await this.keep({ ...k, at: this.now(), shown });
  }

  /** One edit waits for the rest of the edit window; more changes meanwhile ride on it. */
  private later(party: string, ms: number) {
    if (this.pending.has(party)) return;
    this.pending.set(
      party,
      setTimeout(() => {
        this.pending.delete(party);
        void this.serial(party, async () => {
          const k = await this.kept(party);
          if (k?.state === "open") await this.refresh(k);
        }).catch((e: unknown) => this.log(`[party] ${party}: ${String(e)}`));
      }, ms),
    );
  }

  /** Says the party has ended on its card, archives the thread and forgets it. */
  private async close(k: Kept): Promise<void> {
    if (k.state === "open" && k.thread) {
      if (k.card) await this.sink.edit(k.thread, k.card, threadEndedCard(k.picture));
      await this.sink.archive(k.thread);
      this.budget.closed(k.server);
    }
    await this.forget(k.party);
  }

  private async forget(party: string) {
    const t = this.pending.get(party);
    if (t) clearTimeout(t);
    this.pending.delete(party);
    await this.store.del(this.prefix + party);
    await this.indexed(party, false);
  }

  /** Brings every kept thread level with the world: cards edited, threads waiting on the budget opened, ended parties closed. */
  async poll(): Promise<number> {
    const board = await this.world.parties();
    const live = new Map(board.parties.map((p) => [p.id, p]));
    let changed = 0;
    for (const id of await this.index()) {
      try {
        await this.serial(id, async () => {
          const k = await this.kept(id);
          if (!k) return this.indexed(id, false);
          const b = live.get(id);
          if (!b || b.ended) {
            await this.close(k);
            changed++;
            return;
          }
          if (
            k.state === "soon" ||
            (k.state === "opening" && this.now() - k.at >= OPENING_STALE_MS)
          ) {
            if ((await this.open(k, k.members)) === "thread") changed++;
            return;
          }
          if (k.state !== "open") return;
          const added = b.members
            .map((m) => m.discordId)
            .filter((m) => m && !k.members.includes(m));
          if (added.length && (await this.sink.add(k.thread!, added))) {
            k.members.push(...added);
            await this.keep(k);
          }
          const before = k.shown;
          await this.refresh(k, b);
          if ((await this.kept(id))?.shown !== before) changed++;
        });
      } catch (e) {
        this.log(`[party] ${id}: ${String(e)}`);
      }
    }
    return changed;
  }

  start(): () => void {
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(async () => {
        await this.poll().catch((e: unknown) => this.log(`[party] ${String(e)}`));
        if (!stopped) next();
      }, PARTY_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(t);
      for (const p of this.pending.values()) clearTimeout(p);
    };
  }
}

function threadName(b: api.PartyBoard): string {
  return `Party · ${b.members.map((m) => m.name).join(", ")}`.slice(0, 100);
}
