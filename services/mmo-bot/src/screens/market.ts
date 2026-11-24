import {
  type Button,
  buttonRows,
  type EmbedField,
  EMBED_FIELD_VALUE_MAX,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import { chartAlt, chartMarks } from "../../../../packages/mmo-words/src/alt.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR, type Picture } from "../card.ts";
import { encodeId, fields, integerTarget, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, hours, num, percent, plural, signed, signedPercent } from "../units.ts";
import { back, banner, btn, heldOf, priceLadder, PRIVATE } from "./common.ts";

/**
 * /market (GDD 10.6): the book for one material and the eight lists beside
 * it. One select switches list, another switches material.
 */

export const LISTS = [
  { id: "book", label: "The book" },
  { id: "exchange", label: "Exchange" },
  { id: "movers", label: "Movers" },
  { id: "history", label: "Price history" },
  { id: "elsewhere", label: "Elsewhere" },
  { id: "gear", label: "Gear listings" },
  { id: "orders", label: "Faction orders" },
  { id: "mine", label: "Mine" },
  { id: "report", label: "Ledger report" },
] as const;
export type List = (typeof LISTS)[number]["id"];

export function isList(s: string): s is List {
  return LISTS.some((l) => l.id === s);
}

function listLabel(list: List): string {
  return LISTS.find((l) => l.id === list)!.label;
}

/** An order being drafted on the form. */
export interface OrderDraft {
  material: string;
  side: "bid" | "ask";
  price: number;
  units: number;
}

/** A draft as a custom-id target: material.side.price.units. */
export function draftOf(s: string): OrderDraft | null {
  const f = fields(s, ".", 4);
  if (!f) return null;
  const [material, side, price, units] = f;
  const p = integerTarget(price!);
  const u = integerTarget(units!);
  if ((side !== "bid" && side !== "ask") || p === undefined || u === undefined) return null;
  return { material: material!, side, price: p, units: u };
}

export function draftId(d: OrderDraft): string {
  return target(".", d.material, d.side, d.price, d.units);
}

/** The list switcher and, where a list is about one material, the material switcher. */
function switchers(m: api.Market, list: List, v: number, lex: Lexicon): Row[] {
  const rows: Row[] = [
    {
      select: {
        customId: encodeId("mkt-l", m.material, v),
        placeholder: `Showing: ${listLabel(list)}`,
        options: LISTS.filter((l) => l.id !== list).map((l) => ({ label: l.label, value: l.id })),
      },
    },
  ];
  if ((list === "book" || list === "history" || list === "elsewhere") && m.exchange.length > 1)
    rows.push({
      select: {
        customId: encodeId("mkt-m", list, v),
        placeholder: `Material: ${lex.material(m.material)}`,
        options: m.exchange
          .filter((x) => x.material !== m.material)
          .slice(0, 25)
          .map((x) => ({ label: lex.material(x.material), value: x.material })),
      },
    });
  return rows;
}

function base(
  m: api.Market,
  suffix: string,
  title: string,
  picture: Picture | "form" = banner(m, ", over its market"),
): Omit<Card, "rows" | "footer"> {
  return {
    context: PRIVATE,
    author: authorLine("Market", m.name, suffix),
    title,
    picture,
    colour: COLOUR.hazard,
  };
}

/** The book: the best prices each side for one material, and what you can do at once. */
export function bookCard(o: api.Options, m: api.Market, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const b = m.book;
  const name = lex.material(b.material);
  const side = (ls: api.Level[]) =>
    ls.map((l) => [amount(l.price, "coin"), amount(l.units, "goods"), l.who.slice(0, 24)]);
  const rows = [
    ...side(b.asks)
      .reverse()
      .map((r) => ["ask", ...r]),
    ...side(b.bids).map((r) => ["bid", ...r]),
  ];
  const have = heldOf(o.purse, b.material);
  const actions: Button[] = [];
  if (have > 0 && b.bids.length)
    actions.push(
      btn(`Sell ${amount(have, name)} now`, "mkt-sell", target(":", b.material, have), v, {
        style: "success",
      }),
    );
  if (b.asks.length)
    actions.push(btn(`Buy ${amount(1, name)} now`, "mkt-take", target(":", b.material, 1), v));
  actions.push(
    btn(
      "Post an order",
      "mkt-o",
      draftId({
        material: b.material,
        side: have > 0 ? "ask" : "bid",
        price: Math.max(1, b.value),
        units: 1,
      }),
      v,
    ),
  );
  actions.push(back(v));
  return {
    ...base(m, listLabel("book"), notice ?? `${name} at ${m.name}`),
    description: rows.length
      ? `Matched by price, then time; what you post waits in escrow. Each fill pays a ${percent(m.fee)} fee from the seller.`
      : "Nobody is buying or selling this here yet. Post the first order.",
    table: rows.length
      ? { header: ["Side", "Price (coin each)", "Units (goods)", "Whose"], rows }
      : undefined,
    fields: [
      { name: "Last", value: b.last ? amount(b.last, "coin") : "no trade yet", inline: true },
      { name: "Reference value", value: amount(b.value, "coin"), inline: true },
      { name: "You hold", value: amount(have, name), inline: true },
    ],
    footer: `Orders last ${plural(m.days, "day")}; you may hold ${amount(m.limit, "orders")} open.`,
    rows: [...switchers(m, "book", v, lex), { buttons: actions }],
  };
}

export function exchangeCard(o: api.Options, m: api.Market, lex: Lexicon): Card {
  const v = o.version;
  return {
    ...base(m, listLabel("exchange"), `Everything traded at ${m.name}`),
    description: m.exchange.length ? undefined : "Nothing has traded here yet.",
    table: m.exchange.length
      ? {
          header: ["Good", "Last (coin)", "Week (%)", "Bid (coin)", "Ask (coin)", "Traded (goods)"],
          rows: m.exchange
            .slice(0, 20)
            .map((x) => [
              lex.material(x.material),
              x.last ? num(x.last) : "–",
              x.last ? signedPercent(x.change) : "–",
              x.bid ? num(x.bid) : "–",
              x.ask ? num(x.ask) : "–",
              num(x.units),
            ]),
        }
      : undefined,
    footer: "The week's change is against the close seven days ago.",
    rows: [...switchers(m, "exchange", v, lex), { buttons: [back(v)] }],
  };
}

/** A mover as one line: the good, its change and last price, and why. */
export function moverLine(m: api.Mover, lex: Lexicon): string {
  return `${lex.material(m.material)}: ${signedPercent(m.change)} to ${amount(m.last, "coin")}${m.cause ? `, after ${m.cause}` : ""}`;
}

export function moversCard(o: api.Options, m: api.Market, lex: Lexicon): Card {
  const v = o.version;
  return {
    ...base(m, listLabel("movers"), "What rose and fell this week"),
    description: m.movers.length ? undefined : "Nothing has moved yet.",
    table: m.movers.length
      ? {
          header: ["Good", "Change (%)", "Last (coin)", "Because"],
          rows: m.movers.map((x) => [
            lex.material(x.material),
            signedPercent(x.change),
            num(x.last),
            (x.cause || "trade alone").slice(0, 36),
          ]),
        }
      : undefined,
    footer: "Every mover names the heaviest news near the market that day.",
    rows: [...switchers(m, "movers", v, lex), { buttons: [back(v)] }],
  };
}

export function historyCard(o: api.Options, m: api.Market, h: api.History, lex: Lexicon): Card {
  const v = o.version;
  const unit = `coin per ${h.name}`;
  return {
    ...base(m, listLabel("history"), `${h.name}: closing price by day`, {
      media: h.chart,
      alt: chartAlt({ title: `${h.name} at close`, unit, days: h.days }),
    }),
    description: h.days.length
      ? `${capitalise(unit)} up the left, world days along the bottom; a lettered line marks a cause, keyed below.`
      : "No day has closed with a trade yet.",
    fields: markedFields(h.days),
    footer: `${plural(h.days.length, "day")} shown; a day with no trade closes at the last price.`,
    rows: [...switchers(m, "history", v, lex), { buttons: [back(v)] }],
  };
}

/** The "Marked" field: each letter on the chart keyed to its day, close and cause, split to fit a field. */
export function markedFields(days: readonly api.PricePt[]): EmbedField[] {
  const close = new Map(days.map((d) => [d.day, d.close]));
  const lines = chartMarks(days).map(
    (x) => `**${x.label}** day ${num(x.day)}, ${amount(close.get(x.day) ?? 0, "coin")}: ${x.cause}`,
  );
  const out: EmbedField[] = [];
  let value = "";
  for (const line of lines) {
    const cut = line.slice(0, EMBED_FIELD_VALUE_MAX);
    if (value && value.length + 1 + cut.length > EMBED_FIELD_VALUE_MAX) {
      out.push({ name: out.length ? "Marked, continued" : "Marked", value });
      value = "";
    }
    value = value ? `${value}\n${cut}` : cut;
  }
  if (value) out.push({ name: out.length ? "Marked, continued" : "Marked", value });
  return out;
}

export function elsewhereCard(o: api.Options, m: api.Market, lex: Lexicon): Card {
  const v = o.version;
  const name = lex.material(m.material);
  return {
    ...base(m, listLabel("elsewhere"), `${name} in other settlements`),
    description:
      "News walks: a price is as old as the journey from there, or as your own last visit if that is newer.",
    table: m.elsewhere.length
      ? {
          header: ["Settlement", "Price (coin)", "Age (hours)", "From"],
          rows: m.elsewhere.map((f) => [
            f.name,
            f.known && f.price ? num(f.price) : "–",
            f.known ? hours(f.age) : "no news",
            f.own ? "your visit" : f.known ? "the road" : "–",
          ]),
        }
      : undefined,
    footer: "A hauler who has just arrived knows more than the board.",
    rows: [...switchers(m, "elsewhere", v, lex), { buttons: [back(v)] }],
  };
}

export function gearCard(o: api.Options, m: api.Market, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const buyable = m.gear.filter((l) => !l.mine);
  const rows: Row[] = [...switchers(m, "gear", v, lex)];
  if (buyable.length)
    rows.push({
      select: {
        customId: encodeId("gear-buy", "", v),
        placeholder: "Buy a listing",
        options: buyable.slice(0, 25).map((l) => ({
          label: `${l.name.slice(0, 40)} · ${amount(l.price, "coin")}`,
          value: l.id,
          description: `level ${l.level}, ${amount(l.durability, "durability")}, from ${l.seller.slice(0, 30)}`,
        })),
      },
    });
  rows.push({ buttons: [back(v)] });
  return {
    ...base(m, listLabel("gear"), notice ?? "Gear for sale here"),
    description: m.gear.length
      ? "Each piece is itself: its maker, level, picks and wear. List yours from its item card."
      : "Nothing is listed here. List a piece from its item card.",
    table: m.gear.length
      ? {
          header: ["Piece", "Level", "Picks (count)", "Durability", "Maker (id)", "Price (coin)"],
          rows: m.gear.map((l) => [
            l.name.slice(0, 22),
            `level ${l.level}`,
            num(l.picks),
            `${num(l.durability)}/${num(l.max)}`,
            (l.maker || "unknown").slice(0, 14),
            num(l.price),
          ]),
        }
      : undefined,
    fields: m.wants.length
      ? [
          {
            name: "Wanted",
            value: m.wants
              .slice(0, 5)
              .map(
                (w) =>
                  `${w.what} for ${amount(w.price, "coin")}${w.floor.level ? `, level ${w.floor.level} or more` : ""}${w.floor.durability ? `, ${amount(w.floor.durability, "durability")} or more` : ""}`,
              )
              .join("\n"),
          },
        ]
      : undefined,
    footer: `A sale pays a ${percent(m.fee)} fee from the seller.`,
    rows,
  };
}

/** Faction orders: who buys what here, at what price to you after standing (GDD 10.4, 5.4). */
export function ordersCard(o: api.Options, m: api.Market, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const sells: Button[] = [];
  const carried = [...o.purse.goods, { material: "provisions", units: o.purse.provisions }];
  for (const g of carried) {
    const ord = m.orders.find((x) => x.material === g.material && !x.refuses);
    if (ord && g.units > 0 && sells.length < 10)
      sells.push(
        btn(
          `Sell ${amount(g.units, lex.material(g.material))}`,
          "sell",
          target(":", g.material, g.units),
          v,
          {
            style: "success",
          },
        ),
      );
  }
  const p = o.purse;
  const store: Button[] = [];
  if (p.provision)
    store.push(
      btn(
        `Buy ${amount(5, "provisions")} · ${amount(5 * p.provision, "coin")}`,
        "buy",
        "provisions:5",
        v,
      ),
    );
  for (const mt of (p.mounts ?? []).slice(0, 2))
    store.push(
      btn(
        `Buy a ${lex.name("mounts.kinds", mt.asset)} · ${amount(mt.price, "coin")}`,
        "buy",
        target(":", mt.asset, 1),
        v,
        {
          disabled: p.mounted,
        },
      ),
    );
  if (p.owed) store.push(btn(`Feed your mount · ${amount(p.owed, "provisions")}`, "feed", "", v));
  store.push(back(v));
  return {
    ...base(m, listLabel("orders"), notice ?? "Who is buying here today"),
    description: m.orders.length
      ? "Factions post what they need each world day, priced by urgency; your standing moves what they pay you."
      : "Today's faction orders are filled. New ones stand at the next day's turn.",
    table: m.orders.length
      ? {
          header: ["Good", "Price (coin each)", "To you (coin each)", "Wanted (goods)", "Buyer"],
          rows: m.orders
            .slice(0, 15)
            .map((x) => [
              lex.material(x.material),
              num(x.price),
              x.refuses ? "won't buy" : num(x.yours),
              num(x.wanted),
              x.faction.slice(0, 22),
            ]),
        }
      : undefined,
    footer: `Each fill pays a ${percent(m.fee)} fee; a standing point for every ${amount(m.perPoint, "coin")} sold.`,
    fields: [
      { name: "Your coin", value: amount(p.coin, "coin"), inline: true },
      { name: "Your provisions", value: amount(p.provisions, "provisions"), inline: true },
    ],
    rows: [...switchers(m, "orders", v, lex), ...buttonRows(sells).slice(0, 2), { buttons: store }],
  };
}

export function mineCard(o: api.Options, m: api.Market, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const rows: Row[] = [...switchers(m, "mine", v, lex)];
  if (m.mine.open.length)
    rows.push({
      select: {
        customId: encodeId("withdraw", "", v),
        placeholder: "Withdraw an order",
        options: m.mine.open.slice(0, 25).map((x) => ({
          label: `${x.side} ${x.what.slice(0, 30)} · ${amount(x.price, "coin")}`,
          value: x.id,
          description: `${amount(x.units, "goods")} at ${x.where.slice(0, 30)}`,
        })),
      },
    });
  rows.push({ buttons: [back(v)] });
  return {
    ...base(m, listLabel("mine"), notice ?? "Your orders and ledger"),
    table: m.mine.open.length
      ? {
          header: ["Side", "What", "Price (coin)", "Units (goods)", "Where", "Ends in (hours)"],
          rows: m.mine.open.map((x) => [
            x.side,
            x.what.slice(0, 18),
            num(x.price),
            num(x.units),
            x.where.slice(0, 16),
            hours(x.expires),
          ]),
        }
      : undefined,
    description: m.mine.open.length ? undefined : "You hold no open orders.",
    fields: [
      { name: "In escrow", value: amount(m.mine.escrow, "coin"), inline: true },
      {
        name: "Open",
        value: `${num(m.mine.open.length)} of ${amount(m.limit, "orders")}`,
        inline: true,
      },
      ...(m.mine.young
        ? [
            {
              name: "Given today",
              value: `${num(m.mine.gave)} of ${amount(m.mine.cap, "coin")}`,
              inline: true,
            },
          ]
        : []),
      {
        name: "Ledger",
        value:
          m.mine.entries
            .map((e) => `tick ${num(e.tick)}: ${e.kind}, ${signed(e.units, assetName(e, lex))}`)
            .join("\n") || "no entries",
      },
    ],
    footer: "Every coin and good you hold moves by a ledger entry.",
    rows,
  };
}

function assetName(e: api.Entry, lex: Lexicon): string {
  if (e.goods) return lex.material(e.goods);
  return e.asset === "coin" ? "coin" : "item";
}

export function reportCard(o: api.Options, m: api.Market, lex: Lexicon): Card {
  const v = o.version;
  const r = m.report;
  const card: Card = {
    ...base(
      m,
      listLabel("report"),
      r ? `The ledger, week to day ${num(r.day)}` : "No ledger report yet",
    ),
    footer: r?.every
      ? `Posted every ${plural(r.every, "day")}; fees never move.`
      : "Posted each week; fees never move.",
    rows: [...switchers(m, "report", v, lex), { buttons: [back(v)] }],
  };
  if (!r) {
    card.description = "The first report is posted at the end of the first week.";
    return card;
  }
  card.picture = r.chart
    ? {
        media: r.chart,
        alt: chartAlt({
          title: "coin per active character at each weekly report",
          unit: "coin per active character",
          band: [r.low, r.high],
          latest: { day: r.day, value: r.perActive },
        }),
      }
    : card.picture;
  card.fields = [
    { name: "Supply", value: amount(r.supply, "coin"), inline: true },
    { name: "Active", value: amount(r.active, "people"), inline: true },
    {
      name: "Coin per active character",
      value: `${amount(r.perActive, "coin")}, band ${num(r.low)} to ${amount(r.high, "coin")}`,
      inline: true,
    },
    { name: "Faucet", value: `${amount(r.rate, "coin")} each per day`, inline: true },
    { name: "Paid by factions", value: amount(r.faucet, "coin"), inline: true },
    { name: "Fees", value: amount(r.fees, "coin"), inline: true },
    {
      name: "Velocity",
      value: `${percent(r.velocity)} of each coin changes hands a day`,
      inline: true,
    },
    {
      name: "Most traded",
      value: r.top.map((t) => amount(t.units, lex.material(t.material))).join(", ") || "nothing",
    },
    {
      name: "Conservation",
      value: r.audit ? `${num(r.audit)} discrepancies` : "clean",
      inline: true,
    },
  ];
  return card;
}

/** The order form: side, price and units by selects, then post (GDD 10.3). */
export function orderForm(o: api.Options, m: api.Market, d: OrderDraft, lex: Lexicon): Card {
  const v = o.version;
  const name = lex.material(d.material);
  const ref = Math.max(1, m.book.value);
  const prices = priceLadder(ref, [50, 70, 85, 100, 115, 130, 150, 200]).map((x) => x.price);
  const have = heldOf(o.purse, d.material);
  const units = [...new Set([1, 5, 10, 20, have].filter((n) => n > 0))];
  const coin = d.price * d.units;
  const set = (patch: Partial<OrderDraft>) => draftId({ ...d, ...patch });
  return {
    ...base(
      m,
      "Post an order",
      `${d.side === "bid" ? "Buy" : "Sell"} ${amount(d.units, name)} at ${amount(d.price, "coin")} each`,
      "form",
    ),
    description:
      d.side === "bid"
        ? `${amount(coin, "coin")} goes into escrow until it fills, you withdraw it, or ${plural(m.days, "day")} pass.`
        : `${amount(d.units, name)} goes into escrow; a fill pays you less a ${percent(m.fee)} fee.`,
    fields: [
      { name: "Reference value", value: amount(m.book.value, "coin"), inline: true },
      {
        name: "Best bid",
        value: m.book.bids[0] ? amount(m.book.bids[0].price, "coin") : "none",
        inline: true,
      },
      {
        name: "Best ask",
        value: m.book.asks[0] ? amount(m.book.asks[0].price, "coin") : "none",
        inline: true,
      },
    ],
    footer: "Change one thing at a time; the title says what posting will do.",
    rows: [
      {
        select: {
          customId: encodeId("mkt-os", draftId(d), v),
          placeholder: d.side === "bid" ? "Buying" : "Selling",
          options: [
            { label: "Buy", value: set({ side: "bid" }) },
            { label: "Sell", value: set({ side: "ask" }) },
          ],
        },
      },
      {
        select: {
          customId: encodeId("mkt-op", draftId(d), v),
          placeholder: `Price: ${amount(d.price, "coin")} each`,
          options: prices.map((p) => ({ label: amount(p, "coin each"), value: set({ price: p }) })),
        },
      },
      {
        select: {
          customId: encodeId("mkt-ou", draftId(d), v),
          placeholder: `Units: ${amount(d.units, "goods")}`,
          options: units.map((u) => ({ label: amount(u, "goods"), value: set({ units: u }) })),
        },
      },
      {
        buttons: [
          btn(d.side === "bid" ? "Post the bid" : "Post the ask", "mkt-post", draftId(d), v, {
            style: "success",
          }),
          btn("Back to the book", "market", target(":", "book", d.material), v),
          back(v),
        ],
      },
    ],
  };
}
