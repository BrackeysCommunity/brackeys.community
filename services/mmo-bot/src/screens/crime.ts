import {
  type Button,
  type EmbedField,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, list, num, percent, plural, signed, signedPercent } from "../units.ts";
import {
  alignmentLine,
  alignmentMoved,
  back,
  banner,
  btn,
  buttonLabel,
  downButtons,
  factNum,
  factStr,
  goodsLine,
  option,
  PRIVATE,
  ROW_MOST,
  SELECT_MOST,
  SYNDICATE,
  syndicateName,
  takenLine,
} from "./common.ts";

/**
 * Theft and alignment (GDD 4.5, 5.10, 6.5): a theft's beat with the odds
 * it is seen, how it ended, the watch at the gate, what can be stolen
 * here, a fence's offer and where a character stands. Every number comes
 * from the world or the sheet's Numbers; nothing here decides an outcome.
 */

export { alignmentLine, SYNDICATE, syndicateName } from "./common.ts";

/** The verb a syndicate job is posted with. */
export const STEAL_VERB = "steal";

/** A theft kind as the setting names it: "Lift", "Run from the watch". */
export function theftKind(kind: string, lex: Lexicon): string {
  return lex.name("theft.kinds", kind);
}

/** Whether a fight is a run from the watch rather than a theft. */
export function isFlight(t: api.Theft): boolean {
  return !!t.flee || t.kind === api.TheftFlee;
}

/** What a witness part counts, in words. */
const WITNESS_PARTS: Record<string, string> = {
  base: "how often it is seen",
  upright: "upright people here",
  sleight: "your Sleight",
  cover: "cover here",
  quiet: "quiet gear",
};

/** "40% to be seen". */
export function witnessLine(t: Pick<api.Theft, "witness">): string {
  return `${percent(t.witness)} to be seen`;
}

/** The parts the chance of being seen is made of, each in per cent, and where it is held. */
export function witnessWhy(t: Pick<api.Theft, "witness" | "witnessWhy">): string {
  const parts = t.witnessWhy.parts.map(
    (p) =>
      `${WITNESS_PARTS[p.label] ?? p.label.replace(/-/g, " ")} ${p.label === "base" ? percent(p.value) : signedPercent(p.value)}`,
  );
  if (!parts.length) return "nothing changes it";
  const sum = t.witnessWhy.parts.reduce((n, p) => n + p.value, 0);
  if (sum !== t.witness) parts.push(`held at ${percent(t.witness)}`);
  return parts.join(", ");
}

/** What a theft plans to take: coin, goods and an item, and their worth. */
export function plannedHaul(t: api.Theft, lex: Lexicon): string {
  const what = [
    t.coin ? amount(t.coin, "coin") : "",
    goodsLine(t.haul ?? [], lex),
    t.item ? capitalise(t.item) : "",
  ].filter(Boolean);
  if (what.length === 1 && t.coin === t.worth) return what[0]!;
  return `${what.length ? list(what) : "what is there"}, worth ${amount(t.worth, "coin")}`;
}

/** The opening line of a theft's beat, by its kind; templates only. */
function theftOpening(t: api.Theft, place: string): string {
  switch (t.kind) {
    case api.TheftLift:
      return `You close on ${t.victim} in the press of ${place}.`;
    case api.TheftBurgle:
      return `${capitalise(t.victim)}'s store at ${place}: a lock, then the way out.`;
    case api.TheftWaylay:
      return `${capitalise(t.victim)} on the road: its guards stand between you and the goods.`;
    default:
      return `The watch at ${place} is on your heels. Keep running.`;
  }
}

/** What a theft's beat shows over a fight's: its target, the odds it is seen and why, and what failing costs. */
export function theftBeat(
  f: api.Fight,
  t: api.Theft,
  here: api.Here,
  lex: Lexicon,
  body: string,
): Pick<Card, "author" | "title" | "description" | "fields" | "footer" | "colour"> {
  const beat = lex.name("fights.beats", f.kind);
  const flight = isFlight(t);
  const kind = theftKind(flight ? api.TheftFlee : t.kind, lex);
  const fields: EmbedField[] = [
    { name: "Beat", value: `beat ${f.beat + 1} of ${amount(f.beats, "beats")}`, inline: true },
    { name: flight ? "From" : "Target", value: capitalise(t.victim), inline: true },
    { name: "Where", value: here.name, inline: true },
  ];
  if (!flight) {
    fields.push(
      { name: "Witness", value: witnessLine(t), inline: true },
      { name: "Taking", value: plannedHaul(t, lex), inline: true },
      { name: "Why it may be seen", value: witnessWhy(t) },
    );
    if (t.forSide)
      fields.push({ name: "For the side", value: "The haul goes to the prey side you back." });
  }
  if (t.caught)
    fields.push({
      name: "Caught",
      value: flight
        ? "A beat failed: the watch has you."
        : "A beat failed: you were seen, and what is left is the getaway.",
    });
  return {
    author: authorLine(flight ? "The watch" : "Theft", kind),
    title: `${beat}: ${flight ? "the watch" : t.victim}`,
    description: `${theftOpening(t, here.name)}\n\n${body}`,
    fields,
    footer: flight
      ? "Fail a beat and the watch takes you down and takes back the goods."
      : "Fail a beat and you are caught: seen, wanted and nothing taken. Two failures and you go down.",
    colour: flight ? COLOUR.hazard : COLOUR.corrupt,
  };
}

/** The facts that end a theft or a flight. */
const THEFT_ENDS = new Set(["theft.made", "watch.fled", "watch.caught"]);

/** The fact a press ended a theft or a flight with, if it did. */
export function theftEnd(facts: readonly api.Fact[]): api.Fact | undefined {
  return facts.find((f) => THEFT_ENDS.has(f.kind));
}

/** Whom a betrayal was of, in words. */
function betrayedName(key: string, lex: Lexicon): string {
  return key === SYNDICATE ? syndicateName(lex) : "a faction you stood with";
}

/** A wanted entry as one line: where, for what, the fine and the days left. */
export function wantedLine(w: api.WantedIn): string {
  return `${w.places.length ? `in ${list(w.places)}` : "here"}, for robbing ${w.victim}: a fine of ${amount(w.fine, "coin")}, ${plural(w.days, "day")} left`;
}

const WANTED_SHOWN = 4;
const HOT_SHOWN = 6;

/** The wanted entries as one field, or none when nobody wants the character. */
function wantedField(wanted: api.WantedIn[], name = "Wanted"): EmbedField | undefined {
  if (!wanted.length) return undefined;
  return { name, value: wanted.slice(0, WANTED_SHOWN).map(wantedLine).join("\n") };
}

/** Everything a character carries: its kit and its pack. */
function carried(sheet: api.Sheet): api.Item[] {
  return [...sheet.kit, ...sheet.pack];
}

/** What hot goods are: the item's name, or the units of the material as named. */
function hotWhat(
  h: api.HotGoods,
  items: readonly api.Item[],
  lex: Lexicon,
  material = lex.material(h.material ?? ""),
): string {
  return h.item ? items.find((i) => i.id === h.item)?.name || "an item" : amount(h.units, material);
}

/** Hot goods as one line: what, whose, how long the mark lasts and how far from where they were taken. */
export function hotLine(h: api.HotGoods, lex: Lexicon, items: readonly api.Item[] = []): string {
  const what = capitalise(hotWhat(h, items, lex));
  const far = h.reach ? `${plural(h.reach, "tile")} from where it was taken` : "where it was taken";
  return `${what}, from ${h.victim}: hot for ${plural(h.days, "day")} more, ${far}`;
}

/** The hot goods as one field, or none when nothing carried is hot. */
function hotField(
  hot: api.HotGoods[],
  lex: Lexicon,
  items: readonly api.Item[],
  name: string,
): EmbedField | undefined {
  if (!hot.length) return undefined;
  return {
    name,
    value: hot
      .slice(0, HOT_SHOWN)
      .map((h) => hotLine(h, lex, items))
      .join("\n"),
  };
}

/** A theft or a flight over: what it took, its worth, the mark, standing, alignment and the watch. */
export function theftResolvedCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  facts: readonly api.Fact[],
  end: api.Fact,
  after?: api.Character,
): Card {
  const v = o.version;
  const n = lex.numbers;
  const fields: EmbedField[] = [];
  let title: string;
  let description: string;
  let good = false;
  if (end.kind === "watch.fled") {
    title = "You got away from the watch";
    description = "You are through the gate. The watch still wants you until its days run out.";
    good = true;
  } else if (end.kind === "watch.caught") {
    title = "The watch ran you down";
    description = "It took back what you still held. What it wanted you for here is settled.";
  } else {
    const outcome = factStr(end, "outcome");
    const seen = factNum(end, "witnessed") > 0;
    const kind = theftKind(factStr(end, "kind"), lex);
    if (outcome === "empty") {
      title = "Nothing left to take";
      description = `${kind}: what was there was gone by the time you reached it. Nothing is marked and nobody wants you for it.`;
    } else if (outcome === "lost") {
      title = "Caught in the act";
      description = `${kind}: a beat failed and you were seen. You took nothing, and are wanted as if you had.`;
    } else {
      title = seen ? "Seen, and wanted" : "Away clean";
      description = seen
        ? `${kind}: you took it, and someone saw.`
        : `${kind}: you took it, and nobody saw it was you.`;
      good = !seen;
    }
    if (outcome !== "empty") {
      const worth = factNum(end, "worth");
      fields.push(
        { name: "Haul", value: outcome === "won" ? takenLine(end, lex) : "nothing", inline: true },
        { name: "Worth", value: amount(worth, "coin"), inline: true },
        { name: "Seen", value: seen || outcome === "lost" ? "yes" : "no", inline: true },
      );
      const goods = factNum(end, "units") > 0 || !!factStr(end, "item");
      if (outcome === "won" && factStr(end, "side"))
        fields.push({ name: "For the side", value: "The haul went to the prey side you back." });
      else if (outcome === "won" && goods)
        fields.push({
          name: "Hot",
          value: `For ${plural(n.hotDays, "day")}: not listed within ${plural(n.hotReach, "tile")} of where it was taken, never sold back to whom it was taken from, and never put in a store or a guild's bank.`,
        });
      else if (outcome === "won") fields.push({ name: "Hot", value: "Coin carries no mark." });
      const standing = factNum(end, "standing");
      fields.push({
        name: "Standing",
        value: standing
          ? `${signed(standing, "standing")} with whom it belonged to`
          : seen || outcome === "lost"
            ? "it falls with whom it belonged to"
            : "unchanged: nobody knows",
        inline: true,
      });
    }
  }
  const moved = facts.find((f) => f.kind === "alignment.moved");
  const a = after?.alignment;
  if (moved)
    fields.push({
      name: "Alignment",
      value: alignmentMoved(moved, lex, false),
      inline: true,
    });
  else if (a)
    fields.push({ name: "Alignment", value: alignmentLine(a.value, a.band, lex), inline: true });
  for (const b of facts.filter((f) => f.kind === "character.betrayed"))
    fields.push({
      name: "Betrayed",
      value: `${capitalise(betrayedName(factStr(b, "faction"), lex))}: standing to ${amount(factNum(b, "standing"), "standing")}, and a grudge for ${plural(n.grudgeDays, "day")}`,
    });
  const wantedAfter = wantedField(after?.wanted ?? []);
  if (wantedAfter) fields.push(wantedAfter);
  const buttons: Button[] = [];
  if (o.conditions.includes(api.CondDown)) buttons.push(...downButtons(o, v));
  buttons.push(btn("Where I am", "where", "", v), btn("Character", "character", "", v), back(v));
  return {
    context: PRIVATE,
    author: authorLine(end.kind.startsWith("watch.") ? "The watch" : "Theft", "how it ended"),
    title,
    description,
    picture: banner(here),
    fields,
    footer: "A fine pays the watch off; a fence buys what is hot. Coin is never marked.",
    rows: [{ buttons: buttons.slice(0, ROW_MOST) }],
    colour: good ? COLOUR.signal : COLOUR.rust,
  };
}

/** The watch at the gate: the fine to pay, or the run (GDD 6.5). */
export function watchCard(o: api.Options, here: api.Here, sheet: api.Sheet, lex: Lexicon): Card {
  const v = o.version;
  const c = sheet.character;
  const stop = c.stopped!;
  const wanted = (c.wanted ?? []).filter((w) => !w.places.length || w.places.includes(stop.name));
  const fields: EmbedField[] = [
    { name: "The fine", value: amount(stop.fine, "coin"), inline: true },
    { name: "Coin", value: amount(c.coin, "coin"), inline: true },
    {
      name: "Alignment",
      value: alignmentLine(c.alignment.value, c.alignment.band, lex),
      inline: true,
    },
  ];
  const wantedHere = wantedField(wanted, "Wanted here");
  if (wantedHere) fields.push(wantedHere);
  if (!stop.canPay)
    fields.push({ name: "Short", value: "You cannot cover the fine: running is the only way." });
  return {
    context: PRIVATE,
    author: authorLine("The watch", stop.name),
    title: `The watch holds you at the gate of ${stop.name}`,
    description:
      "They know your face. Pay what you owe and go in, or run for it. Until then you can talk and look, and nothing more.",
    picture: banner(here, "; the watch at the gate"),
    fields,
    footer:
      "Paying gives back what you still hold and pays its worth to the fees; losing the run takes you down and the goods back.",
    rows: [
      {
        buttons: [
          btn(`Pay the fine (${amount(stop.fine, "coin")})`, "pay-fine", "", v, {
            style: "success",
            disabled: !stop.canPay,
          }),
          btn("Run", "flee", "", v, { style: "danger" }),
          btn("Where I am", "where", "", v),
          btn("Character", "character", "", v),
        ],
      },
    ],
    colour: COLOUR.hazard,
  };
}

/** A steal target as a select's value: kind/npc-or-caravan/s for a side's haul or o for one's own. */
export function stealValue(s: api.StealTarget, forSide = false): string {
  return target("/", s.kind, s.npc || s.caravan || "-", forSide ? "s" : "o");
}

/** What a steal target's value names, or null for one malformed. */
export function parseSteal(
  raw: string,
): { kind: string; npc?: string; caravan?: string; forSide: boolean } | null {
  const parts = raw.split("/");
  if (parts.length !== 3 || !parts.every(Boolean)) return null;
  const [kind, who, side] = parts as [string, string, string];
  if (side !== "s" && side !== "o") return null;
  const named = who === "-" ? {} : kind === api.TheftWaylay ? { caravan: who } : { npc: who };
  return { kind, ...named, forSide: side === "s" };
}

/** What can be stolen here now, picked from a select; each shows its worth and the odds it is seen. */
export function stealCard(o: api.Options, here: api.Here, lex: Lexicon, notice?: string): Card {
  const v = o.version;
  const picks: { value: string; label: string; detail: string }[] = [];
  for (const s of o.steals) {
    const detail = `worth ${amount(s.worth, "coin")} · ${percent(s.witness)} to be seen`;
    const label = `${theftKind(s.kind, lex)}: ${s.name}`;
    picks.push({ value: stealValue(s), label, detail });
    if (s.forSide)
      picks.push({ value: stealValue(s, true), label: `${label}, for the side`, detail });
  }
  const unique = picks.filter((p, i) => picks.findIndex((x) => x.value === p.value) === i);
  const rows: Row[] = [];
  if (unique.length)
    rows.push({
      select: {
        customId: encodeId("steal", "", v),
        placeholder: "What to take…",
        options: unique.slice(0, SELECT_MOST).map((p) => option(p.label, p.value, p.detail)),
      },
    });
  rows.push({ buttons: [btn("Where I am", "where", "", v), back(v)] });
  return {
    context: PRIVATE,
    author: authorLine("Theft", here.name),
    title: notice ?? (unique.length ? "What could be taken here" : "Nothing here to take"),
    description: unique.length
      ? unique
          .slice(0, SELECT_MOST)
          .map((p) => `• **${p.label}**: ${p.detail}`)
          .join("\n")
      : "Nobody here holds anything you could lift, and no store or caravan is in reach.",
    picture: banner(here),
    fields: [
      {
        name: "What it costs",
        value: `Seen or caught: standing falls with whom it belonged to, the watch wants you for ${plural(lex.numbers.wantedDays, "day")}, and your alignment falls. Unseen, only your alignment knows.`,
      },
    ],
    footer: "The odds of being seen are fixed when you begin, and shown before every press.",
    rows,
    colour: COLOUR.corrupt,
  };
}

/** A fence sale's target: npc/m/material/units or npc/i/item/1. */
export function fenceTarget(npc: string, h: api.HotGoods): string {
  return h.item
    ? target("/", npc, "i", h.item, 1)
    : target("/", npc, "m", h.material ?? "", h.units);
}

/** What a fence sale's target names, or null for one malformed. */
export function parseFence(
  raw: string,
): { npc: string; material?: string; units?: number; item?: string } | null {
  const parts = raw.split("/");
  if (parts.length !== 4 || !parts.every(Boolean)) return null;
  const [npc, what, id, count] = parts as [string, string, string, string];
  const units = Number(count);
  if (!/^\d+$/.test(count) || units < 1) return null;
  if (what === "i") return { npc, item: id };
  if (what === "m") return { npc, material: id, units };
  return null;
}

/** A fence's offer on its talk card: the hot goods carried, a sale button for each, and what it pays. */
export function fenceParts(
  npc: string,
  sheet: api.Sheet,
  lex: Lexicon,
  v: number,
): { fields: EmbedField[]; rows: Row[] } {
  const hot = sheet.character.hot ?? [];
  const items = carried(sheet);
  const n = lex.numbers;
  const pays = `A fence pays ${percent(n.fencePays)} of what goods are worth, ${percent(n.backRoomPays)} to the made at a den. Fenced goods never come back to a market.`;
  if (!hot.length)
    return { fields: [{ name: "The fence", value: `You carry nothing hot. ${pays}` }], rows: [] };
  const buttons = hot.slice(0, ROW_MOST).map((h) => {
    const what = hotWhat(h, items, lex, lex.material(h.material ?? "").toLowerCase());
    return btn(buttonLabel(`Fence ${what}`), "fence", fenceTarget(npc, h), v, { style: "success" });
  });
  return {
    fields: [hotField(hot, lex, items, "Hot goods you carry")!, { name: "The fence", value: pays }],
    rows: [{ buttons }],
  };
}

/** Where a character stands, for its card: alignment, the syndicate, grudges, hot goods and the watch. */
export function standingFields(sheet: api.Sheet, lex: Lexicon): EmbedField[] {
  const c = sheet.character;
  const a = c.alignment;
  const made = a.made ? `; made by the ${syndicateName(lex)}` : "";
  const fields: EmbedField[] = [
    {
      name: "Alignment",
      value: `${alignmentLine(a.value, a.band, lex)}${made}\n${amount(a.goodToday, "alignment")} of good gained today, of ${amount(lex.numbers.goodDay, "alignment")} a day`,
      inline: true,
    },
  ];
  if (sheet.grudges.length)
    fields.push({
      name: "Grudges",
      value: sheet.grudges.map((g) => `${g.name}, until day ${g.ends}`).join("\n"),
      inline: true,
    });
  const hot = hotField(c.hot ?? [], lex, carried(sheet), "Hot goods");
  if (hot) fields.push(hot);
  const wanted = wantedField(c.wanted ?? []);
  if (wanted) fields.push(wanted);
  return fields;
}

/** A job the syndicate posted: who may claim it and what meeting it pays besides coin. */
export function jobField(lex: Lexicon): EmbedField {
  return {
    name: "A job",
    value: `Posted by the ${syndicateName(lex)} for its own: only the made may claim it, a theft counts by what it is worth, and meeting it adds standing with the ${syndicateName(lex)}.`,
  };
}

/** A job's progress: worth taken against the worth it asks. */
export function jobProgress(x: api.Goal): string {
  return `${num(x.progress)} of ${amount(x.count, "coin")} of worth taken${x.claims ? `, ${plural(x.claims, "claim")}` : ""}`;
}
