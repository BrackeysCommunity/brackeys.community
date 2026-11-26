import { ChunkCache, paint } from "../../../../packages/mmo-map/src/draw.ts";
import {
  backing,
  buildFrame,
  centreOn,
  chunkKey,
  chunkRev,
  chunksInView,
  DEFAULT_LAYERS,
  fitRegions,
  focusCamera,
  type Axial,
  type Camera,
  type ChunkLevel,
  type Frame,
  hexCentre,
  hexKey,
  keyMove,
  type LayerId,
  type Level,
  levelFor,
  MAX_OVERLAY_CHUNKS,
  PointerTracker,
  regionTiles,
  resolveStyle,
  screenToHex,
  type Style,
  type View,
  viewBounds,
  wheelZoom,
  worldToScreen,
} from "../../../../packages/mmo-map/src/index.ts";
import {
  FogSeen,
  FogSight,
  type MapChunk,
  type MapChunkRef,
  type MapIndex,
  type MapOverlay,
  type MapOverlayQuery,
  type MapRegions,
  type MapTileView,
} from "../api.ts";
import { MapError, type MapSource } from "./source.ts";

// Polled as the site does: the index every tick but never more often than
// POLL_MIN_MS; the overlay when the tick moves or a pan or zoom settles.
const POLL_MIN_MS = 30_000;
const SETTLE_MS = 300;
// structural: chunk reads sent in one window (under the listener's per-session cap, so an overlay
// still fits), the wait before a busy read is asked again, the window, and how many times a busy
// overlay is asked again.
const CHUNK_READS_A_SECOND = 16;
const BUSY_RETRY_MS = 1000;
const READ_WINDOW_MS = 1000;
const OVERLAY_RETRIES = 2;
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
  private readonly queued = new Map<string, { ref: MapChunkRef; level: ChunkLevel }>();
  private sentInWindow = 0;
  private stopDrain: (() => void) | undefined;
  private stopRetry: (() => void) | undefined;
  private readonly pointers = new PointerTracker();
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
    this.stopDrain?.();
    this.stopDrain = undefined;
    this.sentInWindow = 0;
    this.stopRetry?.();
    this.stopRetry = undefined;
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
      if (f === FogSight) out.sight++;
      else if (f === FogSeen) out.seen++;
      else out.never++;
    };
    const level = this.level();
    if (level === "region") {
      if (this.regions) for (const { h } of regionTiles(this.regions)) count(h);
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
      ? focusCamera(self, style.view)
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

  // The overlay is asked first, so a burst of chunk reads never crowds it out.
  private async refresh(): Promise<void> {
    const level = this.level();
    let ask: Promise<void> | undefined;
    if (level && this.index && this.camera) {
      if (level === "region") ask = this.askOverlay({ sight: true });
      else {
        const near = chunksInView(this.index, this.camera, this.view(), MAX_OVERLAY_CHUNKS)
          .map(({ a, b }) => ({ a, b }))
          .sort((x, y) => x.a - y.a || x.b - y.b);
        if (near.length) ask = this.askOverlay({ chunks: near });
      }
    }
    this.fetchChunks();
    await ask;
  }

  private async askOverlay(q: MapOverlayQuery, retries = OVERLAY_RETRIES): Promise<void> {
    const n = ++this.asked;
    this.stopRetry?.();
    this.stopRetry = undefined;
    try {
      const o = await this.deps.source.overlay(q);
      if (n !== this.asked) return;
      this.overlay = o;
      this.liveProblem = "";
    } catch (err) {
      if (n !== this.asked) return;
      this.liveProblem = problemOf(err);
      if (this.liveProblem === "signed-out") this.overlay = undefined;
      if (this.liveProblem === "busy" && retries > 0 && this.polling)
        this.stopRetry = this.deps.after(BUSY_RETRY_MS, () => {
          this.stopRetry = undefined;
          if (n === this.asked) void this.askOverlay(q, retries - 1);
        });
    }
    this.repaint();
    this.deps.changed();
  }

  private wanted(level: ChunkLevel): Map<string, MapChunkRef> {
    const out = new Map<string, MapChunkRef>();
    if (!this.index || !this.camera) return out;
    for (const ref of chunksInView(this.index, this.camera, this.view(), Infinity))
      out.set(chunkKey(ref, level, chunkRev(ref, level)), ref);
    return out;
  }

  private fetchChunks(): void {
    const level = this.level();
    if (!level || level === "region") return;
    for (const [key, ref] of this.wanted(level)) {
      if (this.chunks.has(key) || this.fetching.has(key) || this.missing.has(key)) continue;
      if (!this.queued.has(key)) this.queued.set(key, { ref, level });
    }
    this.drain();
  }

  // Sends queued chunk reads, at most CHUNK_READS_A_SECOND in any one window;
  // the window's end drains again while anything is left.
  private drain(): void {
    if (!this.queued.size) return;
    const level = this.level();
    const live = level && level !== "region" ? this.wanted(level) : new Map<string, MapChunkRef>();
    for (const [key, q] of this.queued) {
      if (this.sentInWindow >= CHUNK_READS_A_SECOND) break;
      this.queued.delete(key);
      if (q.level !== level || !live.has(key) || this.chunks.has(key) || this.fetching.has(key))
        continue;
      this.send(key, q.ref, q.level);
    }
  }

  private openWindow(ms: number): void {
    if (this.stopDrain) return;
    this.stopDrain = this.deps.after(ms, () => {
      this.stopDrain = undefined;
      this.sentInWindow = 0;
      this.drain();
    });
  }

  private send(key: string, ref: MapChunkRef, level: ChunkLevel): void {
    this.fetching.add(key);
    this.sentInWindow++;
    this.openWindow(READ_WINDOW_MS);
    this.deps.source.chunk(level, ref.a, ref.b).then(
      (ch) => {
        this.fetching.delete(key);
        this.chunks.set(key, ch);
        if (this.problem === "busy") this.problem = "";
        this.repaint();
        this.deps.changed();
      },
      (err: unknown) => {
        this.fetching.delete(key);
        if (err instanceof MapError && err.status === 404) this.missing.add(key);
        else if (err instanceof MapError && err.status === 429) {
          this.problem = "busy";
          if (!this.queued.has(key)) this.queued.set(key, { ref, level });
          if (this.polling) this.openWindow(BUSY_RETRY_MS);
        } else this.problem = problemOf(err);
        this.deps.changed();
      },
    );
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
    const b = backing(view, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    if (this.canvas.width !== b.width) this.canvas.width = b.width;
    if (this.canvas.height !== b.height) this.canvas.height = b.height;
    ctx.setTransform(b.dpr, 0, 0, b.dpr, 0, 0);
    paint(ctx, this.frame, this.camera, view, this.cache);
  }

  private at(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    this.pointers.down(e.pointerId, this.at(e));
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works.
    }
  }

  private move(e: PointerEvent): void {
    if (!this.camera || !this.style) return;
    const next = this.pointers.move(
      e.pointerId,
      this.at(e),
      this.camera,
      this.view(),
      this.style.view,
    );
    if (next) this.moved(next);
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (this.pointers.up(e.pointerId, cancelled)) this.pick(this.at(e));
  }

  private wheel(e: WheelEvent): void {
    if (!this.camera || !this.style) return;
    e.preventDefault();
    this.moved(wheelZoom(this.camera, e.deltaY, this.at(e), this.view(), this.style.view));
  }

  private key(e: KeyboardEvent): void {
    if (!this.camera || !this.style) return;
    const next = keyMove(this.camera, e.key, this.view(), this.style.view);
    if (!next) return;
    e.preventDefault();
    this.moved(next);
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
    this.moved(focusCamera(self, this.style.view, this.camera));
  }
}
