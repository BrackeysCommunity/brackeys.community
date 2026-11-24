import wasteland from "../pools/wasteland.encounters.json";

/**
 * A setting pack's encounter text: lines keyed by beat kind, or by
 * "kind:archetype" for a creature of its own, each with `{creature}` and
 * `{place}` slots and no numbers (GDD 15.2). The line is picked by a hash
 * of the fight, never by a sim draw, so it is display only.
 */
export interface EncounterPool {
  pack: string;
  version: number;
  lines: Record<string, string[]>;
}

/** The committed wasteland pool, regenerated offline by the bot's encounter-pool script. */
export const WASTELAND_ENCOUNTERS: EncounterPool = wasteland;

/** The slots a pool line may hold; nothing else in braces is allowed. */
export const ENCOUNTER_SLOTS = ["creature", "place"] as const;
export type EncounterSlot = (typeof ENCOUNTER_SLOTS)[number];

/** One line per beat kind, shown when a pool has nothing for the beat. */
export const AUTHORED: Record<string, string> = {
  clash: "The {creature} closes in to fight.",
  standoff: "The {creature} holds its ground and watches.",
  chase: "The {creature} breaks away and runs.",
  hazard: "The ground turns dangerous around the {creature}.",
  lock: "A lock stands between here and what lies beyond.",
  parley: "The {creature} waits, as if it might bargain.",
  harvest: "The {creature} guards salvage worth taking.",
  guardian: "The {creature} stands guard and lets nobody pass.",
  puzzle: "A machine stands in the way, waiting to be worked.",
};

export interface EncounterFight {
  id: string;
  beat: number;
  /** The beat kind, a fights.beats row. */
  kind: string;
  /** The archetype id. */
  creature: string;
}

export interface EncounterNames {
  /** The creature as the card names it, a variant's own name when it has one. */
  creature: string;
  place: string;
}

/** FNV-1a over the UTF-8 bytes, 32 bits. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The lines a pool holds for a fight: its archetype's own, else its kind's. */
export function encounterLines(
  pool: EncounterPool | null,
  kind: string,
  creature: string,
): string[] {
  const own = pool?.lines[`${kind}:${creature}`];
  if (own?.length) return own;
  return pool?.lines[kind] ?? [];
}

const SLOT = new RegExp(`(\\b[Tt]he )?\\{(${ENCOUNTER_SLOTS.join("|")})\\}`, "g");
const THE = /^the /i;

/** Fills the slots. A name's own "The" gives way to the line's article, or is lowered where the slot does not open a sentence. */
export function fillSlots(line: string, names: EncounterNames): string {
  return line.replace(SLOT, (_m, article: string | undefined, slot: string, at: number) => {
    const value = slot === "creature" ? names.creature : names.place;
    const opens = at === 0 || /[.!?;:]\s+$/.test(line.slice(0, at));
    if (!THE.test(value)) return `${article ?? ""}${value}`;
    const rest = value.replace(THE, "");
    if (article) return `${article}${rest}`;
    return `${opens ? "The" : "the"} ${rest}`;
  });
}

/**
 * The encounter line for a fight beat, stable for the fight and the beat: a
 * hash picks among the pool lines that fit (the creature's own, else the kind's),
 * else the authored line; "" when none fits. A line whose slot has no name does not fit.
 */
export function encounterLine(
  pool: EncounterPool | null,
  f: EncounterFight,
  names: EncounterNames,
): string {
  const named: Record<EncounterSlot, string> = { creature: names.creature, place: names.place };
  const fits = (l: string) =>
    ENCOUNTER_SLOTS.every((s) => named[s] !== "" || !l.includes(`{${s}}`));
  const lines = encounterLines(pool, f.kind, f.creature).filter(fits);
  const authored = AUTHORED[f.kind];
  const line = lines.length
    ? lines[fnv1a32(`${pool?.version ?? 0}|${f.id}|${f.beat}`) % lines.length]
    : authored !== undefined && fits(authored)
      ? authored
      : undefined;
  return line === undefined ? "" : fillSlots(line, names);
}
