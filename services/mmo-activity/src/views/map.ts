import {
  browserStore,
  LAYERS,
  LIVE_LAYERS,
  type LayerId,
  readLayers,
  writeLayers,
} from "../../../../packages/mmo-map/src/index.ts";
import { mapAlt, mapLayersAlt } from "../../../../packages/mmo-words/src/alt.ts";
import {
  MAP_LAYER_NAMES,
  tileWords as shared,
  type TileContext,
} from "../../../../packages/mmo-words/src/map.ts";
import { type MapTileView, ViewerCharacter } from "../api.ts";
import { button, el, lines } from "../dom.ts";
import { MapCanvas } from "../map/canvas.ts";
import type { MapSource } from "../map/source.ts";
import { plural } from "../units.ts";
import { name } from "../words.ts";

// Which layers a viewer turned off, kept in this browser only.
export const LAYERS_KEY = "mmo-activity.map-layers-off";

/** Where the layer toggles are kept; a test hands in its own. */
export type LayerStore = Pick<Storage, "getItem" | "setItem">;

/** What the tile panel says about a picked tile, as the viewer may see it. */
export interface TileWords {
  title: string;
  lines: string[];
}

/** A tile in words, in the panel's order: its base, its fog state, its age, then what is live. */
export function tileWords(t: MapTileView | undefined, at: TileContext): TileWords {
  const w = shared(t, at, (id) => name("map.terrain", id));
  return {
    title: w.title,
    lines: [...w.base, w.fogLine, ...(w.age ? [`${w.age} As it was then:`] : []), ...w.live],
  };
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
    this.on = readLayers(this.store, LAYERS_KEY);
    this.map = new MapCanvas({
      source: deps.source,
      after: deps.after ?? realAfter,
      context: deps.context,
      layers: this.on,
      changed: () => this.update(),
    });
    for (const id of LAYERS) {
      const b = button(MAP_LAYER_NAMES[id], () => this.toggle(id));
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
    writeLayers(this.store, LAYERS_KEY, this.on);
    this.map.setLayers(new Set(this.on));
    this.update();
  }

  /** Whether the overlay is this character's: else there is nothing live to show. */
  private hasLive(): boolean {
    return this.map.overlay?.viewer === ViewerCharacter && this.map.liveProblem !== "signed-out";
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
    else if (m.problem === "signed-out" && !m.index)
      this.status.textContent = "The map waits for you to be signed in.";
    else if (!m.index) this.status.textContent = "Reading the map.";
    else
      this.status.textContent = [
        `${plural(counts.sight, "tile")} in sight`,
        `${plural(counts.seen, "tile")} last seen`,
        `${plural(counts.never, "tile")} not seen by you`,
        m.liveProblem === "busy" ? "live layers busy, asked again shortly" : "",
        m.problem === "down" ? "the world is not answering, so this is what it last sent" : "",
        m.problem === "signed-out" ? "signed out, so this is what the map last sent" : "",
      ]
        .filter(Boolean)
        .join(" · ");
    m.canvas.setAttribute("aria-label", this.alt(counts.seen));
    this.drawTile();
  }

  private alt(seen: number): string {
    const m = this.map;
    if (!m.index) return mapAlt({ of: "the wasteland, not drawn yet" });
    return mapLayersAlt({
      of: "the wasteland as it has been found",
      layers: LAYERS,
      liveLayers: LIVE_LAYERS,
      on: this.on,
      live: this.hasLive(),
      self: Boolean(m.overlay?.self),
      seen,
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
