import {
  BUTTON_LABEL_MAX,
  clampEmbed,
  type EmbedField,
  type Message,
  OPTIONS_MAX,
  PER_ROW,
  type Row,
  ROWS_MAX,
  SELECT_LABEL_MAX,
  SELECT_VALUE_MAX,
} from "../../../packages/discord-kit/src/index.ts";
import { decodeId } from "./ids.ts";
import { BAND_LABELS } from "./units.ts";

/**
 * One card builder for every screen (GDD 17.4). A card names where it
 * appears and who sees it, says what it is in an author line under 60
 * characters, carries a picture unless it is a pure form, gives every
 * number its unit, puts a why button on any card that shows a modifier,
 * and shows a band on every option that can fail. `problems` lists what a
 * card breaks; the card test runs it over every screen.
 */

export interface Picture {
  /** A world media key; the adapter sends the picture as an attachment. */
  media: string;
  /** What the picture shows, in words: its facts are in the fields too. */
  alt: string;
}

export interface Table {
  /** Column headers, each carrying its unit. */
  header: string[];
  rows: string[][];
}

export interface Card {
  context: string;
  author: string;
  title: string;
  description?: string;
  picture: Picture | "form";
  /** A smaller picture beside the text, such as an item's sigil. */
  thumb?: Picture;
  fields?: EmbedField[];
  table?: Table;
  footer: string;
  rows: Row[];
  colour?: number;
  /** The card shows a modifier: it needs a why button. */
  modifiers?: boolean;
  /** Labels of options that can fail: each must show its band. */
  failable?: string[];
}

export const AUTHOR_MAX = 60;

/** An author line: parts joined with " · ", cut to fit AUTHOR_MAX. */
export function authorLine(...parts: string[]): string {
  return parts.join(" · ").slice(0, AUTHOR_MAX - 1);
}
export const COLOUR = {
  ash: 0xc9c4b8,
  rust: 0xa4482a,
  hazard: 0xe0b424,
  signal: 0x4fbf6a,
  corrupt: 0xb8358c,
} as const;

/** A rendered card: the message, and the pictures it attaches. */
export interface Rendered {
  message: Message;
  media: { key: string; name: string; alt: string }[];
}

export function render(card: Card): Rendered {
  const media: Rendered["media"] = [];
  const attach = (p: Picture) => {
    const name = `${p.media}.png`;
    media.push({ key: p.media, name, alt: p.alt });
    return `attachment://${name}`;
  };
  let description = card.description ?? "";
  if (card.table) description = [description, tableBlock(card.table)].filter(Boolean).join("\n");
  const embed = clampEmbed({
    author: { name: card.author },
    title: card.title,
    description: description || undefined,
    fields: card.fields,
    image: card.picture === "form" ? undefined : attach(card.picture),
    thumbnail: card.thumb ? attach(card.thumb) : undefined,
    footer: card.footer,
    color: card.colour ?? COLOUR.ash,
  });
  return { message: { content: `-# ${card.context}`, embeds: [embed], rows: card.rows }, media };
}

function tableBlock(t: Table): string {
  const all = [t.header, ...t.rows];
  const widths = t.header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  return ["```", line(t.header), ...t.rows.map(line), "```"].join("\n");
}

/** Words a number may be followed by: units, and the connectors of "70 to 64 of 90 durability". */
export const UNITS = new Set([
  "coin",
  "coins",
  "goods",
  "pts",
  "durability",
  "xp",
  "level",
  "tier",
  "load",
  "health",
  "defence",
  "threat",
  "scarcity",
  "unrest",
  "corruption",
  "prosperity",
  "standing",
  "tick",
  "ticks",
  "min",
  "minutes",
  "hour",
  "hours",
  "days",
  "day",
  "tiles",
  "tile",
  "provisions",
  "provision",
  "beats",
  "beat",
  "downs",
  "times",
  "encounters",
  "each",
  "fee",
  "weight",
  "floor",
  "more",
  "people",
  "kinds",
  "ambushes",
  "orders",
  "members",
  "officers",
  "votes",
  "goals",
  "goal",
  "claims",
  "claim",
  "done",
  "pledged",
  "creature",
  "creatures",
  "class",
  "classes",
  "member",
  "settlement",
  "settlements",
  "fact",
  "facts",
  "item",
  "items",
  "s",
  "use",
  "uses",
  "lesson",
  "lessons",
  "pouch",
  "pouches",
  "%",
]);
const CONNECTORS = new Set(["to", "of", "and", "or", "–", "-", "×", "+"]);
const UNIT_FIRST = new Set([
  "level",
  "tier",
  "floor",
  "fact",
  "case",
  "beat",
  "practice",
  "day",
  "tick",
]);

/**
 * The numbers in a text that stand without a unit. A number is fine when
 * the next word (past any connectors and further numbers) is a unit or a
 * name the setting gives a good, when the word before it puts the unit
 * first ("level 10"), when it is an identifier ("#41"), a timestamp, or
 * an odds band's "about 1 in 2".
 */
export function bareNumbers(text: string, names: Set<string>): string[] {
  const clean = text
    .replace(/<t:\d+:[a-zA-Z]>/g, " ")
    .replace(/about \d+ in \d+/g, " ")
    .replace(/#\d[\d,]*/g, " ")
    .replace(/[*_`()[\]|]/g, " ");
  const tokens = clean.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const isNum = (t: string) => /^[+−-]?\d[\d,]*(\.\d+)?%?[.,:;]?$/.test(t);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isNum(t)) continue;
    if (t.replace(/[.,:;]$/, "").endsWith("%")) continue;
    const before = tokens[i - 1]?.toLowerCase().replace(/[.,:;]$/, "");
    if (before && UNIT_FIRST.has(before)) continue;
    let j = i + 1;
    while (j < tokens.length && (CONNECTORS.has(tokens[j]!) || isNum(tokens[j]!))) j++;
    const word = (tokens[j] ?? "").toLowerCase().replace(/[.,:;!?]$/, "");
    const rest = tokens
      .slice(j, j + 3)
      .join(" ")
      .toLowerCase()
      .replace(/[.,:;!?]$/, "");
    if (UNITS.has(word) || [...names].some((n) => rest.startsWith(n))) continue;
    out.push(t);
  }
  return out;
}

/** What a card breaks of the standard. names are goods' and things' names, lower case. */
export function problems(card: Card, names: Set<string>): string[] {
  const out: string[] = [];
  if (!card.context.trim()) out.push("no context");
  if (!card.author.trim() || card.author.length >= AUTHOR_MAX)
    out.push(`author line "${card.author}" is empty or 60 characters or more`);
  if (!card.title.trim() || card.title.includes("\n")) out.push("the title is not one line");
  if (!card.footer.trim() || card.footer.includes("\n")) out.push("the footer is not one line");
  if (card.picture !== "form" && !card.picture.alt.trim()) out.push("a picture without alt text");
  const texts = [card.title, card.description ?? "", card.footer, card.author];
  for (const f of card.fields ?? []) texts.push(`${f.name}: ${f.value}`);
  if (card.table) {
    const hasUnit = (h: string) =>
      /\(.+\)/.test(h) ||
      h
        .toLowerCase()
        .split(/\s+/)
        .some((w) => UNITS.has(w));
    card.table.header.forEach((h, i) => {
      if (!hasUnit(h) && card.table!.rows.some((r) => /\d/.test(r[i] ?? "")))
        out.push(`table header "${h}" has no unit`);
    });
  }
  for (const t of texts)
    for (const n of bareNumbers(t, names)) out.push(`bare number ${n} in "${t.slice(0, 60)}"`);
  out.push(...rowProblems(card.rows, names));
  const buttons = card.rows.flatMap((r) => ("buttons" in r ? r.buttons : []));
  if (
    card.modifiers &&
    !buttons.some((b) => b.kind === "page" && decodeId(b.customId)?.action === "why")
  )
    out.push("shows a modifier but has no why button");
  for (const label of card.failable ?? []) {
    const b = buttons.find((x) => x.label.startsWith(label));
    if (!b || !BAND_LABELS.some((x) => b.label.includes(x)))
      out.push(`option "${label}" can fail but shows no band`);
  }
  return out;
}

/** The limits toMessage would otherwise enforce by dropping or cutting. */
function rowProblems(rows: Row[], names: Set<string>): string[] {
  const out: string[] = [];
  if (rows.length > ROWS_MAX) out.push(`${rows.length} rows; Discord shows ${ROWS_MAX}`);
  const ids = new Set<string>();
  const once = (id: string) => {
    if (ids.has(id)) out.push(`custom id ${id} is used twice`);
    ids.add(id);
  };
  for (const r of rows) {
    if ("buttons" in r) {
      if (r.buttons.length > PER_ROW) out.push(`more than ${PER_ROW} buttons in a row`);
      for (const b of r.buttons) {
        if (b.label.length > BUTTON_LABEL_MAX) out.push(`button "${b.label}" is too long`);
        if (b.kind === "page") once(b.customId);
        for (const n of bareNumbers(b.label, names))
          out.push(`bare number ${n} in button "${b.label}"`);
      }
      continue;
    }
    const s = r.select;
    once(s.customId);
    if (!s.options.length) out.push(`select ${s.customId} has no options`);
    if (s.options.length > OPTIONS_MAX) out.push(`select ${s.customId} has too many options`);
    const values = new Set<string>();
    for (const o of s.options) {
      if (o.value.length > SELECT_VALUE_MAX || values.has(o.value))
        out.push(`select value "${o.value}" is too long or repeated`);
      values.add(o.value);
      for (const t of [o.label, o.description ?? ""]) {
        if (t.length > SELECT_LABEL_MAX) out.push(`select text "${t}" is too long`);
        for (const n of bareNumbers(t, names)) out.push(`bare number ${n} in select "${t}"`);
      }
    }
  }
  return out;
}
