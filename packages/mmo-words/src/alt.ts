import type { Names } from "./story.ts";
import { amount, countWords, list, num, plural } from "./units.ts";

/**
 * Alt text for the game's pictures (GDD 16.1): what each one shows, in
 * words, from the same wire fields it was drawn from. Never written by a
 * model, and never longer than an attachment description may be.
 */

/** structural: Discord's limit on an attachment's description. */
export const ALT_MAX = 1024;

/** A text with its whitespace collapsed, cut on a word to ALT_MAX. */
export function clampAlt(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= ALT_MAX) return s;
  const cut = s.slice(0, ALT_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/** The place a banner shows, and the state it is drawn in. */
export interface BannerLike {
  name: string;
  city?: boolean;
  ruined?: boolean;
  overrun?: boolean;
  /** The open trouble's kind, as the world names it ("raid", "fire"). */
  trouble?: string;
  /** The open trouble's title, where it has one. */
  troubleTitle?: string;
  /** What the card adds about the scene, after the place. */
  extra?: string;
}

/** A settlement's banner: its skyline, a city's towers or a ruin, and fire on a raid or in the streets. */
export function bannerAlt(b: BannerLike): string {
  const what = b.ruined ? ", a ruin" : b.city ? ", a city" : "";
  const state: string[] = [];
  if (b.trouble === "raid") state.push("fire behind its wall under a raid");
  else if (b.trouble === "fire") state.push("flames in its streets");
  else if (b.trouble) state.push(`a pennant for ${b.troubleTitle || b.trouble.replace(/-/g, " ")}`);
  if (b.overrun) state.push("overrun");
  const tail = state.length ? `: ${list(state)}` : "";
  const extra = b.extra ? `; ${b.extra.replace(/^[;:,]\s*/, "")}` : "";
  return clampAlt(`Banner of ${b.name}${what}${tail}${extra}`);
}

/** The creature a portrait is drawn of, as the fight carries it. */
export interface PortraitLike {
  creature: string;
  creatureName?: string;
  variant?: string;
  /** The beat kind it is faced in. */
  kind?: string;
}

/** A creature's portrait: what it is, its region's variant, and the beat it is met in. */
export function portraitAlt(f: PortraitLike, names: Names): string {
  const archetype = names.name("creatures.archetypes", f.creature);
  const who = f.creatureName || archetype;
  const parts = [`Portrait of ${who}`];
  if (f.variant)
    parts.push(
      `${f.creatureName ? `a ${archetype.toLowerCase()}, ` : ""}${names.name("creatures.variants", f.variant).toLowerCase()}, adapted to how most win in its region`,
    );
  else if (f.creatureName && f.creatureName !== archetype)
    parts.push(`a ${archetype.toLowerCase()}`);
  if (f.kind) parts.push(`met in a ${names.name("fights.beats", f.kind).toLowerCase()}`);
  return clampAlt(parts.join(", "));
}

/** What each authored art slot draws (GDD 16.2). */
const ART: Record<string, string> = {
  day: "A wasteland day: a road under the sun past pylons and their wires, with one walker in the dust",
  fair: "A fair: tents and bunting on poles, crates stacked and a crowd between them",
  siege: "A siege: a host with banners and ladders against a walled gate",
  raid: "A raid: raiders at a palisade with fire and smoke rising behind it",
  fire: "A fire: houses burning with smoke overhead and a bucket line below",
  corruption: "Corruption: spires and glowing veins in the ground, motes in a sickly sky",
  shortage: "A shortage: a shut granary on cracked ground, bones about and people waiting",
  sickness: "Sickness: tents and cots under a miasma, one tender among them",
  panic: "Panic: an alarm bell ringing under searchlight beams, people fleeing",
  "stage-held": "A stage held: holders round a flag raised on a hill behind a wall at dawn",
  "stage-lost":
    "A stage lost: ruins and a broken palisade in smoke and embers, its flag left standing",
  finale: "A finale: a tower lit by bolts from the clouds, hosts with banners at its foot",
  "season-close":
    "A season's close: a camp by its fire and a wagon on the road, sun and stars together",
};

/** An art slot's picture; about is the line it heads, when the card has one. */
export function artAlt(slot: string, about?: string): string {
  const scene = ART[slot] ?? "A scene of the wasteland";
  return clampAlt(about ? `${scene}. ${about}` : scene);
}

/** A day on a chart, as a price point carries it. */
export interface ChartPoint {
  day: number;
  cause?: string;
}

/** A chart's mark: the letter drawn at the top of its line, its day and its cause. */
export interface ChartMark {
  label: string;
  day: number;
  cause: string;
}

/** The letter of the i-th mark: A to Z, then AA, AB and on, as the world letters a chart. */
export function markLabel(i: number): string {
  let out = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/** The days a chart marks, lettered in day order: every day with a cause. */
export function chartMarks(days: readonly ChartPoint[]): ChartMark[] {
  return days
    .filter((d) => d.cause)
    .map((d, i) => ({ label: markLabel(i), day: d.day, cause: d.cause! }));
}

/** A chart as the card knows it. */
export interface ChartLike {
  /** What the line shows, as "the closing price of Copper wire". */
  title: string;
  /** The value axis's unit, drawn at its top left. */
  unit: string;
  /** The days along its axis, when the card has them. */
  days?: readonly ChartPoint[];
  /** The band drawn behind the line, in the value's unit. */
  band?: readonly [number, number];
  /** The newest value the line ends on, and its day. */
  latest?: { day: number; value: number };
}

/** A chart: its line and unit, the days along its axis, its lettered marks and its band. */
export function chartAlt(c: ChartLike): string {
  const days = c.days ?? [];
  let out = `Chart of ${c.title}, in ${c.unit}, against days`;
  const first = days[0]?.day;
  const last = days.at(-1)?.day;
  if (first === undefined || last === undefined) out += c.days ? ", with no days yet" : "";
  else if (first === last) out += `, over day ${num(first)} alone`;
  else out += `, over ${plural(days.length, "day")} from day ${num(first)} to day ${num(last)}`;
  const marks = chartMarks(days);
  if (marks.length)
    out += `. Lettered marks: ${list(marks.map((m) => `${m.label} on day ${num(m.day)}`))}`;
  if (c.latest) out += `. It ends on day ${num(c.latest.day)} at ${amount(c.latest.value, c.unit)}`;
  if (c.band) out += `. A band from ${num(c.band[0])} to ${amount(c.band[1], c.unit)} is shaded`;
  return clampAlt(out);
}

/** A map as the picture draws it. */
export interface MapLike {
  /** What it is a map of: "the rooms of the Drowned Stair". */
  of: string;
  /** Tiles from its centre to its edge, for a map of the land. */
  radius?: number;
  /** What it marks, each in words, in reading order. */
  parts?: readonly string[];
  /** Where the viewer stands on it. */
  you?: string;
  /** It shades fog, weather and threat. */
  shaded?: readonly string[];
}

/** A map: what it is of, how far it reaches, what it shows and where the viewer is. */
export function mapAlt(m: MapLike): string {
  let out = `Map of ${m.of}`;
  if (m.radius) out += `, ${amount(m.radius, m.radius === 1 ? "tile" : "tiles")} round`;
  if (m.parts?.length) out += `: ${list([...m.parts])}`;
  if (m.you) out += `. You are at ${m.you}`;
  if (m.shaded?.length) out += `. ${capital(list([...m.shaded]))} shaded`;
  return clampAlt(out);
}

/** An item's sigil, from what the item states. */
export interface SigilLike {
  name: string;
  slot?: string;
  /** Its strongest axes, in words. */
  axes?: readonly string[];
  level?: number;
  picks?: number;
}

/** structural: a sigil draws a notch for each five levels, and one to start. */
const LEVELS_A_NOTCH = 5;

/** An item's sigil: its outline and slot, its strongest axes, a notch per five levels and a dot per pick. */
export function sigilAlt(s: SigilLike): string {
  const parts = [`Sigil of ${s.name}: its outline`];
  if (s.slot) parts.push(`its slot, ${s.slot}`);
  if (s.axes?.length) parts.push(`strongest in ${list([...s.axes])}`);
  if (s.level !== undefined)
    parts.push(
      `${countWords(1 + Math.floor(s.level / LEVELS_A_NOTCH), "notch", "notches")} for its level`,
    );
  if (s.picks) parts.push(`${countWords(s.picks, "dot")}, one a pick`);
  return clampAlt(
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!,
  );
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
