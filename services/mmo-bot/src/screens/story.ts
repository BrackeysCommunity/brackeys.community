import {
  type Button,
  buttonRows,
  type EmbedField,
  type Modal,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import { artAlt } from "../../../../packages/mmo-words/src/alt.ts";
import {
  arcName,
  arcWords,
  castNames,
  factArcName,
  isLapsed,
  seasonFaded,
  seasonKept,
  seasonLine,
  sideDetail,
  sideName,
  troubleBanner,
  troubleName,
  troubleUnit,
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

/** The units field of the amount modal a goods side's Back opens. */
export const UNITS_INPUT = "units";

/** A side with a readable title where the world gave only its row id. */
export function namedSide(s: api.Side, lex: Lexicon): api.Side {
  return s.title && s.title !== s.id ? s : { ...s, title: sideName(s.id, lex, s.at) };
}

/** An arc with readable titles, its own and its sides', where the world gave only row ids. */
export function namedArc(a: api.Arc, lex: Lexicon): api.Arc {
  return {
    ...a,
    title: a.title && a.title !== a.template ? a.title : arcName(a.template, a.scope, lex),
    sides: a.sides.map((x) => namedSide(x, lex)),
  };
}

/** Where a season stands, or that none runs. */
export function seasonText(s: api.Season): string {
  return s.days ? seasonLine(s) : "No season is running";
}

/** A side as a field: its title, then what it wants, who backs it, what it pays and for whom. */
function sideField(s: api.Side, lex: Lexicon): EmbedField {
  return { name: s.title.slice(0, 256), value: capitalise(sideDetail(s, lex)), inline: true };
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

/** What every stage card shows of an arc: its cast and regions, the Stage field, a field per side, and its colour. */
function stageParts(
  a: api.Arc,
  lex: Lexicon,
): { description: string; stage: EmbedField; sides: EmbedField[]; colour: number } {
  return {
    description: [
      arcWords(a.template)?.origin ?? "",
      castLine(a),
      a.regions.length ? `In ${a.regions.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    stage: { name: "Stage", value: stageLine(a), inline: false },
    sides: a.sides.map((x) => sideField(x, lex)),
    colour: a.scope === "world" ? COLOUR.hazard : COLOUR.ash,
  };
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
  const parts = stageParts(a, lex);
  const fields = [
    parts.stage,
    ...(t
      ? [
          {
            name: "The trouble",
            value: troubleBanner(t, { place: here.name, now: o.tick, names: lex }),
          },
        ]
      : []),
    ...parts.sides,
  ];
  const buttons = backButtons(a, v, lex, { at: o.at, purse: o.purse, goals: opts.goals });
  const tail: Button[] = [btn("The chronicle", "chronicle", "", v), back(v)];
  if (t?.hunt) tail.unshift(btn("The raiders' hunt", "hunt", t.hunt, v, { style: "danger" }));
  return {
    context: PRIVATE,
    author: authorLine(t ? "Trouble" : "Arc", scopeWord(a)),
    title: opts.notice ?? a.title,
    description: parts.description,
    picture: banner(here, `; ${a.title}`),
    fields,
    footer:
      "Every side pays by what each backer put in; the first to meet its mark wins the stage.",
    rows: [...buttonRows(buttons.slice(0, ROW_MOST * 2)), { buttons: tail }],
    colour: t ? COLOUR.rust : parts.colour,
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

/**
 * The refs a card's lines are told with: the names the world sent with
 * them, over those an arc's cast gives.
 */
export function refsOf(
  names?: Readonly<Record<string, string>>,
  arcs: readonly api.Arc[] = [],
): Map<string, string> {
  const refs = castNames([...arcs]);
  for (const [k, v] of Object.entries(names ?? {})) if (v) refs.set(k, v);
  return refs;
}

/** A chronicle's lines as its card tells them, in order, without their marks. */
export function chronicleLines(
  ch: api.Chronicle,
  lex: Lexicon,
  arcs: readonly api.Arc[] = [],
): { line: api.ChronicleLine; text: string }[] {
  const refs = refsOf(ch.names, arcs);
  return ch.lines.map((line) => ({ line, text: storyLine(line.fact, lex, refs) }));
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
  const told = chronicleLines(ch, lex, arcs);
  const lines = told.map(({ line, text }) => `${line.here ? "▸" : "•"} ${text}`);
  if (ch.more) lines.push(`…and ${amount(ch.more, "more")} of less weight`);
  const rows: Row[] = [];
  const opened = told.filter(({ line }) => (line.causes ?? 0) > 0).slice(0, SELECT_MOST);
  if (opened.length)
    rows.push({
      select: {
        customId: encodeId("c-fact", "", v),
        placeholder: "A line and what caused it",
        options: opened.map(({ line, text }) =>
          option(text, String(line.fact.id), `${plural(line.causes ?? 0, "fact")} behind it`),
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
  const title = closed ? `The chronicle of world day ${ch.day}` : "No world day has closed yet";
  return {
    context: post ? CHRONICLE_CHANNEL : PRIVATE,
    author: authorLine("Chronicle", post ? "the world's day" : "the world"),
    title,
    description: closed
      ? lines.join("\n") || "Nothing heavy enough to keep happened that day."
      : "The first chronicle is written when the first world day closes.",
    picture: artPicture(ch.cover, title),
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
  const refs = refsOf(fc.names);
  const line = (f: api.Fact) => storyLine(f, lex, refs);
  const rows: Row[] = [];
  if (causes.length)
    rows.push({
      select: {
        customId: encodeId("c-fact", "", v),
        placeholder: "A cause, and what caused it",
        options: causes.map((f) => option(line(f), String(f.id))),
      },
    });
  rows.push({ buttons: [btn("The chronicle", "chronicle", "", v), back(v)] });
  return {
    context: PRIVATE,
    author: authorLine("Chronicle", "a fact and its causes"),
    title: line(fc.fact).slice(0, 256),
    description: causes.length
      ? ["It came of:", ...causes.map((f) => `• ${line(f)}`)].join("\n")
      : "Nothing the world kept led to it: it began here.",
    picture: "form",
    fields: [{ name: "Written at", value: `tick ${fc.fact.tick}`, inline: true }],
    footer: "Each cause opens in turn, as far back as the world keeps.",
    rows,
  };
}

type Refs = ReadonlyMap<string, string>;

/** The picture of a card outside ART_KINDS: a form, whatever art the world sent. */
const NO_PICTURE: Picture | "form" = "form";

/** An authored art slot's picture, headed by the card's title; a form when the world sent none. */
function artPicture(art: api.Art | undefined, title: string): Picture | "form" {
  return art?.key ? { media: art.key, alt: artAlt(art.slot, title) } : "form";
}

/** The events told over their art slot: troubles, stages, arc ends and seasons. */
const ART_KINDS: ReadonlySet<string> = new Set([
  "trouble.started",
  "trouble.held",
  "trouble.lost",
  "arc.cast",
  "arc.stage-began",
  "arc.stage-ended",
  "arc.ended",
  "season.began",
  "season.finale",
  "season.closed",
]);

/** A card of an art kind over the art the world sent for its event; its own picture is a form until then. */
function withArt(card: Card | null, ev: api.StoryEvent): Card | null {
  if (!card || !ART_KINDS.has(ev.fact.kind)) return card;
  return { ...card, picture: artPicture(ev.art, card.title) };
}

/** The place an event names, or a settlement. */
const placeOf = (ev: api.StoryEvent) => ev.place || "a settlement";

function troubleTitle(ev: api.StoryEvent, lex: Lexicon): string {
  return ev.trouble?.title || troubleName(factStr(ev.fact, "template"), lex);
}

/** The trouble's kind: the trouble's own, else the fact's template. */
const troubleKind = (ev: api.StoryEvent) => ev.trouble?.kind || factStr(ev.fact, "template");

function isRaid(ev: api.StoryEvent): boolean {
  return ev.alarm || troubleKind(ev) === "raid";
}

/** A trouble starting: the raid alarm, or another trouble at a place. */
function troubleStartCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
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
    : [{ name: "Told", value: storyLine(ev.fact, lex, refs) }];
  return {
    context: EVENTS_CHANNEL,
    author: authorLine(raid ? "Raid alarm" : "Trouble", placeOf(ev)),
    title: raid
      ? `Raiders on the road to ${placeOf(ev)}`
      : `${troubleTitle(ev, lex)} at ${placeOf(ev)}`,
    description: raid
      ? "Win beats near it, press the raiders' hunt, or stand a wall: defence counts until the day turns."
      : "Back its one side before the day turns, or the place takes the damage.",
    picture: "form",
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
    picture: "form",
    fields: [
      {
        name: "Backed by",
        value: plural(factNum(ev.fact, "backers"), "character"),
        inline: true,
      },
      {
        name: raid ? "Defence" : "Put in",
        value: amount(factNum(ev.fact, "units"), raid ? "defence" : troubleUnit(troubleKind(ev))),
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
  const parts = stageParts(a, lex);
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", scopeWord(a), ev.fact.kind === "arc.cast" ? "cast" : "next stage"),
    title: a.title,
    description: parts.description,
    picture: "form",
    fields: [parts.stage, ...parts.sides],
    footer: "Back a side from your own card: goods where they land, beats in its regions.",
    rows: buttons.length ? buttonRows(buttons.slice(0, ROW_MOST)) : [],
    colour: parts.colour,
  };
}

/** An event's arc by its template name, where the world sent no arc. */
function eventArcName(ev: api.StoryEvent, lex: Lexicon): string {
  return ev.arc?.scope
    ? arcName(factStr(ev.fact, "template"), ev.arc.scope, lex)
    : factArcName(ev.fact, lex);
}

/** A side's title as the arc gives it, else its row name. */
function sideTitle(ev: api.StoryEvent, id: string, lex: Lexicon): string {
  return ev.arc?.sides.find((s) => s.id === id)?.title ?? sideName(id, lex);
}

/** A stage decided: the side that won it, or that it lapsed and what the world did. */
function stageEndCard(ev: api.StoryEvent, lex: Lexicon): Card {
  const f = ev.fact;
  const side = factStr(f, "side");
  const lapsed = isLapsed(f);
  const title = ev.arc?.title || eventArcName(ev, lex);
  const won = lapsed ? undefined : ev.arc?.sides.find((s) => s.id === side);
  const winner = lapsed ? "" : sideTitle(ev, side, lex);
  const stage = factNum(f, "stage") + 1;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", lapsed ? "a stage lapsed" : "a stage won"),
    title: lapsed ? `${title}: stage ${stage} lapsed` : `${title}: ${winner} won stage ${stage}`,
    description: lapsed
      ? "Nobody met a mark by its deadline: the world does what the stage said it would."
      : "The side that met its mark first won it; the other side is paid for what it put in.",
    picture: "form",
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
function arcEndCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
  const f = ev.fact;
  const outcome = factStr(f, "outcome");
  const lapsed = isLapsed(f);
  const title = ev.arc?.title || eventArcName(ev, lex);
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", "ended"),
    title: lapsed ? `${title} lapsed` : `${title} ended: ${sideTitle(ev, outcome, lex)} won`,
    description: `It ran ${plural(factNum(f, "stages"), "stage")}.`,
    picture: "form",
    fields: [{ name: "Told", value: storyLine(f, lex, refs) }],
    footer: "The chronicle keeps how it went.",
    rows: [],
    colour: lapsed ? COLOUR.rust : COLOUR.signal,
  };
}

/** What a season's close keeps, fades and adds (GDD 13.4); what it added is posted as the next begins. */
const SEASON_KEEPS: EmbedField[] = [
  {
    name: "What the season leaves",
    value: [
      seasonKept(),
      seasonFaded(),
      "Added: what it promoted that a player can use, told in the chronicle channel as the next season begins.",
    ].join("\n"),
  },
];

/** A season's turn: its finale, its close or the next one's start. */
function seasonCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
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
    picture: "form",
    fields: [
      { name: "Told", value: storyLine(f, lex, refs) },
      ...(f.kind === "season.closed" ? SEASON_KEEPS : []),
    ],
    footer: "The chronicle keeps the season's story.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** A place changed: raised to a city, fallen back, ruined, or a faction's city founded. */
function placeEventCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
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
    title: titles[f.kind] ?? capitalise(storyLine(f, lex, refs)),
    description: storyLine(f, lex, refs),
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

/** A road's or route's name as the event's record or fact gives it. */
function roadName(ev: api.StoryEvent): string {
  return capitalise(ev.promotion?.name || factStr(ev.fact, "name") || "a road");
}

/** A road cut by a raid, or tolled since nobody patrolled it (GDD 4.10, 12.9). */
function roadEventCard(ev: api.StoryEvent): Card {
  const f = ev.fact;
  const cut = f.kind === "road.cut";
  const days = factNum(f, "days");
  const fields: EmbedField[] = [{ name: "For", value: amount(days, "days"), inline: true }];
  if (!cut)
    fields.unshift({
      name: "Toll",
      value: `${amount(factNum(f, "coin"), "coin")} a crossing`,
      inline: true,
    });
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Road", cut ? "cut" : "tolled"),
    title: `${roadName(ev)} is ${cut ? "cut" : "tolled"}`,
    description: cut
      ? "Raiders cut it: until it mends it is no faster than the land, no safer and takes no toll."
      : "Nobody held it: each character pays coin to cross it once a day, and one short of coin pays in goods.",
    picture: NO_PICTURE,
    fields,
    footer: cut
      ? "A cut road is still a road: it mends by itself."
      : "A toll leaves the world: nobody pockets it.",
    rows: [],
    colour: COLOUR.rust,
  };
}

/** A caravan robbed on its route by a raid (GDD 4.10). */
function caravanRobbedCard(ev: api.StoryEvent): Card {
  const f = ev.fact;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Caravan", "robbed"),
    title: `A caravan on ${roadName(ev)} was robbed`,
    description:
      "Raiders took part of its goods. What they took lies where it was robbed, for whoever gets there first; the rest goes on.",
    picture: NO_PICTURE,
    fields: [{ name: "Taken", value: amount(factNum(f, "units"), "goods"), inline: true }],
    footer: "A caravan's goods are counted like anyone's: nothing is lost from the world.",
    rows: [],
    colour: COLOUR.rust,
  };
}

/** The events channel's card for one story event, or null for a kind it does not post. */
export function eventCard(ev: api.StoryEvent, lex: Lexicon): Card | null {
  return withArt(eventCardOf(ev, lex), ev);
}

function eventCardOf(ev: api.StoryEvent, lex: Lexicon): Card | null {
  const named = ev.arc ? { ...ev, arc: namedArc(ev.arc, lex) } : ev;
  const refs = refsOf(ev.names);
  switch (ev.fact.kind) {
    case "trouble.started":
      return troubleStartCard(ev, lex, refs);
    case "trouble.held":
    case "trouble.lost":
      return troubleEndCard(ev, lex);
    case "arc.cast":
    case "arc.stage-began":
      return ev.arc ? stagePostCard(ev, namedArc(ev.arc, lex), lex) : null;
    case "arc.stage-ended":
      return stageEndCard(named, lex);
    case "arc.ended":
      return arcEndCard(named, lex, refs);
    case "season.began":
    case "season.finale":
    case "season.closed":
      return seasonCard(ev, lex, refs);
    case "city.raised":
    case "city.fell-back":
    case "settlement.ruined":
    case "faction.city":
    case "core.opened":
    case "pattern.solved":
      return placeEventCard(ev, lex, refs);
    case "road.cut":
    case "road.tolled":
      return roadEventCard(ev);
    case "caravan.robbed":
      return caravanRobbedCard(ev);
    default:
      return null;
  }
}
