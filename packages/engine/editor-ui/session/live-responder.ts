import { useCallback } from "react";

import {
  createLiveResponder,
  LIVE_FRAME_MAX_BYTES,
  setProjectPresence,
  type AwarenessLike,
  type LiveRequest,
  type StatelessProvider,
} from "../../collab/index";
import { electedHere, parseLiveMessage, parseLiveRequest } from "../../collab/live-channel";
import { DEBUG_OFF } from "../../debug/index";
import type { GameInstance, PlayOptions } from "../../index";
import { STORAGE_PREFIX, type EditorStorage } from "../host";
import type { Pending } from "../pending/pending";
import type { LiveEditor } from "./live-scene-editor";
import { readStored, storedFlag, useStoredFlag } from "./stored";

// ─── Let agents drive Play ───────────────────────────────

/** Where the viewer's "Let agents drive Play" choice is kept. */
export const AGENTS_DRIVE_PLAY_KEY = `${STORAGE_PREFIX}agents-drive-play`;

export const AGENTS_DRIVE_PLAY_LABEL = "Let agents drive Play";

export const AGENTS_DRIVE_PLAY_HINT =
  "Agents with this scene open (the scene CLI, an MCP client) can take frames of this canvas, start and step Play here, and read its state";

/** On by default against the dev server, off on a hosted one, where other people's agents may ask. */
export const agentsDrivePlayDefault = (hosted: boolean): boolean => !hosted;

/** The viewer's choice as it stands now, read afresh for each request. */
export const agentsDrivePlay = (storage: EditorStorage | null, hosted: boolean): boolean =>
  readStored(storage, AGENTS_DRIVE_PLAY_KEY, agentsDrivePlayDefault(hosted), storedFlag);

/** Tells this tab's responders the choice changed; other tabs hear it as a storage event. */
const AGENTS_DRIVE_PLAY_EVENT = "jams-editor:agents-drive-play-changed";

/** The choice and its setter, following other tabs (`useStoredFlag`). */
export const useAgentsDrivePlay = (
  storage: EditorStorage | null,
  hosted: boolean,
): [boolean, (on: boolean) => void] => {
  const [on, set] = useStoredFlag(storage, AGENTS_DRIVE_PLAY_KEY, agentsDrivePlayDefault(hosted));
  const setAndTell = useCallback(
    (next: boolean) => {
      set(next);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(AGENTS_DRIVE_PLAY_EVENT));
    },
    [set],
  );
  return [on, setAndTell];
};

/** Whether this page is on screen; true outside a browser. */
const pageVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

/** Calls `changed` when the toggle may have changed here or in another tab, or the page shows or hides. */
function watchDrivesPlay(changed: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === AGENTS_DRIVE_PLAY_KEY) changed();
  };
  window.addEventListener(AGENTS_DRIVE_PLAY_EVENT, changed);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", changed);
  document.addEventListener("visibilitychange", changed);
  return () => {
    window.removeEventListener(AGENTS_DRIVE_PLAY_EVENT, changed);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", changed);
    document.removeEventListener("visibilitychange", changed);
  };
}

// ─── Frames ──────────────────────────────────────────────

/** RGBA pixels, row by row from the top left. */
export type FramePixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** The least each downscale shrinks a side while a frame is over the cap. */
const DOWNSCALE_STEP = 0.75;

/** `src` resampled to `width` × `height`: each target pixel averages the source pixels it covers. */
export function resample(src: FramePixels, width: number, height: number): FramePixels {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = new Uint8Array(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i] ?? 0;
          g += src.data[i + 1] ?? 0;
          b += src.data[i + 2] ?? 0;
          a += src.data[i + 3] ?? 0;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

/** The `width` × `height` region of `src` at `x`, `y`. */
export function crop(
  src: FramePixels,
  x: number,
  y: number,
  width: number,
  height: number,
): FramePixels {
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * src.width + x) * 4;
    out.set(src.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(table: Uint32Array, bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (table[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of `raw`: deflated where the platform compresses, else stored blocks. */
async function zlib(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "function") {
    const deflate = new CompressionStream("deflate");
    const writer = deflate.writable.getWriter();
    void writer.write(raw as Uint8Array<ArrayBuffer>);
    void writer.close();
    return new Uint8Array(await new Response(deflate.readable).arrayBuffer());
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 0xffff));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 0xffff, (i + 1) * 0xffff);
    out[at] = i === blocks - 1 ? 1 : 0;
    out[at + 1] = part.length & 0xff;
    out[at + 2] = part.length >>> 8;
    out[at + 3] = ~part.length & 0xff;
    out[at + 4] = (~part.length >>> 8) & 0xff;
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  new DataView(out.buffer).setUint32(at, adler32(raw));
  return out;
}

/** `px` as a PNG (8-bit RGBA, no filtering), without a canvas, so it works under every renderer. */
export async function encodePng(px: FramePixels): Promise<Uint8Array> {
  const stride = px.width * 4;
  const raw = new Uint8Array((stride + 1) * px.height);
  for (let y = 0; y < px.height; y++) {
    raw.set(px.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, px.width);
  header.setUint32(4, px.height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const table = crcTable();
  const chunks = [
    ["IHDR", ihdr],
    ["IDAT", await zlib(raw)],
    ["IEND", new Uint8Array(0)],
  ] as const;
  const size = 8 + chunks.reduce((n, [, data]) => n + 12 + data.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length);
    const typed = new Uint8Array(4 + data.length);
    typed.set([...type].map((c) => c.charCodeAt(0)));
    typed.set(data, 4);
    out.set(typed, at + 4);
    view.setUint32(at + 8 + data.length, crc32(table, typed));
    at += 12 + data.length;
  }
  return out;
}

/**
 * The live frame size rule: `px` as a PNG, downscaled step by step until it
 * is at most `max` bytes. One that stays over even at a few px is returned
 * as it is, and the responder answers `frame-too-large`.
 */
export async function fitFrame(
  px: FramePixels,
  max: number = LIVE_FRAME_MAX_BYTES,
): Promise<Uint8Array> {
  let frame = px;
  let png = await encodePng(frame);
  while (png.byteLength > max && (frame.width > 1 || frame.height > 1)) {
    // PNG bytes grow with the pixel count, so jump to the size the overshoot
    // predicts instead of re-encoding a near-incompressible frame per step.
    const scale = Math.min(DOWNSCALE_STEP, 0.95 * Math.sqrt(max / png.byteLength));
    frame = resample(px, frame.width * scale, frame.height * scale);
    png = await encodePng(frame);
  }
  return png;
}

/** What `frame` asks for, as `frameRegion` reads it. */
export type FrameAsk = (LiveRequest & { t: "frame" })["opts"];

/**
 * Which part of the canvas a frame shows and at what size. `viewport` is
 * the world width in metres around the view's centre, turned into canvas
 * px by `pxPerMetre` (the camera's scale, the game's px per metre included);
 * `width` and `height` are the PNG's size, the missing one following the
 * region's aspect.
 */
export function frameRegion(
  canvas: { width: number; height: number },
  ask: FrameAsk,
  pxPerMetre: number | null,
): { x: number; y: number; width: number; height: number; outWidth: number; outHeight: number } {
  let width = canvas.width;
  let height = canvas.height;
  if (ask.viewport !== undefined && ask.viewport > 0 && pxPerMetre !== null && pxPerMetre > 0) {
    const aspect =
      ask.width !== undefined && ask.height !== undefined && ask.width > 0 && ask.height > 0
        ? ask.height / ask.width
        : canvas.height / canvas.width;
    width = Math.max(1, Math.min(canvas.width, Math.round(ask.viewport * pxPerMetre)));
    height = Math.max(1, Math.min(canvas.height, Math.round(width * aspect)));
  }
  const x = Math.floor((canvas.width - width) / 2);
  const y = Math.floor((canvas.height - height) / 2);
  const w = ask.width !== undefined && ask.width > 0 ? ask.width : undefined;
  const h = ask.height !== undefined && ask.height > 0 ? ask.height : undefined;
  const outWidth = Math.round(w ?? (h !== undefined ? (h * width) / height : width));
  const outHeight = Math.round(h ?? (w !== undefined ? (w * height) / width : height));
  return { x, y, width, height, outWidth, outHeight };
}

/** The canvas px one world metre spans along x in the first view, null when it can't be told. */
export function canvasPxPerMetre(
  game: Pick<GameInstance, "worldToClient">,
  canvas: HTMLCanvasElement,
): number | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const a = game.worldToClient({ x: 0, y: 0 });
  const b = game.worldToClient({ x: 1, y: 0 });
  const client = Math.abs(b.x - a.x);
  return client > 0 ? client * (canvas.width / rect.width) : null;
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });

/**
 * What the canvas shows, read right after the engine has drawn: a frame
 * callback asked for outside the frame runs after the engine's own, so a
 * WebGL or WebGPU canvas still holds its picture. Null when it can't be read.
 */
export async function canvasPixels(canvas: HTMLCanvasElement): Promise<FramePixels | null> {
  await nextFrame();
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) return null;
  const copy = canvas.ownerDocument.createElement("canvas");
  copy.width = width;
  copy.height = height;
  const ctx = copy.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/** A frame request answered from `pixels` (the whole canvas): its region, its size, then the size rule. */
export async function renderFrame(
  pixels: FramePixels,
  ask: FrameAsk,
  pxPerMetre: number | null,
): Promise<Uint8Array> {
  const r = frameRegion(pixels, ask, pxPerMetre);
  const region =
    r.width === pixels.width && r.height === pixels.height
      ? pixels
      : crop(pixels, r.x, r.y, r.width, r.height);
  const sized =
    r.outWidth === region.width && r.outHeight === region.height
      ? region
      : resample(region, r.outWidth, r.outHeight);
  return fitFrame(sized);
}

// ─── Debug layers ────────────────────────────────────────

const DEBUG_KEY = "F3";
/** More modes than any overlay cycles through, so a press that changes nothing can't loop forever. */
const MAX_DEBUG_MODES = 64;

/** Presses the debug overlay's F3 through the game's router, as the viewer would; the mode after it. */
function pressDebugKey(game: Pick<GameInstance, "router" | "getStore">): string {
  const native =
    typeof KeyboardEvent === "function"
      ? new KeyboardEvent("keydown", { key: DEBUG_KEY, code: DEBUG_KEY })
      : ({ preventDefault() {} } as unknown as KeyboardEvent);
  game.router.dispatch({ kind: "key", type: "down", key: DEBUG_KEY, code: DEBUG_KEY, native });
  return game.getStore().state.debugMode;
}

/**
 * Runs `run` with every debug layer showing, then puts the overlay back on
 * the mode it was in. The overlay is only reachable through F3, so this
 * cycles it once to learn its modes. Throws when the game has no overlay.
 */
export async function withDebugLayers<T>(
  game: Pick<GameInstance, "router" | "getStore">,
  run: () => Promise<T>,
): Promise<T> {
  const mode = () => game.getStore().state.debugMode;
  const start = mode();
  const cycle = [start];
  for (let i = 0; i < MAX_DEBUG_MODES; i++) {
    const next = pressDebugKey(game);
    if (next === start) break;
    cycle.push(next);
  }
  const pressUntil = (target: string) => {
    for (let i = 0; i < MAX_DEBUG_MODES && mode() !== target; i++) pressDebugKey(game);
  };
  if (cycle.length === 1) throw new Error("This editor has no debug overlay to show.");
  // Every layer before the shown one shows too, so the mode just before `off` shows them all.
  const off = cycle.indexOf(DEBUG_OFF);
  const all = cycle[(Math.max(0, off) + cycle.length - 1) % cycle.length] ?? start;
  try {
    pressUntil(all);
    return await run();
  } finally {
    pressUntil(start);
  }
}

// ─── The responder ───────────────────────────────────────

const REQUEST_LABELS: Record<LiveRequest["t"], string> = {
  frame: "An agent is taking a frame",
  play: "An agent is driving Play",
  state: "An agent is reading the game's state",
};

const answerId = (payload: string): string | null => {
  const m = parseLiveMessage(payload);
  return m && typeof m.ok === "boolean" ? m.id : null;
};

export type EditorResponderOptions = {
  /** The open scene doc's live channel. */
  provider: StatelessProvider;
  /** The project doc's awareness: the editor's project presence shows `live` while agents can drive it. */
  projectAwareness?: AwarenessLike | null;
  /**
   * "Let agents drive Play", read for each request and advertised again
   * whenever it may have changed (`useAgentsDrivePlay`'s setter, another
   * tab, focus) or the page shows or hides.
   */
  enabled: () => boolean;
  /** The editor's own Play and Stop. */
  live: Pick<LiveEditor, "play" | "stop">;
  game: GameInstance;
  /** The game's canvas, for frames. */
  canvas?: (() => HTMLElement | null) | undefined;
  /** What the canvas shows; default reads `canvas` (`canvasPixels`). */
  capture?: () => Promise<FramePixels | null>;
  /** Each request shows as a task in the status bar while it is answered. */
  pending?: Pending | null;
};

const asCanvas = (el: HTMLElement | null | undefined): HTMLCanvasElement | null =>
  el && el.tagName === "CANVAS" ? (el as HTMLCanvasElement) : null;

/**
 * Answers agents' live requests on the open scene doc for this editor:
 * frames of its canvas, its own Play (a `play` runs it as a click on Play
 * does, `stop` returns to the edit world) and the game's state. It
 * advertises in the scene doc's presence whether its toggle is on and its
 * scene on screen, and shows `live` in the project presence while agents
 * can drive it. Returns the detach, which withdraws both.
 */
export function attachEditorResponder(opts: EditorResponderOptions): () => void {
  const { provider, live, game, pending } = opts;
  const canvas = () => asCanvas(opts.canvas?.());
  const capture =
    opts.capture ??
    (async () => {
      const el = canvas();
      return el ? canvasPixels(el) : null;
    });
  const releases = new Map<string, () => void>();
  // One capture at a time: a debug frame presses F3 around its capture, so an
  // overlapping one would read the first's all-layers mode as the viewer's.
  let captures: Promise<unknown> = Promise.resolve();
  const takePixels = (debug: boolean | undefined) => {
    const next = captures.then(() => (debug ? withDebugLayers(game, capture) : capture()));
    captures = next.catch(() => {});
    return next;
  };

  const onRequest = ({ payload }: { payload: string }) => {
    const req = parseLiveRequest(payload);
    if (!req || !pending || !electedHere(provider.awareness) || releases.has(req.id)) return;
    releases.set(
      req.id,
      pending.hold({ id: `live:${req.id}`, label: REQUEST_LABELS[req.t], scope: "editor" }),
    );
  };
  const watched: StatelessProvider = {
    sendStateless(payload) {
      const id = answerId(payload);
      const release = id === null ? undefined : releases.get(id);
      if (id !== null && release) {
        releases.delete(id);
        release();
      }
      provider.sendStateless(payload);
    },
    on: (event, fn) => provider.on(event, fn),
    off: (event, fn) => provider.off(event, fn),
    awareness: provider.awareness ?? null,
  };

  const toEdit = () => live.stop();
  const driven = new Proxy(game, {
    get: (target, key, receiver) =>
      key === "stop" ? toEdit : (Reflect.get(target, key, receiver) as unknown),
  });

  const play = (req: LiveRequest & { t: "play" }) => {
    if (req.script) {
      throw new Error(
        "The open editor plays with its viewer's input; run an input script headless (scene playtest).",
      );
    }
    if (game.getStore().state.mode === "play") return;
    const el = canvas();
    let options: PlayOptions | undefined;
    if (req.from === "here" && el) {
      const rect = el.getBoundingClientRect();
      options = { at: game.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) };
    }
    if (!live.play(options))
      throw new Error("The editor couldn't start Play; its notice says why.");
  };

  let drives: boolean | null = null;
  const advertiseProject = () => {
    const next = opts.enabled() && pageVisible();
    if (next === drives || !opts.projectAwareness) return;
    drives = next;
    setProjectPresence(opts.projectAwareness, { live: next });
  };

  if (pending) provider.on("stateless", onRequest);
  const detach = createLiveResponder().attach(watched, {
    enabled: opts.enabled,
    visible: pageVisible,
    watch: (changed) =>
      watchDrivesPlay(() => {
        changed();
        advertiseProject();
      }),
    game: () => driven,
    render: async (req) => {
      const pixels = await takePixels(req.opts.debug);
      if (!pixels) throw new Error("The editor's canvas can't be read.");
      const el = canvas();
      return renderFrame(pixels, req.opts, el ? canvasPxPerMetre(game, el) : null);
    },
    play,
  });
  advertiseProject();

  return () => {
    detach();
    if (pending) provider.off("stateless", onRequest);
    for (const release of releases.values()) release();
    releases.clear();
    if (opts.projectAwareness) setProjectPresence(opts.projectAwareness, { live: false });
  };
}
