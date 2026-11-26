// The client's part of the live map's load budget (GDD 4.11): decode plus
// the first frame at region level, one tile chunk's draw list, and a pan
// frame composed from cached chunks. On MMO_MAP_DUMP, the payloads
// `harness map` wrote for a 20,000-tile world; otherwise a synthetic
// 2,000-tile world, with the world-sized bound scaled by its tiles.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import type {
  MapChunk,
  MapIndex,
  MapLive,
  MapOverlay,
  MapRegions,
  MapStyle,
} from "../../mmo-api/src/index.ts";
import { type Camera, fitRegions, levelFor, pan } from "../src/camera.ts";
import { chunkId, chunkKey, chunksInView } from "../src/chunks.ts";
import { buildFrame, chunkOps } from "../src/frame.ts";
import { type Axial, hexDistance } from "../src/hex.ts";
import { DEFAULT_LAYERS } from "../src/layers.ts";
import { resolveStyle } from "../src/style.ts";
import { packStyle, syntheticWorld } from "./support.ts";

const VIEW = { width: 1440, height: 900 };
const TILE_SIZE = 14;
const BUDGET_TILES = 20_000;
const FIRST_FRAME_MS = 120;
const CHUNK_OPS_MS = 4;
const PAN_FRAME_MS = 8;
const RUNS = 5;

interface DumpCamera {
  character: string;
  camera: Camera;
  chunks: string[];
  asked?: string[];
}

interface DumpView {
  view: { width: number; height: number };
  region: DumpCamera;
  tile: DumpCamera;
}

/** What the first draw decodes, as the wire carries it, and the rest decoded. */
interface Loaded {
  raw: { style: string; index: string; regions: string; overlay: string };
  index: MapIndex;
  regions: MapRegions;
  style: MapStyle;
  chunks: Map<string, MapChunk>;
  tileOverlay: MapOverlay;
  tileCamera: Camera;
  view?: DumpView;
}

function fromDump(dir: string): Loaded {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const raw = {
    style: read("style.json"),
    index: read("index.json"),
    regions: read("regions.json"),
    overlay: read("overlay-sight.json"),
  };
  const index = JSON.parse(raw.index) as MapIndex;
  const chunks = new Map<string, MapChunk>();
  for (const ref of index.chunks) {
    for (const level of ["area", "tile"] as const) {
      const ch = JSON.parse(read(join("chunks", level, `${chunkId(ref)}.json`))) as MapChunk;
      chunks.set(chunkKey(ref, level, ch.rev), ch);
    }
  }
  const view = JSON.parse(read("view.json")) as DumpView;
  return {
    raw,
    index,
    regions: JSON.parse(raw.regions) as MapRegions,
    style: JSON.parse(raw.style) as MapStyle,
    chunks,
    tileOverlay: JSON.parse(read("overlay-tile.json")) as MapOverlay,
    tileCamera: view.tile.camera,
    view,
  };
}

/** A character's overlay: in sight round it, last seen in a band beyond. */
function overlayAt(at: Axial, tick: number, cells: Iterable<Axial>): MapOverlay {
  const tiles: MapLive[] = [];
  for (const c of cells) {
    const d = hexDistance(c, at);
    if (d <= 3) tiles.push({ q: c.q, r: c.r, fog: "sight", threat: 120, weather: "rain" });
    else if (d <= 8 && c.q >= at.q)
      tiles.push({ q: c.q, r: c.r, fog: "seen", left: tick - 300, threat: 200, busy: "light" });
  }
  tiles.sort((x, y) => x.r - y.r || x.q - y.q);
  return {
    world: "test",
    tick,
    viewer: "character",
    self: { character: "c-1", q: at.q, r: at.r },
    tiles,
    fronts: [{ kind: "rain", q: at.q, r: at.r, heading: "e" }],
  };
}

function synthetic(): Loaded {
  const w = syntheticWorld(26, 8);
  const style = packStyle();
  const home = { q: 0, r: 0 };
  const cells = [...w.cells.values()];
  const index = { ...w.index, style: style.rev };
  return {
    raw: {
      style: JSON.stringify(style),
      index: JSON.stringify(index),
      regions: JSON.stringify(w.regions),
      overlay: JSON.stringify(overlayAt(home, index.tick, cells)),
    },
    index,
    regions: w.regions,
    style,
    chunks: w.chunks,
    tileOverlay: overlayAt({ q: 6, r: 3 }, index.tick, cells),
    tileCamera: { x: 0, y: 0, size: TILE_SIZE },
  };
}

const dump = process.env.MMO_MAP_DUMP;
const world = dump ? fromDump(dump) : synthetic();
const style = resolveStyle(world.style);
// The first frame grows with the world; a chunk and a view do not.
const scale = Math.min(1, world.index.tiles / BUDGET_TILES);

function median(f: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    f();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)]!;
}

const times = { firstFrameMs: 0, chunkOpsMs: 0, panFrameMs: 0 };

test("decode plus the first frame at region level", () => {
  let level = "";
  times.firstFrameMs = median(() => {
    const st = resolveStyle(JSON.parse(world.raw.style) as MapStyle);
    const index = JSON.parse(world.raw.index) as MapIndex;
    const regions = JSON.parse(world.raw.regions) as MapRegions;
    const overlay = JSON.parse(world.raw.overlay) as MapOverlay;
    const fit = fitRegions(regions, VIEW, st.view);
    const camera =
      levelFor(fit.size, st.view) === "region" ? fit : { ...fit, size: st.view.zoomArea / 2 };
    const frame = buildFrame({
      camera,
      view: VIEW,
      index,
      regions,
      chunks: new Map(),
      overlay,
      layers: DEFAULT_LAYERS,
      style: st,
    });
    level = frame.level;
    expect(frame.base[0]?.ops.length).toBeGreaterThan(0);
  });
  expect(level).toBe("region");
  expect(times.firstFrameMs).toBeLessThanOrEqual(FIRST_FRAME_MS * scale);
});

test("one tile chunk's draw list", () => {
  const tiles = [...world.chunks.values()].filter((c) => c.level === "tile");
  const largest = tiles.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  times.chunkOpsMs = median(() => {
    expect(chunkOps(largest, "tile", style, DEFAULT_LAYERS).length).toBeGreaterThan(0);
  });
  expect(times.chunkOpsMs).toBeLessThanOrEqual(CHUNK_OPS_MS);
});

test("a pan frame composed from cached chunks", () => {
  const at = world.tileCamera;
  const panned = pan(at, VIEW.width / 4, VIEW.height / 8);
  const frame = (camera: Camera) =>
    buildFrame({
      camera,
      view: VIEW,
      index: world.index,
      chunks: world.chunks,
      overlay: world.tileOverlay,
      layers: DEFAULT_LAYERS,
      style,
    });
  // Both views' chunks are drawn once, as the frames before the pan drew them.
  frame(at);
  frame(panned);
  let base = 0;
  times.panFrameMs = median(() => {
    const f = frame(panned);
    expect(f.level).toBe("tile");
    base = f.base.length;
  });
  expect(base).toBeGreaterThan(0);
  expect(times.panFrameMs).toBeLessThanOrEqual(PAN_FRAME_MS);
});

test.runIf(dump !== undefined)("the harness asked for the chunks chunksInView names", () => {
  const v = world.view!;
  expect(v.view).toEqual(VIEW);
  const fit = fitRegions(world.regions, VIEW, style.view);
  expect(fit.x).toBeCloseTo(v.region.camera.x, 9);
  expect(fit.y).toBeCloseTo(v.region.camera.y, 9);
  expect(fit.size).toBeCloseTo(v.region.camera.size, 9);
  const ids = (cam: Camera, max?: number) => chunksInView(world.index, cam, VIEW, max).map(chunkId);
  expect(ids(v.region.camera, Infinity)).toEqual(v.region.chunks);
  expect(ids(v.tile.camera, Infinity)).toEqual(v.tile.chunks);
  expect(ids(v.tile.camera)).toEqual(v.tile.asked);
});

test("prints the client's times", () => {
  const line = `map client (${world.index.tiles} tiles${dump ? "" : ", synthetic"}): first frame ${times.firstFrameMs.toFixed(2)} ms, tile chunk draw list ${times.chunkOpsMs.toFixed(2)} ms, pan frame ${times.panFrameMs.toFixed(2)} ms`;
  process.stdout.write(`${line}\n`);
  if (dump && existsSync(dump)) {
    writeFileSync(
      join(dump, "client.json"),
      `${JSON.stringify({ tiles: world.index.tiles, ...times }, null, 2)}\n`,
    );
  }
  expect(times.firstFrameMs).toBeGreaterThan(0);
});
