import type { Modal } from "../../../packages/discord-kit/src/index.ts";
import type { Narrator } from "../../../packages/mmo-narrate/src/index.ts";
import * as api from "./api.ts";
import type { Card } from "./card.ts";
import type { ChannelKind, HeldEntry, HouseHooks } from "./house.ts";
import { type Action, fields, type Id, integerTarget, type Launch, launchOf } from "./ids.ts";
import { capitalise, type Lexicon } from "./lexicon.ts";
import { type CommandName, REPORT } from "./manifest.ts";
import { type DayClock, dayClock, type Narration, offNarration } from "./narration/hooks.ts";
import {
  dungeonNaming,
  kindNameFacts,
  type NameCtx,
  type NameFacts,
  type NameOffers,
  nameOffers,
  promotionNaming,
  type ScreenCtx,
} from "./narration/names.ts";
import type { PartyNote } from "./party.ts";
import { backCards } from "./screens/back.ts";
import { classesCard } from "./screens/classes.ts";
import { parseFence, parseSteal, stealCard, watchCard } from "./screens/crime.ts";
import {
  bottomCard,
  dungeonNameModal,
  entranceCard,
  forkCard,
  mayName,
  pushLeaveCard,
  reachedBottom,
} from "./screens/dungeon.ts";
import { NAME_INPUT } from "./screens/emergence.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "./screens/fight.ts";
import { forgetAskCard, forgetDoneCard } from "./screens/forget.ts";
import {
  boardCard,
  fromSpec,
  goalCard,
  type GoalDraft,
  goalDraftOf,
  goalForm,
  goalModal,
  specOf,
} from "./screens/goals.ts";
import {
  bankCard,
  type BankPick,
  guildCard,
  type GuildView,
  leaveCard,
  memberCard,
  nameModal,
  placesCard,
} from "./screens/guild.ts";
import {
  adminConsole,
  blankPin,
  blankStage,
  type GuildThing,
  holdsCard,
  isChannelKind,
  isReason,
  liftOf,
  logCard,
  minutesOf,
  noConsoleCard,
  noServerCard,
  type PinDraft,
  pinDraftOf,
  pinOrder,
  pinRows,
  pinsForm,
  pinsPlaced,
  QUIET_FROM,
  QUIET_TO,
  queueCard,
  type QueueFocus,
  queueFocusOf,
  quietModal,
  reportForm,
  reportRef,
  type Role,
  type StageDraft,
  stageDraftOf,
  stageForm,
  stageMissing,
  stageOrder,
  staffConsole,
  settingsCard,
  templateName,
} from "./screens/house.ts";
import { hubCard, recapCard, startCard, whereCard } from "./screens/hub.ts";
import { hexDistance, huntCard } from "./screens/hunt.ts";
import {
  appraisalCard,
  characterCard,
  craftCard,
  discoveredKind,
  type Draft,
  draftRecipe,
  itemCard,
  madeCard,
  nameableKinds,
  parseDraft,
  recipesCard,
} from "./screens/make.ts";
import {
  bookCard,
  draftOf,
  elsewhereCard,
  exchangeCard,
  gearCard,
  historyCard,
  isList,
  type List,
  mineCard,
  moversCard,
  orderForm,
  type OrderDraft,
  ordersCard,
  reportCard,
  stagedBookCard,
} from "./screens/market.ts";
import {
  HELD_NOTICE,
  type NameTarget,
  namingCard,
  ownNameModal,
  parseNameTarget,
  parsePick,
} from "./screens/naming.ts";
import {
  beatResolvedCard,
  partyBeatCard,
  partyCard,
  partyMachineCard,
  scoresOf,
} from "./screens/party.ts";
import { contestsOf, crateOpen, dropCard, fairCard } from "./screens/staged.ts";
import { chronicleCard, factCard, giveModal, stageCard, UNITS_INPUT } from "./screens/story.ts";
import { talkCard } from "./screens/talk.ts";
import { travelCard } from "./screens/travel.ts";
import { amount } from "./units.ts";
import type { HuntPost, PartyRead, World } from "./world.ts";

/** Actions whose target is two colon-separated fields. */
const PAIR_ACTIONS = new Set<Action>([
  "sell",
  "mkt-sell",
  "mkt-take",
  "buy",
  "equip",
  "pick",
  "gather",
  "consent",
  "g-pledge",
  "gld-dep",
  "gld-draw",
  "gld-work",
  "cls-take",
]);

/** Pair actions whose second field must parse as an integer quantity. */
const QUANTITY_ACTIONS = new Set<Action>([
  "buy",
  "sell",
  "mkt-sell",
  "mkt-take",
  "gather",
  "consent",
  "g-pledge",
  "gld-dep",
  "gld-draw",
  "gld-work",
]);

/**
 * The bot's whole behaviour as a pure function of a press: what to write
 * to the world and which card to show next. Nothing here sees discord.js,
 * so a scripted client and the tests drive exactly what players press.
 */

export interface Press {
  /** The Discord server's name, which names its own guild on install. */
  guildName?: string;
  user: string;
  guild?: string;
  /** Discord's interaction id: the idempotency key of any write. */
  interaction: string;
  command?: string;
  id?: Id;
  values?: string[];
  /** A modal's submitted text, by input id. */
  fields?: Record<string, string>;
  /** The player holds the server's admin permission (GDD 4.8). */
  admin?: boolean;
  /** The server counts the player as staff: Moderate Members, or a role its settings name (GDD 14.1). */
  staff?: boolean;
  /** The card a Report names, as its reason select carries it: a name ref, or p/<channel>/<message>. */
  report?: string;
  /** The guild's channels and roles, for the settings card; the adapter lists them where wantsGuildLists says. */
  channels?: GuildThing[];
  roles?: GuildThing[];
  /** The channel the press was made in, or a thread's parent: where a party's thread opens. */
  channel?: string;
}

/** The modal a press opens instead of a card, decided from its id alone so the adapter can show it at once. */
export function modalFor(id: Id): Modal | null {
  switch (id.action) {
    case "g-name":
      return goalDraftOf(id.target) ? goalModal(id.target, id.version) : null;
    case "gld-name":
      return nameModal("gld-new", id.version, "Name your guild");
    case "gld-found":
      return id.target === "take"
        ? null
        : nameModal("gld-chart", id.version, "Name your settlement");
    case "d-name":
      return hexOf(id.target) ? dungeonNameModal(id.target, id.version) : null;
    case "kn-own":
      return ownNameModal(id.target, id.version);
    case "s-give": {
      const f = fields(id.target, ":", 2);
      return f ? giveModal(f[0]!, f[1]!, id.version) : null;
    }
    case "hs-quiet":
      return quietModal(id.version);
    default:
      return null;
  }
}

/**
 * The Activity launch a press asks for, decided from its id alone: Discord
 * takes the launch only as the first answer to the press, so the adapter
 * gives it before any world call.
 */
export function launchFor(id: Id): Launch | null {
  return id.action === "launch" ? launchOf(id.target) : null;
}

/** The presses whose card lists the guild's channels and roles, so the adapter reads them only there. */
const SETTINGS_ACTIONS = new Set<Action>([
  "hs-conf",
  "hs-kind",
  "hs-chan",
  "hs-srole",
  "hs-arole",
  "hs-names",
  "hs-narr",
  "hs-quieted",
]);

export function wantsGuildLists(id: Id | undefined): boolean {
  return !!id && SETTINGS_ACTIONS.has(id.action);
}

/**
 * The Discord role a press toggles on its presser, decided from its id
 * alone: the adapter answers it before any world call.
 */
export function roleFor(id: Id): "alarm" | null {
  return id.action === "alarm" ? "alarm" : null;
}

export interface Ctx {
  world: World;
  lex: Lexicon;
  /** The threat line routes stop before. */
  threatLine: number;
  /** Where cards are narrated; offNarration, every card its template, when unset. */
  narration?: Narration;
  /** The narrator the narration's parts share; null when every model use is off. */
  narrator?: Narrator | null;
  /** The world day the bot last heard of; a fresh clock per Ctx when unset. */
  day?: DayClock;
  /** Name suggestions and the screen on typed names; from the narrator when unset. */
  names?: NameOffers;
  /** What a house write tells the bot's house cache and the narration switch, and the held names. */
  house?: HouseHooks;
  /** Removes what the bot itself keeps of a user, after the world has forgotten them (GDD 14.9). */
  forget?: (user: string) => Promise<void>;
}

const clocks = new WeakMap<Ctx, DayClock>();

/** A Ctx's day clock, the same one for every press made through it. */
function clockOf(ctx: Ctx): DayClock {
  if (ctx.day) return ctx.day;
  let c = clocks.get(ctx);
  if (!c) clocks.set(ctx, (c = dayClock()));
  return c;
}

export interface Answer {
  card: Card;
  /** The character the answer is about, once there is one. */
  character?: string;
  /** A long action the press queued, for the completion notice. */
  long?: boolean;
  /** The party the press was about: its thread is opened or brought up to date. */
  party?: PartyNote;
}

export async function answer(ctx: Ctx, press: Press): Promise<Answer> {
  const { world } = ctx;
  const id = await world.player(press.user);
  if (!id) {
    if (press.id?.action === "start") return start(ctx, press, press.id.target);
    // The world holds nothing of theirs, or forgot it already: the bot's own notes still go.
    if (press.command === "forget-me" || press.id?.action === "forget")
      return { card: forgetDoneCard(false, await forgetBot(ctx, press.user)) };
    return { card: startCard(ctx.lex) };
  }
  const s = new Session(ctx, press, id);
  if (press.command) return s.command(press.command as CommandName);
  if (press.id) return s.button(press.id, press.values ?? []);
  return s.hub();
}

async function start(ctx: Ctx, press: Press, choice: string): Promise<Answer> {
  const res = await ctx.world.act({
    interactionId: press.interaction,
    discordId: press.user,
    kind: api.ActCreate,
    version: 0,
    option: choice,
    server: press.guild,
    note: press.guildName,
    admin: press.admin,
  });
  if (!res.ok) {
    if (res.refusal.code === api.CodeSecondPC) {
      const id = await ctx.world.player(press.user);
      if (id) return new Session(ctx, press, id).hub();
    }
    const card = startCard(ctx.lex);
    card.title = capitalise(res.refusal.message);
    return { card };
  }
  const s = new Session(ctx, press, res.reply.character.id);
  return s.hub(`You take the ${choice}. The road is yours.`);
}

class Session {
  constructor(
    private readonly ctx: Ctx,
    private readonly press: Press,
    readonly character: string,
  ) {}

  private get lex() {
    return this.ctx.lex;
  }
  private get world() {
    return this.ctx.world;
  }
  private get narration(): Narration {
    return this.ctx.narration ?? offNarration;
  }
  private get day(): DayClock {
    return clockOf(this.ctx);
  }
  /** The server a press came from, for the per-server switch; empty in a DM. */
  private get server(): string {
    return this.press.guild ?? "";
  }
  private get names(): NameOffers {
    return this.ctx.names ?? nameOffers(this.ctx.narrator ?? null);
  }
  private nameCtx(mode?: NameCtx["mode"]): NameCtx {
    return { day: this.day.today(), server: this.server, user: this.press.user, mode };
  }

  /** Since you left, narrated when the narration gives it. */
  private recapAnswer(o: api.Options, here: api.Here, recap: api.Recap): Promise<Card> {
    this.day.saw(recap.day);
    return this.narration.recap(recap, this.press.user, this.server, () =>
      recapCard(o, here, recap, this.lex, peopleOf(here)),
    );
  }

  private async load() {
    const [o, here] = await Promise.all([
      this.world.options(this.character),
      this.world.here(this.character),
    ]);
    return { o, here };
  }

  /** A write keyed on this press, at the card's version; a house kind also names its member, for the log. */
  private async act(kind: string, version: number, fields: Partial<api.ActionRequest> = {}) {
    return this.world.act({
      interactionId: this.press.interaction,
      characterId: this.character,
      version,
      kind,
      server: this.press.guild,
      admin: this.press.admin,
      staff: this.press.staff,
      ...(HOUSE_KINDS.has(kind) ? { discordId: this.press.user } : {}),
      ...fields,
    });
  }

  private done(card: Card, long = false): Answer {
    return { card, character: this.character, long };
  }

  /** An answer whose card's title is replaced, when there is one. */
  private retitled(a: Answer, title?: string): Answer {
    if (title) a.card.title = title;
    return a;
  }

  /** The hub after a press that queues a long action, unless it was refused. */
  private async longAnswer(notice: string, why?: string): Promise<Answer> {
    return { ...(await this.hub(why ?? notice)), long: !why };
  }

  async command(name: CommandName): Promise<Answer> {
    switch (name) {
      case "character":
        return this.character_();
      case "recipes":
        return this.recipes();
      case "map":
        return this.travel();
      case "market":
        return this.market();
      case "goals":
        return this.goals();
      case "guild":
        return this.guild();
      case "party":
        return this.party();
      case "chronicle":
        return this.chronicle();
      case "admin":
        return this.console(undefined, "admin");
      case "staff":
        return this.console(undefined, "staff");
      case REPORT:
        return this.report();
      case "forget-me":
        return this.forgetAsk();
      case "play":
      default:
        return this.open();
    }
  }

  /** The role this press speaks with on its server's consoles, or null for a member without one. */
  private get role(): Role | null {
    return this.press.admin ? "admin" : this.press.staff ? "staff" : null;
  }

  /** The house as this member reads it; a server with none yet reads as an empty one an admin installs. */
  private async readHouse(): Promise<{ ok: true; house: api.House } | { ok: false; why: string }> {
    const guild = this.press.guild!;
    if (!this.world.house) return { ok: false, why: "the world serves no house to this bot yet" };
    const r = await this.world.house(guild, this.character, {
      admin: this.press.admin,
      staff: this.press.staff,
    });
    if (r.ok) return { ok: true, house: r.reply };
    if (r.refusal.code !== api.CodeNotFound) return { ok: false, why: refusalText(r.refusal) };
    return { ok: true, house: emptyHouse(guild, this.press.guildName ?? "", this.role ?? "") };
  }

  /** Whether this press's flags give a role, in a server: a console's writes are sent only then. */
  private may(want: Role): boolean {
    const role = this.role;
    return !!this.press.guild && !!role && (want === "staff" || role === "admin");
  }

  /** A console card, drawn only for a member whose flags give the role it needs. */
  private async withHouse(
    want: Role,
    then: (h: api.House, role: Role, v: number) => Answer | Promise<Answer>,
  ): Promise<Answer> {
    if (!this.press.guild) return this.done(noServerCard(want));
    const role = this.role;
    if (!role || !this.may(want)) return this.done(noConsoleCard(want));
    const [o, read] = await Promise.all([this.world.options(this.character), this.readHouse()]);
    if (!read.ok) return this.retitled(this.done(noConsoleCard(want)), capitalise(read.why));
    return then(read.house, role, o.version);
  }

  /** /admin, /staff, and the consoles' own buttons back to them. */
  async console(notice?: string, want?: Role): Promise<Answer> {
    const as = want ?? (this.role === "admin" ? "admin" : "staff");
    return this.withHouse(as, (h, _role, v) =>
      this.done(
        as === "admin"
          ? adminConsole(h, v, this.lex, notice)
          : staffConsole(h, v, this.lex, notice),
      ),
    );
  }

  /** A house write; once accepted, the bot's cached house is dropped and the switch follows the settings. */
  private async houseWrite(
    kind: string,
    v: number,
    fields: Partial<api.ActionRequest>,
    then: (reply: api.ActionReply | null, refusal?: string) => Promise<Answer>,
    settings?: { before: api.HouseSettings; after: api.HouseSettings },
  ): Promise<Answer> {
    const res = await this.act(kind, v, fields);
    if (!res.ok) return then(null, capitalise(refusalText(res.refusal)));
    await this.ctx.house?.wrote(this.press.guild ?? "", settings?.before, settings?.after);
    return then(res.reply);
  }

  async stageForm(d?: StageDraft, notice?: string): Promise<Answer> {
    return this.withHouse("staff", (h, role, v) =>
      this.done(stageForm(h, role, d ?? blankStage(h, role), v, this.lex, notice)),
    );
  }

  private sendStage(d: StageDraft, v: number): Promise<Answer> {
    return this.withHouse("staff", (h, role) => {
      const order = stageOrder(h, d);
      const missing = stageMissing(h, role, d, this.lex);
      if (missing || !order)
        return this.done(stageForm(h, role, d, v, this.lex, missing ?? "Pick the site"));
      const what = templateName(this.lex, d.template, h.templates);
      return this.houseWrite(api.ActStage, v, { stage: order }, (r, why) =>
        why
          ? this.stageForm(d, why)
          : this.console(
              `Staged: ${what}${r?.points ? `, ${amount(r.points, "event points")} from the pool` : ""}`,
            ),
      );
    });
  }

  async queue(focus: QueueFocus, notice?: string): Promise<Answer> {
    return this.withHouse("staff", async (h, role, v) => {
      const held = await this.heldNames();
      return this.done(queueCard(h, held, focus, role, v, notice));
    });
  }

  private async heldNames(): Promise<HeldEntry[]> {
    const store = this.ctx.house?.held;
    if (!store || !this.press.guild) return [];
    try {
      return await store.list(this.press.guild);
    } catch {
      // The held list lives in Redis; the queue shows the world's cases without it.
      return [];
    }
  }

  /** A moderation action on a case: its ref, and a hold's days, come from the case the button names. */
  private moderate(action: string, caseId: string, days: number, v: number): Promise<Answer> {
    return this.withHouse("staff", (h) => {
      const c = (h.cases ?? []).find((x) => x.id === caseId);
      if (!c) return this.queue({ case: "", days }, "That case is closed");
      const holds = action === "mute" || action === "suspend" || action === "exclude";
      const order: api.ModerateOrder = {
        action,
        ref: action === "escalate" || action === "dismiss" ? undefined : c.ref,
        days: holds ? days : undefined,
        case: c.id,
      };
      const left = action === "dismiss" ? "" : c.id;
      return this.houseWrite(api.ActModerate, v, { moderate: order }, (_, why) =>
        this.queue({ case: left, days }, why ?? MODERATED[action] ?? "Done"),
      );
    });
  }

  private holds(notice?: string): Promise<Answer> {
    return this.withHouse("staff", (h, role, v) => this.done(holdsCard(h, role, v, notice)));
  }

  /** The house's public log, walked to its newest row. */
  private async logRows(): Promise<api.LogRow[]> {
    const read = this.world.houseLog;
    if (!read || !this.press.guild) return [];
    const rows: api.LogRow[] = [];
    let after = 0;
    for (let i = 0; i < LOG_WALK_MOST; i++) {
      const page = await read(this.press.guild, after);
      rows.push(...page.rows.filter((r) => r.id > after));
      if (!page.rows.length || page.next <= after) break;
      after = page.next;
    }
    return rows;
  }

  private log(page: number): Promise<Answer> {
    return this.withHouse("staff", async (h, role, v) =>
      this.done(logCard(h, await this.logRows(), page, role, v)),
    );
  }

  async settings(kind: ChannelKind, notice?: string): Promise<Answer> {
    return this.withHouse("admin", (h, _role, v) =>
      this.done(settingsCard(h, kind, this.press.channels, this.press.roles, v, notice)),
    );
  }

  /** A change to the settings, sent whole: house-settings replaces them, and installs the server's guild if it has none. */
  private saveSettings(
    kind: ChannelKind,
    v: number,
    change: (s: api.HouseSettings) => api.HouseSettings | string,
    said: string,
  ): Promise<Answer> {
    return this.withHouse("admin", (h) => {
      const before = h.settings;
      const after = change(structuredClone(before));
      if (typeof after === "string") return this.settings(kind, after);
      return this.houseWrite(
        api.ActHouseSettings,
        v,
        { settings: after, note: this.press.guildName },
        (_, why) => this.settings(kind, why ?? said),
        { before, after },
      );
    });
  }

  async pins(d?: PinDraft, notice?: string): Promise<Answer> {
    return this.withHouse("admin", async (h, _role, v) => {
      const draft = d ?? blankPin(h);
      const rows = pinRows(await this.world.lexicon(), draft.field);
      return this.done(pinsForm(h, draft, rows, v, notice));
    });
  }

  private sendPin(d: PinDraft, v: number): Promise<Answer> {
    const pin = pinOrder(d);
    if (!pin || !this.may("admin")) return this.pins(d, "Pick a tile and what it fixes");
    return this.houseWrite(api.ActHousePin, v, { pin }, (_, why) =>
      this.pins(d, why ?? "Pinned: it lands when someone first reaches the tile"),
    );
  }

  async pinsPlaced(notice?: string): Promise<Answer> {
    return this.withHouse("admin", (h, _role, v) => this.done(pinsPlaced(h, this.lex, v, notice)));
  }

  private sendUnpin(pin: string, v: number): Promise<Answer> {
    return this.withHouse("admin", (h) => {
      const p = h.pins?.find((x) => x.id === pin);
      if (!p) return this.pinsPlaced("That pin is gone");
      return this.houseWrite(
        api.ActHouseUnpin,
        v,
        { pin: { at: p.at, fix: {}, pin: p.id } },
        (_, why) => this.pinsPlaced(why ?? "Withdrawn: the tile is the world's again"),
      );
    });
  }

  /** Report on a message's menu: the reasons to pick from, for what the card names. */
  async report(notice?: string): Promise<Answer> {
    const o = await this.world.options(this.character);
    if (!this.press.report)
      return this.retitled(this.done(reportForm("", o.version)), "That message cannot be reported");
    return this.done(reportForm(this.press.report, o.version, notice));
  }

  /** A staging of this server's, by id, as its house lists it. */
  private async stageOf(id: string): Promise<api.StageView | undefined> {
    if (!this.press.guild || !this.world.house || !id) return undefined;
    const r = await this.world.house(this.press.guild, this.character);
    return r.ok ? r.reply.stages.find((s) => s.id === id) : undefined;
  }

  private fileReport(raw: string, reason: string, v: number): Promise<Answer> {
    const ref = reportRef(raw, this.press.guild);
    if (!ref || !isReason(reason)) return Promise.resolve(backCards.unknown(this.character));
    return this.write(api.ActReport, v, { case: { ref, reason } }, async (_, why) =>
      this.done(reportForm(raw, v, why ?? "Reported: the server's staff will read it")),
    );
  }

  /** /play with a character: since you left when something happened, else the hub. */
  async open(): Promise<Answer> {
    const { o, here } = await this.load();
    const recap = await this.world.recap(this.character);
    const look = await this.act(api.ActLook, o.version);
    if (recap.lines.length === 0) return this.hub();
    const version = look.ok ? look.reply.character.version : o.version;
    return this.done(await this.recapAnswer({ ...o, version }, here, recap));
  }

  async hub(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const [sheet, hunts] = await Promise.all([
      this.world.sheet(this.character),
      this.world.hunts(),
    ]);
    if (o.conditions.includes(api.CondDown) && !o.long && !notice)
      return this.done(downCard(o, here, this.lex));
    if (sheet.character.stopped && !o.fight) {
      const card = watchCard(o, here, sheet, this.lex);
      return this.done(notice ? { ...card, title: notice } : card);
    }
    const hunt = inReach(hunts.hunts, o.at, sheet.character.floor ?? 0);
    return this.done(hubCard(o, here, sheet, this.lex, notice, hunt));
  }

  async travel(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const map = await this.world.map(this.character);
    const to =
      o.long?.route?.at(-1) ?? (o.purse.market ? undefined : nearest(o.at, o.purse.markets));
    const risk = to ? await this.world.routeRisk(this.character, to) : undefined;
    return this.retitled(
      this.done(
        travelCard(o, map, here, this.lex, this.ctx.threatLine, risk?.ok ? risk.reply : undefined),
      ),
      notice,
    );
  }

  async character_(): Promise<Answer> {
    const { o, here } = await this.load();
    return this.done(characterCard(o, here, await this.world.sheet(this.character), this.lex));
  }

  async recipes(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const r = await this.world.recipes(this.character);
    const descriptions = new Map<string, string>();
    await Promise.all(
      nameableKinds(r).map(async (k) => {
        const offer = await this.names.suggest(
          "kind",
          k.kind,
          k.name,
          kindNameFacts(k, this.lex),
          this.nameCtx("cached"),
        );
        if (offer?.description) descriptions.set(k.kind, offer.description);
      }),
    );
    return this.retitled(this.done(recipesCard(o, here, r, this.lex, descriptions)), notice);
  }

  /** The thing a naming card is about: its name now, its facts, and whether it may still be named. */
  private async nameSubject(
    t: NameTarget,
  ): Promise<{ plain: string; facts: NameFacts; open: boolean } | null> {
    switch (t.subject) {
      case "kind": {
        const k = (await this.world.recipes(this.character)).known.find((x) => x.kind === t.row);
        return k ? { plain: k.name, facts: kindNameFacts(k, this.lex), open: !!k.renamable } : null;
      }
      case "promotion": {
        const recap = await this.world.recap(this.character, t.row);
        this.day.saw(recap.day);
        const f = recap.lines.find((l) => l.promotion === t.row)?.fact;
        return f ? { ...promotionNaming(f, this.lex), open: true } : null;
      }
      case "dungeon": {
        const here = await this.world.here(this.character);
        const f = here.floor;
        if (!f || f.dungeon !== t.row) return null;
        return { ...dungeonNaming(f, this.lex), open: !f.name };
      }
    }
  }

  /** The naming card for a thing, its suggestions as far as they came in time. */
  async naming(t: NameTarget, notice?: string): Promise<Answer> {
    const [o, subject] = await Promise.all([
      this.world.options(this.character),
      this.nameSubject(t),
    ]);
    if (!subject?.open) return this.nameHome(t, "It is not yours to name now");
    const offer = await this.names.suggest(
      t.subject,
      t.row,
      subject.plain,
      subject.facts,
      this.nameCtx(),
    );
    return this.done(namingCard(o.version, t, subject.plain, offer, notice));
  }

  /** The card a naming leaves to: recipes for a kind, since you left for a promotion, the dungeon. */
  private nameHome(t: NameTarget, notice?: string): Promise<Answer> {
    switch (t.subject) {
      case "kind":
        return this.recipes(notice);
      case "promotion":
        return this.recap(notice);
      case "dungeon":
        return this.dungeon(notice);
    }
  }

  /** A name sent for a thing: the world's command for it, then its card titled with the outcome. */
  private sendName(t: NameTarget, name: string, v: number): Promise<Answer> {
    const then = (_: unknown, why?: string) => this.nameHome(t, why ?? `Named: ${name}`);
    switch (t.subject) {
      case "kind":
        return this.write(api.ActKindName, v, { option: t.row, note: name }, then);
      case "promotion":
        return this.write(api.ActPromoteName, v, { option: t.row, note: name }, then);
      case "dungeon": {
        const to = hexOf(t.row);
        if (!to) return Promise.resolve(backCards.unknown(this.character));
        return this.write(api.ActDungeonName, v, { note: name, to }, then);
      }
    }
  }

  /**
   * A name the player typed, screened before the world sees it: held, it
   * is not sent and the card says a person reads it first.
   */
  private async screened(
    name: string,
    use: ScreenCtx["use"],
    target: string,
    held: (notice: string) => Promise<Answer>,
    send: () => Promise<Answer>,
  ): Promise<Answer> {
    if (!name) return send();
    const verdict = await this.names.screen(name, { ...this.nameCtx(), use, target });
    return verdict === "hold" ? held(HELD_NOTICE) : send();
  }

  /** A typed name for a thing: none asks again, otherwise it is screened and then sent. */
  private submitName(t: NameTarget, raw: string, v: number): Promise<Answer> {
    const name = raw.trim();
    if (!name) return this.nameHome(t, NO_NAME);
    return this.screened(
      name,
      t.subject,
      t.row,
      (held) => this.nameHome(t, held),
      () => this.sendName(t, name, v),
    );
  }

  async fight(last?: api.ActionReply): Promise<Answer> {
    const { o, here } = await this.load();
    if (o.fight?.shared) return this.partyBeat(o, here);
    if (o.fight)
      return this.done(
        beatCard(o, here, this.lex, last && { pressed: last.pressed ?? [], facts: last.facts }),
      );
    if (last && reachedBottom(last.facts))
      return this.done(bottomCard(o, here, this.lex, last.facts, this.character));
    if (last)
      return this.done(
        resolvedCard(o, here, this.lex, last.pressed ?? [], last.facts, last.character),
      );
    return this.hub();
  }

  /** What a party press tells the thread: its members to add, where to open it, and a card to post there. */
  private note(st: PartyRead, here: api.Here, post?: Card): PartyNote | undefined {
    if (!st.party) return undefined;
    return {
      party: st.party.id,
      members: st.thread?.members ?? [],
      channel: this.press.channel,
      server: this.press.guild,
      picture: { media: here.banner, place: here.name },
      post,
    };
  }

  private withParty(card: Card, st: PartyRead, here: api.Here, post?: Card): Answer {
    return { card, character: this.character, party: this.note(st, here, post) };
  }

  /** /party and the hub's Party button: the party card, and its thread opened. */
  async party(notice?: string): Promise<Answer> {
    const [st, here] = await Promise.all([
      this.world.party(this.character),
      this.world.here(this.character),
    ]);
    return this.withParty(partyCard(st, here, this.lex, notice), st, here);
  }

  /** A party beat as the presser's own card. */
  private async partyBeat(
    o: api.Options,
    here: api.Here,
    notice?: string,
    st?: PartyRead,
  ): Promise<Answer> {
    const read = st ?? (await this.world.party(this.character));
    if (!o.fight) return this.party(notice);
    return this.withParty(partyBeatCard(o, here, read, this.lex, notice), read, here);
  }

  /** The thread card pressed: the presser's own card for where the party stands. */
  async partyHere(notice?: string): Promise<Answer> {
    const [{ o, here }, st] = await Promise.all([this.load(), this.world.party(this.character)]);
    if (o.fight?.shared) return this.partyBeat(o, here, notice, st);
    if (here.floor?.ways?.length && !o.fight) return this.dungeon(notice, st);
    return this.withParty(partyCard(st, here, this.lex, notice), st, here);
  }

  /** The dungeon here: its fork, the choice made there, or its entrance. */
  async dungeon(notice?: string, read?: PartyRead): Promise<Answer> {
    const [{ o, here }, st] = await Promise.all([
      this.load(),
      read ?? this.world.party(this.character),
    ]);
    const f = here.floor;
    if (!f) return this.where(notice);
    if (o.fight) return this.fight();
    if (f.ways?.length) {
      const me = st.party?.members.find((m) => m.you)?.name;
      const mine = me ? f.choices?.find((c) => c.name === me) : undefined;
      if (mine) {
        const present = st.party?.members.filter((m) => m.here && !m.down).length ?? 1;
        const waiting = Math.max(0, present - (f.choices?.length ?? 0));
        return this.withParty(pushLeaveCard(o, here, this.lex, mine, waiting), st, here);
      }
      return this.withParty(forkCard(o, here, this.lex, notice), st, here);
    }
    return this.withParty(entranceCard(o, here, this.lex, this.character, notice), st, here);
  }

  /** A pick on a party beat: held unseen until every member present has picked, then resolved for all. */
  private async partyPick(option: string, v: number): Promise<Answer> {
    const before = await this.world.options(this.character);
    const res = await this.act(api.ActPartyPick, v, { option });
    const { o, here } = await this.load();
    if (!res.ok) return this.partyBeat(o, here, capitalise(refusalText(res.refusal)));
    const r = res.reply;
    if (!scoresOf(r.facts).length)
      return this.partyBeat(o, here, "Picked: the beat waits on the others");
    const st = await this.world.party(this.character);
    const party =
      st.party?.id ?? r.facts.flatMap((f) => f.subjects).find((x) => x.kind === "party")?.id ?? "";
    const board = (await this.world.parties()).parties.find((p) => p.id === party);
    const names = new Map((board?.members ?? []).map((m) => [m.characterId, m.name]));
    const ended = r.facts.some((f) => f.kind.startsWith("encounter."));
    const carried = ended
      ? Math.max(0, goodsOf(r.character.goods) - goodsOf(before.purse.goods))
      : undefined;
    const shown =
      reachedBottom(r.facts) && mayName(here.floor, r.facts, this.character)
        ? bottomCard(o, here, this.lex, r.facts, this.character)
        : beatResolvedCard(o, here, this.lex, r.facts, names, "you", party, carried);
    const post = beatResolvedCard(o, here, this.lex, r.facts, names, "thread", party);
    return {
      card: shown,
      character: this.character,
      party: this.note(st, here, post) ?? (party ? { party, members: [], post } : undefined),
    };
  }

  /** The party machine's card: the beat's while a fight runs, else the fork's, unless kind names one. */
  private async partyMachine(kind?: "beat" | "fork") {
    const [{ o, here }, st] = await Promise.all([this.load(), this.world.party(this.character)]);
    return this.done(partyMachineCard(o, here, st, this.lex, kind ?? (o.fight ? "beat" : "fork")));
  }

  /** A live hunt: the one a card names, else the one in reach. */
  async hunt(id?: string, notice?: string): Promise<Answer> {
    const [{ o, here }, board, st, sheet] = await Promise.all([
      this.load(),
      this.world.hunts(),
      this.world.party(this.character),
      this.world.sheet(this.character),
    ]);
    const h: HuntPost | undefined =
      board.hunts.find((x) => x.id === id) ??
      inReach(board.hunts, o.at, sheet.character.floor ?? 0);
    if (!h) return this.retitled(await this.where(), notice ?? "That hunt is over");
    const view = st.hunt?.id === h.id ? st.hunt : undefined;
    return this.done(huntCard(o, here, h, view, this.lex, notice));
  }

  async craft(d: Draft): Promise<Answer> {
    const { o, here } = await this.load();
    const [sheet, recipes] = await Promise.all([
      this.world.sheet(this.character),
      this.world.recipes(this.character),
    ]);
    return this.done(craftCard(o, here, sheet, recipes, this.lex, d));
  }

  private async loadMarket(
    material?: string,
  ): Promise<{ ok: true; o: api.Options; m: api.Market } | { ok: false; answer: Answer }> {
    const o = await this.world.options(this.character);
    const res = await this.world.market(this.character, material);
    if (!res.ok) return { ok: false, answer: await this.where(capitalise(res.refusal.message)) };
    return { ok: true, o, m: res.reply };
  }

  /** /market: one of its lists, about one material (GDD 10.6). */
  async market(list: List = "book", material?: string, notice?: string): Promise<Answer> {
    const loaded = await this.loadMarket(material);
    if (!loaded.ok) return loaded.answer;
    const { o, m } = loaded;
    const lex = this.lex;
    switch (list) {
      case "exchange":
        return this.done(exchangeCard(o, m, lex));
      case "movers":
        return this.done(moversCard(o, m, lex));
      case "history": {
        const h = await this.world.history(this.character, m.material);
        if (!h.ok) return this.done(bookCard(o, m, lex, capitalise(h.refusal.message)));
        return this.done(historyCard(o, m, h.reply, lex));
      }
      case "elsewhere":
        return this.done(elsewhereCard(o, m, lex));
      case "gear":
        return this.done(gearCard(o, m, lex, notice));
      case "orders":
        return this.done(ordersCard(o, m, lex, notice));
      case "mine":
        return this.done(mineCard(o, m, lex, notice));
      case "report":
        return this.done(reportCard(o, m, lex));
      case "staged":
        return this.done(stagedBookCard(o, m, lex, notice));
      default:
        return this.done(bookCard(o, m, lex, notice));
    }
  }

  /** /goals: the notice board here at a page of its goals, or one goal on it. */
  async goals(goal?: string, notice?: string, page = 0): Promise<Answer> {
    const o = await this.world.options(this.character);
    const res = await this.world.goals(this.character);
    if (!res.ok) return this.where(capitalise(res.refusal.message));
    const x =
      goal && [...res.reply.board, ...res.reply.mine, ...res.reply.met].find((g) => g.id === goal);
    if (x) return this.done(goalCard(o, res.reply, x, this.lex, notice));
    return this.done(boardCard(o, res.reply, this.lex, notice, page));
  }

  async goalForm(d: GoalDraft, notice?: string): Promise<Answer> {
    const o = await this.world.options(this.character);
    const res = await this.world.goals(this.character);
    if (!res.ok) return this.where(capitalise(res.refusal.message));
    if (res.reply.settlement < 0) return this.done(boardCard(o, res.reply, this.lex, notice));
    return this.retitled(this.done(goalForm(o, res.reply, d)), notice);
  }

  async postGoal(d: GoalDraft, v: number): Promise<Answer> {
    const res = await this.world.goals(this.character);
    if (!res.ok) return this.where(capitalise(res.refusal.message));
    if (res.reply.settlement < 0) return this.goals();
    const title = (this.press.fields?.title ?? "").trim();
    const spec = specOf(d, res.reply, title, (this.press.fields?.note ?? "").trim());
    return this.write(api.ActPostGoal, v, { goal: spec }, async (r, why) =>
      why ? this.goalForm(d, why) : this.goals(undefined, `Posted: ${title}`),
    );
  }

  /** /guild: one of its pages. */
  async guild(view: GuildView = "members", notice?: string, page = 0): Promise<Answer> {
    const o = await this.world.options(this.character);
    const g = await this.world.guild(this.character);
    return this.done(guildCard(o, g, this.lex, view, notice, page));
  }

  /** One member of the guild, and what may be done about them; pay is the asset picked to pay them. */
  async guildMember(id: string, notice?: string, pay?: string): Promise<Answer> {
    const o = await this.world.options(this.character);
    const g = await this.world.guild(this.character);
    return this.done(memberCard(o, g, id, this.lex, notice, pay));
  }

  /** A guild page with a pick made on it, its amount still to choose: what to give or draw, or the structure to raise. */
  async guildPick(pick: BankPick | { raise: string }): Promise<Answer> {
    const o = await this.world.options(this.character);
    const g = await this.world.guild(this.character);
    if (!g.id) return this.done(guildCard(o, g, this.lex));
    return this.done(
      "raise" in pick ? placesCard(o, g, this.lex, pick.raise) : bankCard(o, g, this.lex, pick),
    );
  }

  /** A guild write, then the guild page it was made from. */
  private guildWrite(
    kind: string,
    v: number,
    fields: Partial<api.ActionRequest>,
    view: GuildView,
    said?: string,
  ): Promise<Answer> {
    return this.write(kind, v, fields, (_, why) => this.guild(view, why ?? said));
  }

  async classes(focus?: string, notice?: string): Promise<Answer> {
    const o = await this.world.options(this.character);
    return this.done(classesCard(o, await this.world.classes(this.character), focus, notice));
  }

  async orderForm(d: OrderDraft): Promise<Answer> {
    const loaded = await this.loadMarket(d.material);
    if (!loaded.ok) return loaded.answer;
    return this.done(orderForm(loaded.o, loaded.m, d, this.lex));
  }

  async item(itemId: string): Promise<Answer> {
    const { o, here } = await this.load();
    const sheet = await this.world.sheet(this.character);
    const it = [...sheet.kit, ...sheet.pack].find((x) => x.id === itemId);
    if (!it) return this.done(characterCard(o, here, sheet, this.lex));
    const deckHeld = sheet.kit.some((x) => x.worn === "off-hand" && x.deck);
    return this.done(itemCard(o, here, it, this.lex, deckHeld));
  }

  async talk(npc: string, said?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const dossier = await this.narration.wantsDossier(this.press.user, this.server);
    const read = await this.world.npc(this.character, npc, { dossier });
    if (!read.ok) return this.where(read.refusal.message);
    if (read.reply.dossier) this.day.saw(read.reply.dossier.day);
    const { conv, remembers } = await this.narration.talk(read.reply, this.press.user, this.server);
    // A fence's card offers a sale for each hot good the character carries.
    const sheet = conv.npc.fence ? await this.world.sheet(this.character) : undefined;
    return this.done(talkCard(o, conv, said, here.bench, remembers, sheet, this.lex));
  }

  /** What can be stolen here, or a steal begun from its pick and the beat it opens. */
  private async steal(raw: string, v: number): Promise<Answer> {
    if (!raw) {
      const { o, here } = await this.load();
      return this.done(stealCard(o, here, this.lex));
    }
    const pick = parseSteal(raw);
    if (!pick) return backCards.unknown(this.character);
    return this.write(
      api.ActSteal,
      v,
      {
        option: pick.kind,
        npc: pick.npc,
        target: pick.caravan,
        forSide: pick.forSide || undefined,
      },
      async (_, why) => {
        const { o, here } = await this.load();
        if (!why && o.fight) return this.done(beatCard(o, here, this.lex));
        return this.done(stealCard(o, here, this.lex, why ?? "It slipped away before you began"));
      },
    );
  }

  /** The card a launch button sits on: the adapter launches, and any other caller sees the card again. */
  async launched(l: Launch | null): Promise<Answer> {
    switch (l?.from) {
      case "beat":
        return this.fight();
      case "hub":
        return this.hub();
      case "where":
        return this.where();
      case "talk":
        return this.talk(l.npc ?? "");
      case "character":
        return this.character_();
      case "party":
        return this.partyMachine();
      case "hunt":
        return this.hunt();
      default:
        return backCards.unknown(this.character);
    }
  }

  /** /chronicle and the hub's Chronicle: a closed world day, the last one unless day names another. */
  async chronicle(day?: number, notice?: string): Promise<Answer> {
    const [o, read, arcs] = await Promise.all([
      this.world.options(this.character),
      this.world.chronicle(this.character, day),
      this.world.arcs(this.character),
    ]);
    const ch: api.Chronicle = read.ok
      ? read.reply
      : { season: arcs.season, day: -1, lines: [], more: 0, earlier: [] };
    const template = () => chronicleCard(ch, this.lex, o.version, false, arcs.open);
    if (read.ok) this.day.saw(ch.day + 1);
    const card = read.ok
      ? await this.narration.chronicle(ch, this.server, "cached", template)
      : template();
    return this.retitled(
      this.done(card),
      notice ?? (read.ok || day === undefined ? undefined : capitalise(read.refusal.message)),
    );
  }

  /** A chronicle line opened: the fact and its causes. */
  async chronicleFact(id: number): Promise<Answer> {
    const [o, read] = await Promise.all([
      this.world.options(this.character),
      this.world.chronicleFact(this.character, id),
    ]);
    if (!read.ok) return this.chronicle(undefined, "That fact is not kept");
    return this.done(factCard(read.reply, this.lex, o.version));
  }

  /**
   * An arc's stage card for this character: the arc named, the one a side
   * goal belongs to, or the trouble at the place it stands in.
   */
  async stage(find: { arc?: string; goal?: string; trouble?: boolean }, notice?: string) {
    const [{ o, here }, arcs] = await Promise.all([this.load(), this.world.arcs(this.character)]);
    const all = [...arcs.open, ...arcs.ended];
    const a = all.find((x) =>
      find.arc
        ? x.id === find.arc
        : find.goal
          ? x.sides.some((s) => s.goal === find.goal)
          : x.id === here.place.trouble?.arc,
    );
    if (!a) return this.where(notice ?? "That arc is over");
    const goods = a.sides.some((s) => s.wants === "goods" && !s.mine);
    const goals = goods ? await this.world.goals(this.character) : undefined;
    const trouble = here.place.trouble?.arc === a.id ? here.place.trouble : undefined;
    return this.done(
      stageCard(o, here, a, this.lex, {
        goals: goals?.ok ? [...goals.reply.board, ...goals.reply.mine] : undefined,
        trouble,
        notice,
      }),
    );
  }

  /** Backs a side: goods given where they land, or a declaration for a side filled by deeds. */
  private back(goal: string, v: number, goods?: { material: string; units: number }) {
    const fields: Partial<api.ActionRequest> = goods
      ? { target: goal, asset: goods.material, units: goods.units }
      : { target: goal };
    return this.write(api.ActBackSide, v, fields, (_, why) =>
      this.stage(
        { goal },
        why ??
          (goods
            ? `Given: ${amount(goods.units, this.lex.material(goods.material).toLowerCase())}`
            : "You back it: what you do in its regions now counts toward it"),
      ),
    );
  }

  /** /forget-me's question, at the character's version. */
  private async forgetAsk(notice?: string, version?: number): Promise<Answer> {
    const v = version ?? (await this.world.options(this.character)).version;
    return this.done(forgetAskCard(v, notice));
  }

  /** The confirmed forget: the world first, then the bot's own notes. */
  private async forgetMe(v: number): Promise<Answer> {
    const res = await this.act(api.ActForget, v, { discordId: this.press.user });
    if (!res.ok && res.refusal.code !== api.CodeForgotten)
      return this.forgetAsk(capitalise(refusalText(res.refusal)), res.refusal.version);
    return { card: forgetDoneCard(true, await forgetBot(this.ctx, this.press.user)) };
  }

  async where(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    return this.retitled(this.done(whereCard(o, here, this.lex)), notice);
  }

  /** Since you left; a notice titles it, as a rename's outcome or refusal. */
  private async recap(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const recap = await this.world.recap(this.character);
    return this.retitled(this.done(await this.recapAnswer(o, here, recap)), notice);
  }

  /**
   * A kind just discovered: its names are asked for now, so the naming card
   * finds them ready, and its description shows if it came in time.
   */
  private async discoveryDescription(facts: api.Fact[]): Promise<string | undefined> {
    try {
      const kind = discoveredKind(facts);
      if (!kind || facts.some((f) => f.kind === "craft.failed") || !this.ctx.narrator) return;
      const k = (await this.world.recipes(this.character)).known.find((x) => x.kind === kind);
      if (!k) return;
      const offer = await this.names.suggest(
        "kind",
        kind,
        k.name,
        kindNameFacts(k, this.lex),
        this.nameCtx(),
      );
      return offer?.description;
    } catch {
      // The craft is already committed; its card shows without the description.
      return;
    }
  }

  /** A write, then the card it leads to; a refusal shows its reason on that card. */
  private async write(
    kind: string,
    v: number,
    fields: Partial<api.ActionRequest>,
    then: (reply: api.ActionReply | null, refusal?: string) => Promise<Answer>,
  ): Promise<Answer> {
    const res = await this.act(kind, v, fields);
    if (!res.ok) return then(null, capitalise(refusalText(res.refusal)));
    return then(res.reply);
  }

  async button(id: Id, values: string[]): Promise<Answer> {
    const v = id.version;
    const value = values[0] ?? "";
    const isPair = PAIR_ACTIONS.has(id.action);
    // A select's pick carries the pair a button holds in its target.
    const pair = isPair ? fields(value || id.target, ":", 2) : null;
    if (isPair && !pair) return backCards.unknown(this.character);
    const [a, b] = pair ?? ["", ""];
    const quantity = integerTarget(b!);
    if (QUANTITY_ACTIONS.has(id.action) && quantity === undefined)
      return backCards.unknown(this.character);
    switch (id.action) {
      case "hub":
        return this.hub();
      case "forget":
        return id.target === "yes" ? this.forgetMe(v) : this.forgetAsk();
      case "where":
        return this.where();
      case "travel":
        return this.travel();
      case "field": {
        const { o, here } = await this.load();
        return this.done(fieldCard(o, here, this.lex));
      }
      case "craft":
        return this.craft({});
      case "craft-p":
        return this.craft({ process: value });
      case "craft-m":
        return this.craft({ ...parseDraft(id.target), method: value });
      case "craft-s":
        return this.craft({ ...parseDraft(id.target), slot: value });
      case "craft-i":
        return this.craft({ ...parseDraft(id.target), material: value });
      case "craft-q": {
        const d = parseDraft(id.target);
        const { o, here } = await this.load();
        const ap = await this.world.appraise({
          characterId: this.character,
          recipe: draftRecipe(d),
        });
        if (!ap.ok) return this.retitled(await this.craft({}), capitalise(ap.refusal.message));
        // The back room is offered to the made where a den's fence stands.
        const backRoom =
          here.people.some((p) => p.fence) &&
          (await this.world.sheet(this.character)).character.alignment.made;
        return this.done(appraisalCard(o, here, ap.reply, this.lex, d, backRoom));
      }
      case "craft-go":
      case "craft-b":
        return this.write(
          api.ActCraft,
          v,
          {
            recipe: draftRecipe(parseDraft(id.target)),
            backRoom: id.action === "craft-b" || undefined,
          },
          async (r, why) => {
            if (!r) return this.retitled(await this.craft({}), why);
            const { o, here } = await this.load();
            return this.done(
              madeCard(o, here, r.facts, this.lex, await this.discoveryDescription(r.facts)),
            );
          },
        );
      case "market": {
        const [list, material] = id.target.split(":");
        return this.market(list && isList(list) ? list : "book", material || undefined);
      }
      case "mkt-l":
        return this.market(isList(value) ? value : "book", id.target || undefined);
      case "mkt-m":
        return this.market(isList(id.target) ? id.target : "book", value || undefined);
      case "sell":
      case "mkt-sell":
        return this.write(api.ActSell, v, { material: a, units: quantity }, (r, why) =>
          this.market(
            id.action === "sell" ? "orders" : "book",
            a,
            why ??
              (r
                ? fillNotice(r, "Sold", "in hand", "No buyer took it; your goods are still yours")
                : undefined),
          ),
        );
      case "mkt-take":
        return this.write(api.ActTake, v, { material: a, units: quantity }, (r, why) =>
          this.market(
            "book",
            a,
            why ??
              (r
                ? fillNotice(r, "Bought", "left", "Nobody sold to you; your coin is still yours")
                : undefined),
          ),
        );
      case "mkt-o":
      case "mkt-os":
      case "mkt-op":
      case "mkt-ou": {
        const d = draftOf(id.action === "mkt-o" ? id.target : value);
        if (!d) return backCards.unknown(this.character);
        return this.orderForm(d);
      }
      case "mkt-post": {
        const d = draftOf(id.target);
        if (!d) return backCards.unknown(this.character);
        const kind = d.side === "bid" ? api.ActBid : api.ActAsk;
        return this.write(
          kind,
          v,
          { material: d.material, units: d.units, price: d.price, staged: d.staged || undefined },
          async (r, why) =>
            why
              ? this.retitled(await this.orderForm(d), why)
              : this.market(
                  d.staged ? "staged" : "mine",
                  d.material,
                  postNotice(r ? filled(r) : 0, d.units),
                ),
        );
      }
      case "withdraw":
        return this.write(api.ActWithdraw, v, { item: value }, (_, why) =>
          this.market("mine", undefined, why ?? "Withdrawn: the escrow is yours again"),
        );
      case "gear-buy":
        return this.write(api.ActPurchase, v, { item: value }, (_, why) =>
          this.market("gear", undefined, why ?? "Bought: it is in your pack"),
        );
      case "list":
        return this.write(
          api.ActList,
          v,
          { item: id.target, price: Number(value) },
          async (_, why) =>
            why
              ? this.retitled(await this.item(id.target), why)
              : this.market("gear", undefined, "Listed"),
        );
      case "sell-item":
        return this.write(api.ActSellItem, v, { item: id.target }, async (r, why) =>
          why
            ? this.retitled(await this.item(id.target), why)
            : this.market(
                "gear",
                undefined,
                `Sold to the trader: ${amount(r!.character.coin, "coin")} in hand`,
              ),
        );
      case "buy":
        return this.write(api.ActBuy, v, { asset: a, units: quantity }, (_, why) =>
          this.market("orders", undefined, why),
        );
      case "feed":
        return this.write(api.ActFeed, v, {}, (_, why) => this.market("orders", undefined, why));
      case "character":
        return this.character_();
      case "item":
        return this.item(value || id.target);
      case "equip":
        return this.write(api.ActEquip, v, { item: a, slot: b }, async (_, why) =>
          why ? this.retitled(await this.item(a!), why) : this.character_(),
        );
      case "repair":
        return this.write(api.ActRepair, v, { item: id.target }, async (_, why) =>
          this.retitled(await this.item(id.target), why),
        );
      case "pick":
        return this.write(api.ActPick, v, { item: a, option: b }, async (_, why) =>
          this.retitled(await this.item(a!), why),
        );
      case "recipes":
        return this.recipes();
      case "chronicle": {
        const day = integerTarget(value || id.target);
        return this.chronicle(day !== undefined && day >= 0 ? day : undefined);
      }
      case "c-fact": {
        const fact = integerTarget(value || id.target);
        if (fact === undefined || fact <= 0) return backCards.unknown(this.character);
        return this.chronicleFact(fact);
      }
      case "arc":
        if (!(value || id.target)) return backCards.unknown(this.character);
        return this.stage({ arc: value || id.target });
      case "s-back":
        if (!id.target) return backCards.unknown(this.character);
        return this.stage({ goal: id.target });
      case "trouble":
        return this.stage({ trouble: true });
      case "s-decl":
        if (!id.target) return backCards.unknown(this.character);
        return this.back(id.target, v);
      case "s-give": {
        const f = fields(id.target, ":", 2);
        if (!f) return backCards.unknown(this.character);
        return this.stage({ goal: f[0] });
      }
      case "s-gave": {
        const f = fields(id.target, ":", 2);
        const units = integerTarget((this.press.fields?.[UNITS_INPUT] ?? "").trim());
        if (!f) return backCards.unknown(this.character);
        if (units === undefined || units <= 0)
          return this.stage({ goal: f[0] }, "Give a whole number of units, 1 or more");
        return this.back(f[0]!, v, { material: f[1]!, units });
      }
      case "alarm":
        return this.hub();
      case "p-set": {
        const units = integerTarget(value);
        if (units === undefined || units < 0) return backCards.unknown(this.character);
        const { o } = await this.load();
        return this.write(api.ActPatternSet, v, { to: o.at, units }, (_, why) =>
          this.where(why ?? "Set: the point holds it once its machine is solved"),
        );
      }
      case "gld-city":
        return this.write(api.ActCityRaise, v, {}, (_, why) =>
          why
            ? this.guild("places", why)
            : this.goals(undefined, "The city project's goals are on the board"),
        );
      case "recap":
        return this.recap();
      case "pr-name":
        if (!id.target) return backCards.unknown(this.character);
        return this.naming({ subject: "promotion", row: id.target });
      case "pr-named":
        if (!id.target) return backCards.unknown(this.character);
        return this.submitName(
          { subject: "promotion", row: id.target },
          this.press.fields?.[NAME_INPUT] ?? "",
          v,
        );
      case "kn-name":
      case "kn-own": {
        const t = parseNameTarget(id.target);
        if (!t) return backCards.unknown(this.character);
        return this.naming(t);
      }
      case "kn-pick": {
        const pick = parsePick(id.target);
        if (!pick) return backCards.unknown(this.character);
        if (!pick.name) return this.nameHome(pick.t, "It keeps its plain name");
        return this.sendName(pick.t, pick.name, v);
      }
      case "kn-named": {
        const t = parseNameTarget(id.target);
        if (!t) return backCards.unknown(this.character);
        return this.submitName(t, this.press.fields?.[NAME_INPUT] ?? "", v);
      }
      case "step":
        return this.write(api.ActStep, v, { dir: Number(id.target) }, async (_, why) =>
          this.travel(why ?? "On your way"),
        );
      case "goto":
      case "follow": {
        const coords = fields(value || id.target, ",", 2);
        const q = integerTarget(coords?.[0] ?? "");
        const r = integerTarget(coords?.[1] ?? "");
        if (q === undefined || r === undefined) return backCards.unknown(this.character);
        return this.write(
          api.ActTravel,
          v,
          { to: { q, r }, stop: { threat: this.ctx.threatLine } },
          async (_, why) => {
            const ans = await this.travel(why ?? "On your way");
            return { ...ans, long: !why };
          },
        );
      }
      case "cancel":
        return this.write(api.ActCancel, v, {}, (_, why) =>
          this.hub(why ?? "You stop where you are"),
        );
      case "explore":
        return this.write(api.ActExplore, v, {}, async (_, why) => {
          const { o, here } = await this.load();
          if (!why && o.fight?.shared) return this.partyBeat(o, here);
          if (!why && o.fight) return this.done(beatCard(o, here, this.lex));
          return this.retitled(
            this.done(fieldCard(o, here, this.lex)),
            why ?? "The herd here is thin: nothing shows itself",
          );
        });
      case "fight":
        return this.fight();
      case "press":
        return this.write(api.ActPress, v, { option: id.target }, async (r, why) => {
          if (!r) return this.retitled(await this.fight(), why);
          return this.fight(r);
        });
      case "why": {
        const { o, here } = await this.load();
        return this.done(whyCard(o, here, this.lex, id.target === "options" ? "options" : "moves"));
      }
      case "crawl":
        return this.write(api.ActCrawl, v, {}, (_, why) =>
          this.longAnswer("You start crawling out", why),
        );
      case "rest":
        return this.write(api.ActRest, v, {}, (_, why) => this.longAnswer("You rest", why));
      case "gather":
        return this.write(api.ActGather, v, { material: a, ticks: quantity }, (_, why) =>
          this.longAnswer("You set to gathering", why),
        );
      case "forage":
        return this.write(api.ActForage, v, { ticks: Number(id.target) }, (_, why) =>
          this.longAnswer("You forage", why),
        );
      case "talk": {
        // The where card's people select carries the NPC as its pick.
        const npc = value || id.target;
        return this.write(api.ActTalk, v, { npc }, async (_, why) =>
          why ? this.where(why) : this.talk(npc),
        );
      }
      case "choose": {
        const choice = fields(id.target, "/", 3);
        if (!choice) return backCards.unknown(this.character);
        const [npc, topic, option] = choice;
        return this.write(api.ActChoose, v, { npc, option: `${topic}/${option}` }, async (_, why) =>
          this.talk(npc!, why),
        );
      }
      case "search":
        return this.write(api.ActSearch, v, {}, async (_, why) =>
          this.where(why ?? "You find what was hidden"),
        );
      case "consent":
        return this.write(api.ActConsent, v, { option: a, units: quantity }, async (_, why) =>
          this.retitled(await this.character_(), why),
        );
      case "goals":
        return this.goals();
      case "goal": {
        const turn = fields(value, ":", 2);
        if (turn?.[0] === "page")
          return this.goals(undefined, undefined, integerTarget(turn[1]!) ?? 0);
        return this.goals(value || id.target);
      }
      case "gld-member": {
        const turn = fields(value, ":", 2);
        if (turn?.[0] === "page")
          return this.guild("members", undefined, integerTarget(turn[1]!) ?? 0);
        return value ? this.guildMember(value) : this.guild();
      }
      case "gld-act": {
        const f = fields(id.target, ":", 3);
        if (!f) return this.guild();
        const [what, who, arg] = f as [string, string, string];
        const done = (said: string) => (_: unknown, why?: string) =>
          this.guildMember(who, why ?? said);
        switch (what) {
          case "allow":
            return this.write(api.ActAllow, v, { target: who, units: Number(arg) }, done("Set"));
          case "promote":
            return this.write(api.ActPromote, v, { target: who }, done("Named an officer"));
          case "vote":
            return this.write(
              api.ActVote,
              v,
              { target: who, option: arg },
              done("Your vote is cast"),
            );
          case "pay": {
            const n = integerTarget(value);
            if (n === undefined) return backCards.unknown(this.character);
            return this.write(api.ActPay, v, { target: who, asset: arg, units: n }, (r, why) =>
              this.guildMember(
                who,
                why ??
                  (r?.facts.some((f) => f.kind === "guild.approval-asked")
                    ? "Over what you may pay alone today: it waits for a second officer"
                    : "Paid"),
              ),
            );
          }
          default:
            return backCards.unknown(this.character);
        }
      }
      case "gld-invite":
        return this.guildWrite(api.ActInvite, v, { target: value }, "members", "Invited");
      case "gld-give":
      case "gld-take":
        if (!value) return this.guild("bank");
        return this.guildPick({ act: id.action === "gld-give" ? "give" : "draw", asset: value });
      case "gld-pay":
        return id.target ? this.guildMember(id.target, undefined, value) : this.guild();
      case "gld-draw":
        return this.guildWrite(
          api.ActDraw,
          v,
          { asset: a, units: quantity },
          "bank",
          "Drawn at cost",
        );
      case "g-form":
      case "g-page":
      case "g-verb":
      case "g-target":
      case "g-amount":
      case "g-narrow":
      case "g-least":
      case "g-reward":
      case "g-cap":
      case "g-party": {
        const button = id.action === "g-form" || id.action === "g-page";
        const d = goalDraftOf(button ? id.target : value);
        if (!d) return backCards.unknown(this.character);
        return this.goalForm(d);
      }
      case "g-drafts": {
        const res = await this.world.goals(this.character);
        const draft = res.ok ? res.reply.drafts[Number(value)] : undefined;
        if (!draft) return this.goals();
        return this.goalForm(fromSpec(draft.spec));
      }
      case "g-name": {
        const d = goalDraftOf(id.target);
        return d ? this.goalForm(d) : this.goals();
      }
      case "g-post": {
        const d = goalDraftOf(id.target);
        if (!d) return backCards.unknown(this.character);
        return this.postGoal(d, v);
      }
      case "g-deliver": {
        const f = fields(id.target, ":", 3);
        const n = integerTarget(f?.[2] ?? "");
        if (!f || n === undefined) return backCards.unknown(this.character);
        return this.write(
          api.ActDeliverGoal,
          v,
          { target: f[0], material: f[1] === "haul" ? undefined : f[1], units: n },
          (_, why) => this.goals(f[0], why ?? "Delivered"),
        );
      }
      case "g-pledge":
        return this.write(api.ActPledge, v, { target: a, units: quantity }, (_, why) =>
          this.goals(a, why ?? `Pledged ${amount(quantity ?? 0, "coin")}`),
        );
      case "g-haul":
        return this.write(api.ActTakeHaul, v, { target: id.target }, (_, why) =>
          this.goals(id.target, why ?? "The haul is yours to carry"),
        );
      case "g-wd":
        return this.write(api.ActWithdrawGoal, v, { target: id.target }, (_, why) =>
          this.goals(undefined, why ?? "Withdrawn: the escrow is yours again"),
        );
      case "help":
        return this.write(api.ActCallHelp, v, {}, (_, why) =>
          this.longAnswer("You call for help, and start to crawl", why),
        );
      case "carry":
        return this.write(api.ActCarry, v, { target: id.target }, async (_, why) => {
          if (why) return this.travel(why);
          const home = (await this.world.options(this.character)).rescue?.carryingHome;
          return this.travel(`You lift them: carry them home to ${home ?? "their settlement"}`);
        });
      case "guild":
        return this.guild(isGuildView(id.target) ? id.target : "members");
      case "gld-name":
      case "gld-found":
        if (id.target === "take")
          return this.guildWrite(api.ActCharter, v, {}, "places", "Chartered");
        return this.guild();
      case "gld-new": {
        const name = this.press.fields?.[NAME_INPUT] ?? "";
        return this.screened(
          name.trim(),
          "guild",
          "",
          (held) => this.guild("members", held),
          () => this.guildWrite(api.ActFoundGuild, v, { note: name }, "members", "Founded"),
        );
      }
      case "gld-chart": {
        const name = this.press.fields?.[NAME_INPUT] ?? "";
        return this.screened(
          name.trim(),
          "settlement",
          "",
          (held) => this.guild("places", held),
          () =>
            this.guildWrite(
              api.ActFound,
              v,
              { note: name },
              "places",
              "Founded: the settlement stands",
            ),
        );
      }
      case "gld-join":
        return this.guildWrite(api.ActJoin, v, { target: id.target }, "members", "Joined");
      case "gld-leave": {
        if (id.target === "yes")
          return this.guildWrite(api.ActLeave, v, {}, "members", "You left the guild");
        const g = await this.world.guild(this.character);
        if (!g.id) return this.guild();
        return this.done(leaveCard(await this.world.options(this.character), g));
      }
      case "gld-dep":
        return this.guildWrite(
          api.ActDeposit,
          v,
          { asset: a, units: quantity },
          "bank",
          "Given to the guild",
        );
      case "gld-appr":
        return this.guildWrite(api.ActApprove, v, { option: id.target }, "members", "Approved");
      case "gld-work":
        return this.guildWrite(api.ActWork, v, { option: a, units: quantity }, "works");
      case "gld-raise":
        return value ? this.guildPick({ raise: value }) : this.guild("places");
      case "gld-rwd": {
        const reward = integerTarget(value);
        if (!id.target || reward === undefined || reward < 0)
          return backCards.unknown(this.character);
        return this.write(
          api.ActRaise,
          v,
          { slot: id.target, price: reward || undefined },
          (_, why) =>
            why ? this.guild("places", why) : this.goals(undefined, "Its goals are on the board"),
        );
      }
      case "gld-mend": {
        const step = fields(value, ":", 2);
        const points = integerTarget(step?.[1] ?? "");
        if (!step || points === undefined) return backCards.unknown(this.character);
        return this.guildWrite(
          api.ActMend,
          v,
          { slot: step[0], units: points },
          "places",
          "Repaired",
        );
      }
      case "classes":
        return this.classes(value || id.target || undefined);
      case "cls-choose":
        return this.write(api.ActChooseClass, v, { option: id.target }, (_, why) =>
          this.classes(id.target, why ?? "Active"),
        );
      case "cls-take":
        return this.write(api.ActTakeAbility, v, { option: b }, (_, why) =>
          this.classes(a, why ?? "Taken"),
        );
      case "cls-mark":
        return this.write(api.ActMarkPrey, v, { option: value }, (_, why) =>
          this.classes(id.target || undefined, why ?? `Marked for today: ${value}`),
        );
      case "party":
        return this.party();
      case "p-card":
        return this.partyHere();
      case "p-invite":
        if (!value) return this.party();
        return this.write(api.ActPartyInvite, v, { target: value }, (_, why) =>
          this.party(why ?? "Invited: they accept from their own party card"),
        );
      case "p-join":
        return this.write(api.ActPartyJoin, v, { target: id.target }, (_, why) =>
          this.party(why ?? "You joined the party"),
        );
      case "p-leave":
        return this.write(api.ActPartyLeave, v, {}, (_, why) =>
          this.party(why ?? "You left the party"),
        );
      case "p-follow":
        return this.write(api.ActFollow, v, {}, (_, why) =>
          this.party(why ?? "You follow the leader: you enter each tile when they do"),
        );
      case "p-unfollow":
        return this.write(api.ActUnfollow, v, {}, (_, why) =>
          this.party(why ?? "You no longer follow the leader"),
        );
      case "p-pick":
        return this.partyPick(id.target, v);
      case "p-machine":
        return this.partyMachine(id.target === "fork" ? "fork" : "beat");
      case "dungeon":
        return this.dungeon();
      case "push":
        return this.write(api.ActDungeonPush, v, { option: id.target }, async (_, why) => {
          const o = await this.world.options(this.character);
          if (!why && o.fight) return this.fight();
          return this.dungeon(why);
        });
      case "dg-leave":
        return this.write(api.ActDungeonLeave, v, {}, async (_, why) => {
          if (why) return this.dungeon(why);
          const o = await this.world.options(this.character);
          if (o.long) return this.longAnswer("You climb out with what you carry");
          return this.dungeon("You leave once the fork resolves");
        });
      case "d-name":
        return this.dungeon();
      case "d-named":
        if (!hexOf(id.target)) return backCards.unknown(this.character);
        return this.submitName(
          { subject: "dungeon", row: id.target },
          this.press.fields?.[NAME_INPUT] ?? "",
          v,
        );
      case "hunt":
        return this.hunt(id.target || undefined);
      case "h-press": {
        const f = fields(id.target, ":", 2);
        if (!f) return backCards.unknown(this.character);
        const [hunt, option] = f as [string, string];
        return this.write(api.ActHuntPress, v, { target: hunt, option }, async (r, why) => {
          if (why) return this.hunt(hunt, why);
          const p = r?.pressed?.[0];
          return this.hunt(
            hunt,
            p
              ? `${this.lex.name("fights.options", p.option)}: ${p.success ? "it worked" : "it failed"}`
              : "Pressed",
          );
        });
      }
      case "steal":
        return this.steal(value || id.target, v);
      case "fence": {
        const sale = parseFence(id.target);
        if (!sale) return backCards.unknown(this.character);
        const { npc, ...goods } = sale;
        return this.write(api.ActFence, v, goods, (r, why) =>
          this.talk(
            npc,
            why ?? `Sold to the fence: ${amount(r?.character.coin ?? 0, "coin")} in hand`,
          ),
        );
      }
      case "pay-fine":
        return this.write(api.ActPayFine, v, {}, (_, why) =>
          this.hub(why ?? "Paid: the watch lets you through"),
        );
      case "flee":
        return this.write(api.ActFlee, v, {}, async (_, why) => {
          if (!why) return this.fight();
          return this.hub(why);
        });
      case "admin":
        return this.console(undefined, "admin");
      case "staff":
        return this.console(undefined, "staff");
      case "hs-stage": {
        if (!id.target) return this.stageForm();
        const d = stageDraftOf(id.target);
        return d ? this.stageForm(d) : backCards.unknown(this.character);
      }
      case "hs-tpl":
      case "hs-set":
      case "hs-site":
      case "hs-what":
      case "hs-open":
      case "hs-days": {
        const d = stageDraftOf(id.target);
        const next = d && stagePicked(d, id.action, value);
        return next ? this.stageForm(next) : backCards.unknown(this.character);
      }
      case "hs-go": {
        const d = stageDraftOf(id.target);
        return d ? this.sendStage(d, v) : backCards.unknown(this.character);
      }
      case "hs-end":
        if (!value || !this.may("staff")) return this.console();
        return this.houseWrite(api.ActStageEnd, v, { target: value }, (_, why) =>
          this.console(why ?? "Ended: what it left is gone, and nothing is refunded"),
        );
      case "hs-queue":
        return this.queue(queueFocusOf(value || id.target));
      case "hs-case":
        return this.queue({ ...queueFocusOf(id.target), case: value });
      case "hs-mod": {
        const f = fields(id.target, ".", 3);
        const days = integerTarget(f?.[2] ?? "");
        if (!f || days === undefined) return backCards.unknown(this.character);
        return this.moderate(f[0]!, f[1]!, days, v);
      }
      case "hs-lift": {
        if (!value || !this.may("staff")) return this.holds();
        const lift = liftOf(value);
        if (!lift) return backCards.unknown(this.character);
        return this.houseWrite(api.ActModerate, v, { moderate: lift }, (_, why) =>
          this.holds(why ?? "Lifted"),
        );
      }
      case "hs-held": {
        if (!this.may("staff")) return this.queue(queueFocusOf(""));
        const store = this.ctx.house?.held;
        const gone =
          store && this.press.guild ? await store.dismiss(this.press.guild, value) : false;
        return this.queue(
          queueFocusOf(""),
          gone ? "Dismissed: the name was never sent" : "That name is no longer held",
        );
      }
      case "hs-log":
        return this.log(Math.max(0, integerTarget(id.target) ?? 0));
      case "hs-conf":
      case "hs-quiet":
        return this.settings(isChannelKind(id.target) ? id.target : "events");
      case "hs-kind":
        return this.settings(isChannelKind(value) ? value : "events");
      case "hs-chan": {
        if (!isChannelKind(id.target)) return backCards.unknown(this.character);
        const kind = id.target;
        return this.saveSettings(
          kind,
          v,
          (st) => ({ ...st, channels: withChannel(st.channels, kind, value) }),
          value && value !== "-"
            ? "Saved: the channel is mapped"
            : "Saved: the bot's default channel",
        );
      }
      case "hs-srole":
      case "hs-arole": {
        const kind = isChannelKind(id.target) ? id.target : "events";
        const key = id.action === "hs-srole" ? "staffRoles" : "alarmRoles";
        if (!value) return this.settings(kind);
        return this.saveSettings(
          kind,
          v,
          (st) => {
            const roles = toggled(st[key], value);
            if (roles.length > SETTINGS_ROLES_MOST)
              return `A server names at most ${SETTINGS_ROLES_MOST} roles of each kind`;
            return { ...st, [key]: roles };
          },
          "Saved: the roles are set",
        );
      }
      case "hs-names": {
        const kind = isChannelKind(id.target) ? id.target : "events";
        return this.saveSettings(
          kind,
          v,
          (st) => ({ ...st, hideNames: !st.hideNames }),
          "Saved: player names",
        );
      }
      case "hs-narr": {
        const kind = isChannelKind(id.target) ? id.target : "events";
        return this.saveSettings(
          kind,
          v,
          (st) => ({ ...st, narrated: !st.narrated }),
          "Saved: narration",
        );
      }
      case "hs-quieted": {
        const from = (this.press.fields?.[QUIET_FROM] ?? "").trim();
        const to = (this.press.fields?.[QUIET_TO] ?? "").trim();
        const a = minutesOf(from);
        const b = minutesOf(to);
        return this.saveSettings(
          "events",
          v,
          (st) => {
            if (!from && !to) return { ...st, quietFrom: 0, quietTo: 0 };
            if (a === undefined || b === undefined)
              return "Give both times as HH:MM in UTC, or leave both empty";
            return { ...st, quietFrom: a, quietTo: b };
          },
          "Saved: quiet hours",
        );
      }
      case "hs-pins": {
        if (!id.target) return this.pins();
        const d = pinDraftOf(id.target);
        return d ? this.pins(d) : backCards.unknown(this.character);
      }
      case "hs-pset":
      case "hs-ptile":
      case "hs-pfield":
      case "hs-prow": {
        const d = pinDraftOf(id.target);
        const next = d && pinPicked(d, id.action, value);
        return next ? this.pins(next) : backCards.unknown(this.character);
      }
      case "hs-pin": {
        const d = pinDraftOf(id.target);
        return d ? this.sendPin(d, v) : backCards.unknown(this.character);
      }
      case "hs-pinls":
        return this.pinsPlaced();
      case "hs-unpin":
        return this.sendUnpin(value, v);
      case "rpt":
        return this.fileReport(id.target, value, v);
      case "crate": {
        if (!id.target) return backCards.unknown(this.character);
        // A post's button carries no version: the character's own is used.
        const at = v || (await this.world.options(this.character)).version;
        return this.write(api.ActCrateOpen, at, { target: id.target }, async (r, why) => {
          const [o, st] = await Promise.all([
            this.world.options(this.character),
            this.stageOf(id.target),
          ]);
          return this.done(crateOpen(o, st, this.lex, r?.facts ?? [], why));
        });
      }
      case "drop":
      case "fair": {
        const [o, st] = await Promise.all([
          this.world.options(this.character),
          this.stageOf(id.target),
        ]);
        if (!st) return this.where("That staging is over");
        if (id.action === "drop") return this.done(dropCard(st, o));
        return this.done(fairCard(st, contestsOf(await this.world.board(), st), o));
      }
      case "launch":
        return this.launched(launchFor(id));
      case "start":
        return this.hub();
      default:
        return backCards.unknown(this.character);
    }
  }
}

/** The title a name submitted empty gets. */
const NO_NAME = "Give it a name: a few words the board takes";

/** A server's staff and admin kinds: their writes name the member, for the log (GDD 14.8). */
const HOUSE_KINDS = new Set<string>([
  api.ActStage,
  api.ActStageEnd,
  api.ActHousePin,
  api.ActHouseUnpin,
  api.ActModerate,
  api.ActHouseSettings,
]);

/** What the queue's title says once a moderation action is accepted. */
const MODERATED: Record<string, string> = {
  mask: "Masked: the name reads as its plain one here",
  hide: "Hidden: the goal's title and note read as plain here",
  mute: "Muted here",
  suspend: "Suspended from this server's boards",
  exclude: "Excluded from this server's settlements",
  escalate: "Escalated to the world's operators",
  dismiss: "Dismissed",
};

/** structural: the most pages of the public log one press reads. */
const LOG_WALK_MOST = 200;

/** structural: Discord's select holds this many roles, so a server names at most this many of a kind. */
const SETTINGS_ROLES_MOST = 25;

/** A server with no house yet, as its members read it before an admin saves the settings. */
function emptyHouse(server: string, label: string, role: string): api.House {
  return {
    server,
    label,
    arrival: -1,
    settings: {},
    settlements: [],
    templates: [],
    hunts: [],
    contests: [],
    stages: [],
    role,
    stagedXp: 0,
  };
}

/** A stage draft with one pick made. */
function stagePicked(d: StageDraft, action: Action, value: string): StageDraft | null {
  switch (action) {
    case "hs-tpl":
      return value ? { ...d, template: value, what: "-" } : null;
    case "hs-set": {
      const n = integerTarget(value);
      return n === undefined ? null : { ...d, settlement: n, site: "-" };
    }
    case "hs-site":
      return hexOf(value) ? { ...d, site: value } : null;
    case "hs-what":
      return value && !value.includes(".") ? { ...d, what: value } : null;
    case "hs-open": {
      const n = integerTarget(value);
      return n === undefined || n < 0 ? null : { ...d, opens: n };
    }
    case "hs-days": {
      const n = integerTarget(value);
      return n === undefined || n < 0 ? null : { ...d, days: n };
    }
    default:
      return null;
  }
}

/** A pin draft with one pick made. */
function pinPicked(d: PinDraft, action: Action, value: string): PinDraft | null {
  switch (action) {
    case "hs-pset": {
      const n = integerTarget(value);
      return n === undefined ? null : { ...d, settlement: n, site: "-" };
    }
    case "hs-ptile":
      return hexOf(value) ? { ...d, site: value } : null;
    case "hs-pfield":
      return pinDraftOf([d.settlement, d.site, value, "-"].join("."));
    case "hs-prow":
      return value && !value.includes(".") ? { ...d, row: value } : null;
    default:
      return null;
  }
}

/** The settings' channels with one kind mapped to a channel, or to the default with "-". */
function withChannel(
  channels: api.Channel[] | undefined,
  kind: ChannelKind,
  id: string,
): api.Channel[] {
  const rest = (channels ?? []).filter((c) => c.kind !== kind);
  return id && id !== "-" ? [...rest, { kind, id }] : rest;
}

/** A role list with one role added, or taken off if it was there. */
function toggled(roles: string[] | undefined, id: string): string[] {
  const now = roles ?? [];
  return now.includes(id) ? now.filter((r) => r !== id) : [...now, id];
}

/** Units a write filled on the market, by its fill facts. */
function filled(r: api.ActionReply): number {
  return r.facts
    .filter((f) => f.kind === "market.filled" || f.kind === "order.filled")
    .reduce((n, f) => n + (f.data.find((d) => d.k === "units")?.n ?? 0), 0);
}

/** What a sell or take at once filled: the goods and the coin after, or none. */
function fillNotice(r: api.ActionReply, verb: string, coinTail: string, none: string): string {
  const done = filled(r);
  return done
    ? `${verb} ${amount(done, "goods")}: ${amount(r.character.coin, "coin")} ${coinTail}`
    : none;
}

function postNotice(done: number, units: number): string {
  if (!done) return "Your order stands";
  return done >= units
    ? "Filled at once"
    : `Part filled: ${amount(done, "goods")}; the rest stands`;
}

/** The market nearest a tile. */
function nearest(at: api.Hex, markets: readonly api.Hex[]): api.Hex | undefined {
  return markets.reduce<api.Hex | undefined>(
    (best, h) => (!best || hexDistance(h, at) < hexDistance(best, at) ? h : best),
    undefined,
  );
}

function peopleOf(here: api.Here): Map<string, string> {
  return new Map(here.people.map((p) => [p.id, p.name]));
}

/** The bot's own forget; false when it failed, so the player is asked to run it again. */
async function forgetBot(ctx: Ctx, user: string): Promise<boolean> {
  if (!ctx.forget) return true;
  try {
    await ctx.forget(user);
    return true;
  } catch {
    return false;
  }
}

/** The text a refusal shows: a stale card is drawn again as it stands. */
function refusalText(r: api.Refusal): string {
  return r.code === api.CodeStale
    ? "The world moved on: here is the card as it stands."
    : r.message;
}

/** All the goods units in a purse. */
function goodsOf(goods: readonly api.Goods[]): number {
  return goods.reduce((n, g) => n + g.units, 0);
}

/** A dungeon's "q,r" reference as a tile. */
function hexOf(ref: string): api.Hex | undefined {
  const f = fields(ref, ",", 2);
  const q = integerTarget(f?.[0] ?? "");
  const r = integerTarget(f?.[1] ?? "");
  return q === undefined || r === undefined ? undefined : { q, r };
}

/** The live hunt a character standing at a tile and floor could press: on it or next to it, never below ground. */
export function inReach(
  hunts: readonly HuntPost[],
  at: api.Hex,
  floor: number,
): HuntPost | undefined {
  if (floor) return undefined;
  return hunts.find((h) => !h.closed && hexDistance(h.at, at) <= 1);
}

function isGuildView(s: string): s is GuildView {
  return s === "members" || s === "bank" || s === "places" || s === "works";
}
