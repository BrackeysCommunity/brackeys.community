import {
  BusyBusy,
  BusyCrowded,
  BusyLight,
  FogDiscovered,
  FogSeen,
  FogSight,
  FogUnknown,
  type MapTileView,
  PlaceCity,
  PlaceCityTile,
  PlaceFaction,
  PlaceRuin,
  PlaceSettlement,
} from "../../mmo-api/src/index.ts";
import { amount, capital, idWords, list, num, plural, readable, TICKS_PER_DAY } from "./units.ts";

/**
 * The live map's words (GDD 4.11): a tile's fog state, how long ago it was
 * last seen, how busy it is, and the layers' names, the same in the site,
 * the Activity and the bot.
 */

/** A tile's fog state to one viewer, as the world names it. */
export type Fog = typeof FogUnknown | typeof FogSight | typeof FogSeen | typeof FogDiscovered;

export const FOG_WORDS: Record<Fog, string> = {
  [FogUnknown]: "nobody has been here",
  [FogSight]: "in sight",
  [FogSeen]: "last seen",
  [FogDiscovered]: "found, not seen by you",
};

/** How long ago a tile left sight, in whole world days: left is the tick it left, tick is now. */
export function seenAgo(tick: number, left: number): string {
  const days = Math.max(0, Math.floor((tick - left) / TICKS_PER_DAY));
  if (days === 0) return "seen less than a world day ago";
  if (days === 1) return "seen 1 world day ago";
  return `seen ${num(days)} world days ago`;
}

const BUSY: Record<string, string> = {
  "": "quiet",
  [BusyLight]: "a few through lately",
  [BusyBusy]: "busy",
  [BusyCrowded]: "crowded",
};

/** A tile's busy band in words; "" is quiet. */
export function busyWords(band: string): string {
  return BUSY[band] ?? idWords(band);
}

/** What each map layer is called where a viewer toggles it. */
export const MAP_LAYER_NAMES = {
  terrain: "Terrain",
  regions: "Regions",
  roads: "Roads",
  places: "Settlements and cities",
  threat: "Threat",
  corruption: "Corruption",
  weather: "Weather",
  troubles: "Troubles",
  busy: "How busy",
  self: "You",
} as const satisfies Record<string, string>;

export const PLACE_WORDS: Record<string, string> = {
  [PlaceSettlement]: "A settlement",
  [PlaceCity]: "A city",
  [PlaceCityTile]: "Part of a city",
  [PlaceRuin]: "A ruin",
  [PlaceFaction]: "A faction's city",
};

export interface TileContext {
  /** The overlay's tick, else the index's: ages count from it. */
  tick: number;
  names: Record<string, string>;
  /** The viewer's own tile, when they have a character. */
  self?: { q: number; r: number };
}

export interface TileWords {
  title: string;
  fog: Fog;
  /** The fog state in words. */
  fogLine: string;
  /** A last-seen tile's age. */
  age?: string;
  /** The base: ground, region, place, road, site. */
  base: string[];
  /** The live layers as in sight now, or as last seen. */
  live: string[];
}

/**
 * A tile in words, as the viewer may see it: blank ground is a tile nobody
 * has found; a discovered tile out of sight has its base and nothing live.
 * terrain names a ground id; the Activity passes its pack's names.
 */
export function tileWords(
  t: MapTileView | undefined,
  at: TileContext,
  terrain: (id: string) => string = readable,
): TileWords {
  if (!t) {
    return {
      title: "Unknown ground",
      fog: FogUnknown,
      fogLine: `${capital(FOG_WORDS[FogUnknown])}.`,
      base: [],
      live: [],
    };
  }
  const c = t.cell;
  const ground = terrain(c.terrain);
  const placeName = c.placeRef ? at.names[c.placeRef] : undefined;
  const base: string[] = [];
  if (placeName) base.push(ground);
  if (c.secondary && (c.blend ?? 0) > 0) base.push(`Edging into ${idWords(c.secondary)}`);
  if (c.region && at.names[c.region]) base.push(`In ${at.names[c.region]}`);
  if (c.place) {
    const guild = c.guild ? at.names[c.guild] : undefined;
    base.push(`${PLACE_WORDS[c.place] ?? readable(c.place)}${guild ? `, run by ${guild}` : ""}`);
  }
  if (c.water) base.push(`Water: ${idWords(c.water)}`);
  if (c.road) {
    base.push(`${c.roadName ? `${c.roadName}, a road` : "A road"} at level ${num(c.road)}`);
  }
  if (c.site) base.push(`Site: ${idWords(c.siteKind || c.site)}`);
  if (c.landmark) base.push(`Landmark: ${idWords(c.landmark)}`);
  if (c.structures?.length) base.push(`Built here: ${list(c.structures.map(idWords))}`);
  if (at.self && at.self.q === c.q && at.self.r === c.r) base.push("You are here.");

  const fog: Fog = t.fog === FogSight || t.fog === FogSeen ? t.fog : FogDiscovered;
  const live: string[] = [];
  const l = t.live;
  if (l && fog !== FogDiscovered) {
    if (l.threat) live.push(`${amount(l.threat, "threat")} in its region`);
    if (l.danger) live.push("Ambushes on its roads lately");
    if (l.corruption) live.push(`${amount(l.corruption, "corruption")} in its region`);
    if (l.corrupted) live.push("Corrupted nodes nearby");
    if (l.weather) live.push(`Weather: ${idWords(l.weather)}`);
    if (l.trouble) live.push(`Trouble: ${idWords(l.trouble)}`);
    if (l.fire) live.push("A fire is burning");
    if (l.cut) live.push("The road is cut");
    if (l.toll) live.push(`Tolled: ${plural(l.toll, "coin")} a crossing`);
    // The world sends the camp's shown name.
    if (l.camp) live.push(`Camp: ${l.camp}`);
    if (l.haunted) live.push("Haunted");
    live.push(`How busy: ${busyWords(l.busy ?? "")}`);
  }
  return {
    title: placeName || ground,
    fog,
    fogLine: `${capital(FOG_WORDS[fog])}.`,
    age: fog === FogSeen && l ? `${capital(seenAgo(at.tick, l.left ?? at.tick))}.` : undefined,
    base,
    live,
  };
}
