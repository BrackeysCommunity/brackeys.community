import { hexDistance, overlayQueryString } from "../../../../packages/mmo-map/src/index.ts";
import type {
  MapChunk,
  MapIndex,
  MapOverlay,
  MapOverlayQuery,
  MapRegions,
  MapStyle,
} from "../api.ts";
import { mapRoutes } from "../discord.ts";

export type ChunkLevel = "area" | "tile";

/**
 * Where the map's payloads come from: the world's Activity listener, or
 * the fixtures behind ?mock=. What arrives is already filtered for the
 * viewer; nothing here decides what anybody may see.
 */
export interface MapSource {
  tick(): Promise<MapIndex>;
  style(rev: string): Promise<MapStyle>;
  regions(rev: string): Promise<MapRegions>;
  chunk(level: ChunkLevel, a: number, b: number): Promise<MapChunk>;
  overlay(q: MapOverlayQuery): Promise<MapOverlay>;
}

/** A map read the world turned down or never answered: status 0 when nothing came back. */
export class MapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The signed-in session every map read is asked as. */
export interface MapSession {
  /** The session token, "" before sign-in. */
  bearer(): string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The world's own reads, through Discord's proxy when inside it. Every read
 * carries the session: the base is the same for everyone but counts against
 * the session's caps, and the world filters the overlay to that
 * character's sight.
 */
export function liveSource(
  session: MapSession,
  where: Pick<Location, "search" | "origin"> = location,
  get: Fetch = (url, init) => fetch(url, init),
): MapSource {
  const r = mapRoutes(where);
  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await get(url, init);
    } catch {
      throw new MapError(0, "down", "the world is not answering");
    }
    if (res.ok) return (await res.json()) as T;
    let code = "";
    let message = `the world answered ${res.status}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      code = body.code ?? "";
      message = body.message ?? message;
    } catch {
      // A refusal with no body is still a refusal.
    }
    throw new MapError(res.status, code, message);
  }
  function signed<T>(url: string): Promise<T> {
    const bearer = session.bearer();
    if (!bearer) return Promise.reject(new MapError(401, "forbidden", "not signed in yet"));
    return read<T>(url, { headers: { Authorization: `Bearer ${bearer}` } });
  }
  return {
    tick: () => signed(r.tick),
    style: () => signed(r.style),
    regions: () => signed(r.regions),
    chunk: (level, a, b) => signed(`${r.chunk}?a=${a}&b=${b}&level=${level}`),
    overlay: (q) => signed(`${r.overlay}?${overlayQueryString(q)}`),
  };
}

/** The payloads of one small world, as the world served them. */
export interface MapFixtures {
  index: MapIndex;
  style: MapStyle;
  regions: MapRegions;
  /** Every chunk at both levels. */
  chunks: MapChunk[];
  overlay: MapOverlay;
}

/**
 * Serves fixtures as the listener would: a chunk nobody found is a 404,
 * and an overlay holds the asked chunks' tiles, with the viewer's own.
 */
export function mockSource(f: MapFixtures): MapSource {
  const copy = <T>(v: T) => Promise.resolve(structuredClone(v));
  return {
    tick: () => copy(f.index),
    style: () => copy(f.style),
    regions: () => copy(f.regions),
    chunk(level, a, b) {
      const ch = f.chunks.find((c) => c.level === level && c.a === a && c.b === b);
      return ch ? copy(ch) : Promise.reject(new MapError(404, "not-found", "no such chunk"));
    },
    overlay(q) {
      const o = f.overlay;
      if (q.sight) return copy(o);
      const centres = (q.chunks ?? []).flatMap((id) => {
        const ref = f.index.chunks.find((c) => c.a === id.a && c.b === id.b);
        return ref ? [ref.centre] : [];
      });
      const asked = (h: { q: number; r: number }) =>
        centres.some((c) => hexDistance(c, h) <= f.index.chunkRadius);
      const own = (h: { q: number; r: number }) =>
        o.self !== undefined && o.self.q === h.q && o.self.r === h.r;
      return copy({
        ...o,
        tiles: o.tiles.filter((t) => asked(t) || own(t)),
        fronts: o.fronts.filter((t) => asked(t)),
      });
    },
  };
}

/** A page given no source draws no map, and says so. */
export const NO_MAP: MapSource = {
  tick: () => Promise.reject(new MapError(0, "none", "no map here")),
  style: () => Promise.reject(new MapError(0, "none", "no map here")),
  regions: () => Promise.reject(new MapError(0, "none", "no map here")),
  chunk: () => Promise.reject(new MapError(0, "none", "no map here")),
  overlay: () => Promise.reject(new MapError(0, "none", "no map here")),
};
