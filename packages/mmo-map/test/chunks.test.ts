import { describe, expect, test } from "vite-plus/test";

import type { MapIndex } from "../../mmo-api/src/index.ts";
import { viewBounds } from "../src/camera.ts";
import {
  chunkId,
  chunkKey,
  chunkRev,
  chunksInView,
  MAX_OVERLAY_CHUNKS,
  overlayQueryString,
} from "../src/chunks.ts";
import { hexCentre, hexDistance } from "../src/hex.ts";
import { chunkCentre, chunkOf, syntheticWorld } from "./support.ts";

function lattice(span: number, n: number): MapIndex {
  const chunks = [];
  for (let a = -span; a <= span; a++) {
    for (let b = -span; b <= span; b++) {
      chunks.push({
        a,
        b,
        centre: chunkCentre(a, b, n),
        tiles: 1,
        area: `a${a}.${b}`,
        tile: `t${a}.${b}`,
      });
    }
  }
  return { ...syntheticWorld(4, n).index, chunkRadius: n, chunks };
}

describe("chunksInView", () => {
  test("nearest the view's centre first, at most 64 by default", () => {
    const index = lattice(12, 8);
    const c = { x: 0, y: 0, size: 1.2 };
    const got = chunksInView(index, c, { width: 1440, height: 900 });
    expect(got).toHaveLength(MAX_OVERLAY_CHUNKS);
    const d = got.map((r) => {
      const p = hexCentre(r.centre, 1);
      return Math.hypot(p.x, p.y);
    });
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] - 1e-9);
    expect(got[0]).toMatchObject({ a: 0, b: 0 });
    expect(chunksInView(index, c, { width: 1440, height: 900 }, 5)).toEqual(got.slice(0, 5));
  });

  test("every chunk holding a tile in view is listed, and none far outside", () => {
    const n = 8;
    const index = lattice(10, n);
    const c = { x: 37, y: -21, size: 14 };
    const view = { width: 1440, height: 900 };
    const got = new Set(chunksInView(index, c, view, Infinity).map(chunkId));
    const b = viewBounds(c, view);
    // Sample the view: the chunk of each sampled tile must be listed.
    for (let x = b.left; x <= b.right; x += 0.5) {
      for (let y = b.top; y <= b.bottom; y += 0.5) {
        const r = (2 / 3) * y;
        const q = (Math.sqrt(3) / 3) * x - y / 3;
        const h = { q: Math.round(q), r: Math.round(r) };
        const centre = hexCentre(h, 1);
        if (centre.x < b.left - 1 || centre.x > b.right + 1) continue;
        expect(got.has(chunkId(chunkOf(h, n, 12)))).toBe(true);
      }
    }
    const reach = Math.sqrt(3) * n + 1;
    for (const ref of index.chunks) {
      if (!got.has(chunkId(ref))) continue;
      const p = hexCentre(ref.centre, 1);
      const nx = Math.min(Math.max(p.x, b.left), b.right);
      const ny = Math.min(Math.max(p.y, b.top), b.bottom);
      expect(Math.hypot(p.x - nx, p.y - ny)).toBeLessThanOrEqual(reach);
    }
  });

  test("a view away from every chunk lists none", () => {
    const index = lattice(1, 8);
    expect(
      chunksInView(index, { x: 5000, y: 5000, size: 14 }, { width: 800, height: 600 }),
    ).toEqual([]);
  });

  test("the lattice matches the world's: a chunk is every tile within its radius", () => {
    const n = 8;
    let count = 0;
    for (let q = -n; q <= n; q++) {
      for (let r = -n; r <= n; r++) {
        if (hexDistance({ q, r }, { q: 0, r: 0 }) <= n) {
          count++;
          expect(chunkOf({ q, r }, n)).toEqual({ a: 0, b: 0 });
        }
      }
    }
    expect(count).toBe(217);
  });
});

describe("keys", () => {
  test("ids, keys and revs", () => {
    const ref = { a: 3, b: -2, centre: { q: 0, r: 0 }, tiles: 1, area: "aaa", tile: "ttt" };
    expect(chunkId(ref)).toBe("3.-2");
    expect(chunkKey(ref, "tile", "ttt")).toBe("tile/3.-2/ttt");
    expect(chunkRev(ref, "area")).toBe("aaa");
    expect(chunkRev(ref, "tile")).toBe("ttt");
  });
});

describe("overlayQueryString", () => {
  test("names sight, or the chunks by id", () => {
    expect(overlayQueryString({ sight: true })).toBe("scope=sight");
    expect(
      overlayQueryString({
        chunks: [
          { a: 3, b: -2 },
          { a: 0, b: 1 },
        ],
      }),
    ).toBe("chunks=3.-2,0.1");
    expect(overlayQueryString({ chunks: [] })).toBe("chunks=");
    expect(overlayQueryString({})).toBe("chunks=");
  });
});
