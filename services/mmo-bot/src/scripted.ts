import type * as api from "./api.ts";
import { type Card, problems } from "./card.ts";
import { answer, type Ctx, launchFor, modalFor, type Press } from "./flow.ts";
import { decodeId } from "./ids.ts";
import { Lexicon } from "./lexicon.ts";
import { recording } from "./record.ts";
import { LISTS } from "./screens/market.ts";
import { httpWorld, type World } from "./world.ts";

/**
 * The scripted client: one player through the first sitting (GDD 3.1),
 * pressing only what the bot's cards offer through the same handlers
 * Discord drives; every card is checked against the card standard and the
 * conservation audit runs at the end.
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
  audit: string[];
  log: string[];
}

export async function scripted(
  ctx: Ctx,
  opts: { operator?: { url: string; token: string }; user?: string } = {},
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
  /** Presses the first button or select whose action (and target, if given) matches. */
  const press = async (action: string, target?: string, value?: string) => {
    for (const row of card.rows) {
      if ("buttons" in row) {
        for (const b of row.buttons) {
          if (b.kind !== "page" || b.disabled) continue;
          const id = decodeId(b.customId);
          if (id?.action !== action || (target !== undefined && id.target !== target)) continue;
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
        ? r.buttons.some((b) => {
            if (b.kind !== "page" || b.disabled) return false;
            const id = decodeId(b.customId);
            return id?.action === action && (target === undefined || id.target === target);
          })
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

  run.ticks = (await world.options(id)).tick - t0;
  if (opts.operator) {
    const res = await fetch(`${opts.operator.url}/v1/operator/audit`, {
      headers: { authorization: `Bearer ${opts.operator.token}` },
    });
    run.audit = ((await res.json()) as api.Audit).discrepancies ?? [];
  }
  return run;
}

if (import.meta.main) {
  const url = process.env.MMO_WORLD_URL ?? "http://localhost:8080";
  const samples: Record<string, unknown> = {};
  const base: World = httpWorld(url, process.env.MMO_API_TOKEN ?? "");
  const world = process.env.RECORD ? recording(base, samples) : base;
  const lex = new Lexicon(await world.lexicon());
  const started = Date.now();
  const r = await scripted(
    { world, lex, threatLine: lex.numbers.ambushLine },
    { operator: { url, token: process.env.MMO_OPERATOR_TOKEN ?? "local-operator" } },
  ).catch((e: unknown) => {
    console.error(e);
    process.exit(2);
  });
  console.log(
    JSON.stringify({ ...r, seconds: Math.round((Date.now() - started) / 1000) }, null, 2),
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
      !r.guild
      ? 1
      : 0,
  );
}
