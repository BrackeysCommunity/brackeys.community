import {
  type Button,
  buttonRows,
  type Modal,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, num, plural } from "../units.ts";
import {
  back,
  banner,
  btn,
  buttonLabel,
  option,
  paged,
  PRIVATE,
  ROW_MOST,
  SELECT_MOST,
} from "./common.ts";
import { REWARDS } from "./goals.ts";

/**
 * /guild (GDD 4.8, 4.14, 4.16): your guild's members and ranks, its
 * treasury and bank, the settlements it runs with their structures, its
 * works, and founding: a guild, or a settlement on the tile you stand on.
 */

export type GuildView = "members" | "bank" | "places" | "works";

/** What a bank select has picked to move, before the amount: a gift to the guild, or a draw from its stock. */
export interface BankPick {
  act: "give" | "draw";
  asset: string;
}

const COIN = "coin";

/** What an asset is counted in: coin, or the good's own name. */
function unitOf(asset: string, lex: Lexicon): string {
  return asset === COIN ? COIN : lex.material(asset);
}

/** The amounts a give, draw or pay select steps through. */
const STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/** The steps under the most, then the most itself; none when there is nothing to move. */
function ladder(most: number): number[] {
  return most > 0 ? [...STEPS.filter((n) => n < most), most] : [];
}

/** Something a give, draw or pay may move, and a line about how much of it there is. */
interface Movable {
  asset: string;
  description: string;
}

/** The first pick of a move: what. */
function whatSelect(
  customId: string,
  placeholder: string,
  items: readonly Movable[],
  lex: Lexicon,
): Row {
  return {
    select: {
      customId,
      placeholder,
      options: items
        .slice(0, SELECT_MOST)
        .map((x) => option(capitalise(unitOf(x.asset, lex)), x.asset, x.description)),
    },
  };
}

/** The second pick of a move: how much, up to the most, which mostLabel marks. */
function amountSelect(
  customId: string,
  placeholder: string,
  unit: string,
  most: number,
  mostLabel: string,
  valueOf: (n: number) => string,
  describe?: (n: number) => string,
): Row {
  return {
    select: {
      customId,
      placeholder,
      options: ladder(most).map((n) =>
        option(`${n === most ? mostLabel : ""}${amount(n, unit)}`, valueOf(n), describe?.(n)),
      ),
    },
  };
}

/** A waiting payment: how much of what, and to whom. */
function payment(a: api.Approval, lex: Lexicon): string {
  return `${amount(a.units, unitOf(a.material ?? COIN, lex))} to ${a.to}`;
}

/** The guilds that invited the viewer, a button each. */
function joinButtons(g: api.Guild, v: number, most: number): Button[] {
  return g.invites
    .slice(0, most)
    .map((p) => btn(buttonLabel(`Join ${p.label}`), "gld-join", p.value, v, { style: "success" }));
}

function base(g: api.Guild, suffix: string, title: string): Omit<Card, "rows" | "footer"> {
  return {
    context: PRIVATE,
    author: authorLine("Guild", g.name || "No guild", suffix),
    title,
    picture: banner({ banner: g.banner, name: g.name || "your settlement" }),
    colour: COLOUR.rust,
  };
}

/** A cost: goods of a tag, or coin; bare numbers for a table cell whose header names the units. */
function cost(lines: readonly api.CostLine[] | undefined, cell = false): string {
  const line = (l: api.CostLine) => {
    if (cell) return `${num(l.quantity)} ${l.tag ?? "coin"}`;
    return l.tag ? `${amount(l.quantity, "goods")} of ${l.tag}` : amount(l.quantity, "coin");
  };
  return (lines ?? []).map(line).join(", ") || "none";
}

/** A charter's cost as cost lines. */
function charterCost(c: api.Charter): api.CostLine[] {
  return [
    { tag: "timber", quantity: c.timber },
    { tag: "stone", quantity: c.stone },
    { quantity: c.coin },
  ];
}

/** What a work gives while stocked, by the rule it changes. */
function gives(w: api.GuildWork): string {
  switch (w.gives) {
    case "station-fee":
      return `station fees ${num(w.by)}% off`;
    case "threat":
      return `${amount(w.by, "threat")} off a day`;
    case "rest":
      return `rest in ${plural(w.by, "tick")}`;
    case "raid-defence":
      return `raid marks ${num(w.by)}% lower`;
    case "market-fee":
      return `market fee ${num(w.by)}% lower`;
    case "mount-upkeep":
      return `mount upkeep ${num(w.by)}% off`;
    default:
      return `${w.gives.replace(/-/g, " ")} by ${num(w.by)} pts`;
  }
}

/** A guild's tabs: members, the bank, settlements, works. */
function tabs(g: api.Guild, view: GuildView, v: number): Button[] {
  const all: [GuildView, string][] = [
    ["members", "Members"],
    ["bank", "Bank"],
    ["places", "Settlements"],
    ["works", "Works"],
  ];
  return all.filter(([id]) => id !== view).map(([id, label]) => btn(label, "guild", id, v));
}

/** The guild page, or what founding one takes when the character has none. */
export function guildCard(
  o: api.Options,
  g: api.Guild,
  lex: Lexicon,
  view: GuildView = "members",
  notice?: string,
  page = 0,
): Card {
  const v = o.version;
  if (!g.id) return noGuildCard(o, g, notice);
  if (view === "bank") return bankCard(o, g, lex, undefined, notice);
  if (view === "places") return placesCard(o, g, lex, undefined, notice);
  if (view === "works") return worksCard(o, g, lex, notice);
  const rows: Row[] = [];
  const acts: Button[] = [];
  if (g.charter.can)
    acts.push(
      btn(
        g.charter.take ? "Charter this settlement" : "Found a settlement here",
        "gld-found",
        g.charter.take ? "take" : "new",
        v,
        { style: "success" },
      ),
    );
  // A server's guild is left by joining or founding another: the world does both at once.
  if (g.server)
    acts.push(
      ...joinButtons(g, v, 2),
      btn("Found a guild", "gld-name", "", v, { style: "primary" }),
    );
  acts.push(btn("Leave", "gld-leave", "", v, { style: "danger" }));
  rows.push(...buttonRows(acts.slice(0, ROW_MOST)));
  for (const a of g.approvals.filter((x) => x.can).slice(0, 1))
    rows.push({
      buttons: [btn(buttonLabel(`Approve: ${payment(a, lex)}`), "gld-appr", a.id, v)],
    });
  rows.push({
    select: {
      customId: encodeId("gld-member", "", v),
      placeholder: "A member: ranks, votes, the bank",
      options: memberOptions(g, page),
    },
  });
  if (g.officer && g.near.length)
    rows.push({
      select: {
        customId: encodeId("gld-invite", "", v),
        placeholder: "Invite someone standing here",
        options: g.near.slice(0, SELECT_MOST).map((p) => option(p.label, p.value)),
      },
    });
  rows.push({ buttons: [...tabs(g, "members", v), back(v)] });
  return {
    ...base(g, "Members", notice ?? g.name ?? "Your guild"),
    description: g.full
      ? `A guild of ${plural(g.members.length, "member")}, led by ${g.leader ?? "nobody yet"}.`
      : `${plural(g.members.length, "member")}: a guild needs ${amount(g.least, "members")} to found a settlement.`,
    table: {
      header: ["Member", "Role", "Given, season (coin)", "Given, all time (coin)"],
      rows: g.members
        .slice(0, 15)
        .map((m) => [m.name.slice(0, 20), role(m), num(m.season), num(m.put)]),
    },
    fields: [
      { name: "Treasury", value: amount(g.treasury, "coin"), inline: true },
      {
        name: "Bank",
        value: g.bank.length
          ? g.bank
              .slice(0, 6)
              .map((b) => amount(b.units, lex.material(b.material)))
              .join(", ")
          : "empty",
        inline: true,
      },
      {
        name: "Officers named",
        value: `${num(g.named)} of ${amount(g.officersMax, "officers")}`,
        inline: true,
      },
      ...(g.officer
        ? [{ name: "You may pay today", value: amount(g.spend, "coin"), inline: true }]
        : []),
      ...(g.approvals.length
        ? [
            {
              name: "Waiting for a second officer",
              value: g.approvals
                .slice(0, 5)
                .map(
                  (a) =>
                    `${payment(a, lex)}, asked by ${a.by}${a.goods ? `: worth ${amount(a.value, "coin")}, approved at the bank` : ""}`,
                )
                .join("\n"),
              inline: false,
            },
          ]
        : []),
      ...(g.votes.length
        ? [
            {
              name: "Votes open",
              value: g.votes
                .map((x) => `${x.target} as ${x.role}: ${num(x.for)} of ${amount(x.need, "votes")}`)
                .join("\n"),
              inline: false,
            },
          ]
        : []),
    ],
    footer: "Gifts are ranked by season and all time; giving and drawing are on the Bank page.",
    rows,
  };
}

/** Where the bank's goods move, for a card drawn away from it. */
function bankPlace(g: api.Guild): string {
  return g.settlements.length
    ? `Given, drawn and paid out at ${g.settlements
        .slice(0, 3)
        .map((x) => x.name)
        .join(" or ")}; coin from anywhere.`
    : "The guild runs no settlement to keep goods in; it takes coin from anywhere.";
}

/**
 * The bank: give what you carry, draw stock at cost. Each takes two
 * picks, what and then how much; goods move only where the bank stands.
 */
export function bankCard(
  o: api.Options,
  g: api.Guild,
  lex: Lexicon,
  pick?: BankPick,
  notice?: string,
): Card {
  const v = o.version;
  const carried = [
    { asset: COIN, units: o.purse.coin },
    ...(g.bankHere
      ? [
          { asset: "provisions", units: o.purse.provisions },
          ...o.purse.goods.map((x) => ({ asset: x.material, units: x.units })),
        ]
      : []),
  ]
    .filter((x) => x.units > 0)
    .map((x) => ({ ...x, description: `You carry ${amount(x.units, unitOf(x.asset, lex))}` }));
  const drawable = g.bankHere ? g.bank.filter((b) => b.draw > 0) : [];
  const giving = pick?.act === "give" ? carried.find((x) => x.asset === pick.asset) : undefined;
  const drawing =
    pick?.act === "draw" ? drawable.find((b) => b.material === pick.asset) : undefined;
  const rows: Row[] = [];
  if (carried.length)
    rows.push(
      whatSelect(
        encodeId("gld-give", "", v),
        giving ? `Giving: ${unitOf(giving.asset, lex)}` : "Give to the guild: pick what",
        carried,
        lex,
      ),
    );
  if (drawable.length)
    rows.push(
      whatSelect(
        encodeId("gld-take", "", v),
        drawing
          ? `Drawing: ${lex.material(drawing.material)}`
          : "Draw from the bank at cost: pick what",
        drawable.map((b) => ({
          asset: b.material,
          description: `Up to ${amount(b.draw, lex.material(b.material))}, at ${amount(b.value, "coin")} each`,
        })),
        lex,
      ),
    );
  if (giving)
    rows.push(
      amountSelect(
        encodeId("gld-dep", "", v),
        `How much ${unitOf(giving.asset, lex)} to give`,
        unitOf(giving.asset, lex),
        giving.units,
        "All: ",
        (n) => target(":", giving.asset, n),
      ),
    );
  if (drawing)
    rows.push(
      amountSelect(
        encodeId("gld-draw", "", v),
        `How much ${lex.material(drawing.material)} to draw`,
        lex.material(drawing.material),
        drawing.draw,
        "The most you may: ",
        (n) => target(":", drawing.material, n),
        (n) => `Costs ${amount(n * drawing.value, "coin")}`,
      ),
    );
  rows.push({ buttons: [...tabs(g, "bank", v), back(v)] });
  return {
    ...base(g, "Bank", notice ?? `The bank of ${g.name}`),
    description: g.bankHere
      ? "Give coin, provisions or goods you carry, or draw stock at cost: pick what, then how much."
      : "Give coin from anywhere. Goods go into and out of the bank where it stands.",
    table: g.bank.length
      ? {
          header: ["Stock", "Held (goods)", "At cost (coin each)", "You may draw (goods)"],
          rows: g.bank
            .slice(0, 15)
            .map((b) => [
              capitalise(lex.material(b.material)).slice(0, 20),
              num(b.units),
              num(b.value),
              num(g.bankHere ? b.draw : 0),
            ]),
        }
      : undefined,
    fields: [
      { name: "Treasury", value: amount(g.treasury, "coin"), inline: true },
      {
        name: "You carry",
        value: [
          amount(o.purse.coin, "coin"),
          amount(o.purse.provisions, "provisions"),
          ...o.purse.goods.slice(0, 6).map((x) => amount(x.units, lex.material(x.material))),
        ].join(", "),
        inline: true,
      },
      ...(g.bankHere ? [] : [{ name: "The bank's goods", value: bankPlace(g), inline: false }]),
    ],
    footer: `A draw is paid for at cost into the treasury, up to ${num(g.drawShare)}% of what you gave unless an officer allows more.`,
    rows,
  };
}

function role(m: api.GuildMember): string {
  return m.leader ? "leader" : m.admin ? "admin" : m.officer ? "officer" : "member";
}

/** One page of the member select: office holders first, then by rank; its last option turns the page. */
function memberOptions(g: api.Guild, page: number) {
  const held = (m: api.GuildMember) => (m.leader || m.officer || m.admin ? 0 : 1);
  return paged(
    [...g.members].sort((a, b) => held(a) - held(b)),
    page,
    (m) => option(`${m.name} (${role(m)})`, m.id),
    "members",
  );
}

/** One member: what the viewer may do about them. An officer sets the bank's rule, names and pays; anyone votes. */
export function memberCard(
  o: api.Options,
  g: api.Guild,
  id: string,
  lex: Lexicon,
  notice?: string,
  pay?: string,
): Card {
  const v = o.version;
  const m = g.members.find((x) => x.id === id);
  const acts: Button[] = [];
  const act = (label: string, ...parts: (string | number)[]) =>
    acts.push(btn(buttonLabel(label), "gld-act", target(":", ...parts), v));
  if (m && g.officer) {
    if (!m.officer && !m.leader && !m.admin)
      act(
        m.draw ? "Back to the bank's usual share" : "May draw freely",
        "allow",
        m.id,
        m.draw ? 0 : 1,
      );
    if (m.canPromote) act("Name an officer", "promote", m.id, "-");
  }
  if (m?.removable) act(`Vote to remove as ${m.removable}`, "vote", m.id, m.removable);
  // Coin is paid from the treasury anywhere; goods where both stand at the bank.
  const payable =
    m && g.officer
      ? [
          {
            asset: COIN,
            units: g.treasury,
            value: 1,
            description: `The treasury holds ${amount(g.treasury, "coin")}`,
          },
          ...(m.payGoods
            ? g.bank.map((b) => ({
                asset: b.material,
                units: b.units,
                value: b.value,
                description: `The bank holds ${amount(b.units, lex.material(b.material))}, worth ${amount(b.value, "coin")} each`,
              }))
            : []),
        ].filter((x) => x.units > 0)
      : [];
  const paying = payable.find((x) => x.asset === pay);
  const rows: Row[] = [];
  if (m && payable.length)
    rows.push(
      whatSelect(
        encodeId("gld-pay", m.id, v),
        paying ? `Paying: ${unitOf(paying.asset, lex)}` : "Pay from the guild: pick what",
        payable,
        lex,
      ),
    );
  if (m && paying)
    rows.push(
      amountSelect(
        encodeId("gld-act", target(":", "pay", m.id, paying.asset), v),
        `How much ${unitOf(paying.asset, lex)} to pay ${m.name}`.slice(0, 100),
        unitOf(paying.asset, lex),
        paying.units,
        "All: ",
        String,
        (n) =>
          `${paying.asset === COIN ? "" : `Worth ${amount(n * paying.value, "coin")}. `}${
            n * paying.value > g.spend ? "Waits for a second officer" : "Paid at once"
          }`,
      ),
    );
  rows.push(...buttonRows([...acts, btn("Guild", "guild", "members", v, { emoji: "↩" })]));
  return {
    ...base(g, "A member", notice ?? m?.name ?? "No such member"),
    description: m
      ? `${capitalise(role(m))} of ${g.name}${m.draw ? ", allowed to draw freely from the bank" : ""}.`
      : "They are no longer in the guild.",
    fields: m
      ? [
          { name: "Given this season", value: amount(m.season, "coin"), inline: true },
          { name: "Given, all time", value: amount(m.put, "coin"), inline: true },
          ...(g.officer
            ? [{ name: "You may pay today", value: amount(g.spend, "coin"), inline: true }]
            : []),
          ...(g.officer && g.bank.length && !m.payGoods
            ? [{ name: "The bank's goods", value: bankPlace(g), inline: false }]
            : []),
        ]
      : undefined,
    footer:
      "A vote carries once enough of the active members have cast it; no vote stands against a server's admin.",
    rows,
  };
}

/**
 * Leaving, asked twice: the last member of a founded guild ends it, and what
 * it holds is gone.
 */
export function leaveCard(o: api.Options, g: api.Guild): Card {
  const v = o.version;
  const last = g.members.length === 1 && !g.server;
  return {
    ...base(g, "Leaving", `Leave ${g.name}?`),
    description: last
      ? `You are its last member: ${g.name} ends when you go. Its treasury and bank are lost to you${g.settlements.length ? ", and its settlements go back to their keepers" : ""}.`
      : "You keep what you carry; what you gave stays with the guild. Coming back takes an officer's invitation.",
    fields: [
      { name: "Treasury", value: amount(g.treasury, "coin"), inline: true },
      {
        name: "Bank",
        value: amount(
          g.bank.reduce((n, b) => n + b.units, 0),
          "goods",
        ),
        inline: true,
      },
    ],
    footer: "Leaving cannot be taken back.",
    rows: buttonRows([
      btn(last ? "Leave and end the guild" : "Leave", "gld-leave", "yes", v, { style: "danger" }),
      btn("Stay", "guild", "members", v, { emoji: "↩" }),
    ]),
  };
}

function noGuildCard(o: api.Options, g: api.Guild, notice?: string): Card {
  const v = o.version;
  const buttons: Button[] = [
    btn("Found a guild", "gld-name", "", v, { style: "primary" }),
    ...joinButtons(g, v, 3),
    back(v),
  ];
  return {
    context: PRIVATE,
    author: authorLine("Guild", "No guild"),
    title: notice ?? "You belong to no guild",
    picture: "form",
    description: `Found one under a name, or accept an invitation. A guild of ${amount(g.least, "members")} can charter a settlement.`,
    footer: "A server's own guild takes its players in when they arrive.",
    rows: buttonRows(buttons),
  };
}

/**
 * The settlements page. A raise takes two picks: the structure, then the
 * reward its goals carry, none or up to what the world says the treasury
 * and the officer's day cover.
 */
export function placesCard(
  o: api.Options,
  g: api.Guild,
  lex: Lexicon,
  raise?: string,
  notice?: string,
): Card {
  const v = o.version;
  const here = g.settlements.find((s) => s.here);
  const rows: Row[] = [];
  if (here && g.officer) {
    const raisable = here.structures.filter((s) => s.canRaise);
    const raising = raisable.find((s) => s.kind === raise);
    const rise = (s: api.Structure) =>
      `${lex.name("settlements.structures", s.kind)} to tier ${s.tier + 1}`;
    if (raisable.length)
      rows.push({
        select: {
          customId: encodeId("gld-raise", "", v),
          placeholder: (raising
            ? `Raising: ${rise(raising)}`
            : "Raise a structure: pick which"
          ).slice(0, 100),
          options: raisable.slice(0, SELECT_MOST).map((s) => option(rise(s), s.kind, cost(s.next))),
        },
      });
    if (raising) {
      const goals = raising.next?.length ?? 0;
      rows.push({
        select: {
          customId: encodeId("gld-rwd", raising.kind, v),
          placeholder: "A reward on each of its goals, from the treasury",
          options: REWARDS.filter((n) => n <= raising.rewardMost).map((n) => ({
            label: n ? `${amount(n, "coin")} on each goal` : "No reward: post its goals",
            value: String(n),
            description: n
              ? `${plural(goals, "goal")}: ${amount(n * goals, "coin")} from the treasury, and the listing fees`
              : "Nothing leaves the treasury",
          })),
        },
      });
    }
  }
  if (here) {
    // A worn structure is mended a part at a time or whole; a closed one's part reopens it.
    const steps = here.structures.flatMap((s) => (s.repairs ?? []).map((r) => ({ s, r })));
    if (steps.length)
      rows.push({
        select: {
          customId: encodeId("gld-mend", "", v),
          placeholder: "Repair a structure with what you carry",
          options: steps
            .slice(0, SELECT_MOST)
            .map(({ s, r }) =>
              option(
                `${lex.name("settlements.structures", s.kind)}: ${s.closed ? "reopen at" : "up to"} ${num(Math.min(here.conditionMax, s.condition + r.points))} pts`,
                target(":", s.kind, r.points),
                `Takes ${cost(r.cost)}`,
              ),
            ),
        },
      });
  }
  rows.push({ buttons: [...tabs(g, "places", v), back(v)] });
  // What cannot be raised yet because nothing reads it: shown, not offered.
  const later = (here ?? g.settlements[0])?.structures.filter((x) => x.waits) ?? [];
  const lines = g.settlements.flatMap((s) =>
    s.structures
      .filter((x) => x.stands)
      .map((x) => [
        s.name.slice(0, 16),
        lex.name("settlements.structures", x.kind).slice(0, 14),
        num(x.tier),
        x.closed ? "closed" : num(x.condition),
      ]),
  );
  return {
    ...base(
      g,
      "Settlements",
      notice ?? `${plural(g.settlements.length, "settlement")} run by ${g.name}`,
    ),
    description: g.settlements.length
      ? "Structures rise by pooled goals and wear when nobody uses them; any member may repair them."
      : "The guild runs no settlement yet.",
    table: lines.length
      ? { header: ["Settlement", "Structure", "Tier", "Condition (pts)"], rows: lines.slice(0, 15) }
      : undefined,
    fields: [
      ...g.settlements.slice(0, 3).map((s) => ({
        name: s.name,
        value: `Treasury ${amount(s.treasury, "coin")}`,
        inline: true,
      })),
      ...(later.length
        ? [
            {
              name: "Later: raised once what they do is built",
              value: later
                .map(
                  (x) =>
                    `${lex.name("settlements.structures", x.kind)}${x.stands ? ", a tier up" : ""}`,
                )
                .join("; "),
              inline: false,
            },
          ]
        : []),
      {
        name: "A charter where you stand",
        value: [
          g.charter.can ? "The guild can charter here." : capitalise(g.charter.why ?? "Not here."),
          ...Object.entries(g.charter.fields ?? {}).map(([k, n]) => `${k} ${num(n)} pts`),
        ].join("\n"),
        inline: false,
      },
    ],
    footer: `A charter takes ${cost(charterCost(g.charter))}.`,
    rows,
  };
}

function worksCard(o: api.Options, g: api.Guild, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const toggles = g.works
    .filter((w) => w.can)
    .map((w) =>
      btn(
        buttonLabel(`${w.on ? "Stop" : "Start"}: ${lex.name("settlements.guild-works", w.id)}`),
        "gld-work",
        target(":", w.id, w.on ? 0 : 1),
        v,
      ),
    );
  const lit = g.works.filter((w) => w.on && w.spares);
  return {
    ...base(g, "Works", notice ?? "Guild works"),
    description:
      "A work consumes stock from the bank each world day, starting the day after it is switched on, and lapses the day it runs out; what it eats is gone. It spares fees and upkeep only up to what that day's stock was worth.",
    fields: lit.length
      ? [
          {
            name: "Since it was switched on here",
            value: lit
              .map(
                (w) =>
                  `${lex.name("settlements.guild-works", w.id)}: spared ${amount(w.gave ?? 0, "coin")} of the ${amount(w.used ?? 0, "coin")} its stock was worth, over ${plural(w.ran ?? 0, "day")}`,
              )
              .join("\n")
              .slice(0, 1024),
          },
        ]
      : undefined,
    table: {
      header: ["Work", "Uses a day (goods or coin)", "Gives (while stocked)", "Stock (days)"],
      rows: g.works.map((w) => [
        lex.name("settlements.guild-works", w.id).slice(0, 16),
        cost(w.uses, true).slice(0, 26),
        gives(w),
        w.waits ? "later" : w.on ? num(w.days) : "off",
      ]),
    },
    footer: "Officers switch works on at a settlement the guild runs.",
    rows: [
      ...buttonRows(toggles.slice(0, ROW_MOST)),
      { buttons: [...tabs(g, "works", v), back(v)] },
    ],
  };
}

/** The modal that names a new guild or settlement. */
export function nameModal(action: "gld-new" | "gld-chart", version: number, title: string): Modal {
  return {
    customId: encodeId(action, "", version),
    title,
    inputs: [{ id: "name", label: "Name", max: 32, required: true }],
  };
}
