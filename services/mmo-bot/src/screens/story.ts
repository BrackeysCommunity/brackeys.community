import {
  type Button,
  buttonRows,
  type EmbedField,
  type Modal,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import {
  castNames,
  seasonLine,
  sideLine,
  troubleBanner,
  wantUnit,
} from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR, type Picture } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, num, plural } from "../units.ts";
import {
  back,
  banner,
  btn,
  buttonLabel,
  factNum,
  factStr,
  option,
  PRIVATE,
  ROW_MOST,
  SELECT_MOST,
  storyLine,
} from "./common.ts";

/**
 * The story's cards (GDD 12, 17.2): an arc's stage with its sides and a
 * way to back each, a trouble at a settlement, the events channel's cards
 * (the raid alarm, a raid got in or held off, a stage won or lapsed, a
 * season's close, a city), and the chronicle of a closed world day with a
 * fact and its causes. A public line names no character: the world's
 * chronicle names guilds, places, factions and counts (GDD 12.7).
 */

/** Where the events channel's cards appear and who sees them. */
export const EVENTS_CHANNEL = "Events channel · everyone in the server can see this";
/** Where the chronicle channel's daily card appears and who sees it. */
export const CHRONICLE_CHANNEL = "Chronicle channel · everyone in the server can see this";

const TROUBLE_SHEET = "story.troubles";
const ARC_SHEET = "story.arcs";
const SIDE_SHEET = "story.sides";
const LAPSED = "lapsed";
/** The units field of the amount modal a goods side's Back opens. */
export const UNITS_INPUT = "units";

/** A side with a readable title where the world gave only its row id. */
export function namedSide(s: api.Side, lex: Lexicon): api.Side {
  return s.title && s.title !== s.id ? s : { ...s, title: lex.name(SIDE_SHEET, s.id) };
}

/** An arc with readable titles, its own and its sides', where the world gave only row ids. */
export function namedArc(a: api.Arc, lex: Lexicon): api.Arc {
  const sheet = a.scope === "settlement" ? TROUBLE_SHEET : ARC_SHEET;
  return {
    ...a,
    title: a.title && a.title !== a.template ? a.title : lex.name(sheet, a.template),
    sides: a.sides.map((x) => namedSide(x, lex)),
  };
}

/** Where a season stands, or that none runs. */
export function seasonText(s: api.Season): string {
  return s.days ? seasonLine(s) : "No season is running";
}

/** A side as a field: its title, then what it wants, who backs it, what it pays and for whom. */
function sideField(s: api.Side, lex: Lexicon): EmbedField {
  const [, ...rest] = sideLine(s, lex).split(" · ");
  return { name: s.title.slice(0, 256), value: capitalise(rest.join(" · ")), inline: true };
}

/** The roles an arc's cast fills, by the names they go by. */
function castLine(a: api.Arc): string {
  const named = a.cast.filter((c) => c.name);
  return named.map((c) => `${capitalise(c.role.replace(/-/g, " "))}: ${c.name}`).join(" · ");
}

/** Which stage runs, of how many, and the day it ends. */
function stageLine(a: api.Arc): string {
  const of = `${num(a.stage + 1)} of ${plural(a.stages, "stage")}`;
  if (a.outcome) return a.lapsed ? `It lapsed at stage ${of}` : `It ended at stage ${of}`;
  return `Stage ${of}${a.dueDay ? `, ending on day ${a.dueDay}` : ""}`;
}

function scopeWord(a: api.Arc): string {
  switch (a.scope) {
    case "world":
      return "a world arc";
    case "region":
      return "a region's arc";
    case "personal":
      return "your own thread";
    default:
      return "a settlement's trouble";
  }
}

/** What a viewer brings to backing a side: where it stands, what it carries, and the side goals the board here serves. */
export interface Backing {
  /** The viewer's tile. */
  at: api.Hex;
  /** The goods the viewer carries, provisions apart. */
  purse: api.Purse;
  /** Side goals as the board here serves them, with the goods each takes from the viewer. */
  goals?: readonly api.Goal[];
}

/** The material a goods side would take from what is carried: what the board says it takes, else the best guess by its tag. */
export function backMaterial(s: api.Side, b: Backing, lex: Lexicon): string | undefined {
  const takes = b.goals?.find((g) => g.id === s.goal)?.takes ?? [];
  if (takes.length) return [...takes].sort((x, y) => y.units - x.units)[0]!.material;
  if (s.tag === "provisions") return b.purse.provisions > 0 ? "provisions" : undefined;
  const goods = [...b.purse.goods].filter((g) => g.units > 0).sort((x, y) => y.units - x.units);
  if (!s.tag) return goods[0]?.material;
  const tagged = goods.find(
    (g) => g.material.includes(s.tag!) || lex.material(g.material).toLowerCase().includes(s.tag!),
  );
  return tagged?.material;
}

const sameHex = (a: api.Hex | undefined, b: api.Hex) => !!a && a.q === b.q && a.r === b.r;

/**
 * The way one viewer backs a side: a declaration for a side filled by
 * deeds, else a give of what it takes where it lands, or the way there.
 */
export function sideButtons(s: api.Side, v: number, lex: Lexicon, b: Backing): Button[] {
  const left = s.filled < s.mark;
  if (s.wants !== "goods")
    return s.mine
      ? []
      : [
          btn(buttonLabel(`Back: ${s.title}`), "s-decl", s.goal, v, {
            style: "primary",
            disabled: !left,
          }),
        ];
  if (s.atHex && !sameHex(s.atHex, b.at))
    return [
      btn(
        buttonLabel(`Go to ${s.at || "where it lands"}`),
        "goto",
        target(",", s.atHex.q, s.atHex.r),
        v,
      ),
    ];
  const material = backMaterial(s, b, lex);
  if (!material) return [];
  return [
    btn(
      buttonLabel(`Back ${s.title}: give ${lex.material(material).toLowerCase()}`),
      "s-give",
      target(":", s.goal, material),
      v,
      { style: "success", disabled: !left },
    ),
  ];
}

/** The buttons that back an open stage's sides, for one viewer. */
function backButtons(a: api.Arc, v: number, lex: Lexicon, b: Backing): Button[] {
  if (a.outcome) return [];
  const mine = a.sides.find((s) => s.mine);
  const out: Button[] = [];
  const ids = new Set<string>();
  for (const s of a.sides) {
    if (mine && mine.id !== s.id) continue;
    // Two sides landing in one place share their way there.
    for (const button of sideButtons(s, v, lex, b)) {
      if (button.kind === "page" && ids.has(button.customId)) continue;
      if (button.kind === "page") ids.add(button.customId);
      out.push(button);
    }
  }
  return out;
}

/** An open stage, or a trouble, as one viewer sees it: its sides and the way to back each. */
export function stageCard(
  o: api.Options,
  here: api.Here,
  a: api.Arc,
  lex: Lexicon,
  opts: { goals?: readonly api.Goal[]; trouble?: api.Trouble; notice?: string } = {},
): Card {
  a = namedArc(a, lex);
  const v = o.version;
  const t = opts.trouble;
  const fields: EmbedField[] = [{ name: "Stage", value: stageLine(a), inline: false }];
  if (t)
    fields.push({
      name: "The trouble",
      value: troubleBanner(t, { place: here.name, now: o.tick, names: lex }),
    });
  fields.push(...a.sides.map((x) => sideField(x, lex)));
  const buttons = backButtons(a, v, lex, { at: o.at, purse: o.purse, goals: opts.goals });
  const tail: Button[] = [btn("The chronicle", "chronicle", "", v), back(v)];
  if (t?.hunt) tail.unshift(btn("The raiders' hunt", "hunt", t.hunt, v, { style: "danger" }));
  return {
    context: PRIVATE,
    author: authorLine(t ? "Trouble" : "Arc", scopeWord(a)),
    title: opts.notice ?? a.title,
    description: [castLine(a), a.regions.length ? `In ${a.regions.join(", ")}.` : ""]
      .filter(Boolean)
      .join("\n"),
    picture: banner(here, `; ${a.title}`),
    fields,
    footer:
      "Every side pays by what each backer put in; the first to meet its mark wins the stage.",
    rows: [...buttonRows(buttons.slice(0, ROW_MOST * 2)), { buttons: tail }],
    colour: t ? COLOUR.rust : a.scope === "world" ? COLOUR.hazard : COLOUR.ash,
  };
}

/** The modal a goods side's Back opens: how much of the material to give. */
export function giveModal(goal: string, material: string, version: number): Modal {
  return {
    customId: encodeId("s-gave", target(":", goal, material), version),
    title: "Back a side: how much to give",
    inputs: [{ id: UNITS_INPUT, label: "Units to give", max: 6, required: true }],
  };
}

/** The arcs running, for the chronicle's select; a picked one opens its stage card. */
function arcSelect(arcs: readonly api.Arc[], v: number, lex: Lexicon): Row[] {
  if (!arcs.length) return [];
  return [
    {
      select: {
        customId: encodeId("arc", "", v),
        placeholder: "An arc running: its stage and sides",
        options: arcs
          .slice(0, SELECT_MOST)
          .map((x) => namedArc(x, lex))
          .map((a) => option(a.title, a.id, `${capitalise(scopeWord(a))}: ${stageLine(a)}`)),
      },
    },
  ];
}

/**
 * A closed world day's chronicle: its heaviest lines, those at the
 * server's own places first, how many more, the earlier days and each
 * line's causes. post is the chronicle channel's card, with no hub; a
 * day below 0 says no world day has closed yet.
 */
export function chronicleCard(
  ch: api.Chronicle,
  lex: Lexicon,
  version: number,
  post = false,
  arcs: readonly api.Arc[] = [],
): Card {
  const v = version;
  const closed = ch.day >= 0;
  const refs = castNames([...arcs]);
  const line = (f: api.Fact) => storyLine(f, lex, refs);
  const lines = ch.lines.map((l) => `${l.here ? "▸" : "•"} ${line(l.fact)}`);
  if (ch.more) lines.push(`…and ${amount(ch.more, "more")} of less weight`);
  const rows: Row[] = [];
  const opened = ch.lines.filter((l) => (l.causes ?? 0) > 0).slice(0, SELECT_MOST);
  if (opened.length)
    rows.push({
      select: {
        customId: encodeId("c-fact", "", v),
        placeholder: "A line and what caused it",
        options: opened.map((l) =>
          option(line(l.fact), String(l.fact.id), `${plural(l.causes ?? 0, "fact")} behind it`),
        ),
      },
    });
  if (ch.earlier.length)
    rows.push({
      select: {
        customId: encodeId("chronicle", "", v),
        placeholder: "An earlier day",
        options: ch.earlier.slice(0, SELECT_MOST).map((d) => option(`World day ${d}`, String(d))),
      },
    });
  if (!post) rows.push(...arcSelect(arcs, v, lex));
  if (!post)
    rows.push({ buttons: [btn("Since you left", "recap", "", v, { style: "primary" }), back(v)] });
  const fields: EmbedField[] = [{ name: "Season", value: seasonText(ch.season), inline: true }];
  return {
    context: post ? CHRONICLE_CHANNEL : PRIVATE,
    author: authorLine("Chronicle", post ? "the world's day" : "the world"),
    title: closed ? `The chronicle of world day ${ch.day}` : "No world day has closed yet",
    description: closed
      ? lines.join("\n") || "Nothing heavy enough to keep happened that day."
      : "The first chronicle is written when the first world day closes.",
    picture: "form",
    fields,
    footer:
      "Only facts the world wrote are told here, heaviest first; ▸ marks your server's places.",
    rows,
    colour: COLOUR.ash,
  };
}

/** A fact and the facts it came of, each of which opens the same way (GDD 12.7). */
export function factCard(fc: api.FactCauses, lex: Lexicon, version: number): Card {
  const v = version;
  const causes = fc.causes.slice(0, SELECT_MOST);
  const rows: Row[] = [];
  if (causes.length)
    rows.push({
      select: {
        customId: encodeId("c-fact", "", v),
        placeholder: "A cause, and what caused it",
        options: causes.map((f) => option(storyLine(f, lex), String(f.id))),
      },
    });
  rows.push({ buttons: [btn("The chronicle", "chronicle", "", v), back(v)] });
  return {
    context: PRIVATE,
    author: authorLine("Chronicle", "a fact and its causes"),
    title: storyLine(fc.fact, lex).slice(0, 256),
    description: causes.length
      ? ["It came of:", ...causes.map((f) => `• ${storyLine(f, lex)}`)].join("\n")
      : "Nothing the world kept led to it: it began here.",
    picture: "form",
    fields: [{ name: "Written at", value: `tick ${fc.fact.tick}`, inline: true }],
    footer: "Each cause opens in turn, as far back as the world keeps.",
    rows,
  };
}

/** An event's picture: none, since an arc has no tile of its own to show. */
const NO_PICTURE: Picture | "form" = "form";

/** The place an event names, or a settlement. */
const placeOf = (ev: api.StoryEvent) => ev.place || "a settlement";

function troubleTitle(ev: api.StoryEvent, lex: Lexicon): string {
  return ev.trouble?.title || lex.name(TROUBLE_SHEET, factStr(ev.fact, "template"));
}

function isRaid(ev: api.StoryEvent): boolean {
  return ev.alarm || ev.trouble?.kind === "raid" || factStr(ev.fact, "template") === "raid";
}

/** A trouble starting: the raid alarm, or another trouble at a place. */
function troubleStartCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const t = ev.trouble;
  const raid = isRaid(ev);
  const arc = factStr(ev.fact, "arc");
  const buttons: Button[] = [];
  if (arc) buttons.push(btn("Hold it off", "arc", arc, 0, { style: "danger" }));
  if (t?.hunt) buttons.push(btn("Join the hunt", "hunt", t.hunt, 0));
  if (raid) buttons.push(btn("Raid alarms", "alarm", "", 0));
  const fields: EmbedField[] = t
    ? [
        {
          name: "The trouble",
          value: troubleBanner(t, { place: ev.place, now: ev.fact.tick, names: lex }),
        },
      ]
    : [{ name: "Told", value: storyLine(ev.fact, lex) }];
  return {
    context: EVENTS_CHANNEL,
    author: authorLine(raid ? "Raid alarm" : "Trouble", placeOf(ev)),
    title: raid
      ? `Raiders on the road to ${placeOf(ev)}`
      : `${troubleTitle(ev, lex)} at ${placeOf(ev)}`,
    description: raid
      ? "Win beats near it, press the raiders' hunt, or stand a wall: defence counts until the day turns."
      : "Back its one side before the day turns, or the place takes the damage.",
    picture: NO_PICTURE,
    fields,
    footer: raid
      ? "Raid alarms gives or takes the alarm role: only a raid's start mentions it."
      : "A trouble lasts one world day.",
    rows: buttons.length ? [{ buttons }] : [],
    colour: COLOUR.rust,
  };
}

/** A trouble decided: a raid got in or was held off, another trouble held or lost. */
function troubleEndCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const held = ev.fact.kind === "trouble.held";
  const raid = isRaid(ev);
  const name = troubleTitle(ev, lex);
  const title = raid
    ? held
      ? `The raid on ${placeOf(ev)} was held off`
      : `The raid got in at ${placeOf(ev)}`
    : `${name} at ${placeOf(ev)}: ${held ? "held off" : "it got the better of them"}`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine(raid ? "Raid" : "Trouble", held ? "held off" : "lost"),
    title,
    description: held
      ? "Its backers are paid by what each put in."
      : `The place takes the damage its kind does; a guild's settlement that loses ${plural(lex.numbers.ruinTroubles, "time")} in a season is ruined.`,
    picture: NO_PICTURE,
    fields: [
      {
        name: "Backed by",
        value: plural(factNum(ev.fact, "backers"), "character"),
        inline: true,
      },
      {
        name: raid ? "Defence" : "Put in",
        value: amount(factNum(ev.fact, "units"), raid ? "defence" : "points"),
        inline: true,
      },
    ],
    footer: "Remembered either way: the chronicle keeps it.",
    rows: [],
    colour: held ? COLOUR.signal : COLOUR.rust,
  };
}

/** A stage open in the events channel: each side's Back opens the presser's own card of it. */
function stagePostCard(ev: api.StoryEvent, a: api.Arc, lex: Lexicon): Card {
  const buttons = a.outcome
    ? []
    : a.sides.map((s) =>
        btn(buttonLabel(`Back: ${s.title}`), "s-back", s.goal, 0, { style: "primary" }),
      );
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", scopeWord(a), ev.fact.kind === "arc.cast" ? "cast" : "next stage"),
    title: a.title,
    description: [castLine(a), a.regions.length ? `In ${a.regions.join(", ")}.` : ""]
      .filter(Boolean)
      .join("\n"),
    picture: NO_PICTURE,
    fields: [
      { name: "Stage", value: stageLine(a), inline: false },
      ...a.sides.map((x) => sideField(x, lex)),
    ],
    footer: "Back a side from your own card: goods where they land, beats in its regions.",
    rows: buttons.length ? buttonRows(buttons.slice(0, ROW_MOST)) : [],
    colour: a.scope === "world" ? COLOUR.hazard : COLOUR.ash,
  };
}

/** A stage decided: the side that won it, or that it lapsed and what the world did. */
function stageEndCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const f = ev.fact;
  const side = factStr(f, "side");
  const lapsed = factNum(f, "lapsed") > 0 || side === LAPSED;
  const title = ev.arc?.title || lex.name(ARC_SHEET, factStr(f, "template"));
  const won = lapsed ? undefined : ev.arc?.sides.find((s) => s.id === side);
  const winner = lapsed ? "" : (won?.title ?? lex.name(SIDE_SHEET, side));
  const stage = factNum(f, "stage") + 1;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", lapsed ? "a stage lapsed" : "a stage won"),
    title: lapsed ? `${title}: stage ${stage} lapsed` : `${title}: ${winner} won stage ${stage}`,
    description: lapsed
      ? "Nobody met a mark by its deadline: the world does what the stage said it would."
      : "The side that met its mark first won it; the other side is paid for what it put in.",
    picture: NO_PICTURE,
    fields: [
      { name: "Backed by", value: plural(factNum(f, "backers"), "character"), inline: true },
      ...(lapsed
        ? []
        : [
            {
              name: "Put in",
              value: amount(factNum(f, "units"), wantUnit(won?.wants ?? "")),
              inline: true,
            },
          ]),
      ...(ev.arc && !ev.arc.outcome
        ? [{ name: "Now", value: stageLine(ev.arc), inline: false }]
        : []),
    ],
    footer: "Both outcomes are remembered: the chronicle keeps them.",
    rows: [],
    colour: lapsed ? COLOUR.rust : COLOUR.signal,
  };
}

/** A whole arc over. */
function arcEndCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const f = ev.fact;
  const outcome = factStr(f, "outcome");
  const lapsed = factNum(f, "lapsed") > 0 || outcome === LAPSED;
  const title = ev.arc?.title || lex.name(ARC_SHEET, factStr(f, "template"));
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", "ended"),
    title: lapsed
      ? `${title} lapsed`
      : `${title} ended: ${ev.arc?.sides.find((s) => s.id === outcome)?.title ?? lex.name(SIDE_SHEET, outcome)} won`,
    description: `It ran ${plural(factNum(f, "stages"), "stage")}.`,
    picture: NO_PICTURE,
    fields: [{ name: "Told", value: storyLine(f, lex) }],
    footer: "The chronicle keeps how it went.",
    rows: [],
    colour: lapsed ? COLOUR.rust : COLOUR.signal,
  };
}

/** A season's turn: its finale, its close or the next one's start. */
function seasonCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const f = ev.fact;
  const n = factNum(f, "season");
  const title =
    f.kind === "season.finale"
      ? `The finale of season ${n}`
      : f.kind === "season.closed"
        ? `Season ${n} closed`
        : `Season ${n} begins`;
  const description =
    f.kind === "season.closed"
      ? "Season goals turned over, season ranks cleared and votes short of their need ended."
      : f.kind === "season.finale"
        ? "The largest unresolved pressure was cast as the season's last stand."
        : `It runs ${amount(factNum(f, "days"), "days")}.`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Season", f.kind.slice("season.".length)),
    title,
    description,
    picture: NO_PICTURE,
    fields: [{ name: "Told", value: storyLine(f, lex) }],
    footer: "The chronicle keeps the season's story.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** A place changed: raised to a city, fallen back, ruined, or a faction's city founded. */
function placeEventCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const f = ev.fact;
  const where = placeOf(ev);
  const titles: Record<string, string> = {
    "city.raised": `${where} is a city`,
    "city.fell-back": `${where} fell back from a city`,
    "settlement.ruined": `${where} is a ruin`,
    "faction.city": `A faction raised its city at ${where}`,
    "core.opened": "The core is open",
    "pattern.solved": "A pattern was solved",
  };
  const good = f.kind === "city.raised" || f.kind === "faction.city" || f.kind === "pattern.solved";
  return {
    context: EVENTS_CHANNEL,
    author: authorLine(f.kind.startsWith("city.") ? "City" : "World", where),
    title: titles[f.kind] ?? capitalise(storyLine(f, lex)),
    description: storyLine(f, lex),
    picture: NO_PICTURE,
    fields:
      f.kind === "city.raised" && factNum(f, "coin")
        ? [{ name: "From its treasury", value: amount(factNum(f, "coin"), "coin"), inline: true }]
        : [],
    footer: "The chronicle keeps it.",
    rows: [],
    colour: good ? COLOUR.signal : COLOUR.rust,
  };
}

/** The events channel's card for one story event, or null for a kind it does not post. */
export function eventCard(ev: api.StoryEvent, lex: Lexicon): Card | null {
  const named = ev.arc ? { ...ev, arc: namedArc(ev.arc, lex) } : ev;
  switch (ev.fact.kind) {
    case "trouble.started":
      return troubleStartCard(ev, lex);
    case "trouble.held":
    case "trouble.lost":
      return troubleEndCard(ev, lex);
    case "arc.cast":
    case "arc.stage-began":
      return ev.arc ? stagePostCard(ev, namedArc(ev.arc, lex), lex) : null;
    case "arc.stage-ended":
      return stageEndCard(named, lex);
    case "arc.ended":
      return arcEndCard(named, lex);
    case "season.began":
    case "season.finale":
    case "season.closed":
      return seasonCard(ev, lex);
    case "city.raised":
    case "city.fell-back":
    case "settlement.ruined":
    case "faction.city":
    case "core.opened":
    case "pattern.solved":
      return placeEventCard(ev, lex);
    default:
      return null;
  }
}
