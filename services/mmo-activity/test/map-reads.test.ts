// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, expect, test } from "vite-plus/test";

import { centreOn, chunkKey } from "../../../packages/mmo-map/src/index.ts";
import type { MapChunk, MapChunkRef, MapIndex, MapOverlay } from "../src/api.ts";
import { MapCanvas } from "../src/map/canvas.ts";
import { MapError, type MapSource } from "../src/map/source.ts";
import { FakeClock } from "./fakes.ts";

const FIXTURES = `${import.meta.dirname}/fixtures/map`;
const json = <T>(path: string): T => JSON.parse(readFileSync(`${FIXTURES}/${path}`, "utf8")) as T;
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const overlay = json<MapOverlay>("overlay.json");
const self = overlay.self!;
// A 5 by 5 block of chunks round the character, all in one view.
const refs: MapChunkRef[] = [];
for (let a = 0; a < 5; a++)
  for (let b = 0; b < 5; b++)
    refs.push({
      a,
      b,
      centre: { q: self.q - 2 + a, r: self.r - 2 + b },
      tiles: 1,
      area: `area${a}${b}`,
      tile: `tile${a}${b}`,
    });
const index: MapIndex = { ...json<MapIndex>("index.json"), chunks: refs };
const AREA_SIZE = 8;

type Fail = (level: string, a: number, b: number) => number | undefined;

function world(fail: Fail = () => undefined, overlayFails = 0) {
  const asked: string[] = [];
  let refused = overlayFails;
  const source: MapSource = {
    tick: () => (asked.push("tick"), Promise.resolve(structuredClone(index))),
    style: () => Promise.resolve(json("style.json")),
    regions: () => Promise.resolve(json("regions.json")),
    chunk(level, a, b) {
      asked.push(`${level}/${a}.${b}`);
      const status = fail(level, a, b);
      if (status) return Promise.reject(new MapError(status, "no", "refused"));
      const rev = level === "area" ? `area${a}${b}` : `tile${a}${b}`;
      return Promise.resolve({ world: "mock", a, b, level, rev, cells: [] } as MapChunk);
    },
    overlay(q) {
      asked.push(q.sight ? "overlay/sight" : "overlay/chunks");
      if (!q.sight && refused > 0) {
        refused--;
        return Promise.reject(new MapError(429, "busy", "slow down"));
      }
      return Promise.resolve(structuredClone(overlay));
    },
  };
  return { source, asked };
}

const opened: MapCanvas[] = [];
afterEach(() => {
  for (const m of opened.splice(0)) m.stop();
  document.body.replaceChildren();
});

// Opens the map, lets its first tile-level view load, then zooms out to area level.
async function atArea(w: ReturnType<typeof world>) {
  const clock = new FakeClock();
  const m = new MapCanvas({
    source: w.source,
    after: clock.after,
    changed: () => {},
    context: () => null,
  });
  opened.push(m);
  document.body.append(m.canvas);
  await m.wake();
  for (let i = 0; i < 3; i++) {
    clock.advance(1000);
    await wait();
  }
  w.asked.length = 0;
  m.camera = centreOn(self, AREA_SIZE);
  m.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  clock.advance(300);
  await wait();
  expect(m.level()).toBe("area");
  return { m, clock };
}

const areaReads = (asked: string[]) => asked.filter((a) => a.startsWith("area/"));

test("chunk reads go at most 16 a second, the overlay first, and the rest follow", async () => {
  const w = world();
  const { m, clock } = await atArea(w);
  expect(w.asked[0]).toBe("overlay/chunks");
  expect(areaReads(w.asked)).toHaveLength(16);
  clock.advance(999);
  await wait();
  expect(areaReads(w.asked)).toHaveLength(16);
  clock.advance(1);
  await wait();
  expect(areaReads(w.asked)).toHaveLength(refs.length);
  expect(new Set(areaReads(w.asked)).size).toBe(refs.length);
  for (const r of refs) expect(m.chunks.has(chunkKey(r, "area", r.area))).toBe(true);
});

test("a chunk refused as busy is asked again a second later and drawn", async () => {
  let refusals = 0;
  const w = world((level, a, b) =>
    level === "area" && a === 2 && b === 2 && refusals++ === 0 ? 429 : undefined,
  );
  const { m, clock } = await atArea(w);
  const key = chunkKey(refs[12]!, "area", "area22");
  expect(w.asked.filter((x) => x === "area/2.2")).toHaveLength(1);
  expect(m.chunks.has(key)).toBe(false);
  clock.advance(1000);
  await wait();
  clock.advance(1000);
  await wait();
  expect(w.asked.filter((x) => x === "area/2.2")).toHaveLength(2);
  expect(m.chunks.has(key)).toBe(true);
  expect(m.problem).toBe("");
});

test("a chunk the world does not have is not asked again", async () => {
  const w = world((level, a, b) => (level === "area" && a === 0 && b === 0 ? 404 : undefined));
  const { m, clock } = await atArea(w);
  for (let i = 0; i < 2; i++) {
    clock.advance(1000);
    await wait();
  }
  m.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  clock.advance(1300);
  await wait();
  expect(w.asked.filter((x) => x === "area/0.0")).toHaveLength(1);
  expect(m.problem).toBe("");
});

test("an overlay refused as busy is asked again", async () => {
  const w = world(undefined, 1);
  const { m, clock } = await atArea(w);
  // The first view's chunk overlay took the refusal; it was asked again and answered.
  expect(m.liveProblem).toBe("");
  w.asked.length = 0;
  const w2 = world(undefined, 1);
  Object.assign(w.source, { overlay: w2.source.overlay });
  m.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  clock.advance(300);
  await wait();
  expect(w2.asked).toEqual(["overlay/chunks"]);
  expect(m.liveProblem).toBe("busy");
  clock.advance(1000);
  await wait();
  expect(w2.asked).toEqual(["overlay/chunks", "overlay/chunks"]);
  expect(m.liveProblem).toBe("");
});
