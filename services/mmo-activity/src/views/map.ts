import {
  DEFAULT_LAYERS,
  hexKey,
  isLayer,
  LAYERS,
  LIVE_LAYERS,
  type Axial,
  type LayerId,
} from "../../../../packages/mmo-map/src/index.ts";
import { mapAlt } from "../../../../packages/mmo-words/src/alt.ts";
import {
  busyWords,
  FOG_WORDS,
  MAP_LAYER_NAMES,
  seenAgo,
  type Fog,
} from "../../../../packages/mmo-words/src/map.ts";
import { capital, idWords, list } from "../../../../packages/mmo-words/src/units.ts";
import type { MapTileView } from "../api.ts";
import { button, el, lines } from "../dom.ts";
import { MapCanvas } from "../map/canvas.ts";
import type { MapSource } from "../map/source.ts";
import { amount, level, plural } from "../units.ts";
import { name } from "../words.ts";

// Which layers a viewer turned off, kept for their next visit only.
const LAYERS_KEY = "mmo-activity.map-layers-off";

/** Where the layer toggles are kept; a test hands in its own. */
export type LayerStore = Pick<Storage, "getItem" | "setItem">;

export function readLayers(store: LayerStore | undefined): Set<LayerId> {
  const on = new Set<LayerId>(DEFAULT_LAYERS);
  try {
    const off: unknown = JSON.parse(store?.getItem(LAYERS_KEY) ?? "[]");
    if (Array.isArray(off)) for (const id of off) if (isLayer(String(id))) on.delete(id);
  } catch {
    // Unreadable storage leaves every layer on.
  }
  return on;
}

export function writeLayers(store: LayerStore | undefined, on: ReadonlySet<LayerId>): void {
  try {
    store?.setItem(LAYERS_KEY, JSON.stringify(LAYERS.filter((l) => !on.has(l))));
  } catch {
    // A private window keeps the toggles for this visit only.
  }
}

function browserStore(): LayerStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const PLACE_WORDS: Record<string, string> = {
  settlement: "A settlement",
  city: "A city",
  "city-tile": "Part of a city",
  ruin: "A ruin",
  faction: "A faction's city",
};

/** What the tile panel says about a picked tile, as the viewer may see it. */
export interface TileWords {
  title: string;
  lines: string[];
}

/**
 * A tile in words: its ground, its region, its place and road, its fog
 * state, how long ago it was last seen, and its live layers when the
 * viewer has them. Blank ground is a tile nobody has found.
 */
export function tileWords(
  t: MapTileView | undefined,
  at: { tick: number; names: Record<string, string>; self?: Axial },
): TileWords {
  if (!t) return { title: "Unknown ground", lines: [`${capital(FOG_WORDS.unknown)}.`] };
  const c = t.cell;
  const terrain = name("map.terrain", c.terrain);
  const placeName = c.placeRef ? at.names[c.placeRef] : undefined;
  const out: string[] = [];
  if (placeName) out.push(terrain);
  if (c.region && at.names[c.region]) out.push(`In ${at.names[c.region]}`);
  if (c.place) {
    const guild = c.guild ? at.names[c.guild] : undefined;
    out.push(
      `${PLACE_WORDS[c.place] ?? capital(idWords(c.place))}${guild ? `, run by ${guild}` : ""}`,
    );
  }
  if (c.water) out.push(`Water: ${idWords(c.water)}`);
  if (c.road) out.push(`${c.roadName ? `${c.roadName}, a road` : "A road"} at ${level(c.road)}`);
  if (c.site) out.push(`Site: ${idWords(c.siteKind || c.site)}`);
  if (c.landmark) out.push(`Landmark: ${idWords(c.landmark)}`);
  if (c.structures?.length) out.push(`Built here: ${list(c.structures.map(idWords))}`);
  if (at.self && hexKey(at.self) === hexKey(c)) out.push("You are here.");
  const fog = t.fog as Fog;
  out.push(`${capital(FOG_WORDS[fog] ?? FOG_WORDS.discovered)}.`);
  const live = t.live;
  if (live && (fog === "sight" || fog === "seen")) {
    if (fog === "seen")
      out.push(`${capital(seenAgo(at.tick, live.left ?? at.tick))}. As it was then:`);
    if (live.threat) out.push(`${amount(live.threat, "threat")} in its region`);
    if (live.danger) out.push("Ambushes on its roads lately");
    if (live.corruption) out.push(`${amount(live.corruption, "corruption")} in its region`);
    if (live.corrupted) out.push("Corrupted nodes nearby");
    if (live.weather) out.push(`Weather: ${idWords(live.weather)}`);
    if (live.trouble) out.push(`Trouble: ${idWords(live.trouble)}`);
    if (live.fire) out.push("A fire is burning");
    if (live.cut) out.push("The road is cut");
    if (live.toll) out.push(`Tolled: ${plural(live.toll, "coin")} a crossing`);
    if (live.camp) out.push(`Camp: ${live.camp}`);
    if (live.haunted) out.push("Haunted");
    out.push(`How busy: ${busyWords(live.busy ?? "")}`);
  }
  return { title: placeName || terrain, lines: out };
}

export interface MapScreenDeps {
  source: MapSource;
  after?(ms: number, f: () => void): () => void;
  context?(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null;
  store?: LayerStore;
}

const realAfter = (ms: number, f: () => void) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

/**
 * The Map screen (GDD 4.11): the live map on a canvas, the layer toggles,
 * the counts in view and the picked tile. The world sends only what this
 * character and their guild may see; the screen draws it.
 */
export class MapScreen {
  readonly root = el("div", { class: "map" });
  readonly map: MapCanvas;
  private readonly status = el("p", { class: "muted", attrs: { role: "status" } });
  private readonly live = el("p", { class: "muted" });
  private readonly toggles = el("div", { class: "map-layers" });
  private readonly tile = el("section", { class: "panel map-tile" });
  private readonly back = button("Back to you", () => this.map.home());
  private readonly store: LayerStore | undefined;
  private readonly buttons = new Map<LayerId, HTMLButtonElement>();
  private on: Set<LayerId>;

  constructor(deps: MapScreenDeps) {
    this.store = deps.store ?? browserStore();
    this.on = readLayers(this.store);
    this.map = new MapCanvas({
      source: deps.source,
      after: deps.after ?? realAfter,
      context: deps.context,
      layers: this.on,
      changed: () => this.update(),
    });
    for (const id of LAYERS) {
      const b = button(MAP_LAYER_NAMES[id] ?? capital(id), () => this.toggle(id));
      this.buttons.set(id, b);
      this.toggles.append(b);
    }
    this.toggles.setAttribute("role", "group");
    this.toggles.setAttribute("aria-label", "Layers");
    Object.assign(this.toggles.style, { display: "flex", flexWrap: "wrap", gap: "6px" });
    Object.assign(this.root.style, { display: "flex", flexDirection: "column", gap: "8px" });
    this.tile.hidden = true;
    this.root.append(this.map.canvas, this.status, this.back, this.toggles, this.live, this.tile);
    this.update();
  }

  /** The screen is on the page: load what is missing, and poll while it stays. */
  wake(): Promise<void> {
    return this.map.wake();
  }

  private toggle(id: LayerId): void {
    if (this.on.has(id)) this.on.delete(id);
    else this.on.add(id);
    writeLayers(this.store, this.on);
    this.map.setLayers(new Set(this.on));
    this.update();
  }

  /** Whether the overlay is this character's: else there is nothing live to show. */
  private hasLive(): boolean {
    return this.map.overlay?.viewer === "character" && this.map.liveProblem !== "signed-out";
  }

  private update(): void {
    const m = this.map;
    const live = this.hasLive();
    for (const [id, b] of this.buttons) {
      const isLive = LIVE_LAYERS.includes(id);
      b.setAttribute("aria-pressed", String(this.on.has(id)));
      b.disabled = isLive && !live;
    }
    this.live.textContent = live
      ? ""
      : "Live layers show what your character and guild can see; they are off until the world knows who you are.";
    this.live.hidden = live;
    this.back.hidden = !m.overlay?.self;
    const counts = m.inView();
    if (m.problem === "busy") this.status.textContent = "The map is busy. It asks again shortly.";
    else if (m.problem === "down" && !m.index)
      this.status.textContent = "The world's map is not answering yet.";
    else if (!m.index) this.status.textContent = "Reading the map.";
    else
      this.status.textContent = [
        `${plural(counts.sight, "tile")} in sight`,
        `${plural(counts.seen, "tile")} last seen`,
        `${plural(counts.never, "tile")} not seen by you`,
        m.liveProblem === "busy" ? "live layers busy, asked again shortly" : "",
        m.problem === "down" ? "the world is not answering, so this is what it last sent" : "",
      ]
        .filter(Boolean)
        .join(" · ");
    m.canvas.setAttribute("aria-label", this.alt(counts.seen));
    this.drawTile();
  }

  private alt(seen: number): string {
    const m = this.map;
    if (!m.index) return mapAlt({ of: "the wasteland, not drawn yet" });
    const parts = LAYERS.filter((l) => this.on.has(l) && !LIVE_LAYERS.includes(l)).map((l) =>
      (MAP_LAYER_NAMES[l] ?? l).toLowerCase(),
    );
    const live = this.hasLive();
    const shaded = live
      ? LIVE_LAYERS.filter((l) => l !== "self" && this.on.has(l)).map((l) =>
          (MAP_LAYER_NAMES[l] ?? l).toLowerCase(),
        )
      : [];
    if (live) shaded.unshift("what you have in sight, rimmed");
    const self = m.overlay?.self;
    return mapAlt({
      of: "the wasteland as it has been found",
      parts,
      you: self && live && this.on.has("self") ? "the ringed tile" : undefined,
      shaded,
      seen: live ? seen : 0,
    });
  }

  private drawTile(): void {
    const m = this.map;
    if (!m.picked || !m.index) {
      this.tile.hidden = true;
      return;
    }
    const w = tileWords(m.pickedTile(), {
      tick: m.overlay?.tick ?? m.index.tick,
      names: m.names(),
      self: this.hasLive() ? m.overlay?.self : undefined,
    });
    this.tile.hidden = false;
    this.tile.replaceChildren(el("h2", { text: w.title }), ...lines(...w.lines));
  }
}
