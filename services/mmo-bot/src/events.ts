import type * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ForumStore } from "./forum.ts";
import { alarmRoleOf, quietNow } from "./house.ts";
import { type Audience, audienceHouse, type ChannelSink, pollEvery } from "./hunts.ts";
import type { Lexicon } from "./lexicon.ts";
import { editDue, LiveCards, postOnce } from "./live.ts";
import { factNum, factStr } from "./screens/common.ts";
import { contestsOf, stageIdOf } from "./screens/staged.ts";
import { eventCard, type StagedEvent } from "./screens/story.ts";
import type { WorldReply } from "./world.ts";

/**
 * The events channel (GDD 17.2): each story event posted once, in the order
 * the world wrote it. A raid's start alone mentions the alarm role, except
 * in its server's quiet hours (GDD 14.7). A trouble's or stage's card is
 * edited as it fills, no more often than the hunt board's edit interval,
 * until the stage ends; a drop's or fair's as its crates go. An event a
 * server staged is posted only in that server's channel (GDD 14.5).
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
  /** A fact and its causes, as everyone may see them; without it no event is told with its causes. */
  chronicleFact?(characterId: string | undefined, id: number): Promise<WorldReply<api.FactCauses>>;
}

/** The kinds told with what led to them: an ending is narrated with its causes (GDD 15.2). */
export const TOLD_WITH_CAUSES: ReadonlySet<string> = new Set([
  "arc.stage-ended",
  "trouble.held",
  "trouble.lost",
  "arc.ended",
  "season.finale",
  "season.closed",
]);

/** An event with its fact's causes, and a staging's stage and contests, where the poster read them. */
export type CausedEvent = StagedEvent & { causes?: api.FactCauses };

/**
 * Whose events channel a poster fills: its server, whose house names the
 * alarm roles and quiet hours and holds its stages; the board for a fair's
 * contests; and the wall clock quiet hours are read on.
 */
export interface EventsAudience extends Audience {
  board?(): Promise<api.Board>;
  now?(): number;
}

/** The staging kinds whose card is kept live as their crates go. */
const LIVE_STAGED: ReadonlySet<string> = new Set(["drop", "fair"]);

/** The live key of a staging's card, apart from every arc id. */
const STAGE_KEY = "stage:";

/**
 * An event's card, or null when the channel does not show it. mode is
 * "post" for a first post and "cached" for a live edit, which must never
 * wait on a model; template is the poster's own card.
 */
export type EventCard = (
  ev: CausedEvent,
  mode: "post" | "cached",
  template: () => Card | null,
) => Card | null | Promise<Card | null>;

/** A card still edited as its stage fills. */
interface Live {
  /** The card's message; empty while it is being posted. */
  message: string;
  /** The world tick it was posted or last edited at. */
  at: number;
  shown: string;
  /** The arc stage the card shows; -1 on a staging's card. */
  stage: number;
  /** The event as last shown. */
  ev: CausedEvent;
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

/** A live card's event with its arc, or for a trouble its trouble, as the world holds it now. */
export function refreshed(ev: api.StoryEvent, a: api.Arc): api.StoryEvent {
  return ev.trouble ? { ...ev, trouble: a.trouble ?? ev.trouble } : { ...ev, arc: a };
}

/** What a live card shows, so an unchanged one is not edited again. */
export function eventShown(ev: CausedEvent): string {
  if (ev.stage)
    return JSON.stringify([
      ev.stage.crates ?? 0,
      !!ev.stage.open,
      !!ev.stage.closed,
      (ev.contests ?? []).map((g) => [g.id, g.claims]),
    ]);
  if (ev.trouble) return JSON.stringify([ev.trouble.defence, ev.trouble.mark, ev.trouble.ends]);
  const a = ev.arc;
  return JSON.stringify(
    a && [a.stage, a.due, a.outcome ?? "", a.sides.map((s) => [s.id, s.filled, s.backers, s.mark])],
  );
}

export class EventsPoster {
  private readonly card: EventCard;
  private readonly template: (ev: CausedEvent) => Card | null;
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
    card?: EventCard,
    private readonly audience?: EventsAudience,
  ) {
    this.template = (ev) => eventCard(ev, lex);
    this.card = card ?? this.template;
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
        let card: Card | null = null;
        let told: CausedEvent = ev;
        if (this.mine(ev))
          try {
            const caused = await this.withStage(await this.withCauses(ev));
            told = caused;
            card = await this.card(caused, "post", () => this.template(caused));
          } catch (e) {
            this.log(`[events] ${ev.fact.kind} ${ev.fact.id}: ${String(e)}`);
            card = null;
          }
        if (card) {
          const prev = String(last);
          await postOnce(
            this.store,
            this.lastKey,
            String(ev.fact.id),
            () => this.show(told, card),
            () => this.store.set(this.lastKey, prev),
          );
          posted++;
        } else {
          await this.store.set(this.lastKey, String(ev.fact.id));
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

  /** Whether an event belongs in this channel: the world's own, or staged by this channel's server. */
  private mine(ev: api.StoryEvent): boolean {
    return !ev.server || !this.audience || ev.server === this.audience.server;
  }

  /** This channel's house; null when there is none or it cannot be read. */
  private async house(): Promise<api.House | null> {
    return (await audienceHouse(this.audience, this.log, "events")) ?? null;
  }

  /** A fair's contests from the board; none when the board cannot be read. */
  private async contests(stage: api.StageView): Promise<api.Goal[] | undefined> {
    if (stage.kind !== "fair" || !this.audience?.board) return undefined;
    try {
      return contestsOf(await this.audience.board(), stage);
    } catch (e) {
      this.log(`[events] board for ${stage.id}: ${String(e)}`);
      return undefined;
    }
  }

  /** A staging's opening with the house's view of its stage, and a fair's contests; any other event as it is. */
  private async withStage(ev: CausedEvent): Promise<CausedEvent> {
    if (ev.fact.kind !== "staged.opened") return ev;
    const id = stageIdOf(ev.fact);
    const stage = (await this.house())?.stages.find((s) => s.id === id);
    if (!stage) return ev;
    const contests = await this.contests(stage);
    return { ...ev, stage, ...(contests ? { contests } : {}) };
  }

  /**
   * The alarm role a post mentions: the house's first, else the one the
   * poster was given; none outside an alarm, and none in quiet hours.
   */
  private async mention(ev: api.StoryEvent): Promise<string | undefined> {
    if (!ev.alarm) return undefined;
    const house = await this.house();
    const role = alarmRoleOf(house?.settings, this.alarmRole);
    if (!role) return undefined;
    if (house && quietNow(house.settings, (this.audience?.now ?? Date.now)())) return undefined;
    return role;
  }

  /** The event with its causes, for a kind told with them; the event alone when they cannot be read. */
  private async withCauses(ev: api.StoryEvent): Promise<CausedEvent> {
    if (!this.world.chronicleFact || !TOLD_WITH_CAUSES.has(ev.fact.kind)) return ev;
    try {
      const r = await this.world.chronicleFact(undefined, ev.fact.id);
      return r.ok ? { ...ev, causes: r.reply } : ev;
    } catch (e) {
      this.log(`[events] causes of ${ev.fact.id}: ${String(e)}`);
      return ev;
    }
  }

  private async show(ev: CausedEvent, card: Card): Promise<void> {
    const mention = await this.mention(ev);
    if (ev.stage && LIVE_STAGED.has(ev.stage.kind) && !ev.stage.closed) {
      const id = STAGE_KEY + ev.stage.id;
      const rec: Live = {
        message: "",
        at: ev.fact.tick,
        shown: eventShown(ev),
        stage: -1,
        ev,
        mention,
      };
      await this.cards.post(this.liveKey(id), rec, card, mention, id);
      return;
    }
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

  /** Edits the live cards whose sides or crates changed, and lets go of those whose stage is over or moved on. */
  private async refresh(): Promise<number> {
    const open = await this.cards.open();
    if (!open.length) return 0;
    const staged = open.some((id) => id.startsWith(STAGE_KEY));
    const arcked = open.some((id) => !id.startsWith(STAGE_KEY));
    const [arcs, clock, house] = await Promise.all([
      arcked ? this.world.arcs() : { open: [], ended: [] },
      this.world.hunts(),
      staged ? this.house() : null,
    ]);
    const byId = new Map([...arcs.ended, ...arcs.open].map((a) => [a.id, a]));
    let edited = 0;
    for (const id of open) {
      try {
        const r = id.startsWith(STAGE_KEY)
          ? await this.editStaged(id, house, clock)
          : await this.edit(id, byId.get(id), clock);
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
    const card = await this.card(ev, "cached", () => this.template(ev));
    const next = { ...rec, at: clock.tick, shown, ev };
    if (!card || !(await this.cards.edit(this.liveKey(id), rec.message, card, next, rec.mention)))
      return { edited: false, done: true };
    return { edited: true, done };
  }

  /** Edits a drop's or fair's card as its crates go; done once its stage closes or leaves the house. */
  private async editStaged(
    id: string,
    house: api.House | null,
    clock: Pick<api.HuntBoard, "tick" | "every">,
  ): Promise<{ edited: boolean; done: boolean }> {
    const rec = await this.cards.get(this.liveKey(id));
    if (!rec?.message) return { edited: false, done: true };
    const stageId = id.slice(STAGE_KEY.length);
    // An unread house leaves the card as it is until the next poll.
    if (!house) return { edited: false, done: false };
    const stage = house.stages.find((s) => s.id === stageId);
    if (!stage) return { edited: false, done: true };
    const done = !!stage.closed;
    const contests = await this.contests(stage);
    const ev: CausedEvent = {
      ...rec.ev,
      stage,
      ...(contests ? { contests } : {}),
    };
    const shown = eventShown(ev);
    if (shown === rec.shown) return { edited: false, done };
    if (!done && !editDue(rec.at, clock.tick, clock.every)) return { edited: false, done: false };
    const card = await this.card(ev, "cached", () => this.template(ev));
    const next = { ...rec, at: clock.tick, shown, ev };
    if (!card || !(await this.cards.edit(this.liveKey(id), rec.message, card, next, rec.mention)))
      return { edited: false, done: true };
    return { edited: true, done };
  }

  start(): () => void {
    return pollEvery(EVENTS_POLL_MS, () => this.poll(), this.log, "events");
  }
}
