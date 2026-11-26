import { idWords, num, TICKS_PER_DAY } from "./units.ts";

/**
 * The live map's words (GDD 4.11): a tile's fog state, how long ago it was
 * last seen, how busy it is, and the layers' names, the same in the site,
 * the Activity and the bot.
 */

/** A tile's fog state to one viewer, as the world names it. */
export type Fog = "unknown" | "sight" | "seen" | "discovered";

export const FOG_WORDS: Record<Fog, string> = {
  unknown: "nobody has been here",
  sight: "in sight",
  seen: "last seen",
  discovered: "found, not seen by you",
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
  light: "a few through lately",
  busy: "busy",
  crowded: "crowded",
};

/** A tile's busy band in words; "" is quiet. */
export function busyWords(band: string): string {
  return BUSY[band] ?? idWords(band);
}

/** What each map layer is called where a viewer toggles it. */
export const MAP_LAYER_NAMES: Record<string, string> = {
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
};
