import type { Button, Select } from "../../../packages/discord-kit/src/index.ts";
import {
  costDay,
  type DayLedger,
  fixedSwitch,
  KEY_PREFIX,
  memoryStore as narrationMemory,
  Narrator,
  stubModel,
} from "../../../packages/mmo-narrate/src/index.ts";
import * as api from "./api.ts";
import { type Card, problems } from "./card.ts";
import { ChroniclePoster, chronicleSource } from "./chronicle.ts";
import { NARRATION_DAY_USD } from "./config.ts";
import { COOLDOWN_PREFIX } from "./cooldown.ts";
import { EventsPoster } from "./events.ts";
import { answer, type Answer, type Ctx, launchFor, modalFor, type Press } from "./flow.ts";
import { forgetUser, type RedisLike } from "./forget.ts";
import { memoryStore } from "./forum.ts";
import { type ChannelKind, channelIn, Houses, memoryHeldNames } from "./house.ts";
import { type ChannelSink, GuildPosters, HuntPoster, type Poller, posterPrefix } from "./hunts.ts";
import { decodeId, type Id } from "./ids.ts";
import { Lexicon } from "./lexicon.ts";
import { narrationParts } from "./narration/index.ts";
import { HELD_KEY } from "./narration/names.ts";
import { lastKey } from "./narration/voice.ts";
import { PARTY_PREFIX, PartyPoster } from "./party.ts";
import { PromotionsPoster } from "./promotions.ts";
import { ThreadBudget } from "./publish.ts";
import { recording } from "./record.ts";
import { datum } from "./screens/common.ts";
import { isFlight, SYNDICATE, syndicateName } from "./screens/crime.ts";
import { promotionCard, SEASON_BEGAN, SEASON_EPOCH } from "./screens/emergence.ts";
import { hexDistance } from "./screens/hunt.ts";
import { LISTS } from "./screens/market.ts";
import { dropCard } from "./screens/staged.ts";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "./units.ts";
import { httpWorld, type World } from "./world.ts";

/** Whether a select is for action and, given a target, offers it. */
function offers(sel: Select, action: string, target?: string): boolean {
  return (
    decodeId(sel.customId)?.action === action &&
    (target === undefined || sel.options.some((o) => o.value === target))
  );
}

/**
 * The scripted client: one player through the first sitting (GDD 3.1),
 * pressing only what the bot's cards offer through the same handlers
 * Discord drives; every card is checked against the card standard and the
 * conservation audit runs at the end. With --season it then opens an
 * arc's stage card and backs a side through its buttons. With
 * --narration stub every card goes through the narrator with the stub
 * model and every switch on, and must pass the same checks as off.
 * --two-servers <url> runs two servers on one world through a season's
 * close on the operator's clock, and --posters <url> --guilds a,b runs
 * only the posters beside a world on real ticks; each prints one JSON
 * line last.
 */

export interface Run {
  presses: number;
  cards: number;
  problems: string[];
  ticks: number;
  encounters: number;
  toolLevel: number;
  coin: number;
  sold: number;
  crafted: string;
  /** The goal posted on the notice board, and whether it was withdrawn again. */
  posted: string;
  withdrawn: boolean;
  guild: string;
  /** The cards whose Activity launch was pressed: a launch is Discord's to answer, so none is sent on. */
  launches: string[];
  /** With --season: the arc whose stage card was opened, and the side backed through its buttons. */
  arc: string;
  backed: string;
  audit: string[];
  log: string[];
}

export async function scripted(
  ctx: Ctx,
  opts: { operator?: { url: string; token: string }; user?: string; season?: boolean } = {},
): Promise<Run> {
  const world = ctx.world;
  const user = opts.user ?? `scripted-${Date.now()}`;
  const names = ctx.lex.goodsNames();
  const run: Run = {
    presses: 0,
    cards: 0,
    problems: [],
    ticks: 0,
    encounters: 0,
    toolLevel: 0,
    coin: 0,
    sold: 0,
    crafted: "",
    posted: "",
    withdrawn: false,
    guild: "",
    launches: [],
    arc: "",
    backed: "",
    audit: [],
    log: [],
  };
  let seq = 0;
  let card!: Card;
  const note = (s: string) => run.log.push(s);

  const check = (c: Card) => {
    run.cards++;
    for (const p of problems(c, names)) run.problems.push(`${c.author}: ${p}`);
  };
  const send = async (p: Omit<Press, "user" | "interaction">) => {
    run.presses++;
    const a = await answer(ctx, {
      ...p,
      user,
      guild: "scripted",
      interaction: `scripted-${user}-${++seq}`,
    });
    check(a.card);
    card = a.card;
    return card;
  };
  const command = (name: string) => send({ command: name });
  /** Submits the modal a button opens: the modal's own id, with its text. */
  const submit = async (action: string, fields: Record<string, string>) => {
    for (const row of card.rows) {
      if (!("buttons" in row)) continue;
      for (const b of row.buttons) {
        if (b.kind !== "page" || b.disabled) continue;
        const id = decodeId(b.customId);
        const modal = id?.action === action ? modalFor(id) : null;
        if (modal) return send({ id: decodeId(modal.customId)!, fields });
      }
    }
    throw new Error(
      `no "${action}" that opens a modal on the card "${card.author} / ${card.title}"`,
    );
  };
  /** The custom id of a live page button whose action (and target, if given) matches. */
  const matching = (b: Button, action: string, target?: string) => {
    if (b.kind !== "page" || b.disabled) return undefined;
    const id = decodeId(b.customId);
    return id?.action === action && (target === undefined || id.target === target) ? id : undefined;
  };
  /** Presses the first button or select whose action (and target, if given) matches. */
  const press = async (action: string, target?: string, value?: string) => {
    for (const row of card.rows) {
      if ("buttons" in row) {
        for (const b of row.buttons) {
          const id = matching(b, action, target);
          if (!id) continue;
          const launch = launchFor(id);
          if (!launch) return send({ id });
          run.presses++;
          run.launches.push(launch.from);
          return card;
        }
      } else if (offers(row.select, action, target)) {
        const pick = value ?? target ?? row.select.options[0]?.value;
        if (pick !== undefined) return send({ id: decodeId(row.select.customId)!, values: [pick] });
      }
    }
    throw new Error(
      `no "${action}${target ? `:${target}` : ""}" on the card "${card.author} / ${card.title}"`,
    );
  };
  /** The first select option on the card whose value holds part. */
  const optionWith = (part: string) =>
    card.rows
      .flatMap((r) => ("select" in r ? r.select.options : []))
      .find((x) => x.value.includes(part))?.value;
  const has = (action: string, target?: string) =>
    card.rows.some((r) =>
      "buttons" in r
        ? r.buttons.some((b) => matching(b, action, target) !== undefined)
        : offers(r.select, action, target),
    );
  /** /play, and on past since-you-left to the hub when it shows first. */
  const openHub = async (): Promise<void> => {
    await command("play");
    if (card.author.startsWith("Chronicle")) await press("hub");
    if (card.author === "Down") {
      await press("crawl");
      await waitIdle();
      return openHub();
    }
  };
  const me = () => world.player(user);
  const waitIdle = async () => {
    const id = await me();
    for (;;) {
      const o = await world.options(id);
      if (!o.long) return o;
      await Bun.sleep(500);
    }
  };

  /**
   * Season zero's path through the cards: an arc's stage opened from the
   * chronicle's select, and one of its sides backed by the stage card's
   * own button, a declaration or an amount given through its modal. With
   * an operator token and no arc running yet, an overrun is cast on the
   * home region so there is a stage to back.
   */
  const backASide = async () => {
    const open = async () =>
      (await world.arcs(id)).open.filter((a) => a.scope !== "personal" && !a.outcome);
    if (!(await open()).length && opts.operator) {
      const board = await world.goals(id);
      const region = (await world.here(id)).place.tile.region;
      if (board.ok && board.reply.settlement >= 0 && region) {
        const res = await operate(opts.operator, {
          interactionId: `scripted-season-${user}`,
          characterId: "",
          kind: api.OpArcCast,
          note: "The scripted season run.",
          arc: {
            template: "the-overrun",
            cast: [
              { role: "front", kind: "region", id: region },
              { role: "seat", kind: "settlement", id: String(board.reply.settlement) },
            ],
          },
        });
        if (!res.ok) note(`arc-cast refused: ${await res.text()}`);
      }
    }
    let arcs = await open();
    for (let i = 0; i < 20 && !arcs.length; i++) {
      await Bun.sleep(3_000);
      arcs = await open();
    }
    if (!arcs.length) throw new Error("no arc is running to back");
    await command("chronicle");
    const arc = arcs[0]!;
    await press("arc", undefined, arc.id);
    run.arc = card.title;
    if (has("s-decl")) await press("s-decl");
    else if (has("s-give")) await submit("s-give", { units: "1" });
    else if (has("goto")) {
      await press("goto");
      await waitIdle();
      await command("chronicle");
      await press("arc", undefined, arc.id);
      if (has("s-give")) await submit("s-give", { units: "1" });
    }
    const now = (await world.arcs(id)).open.find((a) => a.id === arc.id);
    run.backed = now?.sides.find((x) => x.mine)?.title ?? "";
    if (!run.backed) note(`no side was backed: ${card.title}`);
  };

  await openHub();
  await press("start", "knife");
  const id = await me();
  const t0 = (await world.options(id)).tick;
  const home = (await world.options(id)).at;
  const tool = async () => (await world.sheet(id)).kit.find((i) => i.worn === "hand");
  const buys = new Set((await world.here(id)).orders.map((o) => o.material));
  const sellable = async () =>
    (await world.sheet(id)).character.goods.some((g) => buys.has(g.material) && g.units > 0);

  // Out to the suggested site, a step at a time.
  for (let i = 0; i < 8; i++) {
    const here = await world.here(id);
    if (here.place.explore) break;
    if (!here.suggest) throw new Error("no outing is suggested");
    await command("map");
    await press("step", String(here.suggest.dir));
    await waitIdle();
  }
  note(`at the site after ${(await world.options(id)).tick - t0} ticks`);

  // Fight until the tool reaches its first milestone.
  const worn = async () => {
    const t = await tool();
    return !t || t.durability * 3 < t.max;
  };
  for (
    let i = 0;
    i < 40 && (((await tool())?.level ?? 0) < 5 || !(await sellable())) && !(await worn());
    i++
  ) {
    await openHub();
    await press("field");
    if (!has("explore")) break;
    await press("explore");
    // As a tester does: press the best winning option, and only back out
    // when no option can win.
    while (has("press")) {
      // A machine is worked in the Activity; in chat this player holds or backs out.
      if (has("launch")) await press("launch");
      const o = await world.options(id);
      const wins = o.fight!.options.filter((x) => x.kind === "win" && !x.puzzle);
      const best = wins.sort((a, b) => ctx.lex.bandRank(a.band) - ctx.lex.bandRank(b.band))[0];
      await press("press", best?.id ?? "back-out");
    }
    run.encounters++;
  }
  run.toolLevel = (await tool())?.level ?? 0;
  note(
    `tool level ${run.toolLevel} after ${run.encounters} encounters; carrying ${JSON.stringify((await world.sheet(id)).character.goods)}`,
  );

  // Gather twice, keeping two units for the craft, then head home.
  await openHub();
  await press("field");
  const node = (await world.here(id)).materials.find((m) => !m.workedOut)?.material;
  if (node) {
    await press("gather", `${node}:1`);
    await waitIdle();
    await openHub();
    await press("field");
    await press("gather", `${node}:1`);
    await waitIdle();
  }
  await openHub();
  if (has("crawl")) {
    await press("crawl");
    await waitIdle();
  }
  await command("map");
  const homeKey = `${home.q},${home.r}`;
  if (
    !(await world.options(id)).at ||
    (await world.options(id)).at.q !== home.q ||
    (await world.options(id)).at.r !== home.r
  ) {
    await press("goto", undefined, homeKey);
    await waitIdle();
  }
  const at = (await world.options(id)).at;
  if (at.q !== home.q || at.r !== home.r)
    throw new Error(`the journey home stopped at ${at.q},${at.r}`);
  note(`home after ${(await world.options(id)).tick - t0} ticks`);

  // Sell to a faction order, keeping two of one material for the craft.
  await openHub();
  await press("market");
  const sheet = await world.sheet(id);
  const keep =
    node && sheet.character.goods.some((g) => g.material === node && g.units >= 2)
      ? node
      : undefined;
  const here = await world.here(id);
  const sold = new Set<string>();
  const hasSell = (m: string) =>
    card.rows.some(
      (r) =>
        "buttons" in r &&
        r.buttons.some(
          (b) => b.kind === "page" && decodeId(b.customId)?.target.startsWith(`${m}:`),
        ),
    );
  // Sell what the card offers, a button at a time: each sale redraws it.
  for (let i = 0; i < 20; i++) {
    const g = sheet.character.goods.find(
      (x) =>
        x.material !== keep &&
        !sold.has(x.material) &&
        here.orders.some((o) => o.material === x.material) &&
        hasSell(x.material),
    );
    if (!g) break;
    await press("sell", `${g.material}:${g.units}`);
    sold.add(g.material);
    run.sold += g.units;
  }
  if (keep && run.sold === 0) {
    const g = sheet.character.goods.find((x) => x.material === keep)!;
    if (g.units > 2 && here.orders.some((x) => x.material === keep)) {
      const version = (await world.options(id)).version;
      await send({ id: { action: "sell", target: `${keep}:${g.units - 2}`, version } });
      run.sold += g.units - 2;
    }
  }
  run.coin = (await world.sheet(id)).character.coin;

  // Craft a tool from what was kept.
  if (keep) {
    await openHub();
    await press("craft");
    await press("craft-p", undefined, "shape");
    await press("craft-m", undefined, "narrow-grind");
    await press("craft-s", undefined, "tool");
    await press("craft-i", undefined, keep);
    await press("craft-q");
    if (has("craft-go")) {
      const name = card.title;
      await press("craft-go");
      if (card.author.startsWith("First discovery") || card.title === "Made") run.crafted = name;
      else note(`the craft was refused: ${card.title}`);
    }
  }

  // The market's lists once each, an order posted and withdrawn, and the forum.
  await command("market");
  for (const { id } of [...LISTS.filter((l) => l.id !== "book"), LISTS[0]!])
    await press("mkt-l", undefined, id);
  if (has("mkt-o")) {
    await press("mkt-o");
    await press(
      "mkt-os",
      undefined,
      card.rows.flatMap((r) => ("select" in r ? r.select.options : []))[0]!.value,
    );
    await press("mkt-post");
    if (has("withdraw")) await press("withdraw");
  }
  await world.forum();

  // The notice board: a vow posted through the form, opened, and withdrawn.
  await command("goals");
  if (has("g-drafts")) await press("g-drafts");
  await command("goals");
  await press("g-form");
  await press("g-target");
  await press("g-page");
  await press("g-reward", undefined, optionWith(".0.fexc"));
  const title = "A scripted vow";
  await submit("g-name", { title, note: "Posted by the scripted client." });
  if (card.title.startsWith("Posted")) run.posted = title;
  else note(`the goal was refused: ${card.title}`);
  await world.board();
  if (has("goal")) {
    const mine = card.rows
      .flatMap((r) => ("select" in r ? r.select.options : []))
      .find((x) => x.label === title);
    await press("goal", undefined, mine?.value);
    if (has("g-wd")) {
      await press("g-wd");
      run.withdrawn = card.title.startsWith("Withdrawn");
    }
  }

  // The guild: the server's own takes a new character in; each page once.
  await command("guild");
  // Founding is also offered to a server guild's member: only one with no
  // guild founds, under a lettered name (the card check reads any number
  // as an amount).
  if (has("gld-name") && !(await world.guild(id)).name) {
    const tag = [...String(seq)].map((d) => "abcdefghij"[Number(d)]).join("");
    await submit("gld-name", { name: `Scripted ${tag}` });
  }
  run.guild = card.author;
  for (const page of ["places", "works", "bank"]) if (has("guild")) await press("guild", page);
  if (has("gld-give")) {
    await press("gld-give");
    if (has("gld-dep")) await press("gld-dep");
  }
  if (has("guild")) await press("guild", "members");

  // Every other card once.
  await command("character");
  await press("classes");
  if (has("classes")) await press("classes");
  await command("character");
  if (has("item")) await press("item");
  if (has("list")) await press("list");
  await command("recipes");
  await command("map");
  await press("why", "moves");
  await openHub();
  await press("chronicle");
  await press("recap");
  await openHub();
  await press("where");
  if (has("talk")) {
    await press("talk");
    if (has("choose")) await press("choose");
  }
  // The tinker's bench: its line on the place card, and the tinker's own card.
  await openHub();
  await press("where");
  if (has("launch")) {
    await press("launch");
    const tinker = (await world.here(id)).people.find((p) => p.role === "tinker");
    if (tinker && has("talk", tinker.id)) {
      await press("talk", tinker.id);
      if (has("launch")) await press("launch");
    }
  }

  if (opts.season) await backASide();

  run.ticks = (await world.options(id)).tick - t0;
  if (opts.operator) {
    const res = await fetch(`${opts.operator.url}/v1/operator/audit`, {
      headers: { authorization: `Bearer ${opts.operator.token}` },
    });
    run.audit = ((await res.json()) as api.Audit).discrepancies ?? [];
  }
  return run;
}

/** An operator request, as the scripted runs send one. */
function operate(op: { url: string; token: string }, req: api.OperatorRequest): Promise<Response> {
  return fetch(`${op.url}${api.PathOperator}`, {
    method: "POST",
    headers: { authorization: `Bearer ${op.token}`, "content-type": "application/json" },
    body: JSON.stringify(req),
  });
}

/** What the two-player party run did. */
export interface PartyRun {
  presses: number;
  cards: number;
  problems: string[];
  /** The party formed, by id. */
  party: string;
  /** Cards the party's thread was given: opened, edited, posted to and closed. */
  thread: string[];
  /** Beats resolved together, and the encounters they made up. */
  beats: number;
  encounters: number;
  /** The game channel's hunt cards, by title. */
  hunts: string[];
  ended: boolean;
  log: string[];
}

/** What every scripted run counts of the cards it was shown. */
interface Counted {
  presses: number;
  cards: number;
  problems: string[];
}

/** The server a scripted member presses from, the flags Discord gives it there, and the lists its settings card shows. */
type Member = Pick<Press, "guild" | "guildName" | "admin" | "staff" | "channels" | "roles">;

/** One scripted player pressing only what the bot's cards offer. */
class Player {
  card!: Card;
  id = "";
  private seq = 0;

  constructor(
    private readonly ctx: Ctx,
    readonly user: string,
    private readonly run: Counted,
    private readonly names: Set<string>,
    private readonly onAnswer: (a: Answer) => Promise<void>,
    private readonly as: Member = { guild: "scripted" },
  ) {}

  async send(
    p: Omit<Press, "user" | "interaction" | "guild" | "channel" | keyof Member>,
  ): Promise<Card> {
    this.run.presses++;
    const a = await answer(this.ctx, {
      ...p,
      ...this.as,
      user: this.user,
      channel: "scripted-channel",
      interaction: `scripted-${this.user}-${++this.seq}`,
    });
    this.run.cards++;
    for (const x of problems(a.card, this.names)) this.run.problems.push(`${a.card.author}: ${x}`);
    await this.onAnswer(a);
    this.card = a.card;
    return a.card;
  }

  command(name: string) {
    return this.send({ command: name });
  }

  /** /play, and on past since-you-left to the hub when it shows first. */
  async hub(): Promise<Card> {
    await this.command("play");
    if (this.card.author.startsWith("Chronicle")) await this.press("hub");
    return this.card;
  }

  /** The live ids on the card whose action (and target, if given) matches. */
  ids(action: string, target?: string): Id[] {
    const out: Id[] = [];
    for (const r of this.card.rows) {
      if ("select" in r) {
        const id = decodeId(r.select.customId);
        if (id && offers(r.select, action, target)) out.push(id);
        continue;
      }
      for (const b of r.buttons) {
        if (b.kind !== "page" || b.disabled) continue;
        const id = decodeId(b.customId);
        if (id?.action === action && (target === undefined || id.target === target)) out.push(id);
      }
    }
    return out;
  }

  has(action: string, target?: string) {
    return this.ids(action, target).length > 0;
  }

  /** The first option of the card's select for action. */
  first(action: string): string | undefined {
    for (const r of this.card.rows)
      if ("select" in r && decodeId(r.select.customId)?.action === action)
        return r.select.options[0]?.value;
    return undefined;
  }

  async press(action: string, target?: string, value?: string): Promise<Card> {
    const id = this.ids(action, target)[0];
    if (!id)
      throw new Error(`${this.user}: no "${action}" on "${this.card.author} / ${this.card.title}"`);
    // A select's id carries no target; the target is its pick.
    const pick = value ?? (target !== undefined && id.target !== target ? target : undefined);
    return this.send({ id, values: pick === undefined ? undefined : [pick] });
  }

  async idle(world: World) {
    for (;;) {
      const o = await world.options(this.id);
      if (!o.long) return o;
      await Bun.sleep(500);
    }
  }
}

/**
 * Two scripted players through a party (GDD 7.5), from /party to leaving
 * it, against a thread sink that keeps its cards; with an operator token
 * a hunt is opened beside them for the game channel's card.
 */
export async function partyRun(
  ctx: Ctx,
  opts: { operator?: { url: string; token: string }; users?: [string, string] } = {},
): Promise<PartyRun> {
  const world = ctx.world;
  const names = ctx.lex.goodsNames();
  const stamp = Date.now();
  const run: PartyRun = {
    presses: 0,
    cards: 0,
    problems: [],
    party: "",
    thread: [],
    beats: 0,
    encounters: 0,
    hunts: [],
    ended: false,
    log: [],
  };
  const note = (s: string) => run.log.push(s);
  const checked = (c: Card) => {
    run.thread.push(`${c.author} / ${c.title}`);
    for (const x of problems(c, names)) run.problems.push(`thread ${c.author}: ${x}`);
  };
  const threads = new PartyPoster(
    world,
    ctx.lex,
    memoryStore(),
    {
      open: async (_ch, _name, c) => (
        checked(c), { thread: "scripted-thread", card: "scripted-card" }
      ),
      add: async () => true,
      edit: async (_t, _m, c) => (checked(c), true),
      post: async (_t, c) => (checked(c), true),
      archive: async () => {},
    },
    new ThreadBudget(),
    { editMs: 0 },
  );
  const onAnswer = async (a: Answer) => {
    if (a.party) await threads.note(a.party);
  };
  const [ua, ub] = opts.users ?? [`party-a-${stamp}`, `party-b-${stamp}`];
  const a = new Player(ctx, ua, run, names, onAnswer);
  const b = new Player(ctx, ub, run, names, onAnswer);
  for (const p of [a, b]) {
    await p.command("play");
    await p.press("start", "knife");
    p.id = await world.player(p.user);
  }
  note(`${a.id} and ${b.id} at ${JSON.stringify((await world.options(a.id)).at)}`);

  // Forming: an invitation from /party, accepted from the other's party card.
  await a.command("party");
  await a.press("p-invite", undefined, b.id);
  await b.command("party");
  await b.press("p-join", a.id);
  const st = await world.party(a.id);
  run.party = st.party?.id ?? "";
  if (!run.party) throw new Error(`no party formed: ${b.card.title}`);
  note(`party ${run.party} of ${st.party!.members.length}`);

  // Out to the suggested site together, the second following the first.
  await b.command("party");
  if (b.has("p-follow")) await b.press("p-follow");
  for (let i = 0; i < 8; i++) {
    const here = await world.here(a.id);
    if (here.place.explore) break;
    if (!here.suggest) throw new Error("no outing is suggested");
    await a.command("map");
    await a.press("step", String(here.suggest.dir));
    await a.idle(world);
    await b.idle(world);
  }
  const [at, bt] = [(await world.options(a.id)).at, (await world.options(b.id)).at];
  if (at.q !== bt.q || at.r !== bt.r) {
    note("the follower dropped off; walking to the leader");
    await b.command("map");
    await b.send({
      id: { action: "goto", target: "", version: (await world.options(b.id)).version },
      values: [`${at.q},${at.r}`],
    });
    await b.idle(world);
  }

  // Explore together: one shared encounter, each member picking on its own card.
  for (let n = 0; n < 6 && run.encounters < 2; n++) {
    await a.hub();
    if (a.card.author.startsWith("Down")) break;
    await a.press("field");
    if (!a.has("explore")) break;
    await a.press("explore");
    if (!a.card.author.startsWith("Party beat")) {
      // The other is down or busy: this one is the leader's alone, and it backs out.
      note(`explore was not shared: ${a.card.author}`);
      if (a.has("press", "back-out")) await a.press("press", "back-out");
      break;
    }
    for (let beat = 0; beat < 12; beat++) {
      let resolved = false;
      for (const p of [a, b]) {
        await p.send({ id: { action: "p-card", target: run.party, version: 0 } });
        if (!p.has("p-pick")) continue;
        const o = await world.options(p.id);
        const wins = (o.fight?.options ?? []).filter((x) => x.kind === "win" && !x.puzzle);
        const best = wins.sort((x, y) => ctx.lex.bandRank(x.band) - ctx.lex.bandRank(y.band))[0];
        await p.press("p-pick", best?.id ?? "hold");
        if (p.card.author.includes("resolved") || p.card.author.includes("the bottom"))
          resolved = true;
      }
      if (resolved) run.beats++;
      if (!(await world.options(a.id)).fight && !(await world.options(b.id)).fight) break;
    }
    run.encounters++;
    await threads.poll();
  }

  // A hunt beside them, for the game channel's card.
  if (opts.operator) {
    const here = (await world.options(a.id)).at;
    const res = await operate(opts.operator, {
      interactionId: `scripted-hunt-${stamp}`,
      characterId: "",
      kind: api.OpHuntStart,
      asset: "dust-runner-migration",
      to: here,
      note: "The scripted party run.",
    });
    if (!res.ok) note(`hunt-start refused: ${await res.text()}`);
    const hunts = new HuntPoster(world, ctx.lex, memoryStore(), {
      post: async (c) => {
        run.hunts.push(c.title);
        for (const x of problems(c, names)) run.problems.push(`hunt ${c.author}: ${x}`);
        return "scripted-hunt-card";
      },
      edit: async () => true,
    });
    await hunts.poll();
    await a.hub();
    if (a.has("hunt")) await a.press("hunt");
  }

  // Leaving a party of two ends it, and its thread closes.
  await a.command("party");
  await a.press("p-leave");
  const board = await world.parties();
  const left = board.parties.find((p) => p.id === run.party);
  run.ended = !left || !!left.ended;
  await threads.poll();
  return run;
}

/** What the crime walk did (GDD 4.5, 6.5, 12.9). */
export interface CrimeRun extends Counted {
  /** "manual" when the operator sets the world's clock, "wall" when it keeps time. */
  clock: string;
  /** World days the walk spent stealing and fencing until the invitation. */
  days: number;
  /** Thefts begun from the picker, and those seen, caught or come to nothing. */
  thefts: number;
  seen: number;
  caught: number;
  empty: number;
  /** Coin the fences paid, and the syndicate standing the walk had when invited. */
  fenced: number;
  standing: number;
  /** The tick the invitation was cast at, -1 for never. */
  invited: number;
  made: boolean;
  /** The watch's fine paid and its run made at the gate. */
  paid: boolean;
  fled: boolean;
  /** The informer cast, and the fence named to the watch. */
  informer: boolean;
  informed: boolean;
  /** The betrayal's grudge held, and the character no longer made. */
  betrayed: boolean;
  unmade: boolean;
  /** How a syndicate NPC holds the character after the betrayal, and whether it only turned it away. */
  syndicateMood: string;
  turnedAway: boolean;
  alignment: number;
  band: string;
  audit: string[];
  log: string[];
}

/** The act kinds the crime walk records for the fixtures, latest accepted reply of each. */
export const CRIME_ACTS = [api.ActSteal, api.ActFence, api.ActPayFine, api.ActFlee] as const;

// structural: the ledger's prefix for a material, the material and recipe
// the walk shapes its tools from, the topics and choices it answers, and how
// far it goes.
const MATERIAL_ASSET = "mat:";
const THIEF_START = "hook";
const UPRIGHT = "upright";
const TOOL = { process: "shape", method: "narrow-grind", slot: "tool", material: "bog-iron" };
const THEFT_ENDED = "Theft · how it ended";
const TOPIC_INVITATION = "the-invitation";
const TOPIC_INFORMER = "the-informer";
const TOPIC_TURNED_AWAY = "turned-away";
const TAKE_THE_JOB = "take-the-job";
const NAME_THE_FENCE = "name-the-fence";
const ROLE_TRADER = "-settlement-trader-";
const ROLE_WATCH = "-settlement-watch-";
const CRIME_DAYS = 60;
const SOLD_A_DAY = 8;
const LIFTS_A_DAY = 8;
const HOURS_WAITED = 24;
const CAPITAL = 120;

/** The world's clock as a run waits on it: the operator's when the world keeps a manual one, else wall time. */
async function worldClock(op: { url: string; token: string }, world: World, id: string) {
  const tick = async () => (await world.options(id)).tick;
  const set = (due: number) =>
    fetch(`${op.url}${api.PathOperatorClock}`, {
      method: "POST",
      headers: { authorization: `Bearer ${op.token}`, "content-type": "application/json" },
      body: JSON.stringify({ due } satisfies api.ClockRequest),
    });
  const manual = (await set(await tick())).ok;
  const until = async (to: number) => {
    if (manual) await set(to);
    while ((await tick()) < to) await Bun.sleep(manual ? 100 : 1_000);
  };
  return {
    manual,
    tick,
    until,
    pass: async (ticks: number) => until((await tick()) + ticks),
    /** On past the next world day's turn, when orders and the trader's coin are new. */
    nextDay: async () =>
      until((Math.floor((await tick()) / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + 1),
  };
}

/** A World that also keeps the latest accepted reply of each crime act, for the fixtures. */
function keepingCrimeActs(world: World, kept: Record<string, unknown>): World {
  const kinds = new Set<string>(CRIME_ACTS);
  return {
    ...world,
    act: async (req) => {
      const r = await world.act(req);
      if (r.ok && kinds.has(req.kind)) kept[`act:${req.kind}`] = r;
      return r;
    },
  };
}

/**
 * The crime walk: one character from its first theft to the syndicate's
 * grudge, pressing only what the cards offer. The operator only sets a
 * manual clock and stocks material and a little coin; every haul is real stock.
 */
export async function crimeRun(
  ctx: Ctx,
  opts: { operator: { url: string; token: string }; user?: string; keep?: Record<string, unknown> },
): Promise<CrimeRun> {
  const world = opts.keep ? keepingCrimeActs(ctx.world, opts.keep) : ctx.world;
  const c: Ctx = { ...ctx, world };
  const op = opts.operator;
  const names = ctx.lex.goodsNames();
  const run: CrimeRun = {
    presses: 0,
    cards: 0,
    problems: [],
    clock: "",
    days: 0,
    thefts: 0,
    seen: 0,
    caught: 0,
    empty: 0,
    fenced: 0,
    standing: 0,
    invited: -1,
    made: false,
    paid: false,
    fled: false,
    informer: false,
    informed: false,
    betrayed: false,
    unmade: false,
    syndicateMood: "",
    turnedAway: false,
    alignment: 0,
    band: "",
    audit: [],
    log: [],
  };
  const note = (s: string) => run.log.push(s);
  const p = new Player(c, opts.user ?? `crime-${Date.now()}`, run, names, async () => {});
  await p.command("play");
  // The hook leads with Flex, which a lift's palm is pressed with.
  await p.press("start", THIEF_START);
  const id = (p.id = await world.player(p.user));
  const clock = await worldClock(op, world, id);
  run.clock = clock.manual ? "manual" : "wall";
  let ops = 0;
  const correct = async (asset: string, units: number) => {
    const res = await operate(op, {
      interactionId: `crime-${id}-${++ops}`,
      characterId: id,
      kind: api.OpCorrect,
      asset,
      units,
      note: "The scripted crime run's stock.",
    });
    if (!res.ok) throw new Error(`the correction of ${asset} was refused: ${await res.text()}`);
  };
  const sheet = () => world.sheet(id);
  const coin = async () => (await sheet()).character.coin;
  const standing = async () =>
    (await sheet()).standing.find((s) => s.with === syndicateName(ctx.lex))?.value ?? 0;
  const idle = async () => {
    for (let i = 0; i < 400 && (await world.options(id)).long; i++) await clock.pass(1);
  };
  const hub = async () => {
    await p.command("play");
    if (p.card.author.startsWith("Chronicle")) await p.press("hub");
    if (p.card.author === "Down") {
      await p.press("crawl");
      await idle();
      await hub();
    }
  };
  /** The value of the select option for action whose value passes ok. */
  const optionFor = (action: string, ok: (v: string) => boolean) =>
    p.card.rows
      .flatMap((r) =>
        "select" in r && decodeId(r.select.customId)?.action === action ? r.select.options : [],
      )
      .find((o) => ok(o.value))?.value;
  /** Presses the best win to the end, backing out of a caught theft before a second failure. */
  const fightOut = async () => {
    for (let i = 0; i < 12 && p.has("press"); i++) {
      const o = await world.options(id);
      const wins = (o.fight?.options ?? []).filter((x) => x.kind === "win" && !x.puzzle);
      const best = wins.sort((a, b) => ctx.lex.bandRank(a.band) - ctx.lex.bandRank(b.band))[0];
      const caught = o.fight?.theft?.caught && !isFlight(o.fight.theft);
      await p.press("press", caught || !best ? "back-out" : best.id);
    }
  };

  // The world day turns before the market opens.
  await clock.nextDay();
  const home = (await world.options(id)).at;
  const people = async () => (await world.here(id)).people;
  const trader = (await people()).find((x) => x.id.includes(ROLE_TRADER));
  if (!trader) throw new Error("no trader stands in the home settlement");
  note(`home ${home.q},${home.r}; the trader ${trader.id} leans ${trader.leaning || "none"}`);
  // Robbed and facing a notorious thief, an upright trader turns hostile and
  // buys nothing more, and a lone world has no other stock to lift.
  if (trader.leaning === UPRIGHT)
    throw new Error("the home trader leans upright: run the walk on another world");
  await correct("coin", CAPITAL);

  /** Mends the hand's weapon at the forge once it is a third worn. */
  const mend = async () => {
    const hand = (await sheet()).kit.find((i) => i.worn === "hand");
    if (!hand || (hand.durability * 3 >= hand.max && !hand.dormant)) return;
    const cost = (await world.options(id)).purse.hand?.repair;
    if (cost?.material && cost.units) await correct(MATERIAL_ASSET + cost.material, cost.units);
    await p.command("character");
    await p.press("item", undefined, hand.id);
    if (p.has("repair", hand.id)) await p.press("repair", hand.id);
  };
  /**
   * Hands coin above CAPITAL back to the operator, so a lone character's
   * earnings don't fill the faucet's band and close the day's budget.
   */
  const spend = async () => {
    const over = (await coin()) - CAPITAL;
    if (over > 0) await correct("coin", -over);
  };
  const clean = async () => {
    const s = await sheet();
    const hot = new Set((s.character.hot ?? []).map((h) => h.item));
    return [...s.kit, ...s.pack].filter(
      (i) => !i.worn && !i.mount && !hot.has(i.id) && i.name.endsWith(" tool"),
    );
  };
  const hotTools = async () => ((await sheet()).character.hot ?? []).filter((h) => h.item);
  const shapeTool = async () => {
    const have = (await sheet()).character.goods.find((g) => g.material === TOOL.material);
    if ((have?.units ?? 0) < 2) await correct(MATERIAL_ASSET + TOOL.material, 2);
    await hub();
    await p.press("craft");
    await p.press("craft-p", undefined, TOOL.process);
    await p.press("craft-m", undefined, TOOL.method);
    await p.press("craft-s", undefined, TOOL.slot);
    await p.press("craft-i", undefined, TOOL.material);
    await p.press("craft-q");
    if (p.has("craft-go")) await p.press("craft-go");
  };
  const sell = async (item: string) => {
    await p.command("character");
    await p.press("item", undefined, item);
    if (!p.has("sell-item", item)) return false;
    const before = await coin();
    await p.press("sell-item", item);
    return (await coin()) > before;
  };
  /** Opens the where card once the one wanted is here, waiting up to HOURS_WAITED hours. */
  const whereWith = async (who: (x: api.Person) => boolean) => {
    for (let h = 0; h < HOURS_WAITED; h++) {
      if ((await people()).some(who)) break;
      await clock.pass(TICKS_PER_HOUR);
    }
    await hub();
    await p.press("where");
  };
  const lift = async (): Promise<boolean> => {
    await whereWith((x) => x.id === trader.id);
    if (!p.has("steal")) return false;
    await p.press("steal");
    const pick = optionFor("steal", (v) => v.startsWith(`${api.TheftLift}/${trader.id}/`));
    if (!pick) return false;
    await p.press("steal", undefined, pick);
    if (!p.has("press")) {
      note(`the lift did not begin: ${p.card.title}`);
      return false;
    }
    await fightOut();
    if (p.card.author !== THEFT_ENDED) {
      note(`the lift ended on "${p.card.author} / ${p.card.title}"`);
      return false;
    }
    run.thefts++;
    if (p.card.title === "Seen, and wanted") run.seen++;
    else if (p.card.title === "Caught in the act") run.caught++;
    else if (p.card.title === "Nothing left to take") run.empty++;
    return true;
  };
  const talkTo = async (who: (x: api.Person) => boolean) => {
    await whereWith(who);
    const n = (await people()).find(who);
    if (!n) return undefined;
    if (p.has("talk", n.id)) await p.press("talk", n.id);
    else {
      // The where card has Talk for its first few people only; the rest
      // are pressed as their button would be.
      if (!unbuttoned.has(n.id)) note(`no Talk button for ${n.id}: pressed as its button`);
      unbuttoned.add(n.id);
      await p.send({
        id: { action: "talk", target: n.id, version: (await world.options(id)).version },
      });
    }
    return n.id;
  };
  const unbuttoned = new Set<string>();
  const isFence = (x: api.Person) => !!x.fence;
  const fenceAll = async () => {
    if (!(await hotTools()).length || !(await talkTo(isFence))) return;
    for (let i = 0; i < SOLD_A_DAY && p.has("fence"); i++) {
      const before = await coin();
      await p.press("fence");
      const paid = (await coin()) - before;
      if (paid <= 0) break;
      run.fenced += paid;
    }
  };
  /** Steps off the settlement and back, so the watch at its gate stops a wanted character. */
  const backThroughTheGate = async () => {
    const o = await world.options(id);
    const out = o.moves.find((m) => m.open);
    if (!out) return false;
    await p.command("map");
    await p.press("step", String(out.dir));
    await idle();
    if ((await world.options(id)).fight) await fightOut();
    const back = (await world.options(id)).moves.find(
      (m) => m.open && m.to.q === home.q && m.to.r === home.r,
    );
    if (!back) return false;
    await p.command("map");
    await p.press("step", String(back.dir));
    await idle();
    await hub();
    return p.has("pay-fine") || p.has("flee");
  };
  const atTheGate = async () => {
    if (!(await sheet()).character.wanted?.length || (run.paid && run.fled)) return;
    if (!(await backThroughTheGate())) return;
    const fine = (await sheet()).character.stopped;
    if (!run.paid && fine?.canPay) {
      await p.press("pay-fine");
      run.paid = !(await sheet()).character.stopped;
    } else {
      await p.press("flee");
      await fightOut();
      run.fled = !(await sheet()).character.stopped;
    }
    await hub();
  };
  const arc = async (template: string) =>
    (await world.arcs(id)).open.find((a) => a.template === template && !a.outcome);

  // Steal, fence and sell until the syndicate's invitation is cast.
  for (let day = 0; day < CRIME_DAYS && !(await arc(TOPIC_INVITATION)); day++) {
    run.days = day + 1;
    await fenceAll();
    for (let i = 0; i < SOLD_A_DAY; i++) {
      if (!(await clean()).length) await shapeTool();
      const tool = (await clean())[0];
      if (!tool || !(await sell(tool.id))) break;
    }
    for (let i = 0; i < LIFTS_A_DAY; i++) {
      await mend();
      if (!(await lift())) break;
    }
    await fenceAll();
    await atTheGate();
    await spend();
    const s = await sheet();
    note(
      `day ${Math.floor((await clock.tick()) / TICKS_PER_DAY)}: ${run.thefts} thefts, ${run.fenced} coin fenced, standing ${await standing()}, ${s.character.alignment.band} ${s.character.alignment.value}`,
    );
    await clock.nextDay();
  }
  const invitation = await arc(TOPIC_INVITATION);
  run.standing = await standing();
  if (!invitation) {
    note("the invitation was never cast");
    return finish();
  }
  run.invited = invitation.began;

  // The invitation is answered at the fence it casts.
  await openStage(invitation.id);
  const fence = await talkTo(isFence);
  if (!fence) throw new Error("the invited character finds no fence to answer");
  await p.press("choose", `${fence}/${TOPIC_INVITATION}/${TAKE_THE_JOB}`);
  await clock.pass(2);
  run.made = (await sheet()).character.alignment.made;
  note(`invited at standing ${run.standing}; made ${run.made}`);

  // Made, it meets the watch captain until the informer is cast, and names the fence.
  const isCaptain = (x: api.Person) => x.id.includes(ROLE_WATCH);
  let informer = await arc(TOPIC_INFORMER);
  for (let day = 0; day < CRIME_DAYS && run.made && !informer; day++) {
    await talkTo(isCaptain);
    await clock.nextDay();
    informer = await arc(TOPIC_INFORMER);
  }
  run.informer = !!informer;
  if (informer) {
    const captain = await talkTo(isCaptain);
    if (captain) await p.press("choose", `${captain}/${TOPIC_INFORMER}/${NAME_THE_FENCE}`);
    await clock.pass(2);
    const after = await world.arcs(id);
    run.informed = after.ended.some((a) => a.id === informer!.id && a.outcome === NAME_THE_FENCE);
    const s = await sheet();
    run.betrayed = s.grudges.some((g) => g.with === SYNDICATE);
    run.unmade = !s.character.alignment.made;
  }

  // The syndicate holds the grudge: its fence turns the character away.
  const syn = await talkTo(isFence);
  if (syn) {
    const conv = await world.npc(id, syn);
    if (conv.ok) {
      run.syndicateMood = conv.reply.npc.mood ?? "";
      run.turnedAway =
        conv.reply.topics.length > 0 && conv.reply.topics.every((t) => t.id === TOPIC_TURNED_AWAY);
    }
  } else note("no syndicate NPC stands here after the betrayal: the den moved on");
  return finish();

  /** The thread's stage card, from the chronicle's select of arcs. */
  async function openStage(arcId: string) {
    await p.command("chronicle");
    if (optionFor("arc", (v) => v === arcId)) await p.press("arc", undefined, arcId);
    else note(`the chronicle offers no stage card for ${arcId}`);
  }
  async function finish(): Promise<CrimeRun> {
    const s = await world.sheet(id);
    run.alignment = s.character.alignment.value;
    run.band = s.character.alignment.band;
    const res = await fetch(`${op.url}${api.PathOperatorAudit}`, {
      headers: { authorization: `Bearer ${op.token}` },
    });
    run.audit = ((await res.json()) as api.Audit).discrepancies ?? [];
    return run;
  }
}

/** A staging as the house walk read it back from its server's house. */
export interface StagedRead {
  id: string;
  template: string;
  by: string;
  points: number;
  open: boolean;
}

/** A row of a server's public log, as the walk read it. */
export interface LoggedRow {
  role: string;
  kind: string;
  what: string;
  points: number;
}

/** What the house walk did (GDD 14.1 to 14.5): members of two servers on one world. */
export interface HouseRun extends Counted {
  servers: [string, string];
  characters: { admin: string; staff: string; player: string; other: string };
  /** What a member of A with neither flag was shown for /admin and /staff. */
  noConsole: string[];
  /** Whether either of those cards offered staging. */
  unflaggedStaged: boolean;
  /** The console's answer to the admin's staging, then the staff member's. */
  staged: string[];
  /** A's stages as its house lists them after both stagings. */
  stages: StagedRead[];
  /** The pool of A's settlement at each step, and what the staff template costs from it. */
  pool: {
    before: number;
    afterAdmin: number;
    afterStaff: number;
    afterRefused: number;
    points: number;
  };
  /** B's staff pressing A's staging: the bot's answer, whether it wrote, and the world's refusal of the same order. */
  refused: { card: string; wrote: boolean; code: string };
  /** The crate A's player opened: the card once opened, and the staged goods its sheet then carries. */
  crate: { title: string; text: string; staged: string[] };
  houseLog: LoggedRow[];
  otherLog: number;
  audit: string[];
  log: string[];
}

// structural: the templates the walk stages, how many times it presses on
// towards the drop before giving up, and how long it waits on a long action.
const HOUSE_DROP = "drop-large";
const HOUSE_HUNT = "hunt-2";
const HOUSE_HUNT_TIER = 2;
const WALK_TRIES = 40;
const IDLE_POLLS = 1_200;
const IDLE_POLL_MS = 500;

/** A World that also keeps each write's kind, server, character and refusal code. */
function keepingWrites(
  world: World,
  kept: { kind: string; server?: string; character: string; code: string }[],
): World {
  return {
    ...world,
    act: async (req) => {
      const r = await world.act(req);
      kept.push({
        kind: req.kind,
        server: req.server,
        character: req.characterId ?? "",
        code: r.ok ? "" : r.refusal.code,
      });
      return r;
    },
  };
}

/** Why a house walk does not hold, one line each; empty when it holds. */
export function houseMisses(r: HouseRun): string[] {
  const out: string[] = [];
  const miss = (bad: boolean, why: string) => bad && out.push(why);
  miss(r.problems.length > 0, `${r.problems.length} card problems`);
  miss(r.unflaggedStaged, "a member with neither flag was offered staging");
  const drop = r.stages.find((s) => s.template === HOUSE_DROP);
  const hunt = r.stages.find((s) => s.template !== HOUSE_DROP);
  miss(!drop || drop.by !== "admins" || drop.points !== 0, "no free drop staged by the admins");
  miss(
    !hunt || hunt.by !== "staff" || hunt.points !== r.pool.points,
    "no tier 2 hunt staged by staff at its price",
  );
  miss(r.pool.afterAdmin !== r.pool.before, "the admin's staging moved the pool");
  miss(
    r.pool.afterStaff !== r.pool.afterAdmin - r.pool.points,
    `the staff staging took ${r.pool.afterAdmin - r.pool.afterStaff} event points, not ${r.pool.points}`,
  );
  miss(r.pool.afterRefused !== r.pool.afterStaff, "the refused staging moved the pool");
  miss(r.refused.wrote, "the bot sent server B's staging of server A's settlement");
  miss(r.refused.code !== api.CodeHouseScope, `the world answered B's staging "${r.refused.code}"`);
  miss(!r.crate.text.includes("staged · local to"), "the opened crate shows no staged tag");
  miss(r.crate.staged.length === 0, "the player carries no staged goods after the crate");
  const roles = r.houseLog.map((x) => x.role).sort();
  miss(
    r.houseLog.length !== 2 || roles.join() !== "admin,staff",
    `server A's log has ${r.houseLog.length} rows (${roles.join(", ")}), not an admin's and a staff member's`,
  );
  const paid = r.houseLog.find((x) => x.role === "staff");
  miss(
    !!paid && paid.points !== r.pool.points,
    "the staff row of the log carries the wrong points",
  );
  miss(r.otherLog !== 0, `server B's log has ${r.otherLog} rows after a refused staging`);
  miss(r.audit.length > 0, `the audit found ${r.audit.length} discrepancies`);
  return out;
}

/**
 * The house walk: on one world, an admin and a staff member of server A
 * stage a drop and a tier 2 hunt through the consoles, staff of server B
 * pressing the same staging is refused by the bot and by the world, a
 * player of A walks to the drop and opens a crate, and A's log holds one
 * row for each staging. Every press goes through the bot's pure flow.
 */
export async function houseRun(
  ctx: Ctx,
  opts: {
    operator?: { url: string; token: string };
    servers?: [string, string];
    /** Waits a tick of the world's; by default the operator's clock, else a short sleep. */
    pass?: () => Promise<void>;
  } = {},
): Promise<HouseRun> {
  const writes: { kind: string; server?: string; character: string; code: string }[] = [];
  const world = keepingWrites(ctx.world, writes);
  const c: Ctx = { ...ctx, world };
  const names = ctx.lex.goodsNames();
  const stamp = Date.now();
  const [A, B] = opts.servers ?? [`house-a-${stamp}`, `house-b-${stamp}`];
  const run: HouseRun = {
    presses: 0,
    cards: 0,
    problems: [],
    servers: [A, B],
    characters: { admin: "", staff: "", player: "", other: "" },
    noConsole: [],
    unflaggedStaged: false,
    staged: [],
    stages: [],
    pool: { before: 0, afterAdmin: 0, afterStaff: 0, afterRefused: 0, points: 0 },
    refused: { card: "", wrote: false, code: "" },
    crate: { title: "", text: "", staged: [] },
    houseLog: [],
    otherLog: 0,
    audit: [],
    log: [],
  };
  const note = (s: string) => run.log.push(s);
  let pass = opts.pass;
  const member = (user: string, as: Member) =>
    new Player(c, `${user}-${stamp}`, run, names, async () => {}, as);
  const admin = member("house-admin", { guild: A, guildName: "Scripted Crew", admin: true });
  const staff = member("house-staff", { guild: A, staff: true });
  const player = member("house-player", { guild: A });
  const other = member("house-other", { guild: B, guildName: "Far Crew", staff: true });
  for (const p of [admin, staff, player, other]) {
    await p.command("play");
    await p.press("start", "knife");
    p.id = await world.player(p.user);
    if (!p.id) throw new Error(`${p.user} made no character: ${p.card.title}`);
  }
  run.characters = { admin: admin.id, staff: staff.id, player: player.id, other: other.id };

  const readHouse = async (
    server: string,
    who: Player,
    flags: { admin?: boolean; staff?: boolean },
  ) => {
    if (!world.house) throw new Error("the world serves no house");
    const r = await world.house(server, who.id, flags);
    if (!r.ok) throw new Error(`the house of ${server}: ${r.refusal.message}`);
    return r.reply;
  };
  const first = await readHouse(A, admin, { admin: true });
  const home = first.settlements[0];
  if (!home) throw new Error(`server ${A} runs no settlement yet: run the walk on a fresh world`);
  const pool = async () =>
    (await readHouse(A, staff, { staff: true })).settlements.find((s) => s.n === home.n)?.pool ??
    -1;
  const huntTemplate =
    first.templates.find((t) => t.id === HOUSE_HUNT) ??
    first.templates.find((t) => t.kind === "hunt" && t.tier === HOUSE_HUNT_TIER && t.staff);
  if (!huntTemplate) throw new Error("no tier 2 hunt template a staff member may stage");
  run.pool.before = await pool();
  run.pool.points = huntTemplate.points;
  note(
    `server ${A} runs ${home.name} (settlement ${home.n}), pool ${run.pool.before} of ${home.poolCap}`,
  );

  // A member with neither flag gets no console.
  for (const name of ["admin", "staff"]) {
    await player.command(name);
    run.noConsole.push(player.card.title);
    run.unflaggedStaged ||= player.has("hs-stage") || player.has("hs-go");
  }

  /** Stages a template from a console: the template, its creature, the first site, then Stage it. */
  const stage = async (p: Player, role: "admin" | "staff", template: string): Promise<Id> => {
    await p.command(role);
    await p.press("hs-stage");
    await p.press("hs-tpl", undefined, template);
    if (p.has("hs-set")) await p.press("hs-set", undefined, String(home.n));
    if (p.has("hs-what")) await p.press("hs-what", undefined, p.first("hs-what"));
    if (p.has("hs-site")) await p.press("hs-site", undefined, p.first("hs-site"));
    const go = p.ids("hs-go")[0];
    if (!go) throw new Error(`${role}: the staging form will not send: ${p.card.description}`);
    await p.send({ id: go });
    run.staged.push(p.card.title);
    return go;
  };
  await stage(admin, "admin", HOUSE_DROP);
  run.pool.afterAdmin = await pool();
  const staffGo = await stage(staff, "staff", huntTemplate.id);
  run.pool.afterStaff = await pool();

  // Staff of B press A's staging: the bot sends nothing, and the world refuses the order itself.
  await other.command("staff");
  const before = writes.length;
  await other.send({ id: staffGo });
  run.refused.card = other.card.description ?? other.card.title;
  run.refused.wrote = writes.slice(before).some((w) => w.kind === api.ActStage);
  const lived = await readHouse(A, staff, { staff: true });
  const site = lived.stages.find((s) => s.template === huntTemplate.id)?.at ?? home.sites[0]?.at;
  if (!site) throw new Error(`${home.name} has no site to stage at`);
  const refusal = await world.act({
    interactionId: `house-other-${stamp}`,
    characterId: other.id,
    version: (await world.options(other.id)).version,
    kind: api.ActStage,
    server: B,
    staff: true,
    discordId: other.user,
    stage: { template: huntTemplate.id, settlement: home.n, at: site, hunt: lived.hunts[0] },
  });
  run.refused.code = refusal.ok ? "accepted" : refusal.refusal.code;
  run.pool.afterRefused = await pool();
  run.stages = lived.stages.map((s) => ({
    id: s.id,
    template: s.template,
    by: s.placed.by,
    points: s.placed.points ?? 0,
    open: !!s.open,
  }));

  // A player of A walks to the drop and opens a crate.
  const drop = lived.stages.find((s) => s.template === HOUSE_DROP);
  if (drop) {
    const post = dropCard(drop);
    run.cards++;
    for (const x of problems(post, names)) run.problems.push(`events post ${post.author}: ${x}`);
    await openCrate(drop);
  } else note("server A's house lists no drop");

  await admin.command("admin");
  if (admin.has("hs-log")) await admin.press("hs-log");
  run.houseLog = (await logOf(A)).map((x) => ({
    role: x.role,
    kind: x.kind,
    what: x.what,
    points: x.points ?? 0,
  }));
  run.otherLog = (await logOf(B)).length;
  if (opts.operator) {
    const res = await fetch(`${opts.operator.url}${api.PathOperatorAudit}`, {
      headers: { authorization: `Bearer ${opts.operator.token}` },
    });
    run.audit = ((await res.json()) as api.Audit).discrepancies ?? [];
  }
  return run;

  async function logOf(server: string): Promise<api.LogRow[]> {
    if (!world.houseLog) return [];
    const rows: api.LogRow[] = [];
    let after = 0;
    for (;;) {
      const page = await world.houseLog(server, after);
      const fresh = page.rows.filter((x) => x.id > after);
      rows.push(...fresh);
      if (!fresh.length || page.next <= after) return rows;
      after = page.next;
    }
  }

  async function idle() {
    if (!pass) {
      const clock = opts.operator ? await worldClock(opts.operator, world, player.id) : undefined;
      pass = clock ? () => clock.pass(1) : () => Bun.sleep(IDLE_POLL_MS);
    }
    for (let i = 0; i < IDLE_POLLS && (await world.options(player.id)).long; i++) await pass();
  }

  /** Presses the best win to the end, or backs out when no plain win is offered. */
  async function fightOut() {
    await player.hub();
    if (player.has("fight")) await player.press("fight");
    for (let i = 0; i < 12 && player.has("press"); i++) {
      const o = await world.options(player.id);
      const wins = (o.fight?.options ?? []).filter((x) => x.kind === "win" && !x.puzzle);
      const best = wins.sort((a, b) => ctx.lex.bandRank(a.band) - ctx.lex.bandRank(b.band))[0];
      await player.press("press", best ? best.id : "back-out");
    }
  }

  /**
   * Presses the crate from the events post wherever the player stands,
   * takes the card's Go there once, and steps the rest of the way where
   * no known way leads there.
   */
  async function openCrate(st: api.StageView) {
    const crate: Id = { action: "crate", target: st.id, version: 0 };
    const on = (at: api.Hex) => at.q === st.at.q && at.r === st.at.r;
    await player.send({ id: crate });
    note(`off the drop's tile: ${player.card.title}`);
    if (player.has("goto")) {
      await player.press("goto");
      await idle();
    }
    for (let i = 0; i < WALK_TRIES; i++) {
      const o = await world.options(player.id);
      if (on(o.at)) break;
      if (o.long) await idle();
      else if (o.fight) await fightOut();
      else if (o.conditions.includes(api.CondDown)) {
        await player.hub();
        if (player.has("crawl")) await player.press("crawl");
        await idle();
      } else {
        const next = o.moves
          .filter((m) => m.open)
          .sort((a, b) => hexDistance(a.to, st.at) - hexDistance(b.to, st.at))[0];
        if (!next || hexDistance(next.to, st.at) >= hexDistance(o.at, st.at)) {
          note(`no open step brings the player nearer the drop from ${o.at.q},${o.at.r}`);
          break;
        }
        await player.command("map");
        await player.press("step", String(next.dir));
        await idle();
      }
    }
    await player.send({ id: crate });
    run.crate.title = player.card.title;
    run.crate.text = player.card.description ?? "";
    const sheet = await world.sheet(player.id);
    run.crate.staged = sheet.character.goods
      .filter((g) => g.staged)
      .map(
        (g) =>
          `${g.units} ${g.material} (${ctx.lex.material(g.material)}, from settlement ${g.staged!.settlement})`,
      );
  }
}

/** A card a scripted poster put in a channel, and the event it told. */
export interface PostedCard {
  channel: string;
  /** The fact's kind; chronicle.day for a closed day's post. */
  kind: string;
  fact: number;
  /** The staging server, on a staged event. */
  server?: string;
  /** The season a season fact names. */
  season?: number;
  title: string;
}

/** What one guild's channels were given: the events channel, the day lines and the promotions in the chronicle channel. */
export interface GuildSinks {
  events: PostedCard[];
  chronicle: PostedCard[];
  promotions: PostedCard[];
  /** Live cards edited in place, which are not posts. */
  edits: number;
}

// structural: Discord's epoch, which a snowflake's time counts from, and
// how many rounds of polls a drain takes before it gives up.
const DISCORD_EPOCH = 1_420_070_400_000n;
const SNOWFLAKE_TIME_SHIFT = 22n;
const DRAIN_ROUNDS = 30;

/** A snowflake-shaped id, as Discord gives users, servers, channels and roles: the time now and a counter. */
export function fakeSnowflake(n: number, now = Date.now()): string {
  return String(((BigInt(now) - DISCORD_EPOCH) << SNOWFLAKE_TIME_SHIFT) | BigInt(n & 0x3fffff));
}

/** A promotion's or an event's season number, from its fact. */
function seasonOf(f: api.Fact): number | undefined {
  return f.kind.startsWith("season.") ? datum(f, "season")?.n : undefined;
}

/**
 * The events, chronicle and promotions posters of every guild followed,
 * over memory sinks that keep each post with the event it told. Every
 * card posted or edited is held to the card standard.
 */
export class ScriptedPosters {
  readonly sinks = new Map<string, GuildSinks>();
  readonly problems: string[] = [];
  private readonly told = new WeakMap<Card, Omit<PostedCard, "channel" | "title">>();
  private readonly sets: GuildPosters<Poller>[];
  private readonly names: Set<string>;

  constructor(
    world: World,
    private readonly lex: Lexicon,
    houses: Houses,
    guilds: readonly string[],
    private readonly log: (line: string) => void = () => {},
  ) {
    this.names = lex.goodsNames();
    const store = memoryStore();
    const read = (guild: string) => ({
      hunts: () => world.hunts(),
      arcs: (id = "") => world.arcs(id, guild),
      storyEvents: (after: number) => world.storyEvents(after, guild),
      storyPromotions: (after: number) => world.storyPromotions(after, guild),
      chronicleFact: (id: string | undefined, fact: number) => world.chronicleFact(id, fact, guild),
    });
    /** A kind's channel: the one the guild's settings map, else one of the guild's own. */
    const channelOf = (kind: ChannelKind) => async (guild: string) =>
      (await houses.channelOf(guild, kind)) ?? `${guild}-${kind}`;
    const events = new GuildPosters<Poller>(
      guilds,
      channelOf("events"),
      (guild, ch) =>
        new EventsPoster(
          read(guild),
          lex,
          store,
          this.sink(guild, "events", ch),
          undefined,
          posterPrefix("mmo-bot:events:", guild, ch),
          log,
          (ev, mode, template) => {
            const card = template();
            if (card && mode === "post")
              this.told.set(card, {
                kind: ev.fact.kind,
                fact: ev.fact.id,
                server: ev.server,
                season: seasonOf(ev.fact),
              });
            return card;
          },
          { server: guild, houses, board: () => world.board(guild) },
        ),
      log,
      "events",
    );
    const chronicle = new GuildPosters<Poller>(
      guilds,
      channelOf("chronicle"),
      (guild, ch) =>
        new ChroniclePoster(
          chronicleSource((server) => world.chronicle("", undefined, server)),
          lex,
          store,
          this.sink(guild, "chronicle", ch),
          guild,
          posterPrefix("mmo-bot:chronicle:", guild, ch),
          log,
          (day, template) => {
            const card = template();
            this.told.set(card, { kind: "chronicle.day", fact: day.day });
            return card;
          },
        ),
      log,
      "chronicle",
    );
    const promotions = new GuildPosters<Poller>(
      guilds,
      channelOf("chronicle"),
      (guild, ch) =>
        new PromotionsPoster(
          read(guild),
          lex,
          store,
          this.sink(guild, "promotions", ch),
          async () => {},
          posterPrefix("mmo-bot:promotions:", guild, ch),
          log,
          (ev) => {
            const card = promotionCard(ev, lex);
            if (card)
              this.told.set(card, {
                kind: ev.fact.kind,
                fact: ev.fact.id,
                server: ev.server,
                season: seasonOf(ev.fact),
              });
            return card;
          },
        ),
      log,
      "promotions",
    );
    this.sets = [events, chronicle, promotions];
    for (const g of guilds) this.of(g);
  }

  /** A guild's sinks, made empty the first time it is asked for. */
  of(guild: string): GuildSinks {
    let s = this.sinks.get(guild);
    if (!s) this.sinks.set(guild, (s = { events: [], chronicle: [], promotions: [], edits: 0 }));
    return s;
  }

  add(guild: string): void {
    this.of(guild);
    for (const p of this.sets) p.add(guild);
  }

  remove(guild: string): void {
    for (const p of this.sets) p.remove(guild);
  }

  guilds(): string[] {
    return this.sets[0]!.guilds();
  }

  private sink(guild: string, kind: "events" | "chronicle" | "promotions", channel: string) {
    const check = (c: Card) => {
      for (const x of problems(c, this.names))
        this.problems.push(`${guild} ${kind} ${c.author}: ${x}`);
    };
    const sink: ChannelSink = {
      post: async (card) => {
        check(card);
        const list = this.of(guild)[kind];
        const told = this.told.get(card) ?? { kind: "unknown", fact: 0 };
        list.push({ channel, title: card.title, ...told });
        return `${guild}-${kind}-${list.length}`;
      },
      edit: async (_message, card) => {
        check(card);
        this.of(guild).edits++;
        return true;
      },
    };
    return sink;
  }

  /** Polls every poster until a round posts nothing; returns how many it posted or edited. */
  async drain(): Promise<number> {
    let n = 0;
    for (let i = 0; i < DRAIN_ROUNDS; i++) {
      let round = 0;
      for (const p of this.sets) round += await p.poll();
      n += round;
      if (!round) break;
    }
    return n;
  }

  /** How many times a guild posted a kind, in season (when given), on one sink. */
  count(
    guild: string,
    sink: "events" | "chronicle" | "promotions",
    kind: string,
    season?: number,
  ): number {
    return this.of(guild)[sink].filter(
      (p) => p.kind === kind && (season === undefined || p.season === season),
    ).length;
  }

  /** Whether every guild has posted the epoch card (unless none is expected) and season.began for season 1. */
  done(epoch: boolean): boolean {
    return this.guilds().every(
      (g) =>
        this.count(g, "events", SEASON_BEGAN, 1) > 0 &&
        (!epoch || this.count(g, "promotions", SEASON_EPOCH) > 0),
    );
  }

  /** Each guild's posts, by sink and kind, counted: what a summary prints. */
  summary(): Record<string, GuildTally> {
    return Object.fromEntries([...this.sinks].map(([g, s]) => [g, guildTally(s)]));
  }
}

/** A guild's sinks counted by kind, a season fact's kind with its season. */
export function guildTally(s: GuildSinks): GuildTally {
  const tally = (list: PostedCard[]) => {
    const t: Record<string, number> = {};
    for (const p of list) {
      const k = p.season === undefined ? p.kind : `${p.kind} ${p.season}`;
      t[k] = (t[k] ?? 0) + 1;
    }
    return t;
  };
  return {
    events: tally(s.events),
    chronicle: tally(s.chronicle),
    promotions: tally(s.promotions),
    edits: s.edits,
  };
}

/** A guild's posts counted by kind on each sink. */
export interface GuildTally {
  events: Record<string, number>;
  chronicle: Record<string, number>;
  promotions: Record<string, number>;
  edits: number;
}

/** The Redis calls the forget step seeds and checks with: a forget's, and a list push. */
export type SeedRedis = RedisLike & { rpush(key: string, ...values: string[]): Promise<number> };

/** A Redis held in memory, for a run with no REDIS_URL: strings and lists, and SCAN's MATCH. */
export function memoryRedis(): SeedRedis & { keys(): string[] } {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const glob = (pattern: string) => {
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]!;
      if (c === "\\" && i + 1 < pattern.length) re += escapeRe(pattern[++i]!);
      else if (c === "*") re += ".*";
      else if (c === "?") re += ".";
      else re += escapeRe(c);
    }
    return new RegExp(`^${re}$`);
  };
  return {
    keys: () => [...strings.keys(), ...lists.keys()],
    async scan(_cursor, _match, pattern) {
      const re = glob(pattern);
      return ["0", [...strings.keys(), ...lists.keys()].filter((k) => re.test(k))];
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (strings.delete(k) || lists.delete(k)) n++;
      return n;
    },
    get: async (k) => strings.get(k) ?? null,
    set: async (k, v) => void strings.set(k, v),
    async lrange(k, start, stop) {
      const l = lists.get(k) ?? [];
      return l.slice(start, stop < 0 ? l.length + stop + 1 : stop + 1);
    },
    async lrem(k, _count, v) {
      const l = lists.get(k) ?? [];
      const kept = l.filter((x) => x !== v);
      // As in Redis, an emptied list is no key at all.
      if (kept.length) lists.set(k, kept);
      else lists.delete(k);
      return l.length - kept.length;
    },
    async rpush(k, ...values) {
      const l = lists.get(k) ?? [];
      l.push(...values);
      lists.set(k, l);
      return l.length;
    },
  };
}

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** What the bot would hold of a player who pressed, held a name and joined a party: keys to forget, and one of another's. */
function botKeys(user: string, other: string, stamp: number) {
  return {
    cooldown: `${COOLDOWN_PREFIX}${user}`,
    last: lastKey("scripted", user),
    cap: `${KEY_PREFIX}cap:scripted:${user}:1`,
    party: `${PARTY_PREFIX}scripted-${stamp}`,
    others: `${COOLDOWN_PREFIX}${other}`,
  };
}

/** The forget step: one player's /forget-me and its Confirm, and what the bot's Redis then holds of them. */
export interface ForgetRun {
  user: string;
  character: string;
  /** The card each press answered. */
  asked: string;
  done: string;
  /** The world's lookup of the user afterwards: empty once forgotten. */
  lookup: string;
  /** Keys, entries and memberships the bot removed, and those of the user left behind. */
  purged: number;
  left: string[];
  /** Whether another user's key was kept. */
  othersKept: boolean;
}

/** One server of the two-servers run, as the run read it back from its house. */
export interface ServerRun {
  server: string;
  /** Its guild in the world, and the settlement the guild runs. */
  guild: string;
  settlement: number;
  place: string;
  settings: api.HouseSettings;
  /** The channels and staff role its admin mapped through the settings card. */
  mapped: { events: string; chronicle: string; staffRole: string };
  characters: { admin: string; staff: string; players: string[] };
  /** The stage its admin staged in its own settlement. */
  staged: string;
}

/** What the two-servers run did (GDD 14, 18.5): two servers on one world, through a season's close. */
export interface TwoServersRun extends Counted {
  servers: ServerRun[];
  /** The tool a player of A crafted: the kind the quote named, the card the craft answered, and the item made. */
  crafted: { by: string; kind: string; card: string; item: string };
  /** B's staff pressing A's staging: the bot's answer, whether it wrote, and the world's refusal of the same order. */
  refused: { card: string; wrote: boolean; code: string };
  /** The world clock: where the run began, the tick season zero closed at, and season one's start and first day. */
  season: { from: number; closes: number; n: number; began: number; to: number };
  /** Each guild's sinks, by guild. */
  posted: Record<string, GuildSinks>;
  forget: ForgetRun;
  audit: string[];
  log: string[];
}

/** The world clock as the run drives it. */
export interface RunClock {
  manual: boolean;
  tick(): Promise<number>;
  /** Moves the clock to a tick and waits for the world to reach it. */
  until(to: number): Promise<void>;
}

/** The operator's part in the run: the manual clock, a little stock for the crafter, and the audit. */
export interface TwoServersOps {
  clock(characterId: string): Promise<RunClock>;
  stock(characterId: string, asset: string, units: number): Promise<void>;
  audit(): Promise<string[]>;
}

/** The operator's part over its HTTP API. */
export function httpOps(op: { url: string; token: string }, world: World): TwoServersOps {
  let n = 0;
  return {
    clock: (id) => worldClock(op, world, id),
    async stock(characterId, asset, units) {
      const res = await operate(op, {
        interactionId: `two-servers-${characterId}-${++n}`,
        characterId,
        kind: api.OpCorrect,
        asset,
        units,
        note: "The scripted two-servers run's stock.",
      });
      if (!res.ok) throw new Error(`the correction of ${asset} was refused: ${await res.text()}`);
    },
    async audit() {
      const res = await fetch(`${op.url}${api.PathOperatorAudit}`, {
        headers: { authorization: `Bearer ${op.token}` },
      });
      return ((await res.json()) as api.Audit).discrepancies ?? [];
    },
  };
}

// structural: the players each server brings beside its admin and staff
// member, the start every scripted character takes, and the coin the
// crafter is given for the forge's fee.
const SERVER_PLAYERS = 3;
const TWO_SERVERS_START = "knife";
const CRAFT_COIN = 20;

/** Why a two-servers run does not hold, one line each; empty when it holds. epoch says an epoch card is expected. */
export function twoServersMisses(r: TwoServersRun, epoch = true): string[] {
  const out: string[] = [];
  const miss = (bad: boolean, why: string) => bad && out.push(why);
  miss(r.problems.length > 0, `${r.problems.length} card problems`);
  miss(r.servers.length !== 2, `${r.servers.length} servers, not 2`);
  const [a, b] = r.servers;
  if (a && b) {
    miss(a.guild === b.guild, `both servers are in guild ${a.guild}`);
    miss(a.settlement === b.settlement, `both guilds run settlement ${a.settlement}`);
    miss(
      JSON.stringify(a.settings) === JSON.stringify(b.settings),
      "the two servers' settings are the same",
    );
  }
  for (const s of r.servers) {
    const posted = r.posted[s.server];
    miss(
      channelIn(s.settings, "events") !== s.mapped.events ||
        channelIn(s.settings, "chronicle") !== s.mapped.chronicle,
      `${s.server}'s settings do not hold the channels its admin mapped`,
    );
    miss(
      !(s.settings.staffRoles ?? []).includes(s.mapped.staffRole),
      `${s.server}'s settings do not hold its staff role`,
    );
    miss(!s.staged, `${s.server}'s admin staged nothing`);
    if (!posted) {
      out.push(`${s.server} has no sinks`);
      continue;
    }
    const foreign = posted.events.filter((p) => p.server && p.server !== s.server);
    miss(
      foreign.length > 0,
      `${s.server}'s events channel holds ${foreign.length} events another server staged`,
    );
    miss(
      !posted.events.some((p) => p.kind === "staged.opened" && p.server === s.server),
      `${s.server}'s events channel holds none of its own staging`,
    );
    const wrong = [
      ...posted.events.filter((p) => p.channel !== s.mapped.events),
      ...[...posted.chronicle, ...posted.promotions].filter(
        (p) => p.channel !== s.mapped.chronicle,
      ),
    ];
    miss(
      wrong.length > 0,
      `${s.server} posted ${wrong.length} cards outside the channels it mapped`,
    );
    const began = posted.events.filter((p) => p.kind === SEASON_BEGAN && p.season === 1).length;
    miss(began !== 1, `${s.server} posted season one's start ${began} times, not once`);
    const epochs = posted.promotions.filter((p) => p.kind === SEASON_EPOCH).length;
    miss(
      epochs !== (epoch ? 1 : 0),
      `${s.server} posted the epoch card ${epochs} times, not ${epoch ? "once" : "never"}`,
    );
    miss(
      !posted.chronicle.some((p) => p.kind === "chronicle.day"),
      `${s.server}'s chronicle channel holds no closed day`,
    );
  }
  miss(!r.crafted.card, "the crafter in A made nothing");
  miss(r.refused.wrote, "the bot sent server B's staging of server A's settlement");
  miss(r.refused.code !== api.CodeHouseScope, `the world answered B's staging "${r.refused.code}"`);
  miss(r.season.n !== 1, `the world ended in season ${r.season.n}, not season one`);
  miss(
    r.season.to < r.season.began + TICKS_PER_DAY,
    "the clock stopped before season one's first world day was over",
  );
  const f = r.forget;
  miss(!f.character, "no player of B was there to forget");
  miss(f.lookup !== "", "the world still finds the forgotten player");
  miss(f.done !== "You are forgotten", `/forget-me answered "${f.done}"`);
  miss(f.purged === 0, "the bot removed none of its keys of the forgotten player");
  miss(f.left.length > 0, `the bot's Redis still holds ${f.left.join(", ")}`);
  miss(!f.othersKept, "the forget removed another user's key");
  miss(r.audit.length > 0, `the audit found ${r.audit.length} discrepancies`);
  return out;
}

/**
 * Two servers on one world, as Discord drives the bot (GDD 14, 17.2,
 * 18.5): each with an admin who saves its settings, a staff member and
 * three players, under snowflake-shaped ids. A player of A crafts a tool,
 * each admin stages in its own settlement, and B's staff is refused on
 * A's stage. The events, chronicle and promotions posters run for both
 * guilds over memory sinks while the operator's clock drives the world
 * through season zero's close and season one's first world day; then a
 * player of B is forgotten through /forget-me.
 */
export async function twoServersRun(
  ctx: Ctx,
  opts: {
    ops: TwoServersOps;
    servers?: [string, string];
    /** The bot's Redis for the forget step; one in memory when unset. */
    redis?: SeedRedis;
    log?: (line: string) => void;
  },
): Promise<TwoServersRun> {
  const writes: { kind: string; server?: string; character: string; code: string }[] = [];
  const world = keepingWrites(ctx.world, writes);
  const houses = new Houses(world, { held: memoryHeldNames(), ttlMs: 0 });
  const redis = opts.redis ?? memoryRedis();
  let purged = 0;
  const c: Ctx = {
    ...ctx,
    world,
    house: houses,
    forget: async (user) => {
      purged += await forgetUser(redis, user);
    },
  };
  const names = ctx.lex.goodsNames();
  const stamp = Date.now();
  let made = 0;
  const id = () => fakeSnowflake(++made, stamp);
  const [A, B] = opts.servers ?? [id(), id()];
  const run: TwoServersRun = {
    presses: 0,
    cards: 0,
    problems: [],
    servers: [],
    crafted: { by: "", kind: "", card: "", item: "" },
    refused: { card: "", wrote: false, code: "" },
    season: { from: 0, closes: 0, n: 0, began: 0, to: 0 },
    posted: {},
    forget: {
      user: "",
      character: "",
      asked: "",
      done: "",
      lookup: "",
      purged: 0,
      left: [],
      othersKept: false,
    },
    audit: [],
    log: [],
  };
  const note = (s: string) => {
    run.log.push(s);
    opts.log?.(s);
  };

  interface Side {
    server: string;
    mapped: ServerRun["mapped"];
    admin: Player;
    staff: Player;
    players: Player[];
  }
  const side = (server: string, label: string): Side => {
    const mapped = { events: id(), chronicle: id(), staffRole: id() };
    const lists = {
      channels: [
        { id: mapped.events, name: "events" },
        { id: mapped.chronicle, name: "chronicle" },
      ],
      roles: [{ id: mapped.staffRole, name: "Staff" }],
    };
    const member = (as: Member) => new Player(c, id(), run, names, async () => {}, as);
    return {
      server,
      mapped,
      admin: member({ guild: server, guildName: `${label} Crew`, admin: true, ...lists }),
      staff: member({ guild: server, staff: true }),
      players: Array.from({ length: SERVER_PLAYERS }, () => member({ guild: server })),
    };
  };
  const sides = [side(A, "Rustwater"), side(B, "Saltmarsh")];
  // The admins first, so each server's guild is installed by its admin's arrival.
  for (const s of sides) await arrive(s.admin);
  const clock = await opts.ops.clock(sides[0]!.admin.id);
  if (!clock.manual)
    throw new Error("the two-servers walk needs a world on the manual clock (MMO_MANUAL_CLOCK=1)");
  run.season.from = await clock.tick();
  // A guild the world had no free settlement for waits for the one it opens.
  for (let i = 0; i < 2 * TICKS_PER_DAY; i++) {
    const waiting = [];
    for (const s of sides) if (!(await houseOf(s)).settlements.length) waiting.push(s.server);
    if (!waiting.length) break;
    if (i === 0) note(`waiting for a settlement for ${waiting.join(", ")}`);
    await clock.until((await clock.tick()) + 1);
  }
  // Then the rest, who arrive at their server's settlement.
  for (const s of sides) for (const p of [s.staff, ...s.players]) await arrive(p);

  // Each admin saves its server's settings through the settings card.
  for (const s of sides) {
    const a = s.admin;
    await a.command("admin");
    await a.press("hs-conf");
    await a.press("hs-kind", undefined, "events");
    await a.press("hs-chan", undefined, s.mapped.events);
    await a.press("hs-kind", undefined, "chronicle");
    await a.press("hs-chan", undefined, s.mapped.chronicle);
    await a.press("hs-srole", undefined, s.mapped.staffRole);
    note(`${s.server}'s admin: ${a.card.title}`);
  }
  const homes: api.HouseSettlement[] = [];
  for (const s of sides) {
    const h = await houseOf(s);
    const home = h.settlements[0];
    if (!home)
      throw new Error(
        `server ${s.server} runs no settlement yet: run the two-servers walk on a fresh world`,
      );
    homes.push(home);
    note(`server ${s.server} is guild ${h.guild ?? "?"} at ${home.name} (settlement ${home.n})`);
  }

  // The posters start at the present, as a bot that has just joined does.
  const posters = new ScriptedPosters(world, ctx.lex, houses, [A, B], opts.log);
  await posters.drain();

  // A player of A crafts a tool from stock the operator gives it.
  const crafter = sides[0]!.players[0]!;
  run.crafted.by = crafter.id;
  const owned = async () => {
    const sh = await world.sheet(crafter.id);
    return new Set([...sh.kit, ...sh.pack].map((i) => i.id));
  };
  const had = await owned();
  await opts.ops.stock(crafter.id, MATERIAL_ASSET + TOOL.material, 2);
  // A fresh character has no coin for the forge's fee.
  await opts.ops.stock(crafter.id, "coin", CRAFT_COIN);
  await crafter.hub();
  await crafter.press("craft");
  await crafter.press("craft-p", undefined, TOOL.process);
  await crafter.press("craft-m", undefined, TOOL.method);
  await crafter.press("craft-s", undefined, TOOL.slot);
  await crafter.press("craft-i", undefined, TOOL.material);
  await crafter.press("craft-q");
  run.crafted.kind = crafter.card.title;
  if (crafter.has("craft-go")) {
    await crafter.press("craft-go");
    if (crafter.card.author.startsWith("First discovery") || crafter.card.title === "Made")
      run.crafted.card = crafter.card.title;
    else note(`the craft was refused: ${crafter.card.title}`);
  } else note(`the quote offers no craft: ${crafter.card.title}`);
  run.crafted.item = [...(await owned())].find((x) => !had.has(x)) ?? "";

  // Each admin stages a drop in its own settlement; each staff member opens its console.
  const gos: Id[] = [];
  const staged: string[] = [];
  for (const [i, s] of sides.entries()) {
    const before = new Set((await houseOf(s)).stages.map((x) => x.id));
    gos.push(await stage(s.admin, homes[i]!.n));
    staged.push((await houseOf(s)).stages.find((x) => !before.has(x.id))?.id ?? "");
    await s.staff.command("staff");
  }

  // B's staff presses A's staging: the bot sends nothing, and the world refuses the order itself.
  const other = sides[1]!.staff;
  await other.command("staff");
  const sent = writes.length;
  await other.send({ id: gos[0]! });
  run.refused.card = other.card.description ?? other.card.title;
  run.refused.wrote = writes.slice(sent).some((w) => w.kind === api.ActStage);
  const site = homes[0]!.sites[0]?.at;
  if (!site) throw new Error(`${homes[0]!.name} has no site to stage at`);
  const refusal = await world.act({
    interactionId: `two-servers-refused-${stamp}`,
    characterId: other.id,
    version: (await world.options(other.id)).version,
    kind: api.ActStage,
    server: B,
    staff: true,
    discordId: other.user,
    stage: { template: HOUSE_DROP, settlement: homes[0]!.n, at: site },
  });
  run.refused.code = refusal.ok ? "accepted" : refusal.refusal.code;
  await posters.drain();

  // The operator's clock through season zero's close, a world day at a time.
  const season = async () => (await world.arcs(sides[0]!.admin.id, A)).season;
  const zero = await season();
  if (zero.n !== 0)
    throw new Error(`the world is in season ${zero.n}: run the two-servers walk on a fresh world`);
  run.season.closes = zero.ends;
  const walk = async (to: number) => {
    for (let t = await clock.tick(); t < to; t = await clock.tick()) {
      await clock.until(Math.min(to, t + TICKS_PER_DAY));
      await posters.drain();
    }
  };
  await walk(zero.ends + 1);
  const one = await season();
  run.season.n = one.n;
  run.season.began = one.ends - one.days * TICKS_PER_DAY;
  note(`season ${one.n} began at tick ${run.season.began}, closing at ${one.ends}`);
  await walk(run.season.began + TICKS_PER_DAY);
  run.season.to = await clock.tick();

  // A player of B leaves through /forget-me, and the bot's own keys of them go too.
  const leaver = sides[1]!.players[SERVER_PLAYERS - 1]!;
  const keys = botKeys(leaver.user, sides[1]!.players[0]!.user, stamp);
  await redis.set(keys.cooldown, "1");
  await redis.set(keys.last, "scripted");
  await redis.set(keys.cap, "1");
  await redis.set(keys.others, "1");
  await redis.rpush(HELD_KEY, JSON.stringify({ user: leaver.user, name: "scripted" }));
  await redis.set(keys.party, JSON.stringify({ members: [leaver.user, keys.others] }));
  run.forget.user = leaver.user;
  run.forget.character = leaver.id;
  await leaver.command("forget-me");
  run.forget.asked = leaver.card.title;
  await leaver.press("forget", "yes");
  run.forget.done = leaver.card.title;
  run.forget.lookup = await world.player(leaver.user);
  run.forget.purged = purged;
  const left: string[] = [];
  for (const k of [keys.cooldown, keys.last, keys.cap])
    if ((await redis.get(k)) !== null) left.push(k);
  if ((await redis.lrange(HELD_KEY, 0, -1)).some((x) => x.includes(leaver.user)))
    left.push(HELD_KEY);
  if ((await redis.get(keys.party))?.includes(leaver.user)) left.push(keys.party);
  run.forget.left = left;
  run.forget.othersKept = (await redis.get(keys.others)) !== null;
  // What the step seeded of others goes again, so a bot sharing the Redis never reads it.
  await redis.del(keys.others, keys.party);
  // The sweep runs at the first free tick.
  await clock.until((await clock.tick()) + 2);
  run.season.to = await clock.tick();
  await posters.drain();

  run.servers = [];
  for (const [i, s] of sides.entries()) {
    const h = await houseOf(s);
    run.servers.push({
      server: s.server,
      guild: h.guild ?? "",
      settlement: homes[i]!.n,
      place: homes[i]!.name,
      settings: h.settings,
      mapped: s.mapped,
      characters: {
        admin: s.admin.id,
        staff: s.staff.id,
        players: s.players.map((p) => p.id),
      },
      staged: staged[i]!,
    });
  }
  run.posted = Object.fromEntries(posters.sinks);
  run.problems.push(...posters.problems);
  run.audit = await opts.ops.audit();
  return run;

  async function houseOf(s: Side): Promise<api.House> {
    if (!world.house) throw new Error("the world serves no house");
    const r = await world.house(s.server, s.admin.id, { admin: true });
    if (!r.ok) throw new Error(`the house of ${s.server}: ${r.refusal.message}`);
    return r.reply;
  }

  async function arrive(p: Player) {
    await p.command("play");
    await p.press("start", TWO_SERVERS_START);
    p.id = await world.player(p.user);
    if (!p.id) throw new Error(`${p.user} made no character: ${p.card.title}`);
  }

  /** Stages the free drop from the admin's console at its settlement's first site. */
  async function stage(p: Player, settlement: number): Promise<Id> {
    await p.command("admin");
    await p.press("hs-stage");
    await p.press("hs-tpl", undefined, HOUSE_DROP);
    if (p.has("hs-set")) await p.press("hs-set", undefined, String(settlement));
    if (p.has("hs-site")) await p.press("hs-site", undefined, p.first("hs-site"));
    const go = p.ids("hs-go")[0];
    if (!go) throw new Error(`the staging form will not send: ${p.card.description}`);
    await p.send({ id: go });
    note(`${p.user} staged: ${p.card.title}`);
    return go;
  }
}

/** What the real-time posters did: each guild's posts, and whether every guild saw the epoch and season one begin. */
export interface PostersRun {
  mode: "posters";
  ok: boolean;
  done: boolean;
  problems: string[];
  guilds: Record<string, GuildTally>;
  polls: number;
  seconds: number;
}

/**
 * The posters alone, beside a world on real ticks (the launch rehearsal):
 * polled until every guild has posted the epoch card and season one's
 * start, or until stopped.
 */
export async function postersRun(
  world: World,
  lex: Lexicon,
  guilds: readonly string[],
  opts: {
    epoch?: boolean;
    pollMs?: number;
    stopped?: () => boolean;
    log?: (line: string) => void;
  } = {},
): Promise<PostersRun> {
  const started = Date.now();
  const houses = new Houses(world, { held: memoryHeldNames(), ttlMs: 0 });
  const posters = new ScriptedPosters(world, lex, houses, guilds, opts.log);
  const epoch = opts.epoch ?? true;
  let polls = 0;
  for (;;) {
    try {
      await posters.drain();
    } catch (e) {
      opts.log?.(`[posters] ${String(e)}`);
    }
    polls++;
    if (posters.done(epoch) || opts.stopped?.()) break;
    await Bun.sleep(opts.pollMs ?? POSTERS_POLL_MS);
  }
  const done = posters.done(epoch);
  return {
    mode: "posters",
    ok: done && posters.problems.length === 0,
    done,
    problems: posters.problems,
    guilds: posters.summary(),
    polls,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

// structural: the real-time posters poll about once a 3-second local tick.
const POSTERS_POLL_MS = 3_000;

/** The value after a flag, or undefined. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export type NarrationMode = "off" | "stub";

/** --narration off|stub, off when absent; a message when the value is neither. */
export function narrationMode(argv: readonly string[]): NarrationMode | string {
  const i = argv.findIndex((a) => a === "--narration" || a.startsWith("--narration="));
  if (i < 0) return "off";
  const arg = argv[i]!;
  const v = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
  return v === "off" || v === "stub" ? v : "usage: --narration off|stub";
}

/** What a run's narration did: the stub's calls and the ledger of each day it counted under. */
export interface NarrationRun {
  mode: NarrationMode;
  calls: number;
  ledgers(): Promise<DayLedger[]>;
}

/**
 * The run's Ctx: the plain one when narration is off, or one whose every
 * part goes through a narrator over the stub, a memory store and a switch
 * fixed on, so every narrated card a run sees is checked like the rest.
 */
export function scriptedCtx(
  base: Pick<Ctx, "world" | "lex" | "threatLine">,
  mode: NarrationMode,
  log: (line: string) => void = console.error,
): { ctx: Ctx; narration: NarrationRun } {
  if (mode === "off") {
    return { ctx: base, narration: { mode, calls: 0, ledgers: async () => [] } };
  }
  const model = stubModel();
  const store = narrationMemory();
  const sw = fixedSwitch(true);
  const narrator = new Narrator({
    model,
    store,
    switch: sw,
    dayUsd: NARRATION_DAY_USD,
    log,
  });
  const ctx: Ctx = { ...base, ...narrationParts(narrator, store, base.lex, { sw, log }) };
  return {
    ctx,
    narration: {
      mode,
      get calls() {
        return model.calls.length;
      },
      async ledgers() {
        await narrator.drain();
        const days = new Set<number>();
        for (const k of store.keys()) {
          const d = costDay(k);
          if (d !== null) days.add(d);
        }
        return Promise.all([...days].map((d) => narrator.ledger(d)));
      },
    },
  };
}

/** The narration part of a run's report. */
async function narrationReport(n: NarrationRun) {
  return { mode: n.mode, calls: n.calls, ledgers: await n.ledgers() };
}

function modeOrExit(): NarrationMode {
  const mode = narrationMode(process.argv.slice(2));
  if (mode === "off" || mode === "stub") return mode;
  console.error(mode);
  process.exit(2);
}

if (import.meta.main && process.env.SCRIPTED === "party") {
  const url = process.env.MMO_WORLD_URL ?? "http://localhost:8080";
  const world = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const lex = new Lexicon(await world.lexicon());
  const { ctx, narration } = scriptedCtx(
    { world, lex, threatLine: lex.numbers.ambushLine },
    modeOrExit(),
  );
  const started = Date.now();
  const r = await partyRun(ctx, {
    operator: { url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" },
  }).catch((e: unknown) => {
    console.error(e);
    process.exit(2);
  });
  console.log(
    JSON.stringify(
      {
        ...r,
        narration: await narrationReport(narration),
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
  process.exit(r.problems.length || !r.party || !r.beats || !r.ended || !r.thread.length ? 1 : 0);
}

if (import.meta.main && process.env.SCRIPTED === "crime") {
  const url = process.env.MMO_WORLD_URL ?? "http://localhost:8080";
  const world = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const lex = new Lexicon(await world.lexicon());
  const { ctx, narration } = scriptedCtx(
    { world, lex, threatLine: lex.numbers.ambushLine },
    modeOrExit(),
  );
  const started = Date.now();
  const kept: Record<string, unknown> = {};
  const r = await crimeRun(ctx, {
    operator: { url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" },
    keep: process.env.RECORD ? kept : undefined,
  }).catch((e: unknown) => {
    console.error(e);
    process.exit(2);
  });
  console.log(
    JSON.stringify(
      {
        ...r,
        narration: await narrationReport(narration),
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
  // RECORD names the card tests' fixture: the crime acts' replies are merged
  // into it, and every other sample in it is kept as it was recorded.
  if (process.env.RECORD) {
    const file = Bun.file(process.env.RECORD);
    const samples = (await file.exists()) ? ((await file.json()) as Record<string, unknown>) : {};
    for (const kind of CRIME_ACTS)
      if (kept[`act:${kind}`]) samples[`act:${kind}`] = kept[`act:${kind}`];
    await Bun.write(process.env.RECORD, `${JSON.stringify(samples, null, 2)}\n`);
  }
  process.exit(
    r.problems.length ||
      r.audit.length ||
      !r.thefts ||
      !r.fenced ||
      !r.paid ||
      !r.fled ||
      !r.made ||
      !r.informed ||
      !r.betrayed ||
      !r.unmade ||
      r.syndicateMood !== api.MoodHostile ||
      !r.turnedAway
      ? 1
      : 0,
  );
}

// Every model use stays off: the house walk proves the consoles, not the narration.
if (import.meta.main && process.env.SCRIPTED === "house") {
  const url = process.env.MMO_WORLD_URL ?? "http://localhost:8080";
  const world = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const lex = new Lexicon(await world.lexicon());
  const ctx: Ctx = {
    world,
    lex,
    threatLine: lex.numbers.ambushLine,
    house: new Houses(world, { held: memoryHeldNames() }),
  };
  const started = Date.now();
  const r = await houseRun(ctx, {
    operator: { url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" },
  }).catch((e: unknown) => {
    console.error(e);
    process.exit(2);
  });
  const misses = houseMisses(r);
  console.log(
    JSON.stringify({ ...r, misses, seconds: Math.round((Date.now() - started) / 1000) }, null, 2),
  );
  process.exit(misses.length ? 1 : 0);
}

/** The bot's Redis for the forget step when REDIS_URL names one, else none (the run keeps one in memory). */
async function seedRedis(): Promise<(SeedRedis & { disconnect(): void }) | undefined> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return undefined;
  const { default: IORedis } = await import("ioredis");
  return new IORedis(url, { maxRetriesPerRequest: 1 }) as unknown as SeedRedis & {
    disconnect(): void;
  };
}

/** --no-epoch: the world takes no rules epoch at the close, so no epoch card is expected. */
const EXPECT_EPOCH = !process.argv.includes("--no-epoch");

// One JSON line on stdout, the last; everything else goes to stderr.
if (import.meta.main && process.argv.includes("--two-servers")) {
  const url = flagValue(process.argv, "--two-servers");
  if (!url || url.startsWith("--")) {
    console.error("usage: bun run src/scripted.ts --two-servers <world url> [--no-epoch]");
    process.exit(2);
  }
  const started = Date.now();
  const world = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const redis = await seedRedis();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  let code = 0;
  try {
    const lex = new Lexicon(await world.lexicon());
    const r = await twoServersRun(
      { world, lex, threatLine: lex.numbers.ambushLine },
      {
        ops: httpOps({ url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" }, world),
        redis,
        log: (line) => console.error(line),
      },
    );
    const misses = twoServersMisses(r, EXPECT_EPOCH);
    const { posted, ...rest } = r;
    const tallies = Object.fromEntries(Object.entries(posted).map(([g, s]) => [g, guildTally(s)]));
    console.log(
      JSON.stringify({
        mode: "two-servers",
        ok: misses.length === 0,
        misses,
        ...rest,
        posted: tallies,
        seconds: seconds(),
      }),
    );
    code = misses.length ? 1 : 0;
  } catch (e) {
    console.error(e);
    console.log(
      JSON.stringify({ mode: "two-servers", ok: false, misses: [String(e)], seconds: seconds() }),
    );
    code = 2;
  } finally {
    redis?.disconnect();
  }
  process.exit(code);
}

if (import.meta.main && process.argv.includes("--posters")) {
  const url = flagValue(process.argv, "--posters");
  const guilds = (flagValue(process.argv, "--guilds") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (!url || url.startsWith("--") || !guilds.length) {
    console.error("usage: bun run src/scripted.ts --posters <world url> --guilds a,b [--no-epoch]");
    process.exit(2);
  }
  let stop = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => (stop = true));
  const world = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  let code = 0;
  try {
    const lex = new Lexicon(await world.lexicon());
    const r = await postersRun(world, lex, guilds, {
      epoch: EXPECT_EPOCH,
      stopped: () => stop,
      log: (line) => console.error(line),
    });
    console.log(JSON.stringify(r));
    code = r.ok ? 0 : 1;
  } catch (e) {
    console.error(e);
    console.log(JSON.stringify({ mode: "posters", ok: false, problems: [String(e)] }));
    code = 2;
  }
  process.exit(code);
}

if (
  import.meta.main &&
  !["party", "crime", "house"].includes(process.env.SCRIPTED ?? "") &&
  !process.argv.some((a) => a === "--two-servers" || a === "--posters")
) {
  const url = process.env.MMO_WORLD_URL ?? "http://localhost:8080";
  const samples: Record<string, unknown> = {};
  const base: World = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const world = process.env.RECORD ? recording(base, samples) : base;
  const lex = new Lexicon(await world.lexicon());
  const { ctx, narration } = scriptedCtx(
    { world, lex, threatLine: lex.numbers.ambushLine },
    modeOrExit(),
  );
  const started = Date.now();
  const season = process.argv.includes("--season");
  const r = await scripted(ctx, {
    operator: { url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" },
    season,
  }).catch((e: unknown) => {
    console.error(e);
    process.exit(2);
  });
  console.log(
    JSON.stringify(
      {
        ...r,
        narration: await narrationReport(narration),
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
  if (process.env.RECORD)
    await Bun.write(process.env.RECORD, `${JSON.stringify(samples, null, 2)}\n`);
  process.exit(
    r.problems.length ||
      r.audit.length ||
      r.toolLevel < 5 ||
      !r.crafted ||
      r.sold === 0 ||
      !r.posted ||
      !r.withdrawn ||
      !r.guild ||
      (season && !r.backed)
      ? 1
      : 0,
  );
}
