import {
  type Button,
  buttonRows,
  type EmbedField,
  type Modal,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import { sideLine } from "../../../../packages/mmo-words/src/index.ts";
import * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { type Action, encodeId, fields, integerTarget, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, hours, num, plural, TICKS_PER_HOUR } from "../units.ts";
import {
  back,
  banner,
  btn,
  buttonLabel,
  factLine,
  option,
  paged,
  PRIVATE,
  ROW_MOST,
  SELECT_MOST,
} from "./common.ts";
import { backMaterial, namedSide } from "./story.ts";

/**
 * /goals (GDD 11, 17): the notice board of the settlement you stand in,
 * one goal at a time, and the posting form; a modal takes the title and
 * note.
 */

/** The verbs the form posts; "vow" is a Hold with no gauge (GDD 11.7). */
const VERBS = ["deliver", "make", "discover", "defeat", "reach", "haul", "hold", "vow"] as const;
const MODES = { f: "first", e: "each", p: "pooled" } as const;
const LIVES = { e: "ephemeral", s: "season", n: "standing" } as const;
const TURNS = { x: "expire", r: "reset", c: "carry", v: "evolve" } as const;
const ISSUERS = { c: "character", p: "party", s: "settlement", a: "admin" } as const;
type Mode = keyof typeof MODES;
type Life = keyof typeof LIVES;
type Turn = keyof typeof TURNS;
type Issuer = keyof typeof ISSUERS;
type Page = "w" | "t";

const AMOUNTS: Record<string, number[]> = {
  deliver: [5, 10, 20, 40, 100, 200, 400],
  haul: [5, 10, 20, 40, 100],
  make: [1, 2, 3, 5],
  discover: [1],
  defeat: [1, 3, 5, 10, 20],
  reach: [1],
  hold: [3, 5, 7, 14],
  vow: [0],
};
/** The rewards a goal may carry, in coin; 0 is none. */
export const REWARDS = [0, 10, 25, 50, 100, 250, 500];
/** What a Discover may ask a tile's field to reach, in pts. */
const LEASTS = [50, 60, 70, 80, 90];
const LEAST = 70;
/** How many an Each goal may pay, up to the board's cap. */
const CAPS = [1, 2, 3, 5, 10, 20, 50];
/** How long an ephemeral goal may be set to last, in hours, inside what the board allows. */
const HOURS = [1, 6, 12, 24, 48, 72];
const HOURS_PER_DAY = 24;

/** A goal being drafted on the form. */
export interface GoalDraft {
  verb: string;
  target: string; // "-" for none yet
  count: number;
  reward: number;
  mode: Mode;
  life: Life;
  turn: Turn;
  issuer: Issuer;
  /** What narrows the target: a Make's trait, a Defeat's region, a Discover's field, a Hold's gauge; "-" for nothing, or for the gauge the board starts a Hold on. */
  narrow: string;
  /** The least a Discover's field must read, in pts, or a Hold's line; 0 for the usual. */
  least: number;
  /** How many an Each goal pays; 0 for the most the board allows. */
  cap: number;
  /** A pooled goal pays everyone the same. */
  even: boolean;
  /** Whom a party goal names besides its poster. */
  members: string[];
  /** The form's page: what the goal asks, or how it runs. */
  page: Page;
  /** A Hold keeps its gauge below its line, or above it. */
  below: boolean;
  /** How long an ephemeral goal lasts, in ticks; 0 for the board's usual. */
  ticks: number;
}

export const BLANK: GoalDraft = {
  verb: "deliver",
  target: "-",
  count: 10,
  reward: 10,
  mode: "f",
  life: "e",
  turn: "x",
  issuer: "c",
  narrow: "-",
  least: 0,
  cap: 0,
  even: false,
  members: [],
  page: "w",
  below: true,
  ticks: 0,
};

/**
 * A draft as a custom-id target: verb.target.count.reward.flags.narrow.least.cap.members.ticks,
 * the flags one letter each for mode, lifetime, turnover, issuer, even shares, page and a Hold's side.
 */
export function goalDraftId(d: GoalDraft): string {
  return target(
    ".",
    VERBS.indexOf(d.verb as never),
    d.target,
    d.count,
    d.reward,
    `${d.mode}${d.life}${d.turn}${d.issuer}${d.even ? "y" : "n"}${d.page}${d.below ? "b" : "a"}`,
    d.narrow,
    d.least,
    d.cap,
    d.members.join(",") || "-",
    d.ticks,
  );
}

export function goalDraftOf(s: string): GoalDraft | null {
  const f = fields(s, ".", 10);
  if (!f) return null;
  const [v, t, c, r, flags, narrow, l, k, who, last] = f;
  const verb = VERBS[integerTarget(v!) ?? -1];
  const [count, reward, least, cap, ticks] = [c, r, l, k, last].map((x) => integerTarget(x!));
  if (!verb || count === undefined || reward === undefined) return null;
  if (least === undefined || cap === undefined || flags!.length !== 7) return null;
  if (ticks === undefined || ticks < 0) return null;
  const [m, life, turn, issuer, even, page, side] = flags!;
  if (!(m! in MODES) || !(life! in LIVES) || !(turn! in TURNS) || !(issuer! in ISSUERS))
    return null;
  if ((even !== "y" && even !== "n") || (page !== "w" && page !== "t")) return null;
  if (side !== "b" && side !== "a") return null;
  return {
    verb,
    target: t!,
    count,
    reward,
    mode: m as Mode,
    life: life as Life,
    turn: turn as Turn,
    issuer: issuer as Issuer,
    narrow: narrow!,
    least,
    cap,
    even: even === "y",
    members: who === "-" ? [] : who!.split(","),
    page,
    below: side === "b",
    ticks,
  };
}

/** A draft the board suggested, as the form's draft. */
export function fromSpec(s: api.GoalSpec): GoalDraft {
  const c = s.cond;
  const pick = (map: Record<string, string>, v: string, or: string) =>
    Object.entries(map).find(([, x]) => x === v)?.[0] ?? or;
  const vow = c.verb === "hold" && !c.gauge;
  let t = c.kind || c.tag || c.at || "-";
  let narrow = "-";
  if (c.verb === "deliver" || c.verb === "defeat") t = c.kind || "-";
  if (c.verb === "discover" || vow) t = c.tag || "-";
  if ((c.verb === "hold" && !vow) || c.verb === "reach") t = c.at || "-";
  if (c.verb === "make") narrow = c.trait || "-";
  if (c.verb === "defeat") narrow = c.at || "-";
  if (c.verb === "discover") narrow = c.field || "-";
  const held = c.verb === "hold" && !vow;
  if (held) narrow = c.gauge || "-";
  return {
    verb: vow ? "vow" : VERBS.includes(c.verb as never) ? c.verb : "deliver",
    target: t,
    count: c.count,
    reward: s.reward,
    mode: pick(MODES, s.mode, "f") as Mode,
    life: pick(LIVES, s.lifetime, "e") as Life,
    turn: pick(TURNS, s.turnover, "x") as Turn,
    issuer: pick(ISSUERS, s.issuer, "c") as Issuer,
    narrow,
    least: (held ? c.line : c.atLeast) ?? 0,
    cap: s.cap ?? 0,
    even: !!s.even,
    members: s.members ?? [],
    page: "w",
    below: held ? !!c.below : true,
    ticks: s.lifetime === LIVES.e ? (s.ticks ?? 0) : 0,
  };
}

/** A Haul and a vow always run as first; any other verb runs in the mode picked. */
function modeOf(d: GoalDraft): Mode {
  return d.verb === "haul" || d.verb === "vow" ? "f" : d.mode;
}

/** How many an Each draft pays: what was picked, held to the board's cap. */
function capOf(d: GoalDraft, g: api.Goals): number {
  return Math.min(d.cap || g.eachCap, g.eachCap);
}

/** The gauge a Hold draft reads: the one picked, else the one the board starts a Hold on. */
function gaugeOf(d: GoalDraft, g: api.Goals): string {
  return d.narrow === "-" ? g.gauge : d.narrow;
}

function lineOf(d: GoalDraft, g: api.Goals): number {
  return d.least || g.line;
}

function sideOf(d: GoalDraft): string {
  return d.below ? api.SideBelow : api.SideAbove;
}

/** How long an ephemeral draft lasts, in ticks. */
function ticksOf(d: GoalDraft, g: api.Goals): number {
  return d.ticks || g.ephemeral;
}

/** The durations the form cycles an ephemeral goal through, in ticks. */
function durations(g: api.Goals): number[] {
  return HOURS.map((h) => h * TICKS_PER_HOUR).filter(
    (t) => t >= g.ephemeralLeast && t <= g.ephemeralMost,
  );
}

/** Ticks in words: whole days, else hours. */
function lasting(ticks: number): string {
  const h = ticks / TICKS_PER_HOUR;
  return h % HOURS_PER_DAY ? plural(h, "hour") : plural(h / HOURS_PER_DAY, "day");
}

/**
 * How a draft turns over: as picked for a season goal. The season's close
 * turns no other, so an ephemeral one expires and a standing one carries.
 */
function turnOf(d: GoalDraft): Turn {
  if (d.life === "s") return d.turn;
  return d.life === "e" ? "x" : "c";
}

/** The spec a draft posts, at the board it is posted on. */
export function specOf(d: GoalDraft, g: api.Goals, title: string, note: string): api.GoalSpec {
  const here = `settlement:${g.settlement}`;
  const mode = modeOf(d);
  const life = { lifetime: LIVES[d.life], turnover: TURNS[turnOf(d)] };
  const ticks = d.life === "e" ? ticksOf(d, g) : undefined;
  if (d.verb === "vow")
    return {
      title,
      note: note || undefined,
      issuer: ISSUERS.c,
      cond: { verb: "hold", count: 0, tag: d.target },
      reward: 0,
      mode: MODES[mode],
      ...life,
      ticks,
    };
  const cond: api.Condition = { verb: d.verb, count: d.count };
  const spec: api.GoalSpec = {
    title,
    note: note || undefined,
    issuer: ISSUERS[d.issuer],
    members: d.issuer === "p" ? d.members : undefined,
    cond,
    reward: d.reward,
    mode: MODES[mode],
    cap: mode === "e" ? capOf(d, g) : undefined,
    ...life,
    ticks,
    even: mode === "p" && d.even ? true : undefined,
  };
  const narrowed = d.narrow !== "-";
  switch (d.verb) {
    case "deliver":
      Object.assign(cond, { kind: d.target, at: here });
      break;
    case "make":
      cond.tag = d.target;
      if (narrowed) cond.trait = d.narrow;
      break;
    case "discover":
      Object.assign(cond, { hex: g.at, within: g.within });
      if (d.target !== "-") cond.tag = d.target;
      if (narrowed) Object.assign(cond, { field: d.narrow, atLeast: d.least || LEAST });
      break;
    case "defeat":
      cond.kind = d.target;
      if (narrowed) cond.at = d.narrow;
      break;
    case "reach":
      Object.assign(cond, { at: d.target, count: 1 });
      break;
    case "hold":
      Object.assign(cond, {
        at: d.target,
        gauge: gaugeOf(d, g),
        line: lineOf(d, g),
        below: d.below ? true : undefined,
      });
      break;
    case "haul": {
      const [material, to] = d.target.split(">");
      Object.assign(cond, { from: here, at: `settlement:${to}` });
      Object.assign(spec, { material, units: d.count });
      break;
    }
  }
  return spec;
}

/** A notice board's name and picture at the head of a card. */
export function boardHead(
  at: { name: string; banner: string },
  ...suffix: string[]
): Pick<Card, "author" | "picture"> {
  return {
    author: authorLine("Notice board", at.name, ...suffix),
    picture: banner(at, ", over its notice board"),
  };
}

function base(g: api.Goals, suffix: string, title: string): Omit<Card, "rows" | "footer"> {
  return { context: PRIVATE, ...boardHead(g, suffix), title, colour: COLOUR.signal };
}

/** A goal as a select's option: the title, and what it asks. */
function goalOption(x: api.Goal) {
  return option(x.title, x.id, capitalise(x.what));
}

function goalOptions(list: readonly api.Goal[]) {
  return list.slice(0, SELECT_MOST).map(goalOption);
}

/** One page of the board's select: the goals the viewer can act on now first, then the newest. */
function boardOptions(list: readonly api.Goal[], page: number) {
  const idle = (x: api.Goal) => (x.takes.length || x.haul ? 0 : 1);
  return paged(
    [...list].sort((a, b) => idle(a) - idle(b)),
    page,
    goalOption,
    "goals",
  );
}

function liveField(g: api.Goals): EmbedField {
  return {
    name: "Your live goals",
    value: `${num(g.live)} of ${plural(g.limit, "goal")}`,
    inline: true,
  };
}

/** A goal's reward in words: coin each, the pool, a vow, or for a proposal what is pledged so far. */
function rewardLine(x: api.Goal): string {
  if (x.state === "proposed") return `${amount(x.reward, "coin")} pledged so far`;
  if (x.vow) return "a vow: nothing is paid";
  if (x.mode === "each")
    return `${amount(x.reward, "coin")} each, up to ${amount(x.cap ?? 0, "people")}`;
  if (x.mode === "pooled")
    return `${amount(x.reward, "coin")} shared ${x.even ? "evenly" : "by contribution"}`;
  return `${amount(x.reward, "coin")} to the first`;
}

function progressLine(x: api.Goal): string {
  if (x.state === "proposed")
    return `${amount(x.pledged ?? 0, "coin")} of ${amount(x.need ?? 0, "coin")} pledged`;
  if (x.verb === "hold" && !x.count) return "a vow, recorded kept or broken when it ends";
  if (x.verb === "hold") return `${outOfDays(x.progress, x.count)} held`;
  return `${num(x.progress)} of ${num(x.count)} done${x.claims ? `, ${plural(x.claims, "claim")}` : ""}`;
}

function outOfDays(n: number, of: number): string {
  return `${num(n)} of ${plural(of, "day")}`;
}

const boardButton = (v: number) => btn("Board", "goals", "", v, { emoji: "↩" });

/** Your own goals wherever they hang, so a busy board never hides one, and the hauls you carry, handed in off the board they hang on. */
function mineRow(g: api.Goals, v: number): Row[] {
  if (!g.mine.length) return [];
  return [
    {
      select: {
        customId: encodeId("goal", "mine", v),
        placeholder: "Your goals and hauls, on any board",
        options: goalOptions(g.mine),
      },
    },
  ];
}

/** Goods goals handed you that wait where they were handed over, place by place. */
function waitingField(g: api.Goals, lex: Lexicon): EmbedField[] {
  if (!g.waiting.length) return [];
  return [
    {
      name: "Waiting for you: act there to take it",
      value: g.waiting
        .slice(0, 5)
        .map(
          (w) =>
            `${w.goods.map((x) => amount(x.units, lex.material(x.material))).join(", ")} at ${w.place}`,
        )
        .join("\n"),
      inline: false,
    },
  ];
}

/** Away from a settlement there is no board to read: only your own goals. */
function awayCard(o: api.Options, g: api.Goals, lex: Lexicon, notice?: string): Card {
  return {
    context: PRIVATE,
    author: authorLine("Notice board", "Away from any board", "Your goals"),
    title: notice ?? "The notice board stands in a settlement",
    picture: "form",
    description: g.mine.length
      ? "Your goals hang on the boards you posted them at, and a haul you carry is handed in where it ends. Open one to watch it, hand it in or take it down."
      : "You have no goal up. Goals are read and posted at a settlement's notice board.",
    fields: [liveField(g), ...waitingField(g, lex)],
    footer:
      "A goal is met by recorded facts wherever its poster stands; its goods wait where they are handed over.",
    rows: [...mineRow(g, o.version), { buttons: [back(o.version)] }],
  };
}

/** The board: every live goal and proposal here, a select to open one, the drafts. */
export function boardCard(
  o: api.Options,
  g: api.Goals,
  lex: Lexicon,
  notice?: string,
  page = 0,
): Card {
  const v = o.version;
  if (g.settlement < 0) return awayCard(o, g, lex, notice);
  const rows: Row[] = [];
  if (g.board.length)
    rows.push({
      select: {
        customId: encodeId("goal", "", v),
        placeholder: "Open a goal",
        options: boardOptions(g.board, page),
      },
    });
  if (g.drafts.length)
    rows.push({
      select: {
        customId: encodeId("g-drafts", "", v),
        placeholder: "Post a goal the board suggests",
        options: g.drafts.map((d, i) => option(d.spec.title, String(i), capitalise(d.why))),
      },
    });
  if (g.met.length)
    rows.push({
      select: {
        customId: encodeId("goal", "met", v),
        placeholder: "Met here lately: who met it, and by what",
        options: goalOptions(g.met),
      },
    });
  rows.push(...mineRow(g, v));
  const buttons: Button[] = [
    btn("Post a goal", "g-form", goalDraftId(BLANK), v, { style: "primary" }),
    back(v),
  ];
  rows.push({ buttons });
  return {
    ...base(g, "Board", notice ?? `Goals at ${g.name}`),
    description: g.board.length
      ? "Goals are conditions on what the world records: nobody judges them. A reward waits in escrow; a vow pays nothing."
      : "Nothing is posted here yet. Post the first goal, or one the board suggests.",
    table: g.board.length
      ? {
          header: ["Goal", "Reward (coin)", "Done (of)", "Left (hours)"],
          rows: g.board
            .slice(0, 12)
            .map((x) => [
              x.title.slice(0, 28),
              x.vow ? "vow" : num(x.reward),
              x.state === "proposed" ? "pledging" : `${num(x.progress)}/${num(x.count)}`,
              x.left ? hours(x.left) : "–",
            ]),
        }
      : undefined,
    fields: [
      liveField(g),
      {
        name: "Listing fee",
        value: `${num(g.fee)}% of the reward, at least ${amount(g.feeLeast, "coin")}`,
        inline: true,
      },
      { name: "You hold", value: amount(g.coin, "coin"), inline: true },
      ...waitingField(g, lex),
    ],
    footer: `A reward is ${amount(g.rewardLeast, "coin")} or more, or none; a settlement goal goes live at ${amount(g.pledgeNeed, "coin")} pledged.`,
    rows,
  };
}

/** A goal met: who claimed what, and the recorded facts each claim cites. */
function metCard(o: api.Options, g: api.Goals, x: api.Goal, lex: Lexicon, notice?: string): Card {
  const paid = x.paid ?? [];
  const cited = paid.flatMap((p) =>
    p.facts.map((f) => `• ${p.who}: ${factLine(f, lex)} (fact #${f.id})`),
  );
  return {
    ...base(g, x.id, notice ?? `Met: ${x.title}`),
    description: [
      goalSummary(x),
      cited.length ? cited.slice(0, 6).join("\n") : "The facts that met it are in the record.",
    ].join("\n"),
    fields: [
      ...goalFields(x, lex).slice(0, 2),
      {
        name: "Claimed by",
        value:
          paid
            .slice(0, 6)
            .map((p) => `${p.who}: ${amount(p.coin, "coin")}, citing ${plural(p.cited, "fact")}`)
            .join("\n") || "nobody: it held to its end",
        inline: false,
      },
    ],
    footer: "Met by recorded facts; each claim cites them, and nobody judged.",
    rows: [{ buttons: [boardButton(o.version)] }],
  };
}

/** One goal: what it asks, who issued it, how far along, and what you can do. */
export function goalCard(
  o: api.Options,
  g: api.Goals,
  x: api.Goal,
  lex: Lexicon,
  notice?: string,
): Card {
  if (x.state === "done") return metCard(o, g, x, lex, notice);
  const v = o.version;
  const acts: Button[] = [];
  for (const t of x.takes.slice(0, 3))
    acts.push(
      btn(
        `Deliver ${amount(t.units, lex.material(t.material))}`,
        "g-deliver",
        target(":", x.id, t.material, t.units),
        v,
        { style: "success" },
      ),
    );
  if (x.haul === "take") acts.push(btn("Take the haul", "g-haul", x.id, v, { style: "success" }));
  if (x.haul === "deliver")
    acts.push(
      btn("Deliver the haul", "g-deliver", target(":", x.id, "haul", 1), v, { style: "success" }),
    );
  const side = x.side && namedSide(x.side, lex);
  if (side && x.state === "live" && side.filled < side.mark) {
    if (side.wants !== "goods") {
      if (!side.mine)
        acts.push(btn(buttonLabel(`Back: ${side.title}`), "s-decl", x.id, v, { style: "success" }));
    } else {
      const material = backMaterial(side, { at: o.at, purse: o.purse, goals: [x] }, lex);
      const there = !side.atHex || (side.atHex.q === o.at.q && side.atHex.r === o.at.r);
      if (material && there)
        acts.push(
          btn(
            buttonLabel(`Back: give ${lex.material(material).toLowerCase()}`),
            "s-give",
            target(":", x.id, material),
            v,
            { style: "success" },
          ),
        );
    }
  }
  if (side) acts.push(btn("The arc", "s-back", x.id, v));
  if (x.canPledge)
    for (const c of [10, 100])
      if (o.purse.coin >= c)
        acts.push(btn(`Pledge ${amount(c, "coin")}`, "g-pledge", target(":", x.id, c), v));
  // The ways out keep their places; what the goal offers fills the rest of the row.
  const out: Button[] = [boardButton(v)];
  if (x.canWithdraw) out.unshift(btn("Withdraw", "g-wd", x.id, v, { style: "danger" }));
  const rows: Row[] = buttonRows([...acts.slice(0, ROW_MOST - out.length), ...out]);
  return {
    ...base(g, x.id, notice ?? x.title),
    description: [
      goalSummary(x),
      x.evolved && x.canWithdraw
        ? "Its target evolved with the new season: today you may withdraw it whatever has been claimed."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    fields: [
      ...goalFields(x, lex),
      ...(side
        ? [
            {
              name: `A side of an arc: ${side.title}${side.mine ? " (you back it)" : ""}`,
              value: `${sideLine(side, lex)}; it pays by what each put in.`,
              inline: false,
            },
          ]
        : []),
    ],
    footer: "Met by recorded facts; the claim cites them, and nobody judges.",
    rows,
  };
}

/** Where a goal happens: at its place, or for a haul or a carry from one place to another. */
function whereLine(x: api.Goal): string {
  if (x.from && x.where) return ` from ${x.from} to ${x.where}`;
  return x.where ? ` at ${x.where}` : "";
}

/** A goal's note and what it asks, as a card's description. */
export function goalSummary(x: api.Goal): string {
  return [x.note, `${capitalise(x.what)}${whereLine(x)}.`].filter(Boolean).join("\n");
}

/** A goal's issuer, reward, progress and terms, for its card and its forum post. */
export function goalFields(x: api.Goal, lex: Lexicon): EmbedField[] {
  return [
    { name: "Issued by", value: `${x.by} (${x.issuer})`, inline: true },
    { name: "Reward", value: rewardLine(x), inline: true },
    { name: "Progress", value: progressLine(x), inline: true },
    {
      name: "Runs",
      // Only a season goal turns over at the season's close.
      value: `${x.mode}, ${x.lifetime}${x.lifetime === LIVES.s ? `, then ${x.turnover}` : ""}`,
      inline: true,
    },
    {
      name: "Time left",
      value: x.left ? amount(Number(hours(x.left)), "hours") : "until met or withdrawn",
      inline: true,
    },
    {
      name: "Most done",
      value: x.top.length
        ? x.top.map((t) => `${t.who}: ${num(t.units)} done`).join("\n")
        : "nobody yet",
      inline: true,
    },
    ...(x.hauler ? [{ name: "Hauled by", value: x.hauler, inline: true }] : []),
    ...(x.building
      ? [{ name: "Raises", value: lex.name("settlements.structures", x.building), inline: true }]
      : []),
  ];
}

/** The room a 100-character custom id leaves a draft and the state version, after the prefix, the longest form action and the separators. */
const ID_ROOM = 100 - "mm|g-narrow||".length;

const labelOf = (picks: readonly api.Pick[], value: string): string =>
  picks.find((p) => p.value === value)?.label ?? value;

/** What a verb may be posted against from here. */
function targetsOf(g: api.Goals, verb: string): readonly api.Pick[] {
  return verb === "vow" ? g.vows : (g.targets.find((t) => t.verb === verb)?.options ?? []);
}

/** A draft that can be named and posted: it asks for something, and a party goal names someone. */
function ready(d: GoalDraft): boolean {
  const asks = d.target !== "-" || (d.verb === "discover" && d.narrow !== "-");
  return asks && (d.issuer !== "p" || d.members.length > 0);
}

/** What a draft asks, in words: the verb, the amount, the target and what narrows it. */
function asks(d: GoalDraft, g: api.Goals): string {
  const what = d.target === "-" ? "" : labelOf(targetsOf(g, d.verb), d.target);
  if (d.verb === "vow") return what ? `A vow: ${what}` : "A vow to hold off a thing";
  let narrowed = "";
  if (d.narrow !== "-" && d.verb === "make") narrowed = ` with ${labelOf(g.traits, d.narrow)}`;
  if (d.narrow !== "-" && d.verb === "defeat") narrowed = ` in ${labelOf(g.places, d.narrow)}`;
  if (d.narrow !== "-" && d.verb === "discover")
    narrowed = `${what ? "," : ""} where ${labelOf(g.fields, d.narrow)} is ${amount(d.least || LEAST, "pts")} or more`;
  if (d.verb === "hold") narrowed = `${what ? "," : ""} ${heldAt(d, g)}`;
  const tail = `${what}${narrowed}`.trim();
  return `${capitalise(d.verb)} ${amountWord(d)}${tail ? `: ${tail}` : ""}`;
}

/** The side and line a Hold draft keeps its gauge to, the gauge as the line's unit: "below 700 threat". */
function heldAt(d: GoalDraft, g: api.Goals, line = lineOf(d, g)): string {
  return `${labelOf(g.sides, sideOf(d))} ${amount(line, gaugeOf(d, g))}`;
}

/** The value after one in a list, round to the first; the first when it is not in the list. */
function after<T>(list: readonly T[], x: T): T | undefined {
  return list[(list.indexOf(x) + 1) % list.length];
}

/**
 * The posting form, a page at a time: what the goal asks, then how it
 * runs. Every select option and button carries the whole draft, so a
 * choice that would not fit a custom id is not offered.
 */
export function goalForm(o: api.Options, g: api.Goals, d: GoalDraft): Card {
  const v = o.version;
  const vow = d.verb === "vow";
  const id = goalDraftId(d);
  const room = ID_ROOM - String(v).length;
  const set = (over: Partial<GoalDraft>): string | null => {
    const next = goalDraftId({ ...d, ...over });
    return next.length <= room ? next : null;
  };
  type Choice = [label: string, over: Partial<GoalDraft>];
  const select = (action: Action, placeholder: string, choices: Choice[]): Row[] => {
    const options = choices
      .flatMap(([label, over]) => {
        const value = set(over);
        return value === null ? [] : [option(label, value)];
      })
      .slice(0, SELECT_MOST);
    return options.length
      ? [{ select: { customId: encodeId(action, id, v), placeholder, options } }]
      : [];
  };
  const cycle = (label: string, over: Partial<GoalDraft>, disabled = false): Button =>
    btn(label, "g-form", set(over) ?? id, v, { disabled });
  /** "Any …" first once something is picked, then the picks. */
  const narrowing = (placeholder: string, none: string, picks: readonly api.Pick[]): Row[] =>
    select("g-narrow", placeholder, [
      ...(d.narrow === "-" ? [] : [[none, { narrow: "-", least: 0 }] as Choice]),
      ...picks
        .filter((p) => p.value !== d.narrow)
        .map(
          (p): Choice => [
            p.label,
            { narrow: p.value, least: d.verb === "discover" ? d.least || LEAST : 0 },
          ],
        ),
    ]);
  const targets = targetsOf(g, d.verb);
  const verbs = [...g.targets.map((t) => t.verb), ...(g.vows.length ? ["vow"] : [])];
  // What a Hold reads and how long an ephemeral goal lasts cycle beside the
  // page buttons: both pages' rows are full of selects.
  const turns: Button[] = [];
  /** A button named for the pick it shows, turning it to the next in its list; none when there is no other. */
  const turnTo = <T>(
    label: string,
    list: readonly T[],
    current: T,
    over: (next: T) => Partial<GoalDraft>,
  ) => {
    const next = after(list, current);
    const id = next === undefined || next === current ? null : set(over(next));
    if (id) turns.push(btn(buttonLabel(label), "g-form", id, v));
  };
  if (d.page === "w" && d.verb === "hold") {
    turnTo(
      `Gauge: ${labelOf(g.gauges, gaugeOf(d, g))}`,
      g.gauges.map((x) => x.value),
      gaugeOf(d, g),
      (narrow) => ({ narrow }),
    );
    turnTo(
      `Side: ${labelOf(g.sides, sideOf(d))}`,
      g.sides.map((x) => x.value),
      sideOf(d),
      (side) => ({ below: side === api.SideBelow }),
    );
  }
  if (d.page === "t" && d.life === "e")
    turnTo(`For: ${lasting(ticksOf(d, g))}`, durations(g), ticksOf(d, g), (ticks) => ({ ticks }));
  const nav: Button[] = [
    ...turns,
    btn(
      d.page === "w" ? "How it runs" : "What it asks",
      "g-page",
      set({ page: d.page === "w" ? "t" : "w" }) ?? id,
      v,
    ),
    btn("Name it and post", "g-name", id, v, { style: "success", disabled: !ready(d) }),
    boardButton(v),
  ];
  const rows: Row[] = [];
  if (d.page === "w") {
    rows.push(
      ...select(
        "g-verb",
        `Verb: ${capitalise(d.verb)}`,
        verbs
          .filter((x) => x !== d.verb)
          .map(
            (x): Choice => [
              x === "vow" ? "Vow: hold off a thing" : capitalise(x),
              {
                verb: x,
                target: "-",
                count: (AMOUNTS[x] ?? [1])[0]!,
                narrow: "-",
                least: 0,
                below: true,
                ...(x === "vow" ? { issuer: "c", members: [] } : {}),
              },
            ],
          ),
      ),
      ...select(
        "g-target",
        d.target === "-" ? "Pick what it asks for" : labelOf(targets, d.target),
        targets
          .filter((t) => t.value !== d.target)
          .map((t): Choice => [t.label, { target: t.value }]),
      ),
      ...select(
        "g-amount",
        `Amount: ${amountWord(d)}`,
        (AMOUNTS[d.verb] ?? [1])
          .filter((n) => n !== d.count)
          .map((n): Choice => [amountWord({ ...d, count: n }), { count: n }]),
      ),
    );
    if (d.verb === "make")
      rows.push(
        ...narrowing(
          d.narrow === "-"
            ? "With any trait, or none"
            : `With the trait: ${labelOf(g.traits, d.narrow)}`,
          "Any trait, or none",
          g.traits,
        ),
      );
    if (d.verb === "defeat")
      rows.push(
        ...narrowing(
          d.narrow === "-" ? "Defeated anywhere" : `Defeated in: ${labelOf(g.places, d.narrow)}`,
          "Anywhere",
          g.places,
        ),
      );
    if (d.verb === "hold")
      rows.push(
        ...select(
          "g-least",
          `Line: ${heldAt(d, g)}`,
          (g.gauges.find((x) => x.value === gaugeOf(d, g))?.lines ?? [])
            .filter((n) => n !== lineOf(d, g))
            .map((n): Choice => [capitalise(heldAt(d, g, n)), { least: n }]),
        ),
      );
    if (d.verb === "discover") {
      rows.push(
        ...narrowing(
          d.narrow === "-"
            ? "On any ground"
            : `Where it is rich in: ${labelOf(g.fields, d.narrow)}`,
          "Any ground",
          g.fields,
        ),
      );
      if (d.narrow !== "-")
        rows.push(
          ...select(
            "g-least",
            `At least ${amount(d.least || LEAST, "pts")}`,
            LEASTS.filter((n) => n !== (d.least || LEAST)).map(
              (n): Choice => [`At least ${amount(n, "pts")}`, { least: n }],
            ),
          ),
        );
    }
  } else {
    const mode = modeOf(d);
    if (!vow)
      rows.push(
        ...select(
          "g-reward",
          `Reward: ${d.reward ? amount(d.reward, "coin") : "none (a vow)"}`,
          REWARDS.filter((n) => n !== d.reward).map(
            (n): Choice => [n ? amount(n, "coin") : "None: a vow", { reward: n }],
          ),
        ),
      );
    if (mode === "e")
      rows.push(
        ...select(
          "g-cap",
          `Pays up to ${amount(capOf(d, g), "people")}`,
          [...new Set([...CAPS.filter((n) => n < g.eachCap), g.eachCap])]
            .filter((n) => n !== capOf(d, g))
            .map((n): Choice => [`Up to ${amount(n, "people")}`, { cap: n }]),
        ),
      );
    if (d.issuer === "p" && !vow)
      rows.push(
        ...select("g-party", "Name someone standing here for the party", [
          ...(d.members.length < g.partyMost
            ? g.party
                .filter((p) => !d.members.includes(p.value))
                .map((p): Choice => [p.label, { members: [...d.members, p.value] }])
            : []),
          ...(d.members.length ? [["Start the party over", { members: [] }] as Choice] : []),
        ]),
      );
    const next = nextIssuer(d.issuer, g);
    const lasts = cycle(`Lasts: ${LIVES[d.life]}`, { life: cycleOf(LIVES, d.life) });
    // Only a season goal turns over at the season's close.
    const then =
      d.life === "s" ? [cycle(`Then: ${TURNS[d.turn]}`, { turn: cycleOf(TURNS, d.turn) })] : [];
    rows.push({
      buttons: vow
        ? [lasts, ...then]
        : [
            cycle(`Mode: ${MODES[mode]}`, { mode: cycleOf(MODES, d.mode) }, d.verb === "haul"),
            lasts,
            ...then,
            cycle(`By: ${ISSUERS[d.issuer]}`, {
              issuer: next,
              members: next === "p" ? d.members : [],
            }),
            ...(g.even && mode === "p"
              ? [cycle(`Split: ${d.even ? "evenly" : "by contribution"}`, { even: !d.even })]
              : []),
          ],
    });
  }
  rows.push({ buttons: nav });
  const escrow = escrowOf(d, g);
  const fee = d.reward && !vow ? Math.max(g.feeLeast, Math.ceil((escrow * g.fee) / 100)) : 0;
  return {
    context: PRIVATE,
    author: authorLine("Notice board", g.name, "Post a goal"),
    title: asks(d, g),
    picture: "form",
    description:
      d.page === "w" && d.verb === "hold"
        ? "Pick the region, the days and the line; the buttons turn the gauge and the side of the line it is held on. How it runs is on the other page; the title and a note come last."
        : d.page === "w"
          ? "Pick the verb, what it asks for and the amount, and narrow it if you like. How it runs is on the other page; the title and a note come last."
          : "Pick the reward; the buttons cycle how it runs, how long an ephemeral goal lasts and who issues it. The title and a note come last.",
    fields: [
      { name: "Escrow", value: amount(escrow, "coin"), inline: true },
      { name: "Listing fee", value: amount(fee, "coin"), inline: true },
      { name: "You hold", value: amount(g.coin, "coin"), inline: true },
      ...(d.issuer === "p" && !vow
        ? [
            {
              name: "The party, besides you",
              value: d.members.map((m) => labelOf(g.party, m)).join(", ") || "nobody named yet",
              inline: false,
            },
          ]
        : []),
    ],
    footer: formFooter(d, g),
    rows,
  };
}

function formFooter(d: GoalDraft, g: api.Goals): string {
  if (d.verb === "vow")
    return "A vow pays nothing and costs nothing: it is recorded kept or broken when it ends.";
  if (d.issuer === "s")
    return `A settlement goal waits for ${amount(g.pledgeNeed, "coin")} pledged before it goes live.`;
  if (d.issuer === "p")
    return `A party goal is for you and up to ${amount(g.partyMost, "people")} you name; you pay its reward.`;
  return `An Each goal pays up to ${amount(capOf(d, g), "people")}; Season goals turn over when the season closes.`;
}

function escrowOf(d: GoalDraft, g: api.Goals): number {
  if (d.issuer === "s" || d.verb === "vow") return 0;
  return modeOf(d) === "e" ? d.reward * capOf(d, g) : d.reward;
}

function amountWord(d: GoalDraft): string {
  switch (d.verb) {
    case "hold":
      return plural(d.count, "day");
    case "defeat":
      return plural(d.count, "creature");
    case "make":
      return plural(d.count, "item");
    case "reach":
    case "discover":
      return "once";
    case "vow":
      return "until it ends";
    default:
      return amount(d.count, "goods");
  }
}

function cycleOf<K extends string>(map: Record<K, string>, k: K): K {
  return after(Object.keys(map) as K[], k)!;
}

/** Who issues next: a party where someone stands to be named, a muster for an officer. */
function nextIssuer(i: Issuer, g: api.Goals): Issuer {
  const order: Issuer[] = [
    "c",
    ...(g.party.length ? ["p" as const] : []),
    "s",
    ...(g.officer ? ["a" as const] : []),
  ];
  return after(order, i)!;
}

/** The modal that names a goal: its title and an optional note. */
export function goalModal(draftId: string, version: number): Modal {
  return {
    customId: encodeId("g-post", draftId, version),
    title: "Name your goal",
    inputs: [
      { id: "title", label: "Title", max: 60, required: true },
      { id: "note", label: "A note (optional)", max: 300, long: true, required: false },
    ],
  };
}
