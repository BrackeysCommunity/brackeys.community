// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";

import rigs from "virtual:rigs";
import { afterEach, expect, test } from "vite-plus/test";

import {
  buildFrame,
  centreOn,
  chunkKey,
  hexDistance,
  hexKey,
  LIVE_LAYERS,
  mergeTile,
  readLayers,
  resolveStyle,
  writeLayers,
} from "../../../packages/mmo-map/src/index.ts";
import { FOG_WORDS, seenAgo } from "../../../packages/mmo-words/src/map.ts";
import { capital } from "../../../packages/mmo-words/src/units.ts";
import type { ActivityState, MapCell, MapLive, MapOverlay } from "../src/api.ts";
import { App, pick, screens } from "../src/app.ts";
import { mapRoutes } from "../src/discord.ts";
import {
  MapError,
  liveSource,
  mockSource,
  NO_MAP,
  type MapFixtures,
  type MapSource,
} from "../src/map/source.ts";
import { mapFixtures, mockScene, MockGateway } from "../src/mock.ts";
import { Session } from "../src/session.ts";
import { bareNumbers } from "../src/units.ts";
import { LAYERS_KEY, MapScreen, panelLines } from "../src/views/map.ts";
import { FakeClock } from "./fakes.ts";

const FIXTURES = `${import.meta.dirname}/fixtures`;
const json = <T>(path: string): T => JSON.parse(readFileSync(`${FIXTURES}/${path}`, "utf8")) as T;
const states = readdirSync(FIXTURES)
  .filter((f) => /^state-.*\.json$/.test(f))
  .map((f) => f.replace(/^state-(.*)\.json$/, "$1"));

function fixtures(overlay = "overlay"): MapFixtures {
  return {
    index: json("map/index.json"),
    style: json("map/style.json"),
    regions: json("map/regions.json"),
    chunks: json("map/chunks.json"),
    overlay: json(`map/${overlay}.json`),
  };
}

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// A 2D context that records the calls made on it, standing in for the DOM's.
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === "getTransform") return () => ({ a: 1, b: 0 });
      return () => calls.push(key);
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

class FakeOffscreen {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return recorder().ctx;
  }
}

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  } as Storage;
}

const opened: Session[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.stop();
  document.body.replaceChildren();
});

async function screen(f: MapFixtures, source = mockSource(f), clock = new FakeClock()) {
  const g = globalThis as unknown as { OffscreenCanvas?: unknown };
  g.OffscreenCanvas ??= FakeOffscreen;
  const rec = recorder();
  const s = new MapScreen({
    source,
    after: clock.after,
    context: () => rec.ctx,
    store: memory(),
  });
  document.body.append(s.root);
  await s.wake();
  await wait();
  s.map.draw();
  return { s, rec, clock };
}

test("the map is offered on every state, and opens only when asked for", () => {
  for (const name of states) {
    const st = json<ActivityState>(`state-${name}.json`);
    expect(screens(st, false), name).toContain("map");
    expect(pick(st, false, undefined), name).not.toBe("map");
  }
  const idle = json<ActivityState>("state-idle.json");
  expect(screens(idle, false)).toEqual(["idle", "map"]);
  expect(pick(idle, false, "map")).toBe("map");
  // A machine in hand is never left for the map.
  expect(pick(json<ActivityState>("state-armed.json"), false, "map")).toBe("machine");
  expect(pick(idle, true, "map")).toBe("machine");
});

test("the map's routes are the listener's, through Discord's proxy inside it", () => {
  const local = { search: "?as=1", origin: "http://localhost:18787" };
  const proxied = { search: "?frame_id=abc", origin: "https://1234.discordsays.com" };
  expect(mapRoutes(local)).toEqual({
    tick: "http://localhost:18787/api/activity/map/tick",
    style: "http://localhost:18787/api/activity/map/style",
    regions: "http://localhost:18787/api/activity/map/regions",
    chunk: "http://localhost:18787/api/activity/map/chunk",
    overlay: "http://localhost:18787/api/activity/map/overlay",
  });
  expect(mapRoutes(proxied).overlay).toBe(
    "https://1234.discordsays.com/.proxy/api/activity/map/overlay",
  );
});

test("the live source signs every read, and reads a refusal as one", async () => {
  const asked: { url: string; auth: string }[] = [];
  let status = 200;
  const get = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    asked.push({ url, auth });
    return new Response(JSON.stringify(status === 200 ? { ok: 1 } : { code: "busy" }), { status });
  };
  let bearer = "";
  const src = liveSource(
    { bearer: () => bearer },
    { search: "?frame_id=x", origin: "https://d" },
    get,
  );
  await expect(src.tick()).rejects.toMatchObject({ status: 401 });
  await expect(src.chunk("tile", 3, -2)).rejects.toMatchObject({ status: 401 });
  await expect(src.overlay({ sight: true })).rejects.toMatchObject({ status: 401 });
  expect(asked).toEqual([]);
  bearer = "tok";
  await src.tick();
  await src.chunk("tile", 3, -2);
  await src.overlay({
    chunks: [
      { a: 3, b: -2 },
      { a: 0, b: 1 },
    ],
  });
  await src.overlay({ sight: true });
  expect(asked).toEqual([
    { url: "https://d/.proxy/api/activity/map/tick", auth: "Bearer tok" },
    { url: "https://d/.proxy/api/activity/map/chunk?a=3&b=-2&level=tile", auth: "Bearer tok" },
    { url: "https://d/.proxy/api/activity/map/overlay?chunks=3.-2,0.1", auth: "Bearer tok" },
    { url: "https://d/.proxy/api/activity/map/overlay?scope=sight", auth: "Bearer tok" },
  ]);
  status = 429;
  const err = await src.tick().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(MapError);
  expect(err).toMatchObject({ status: 429, code: "busy" });
  const down = liveSource({ bearer: () => "tok" }, { search: "", origin: "http://x" }, async () => {
    throw new TypeError("no route");
  });
  await expect(down.tick()).rejects.toMatchObject({ status: 0, code: "down" });
});

test("the mock source draws a frame: base chunks, the character's live layers, and paint", async () => {
  const f = fixtures();
  const { s, rec } = await screen(f);
  const m = s.map;
  expect(m.problem).toBe("");
  expect(m.level()).toBe("tile");
  // It opens on the character's own tile.
  expect(m.camera).toMatchObject(centreOn(f.overlay.self!, m.camera!.size));
  expect(m.frame!.base.length).toBeGreaterThan(0);
  expect(m.frame!.base.every((b) => b.ops.length > 0)).toBe(true);
  expect(m.frame!.live.length).toBeGreaterThan(0);
  expect(rec.calls).toContain("drawImage");
  // Every chunk it holds was one the world listed, at the level drawn.
  for (const key of m.chunks.keys()) {
    const [level, id, rev] = key.split("/");
    const ref = f.index.chunks.find((c) => `${c.a}.${c.b}` === id)!;
    expect(key).toBe(chunkKey(ref, level as "tile", rev!));
  }
  const counts = m.inView();
  expect(counts.sight).toBeGreaterThan(0);
  expect(s.root.querySelector("[role=status]")!.textContent).toMatch(/tiles? in sight/);
  for (const t of [...s.root.querySelectorAll("p, h2, button")].map((n) => n.textContent ?? ""))
    expect(bareNumbers(t, new Set()), t).toEqual([]);
  const label = m.canvas.getAttribute("aria-label") ?? "";
  expect(m.canvas.getAttribute("role")).toBe("img");
  expect(label).toContain("Map of the wasteland");
  expect(label).toContain("last seen, dimmed, with its age");
});

test("a pan asks for the new view's chunks and overlay once it settles, and the index is polled each tick", async () => {
  const f = fixtures();
  const asked: string[] = [];
  const base = mockSource(f);
  const counted: MapSource = {
    ...base,
    tick: () => (asked.push("tick"), base.tick()),
    chunk: (level, a, b) => (asked.push(`${level}/${a}.${b}`), base.chunk(level, a, b)),
    overlay: (q) => (asked.push(q.sight ? "overlay/sight" : "overlay/chunks"), base.overlay(q)),
  };
  const { s, clock } = await screen(f, counted);
  expect(asked.slice(0, 2)).toEqual(["tick", "overlay/sight"]);
  expect(asked).toContain("overlay/chunks");
  const m = s.map;
  const self = f.overlay.self!;
  const far = [...f.index.chunks].sort(
    (x, y) => hexDistance(y.centre, self) - hexDistance(x.centre, self),
  )[0]!;
  // A small world fits the first view, so start the pan with nothing held.
  m.chunks.clear();
  asked.length = 0;
  m.camera = centreOn(far.centre, m.camera!.size);
  m.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  clock.advance(299);
  expect(asked).toEqual([]);
  clock.advance(1);
  await wait();
  expect(asked).toContain(`tile/${far.a}.${far.b}`);
  expect(asked).toContain("overlay/chunks");
  asked.length = 0;
  clock.advance(f.index.tickSeconds * 1000);
  await wait();
  expect(asked).toEqual(["tick"]);
  m.stop();
});

test("the tile panel says each fog state in words, the age of a last-seen tile, and live values only in sight or seen", () => {
  const f = fixtures();
  const cells = new Map<string, MapCell>();
  for (const ch of f.chunks)
    if (ch.level === "tile") for (const c of ch.cells) cells.set(hexKey(c), c);
  const tick = f.overlay.tick;
  const names = { ...Object.fromEntries(f.regions.regions.map((r) => [r.ref, r.name ?? ""])) };
  const sight = f.overlay.tiles.find((t) => t.fog === "sight" && t.threat)!;
  const seen = f.overlay.tiles.find((t) => t.fog === "seen" && t.left! < tick - 144)!;
  const lit = new Set(f.overlay.tiles.map(hexKey));
  const never = [...cells.values()].find((c) => !lit.has(hexKey(c)))!;
  const words = (live: MapLive | undefined, cell: MapCell) =>
    panelLines(mergeTile(cell, live), { tick, names }).lines;

  const inSight = words(sight, cells.get(hexKey(sight))!);
  expect(inSight).toContain("In sight.");
  expect(inSight).toContain(`${sight.threat} threat in its region`);
  expect(inSight.some((l) => l.startsWith("How busy"))).toBe(true);
  expect(inSight.join(" ")).not.toMatch(/world day/);

  const lastSeen = words(seen, cells.get(hexKey(seen))!);
  expect(lastSeen).toContain("Last seen.");
  expect(lastSeen).toContain(`${capital(seenAgo(tick, seen.left!))}. As it was then:`);
  expect(lastSeen.join(" ")).toMatch(/seen [12] world days? ago/i);
  expect(lastSeen).toContain(`${seen.threat} threat in its region`);

  const found = words(undefined, never);
  expect(found).toContain("Found, not seen by you.");
  expect(found.join(" ")).not.toMatch(/threat|busy|seen \d/);

  expect(panelLines(undefined, { tick, names })).toEqual({
    title: "Unknown ground",
    lines: [`${capital(FOG_WORDS.unknown)}.`],
  });
  for (const l of [...inSight, ...lastSeen, ...found])
    expect(bareNumbers(l, new Set()), l).toEqual([]);
});

test("an anonymous overlay draws no live op, and the live toggles are off with a reason", async () => {
  const f = fixtures("overlay-anonymous");
  const anon: MapOverlay = f.overlay;
  expect(anon).toMatchObject({ viewer: "anonymous", tiles: [], fronts: [] });
  const style = resolveStyle(f.style);
  const frame = buildFrame({
    camera: centreOn(f.index.home, style.view.zoomTile * 2),
    view: { width: 800, height: 600 },
    index: f.index,
    regions: f.regions,
    chunks: new Map(
      f.chunks.map((c) => {
        const ref = f.index.chunks.find((r) => r.a === c.a && r.b === c.b)!;
        return [chunkKey(ref, c.level as "tile", c.rev), c];
      }),
    ),
    overlay: anon,
    layers: new Set(LIVE_LAYERS),
    style,
  });
  expect(frame.base.length).toBeGreaterThan(0);
  expect(frame.live).toEqual([]);

  const { s } = await screen(f);
  expect(s.map.frame!.live).toEqual([]);
  const live = [...s.root.querySelectorAll<HTMLButtonElement>(".map-layers button")].filter((b) =>
    ["Threat", "Weather", "You"].includes(b.textContent ?? ""),
  );
  expect(live).toHaveLength(3);
  expect(live.every((b) => b.disabled)).toBe(true);
  expect(s.root.textContent).toContain("Live layers show what your character and guild can see");
  expect(s.root.querySelector("[role=status]")!.textContent).toMatch(/^0 tiles in sight/);
});

test("a picked tile shows in the panel, and the layer toggles keep to this browser", async () => {
  const f = fixtures();
  const { s } = await screen(f);
  const view = s.map.view();
  s.map.pick({ x: view.width / 2, y: view.height / 2 });
  const panel = s.root.querySelector<HTMLElement>(".map-tile")!;
  expect(panel.hidden).toBe(false);
  expect(panel.textContent).toContain("You are here.");
  expect(panel.textContent).toContain("In sight.");

  const store = memory();
  const on = readLayers(store, LAYERS_KEY);
  on.delete("weather");
  writeLayers(store, LAYERS_KEY, on);
  expect(readLayers(store, LAYERS_KEY).has("weather")).toBe(false);
  expect(readLayers(store, LAYERS_KEY).has("terrain")).toBe(true);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readLayers(broken, LAYERS_KEY).size).toBe(10);
  expect(() => writeLayers(broken, LAYERS_KEY, on)).not.toThrow();
});

test("?mock=map loads: the idle state, opened on the map, drawn from the fixtures", async () => {
  const scene = mockScene("map");
  expect(scene).toEqual({ state: "idle", open: "map" });
  expect(mockScene("beat")).toEqual({ state: "beat" });
  const map = await mapFixtures(new URLSearchParams("mock=map"));
  expect(map.overlay.viewer).toBe("character");
  expect((await mapFixtures(new URLSearchParams("mock=map&viewer=anonymous"))).overlay.viewer).toBe(
    "anonymous",
  );
  const g = globalThis as unknown as { OffscreenCanvas?: unknown };
  g.OffscreenCanvas ??= FakeOffscreen;
  const gateway = new MockGateway({
    state: json<ActivityState>(`state-${scene.state}.json`),
    rigs,
    now: Date.now,
    after: (ms, f) => {
      const t = setTimeout(f, ms);
      return () => clearTimeout(t);
    },
  });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: { compact: true },
    now: Date.now,
    after: (ms, f) => {
      const t = setTimeout(f, ms);
      return () => clearTimeout(t);
    },
    id: () => `intent-${++ids}-abcdef`,
  });
  opened.push(session);
  const root = document.createElement("div");
  document.body.append(root);
  new App(root, session, true, { map: mockSource(map), open: scene.open });
  session.start();
  await wait(20);
  const current = root.querySelector("nav [aria-current=page]");
  expect(current?.textContent).toBe("Map");
  const canvas = root.querySelector<HTMLCanvasElement>("main canvas.map-canvas")!;
  expect(canvas.getAttribute("role")).toBe("img");
  await wait(20);
  expect(root.querySelector("main [role=status]")!.textContent).toMatch(/tiles? in sight/);
  expect(canvas.getAttribute("aria-label")).toContain("Map of the wasteland as it has been found");
  // The other screen is a tab away, and the map comes back as it was.
  [...root.querySelectorAll<HTMLButtonElement>("nav button")]
    .find((b) => b.textContent === "Idle")!
    .click();
  expect(root.querySelector("main canvas")).toBeNull();
  [...root.querySelectorAll<HTMLButtonElement>("nav button")]
    .find((b) => b.textContent === "Map")!
    .click();
  expect(root.querySelector("main canvas")).toBe(canvas);
});

test("a page given no map source says the map is not answering, and still names its picture", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const s = new MapScreen({ source: NO_MAP, store: memory() });
  root.append(s.root);
  await s.wake();
  expect(s.root.querySelector("[role=status]")!.textContent).toBe(
    "The world's map is not answering yet.",
  );
  expect(s.map.canvas.getAttribute("aria-label")).toBe("Map of the wasteland, not drawn yet");
  s.map.stop();
});

test("a page whose map reads are refused for want of a sign-in says so", async () => {
  const refused = () => Promise.reject(new MapError(401, "forbidden", "not signed in yet"));
  const source: MapSource = {
    tick: refused,
    style: refused,
    regions: refused,
    chunk: refused,
    overlay: refused,
  };
  const root = document.createElement("div");
  document.body.append(root);
  const s = new MapScreen({ source, store: memory() });
  root.append(s.root);
  await s.wake();
  expect(s.root.querySelector("[role=status]")!.textContent).toBe(
    "The map waits for you to be signed in.",
  );
  s.map.stop();
});
