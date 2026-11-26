import { ChunkCache, paint } from "../../../../packages/mmo-map/src/draw.ts";
import {
  buildFrame,
  centreOn,
  chunkKey,
  chunkRev,
  chunksInView,
  DEFAULT_LAYERS,
  fitRegions,
  type Axial,
  type Camera,
  type Frame,
  hexCentre,
  hexKey,
  type LayerId,
  type Level,
  levelFor,
  MAX_OVERLAY_CHUNKS,
  pan,
  resolveStyle,
  screenToHex,
  type Style,
  type View,
  viewBounds,
  worldToScreen,
  zoomAt,
} from "../../../../packages/mmo-map/src/index.ts";
import type {
  MapChunk,
  MapIndex,
  MapOverlay,
  MapOverlayQuery,
  MapRegions,
  MapTileView,
} from "../api.ts";
import { MapError, type MapSource } from "./source.ts";

// Polling as the site does it: the index every tick, never under 30 s; the
// overlay when the tick moves and once a pan or zoom has settled.
const POLL_MIN_MS = 30_000;
const SETTLE_MS = 300;
// structural: how a gesture moves the camera.
const TAP_SLOP_PX = 8;
const WHEEL_RATE = 0.0015;
const KEY_PAN = 0.125; // of the view
const KEY_ZOOM = 1.25;
// structural: a character's own tile opens this far past tile zoom.
const SELF_ZOOM = 1.25;
// structural: bitmaps kept, and the view size before layout has run.
const CACHE_BITMAPS = 96;
const FALLBACK_VIEW: View = { width: 360, height: 360 };

/** What the map host is told: what is loaded, and why it is not. */
export type MapProblem = "" | "down" | "busy" | "signed-out";

export interface CanvasDeps {
  source: MapSource;
  after(ms: number, f: () => void): () => void;
  /** Something the host shows changed: the status, the picked tile, a problem. */
  changed(): void;
  /** The canvas's 2D context; a test hands in its own. */
  context?(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null;
  layers?: ReadonlySet<LayerId>;
}

/** Fog counts over the discovered tiles in view. */
export interface InView {
  sight: number;
  seen: number;
  never: number;
}

function problemOf(err: unknown): MapProblem {
  if (err instanceof MapError) {
    if (err.status === 429) return "busy";
    if (err.status === 401) return "signed-out";
  }
  return "down";
}

/**
 * The live map on one canvas: it reads the index, the style, the regions,
 * the chunks in view and the viewer's overlay from its source, and paints
 * them with the shared map module. It draws what arrives and nothing else.
 */
export class MapCanvas {
  readonly canvas: HTMLCanvasElement;
  index: MapIndex | undefined;
  style: Style | undefined;
  regions: MapRegions | undefined;
  overlay: MapOverlay | undefined;
  readonly chunks = new Map<string, MapChunk>();
  camera: Camera | undefined;
  frame: Frame | undefined;
  problem: MapProblem = "";
  /** The overlay could not be had, so live layers are off. */
  liveProblem: MapProblem = "";
  picked: Axial | undefined;
  layers: ReadonlySet<LayerId>;

  private readonly cache = new ChunkCache(CACHE_BITMAPS);
  private readonly missing = new Set<string>();
  private readonly fetching = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private tap: { x: number; y: number; moved: boolean } | undefined;
  private stopPoll: (() => void) | undefined;
  private stopSettle: (() => void) | undefined;
  private painting = false;
  private asked = 0;
  private loading: Promise<void> | undefined;
  private polling = false;

  constructor(private readonly deps: CanvasDeps) {
    this.layers = deps.layers ?? DEFAULT_LAYERS;
    const c = document.createElement("canvas");
    c.className = "map-canvas";
    c.tabIndex = 0;
    c.setAttribute("role", "img");
    c.style.touchAction = "none";
    c.style.width = "100%";
    c.style.height = "55vh";
    c.style.minHeight = "240px";
    c.style.flex = "none";
    c.style.display = "block";
    c.style.outline = "none";
    this.canvas = c;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointercancel", (e) => this.up(e, true));
    c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    c.addEventListener("keydown", (e) => this.key(e));
    if (typeof ResizeObserver !== "undefined")
      new ResizeObserver(() => (this.camera ? this.moved(this.camera) : this.repaint())).observe(c);
  }

  /** Loads what is missing and polls while the canvas is on the page. */
  wake(): Promise<void> {
    if (!this.polling) {
      this.polling = true;
      this.loading = this.poll();
    }
    this.repaint();
    return this.loading ?? Promise.resolve();
  }

  stop(): void {
    this.polling = false;
    this.stopPoll?.();
    this.stopPoll = undefined;
    this.stopSettle?.();
    this.stopSettle = undefined;
  }

  setLayers(layers: ReadonlySet<LayerId>): void {
    this.layers = layers;
    this.repaint();
  }

  view(): View {
    const r = this.canvas.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : FALLBACK_VIEW;
  }

  level(): Level | undefined {
    return this.camera && this.style ? levelFor(this.camera.size, this.style.view) : undefined;
  }

  /** The picked tile as the viewer may see it. */
  pickedTile(): MapTileView | undefined {
    if (!this.picked || !this.frame || !this.camera) return undefined;
    const w = hexCentre(this.picked, 1);
    const p = worldToScreen(this.camera, this.view(), w.x, w.y);
    return this.frame.hit(p.x, p.y);
  }

  /** Written names by ref, with the viewer's server's masks over them. */
  names(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.regions?.regions ?? []) if (r.name) out[r.ref] = r.name;
    for (const ch of this.chunks.values()) Object.assign(out, ch.names ?? {});
    return Object.assign(out, this.overlay?.names ?? {});
  }

  inView(): InView {
    const out: InView = { sight: 0, seen: 0, never: 0 };
    if (!this.camera || !this.index) return out;
    const b = viewBounds(this.camera, this.view());
    const inside = (h: Axial) => {
      const p = hexCentre(h, 1);
      return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
    };
    const fog = new Map<string, string>();
    for (const t of this.overlay?.tiles ?? []) fog.set(hexKey(t), t.fog);
    const count = (h: Axial) => {
      if (!inside(h)) return;
      const f = fog.get(hexKey(h));
      if (f === "sight") out.sight++;
      else if (f === "seen") out.seen++;
      else out.never++;
    };
    const level = this.level();
    if (level === "region") {
      for (const row of this.regions?.rows ?? [])
        row.slots.forEach((slot, i) => slot >= 0 && count({ q: row.q + i, r: row.r }));
    } else if (level) {
      for (const ref of chunksInView(this.index, this.camera, this.view(), Infinity)) {
        const ch = this.chunks.get(chunkKey(ref, level, chunkRev(ref, level)));
        for (const cell of ch?.cells ?? []) count(cell);
      }
    }
    return out;
  }

  private async poll(): Promise<void> {
    this.stopPoll = undefined;
    if (!this.polling) return;
    if (!this.canvas.isConnected && this.index) {
      this.polling = false;
      return;
    }
    let every = POLL_MIN_MS;
    try {
      const was = this.index?.tick;
      const index = await this.deps.source.tick();
      every = Math.max(POLL_MIN_MS, index.tickSeconds * 1000);
      if (!this.style || this.style.rev !== index.style)
        this.style = resolveStyle(await this.deps.source.style(index.style));
      if (!this.regions || this.regions.rev !== index.regions)
        this.regions = await this.deps.source.regions(index.regions);
      this.index = index;
      this.forget();
      this.problem = "";
      if (!this.camera) await this.place();
      else if (index.tick !== was) await this.refresh();
      else this.fetchChunks();
    } catch (err) {
      this.problem = problemOf(err);
    }
    this.repaint();
    this.deps.changed();
    if (this.polling) this.stopPoll = this.deps.after(every, () => void this.poll());
  }

  // The first view: on the viewer's own tile at tile zoom, else the world fitted.
  private async place(): Promise<void> {
    const index = this.index!;
    const style = this.style!;
    await this.askOverlay({ sight: true });
    const self = this.overlay?.self;
    this.camera = self
      ? centreOn(self, style.view.zoomTile * SELF_ZOOM)
      : this.regions
        ? fitRegions(this.regions, this.view(), style.view)
        : centreOn(index.home, style.view.zoomMin);
    if (this.level() !== "region") await this.refresh();
  }

  // Chunks no index lists now are dropped, so a visit holds only the live ones.
  private forget(): void {
    const live = new Set<string>();
    for (const ref of this.index?.chunks ?? []) {
      live.add(chunkKey(ref, "area", ref.area));
      live.add(chunkKey(ref, "tile", ref.tile));
    }
    for (const k of this.chunks.keys()) if (!live.has(k)) this.chunks.delete(k);
  }

  private async refresh(): Promise<void> {
    this.fetchChunks();
    const level = this.level();
    if (!level || !this.index || !this.camera) return;
    if (level === "region") {
      await this.askOverlay({ sight: true });
      return;
    }
    const near = chunksInView(this.index, this.camera, this.view(), MAX_OVERLAY_CHUNKS);
    if (near.length) await this.askOverlay({ chunks: near.map(({ a, b }) => ({ a, b })) });
  }

  private async askOverlay(q: MapOverlayQuery): Promise<void> {
    const n = ++this.asked;
    try {
      const o = await this.deps.source.overlay(q);
      if (n !== this.asked) return;
      this.overlay = o;
      this.liveProblem = "";
    } catch (err) {
      if (n !== this.asked) return;
      this.liveProblem = problemOf(err);
      if (this.liveProblem === "signed-out") this.overlay = undefined;
    }
    this.repaint();
    this.deps.changed();
  }

  private fetchChunks(): void {
    const level = this.level();
    if (!this.index || !this.camera || !level || level === "region") return;
    for (const ref of chunksInView(this.index, this.camera, this.view(), Infinity)) {
      const key = chunkKey(ref, level, chunkRev(ref, level));
      if (this.chunks.has(key) || this.fetching.has(key) || this.missing.has(key)) continue;
      this.fetching.add(key);
      this.deps.source.chunk(level, ref.a, ref.b).then(
        (ch) => {
          this.fetching.delete(key);
          this.chunks.set(key, ch);
          this.repaint();
          this.deps.changed();
        },
        (err: unknown) => {
          this.fetching.delete(key);
          if (err instanceof MapError && err.status === 404) this.missing.add(key);
          else this.problem = problemOf(err);
          this.deps.changed();
        },
      );
    }
  }

  // The camera moved: draw now, and ask for what the new view needs once it rests.
  private moved(camera: Camera): void {
    this.camera = camera;
    this.repaint();
    this.stopSettle?.();
    this.stopSettle = this.deps.after(SETTLE_MS, () => {
      this.stopSettle = undefined;
      void this.refresh();
      this.deps.changed();
    });
  }

  repaint(): void {
    if (this.painting) return;
    this.painting = true;
    const draw = () => {
      this.painting = false;
      this.draw();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(draw);
    else draw();
  }

  /** Builds the frame for the camera now and paints it. */
  draw(): void {
    if (!this.index || !this.style || !this.camera) return;
    const view = this.view();
    this.frame = buildFrame({
      camera: this.camera,
      view,
      index: this.index,
      regions: this.regions,
      chunks: this.chunks,
      overlay: this.liveProblem === "signed-out" ? undefined : this.overlay,
      layers: this.layers,
      style: this.style,
    });
    const ctx = this.deps.context ? this.deps.context(this.canvas) : this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const w = Math.max(1, Math.round(view.width * dpr));
    const h = Math.max(1, Math.round(view.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, this.frame, this.camera, view, this.cache);
  }

  private at(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    const p = this.at(e);
    this.pointers.set(e.pointerId, p);
    this.tap = this.pointers.size === 1 ? { ...p, moved: false } : undefined;
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works.
    }
  }

  private move(e: PointerEvent): void {
    const was = this.pointers.get(e.pointerId);
    if (!was || !this.camera || !this.style) return;
    const p = this.at(e);
    if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) > TAP_SLOP_PX)
      this.tap.moved = true;
    if (this.pointers.size === 1) {
      this.pointers.set(e.pointerId, p);
      this.moved(pan(this.camera, p.x - was.x, p.y - was.y));
      return;
    }
    // Two fingers: zoom by how far they spread, round their midpoint, and follow it.
    const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return;
    this.pointers.set(e.pointerId, p);
    const before = Math.hypot(was.x - other.x, was.y - other.y);
    const after = Math.hypot(p.x - other.x, p.y - other.y);
    const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
    const midWas = { x: (was.x + other.x) / 2, y: (was.y + other.y) / 2 };
    let c = pan(this.camera, mid.x - midWas.x, mid.y - midWas.y);
    if (before > 0 && after > 0) c = zoomAt(c, after / before, mid, this.view(), this.style.view);
    this.moved(c);
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.delete(e.pointerId)) return;
    const tap = this.tap;
    this.tap = undefined;
    if (!cancelled && tap && !tap.moved && this.pointers.size === 0) this.pick(this.at(e));
  }

  private wheel(e: WheelEvent): void {
    if (!this.camera || !this.style) return;
    e.preventDefault();
    this.moved(
      zoomAt(
        this.camera,
        Math.exp(-e.deltaY * WHEEL_RATE),
        this.at(e),
        this.view(),
        this.style.view,
      ),
    );
  }

  private key(e: KeyboardEvent): void {
    if (!this.camera || !this.style) return;
    const v = this.view();
    const centre = { x: v.width / 2, y: v.height / 2 };
    const step = { x: v.width * KEY_PAN, y: v.height * KEY_PAN };
    const moves: Record<string, () => Camera> = {
      ArrowLeft: () => pan(this.camera!, step.x, 0),
      ArrowRight: () => pan(this.camera!, -step.x, 0),
      ArrowUp: () => pan(this.camera!, 0, step.y),
      ArrowDown: () => pan(this.camera!, 0, -step.y),
      "+": () => zoomAt(this.camera!, KEY_ZOOM, centre, v, this.style!.view),
      "=": () => zoomAt(this.camera!, KEY_ZOOM, centre, v, this.style!.view),
      "-": () => zoomAt(this.camera!, 1 / KEY_ZOOM, centre, v, this.style!.view),
    };
    const go = moves[e.key];
    if (!go) return;
    e.preventDefault();
    this.moved(go());
  }

  /** Picks the tile under a point in CSS px of the canvas; blank ground is picked as nothing known. */
  pick(p: { x: number; y: number }): void {
    if (!this.camera) return;
    this.picked = screenToHex(this.camera, this.view(), p.x, p.y);
    this.deps.changed();
  }

  /** Centres on the viewer's own tile, if the overlay names one. */
  home(): void {
    const self = this.overlay?.self;
    if (!self || !this.style) return;
    const size = Math.max(this.camera?.size ?? 0, this.style.view.zoomTile * SELF_ZOOM);
    this.moved(centreOn(self, size));
  }
}
