import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import { type ChannelSink, pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";
import { editDue, LiveCards } from "./live.ts";
import { factNum, factStr } from "./screens/common.ts";
import { eventCard } from "./screens/story.ts";

/**
 * The events channel (GDD 17.2): each story event posted once, in the order
 * the world wrote it. A raid's start alone mentions the opt-in alarm role. A
 * trouble's or stage's card is edited as it fills, no more often than the
 * hunt board's edit interval, until the stage ends.
 */

export const EVENTS_POLL_MS = 10_000;

/** Pages read in one poll; the rest wait for the next. */
const PAGES = 10;

/** What the poster reads of the world. */
export interface EventsWorld {
  /** The events after a fact id. */
  storyEvents(after: number): Promise<api.StoryEvents>;
  /** Every arc a server may see, open and lately ended, to edit the cards still live. */
  arcs(): Promise<api.Arcs>;
  /** The world tick, and the least ticks between two edits of one card. */
  hunts(): Promise<Pick<api.HuntBoard, "tick" | "every">>;
}

/** A card still edited as its stage fills. */
interface Live {
  /** The card's message; empty while it is being posted. */
  message: string;
  /** The world tick it was posted or last edited at. */
  at: number;
  shown: string;
  /** The stage the card shows. */
  stage: number;
  /** The event as last shown. */
  ev: api.StoryEvent;
  mention?: string;
}

/** The arc an event is about. */
export function arcOf(ev: api.StoryEvent): string {
  return ev.arc?.id ?? factStr(ev.fact, "arc");
}

/** Whether an event's card shows a stage still filling, so it is edited as it fills. */
function live(ev: api.StoryEvent): boolean {
  if (!arcOf(ev)) return false;
  if (ev.fact.kind === "trouble.started") return !!ev.trouble;
  return (
    (ev.fact.kind === "arc.cast" || ev.fact.kind === "arc.stage-began") &&
    !!ev.arc &&
    !ev.arc.outcome &&
    ev.arc.stage === factNum(ev.fact, "stage")
  );
}

/** A live card's event with the arc as the world holds it now. */
export function refreshed(ev: api.StoryEvent, a: api.Arc): api.StoryEvent {
  if (!ev.trouble) return { ...ev, arc: a };
  const sides = a.sides;
  return {
    ...ev,
    trouble: {
      ...ev.trouble,
      mark: sides.reduce((n, s) => n + s.mark, 0),
      defence: sides.reduce((n, s) => n + Math.min(s.filled, s.mark), 0),
      ends: a.due,
    },
  };
}

/** What a live card shows, so an unchanged one is not edited again. */
export function eventShown(ev: api.StoryEvent): string {
  if (ev.trouble) return JSON.stringify([ev.trouble.defence, ev.trouble.mark, ev.trouble.ends]);
  const a = ev.arc;
  return JSON.stringify(
    a && [a.stage, a.due, a.outcome ?? "", a.sides.map((s) => [s.id, s.filled, s.backers, s.mark])],
  );
}

export class EventsPoster {
  private readonly card: (ev: api.StoryEvent) => Card | null;
  private readonly cards: LiveCards<Live>;

  constructor(
    private readonly world: EventsWorld,
    lex: Lexicon,
    private readonly store: ForumStore,
    private readonly sink: ChannelSink,
    /** The role a raid's start mentions; none when unset. */
    private readonly alarmRole?: string,
    private readonly prefix = "mmo-bot:events:",
    private readonly log: (line: string) => void = console.log,
    card?: (ev: api.StoryEvent) => Card | null,
  ) {
    this.card = card ?? ((ev) => eventCard(ev, lex));
    this.cards = new LiveCards(store, sink, `${prefix}open`, log, "events");
  }

  private get lastKey(): string {
    return `${this.prefix}last`;
  }

  private liveKey(arc: string): string {
    return `${this.prefix}live:${arc}`;
  }

  /** Posts the events not yet posted and edits the live cards; returns how many it posted or edited. */
  async poll(): Promise<number> {
    const mark = await this.store.get(this.lastKey);
    // A channel new to the poster starts at the present: the world's past is in the chronicle.
    if (mark === null) {
      await this.store.set(this.lastKey, String(await this.present()));
      return 0;
    }
    return (await this.post(Number(mark))) + (await this.refresh());
  }

  /** The last event id the world holds. */
  private async present(): Promise<number> {
    let after = 0;
    for (;;) {
      const page = await this.world.storyEvents(after);
      if (page.last <= after) return after;
      after = page.last;
    }
  }

  private async post(last: number): Promise<number> {
    let posted = 0;
    for (let i = 0; i < PAGES; i++) {
      const from = last;
      const page = await this.world.storyEvents(last);
      for (const ev of page.events) {
        if (ev.fact.id <= last) continue;
        let card: Card | null;
        try {
          card = this.card(ev);
        } catch (e) {
          this.log(`[events] ${ev.fact.kind} ${ev.fact.id}: ${String(e)}`);
          card = null;
        }
        // The event is marked before it is posted: a crash or a failed
        // write after the post must not post it twice in a public channel.
        await this.store.set(this.lastKey, String(ev.fact.id));
        if (card) {
          try {
            await this.show(ev, card);
          } catch (e) {
            await this.store.set(this.lastKey, String(last));
            throw e;
          }
          posted++;
        }
        last = ev.fact.id;
      }
      if (page.last > last) {
        // Facts the channel does not show still move the mark on.
        last = page.last;
        await this.store.set(this.lastKey, String(last));
      }
      if (last === from) break;
    }
    return posted;
  }

  private async show(ev: api.StoryEvent, card: Card): Promise<void> {
    const mention = ev.alarm && this.alarmRole ? this.alarmRole : undefined;
    if (!live(ev)) {
      await this.sink.post(card, mention);
      return;
    }
    const arc = arcOf(ev);
    const rec: Live = {
      message: "",
      at: ev.fact.tick,
      shown: eventShown(ev),
      stage: factNum(ev.fact, "stage"),
      ev,
      mention,
    };
    await this.cards.post(this.liveKey(arc), rec, card, mention, arc);
  }

  /** Edits the live cards whose sides changed, and lets go of those whose stage is over or moved on. */
  private async refresh(): Promise<number> {
    const open = await this.cards.open();
    if (!open.length) return 0;
    const [arcs, clock] = await Promise.all([this.world.arcs(), this.world.hunts()]);
    const byId = new Map([...arcs.ended, ...arcs.open].map((a) => [a.id, a]));
    let edited = 0;
    for (const id of open) {
      try {
        const r = await this.edit(id, byId.get(id), clock);
        if (r.edited) edited++;
        if (r.done) await this.cards.drop(this.liveKey(id), id);
      } catch (e) {
        this.log(`[events] ${id}: ${String(e)}`);
      }
    }
    return edited;
  }

  private async edit(
    id: string,
    a: api.Arc | undefined,
    clock: Pick<api.HuntBoard, "tick" | "every">,
  ): Promise<{ edited: boolean; done: boolean }> {
    const rec = await this.cards.get(this.liveKey(id));
    // A card whose id never reached the store is left as it was posted.
    if (!rec?.message) return { edited: false, done: true };
    // The arc is gone, or on to its next stage, whose own card shows it.
    if (!a || a.stage !== rec.stage) return { edited: false, done: true };
    const done = !!a.outcome;
    const ev = refreshed(rec.ev, a);
    const shown = eventShown(ev);
    if (shown === rec.shown) return { edited: false, done };
    if (!editDue(rec.at, clock.tick, clock.every)) return { edited: false, done: false };
    const card = this.card(ev);
    const next = { ...rec, at: clock.tick, shown, ev };
    if (!card || !(await this.cards.edit(this.liveKey(id), rec.message, card, next, rec.mention)))
      return { edited: false, done: true };
    return { edited: true, done };
  }

  start(): () => void {
    return pollEvery(EVENTS_POLL_MS, () => this.poll(), this.log, "events");
  }
}
