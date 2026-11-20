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
import { back, banner, btn, PRIVATE, SELECT_MOST } from "./common.ts";

/**
 * /guild (GDD 4.8, 4.14, 4.16): your guild's members and ranks, its
 * treasury and bank, the settlements it runs with their structures, its
 * works, and founding: a guild, or a settlement on the tile you stand on.
 */

export type GuildView = "members" | "places" | "works";

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

/** A guild's tabs: members, settlements, works. */
function tabs(g: api.Guild, view: GuildView, v: number): Button[] {
  const all: [GuildView, string][] = [
    ["members", "Members"],
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
  if (view === "places") return placesCard(o, g, lex, notice);
  if (view === "works") return worksCard(o, g, lex, notice);
  const rows: Row[] = [];
  const acts: Button[] = [];
  if (o.purse.coin >= 10)
    acts.push(btn(`Give ${amount(10, "coin")}`, "gld-dep", target(":", "coin", 10), v));
  // Goods go into and out of the bank where it stands; coin from anywhere.
  const give = g.bankHere ? o.purse.goods[0] : undefined;
  if (give)
    acts.push(
      btn(
        `Give ${amount(give.units, lex.material(give.material))}`,
        "gld-dep",
        target(":", give.material, give.units),
        v,
      ),
    );
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
  const stock = g.bankHere ? g.bank[0] : undefined;
  if (stock)
    acts.push(
      btn(
        `Draw ${amount(1, lex.material(stock.material))} at cost`,
        "gld-draw",
        target(":", stock.material, 1),
        v,
      ),
    );
  acts.push(btn("Leave", "gld-leave", "", v, { style: "danger" }));
  rows.push(...buttonRows(acts.slice(0, 5)));
  for (const a of g.approvals.filter((x) => x.can).slice(0, 1))
    rows.push({
      buttons: [btn(`Approve: ${a.what} to ${a.to}`.slice(0, 80), "gld-appr", a.id, v)],
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
        options: g.near
          .slice(0, SELECT_MOST)
          .map((p) => ({ label: p.label.slice(0, 90), value: p.value })),
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
      ...(g.bankHere
        ? []
        : [
            {
              name: "The bank's goods",
              value: g.settlements.length
                ? `Given, drawn and paid out at ${g.settlements
                    .slice(0, 3)
                    .map((x) => x.name)
                    .join(" or ")}; coin from anywhere.`
                : "The guild runs no settlement to keep goods in; it takes coin from anywhere.",
              inline: false,
            },
          ]),
      {
        name: "Officers named",
        value: `${num(g.named)} of ${amount(g.officersMax, "officers")}`,
        inline: true,
      },
      ...(g.officer
        ? [{ name: "You may pay today", value: amount(g.spend, "coin"), inline: true }]
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
    footer: `Gifts are ranked by season and all time; a member may draw stock at cost up to ${num(g.drawShare)}% of what it gave.`,
    rows,
  };
}

/** What an officer pays a member from the treasury in one press. */
const PAYMENT = 100;

function role(m: api.GuildMember): string {
  return m.leader ? "leader" : m.admin ? "admin" : m.officer ? "officer" : "member";
}

/** The members a page of the select offers, its last option turning the page: those a vote can stand against first, then by rank. */
function memberOptions(g: api.Guild, page: number): { label: string; value: string }[] {
  const held = (m: api.GuildMember) => (m.leader || m.officer || m.admin ? 0 : 1);
  const all = [...g.members].sort((a, b) => held(a) - held(b));
  const per = SELECT_MOST - 1;
  const from = page * per < all.length ? page * per : 0;
  const out = all.slice(from, from + per).map((m) => ({
    label: `${m.name} (${role(m)})`.slice(0, 90),
    value: m.id,
  }));
  if (all.length > per)
    out.push({
      label: from + per < all.length ? "More members" : "Back to the first members",
      value: target(":", "page", from + per < all.length ? from / per + 1 : 0),
    });
  return out;
}

/** One member: what the viewer may do about them. An officer sets the bank's rule, names and pays; anyone votes. */
export function memberCard(o: api.Options, g: api.Guild, id: string, notice?: string): Card {
  const v = o.version;
  const m = g.members.find((x) => x.id === id);
  const acts: Button[] = [];
  const act = (label: string, ...parts: (string | number)[]) =>
    acts.push(btn(label.slice(0, 80), "gld-act", target(":", ...parts), v));
  if (m && g.officer) {
    if (!m.officer && !m.leader && !m.admin)
      act(
        m.draw ? "Back to the bank's usual share" : "May draw freely",
        "allow",
        m.id,
        m.draw ? 0 : 1,
      );
    if (m.canPromote) act("Name an officer", "promote", m.id, "-");
    if (g.treasury >= PAYMENT) act(`Pay ${amount(PAYMENT, "coin")}`, "pay", m.id, PAYMENT);
  }
  if (m?.removable) act(`Vote to remove as ${m.removable}`, "vote", m.id, m.removable);
  return {
    ...base(g, "A member", notice ?? m?.name ?? "No such member"),
    description: m
      ? `${capitalise(role(m))} of ${g.name}${m.draw ? ", allowed to draw freely from the bank" : ""}.`
      : "They are no longer in the guild.",
    fields: m
      ? [
          { name: "Given this season", value: amount(m.season, "coin"), inline: true },
          { name: "Given, all time", value: amount(m.put, "coin"), inline: true },
        ]
      : undefined,
    footer:
      "A vote carries once enough of the active members have cast it; no vote stands against a server's admin.",
    rows: buttonRows([...acts, btn("Guild", "guild", "members", v, { emoji: "↩" })]),
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
  const buttons: Button[] = [btn("Found a guild", "gld-name", "", v, { style: "primary" })];
  for (const p of g.invites.slice(0, 3))
    buttons.push(btn(`Join ${p.label}`.slice(0, 80), "gld-join", p.value, v, { style: "success" }));
  buttons.push(back(v));
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

function placesCard(o: api.Options, g: api.Guild, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const here = g.settlements.find((s) => s.here);
  const rows: Row[] = [];
  if (here && g.officer) {
    const raisable = here.structures.filter((s) => s.canRaise);
    if (raisable.length)
      rows.push({
        select: {
          customId: encodeId("gld-raise", "", v),
          placeholder: "Raise a structure: post its goals",
          options: raisable.slice(0, SELECT_MOST).map((s) => ({
            label: `${lex.name("settlements.structures", s.kind)} to tier ${s.tier + 1}`.slice(
              0,
              90,
            ),
            value: s.kind,
            description: cost(s.next).slice(0, 90),
          })),
        },
      });
  }
  if (here) {
    // A worn structure is mended a part at a time or whole; a closed one's part reopens it.
    const steps = here.structures.flatMap((s) => (s.repairs ?? []).map((r) => ({ s, r })));
    if (steps.length)
      rows.push({
        select: {
          customId: encodeId("gld-mend", "", v),
          placeholder: "Repair a structure with what you carry",
          options: steps.slice(0, SELECT_MOST).map(({ s, r }) => ({
            label:
              `${lex.name("settlements.structures", s.kind)}: ${s.closed ? "reopen at" : "up to"} ${num(Math.min(here.conditionMax, s.condition + r.points))} pts`.slice(
                0,
                90,
              ),
            value: target(":", s.kind, r.points),
            description: `Takes ${cost(r.cost)}`.slice(0, 90),
          })),
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
        `${w.on ? "Stop" : "Start"}: ${lex.name("settlements.guild-works", w.id)}`.slice(0, 80),
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
    rows: [...buttonRows(toggles.slice(0, 5)), { buttons: [...tabs(g, "works", v), back(v)] }],
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
