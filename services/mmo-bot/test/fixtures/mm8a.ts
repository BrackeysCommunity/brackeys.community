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

/** A tile's base cell as the map's view carries it. */
export function cellOf(t: api.Tile): api.MapCell {
  return {
    q: t.hex.q,
    r: t.hex.r,
    terrain: t.terrain,
    water: t.water === "none" ? undefined : t.water,
    region: t.region,
    road: t.road || undefined,
    site: t.site,
    siteKind: t.siteKind,
    landmark: t.landmark,
    roadName: t.roadName,
    structures: t.structures,
    found: t.found,
  };
}

/** A view sorted as the world sends it: by r, then q. */
export function sortView(view: api.MapTileView[]): api.MapTileView[] {
  return view.toSorted((a, b) => a.cell.r - b.cell.r || a.cell.q - b.cell.q);
}

/** The map with a drawn site and a placed one among the places seen: the admins' in sight, the native one found by others. */
export const siteMap: api.MapView = {
  ...map,
  tiles: [...map.tiles, adminSite.place.tile, nativeSite.place.tile],
  view: sortView([
    ...map.view,
    {
      cell: cellOf(adminSite.place.tile),
      fog: "sight",
      live: { q: adminSite.place.tile.hex.q, r: adminSite.place.tile.hex.r, fog: "sight" },
    },
    { cell: cellOf(nativeSite.place.tile), fog: "discovered" },
  ]),
};
