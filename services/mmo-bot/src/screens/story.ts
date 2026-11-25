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
  stagedLine,
  storyLine,
} from "./common.ts";
import { dropCard, fairCard, stagedOf, type StagedView } from "./staged.ts";

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

/** A side won by a word with someone: the answer chosen when talking to them. */
const WORD = "word";

/** A side as a field: its title, then what it wants, who backs it, what it pays and for whom. */
function sideField(s: api.Side, lex: Lexicon): EmbedField {
  if (s.wants === WORD)
    return {
      name: s.title.slice(0, 256),
      value: `A word with ${s.at || "them"}: choose it when you talk to them${s.mine ? " · you chose it" : ""}`,
      inline: true,
    };
  return { name: s.title.slice(0, 256), value: capitalise(sideDetail(s, lex)), inline: true };
}

/** The one a thread's words are said to: its cast's npc, by name and id. */
function wordWith(a: api.Arc): api.CastRef | undefined {
  return a.cast.find((c) => c.role === "npc" && c.kind === "npc");
}

/** The way to a word side's answer: a talk when they are here, else the way to the thread's seat. */
function wordButtons(a: api.Arc, here: api.Here, o: api.Options): Button[] {
  if (a.outcome || !a.sides.some((s) => s.wants === WORD)) return [];
  const who = wordWith(a);
  const met = who && here.people.find((p) => p.id === who.id);
  if (met)
    return [btn(buttonLabel(`Talk: ${met.name}`), "talk", met.id, o.version, { style: "primary" })];
  if (sameHex(a.seat, o.at)) return [];
  return [
    btn(
      buttonLabel(`Go to ${who?.name ?? "them"}`),
      "goto",
      target(",", a.seat.q, a.seat.r),
      o.version,
    ),
  ];
}

/** How a word thread is answered, in a line. */
function wordLine(a: api.Arc): string {
  const sides = a.sides.filter((s) => s.wants === WORD);
  if (!sides.length || a.outcome) return "";
  const who = wordWith(a)?.name ?? "them";
  return `Talk to ${who} and choose one: ${sides.map((s) => s.title.toLowerCase()).join(" or ")}.`;
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
      wordLine(a),
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
  const goods = [...b.purse.goods]
    .filter((g) => g.units > 0 && !g.staged)
    .sort((x, y) => y.units - x.units);
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
  // A word is said by talking to someone, never by declaring.
  if (s.wants === WORD) return [];
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
  const buttons = [
    ...wordButtons(a, here, o),
    ...backButtons(a, v, lex, { at: o.at, purse: o.purse, goals: opts.goals }),
  ];
  const tail: Button[] = [btn("The chronicle", "chronicle", "", v), back(v)];
  if (t?.hunt) tail.unshift(btn("The raiders' hunt", "hunt", t.hunt, v, { style: "danger" }));
  return {
    context: PRIVATE,
    author: authorLine(t ? "Trouble" : "Arc", scopeWord(a)),
    title: opts.notice ?? a.title,
    description: parts.description,
    picture: banner(here, `; ${a.title}`),
    fields,
    footer: wordLine(a)
      ? "The answer you give ends it; say nothing and it lapses when its day ends."
      : "Every side pays by what each backer put in; the first to meet its mark wins the stage.",
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

/** An authored art slot's picture, headed by the card's title; a form when the world sent none. */
function artPicture(art: api.Art | undefined, title: string): Picture | "form" {
  return art?.key ? { media: art.key, alt: artAlt(art.slot, title) } : "form";
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
  const title = raid
    ? `Raiders on the road to ${placeOf(ev)}`
    : `${troubleTitle(ev, lex)} at ${placeOf(ev)}`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine(raid ? "Raid alarm" : "Trouble", placeOf(ev)),
    title,
    description: raid
      ? "Win beats near it, press the raiders' hunt, or stand a wall: defence counts until the day turns."
      : "Back its one side before the day turns, or the place takes the damage.",
    picture: artPicture(ev.art, title),
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
    picture: artPicture(ev.art, title),
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
    picture: artPicture(ev.art, a.title),
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
  const cardTitle = lapsed
    ? `${title}: stage ${stage} lapsed`
    : `${title}: ${winner} won stage ${stage}`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", lapsed ? "a stage lapsed" : "a stage won"),
    title: cardTitle,
    description: lapsed
      ? "Nobody met a mark by its deadline: the world does what the stage said it would."
      : "The side that met its mark first won it; the other side is paid for what it put in.",
    picture: artPicture(ev.art, cardTitle),
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
  const cardTitle = lapsed
    ? `${title} lapsed`
    : `${title} ended: ${sideTitle(ev, outcome, lex)} won`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Arc", "ended"),
    title: cardTitle,
    description: `It ran ${plural(factNum(f, "stages"), "stage")}.`,
    picture: artPicture(ev.art, cardTitle),
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
    picture: artPicture(ev.art, title),
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
    picture: "form",
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
    picture: "form",
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
    picture: "form",
    fields: [{ name: "Taken", value: amount(factNum(f, "units"), "goods"), inline: true }],
    footer: "A caravan's goods are counted like anyone's: nothing is lost from the world.",
    rows: [],
    colour: COLOUR.rust,
  };
}

/** A theft's public title, by its kind and how it went; it never names the thief. */
function theftTitle(f: api.Fact, where: string): string {
  const outcome = factStr(f, "outcome");
  if (outcome === "lost") return `A thief was caught at ${where}`;
  if (outcome === "empty") return `A thief came away empty at ${where}`;
  switch (factStr(f, "kind")) {
    case "burgle":
      return `A store was broken into at ${where}`;
    case "waylay":
      return `A caravan was waylaid near ${where}`;
    default:
      return `A pocket was picked at ${where}`;
  }
}

/** A theft in the events channel: what kind, where and what it was worth, and never who (GDD 12.7). */
function theftEventCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
  const f = ev.fact;
  const won = factStr(f, "outcome") === "won";
  const title = theftTitle(f, placeOf(ev));
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Theft", placeOf(ev)),
    title,
    description: storyLine(f, lex, refs),
    picture: "form",
    fields: won
      ? [{ name: "Taken", value: `worth ${amount(factNum(f, "worth"), "coin")}`, inline: true }]
      : [],
    footer: "The thief goes unnamed: the watch keeps its own counsel.",
    rows: [],
    colour: COLOUR.rust,
  };
}

/**
 * A staging's event with what the poster read beside it: the house's view
 * of its stage, and a fair's contests from the board.
 */
export type StagedEvent = api.StoryEvent & { stage?: api.StageView; contests?: api.Goal[] };

/** What each kind of staging is called on its card. */
const STAGED_TITLES: Record<string, (where: string) => string> = {
  contest: (w) => `A contest at ${w}`,
  hardship: (w) => `A staged hardship at ${w}`,
  hunt: (w) => `A staged hunt near ${w}`,
  vault: (w) => `A competing vault near ${w}`,
  pattern: (w) => `A staged pattern near ${w}`,
  drop: (w) => `A drop of crates near ${w}`,
  fair: (w) => `A fair at ${w}`,
};

/** A staging's kind as the card's author says it. */
function stagedKind(st: StagedView): string {
  return st.kind ? capitalise(st.kind) : "Staged";
}

/** A staging opened that is neither a drop nor a fair: what, where and who staged it. */
function stagedOpenedCard(ev: api.StoryEvent, st: StagedView, lex: Lexicon, refs: Refs): Card {
  const title = (STAGED_TITLES[st.kind] ?? ((w: string) => `Staged at ${w}`))(placeOf(ev));
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Staged", stagedKind(st), placeOf(ev)),
    title,
    description: `${stagedLine(st.placed)}.
${storyLine(ev.fact, lex, refs)}`,
    picture: artPicture(ev.art, title),
    fields: st.days ? [{ name: "Lasts", value: amount(st.days, "days"), inline: true }] : [],
    footer: "Staged here, and posted only here: who staged it takes nothing from it.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** A staging opened: a drop and a fair are their own cards, kept live as their crates go. */
function stagedEventCard(ev: StagedEvent, lex: Lexicon, refs: Refs): Card {
  const st = stagedOf(ev, ev.stage);
  if (st.kind === "drop") return dropCard(st);
  if (st.kind === "fair") return fairCard(st, ev.contests ?? [], undefined, ev.art);
  return stagedOpenedCard(ev, st, lex, refs);
}

/** A staging closed: early, at its end, or because it could not open; what came of it. */
function stagedClosedCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
  const st = stagedOf(ev);
  const f = ev.fact;
  const fields: EmbedField[] = [];
  if (factNum(f, "crates"))
    fields.push({ name: "Opened", value: plural(factNum(f, "crates"), "crate"), inline: true });
  if (factNum(f, "winners"))
    fields.push({
      name: "Won by",
      value: plural(factNum(f, "winners"), "character"),
      inline: true,
    });
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Staged", stagedKind(st), "over"),
    title: `${(STAGED_TITLES[st.kind] ?? ((w: string) => `Staged at ${w}`))(placeOf(ev))} is over`,
    description: storyLine(f, lex, refs),
    picture: "form",
    fields,
    footer: "What it paid stays staged where it was staged; nothing is refunded.",
    rows: [],
    colour: COLOUR.ash,
  };
}

/** A competing vault taken: by a crew's size and the staged haul, never who sat in it. */
function vaultTakenCard(ev: api.StoryEvent, lex: Lexicon, refs: Refs): Card {
  const f = ev.fact;
  const title = `The competing vault near ${placeOf(ev)} was taken`;
  return {
    context: EVENTS_CHANNEL,
    author: authorLine("Vault", placeOf(ev), "taken"),
    title,
    description: storyLine(f, lex, refs),
    picture: artPicture(ev.art, title),
    fields: [
      { name: "Crew", value: plural(factNum(f, "seats"), "member"), inline: true },
      { name: "Haul", value: amount(factNum(f, "goods"), "goods"), inline: true },
    ],
    footer: "The first crew to solve it took the haul; a rival's machine went haywire.",
    rows: [],
    colour: COLOUR.signal,
  };
}

/** The events channel's card for one story event, or null for a kind it does not post. */
export function eventCard(ev: StagedEvent, lex: Lexicon): Card | null {
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
    case "theft.made":
      return theftEventCard(ev, lex, refs);
    case "staged.opened":
      return stagedEventCard(ev, lex, refs);
    case "staged.closed":
      return stagedClosedCard(ev, lex, refs);
    case "vault.taken":
      return vaultTakenCard(ev, lex, refs);
    default:
      return null;
  }
}
