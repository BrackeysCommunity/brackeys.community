import type { Names } from "./story.ts";
import { amount, list, num, plural, TICKS_PER_HOUR } from "./units.ts";

/**
 * What an NPC remembers, told without a model: the oldest entries it
 * keeps and the counts of what it folded away (GDD 4.18). It is the
 * fallback for a memory summary, and what a card shows when no summary
 * has been made.
 */

/** One remembered entry, as a dossier carries it. */
export interface MemoryLike {
  kind: string;
  tick: number;
  thing?: string;
  who?: string;
  n?: number;
  unit?: string;
}

/** The parts of an NPC's dossier the lines are made from. */
export interface DossierLike {
  oldest: readonly MemoryLike[];
  folded?: readonly { type: string; count: number }[];
  names: Readonly<Record<string, string>>;
}

/** structural: a world day is 24 hours. */
const TICKS_PER_DAY = TICKS_PER_HOUR * 24;

const YOU = "you";
const TRAVELLER = "a traveller";
const SOMEONE = "someone";

/** What an entry of each kind tells, given who it was about and the thing it names. */
const ENTRY: Record<string, (who: string, thing: string, more: string) => string> = {
  greeted: (who) => `${who} greeted them`,
  asked: (who) => `${who} asked them for news`,
  slighted: (who) => `${who} passed them by without a word`,
  wronged: (who) => `${who} wronged them`,
  helped: (who) => `${who} helped them`,
  traded: (who, thing) => (thing ? `${who} sold them ${thing}` : `${who} traded with them`),
  fought: (who, thing) =>
    thing ? `${who} beat the ${thing} beside them` : `${who} fought beside them`,
  resold: (who, thing, more) =>
    `they sold on ${thing || `what ${who} brought them`}${more ? `, ${more} over what they paid` : ""}`,
  "sold-on": (who, thing) => `${thing || `what ${who} sold them`} went on to other hands`,
  fortune: () => "they came into a fortune",
  "moved-away": (_who, thing) =>
    thing ? `a neighbour moved away: ${thing}` : "a neighbour moved away",
};

/** What a folded count of each kind is, as "greeted 12 times". */
const FOLDED: Record<string, string> = {
  greeted: "greeted",
  asked: "asked for news",
  slighted: "passed by",
  wronged: "wronged",
  helped: "helped",
  traded: "traded with",
  fought: "fought beside",
  resold: "sold on",
  "sold-on": "passed on",
  fortune: "came into a fortune",
  "moved-away": "saw a neighbour move away",
};

/** Sheets an older save's entry may hold an id from, where newer saves hold the name. */
const THING_SHEETS: Record<string, string> = {
  traded: "items.materials",
  fought: "creatures.archetypes",
};

const ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const words = (id: string) => id.replace(/[-_]/g, " ");
const readable = (id: string) => {
  const s = words(id);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Who an entry is about, as the viewer may read it. The world sends
 * "you", a traveller, a traveller from a guild the dossier names, or a
 * character id for a player who agreed to be named; an id is never shown.
 */
function whoOf(who: string | undefined, d: DossierLike): string {
  if (!who) return SOMEONE;
  if (who === YOU || who === TRAVELLER) return who;
  const from = `${TRAVELLER} from `;
  if (who.startsWith(from) && Object.values(d.names).includes(who.slice(from.length))) return who;
  return TRAVELLER;
}

function thingOf(m: MemoryLike, names: Names): string {
  const thing = m.thing ?? "";
  const sheet = THING_SHEETS[m.kind];
  if (!sheet || !ID_SHAPE.test(thing)) return thing;
  const own = names.name(sheet, thing);
  return own && own !== readable(thing) ? own : thing;
}

function entryLine(m: MemoryLike, d: DossierLike, names: Names): string {
  const who = whoOf(m.who, d);
  const thing = thingOf(m, names);
  const more = m.n && m.unit ? amount(m.n, m.unit) : "";
  const tell = ENTRY[m.kind];
  if (tell) return tell(who, thing, more);
  const what = [words(m.kind), thing].filter(Boolean).join(": ");
  return who === SOMEONE ? what : `${what} (${who})`;
}

/** The oldest entries, each by its world day, then the folded counts with their units. */
export function memoryLines(d: DossierLike, names: Names): string[] {
  const out = d.oldest.map(
    (m) => `Day ${num(Math.floor(m.tick / TICKS_PER_DAY))}: ${capitalise(entryLine(m, d, names))}.`,
  );
  const folded = (d.folded ?? []).filter((x) => x.count > 0);
  if (folded.length) {
    const parts = folded.map(
      (x) => `${FOLDED[x.type] ?? words(x.type)} ${plural(x.count, "time")}`,
    );
    out.push(`Older memories folded away: ${list(parts)}.`);
  }
  return out;
}
