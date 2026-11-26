import { keepPreviousData, type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/lib/toast";

import type {
  MapCell,
  MapChunk,
  MapChunkRef,
  MapFocus,
  MapIndex,
  MapOverlay,
  MapOverlayQuery,
  MapRegions,
  MapStyle,
  MapTileView,
} from "../../../packages/mmo-api/src/index.ts";
import {
  FogSeen,
  FogSight,
  ViewerAnonymous,
  ViewerCharacter,
  ViewerPlayer,
} from "../../../packages/mmo-api/src/index.ts";
import {
  type Axial,
  browserStore,
  type Camera,
  centreOn,
  chunkKey,
  chunkRev,
  chunksInView,
  type ChunkLevel,
  clampSize,
  DEFAULT_LAYERS,
  fitRegions,
  focusCamera,
  hexCentre,
  hexKey,
  type LayerId,
  type Level,
  levelFor,
  MAX_OVERLAY_CHUNKS,
  mergeTile,
  readLayers,
  regionCells,
  regionTiles,
  resolveStyle,
  type Style,
  type View,
  viewBounds,
  writeLayers,
} from "../../../packages/mmo-map/src/index.ts";
import {
  MAP_ROUTES,
  mapGet,
  MapRequestError,
  mapRetryDelay,
  retryMapRead,
  TICK_KEY,
} from "./map-api";

/** The index is asked for every tick, and never more often than this. */
export const POLL_MIN_MS = 30_000;
/** A pan or zoom has settled once the camera has rested this long. */
export const SETTLE_MS = 300;
const LAYERS_KEY = "mmo-map.layers-off";

export function pollMs(index: Pick<MapIndex, "tickSeconds"> | undefined): number {
  return Math.max(POLL_MIN_MS, (index?.tickSeconds ?? 0) * 1000);
}

export interface ChunkAsk {
  ref: MapChunkRef;
  level: ChunkLevel;
  rev: string;
  /** Where the payload is kept for the visit: chunkKey(ref, level, rev). */
  key: string;
  url: string;
}

/** What one settled view needs from the site. */
export interface MapPlan {
  level: Level;
  chunks: ChunkAsk[];
  /** Absent when no chunk is in view. */
  overlay?: MapOverlayQuery;
}

/**
 * The requests a settled view makes: at area and tile level every chunk in
 * view at its rev, and the overlay for the nearest MAX_OVERLAY_CHUNKS; at
 * region level the one regions payload, and the overlay for the viewer's
 * own sight.
 */
export function planView(index: MapIndex, style: Style, camera: Camera, view: View): MapPlan {
  const level = levelFor(camera.size, style.view);
  if (level === "region") return { level, chunks: [], overlay: { sight: true } };
  const refs = chunksInView(index, camera, view, Infinity);
  const chunks = refs.map((ref) => {
    const rev = chunkRev(ref, level);
    return {
      ref,
      level,
      rev,
      key: chunkKey(ref, level, rev),
      url: MAP_ROUTES.chunk(level, ref.a, ref.b, rev),
    };
  });
  const ids = refs
    .slice(0, MAX_OVERLAY_CHUNKS)
    .map(({ a, b }) => ({ a, b }))
    // Sorted, so a view asking for the same chunks keys one overlay read a tick.
    .sort((x, y) => x.a - y.a || x.b - y.b);
  return ids.length ? { level, chunks, overlay: { chunks: ids } } : { level, chunks };
}

/** Where the camera starts (GDD 4.11). */
export type Start =
  | { kind: "at"; hex: Axial; size?: number }
  | { kind: "server"; server: string }
  | { kind: "self" }
  | { kind: "world" };

/**
 * A ?q=&r= link opens there; a server's view centres on its guild's
 * settlements; a signed-in viewer on their own tile; anyone else sees the
 * world fitted.
 */
export function startOf(search: MapSearch, signedIn: boolean): Start {
  if (search.q !== undefined && search.r !== undefined) {
    return { kind: "at", hex: { q: search.q, r: search.r }, size: search.z };
  }
  if (search.server) return { kind: "server", server: search.server };
  return signedIn ? { kind: "self" } : { kind: "world" };
}

export function startCamera(
  start: Start,
  ctx: {
    style: Style;
    view: View;
    regions?: MapRegions;
    index: MapIndex;
    focus?: MapFocus;
    self?: Axial;
  },
): Camera {
  const v = ctx.style.view;
  if (start.kind === "at") {
    return start.size !== undefined
      ? centreOn(start.hex, clampSize(start.size, v))
      : focusCamera(start.hex, v);
  }
  if (start.kind === "server" && ctx.focus) return focusCamera(ctx.focus.centre, v);
  if (start.kind === "self" && ctx.self) return focusCamera(ctx.self, v);
  if (ctx.regions) return fitRegions(ctx.regions, ctx.view, v);
  return centreOn(ctx.index.home, v.zoomMin);
}

export interface MapSearch {
  server?: string;
  q?: number;
  r?: number;
  z?: number;
}

/** Fog counts over the discovered tiles in a view. */
export interface InView {
  sight: number;
  seen: number;
  never: number;
}

/** How many discovered tiles in view are in sight, last seen, and never seen. */
export function countInView(
  data: {
    index: MapIndex;
    style: Style;
    regions?: MapRegions;
    chunks: ReadonlyMap<string, MapChunk>;
    overlay?: MapOverlay;
  },
  camera: Camera,
  view: View,
): InView {
  const out: InView = { sight: 0, seen: 0, never: 0 };
  const b = viewBounds(camera, view);
  const fog = new Map<string, string>();
  for (const t of data.overlay?.tiles ?? []) fog.set(hexKey(t), t.fog);
  const count = (h: Axial) => {
    const p = hexCentre(h, 1);
    if (p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom) return;
    const f = fog.get(hexKey(h));
    if (f === FogSight) out.sight++;
    else if (f === FogSeen) out.seen++;
    else out.never++;
  };
  const level = levelFor(camera.size, data.style.view);
  if (level === "region") {
    if (data.regions) for (const { h } of regionTiles(data.regions)) count(h);
    return out;
  }
  for (const ref of chunksInView(data.index, camera, view, Infinity)) {
    const ch = data.chunks.get(chunkKey(ref, level, chunkRev(ref, level)));
    for (const cell of ch?.cells ?? []) count(cell);
  }
  return out;
}

/** Every cell the visit holds by hex, tile level over area level, regions under both. */
export function cellIndex(
  chunks: ReadonlyMap<string, MapChunk>,
  regions: MapRegions | undefined,
): Map<string, MapCell> {
  const out = new Map<string, MapCell>(regions ? regionCells(regions) : []);
  const tile: MapChunk[] = [];
  for (const ch of chunks.values()) {
    if (ch.level === "tile") tile.push(ch);
    else for (const c of ch.cells) out.set(hexKey(c), c);
  }
  for (const ch of tile) for (const c of ch.cells) out.set(hexKey(c), c);
  return out;
}

/** A tile as the viewer may see it, or undefined for ground nobody has found. */
export function tileAt(
  h: Axial,
  cells: ReadonlyMap<string, MapCell>,
  overlay: MapOverlay | undefined,
): MapTileView | undefined {
  const k = hexKey(h);
  const self = overlay?.self;
  const cell = cells.get(k) ?? (self && hexKey(self) === k ? self.cell : undefined);
  if (!cell) return undefined;
  return mergeTile(
    cell,
    overlay?.tiles.find((t) => t.q === h.q && t.r === h.r),
  );
}

/** Written names by ref: the shared payloads', with the viewer's server's masks over them. */
export function mapNames(
  regions: MapRegions | undefined,
  chunks: ReadonlyMap<string, MapChunk>,
  overlay: MapOverlay | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of regions?.regions ?? []) if (r.name) out[r.ref] = r.name;
  for (const ch of chunks.values()) Object.assign(out, ch.names ?? {});
  return Object.assign(out, overlay?.names ?? {});
}

export type MapProblem = "" | "busy" | "down";

function problemOf(err: unknown): MapProblem {
  if (!(err instanceof MapRequestError)) return "";
  if (err.status === 429) return "busy";
  if (err.status === 0 || err.status === 502 || err.status === 503) return "down";
  return "";
}

/** Tells the visitor once per failure, under one id so a poll never stacks toasts. */
function announce(problem: MapProblem): void {
  if (problem === "busy") {
    toast.warning("The map is busy, so some of it may be missing for now.", {
      id: "mmo-map-busy",
    });
  } else if (problem === "down") {
    toast.error("The world is not answering. The map shows what it last sent.", {
      id: "mmo-map-down",
    });
  }
}

export type MapViewer = typeof ViewerAnonymous | typeof ViewerPlayer | typeof ViewerCharacter;

interface ChunkReads {
  data: (MapChunk | undefined)[];
  problem: MapProblem;
  failedAt: number;
}

function combineChunks(results: UseQueryResult<MapChunk>[]): ChunkReads {
  return {
    data: results.map((r) => r.data),
    problem: results.map((r) => problemOf(r.error)).find(Boolean) ?? "",
    failedAt: Math.max(0, ...results.map((r) => r.errorUpdatedAt)),
  };
}

export interface LiveMapOptions {
  search: MapSearch;
  /** The signed-in user, or null; undefined while the session is still being read. */
  userId: string | null | undefined;
}

export interface LiveMap {
  index?: MapIndex;
  style?: Style;
  regions?: MapRegions;
  /** Every chunk payload fetched this visit, by chunkKey; a new map when it changes. */
  chunks: Map<string, MapChunk>;
  overlay?: MapOverlay;
  viewer: MapViewer;
  /** The camera the view settled on; the canvas starts from the first. */
  camera?: Camera;
  view?: View;
  plan?: MapPlan;
  /** The canvas's camera moved: the view is asked for once it rests. */
  moved: (camera: Camera) => void;
  /** The canvas was laid out at this size. */
  resized: (view: View) => void;
  layers: ReadonlySet<LayerId>;
  setLayers: (layers: ReadonlySet<LayerId>) => void;
  /** The index, the style or the regions are not here yet. */
  loading: boolean;
  problem: MapProblem;
}

const KEY = "mmo-map";

/**
 * The live map's reads (GDD 4.11): the index every tick, the style and the
 * regions by rev, the chunks in a settled view by rev, and the viewer's
 * overlay when the tick moves or the view settles. Everything arrives
 * already filtered by the world; this only decides what to ask for.
 */
export function useLiveMap({ search, userId }: LiveMapOptions): LiveMap {
  const signedIn = Boolean(userId);
  const sessionKnown = userId !== undefined;

  const tick = useQuery({
    queryKey: TICK_KEY,
    queryFn: ({ signal }) => mapGet<MapIndex>(MAP_ROUTES.tick, signal),
    refetchInterval: (q) => pollMs(q.state.data),
    staleTime: POLL_MIN_MS,
    retry: false,
  });
  const index = tick.data;

  const styleQ = useQuery({
    queryKey: [KEY, "style", index?.style],
    queryFn: ({ signal }) => mapGet<MapStyle>(MAP_ROUTES.style(index!.style), signal),
    enabled: Boolean(index?.style),
    staleTime: Infinity,
    retry: retryMapRead,
    retryDelay: mapRetryDelay,
  });
  const style = useMemo(() => (styleQ.data ? resolveStyle(styleQ.data) : undefined), [styleQ.data]);

  const regionsQ = useQuery({
    queryKey: [KEY, "regions", index?.regions],
    queryFn: ({ signal }) => mapGet<MapRegions>(MAP_ROUTES.regions(index!.regions), signal),
    enabled: Boolean(index?.regions),
    staleTime: Infinity,
    retry: retryMapRead,
    retryDelay: mapRetryDelay,
    placeholderData: keepPreviousData,
  });
  const regions = regionsQ.data;

  const [start, setStart] = useState<Start | undefined>(undefined);
  useEffect(() => {
    if (!start && sessionKnown) setStart(startOf(search, signedIn));
  }, [start, sessionKnown, search, signedIn]);

  const focusQ = useQuery({
    queryKey: [KEY, "focus", start?.kind === "server" ? start.server : ""],
    queryFn: ({ signal }) =>
      mapGet<MapFocus>(MAP_ROUTES.focus(start?.kind === "server" ? start.server : ""), signal),
    enabled: start?.kind === "server",
    staleTime: Infinity,
    retry: false,
  });

  const [camera, setCamera] = useState<Camera | undefined>(undefined);
  const [view, setView] = useState<View | undefined>(undefined);
  const pending = useRef<{ camera?: Camera; view?: View }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const settle = useCallback(() => {
    timer.current = undefined;
    const next = pending.current;
    pending.current = {};
    if (next.view) setView(next.view);
    if (next.camera) setCamera(next.camera);
  }, []);
  const later = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(settle, SETTLE_MS);
  }, [settle]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const moved = useCallback(
    (c: Camera) => {
      pending.current.camera = c;
      later();
    },
    [later],
  );
  const viewRef = useRef<View | undefined>(undefined);
  const resized = useCallback(
    (v: View) => {
      const was = viewRef.current;
      if (was && Math.abs(was.width - v.width) < 0.5 && Math.abs(was.height - v.height) < 0.5) {
        return;
      }
      viewRef.current = v;
      if (!was) setView(v);
      else {
        pending.current.view = v;
        later();
      }
    },
    [later],
  );

  const plan = useMemo(
    () => (index && style && camera && view ? planView(index, style, camera, view) : undefined),
    [index, style, camera, view],
  );

  // Before the camera is placed, a signed-in viewer's sight tells where they stand.
  const overlayAsk: MapOverlayQuery | undefined = plan
    ? plan.overlay
    : start?.kind === "self"
      ? { sight: true }
      : undefined;
  const overlayUrl = overlayAsk && MAP_ROUTES.overlay(overlayAsk);
  const overlayQ = useQuery({
    queryKey: [KEY, "overlay", userId ?? "", index?.tick, overlayUrl],
    queryFn: ({ signal }) => mapGet<MapOverlay>(overlayUrl!, signal),
    enabled: signedIn && Boolean(index) && Boolean(overlayUrl),
    staleTime: Infinity,
    gcTime: 60_000,
    retry: retryMapRead,
    retryDelay: mapRetryDelay,
    placeholderData: keepPreviousData,
  });
  const overlay = signedIn ? overlayQ.data : undefined;

  // Place the camera once the start's own read has answered, either way.
  const startReady =
    start !== undefined &&
    (start.kind !== "server" || !focusQ.isPending) &&
    (start.kind !== "self" || !overlayQ.isPending);
  useEffect(() => {
    if (camera || !start || !startReady || !index || !style || !view) return;
    if (start.kind === "world" && !regions && regionsQ.isPending) return;
    setCamera(
      startCamera(start, {
        style,
        view,
        regions,
        index,
        focus: focusQ.data,
        self: overlayQ.data?.self,
      }),
    );
  }, [
    camera,
    start,
    startReady,
    index,
    style,
    view,
    regions,
    regionsQ.isPending,
    focusQ.data,
    overlayQ.data,
  ]);

  const reads = useQueries({
    queries: (plan?.chunks ?? []).map((ask) => ({
      queryKey: [KEY, "chunk", ask.level, ask.ref.a, ask.ref.b, ask.rev],
      queryFn: ({ signal }: { signal: AbortSignal }) => mapGet<MapChunk>(ask.url, signal),
      staleTime: Infinity,
      retry: retryMapRead,
      retryDelay: mapRetryDelay,
    })),
    combine: combineChunks,
  });

  // Chunks are kept for the visit by rev; a rev the index no longer names is dropped.
  const [chunks, setChunks] = useState(() => new Map<string, MapChunk>());
  const asks = plan?.chunks;
  const fetched = reads.data;
  useEffect(() => {
    setChunks((was) => {
      let next: Map<string, MapChunk> | undefined;
      fetched.forEach((data, i) => {
        const ask = asks?.[i];
        if (!ask || !data || was.get(ask.key) === data) return;
        next ??= new Map(was);
        next.set(ask.key, data);
      });
      return next ?? was;
    });
  }, [fetched, asks]);
  useEffect(() => {
    if (!index) return;
    const live = new Set<string>();
    for (const ref of index.chunks) {
      live.add(chunkKey(ref, "area", ref.area));
      live.add(chunkKey(ref, "tile", ref.tile));
    }
    setChunks((was) => {
      if ([...was.keys()].every((k) => live.has(k))) return was;
      return new Map([...was].filter(([k]) => live.has(k)));
    });
  }, [index]);

  const [layers, setLayerState] = useState<ReadonlySet<LayerId>>(DEFAULT_LAYERS);
  useEffect(() => setLayerState(readLayers(browserStore(), LAYERS_KEY)), []);
  const setLayers = useCallback((next: ReadonlySet<LayerId>) => {
    setLayerState(new Set(next));
    writeLayers(browserStore(), LAYERS_KEY, next);
  }, []);

  const problem =
    problemOf(tick.error) ||
    problemOf(styleQ.error) ||
    problemOf(regionsQ.error) ||
    problemOf(overlayQ.error) ||
    reads.problem;
  const failedAt = Math.max(
    tick.errorUpdatedAt,
    styleQ.errorUpdatedAt,
    regionsQ.errorUpdatedAt,
    overlayQ.errorUpdatedAt,
    reads.failedAt,
  );
  const told = useRef(0);
  useEffect(() => {
    if (!problem || failedAt <= told.current) return;
    told.current = failedAt;
    announce(problem);
  }, [problem, failedAt]);

  const viewer: MapViewer = !signedIn
    ? ViewerAnonymous
    : overlay?.viewer === ViewerCharacter
      ? ViewerCharacter
      : ViewerPlayer;

  return {
    index,
    style,
    regions,
    chunks,
    overlay,
    viewer,
    camera,
    view,
    plan,
    moved,
    resized,
    layers,
    setLayers,
    loading: !index || !style || (!regions && regionsQ.isPending),
    problem,
  };
}
