import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { Button } from "@/components/ui/button";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";

import type { MapTileView } from "../../../packages/mmo-api/src/index.ts";
import type { Axial } from "../../../packages/mmo-map/src/index.ts";
import { hexKey } from "../../../packages/mmo-map/src/index.ts";
import {
  amount,
  busyWords,
  capital,
  FOG_WORDS,
  type Fog,
  idWords,
  list,
  num,
  plural,
  readable,
  seenAgo,
} from "../../../packages/mmo-words/src/index.ts";

const PLACE_WORDS: Record<string, string> = {
  settlement: "A settlement",
  city: "A city",
  "city-tile": "Part of a city",
  ruin: "A ruin",
  faction: "A faction's city",
};

export interface TileContext {
  /** The overlay's tick, else the index's: ages count from it. */
  tick: number;
  names: Record<string, string>;
  /** The viewer's own tile, when they have a character. */
  self?: Axial;
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
 */
export function tileWords(t: MapTileView | undefined, at: TileContext): TileWords {
  if (!t) {
    return {
      title: "Unknown ground",
      fog: "unknown",
      fogLine: `${capital(FOG_WORDS.unknown)}.`,
      base: [],
      live: [],
    };
  }
  const c = t.cell;
  const terrain = readable(c.terrain);
  const placeName = c.placeRef ? at.names[c.placeRef] : undefined;
  const base: string[] = [];
  if (placeName) base.push(terrain);
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
  if (at.self && hexKey(at.self) === hexKey(c)) base.push("You are here.");

  const fog: Fog = t.fog === "sight" || t.fog === "seen" ? t.fog : "discovered";
  const live: string[] = [];
  const l = t.live;
  if (l && fog !== "discovered") {
    if (l.threat) live.push(`${amount(l.threat, "threat")} in its region`);
    if (l.danger) live.push("Ambushes on its roads lately");
    if (l.corruption) live.push(`${amount(l.corruption, "corruption")} in its region`);
    if (l.corrupted) live.push("Corrupted nodes nearby");
    if (l.weather) live.push(`Weather: ${idWords(l.weather)}`);
    if (l.trouble) live.push(`Trouble: ${idWords(l.trouble)}`);
    if (l.fire) live.push("A fire is burning");
    if (l.cut) live.push("The road is cut");
    if (l.toll) live.push(`Tolled: ${plural(l.toll, "coin")} a crossing`);
    if (l.camp) live.push(`Camp: ${idWords(l.camp)}`);
    if (l.haunted) live.push("Haunted");
    live.push(`How busy: ${busyWords(l.busy ?? "")}`);
  }
  return {
    title: placeName || terrain,
    fog,
    fogLine: `${capital(FOG_WORDS[fog])}.`,
    age: fog === "seen" && l ? `${capital(seenAgo(at.tick, l.left ?? at.tick))}.` : undefined,
    base,
    live,
  };
}

/** The picked tile: its base, its fog state in words, and what is live on it. */
export function TilePanel({
  tile,
  at,
  onClose,
  className,
}: {
  tile: MapTileView | undefined;
  at: TileContext;
  onClose: () => void;
  className?: string;
}) {
  const w = tileWords(tile, at);
  return (
    <Island
      aria-label="Picked tile"
      className={className ?? "w-full flex-col items-stretch gap-2 self-start p-3"}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <MicroLabel as="div">{w.fogLine}</MicroLabel>
          <Heading as="h2" size="md" ellipsis>
            {w.title}
          </Heading>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close the tile"
          tooltip="Close"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      {w.base.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {w.base.map((line) => (
            <Text as="p" size="sm" key={line}>
              {line}
            </Text>
          ))}
        </div>
      ) : null}
      {w.age ? (
        <Text as="p" size="sm" variant="muted">
          {w.age} As it was then:
        </Text>
      ) : null}
      {w.live.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <MicroLabel as="div">{w.fog === "seen" ? "Last seen" : "In sight now"}</MicroLabel>
          {w.live.map((line) => (
            <Text as="p" size="sm" key={line} className={w.fog === "seen" ? "italic" : undefined}>
              {line}
            </Text>
          ))}
        </div>
      ) : null}
    </Island>
  );
}
