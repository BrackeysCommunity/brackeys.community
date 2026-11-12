/**
 * The project files a tactics run reads besides its scenes, as `heldProject`
 * takes them: the JSON docs (`doc: true`, read with their sidecars) and the
 * art and the app icons, whose sidecars alone say what they are. The golden pin and the site's
 * hosted-games test build their project view from this one list.
 */
export const TACTICS_HELD_FILES = [
  { path: "game-settings.json", doc: true },
  { path: "input-map.json", doc: true },
  { path: "data/unit-classes.json", doc: true },
  { path: "art/icon-192.png", doc: false },
  { path: "art/icon-512.png", doc: false },
  { path: "art/tile-marsh.png", doc: false },
  { path: "art/tile-river.png", doc: false },
  { path: "art/tile-rubble.png", doc: false },
  { path: "art/tile-thicket.png", doc: false },
  { path: "art/tile-wall.png", doc: false },
  { path: "art/tiles.png", doc: false },
  { path: "art/units.png", doc: false },
  { path: "art/units.json", doc: false },
] as const satisfies readonly { path: string; doc: boolean }[];

/** A path in `TACTICS_HELD_FILES`, relative to the project's folder. */
export type TacticsHeldPath = (typeof TACTICS_HELD_FILES)[number]["path"];
