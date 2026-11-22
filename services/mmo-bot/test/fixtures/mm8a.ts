import type * as api from "../../src/api.ts";
import { atEntrance } from "./mm8.ts";
import samples from "./world.json";

/**
 * Content drawn from history as the world serves it on reached tiles: a
 * site's kind, and the label of a place admins or staff staged (GDD 14.5).
 */

const here = samples.here as api.Here;
const map = samples.map as api.MapView;

export const byAdmins: api.Placed = { by: "admins", label: "Rustwater Crew" };
export const byStaff: api.Placed = { by: "staff", label: "Rustwater Crew", points: 60 };

/** Out on a site slot, away from any settlement. */
function atSite(hex: api.Hex, site: string, siteKind: string, placed?: api.Placed): api.Here {
  return {
    ...here,
    name: "The Ashfield",
    place: {
      ...here.place,
      tile: { ...here.place.tile, hex, site, siteKind, placed, structures: undefined, found: 9 },
      explore: true,
      rest: false,
    },
    stations: [],
    orders: [],
    offers: [],
    people: [],
    bench: undefined,
    suggest: undefined,
  };
}

export const nativeSite = atSite({ q: -24, r: -2 }, "site", "scrap-seam");
export const adminSite = atSite({ q: -26, r: 2 }, "site", "battlefield-ruin", byAdmins);
export const staffSite = atSite({ q: -31, r: 4 }, "edge-site", "scavenger-camp", byStaff);

export const placedEntrance: api.Here = {
  ...atEntrance,
  place: { ...atEntrance.place, tile: { ...atEntrance.place.tile, placed: byStaff } },
  floor: { ...atEntrance.floor!, haunted: undefined, placed: byStaff },
};

/** The map with a drawn site and a placed one among the places seen. */
export const siteMap: api.MapView = {
  ...map,
  tiles: [...map.tiles, adminSite.place.tile, nativeSite.place.tile],
};
