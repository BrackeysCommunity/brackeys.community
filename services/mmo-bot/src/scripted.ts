import type { Button, Select } from "../../../packages/discord-kit/src/index.ts";
import {
  costDay,
  type DayLedger,
  fixedSwitch,
  memoryStore as narrationMemory,
  Narrator,
  stubModel,
} from "../../../packages/mmo-narrate/src/index.ts";
import * as api from "./api.ts";
import { type Card, problems } from "./card.ts";
import { NARRATION_DAY_USD } from "./config.ts";
import { answer, type Answer, type Ctx, launchFor, modalFor, type Press } from "./flow.ts";
import { memoryStore } from "./forum.ts";
import { HuntPoster } from "./hunts.ts";
import { decodeId, type Id } from "./ids.ts";
import { Lexicon } from "./lexicon.ts";
import { narrationParts } from "./narration/index.ts";
import { PartyPoster } from "./party.ts";
import { ThreadBudget } from "./publish.ts";
import { recording } from "./record.ts";
import { isFlight, SYNDICATE, syndicateName } from "./screens/crime.ts";
import { LISTS } from "./screens/market.ts";
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
  ) {}

  async send(p: Omit<Press, "user" | "interaction" | "guild" | "channel">): Promise<Card> {
    this.run.presses++;
    const a = await answer(this.ctx, {
      ...p,
      user: this.user,
      guild: "scripted",
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
  /** How the syndicate NPC spoken to after the betrayal holds the character, and whether it offered only the cold shoulder. */
  syndicateMood: string;
  turnedAway: boolean;
  alignment: number;
  band: string;
  audit: string[];
  log: string[];
}

/** The act kinds the crime walk records for the fixtures, latest accepted reply of each. */
export const CRIME_ACTS = [api.ActSteal, api.ActFence, api.ActPayFine, api.ActFlee] as const;

// structural: the world's ticks a day and an hour (sim/sheets units), the
// ledger's prefix for a material, the material and recipe the walk shapes
// its tools from, the topics and choices it answers, and how far it goes.
const TICKS_PER_DAY = 144;
const TICKS_PER_HOUR = 6;
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
 * grudge, pressing only what the cards offer. It shapes tools, sells them
 * to its settlement's trader and lifts them back off the trader's stall,
 * fences them at the den, is held at the gate and pays once and runs once,
 * answers the invitation at the fence, names the fence to the watch
 * captain and ends turned away by the syndicate. The operator only sets
 * a manual clock and stocks the tools' material and a little coin; every
 * haul is the trader's real stock.
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
  /** Presses the fight's best winning option until it is over, as a tester does; a theft already caught is backed out of before a second failure downs the thief. */
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

  /** Mends the hand's weapon at the forge once it is a third worn, as a tester would. */
  const mend = async () => {
    const hand = (await sheet()).kit.find((i) => i.worn === "hand");
    if (!hand || (hand.durability * 3 >= hand.max && !hand.dormant)) return;
    const cost = (await world.options(id)).purse.hand?.repair;
    if (cost?.material && cost.units) await correct(MATERIAL_ASSET + cost.material, cost.units);
    await p.command("character");
    await p.press("item", undefined, hand.id);
    if (p.has("repair", hand.id)) await p.press("repair", hand.id);
  };
  /** What the fences and the trader paid past the walk's capital goes back to the operator: a lone character's coin would fill the faucet's band and close the day's budget. */
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
  /** Opens the where card, waiting the hours out until who is here. */
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

if (import.meta.main && !["party", "crime"].includes(process.env.SCRIPTED ?? "")) {
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
