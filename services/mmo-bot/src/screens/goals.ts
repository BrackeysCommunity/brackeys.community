import {
  type Button,
  buttonRows,
  type EmbedField,
  type Modal,
  type Row,
} from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId, fields, integerTarget, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, hours, num, plural } from "../units.ts";
import { back, banner, btn, factLine, PRIVATE } from "./common.ts";

/**
 * /goals (GDD 11, 17): the notice board of the settlement you stand in,
 * one goal at a time, and the posting form: a chain of selects for the
 * verb, target, amount and reward, buttons that cycle the mode, lifetime,
 * turnover and issuer, and a modal for the title and note.
 */

const VERBS = ["deliver", "make", "discover", "defeat", "reach", "haul", "hold"] as const;
const MODES = { f: "first", e: "each", p: "pooled" } as const;
const LIVES = { e: "ephemeral", s: "season", n: "standing" } as const;
const TURNS = { x: "expire", r: "reset", c: "carry", v: "evolve" } as const;
const ISSUERS = { c: "character", s: "settlement", a: "admin" } as const;
type Mode = keyof typeof MODES;
type Life = keyof typeof LIVES;
type Turn = keyof typeof TURNS;
type Issuer = keyof typeof ISSUERS;

/** How many claimants an Each goal posted from the form pays. */
export const EACH_CAP = 10;

const AMOUNTS: Record<string, number[]> = {
  deliver: [5, 10, 20, 40, 100, 200, 400],
  haul: [5, 10, 20, 40, 100],
  make: [1, 2, 3, 5],
  discover: [1],
  defeat: [1, 3, 5, 10, 20],
  reach: [1],
  hold: [3, 5, 7, 14],
};
const REWARDS = [0, 10, 25, 50, 100, 250, 500];

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
};

/** A draft as a custom-id target: verb.target.count.reward.mode.life.turn.issuer. */
export function goalDraftId(d: GoalDraft): string {
  return target(
    ".",
    VERBS.indexOf(d.verb as never),
    d.target,
    d.count,
    d.reward,
    d.mode,
    d.life,
    d.turn,
    d.issuer,
  );
}

export function goalDraftOf(s: string): GoalDraft | null {
  const f = fields(s, ".", 8);
  if (!f) return null;
  const [v, t, c, r, m, l, o, i] = f;
  const verb = VERBS[integerTarget(v!) ?? -1];
  const count = integerTarget(c!);
  const reward = integerTarget(r!);
  if (!verb || count === undefined || reward === undefined) return null;
  if (!(m! in MODES) || !(l! in LIVES) || !(o! in TURNS) || !(i! in ISSUERS)) return null;
  return {
    verb,
    target: t!,
    count,
    reward,
    mode: m as Mode,
    life: l as Life,
    turn: o as Turn,
    issuer: i as Issuer,
  };
}

/** A draft the board suggested, as the form's draft. */
export function fromSpec(s: api.GoalSpec): GoalDraft {
  const c = s.cond;
  const pick = (map: Record<string, string>, v: string, or: string) =>
    Object.entries(map).find(([, x]) => x === v)?.[0] ?? or;
  let t = c.kind || c.tag || c.at || "-";
  if (c.verb === "deliver") t = c.kind || "-";
  if (c.verb === "discover") t = c.tag || "-";
  if (c.verb === "hold" || c.verb === "reach") t = c.at || "-";
  return {
    verb: VERBS.includes(c.verb as never) ? c.verb : "deliver",
    target: t,
    count: c.count,
    reward: s.reward,
    mode: pick(MODES, s.mode, "f") as Mode,
    life: pick(LIVES, s.lifetime, "e") as Life,
    turn: pick(TURNS, s.turnover, "x") as Turn,
    issuer: pick(ISSUERS, s.issuer, "c") as Issuer,
  };
}

/** The spec a draft posts, at the board it is posted on. */
export function specOf(d: GoalDraft, g: api.Goals, title: string, note: string): api.GoalSpec {
  const here = `settlement:${g.settlement}`;
  const cond: api.Condition = { verb: d.verb, count: d.count };
  const spec: api.GoalSpec = {
    title,
    note: note || undefined,
    issuer: ISSUERS[d.issuer],
    cond,
    reward: d.reward,
    mode: MODES[d.mode],
    cap: d.mode === "e" ? EACH_CAP : undefined,
    lifetime: LIVES[d.life],
    turnover: TURNS[d.turn],
    ticks: d.life === "e" ? g.ephemeral : undefined,
  };
  switch (d.verb) {
    case "deliver":
      Object.assign(cond, { kind: d.target, at: here });
      break;
    case "make":
      cond.tag = d.target;
      break;
    case "discover":
      Object.assign(cond, { tag: d.target, hex: g.at, within: g.within });
      break;
    case "defeat":
      cond.kind = d.target;
      break;
    case "reach":
      Object.assign(cond, { at: d.target, count: 1 });
      break;
    case "hold":
      Object.assign(cond, { at: d.target, gauge: "threat", line: g.line, below: true });
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

function base(g: api.Goals, suffix: string, title: string): Omit<Card, "rows" | "footer"> {
  return {
    context: PRIVATE,
    author: authorLine("Notice board", g.name, suffix),
    title,
    picture: banner(g, ", over its notice board"),
    colour: COLOUR.signal,
  };
}

/** A goal's reward in words: coin each, the pool, or a vow. */
function rewardLine(x: api.Goal): string {
  if (x.vow) return "a vow: nothing is paid";
  if (x.mode === "each")
    return `${amount(x.reward, "coin")} each, up to ${amount(x.cap ?? 0, "people")}`;
  if (x.mode === "pooled") return `${amount(x.reward, "coin")} shared by contribution`;
  return `${amount(x.reward, "coin")} to the first`;
}

function progressLine(x: api.Goal): string {
  if (x.state === "proposed")
    return `${amount(x.pledged ?? 0, "coin")} of ${amount(x.need ?? 0, "coin")} pledged`;
  if (x.verb === "hold") return `${outOfDays(x.progress, x.count)} held`;
  return `${num(x.progress)} of ${num(x.count)} done${x.claims ? `, ${plural(x.claims, "claim")}` : ""}`;
}

function outOfDays(n: number, of: number): string {
  return `${num(n)} of ${plural(of, "day")}`;
}

/** The board: every live goal and proposal here, a select to open one, the drafts. */
export function boardCard(o: api.Options, g: api.Goals, notice?: string): Card {
  const v = o.version;
  const rows: Row[] = [];
  if (g.board.length)
    rows.push({
      select: {
        customId: encodeId("goal", "", v),
        placeholder: "Open a goal",
        options: g.board.slice(0, 25).map((x) => ({
          label: x.title.slice(0, 90),
          value: x.id,
          description: `${capitalise(x.what)}`.slice(0, 90),
        })),
      },
    });
  if (g.drafts.length)
    rows.push({
      select: {
        customId: encodeId("g-drafts", "", v),
        placeholder: "Post a goal the board suggests",
        options: g.drafts.map((d, i) => ({
          label: d.spec.title.slice(0, 90),
          value: String(i),
          description: capitalise(d.why).slice(0, 90),
        })),
      },
    });
  if (g.met.length)
    rows.push({
      select: {
        customId: encodeId("goal", "met", v),
        placeholder: "Met here lately: who met it, and by what",
        options: g.met.map((x) => ({
          label: x.title.slice(0, 90),
          value: x.id,
          description: capitalise(x.what).slice(0, 90),
        })),
      },
    });
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
              x.state === "proposed" ? "proposed" : `${num(x.progress)}/${num(x.count)}`,
              x.left ? hours(x.left) : "–",
            ]),
        }
      : undefined,
    fields: [
      {
        name: "Your live goals",
        value: `${num(g.live)} of ${plural(g.limit, "goal")}`,
        inline: true,
      },
      {
        name: "Listing fee",
        value: `${num(g.fee)}% of the reward, at least ${amount(g.feeLeast, "coin")}`,
        inline: true,
      },
      { name: "You hold", value: amount(g.coin, "coin"), inline: true },
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
      { name: "Issued by", value: `${x.by} (${x.issuer})`, inline: true },
      { name: "Reward", value: rewardLine(x), inline: true },
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
    rows: [{ buttons: [btn("Board", "goals", "", o.version, { emoji: "↩" })] }],
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
  for (const t of x.takes.slice(0, 3)) {
    const left = x.mode === "pooled" ? x.count - x.progress : x.count - x.yours;
    const n = Math.min(t.units, left);
    if (n > 0)
      acts.push(
        btn(
          `Deliver ${amount(n, lex.material(t.material))}`,
          "g-deliver",
          target(":", x.id, t.material, n),
          v,
          {
            style: "success",
          },
        ),
      );
  }
  if (x.haul === "take") acts.push(btn("Take the haul", "g-haul", x.id, v, { style: "success" }));
  if (x.haul === "deliver")
    acts.push(
      btn("Deliver the haul", "g-deliver", target(":", x.id, "haul", 1), v, { style: "success" }),
    );
  if (x.state === "proposed" || (x.mode !== "each" && !x.vow))
    for (const c of [10, 100])
      if (o.purse.coin >= c)
        acts.push(btn(`Pledge ${amount(c, "coin")}`, "g-pledge", target(":", x.id, c), v));
  if (x.mine && !x.claims) acts.push(btn("Withdraw", "g-wd", x.id, v, { style: "danger" }));
  const rows: Row[] = buttonRows([
    ...acts.slice(0, 4),
    btn("Board", "goals", "", v, { emoji: "↩" }),
  ]);
  return {
    ...base(g, x.id, notice ?? x.title),
    description: goalSummary(x),
    fields: goalFields(x, lex),
    footer: "Met by recorded facts; the claim cites them, and nobody judges.",
    rows,
  };
}

/** A goal's note and what it asks, as a card's description. */
export function goalSummary(x: api.Goal): string {
  return [x.note, `${capitalise(x.what)}${x.where ? ` at ${x.where}` : ""}.`]
    .filter(Boolean)
    .join("\n");
}

/** A goal's issuer, reward, progress and terms, for its card and its forum post. */
export function goalFields(x: api.Goal, lex: Lexicon): EmbedField[] {
  return [
    { name: "Issued by", value: `${x.by} (${x.issuer})`, inline: true },
    { name: "Reward", value: rewardLine(x), inline: true },
    { name: "Progress", value: progressLine(x), inline: true },
    { name: "Runs", value: `${x.mode}, ${x.lifetime}, then ${x.turnover}`, inline: true },
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

/** The posting form: four selects and the cycling buttons; the title comes in a modal. */
export function goalForm(o: api.Options, g: api.Goals, d: GoalDraft): Card {
  const v = o.version;
  const targets = g.targets.find((t) => t.verb === d.verb)?.options ?? [];
  const id = goalDraftId(d);
  const set = (k: keyof GoalDraft, x: string | number): string => goalDraftId({ ...d, [k]: x });
  const all: Row[] = [
    {
      select: {
        customId: encodeId("g-verb", id, v),
        placeholder: `Verb: ${capitalise(d.verb)}`,
        options: g.targets
          .filter((t) => t.verb !== d.verb)
          .map((t) => ({
            label: capitalise(t.verb),
            value: goalDraftId({
              ...d,
              verb: t.verb,
              target: "-",
              count: (AMOUNTS[t.verb] ?? [1])[0]!,
            }),
          })),
      },
    },
    {
      select: {
        customId: encodeId("g-target", id, v),
        placeholder:
          d.target === "-"
            ? "Pick what it asks for"
            : (targets.find((t) => t.value === d.target)?.label ?? d.target),
        options: targets
          .filter((t) => t.value !== d.target)
          .slice(0, 25)
          .map((t) => ({ label: t.label.slice(0, 90), value: set("target", t.value) })),
      },
    },
    {
      select: {
        customId: encodeId("g-amount", id, v),
        placeholder: `Amount: ${amountWord(d)}`,
        options: (AMOUNTS[d.verb] ?? [1])
          .filter((n) => n !== d.count)
          .map((n) => ({ label: amountWord({ ...d, count: n }), value: set("count", n) })),
      },
    },
    {
      select: {
        customId: encodeId("g-reward", id, v),
        placeholder: `Reward: ${d.reward ? amount(d.reward, "coin") : "none (a vow)"}`,
        options: REWARDS.filter((n) => n !== d.reward).map((n) => ({
          label: n ? amount(n, "coin") : "None: a vow",
          value: set("reward", n),
        })),
      },
    },
    {
      buttons: [
        btn(`Mode: ${MODES[d.mode]}`, "g-form", set("mode", cycle(MODES, d.mode)), v),
        btn(`Lasts: ${LIVES[d.life]}`, "g-form", set("life", cycle(LIVES, d.life)), v),
        btn(`Then: ${TURNS[d.turn]}`, "g-form", set("turn", cycle(TURNS, d.turn)), v),
        btn(
          `By: ${ISSUERS[d.issuer]}`,
          "g-form",
          set("issuer", nextIssuer(d.issuer, g.officer)),
          v,
        ),
        btn("Name it and post", "g-name", id, v, { style: "success", disabled: d.target === "-" }),
      ],
    },
  ];
  const rows = all.filter((r) => !("select" in r) || r.select.options.length > 0);
  if (rows.length < 5) rows.push({ buttons: [btn("Board", "goals", "", v, { emoji: "↩" })] });
  const fee = d.reward ? Math.max(g.feeLeast, Math.ceil((escrowOf(d) * g.fee) / 100)) : 0;
  return {
    context: PRIVATE,
    author: authorLine("Notice board", g.name, "Post a goal"),
    title: `${capitalise(d.verb)} ${amountWord(d)}${d.target === "-" ? "" : `: ${targets.find((t) => t.value === d.target)?.label ?? d.target}`}`,
    picture: "form",
    description:
      "Pick the verb, what it asks for, the amount and the reward; the buttons cycle how it runs. The title and a note come last.",
    fields: [
      { name: "Escrow", value: amount(escrowOf(d), "coin"), inline: true },
      { name: "Listing fee", value: amount(fee, "coin"), inline: true },
      { name: "You hold", value: amount(g.coin, "coin"), inline: true },
    ],
    footer:
      d.issuer === "s"
        ? `A settlement goal waits for ${amount(g.pledgeNeed, "coin")} pledged before it goes live.`
        : `An Each goal pays up to ${amount(EACH_CAP, "people")}; Season goals turn over when the season closes.`,
    rows,
  };
}

function escrowOf(d: GoalDraft): number {
  if (d.issuer === "s") return 0;
  return d.mode === "e" ? d.reward * EACH_CAP : d.reward;
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
    default:
      return amount(d.count, "goods");
  }
}

function cycle<K extends string>(map: Record<K, string>, k: K): K {
  const keys = Object.keys(map) as K[];
  return keys[(keys.indexOf(k) + 1) % keys.length]!;
}

function nextIssuer(i: Issuer, officer: boolean): Issuer {
  const order: Issuer[] = officer ? ["c", "s", "a"] : ["c", "s"];
  return order[(order.indexOf(i) + 1) % order.length]!;
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
