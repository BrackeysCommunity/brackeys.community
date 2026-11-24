import type { Button } from "../../../packages/discord-kit/src/index.ts";
import {
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
import { LISTS } from "./screens/market.ts";
import { httpWorld, type World } from "./world.ts";

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
      } else if (decodeId(row.select.customId)?.action === action) {
        const pick = value ?? row.select.options[0]?.value;
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
        : decodeId(r.select.customId)?.action === action,
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

/** One scripted player pressing only what the bot's cards offer. */
class Player {
  card!: Card;
  id = "";
  private seq = 0;

  constructor(
    private readonly ctx: Ctx,
    readonly user: string,
    private readonly run: PartyRun,
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
        if (id?.action === action) out.push(id);
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
    return this.send({ id, values: value === undefined ? undefined : [value] });
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
        const days = [...new Set(store.keys().filter((k) => k.includes(":cost:")))];
        return Promise.all(days.map((k) => narrator.ledger(Number(k.split(":").at(-1)))));
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

if (import.meta.main && process.env.SCRIPTED !== "party") {
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
