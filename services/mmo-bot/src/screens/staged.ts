import {
  type Button,
  buttonRows,
  type EmbedField,
} from "../../../../packages/discord-kit/src/index.ts";
import { artAlt } from "../../../../packages/mmo-words/src/alt.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR, type Picture } from "../card.ts";
import { target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, outOf, plural, ticks } from "../units.ts";
import {
  back,
  btn,
  factNum,
  factStr,
  PRIVATE,
  ROW_MOST,
  stagedGoodsLine,
  stagedLine,
} from "./common.ts";
import { hexDistance } from "./hunt.ts";

/**
 * A server's staged events as the bot shows them (GDD 14.4, 17.2): a drop
 * of crates, a fair, and what a crate held. Everything a crate, contest or
 * fair pays is staged goods, which stay where they were staged (GDD 10.8);
 * whoever staged it takes nothing from it.
 */

/** Where the events channel's cards appear and who sees them. */
export const EVENTS_CHANNEL = "Events channel · everyone in the server can see this";

/** What each kind of staging is called on its card; `.over` is a drop's or fair's own card once closed. */
export const STAGED_TITLES: Record<string, (where: string) => string> = {
  contest: (w) => `A contest at ${w}`,
  hardship: (w) => `A staged hardship at ${w}`,
  hunt: (w) => `A staged hunt near ${w}`,
  vault: (w) => `A competing vault near ${w}`,
  pattern: (w) => `A staged pattern near ${w}`,
  drop: (w) => `A drop of crates near ${w}`,
  "drop.over": (w) => `The drop near ${w} is over`,
  fair: (w) => `A fair at ${w}`,
  "fair.over": (w) => `The fair at ${w} is over`,
};

/** A staging's title by its kind, with a plain fallback for a kind STAGED_TITLES does not name. */
export function stagedTitle(kind: string, where: string): string {
  return (STAGED_TITLES[kind] ?? ((w: string) => `Staged at ${w}`))(where);
}

/** A staging as a card reads it: the house's stage view, or a staged.opened event's fields where the tile is not known. */
export type StagedView = Omit<api.StageView, "at"> & { at?: api.Hex; days?: number };

/** Who staged a thing as the wire's Placed carries it, from a fact's role. */
export function placedOf(role: string, label: string, points: number): api.Placed {
  return role === "staff"
    ? { by: "staff", label, ...(points ? { points } : {}) }
    : { by: "admins", label };
}

/** The stage a fact names, by its stage subject or its stage datum. */
export function stageIdOf(f: api.Fact): string {
  return f.subjects.find((s) => s.kind === "stage")?.id ?? factStr(f, "stage");
}

/**
 * A staging event as the stage it is about: the fact's own fields, with
 * the house's view of the stage over them where the poster read one.
 */
export function stagedOf(ev: api.StoryEvent, stage?: api.StageView): StagedView {
  const f = ev.fact;
  const fromFact: StagedView = {
    id: stageIdOf(f),
    template: factStr(f, "template"),
    kind: factStr(f, "kind"),
    placed: placedOf(factStr(f, "role"), factStr(f, "label"), factNum(f, "points")),
    settlement: factNum(f, "settlement"),
    place: ev.place ?? "",
    opens: f.tick,
    ends: 0,
    open: f.kind === "staged.opened",
    closed: f.kind === "staged.closed",
    crates: factNum(f, "crates"),
    days: factNum(f, "days"),
  };
  return stage ? { ...fromFact, ...stage, days: fromFact.days } : fromFact;
}

/** The goals of a fair or contest on the board, in the stage's order. */
export function contestsOf(board: api.Board, st: StagedView): api.Goal[] {
  const byId = new Map(board.posts.map((p) => [p.goal.id, p.goal]));
  return (st.goals ?? []).map((id) => byId.get(id)).filter((g): g is api.Goal => !!g);
}

/** The place a stage is at, or a settlement. */
const placeName = (st: StagedView) => st.place || "a settlement";

/** Its staged goods' tag: "staged · local to Ashford". */
const localTo = (st: StagedView) => stagedGoodsLine({ settlement: st.settlement, name: st.place });

/** Whether a stage still has crates to open. */
const openable = (st: StagedView) => !!st.open && !st.closed && (st.crates ?? 0) > 0;

/** Tiles from a character to a stage's tile, where it is known. */
function awayOf(o: api.Options, st: StagedView): number | undefined {
  return st.at ? hexDistance(o.at, st.at) : undefined;
}

/** Whether a character stands on a stage's tile. */
function onTile(o: api.Options, st: StagedView): boolean {
  return awayOf(o, st) === 0;
}

/** How long a stage has left, or how long it runs where the tick of its end is not known. */
function lastsField(st: StagedView, o?: api.Options): EmbedField | undefined {
  if (st.closed) return { name: "Lasts", value: "over", inline: true };
  if (o && st.ends > 0)
    return { name: "Ends in", value: ticks(Math.max(0, st.ends - o.tick)), inline: true };
  return st.days ? { name: "Lasts", value: amount(st.days, "days"), inline: true } : undefined;
}

/** The crates field: how many are left, and for a viewer where they are. */
function cratesField(st: StagedView, o?: api.Options): EmbedField {
  const left = st.crates ?? 0;
  const away = o ? awayOf(o, st) : undefined;
  const where =
    away === undefined
      ? `on a tile near ${placeName(st)}`
      : away === 0
        ? "on this tile"
        : `${plural(away, "tile")} away`;
  return {
    name: "Crates",
    value: st.closed || !left ? "none left" : `${plural(left, "crate")} left, ${where}`,
    inline: true,
  };
}

/** Open a crate where the viewer can, else the way to the crates; on the public post, the press that tries. */
function crateButtons(
  st: StagedView,
  o?: api.Options,
  open = "Open a crate",
  goStyle?: Extract<Button, { kind: "page" }>["style"],
): Button[] {
  if (!openable(st)) return [];
  if (!o) return [btn(open, "crate", st.id, 0, { style: "success" })];
  if (onTile(o, st)) return [btn(open, "crate", st.id, o.version, { style: "success" })];
  if (!st.at) return [];
  return [
    btn(
      "Go there",
      "goto",
      target(",", st.at.q, st.at.r),
      o.version,
      goStyle ? { style: goStyle } : {},
    ),
  ];
}

/** An authored art slot's picture, headed by the card's title; a form when the world sent none. */
export function artPicture(art: api.Art | undefined, title: string): Picture | "form" {
  return art?.key ? { media: art.key, alt: artAlt(art.slot, title) } : "form";
}

const STAGED_FOOTER =
  "Who staged it takes nothing from it. Staged goods are used, crafted with and traded only where they were staged.";

/**
 * A drop (GDD 14.4): its crates on one tile and who staged it. Without a
 * viewer it is the events channel's post, whose Open a crate the world
 * refuses off the tile; with one it is that character's own card.
 */
export function dropCard(st: StagedView, o?: api.Options): Card {
  const fields = [cratesField(st, o), lastsField(st, o)].filter((f): f is EmbedField => !!f);
  const buttons = crateButtons(st, o);
  if (o) buttons.push(back(o.version));
  const title = stagedTitle(st.closed ? "drop.over" : "drop", placeName(st));
  return {
    context: o ? PRIVATE : EVENTS_CHANNEL,
    author: authorLine("Drop", placeName(st), st.closed ? "over" : "open"),
    title,
    description: `${stagedLine(st.placed)}.\nStand on its tile to open a crate: what it holds is ${localTo(st)}.`,
    picture: "form",
    fields,
    footer: STAGED_FOOTER,
    rows: buttons.length ? [{ buttons }] : [],
    colour: st.closed ? COLOUR.ash : COLOUR.hazard,
  };
}

/** A contest of a fair as one line: what it asks, and how many it pays out of how many it may. */
function contestLine(g: api.Goal): string {
  const winners = g.cap ? `, ${outOf(g.claims, g.cap, "claims")}` : "";
  return `• ${g.title}: ${g.what}${winners}`;
}

/**
 * A fair (GDD 14.4): one world day of contests that each pay their first
 * winners a prize of staged goods, a drop of crates, and the fair's own
 * banner. Contests are the board's goals the fair posted.
 */
export function fairCard(
  st: StagedView,
  contests: readonly api.Goal[],
  o?: api.Options,
  art?: api.Art,
): Card {
  const title = stagedTitle(st.closed ? "fair.over" : "fair", placeName(st));
  const fields: EmbedField[] = [
    {
      name: "Contests",
      value: contests.length
        ? contests.map(contestLine).join("\n")
        : `On the notice board at ${placeName(st)}.`,
    },
    {
      name: "Prizes",
      value: `Each winner of a contest is paid a prize of goods, ${localTo(st)}; never coin.`,
    },
    cratesField(st, o),
  ];
  const lasts = lastsField(st, o);
  if (lasts) fields.push(lasts);
  const buttons = crateButtons(st, o);
  if (o) buttons.push(btn("The contests", "goals", "", o.version), back(o.version));
  return {
    context: o ? PRIVATE : EVENTS_CHANNEL,
    author: authorLine("Fair", placeName(st), st.closed ? "over" : "open"),
    title,
    description: `${stagedLine(st.placed)}.\nWin a contest on the notice board, or open a crate of the drop on its tile.`,
    picture: artPicture(art, title),
    fields,
    footer: STAGED_FOOTER,
    rows: buttons.length ? buttonRows(buttons.slice(0, ROW_MOST)) : [],
    colour: st.closed ? COLOUR.ash : COLOUR.signal,
  };
}

/**
 * A crate opened, or why not (GDD 14.4): what came out of it and that it is
 * staged, the crates left, and the next press. facts are the write's reply,
 * notice the refusal's words; off the tile it shows the way there.
 */
export function crateOpen(
  o: api.Options,
  st: api.StageView | undefined,
  lex: Lexicon,
  facts: readonly api.Fact[] = [],
  notice?: string,
): Card {
  const v = o.version;
  if (!st)
    return {
      context: PRIVATE,
      author: authorLine("Drop", "over"),
      title: notice ?? "That drop is over",
      description: "Its crates are gone, or its stage has closed: nothing was opened.",
      picture: "form",
      footer: STAGED_FOOTER,
      rows: [{ buttons: [back(v)] }],
      colour: COLOUR.ash,
    };
  const opened = facts.find((f) => f.kind === "crate.opened");
  const away = hexDistance(o.at, st.at);
  const here = away === 0;
  const crates = opened ? { ...st, crates: factNum(opened, "left") } : st;
  const description = opened
    ? `It held ${amount(factNum(opened, "units"), lex.material(factStr(opened, "material")))}, ${localTo(st)}.`
    : here
      ? `The crates are on this tile. What each holds is ${localTo(st)}.`
      : `The crates are ${plural(away, "tile")} away, near ${placeName(st)}. Stand on their tile to open one.`;
  const buttons = crateButtons(crates, o, opened ? "Open another" : "Open a crate", "primary");
  buttons.push(back(v));
  const fields = [cratesField(crates, o), lastsField(crates, o)].filter(
    (f): f is EmbedField => !!f,
  );
  fields.push({ name: "Staged", value: `${stagedLine(st.placed)}.` });
  return {
    context: PRIVATE,
    author: authorLine("Drop", placeName(st), opened ? "a crate opened" : "its crates"),
    title: notice ?? (opened ? "You opened a crate" : `The crates near ${placeName(st)}`),
    description,
    picture: "form",
    fields,
    footer: STAGED_FOOTER,
    rows: [{ buttons }],
    colour: opened ? COLOUR.signal : COLOUR.hazard,
  };
}
